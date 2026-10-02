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
import { join } from "path";
import { promisify } from "util";

import { modelOf, VOICES } from "./voices";

const run = promisify(execFile);

const BASE = join(homedir(), ".local/share/vencord-tts");
const PIPER = join(BASE, "venv/bin/piper");
const VOICES_DIR = join(BASE, "voices");
const SAMPLES_DIR = join(BASE, "samples");
const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const SAMPLES_URL = "https://rhasspy.github.io/piper-samples/samples";
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

let previewPlayer: ChildProcessWithoutNullStreams | null = null;

let pipeline: {
    key: string;
    piper: ChildProcessWithoutNullStreams;
    sox: ChildProcessWithoutNullStreams | null;
    players: ChildProcessWithoutNullStreams[];
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

/** Virtual mic = monitor of a null sink, fed by the TTS player and optionally a loopback of the real mic. */
export async function setupMic(_: IpcMainInvokeEvent, mixRealMic: boolean, realMic: string) {
    await unloadOurModules();

    // pipewire-pulse splits on spaces unless the whole property list is single-quoted
    await pactl("load-module", "module-null-sink", `sink_name=${MIX_SINK}`,
        "sink_properties='device.description=\"TTS-Mix (Vencord)\"'");
    await pactl("load-module", "module-remap-source", `master=${MIX_SINK}.monitor`, `source_name=${MIC_SOURCE}`,
        "source_properties='device.description=\"Mikrofon TTS (Vencord)\"'");

    if (mixRealMic) {
        const source = realMic || await pactl("get-default-source");
        if (!source.startsWith("vc_tts_"))
            await pactl("load-module", "module-loopback", `source=${source}`, `sink=${MIX_SINK}`,
                "latency_msec=20", "source_dont_move=true", "sink_dont_move=true");
    }
}

export async function teardownMic() {
    killPipeline();
    await unloadOurModules();
}

function killPipeline() {
    if (!pipeline) return;
    pipeline.piper.kill("SIGKILL");
    pipeline.sox?.kill("SIGKILL");
    // pw-play ignores SIGTERM while streaming
    pipeline.players.forEach(p => p.kill("SIGKILL"));
    pipeline = null;
}

function player(target: string | null, volume: number, rate: number) {
    const args = ["--raw", "--format", "s16", "--rate", String(rate), "--channels", "1", "--volume", String(volume)];
    if (target) args.push("--target", target);
    args.push("-");
    return spawn("pw-play", args);
}

/** Voice id = model name, optionally `#<speaker id>` for multi-speaker models. */
function piperArgs(voice: string) {
    const [name, speaker] = voice.split("#");
    const model = join(VOICES_DIR, `${name}.onnx`);
    if (!existsSync(PIPER)) throw new Error(`piper not found: ${PIPER} (run setup.sh)`);
    if (!existsSync(model)) throw new Error(`voice not installed: ${model} (run setup.sh)`);
    return { model, args: ["-m", model, ...(speaker ? ["--speaker", speaker] : [])] };
}

export function listVoices() {
    if (!existsSync(VOICES_DIR)) return [];
    return readdirSync(VOICES_DIR).filter(f => f.endsWith(".onnx")).map(f => f.slice(0, -".onnx".length));
}

/** Long-lived piper process: one line of stdin = one utterance, raw PCM streamed straight into pw-play. */
function getPipeline(opts: VoiceOptions) {
    const key = JSON.stringify(opts);
    if (pipeline?.key === key && pipeline.piper.exitCode === null) return pipeline;
    killPipeline();

    const { model, args } = piperArgs(opts.voice);

    // voices differ in sample rate (mls is 16 kHz, the rest 22.05 kHz)
    const rate: number = JSON.parse(readFileSync(model + ".json", "utf8")).audio.sample_rate;

    const piper = spawn(PIPER, [...args, "--output-raw", "--length-scale", String(opts.lengthScale)]);
    const players = [player(MIX_SINK, opts.volume, rate)];
    if (opts.monitor) players.push(player(null, opts.volume, rate));

    const toPlayers = (chunk: Buffer) => players.forEach(p => p.stdin.writable && p.stdin.write(chunk));

    const effect = EFFECTS[opts.effect] ?? [];
    let sox: ChildProcessWithoutNullStreams | null = null;
    if (effect.length) {
        sox = spawn("sox", ["-q", "--buffer", "2048", ...rawFormat(rate), "-", ...rawFormat(rate), "-", ...effect]);
        sox.stdout.on("data", toPlayers);
        sox.stderr.on("data", () => { });

        // sox holds the tail of each utterance in its buffers until more input arrives,
        // so once piper goes quiet push some silence through to flush it (also lets reverb ring out)
        const padding = Buffer.alloc(Math.round(rate * 2 * 0.6));
        let idle: ReturnType<typeof setTimeout> | undefined;
        piper.stdout.on("data", chunk => {
            sox!.stdin.writable && sox!.stdin.write(chunk);
            clearTimeout(idle);
            idle = setTimeout(() => sox!.stdin.writable && sox!.stdin.write(padding), 80);
        });
    } else {
        piper.stdout.on("data", toPlayers);
    }

    piper.stderr.on("data", () => { });
    for (const p of [piper, ...(sox ? [sox] : []), ...players]) {
        p.on("error", e => console.error("[TtsMic]", e));
        p.stdin.on("error", () => { });
    }

    pipeline = { key, piper, sox, players };
    return pipeline;
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
    const effect = EFFECTS[opts.effect] ?? [];
    let file = wav;
    if (effect.length) {
        file = join(tmpdir(), "vc-tts-preview-fx.wav");
        await run("sox", [wav, file, ...effect]);
    }
    stopSample();
    previewPlayer = spawn("pw-play", ["--volume", String(opts.volume), file]);
}

// ---- voice manager ----

/** Only models from voices.ts may be downloaded or deleted, so a renderer can't point this at arbitrary paths. */
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

const downloads = new Map<string, { progress: number; abort: AbortController; }>();
let engineInstall: { running: boolean; error: string | null; } = { running: false, error: null };

export function getStatus() {
    return {
        engine: existsSync(PIPER),
        engineInstalling: engineInstall.running,
        engineError: engineInstall.error,
        installed: listVoices(),
        downloads: Object.fromEntries([...downloads].map(([model, d]) => [model, d.progress]))
    };
}

export async function downloadVoice(_: IpcMainInvokeEvent, model: string) {
    assertKnownModel(model);
    if (downloads.has(model)) return;

    const abort = new AbortController();
    const entry = { progress: 0, abort };
    downloads.set(model, entry);
    mkdirSync(VOICES_DIR, { recursive: true });

    const base = `${HF}/${repoPath(model)}/${model}`;
    const config = join(VOICES_DIR, `${model}.onnx.json`);
    try {
        await fetchTo(`${base}.onnx.json`, config, abort.signal);
        await fetchTo(`${base}.onnx`, join(VOICES_DIR, `${model}.onnx`), abort.signal, p => entry.progress = p);
    } catch (e) {
        rmSync(config, { force: true });
        if (!abort.signal.aborted) throw e;
    } finally {
        downloads.delete(model);
    }
}

export function cancelDownload(_: IpcMainInvokeEvent, model: string) {
    downloads.get(model)?.abort.abort();
}

export function deleteVoice(_: IpcMainInvokeEvent, model: string) {
    assertKnownModel(model);
    if (pipeline && modelOf(JSON.parse(pipeline.key).voice) === model) killPipeline();
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
    stopSample();
    previewPlayer = spawn("pw-play", ["--volume", String(volume), file]);
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
        await run(join(BASE, "venv/bin/pip"), ["install", "-q", "piper-tts"], { maxBuffer: 16 * 1024 * 1024 });
        engineInstall = { running: false, error: null };
    } catch (e: any) {
        engineInstall = { running: false, error: String(e?.stderr || e?.message || e).trim().split("\n").slice(-3).join("\n") };
    }
}
