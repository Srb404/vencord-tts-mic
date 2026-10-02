# vencord-tts-mic

A [Vencord](https://github.com/Vendicated/Vencord) userplugin that gives you a **text-to-speech microphone** in Discord: type a message, and it's spoken in your voice channel by a neural Polish voice instead of being posted in chat.

Everything runs locally: speech is synthesised offline with [Piper](https://github.com/OHF-Voice/piper1-gpl), effects are applied with [SoX](https://sourceforge.net/projects/sox/), and audio is routed through [PipeWire](https://pipewire.org/). No text ever leaves your machine.

> The plugin's UI (menu, commands, settings) is in Polish, since it's built around Polish voices.

## How it works

The desktop Discord client captures your microphone in its native voice engine, not through the browser's `getUserMedia`, so a plugin can't inject audio from inside the page. Instead, TtsMic creates a virtual microphone at the system level and you select it in Discord like any other input device:

```
typed text ─▶ piper ─▶ sox (effect) ─▶ pw-play ──┐
                                                  ▼
real mic ──▶ module-loopback ──────────▶ null sink "vc_tts_mix"
                                                  │ monitor
                                                  ▼
                        remap source "Mikrofon TTS (Vencord)" ─▶ Discord input
```

- **`native.ts`** runs in Discord's main (Node) process. It loads the PipeWire modules through `pactl`, keeps one Piper process alive (one stdin line = one utterance, raw PCM streamed out), and pipes the audio into the virtual sink. Optionally, a second `pw-play` lets you hear the output yourself.
- **`index.tsx`** is the renderer side: a chat bar button, a context menu, slash commands, and a pre-send hook that turns your messages into speech while TTS mode is on.

Keeping Piper resident means only the first utterance pays the ~2 s model load; after that, speech starts almost immediately.

## Features

- **TTS mode toggle** in the chat bar: while it's on (red icon), anything you send is spoken instead of posted.
- **Right-click menu** on that button: voice, effect, tempo, volume, local monitoring, a local-only preview, and stop.
- **Your real mic stays usable**: it is mixed into the virtual one, so you can talk and type in the same call (this can be turned off).
- **5 Polish voices** and **6 effects** (see below), switchable on the fly.
- **Message cleanup before speaking**: mentions are read as nicknames, custom emoji as their names, links as "link", and markdown is stripped.

### Voices

| Voice | Character | Quality | Model card | Dataset license |
|---|---|---|---|---|
| Gosia | female | medium | [pl_PL-gosia-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/gosia/medium) | CC0 |
| Darkman | male | medium | [pl_PL-darkman-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/darkman/medium) | CC0 |
| MC Speech | male | medium | [pl_PL-mc_speech-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/mc_speech/medium) | CC0 ([dataset](https://www.kaggle.com/datasets/czyzi0/the-mc-speech-dataset)) |
| Bass | male, deep | high | [pl_PL-bass-high](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/bass/high) ([samples](https://huggingface.co/blackbartblues/piper-pl-bass-high)) | Apache 2.0 |
| MLS | male | low (16 kHz) | [pl_PL-mls_6892-low](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/mls_6892/low) | CC BY 4.0 ([MLS](http://www.openslr.org/94/)) |

The voice models are **not** included in this repository. `setup.sh` downloads them from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices). Each voice was fine-tuned from an English Piper base voice, so check its model card before any use beyond personal use.

### Effects

| Effect | SoX chain |
|---|---|
| Wiewiórka (chipmunk) | `pitch 800 tempo 1.1` |
| Demon | `pitch -700 reverb 30` |
| Robot | `synth sine amod 40` (ring modulation) |
| Katedra (cathedral) | `reverb 90 50 100 100 20` |
| Pijany (drunk) | `tempo 0.85 chorus 0.6 0.9 50 0.4 0.25 2 -s` |
| Telefon (phone) | `highpass 400 lowpass 3200 overdrive 4` |

SoX keeps the tail of a stream in its buffers until more input arrives. To flush it, the plugin pushes 0.6 s of silence after each utterance, which also lets reverb tails ring out.

### Commands

| Command | What it does |
|---|---|
| `/powiedz tekst [glos] [efekt]` | Speak a text, optionally with a one-off voice or effect |
| `/glos [glos]` | Set the voice; with no argument, show the current one |
| `/efekt [efekt]` | Set the effect; with no argument, show the current one |
| `/tempo wartosc` | Set the tempo, 0.5 to 2 (lower is faster) |
| `/cisza` | Stop speaking and clear the queue |

## Requirements

- Linux with PipeWire and `pipewire-pulse` (provides `pactl` and `pw-play`)
- `sox`
- Python 3 (for Piper's venv)
- Vencord [built from source](https://docs.vencord.dev/installing/) (userplugins require it)
- The official Discord desktop client. Vesktop and the web client also capture through PipeWire, so the virtual mic should work there too, but this is untested.

## Installation

```sh
git clone https://github.com/Srb404/vencord-tts-mic /path/to/Vencord/src/userplugins/ttsMic
/path/to/Vencord/src/userplugins/ttsMic/setup.sh
cd /path/to/Vencord && pnpm build && pnpm inject   # inject only on first install
```

`setup.sh` creates a venv with `piper-tts` and downloads the voices into `~/.local/share/vencord-tts`.

The plugin must physically live in `src/userplugins`. A symlink won't work, because esbuild resolves it to the real path, where Vencord's `@api/...` import aliases don't apply.

Then:

1. **Fully restart Discord** (quit from the tray; a reload isn't enough, because `native.ts` runs in the main process).
2. Enable **TtsMic** in Vencord's plugin settings.
3. In Discord, go to *Voice & Video → Input Device* and select **Mikrofon TTS (Vencord)**.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Voice | Gosia | Same as `/glos` |
| Effect | none | Same as `/efekt` |
| Tempo | 1.0 | Piper's `length_scale`: lower is faster |
| Volume | 0.8 | Above 1 may clip |
| Monitor | on | Also play the speech on your default output |
| Mix real mic | on | Loop your real mic into the virtual one |
| Real mic source | default source | A PulseAudio source name from `pactl list short sources` |

## Troubleshooting

- **The device isn't listed in Discord, or appears as plain "Mikrofon"**: restart Discord fully after updating, then pick the device again.
- **People can't hear the TTS**: with push-to-talk, speech only goes through while the key is held, so voice activity works better. Also check that Krisp or noise suppression isn't cutting it.
- **Leftover virtual devices** (e.g. after a crash): run `pactl list short modules | grep vc_tts`, then `pactl unload-module <id>`. Disabling the plugin also removes them.

## Credits

- [Vencord](https://github.com/Vendicated/Vencord): plugin API (GPL-3.0)
- [Piper](https://github.com/OHF-Voice/piper1-gpl) by the Open Home Foundation (GPL-3.0); the original project is [rhasspy/piper](https://github.com/rhasspy/piper)
- [Piper voices](https://huggingface.co/rhasspy/piper-voices): licenses per voice, see the table above
- [SoX](https://sourceforge.net/projects/sox/): audio effects
- [PipeWire](https://pipewire.org/): virtual devices and playback

## License

[GPL-3.0-or-later](LICENSE), like Vencord, which this plugin is built against. The voice models are distributed separately under their own licenses.
