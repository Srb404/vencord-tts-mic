/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { once } from "events";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { delimiter, join } from "path";
import { promisify } from "util";

import { modelOf, VOICES } from "./voices";

const run = promisify(execFile);

const BASE = join(homedir(), ".local/share/vencord-tts");
const PIPER = join(BASE, "venv/bin/piper");
const VOICES_DIR = join(BASE, "voices");
const SAMPLES_DIR = join(BASE, "samples");
const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const SAMPLES_URL = "https://rhasspy.github.io/piper-samples/samples";
// pinned, so a future Piper release can't break installs for everyone at once
const PIPER_PACKAGE = "piper-tts==1.8.0";
const MIX_SINK = "vc_tts_mix";
const MIC_SOURCE = "vc_tts_mic";

export interface VoiceOptions {
    voice: string;
    lengthScale: number;
    volume: number;
    monitor: boolean;
    effect: string;
}

/** sox effect chains; every one of them was checked to stream without stalling. */
const EFFECTS: Record<string, string[]> = {
    none: [],
    chipmunk: ["pitch", "800", "tempo", "1.1"],
    demon: ["pitch", "-700", "reverb", "30", "gain", "-3"],
    robot: ["synth", "sine", "amod", "40", "gain", "-1"],
    cathedral: ["reverb", "90", "50", "100", "100", "20", "gain", "-4"],
    drunk: ["tempo", "0.85", "chorus", "0.6", "0.9", "50", "0.4", "0.25", "2", "-s"],
    phone: ["highpass", "400", "lowpass", "3200", "overdrive", "4", "gain", "-3"]
};

const rawFormat = (rate: number) => ["-t", "raw", "-r", String(rate), "-e", "signed", "-b", "16", "-c", "1"];

const effectArgs = (id: string) => Object.hasOwn(EFFECTS, id) ? EFFECTS[id] : [];

let previewPlayer: ChildProcessWithoutNullStreams | null = null;

/** Long-lived piper process; reloading a model takes a while, so it only restarts when voice or tempo change. */
let synth: {
    key: string;
    voice: string;
    rate: number;
    piper: ChildProcessWithoutNullStreams;
} | null = null;

/** sox (if an effect is on) + pw-play streams; cheap to rebuild, so volume, monitor and effect live here. */
let output: {
    key: string;
    write: (chunk: Buffer) => void;
    kill: () => void;
} | null = null;

async function pactl(...args: string[]) {
    return (await run("pactl", args)).stdout.trim();
}

async function unloadOurModules() {
    const modules = await pactl("list", "short", "modules");
    // loopback first, so the mic is not linked into a sink that is going away
    const ids = modules.split("\n")
        .filter(line => line.includes("vc_tts_"))
        .map(line => line.split("\t")[0])
        .reverse();
    for (const id of ids) await pactl("unload-module", id).catch(() => { });
}

/** pactl calls must not interleave, or two setups at once load duplicate sinks. */
let micQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>) {
    const result = micQueue.then(task);
    micQueue = result.catch(() => { });
    return result;
}

/** Virtual mic = monitor of a null sink, fed by the TTS player and optionally a loopback of the real mic. */
export function setupMic(_: IpcMainInvokeEvent, mixRealMic: boolean, realMic: string) {
    return serialized(async () => {
        await unloadOurModules();

        // pipewire-pulse splits on spaces unless the whole property list is single-quoted
        await pactl("load-module", "module-null-sink", `sink_name=${MIX_SINK}`,
            "sink_properties='device.description=\"TTS Mix (Vencord)\"'");
        await pactl("load-module", "module-remap-source", `master=${MIX_SINK}.monitor`, `source_name=${MIC_SOURCE}`,
            "source_properties='device.description=\"TTS Microphone (Vencord)\"'");

        if (mixRealMic) {
            const source = realMic || await pactl("get-default-source");
            if (!source.startsWith("vc_tts_"))
                await pactl("load-module", "module-loopback", `source=${source}`, `sink=${MIX_SINK}`,
                    "latency_msec=20", "source_dont_move=true", "sink_dont_move=true");
        }
    });
}

export function teardownMic() {
    killPipeline();
    stopSample();
    return serialized(unloadOurModules);
}

function killSynth() {
    const old = synth;
    synth = null;
    old?.piper.kill("SIGKILL");
}

function killOutput() {
    const old = output;
    output = null;
    old?.kill();
}

function killPipeline() {
    killSynth();
    killOutput();
}

/** Logs spawn errors and swallows EPIPE, so a dead child never throws in the main process. */
function guard(p: ChildProcessWithoutNullStreams) {
    p.on("error", e => console.error("[TtsMic]", e));
    p.stdin.on("error", () => { });
    p.stderr.on("data", () => { });
    return p;
}

function player(target: string | null, volume: number, rate: number) {
    const args = ["--raw", "--format", "s16", "--rate", String(rate), "--channels", "1", "--volume", String(volume)];
    if (target) args.push("--target", target);
    args.push("-");
    return guard(spawn("pw-play", args));
}

/** Voice id = model name, optionally `#<speaker id>` for multi-speaker models. */
function piperArgs(voice: string) {
    const [name, speaker] = voice.split("#");
    assertKnownModel(name);
    if (speaker !== undefined && !/^\d+$/.test(speaker)) throw new Error(`bad speaker: ${speaker}`);
    const model = join(VOICES_DIR, `${name}.onnx`);
    if (!existsSync(PIPER)) throw new Error(`piper not found: ${PIPER} (run setup.sh)`);
    if (!existsSync(model)) throw new Error(`voice not installed: ${model} (run setup.sh)`);
    return { model, args: ["-m", model, ...(speaker ? ["--speaker", speaker] : [])] };
}

export function listVoices() {
    if (!existsSync(VOICES_DIR)) return [];
    return readdirSync(VOICES_DIR).filter(f => f.endsWith(".onnx")).map(f => f.slice(0, -".onnx".length));
}

/** One line of stdin = one utterance, raw PCM streamed to whatever output is current. */
function getSynth(opts: VoiceOptions) {
    const key = JSON.stringify([opts.voice, opts.lengthScale]);
    if (synth?.key === key) return synth;
    killSynth();

    const { model, args } = piperArgs(opts.voice);
    // voices differ in sample rate (mls is 16 kHz, the rest 22.05 kHz)
    const rate: number = JSON.parse(readFileSync(model + ".json", "utf8")).audio.sample_rate;

    const piper = guard(spawn(PIPER, [...args, "--output-raw", "--length-scale", String(opts.lengthScale)]));
    const self = { key, voice: opts.voice, rate, piper };
    piper.stdout.on("data", (chunk: Buffer) => output?.write(chunk));
    // killed from outside (OOM, crash): forget it, so the next speak() respawns instead of writing into the void
    piper.on("exit", () => synth === self && (synth = null));
    return synth = self;
}

function getOutput(opts: VoiceOptions, rate: number) {
    const key = JSON.stringify([opts.effect, opts.volume, opts.monitor, rate]);
    if (output?.key === key) return output;

    const effect = effectArgs(opts.effect);
    if (effect.length && !hasSox()) throw new Error("sox not found (needed for voice effects)");
    killOutput();

    const players = [player(MIX_SINK, opts.volume, rate)];
    if (opts.monitor) players.push(player(null, opts.volume, rate));
    const toPlayers = (chunk: Buffer) => players.forEach(p => p.stdin.writable && p.stdin.write(chunk));

    let sox: ChildProcessWithoutNullStreams | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let write = toPlayers;

    if (effect.length) {
        const fx = sox = guard(spawn("sox", ["-q", "--buffer", "2048", ...rawFormat(rate), "-", ...rawFormat(rate), "-", ...effect]));
        fx.stdout.on("data", toPlayers);

        // sox holds the tail of each utterance in its buffers until more input arrives,
        // so once piper goes quiet push some silence through to flush it (also lets reverb ring out)
        const padding = Buffer.alloc(Math.round(rate * 2 * 0.6));
        write = chunk => {
            fx.stdin.writable && fx.stdin.write(chunk);
            clearTimeout(idle);
            idle = setTimeout(() => fx.stdin.writable && fx.stdin.write(padding), 80);
        };
    }

    const procs = [...(sox ? [sox] : []), ...players];
    const self = {
        key,
        write,
        kill() {
            clearTimeout(idle);
            // pw-play ignores SIGTERM while streaming
            procs.forEach(p => p.kill("SIGKILL"));
        }
    };
    // one dead link (e.g. PipeWire restarted) breaks the chain, so rebuild all of it on the next speak()
    for (const p of procs) p.on("exit", () => output === self && killOutput());
    return output = self;
}

function getPipeline(opts: VoiceOptions) {
    const s = getSynth(opts);
    getOutput(opts, s.rate);
    return s;
}

export function speak(_: IpcMainInvokeEvent, text: string, opts: VoiceOptions) {
    const line = text.replace(/\s+/g, " ").trim();
    if (!line) return;
    getPipeline(opts).piper.stdin.write(line + "\n");
}

/** Cuts the current utterance and everything queued; the next speak() respawns the pipeline. */
export function stopSpeaking() {
    killPipeline();
}

export function warmup(_: IpcMainInvokeEvent, opts: VoiceOptions) {
    getPipeline(opts);
}

/** Local-only sample: rendered to a wav and played on the default output, never on the virtual mic. */
export async function preview(_: IpcMainInvokeEvent, text: string, opts: VoiceOptions) {
    const wav = join(tmpdir(), "vc-tts-preview.wav");
    await new Promise<void>((resolve, reject) => {
        const p = spawn(PIPER, [...piperArgs(opts.voice).args, "-f", wav, "--length-scale", String(opts.lengthScale)]);
        p.on("error", reject);
        p.on("close", code => code === 0 ? resolve() : reject(new Error(`piper: ${code}`)));
        p.stdin.end(text);
    });
    const effect = effectArgs(opts.effect);
    let file = wav;
    if (effect.length) {
        if (!hasSox()) throw new Error("sox not found (needed for voice effects)");
        file = join(tmpdir(), "vc-tts-preview-fx.wav");
        await run("sox", [wav, file, ...effect]);
    }
    playLocal(file, opts.volume);
}

// ---- voice manager ----

/** Only models from voices.ts may be used, downloaded or deleted, so a renderer can't point this at arbitrary paths. */
function assertKnownModel(model: string) {
    if (!VOICES.some(v => modelOf(v.id) === model)) throw new Error(`unknown voice: ${model}`);
}

/** pl_PL-gosia-medium -> pl/pl_PL/gosia/medium (layout of both piper-voices and piper-samples) */
function repoPath(model: string) {
    const [locale, name, quality] = model.split("-");
    return `${locale.split("_")[0]}/${locale}/${name}/${quality}`;
}

async function fetchTo(url: string, dest: string, signal?: AbortSignal, onProgress?: (fraction: number) => void) {
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${url}`);
    const total = Number(res.headers.get("content-length")) || 0;

    // written under .part and renamed at the end, so a half-downloaded model never looks installed
    const tmp = dest + ".part";
    const out = createWriteStream(tmp);
    let received = 0;
    try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            received += chunk.length;
            if (!out.write(chunk)) await once(out, "drain");
            if (total) onProgress?.(received / total);
        }
        out.end();
        await once(out, "finish");
        renameSync(tmp, dest);
    } catch (e) {
        out.destroy();
        rmSync(tmp, { force: true });
        throw e;
    }
}

const downloads = new Map<string, { progress: number; abort: AbortController; done: Promise<boolean>; }>();
let engineInstall: { running: boolean; error: string | null; } = { running: false, error: null };

const hasSox = () => (process.env.PATH ?? "").split(delimiter).some(dir => dir && existsSync(join(dir, "sox")));

export function getStatus() {
    return {
        engine: existsSync(PIPER),
        sox: hasSox(),
        engineInstalling: engineInstall.running,
        engineError: engineInstall.error,
        installed: listVoices(),
        downloads: Object.fromEntries([...downloads].map(([model, d]) => [model, d.progress]))
    };
}

/** Resolves to true once the voice is on disk, false if the download was cancelled; a second call joins the running one. */
export function downloadVoice(_: IpcMainInvokeEvent, model: string) {
    assertKnownModel(model);
    const running = downloads.get(model);
    if (running) return running.done;

    const entry = { progress: 0, abort: new AbortController(), done: Promise.resolve(false) };
    downloads.set(model, entry);
    entry.done = fetchVoice(model, entry).finally(() => downloads.delete(model));
    return entry.done;
}

async function fetchVoice(model: string, entry: { progress: number; abort: AbortController; }) {
    mkdirSync(VOICES_DIR, { recursive: true });
    const base = `${HF}/${repoPath(model)}/${model}`;
    const config = join(VOICES_DIR, `${model}.onnx.json`);
    try {
        await fetchTo(`${base}.onnx.json`, config, entry.abort.signal);
        await fetchTo(`${base}.onnx`, join(VOICES_DIR, `${model}.onnx`), entry.abort.signal, p => entry.progress = p);
        return true;
    } catch (e) {
        rmSync(config, { force: true });
        if (entry.abort.signal.aborted) return false;
        throw e;
    }
}

export function cancelDownload(_: IpcMainInvokeEvent, model: string) {
    downloads.get(model)?.abort.abort();
}

export function deleteVoice(_: IpcMainInvokeEvent, model: string) {
    assertKnownModel(model);
    if (synth && modelOf(synth.voice) === model) killSynth();
    rmSync(join(VOICES_DIR, `${model}.onnx`), { force: true });
    rmSync(join(VOICES_DIR, `${model}.onnx.json`), { force: true });
}

/** Official Piper sample for a voice, cached locally and played on the default output only. */
export async function playSample(_: IpcMainInvokeEvent, voice: string, volume: number) {
    const [model, speaker = "0"] = voice.split("#");
    assertKnownModel(model);
    if (!/^\d+$/.test(speaker)) throw new Error(`bad speaker: ${speaker}`);

    const file = join(SAMPLES_DIR, `${model}_${speaker}.mp3`);
    if (!existsSync(file)) {
        mkdirSync(SAMPLES_DIR, { recursive: true });
        await fetchTo(`${SAMPLES_URL}/${repoPath(model)}/speaker_${speaker}.mp3`, file);
    }
    playLocal(file, volume);
}

function playLocal(file: string, volume: number) {
    stopSample();
    previewPlayer = guard(spawn("pw-play", ["--volume", String(volume), file]));
}

export function stopSample() {
    previewPlayer?.kill("SIGKILL");
    previewPlayer = null;
}

/** Creates the Piper venv (python3 -m venv + pip install piper-tts, about 200 MB). */
export async function installEngine() {
    if (engineInstall.running || existsSync(PIPER)) return;
    engineInstall = { running: true, error: null };
    try {
        mkdirSync(BASE, { recursive: true });
        await run("python3", ["-m", "venv", join(BASE, "venv")]);
        await run(join(BASE, "venv/bin/pip"), ["install", "-q", PIPER_PACKAGE], { maxBuffer: 16 * 1024 * 1024 });
        engineInstall = { running: false, error: null };
    } catch (e: any) {
        engineInstall = { running: false, error: String(e?.stderr || e?.message || e).trim().split("\n").slice(-3).join("\n") };
    }
}
