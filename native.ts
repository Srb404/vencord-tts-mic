/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const run = promisify(execFile);

const BASE = join(homedir(), ".local/share/vencord-tts");
const PIPER = join(BASE, "venv/bin/piper");
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

function modelPath(voice: string) {
    const model = join(BASE, "voices", `${voice}.onnx`);
    if (!existsSync(PIPER)) throw new Error(`Brak piper: ${PIPER}`);
    if (!existsSync(model)) throw new Error(`Brak głosu: ${model}`);
    return model;
}

/** Long-lived piper process: one line of stdin = one utterance, raw PCM streamed straight into pw-play. */
function getPipeline(opts: VoiceOptions) {
    const key = JSON.stringify(opts);
    if (pipeline?.key === key && pipeline.piper.exitCode === null) return pipeline;
    killPipeline();

    const model = modelPath(opts.voice);

    // voices differ in sample rate (mls is 16 kHz, the rest 22.05 kHz)
    const rate: number = JSON.parse(readFileSync(model + ".json", "utf8")).audio.sample_rate;

    const piper = spawn(PIPER, ["-m", model, "--output-raw", "--length-scale", String(opts.lengthScale)]);
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

let previewPlayer: ChildProcessWithoutNullStreams | null = null;

/** Local-only sample: rendered to a wav and played on the default output, never on the virtual mic. */
export async function preview(_: IpcMainInvokeEvent, text: string, opts: VoiceOptions) {
    const wav = join(tmpdir(), "vc-tts-preview.wav");
    await new Promise<void>((resolve, reject) => {
        const p = spawn(PIPER, ["-m", modelPath(opts.voice), "-f", wav, "--length-scale", String(opts.lengthScale)]);
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
    previewPlayer?.kill("SIGKILL");
    previewPlayer = spawn("pw-play", ["--volume", String(opts.volume), file]);
}
