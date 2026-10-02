# vencord-tts-mic

A [Vencord](https://github.com/Vendicated/Vencord) userplugin that gives you a **text-to-speech microphone** in Discord: type a message, and it's spoken in your voice channel by a neural voice (Polish or English) instead of being posted in chat.

Everything runs locally: speech is synthesised offline with [Piper](https://github.com/OHF-Voice/piper1-gpl), effects are applied with [SoX](https://sourceforge.net/projects/sox/), and audio is routed through [PipeWire](https://pipewire.org/). No text ever leaves your machine.

> The UI (menu, commands, settings) is available in English (default) and Polish; switch it with the **Language** setting.

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
- **17 voices** (5 Polish, 12 English) and **6 effects** (see below), switchable on the fly. Spoken fallbacks ("someone", "link"…) follow the voice's language.
- **Message cleanup before speaking**: mentions are read as nicknames, custom emoji as their names, links as "link", and markdown is stripped.

### Voices

17 voices: 5 Polish and 12 English (US and British). Use the **Voice languages** setting to show only the ones you need, and `setup.sh pl` or `setup.sh en` to download only one language. Voices that aren't downloaded are hidden automatically.

**Polish**

| Voice | Character | Quality | Model | Dataset license |
|---|---|---|---|---|
| Gosia | female | medium | [pl_PL-gosia-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/gosia/medium) | CC0 |
| Darkman | male | medium | [pl_PL-darkman-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/darkman/medium) | CC0 |
| MC Speech | male | medium | [pl_PL-mc_speech-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/mc_speech/medium) | CC0 ([dataset](https://www.kaggle.com/datasets/czyzi0/the-mc-speech-dataset)) |
| Bass | male, deep | high | [pl_PL-bass-high](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/bass/high) ([samples](https://huggingface.co/blackbartblues/piper-pl-bass-high)) | Apache 2.0 |
| MLS | male | low (16 kHz) | [pl_PL-mls_6892-low](https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/mls_6892/low) | CC BY 4.0 ([MLS](http://www.openslr.org/94/)) |

**English**

| Voice | Character | Quality | Model | Dataset license |
|---|---|---|---|---|
| Lessac | female, US | high | [en_US-lessac-high](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/high) | [Blizzard 2013 license](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html) (non-commercial) |
| Ryan | male, US | high | [en_US-ryan-high](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/ryan/high) | CC BY-NC-SA 4.0 ([RyanSpeech](https://www.kaggle.com/datasets/roholazandie/ryanspeech)) |
| Amy | female, US | medium | [en_US-amy-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/amy/medium) | see [mimic3-voices](https://github.com/MycroftAI/mimic3-voices) |
| Kristin | female, US | medium | [en_US-kristin-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/kristin/medium) | public domain ([LibriVox](https://librivox.org)) |
| Joe | male, US | medium | [en_US-joe-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/joe/medium) | CC0 |
| Cori | female, British | high | [en_GB-cori-high](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/cori/high) | public domain ([LibriVox](https://librivox.org)) |
| Alan | male, British | medium | [en_GB-alan-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alan/medium) | see [mimic3-voices](https://github.com/MycroftAI/mimic3-voices) |
| Northern English | male, British | medium | [en_GB-northern_english_male-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/northern_english_male/medium) | CC BY-SA 4.0 ([OpenSLR 83](http://www.openslr.org/83/)) |
| Prudence | female, British, pragmatic | medium | [en_GB-semaine-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/semaine/medium) (speaker 0) | CC BY-NC-SA 4.0 ([SEMAINE](https://github.com/marytts/dfki-semaine-data)) |
| Poppy | female, British, cheerful | medium | same model, speaker 3 | CC BY-NC-SA 4.0 |
| Spike | male, British, aggressive | medium | same model, speaker 1 | CC BY-NC-SA 4.0 |
| Obadiah | male, British, gloomy | medium | same model, speaker 2 | CC BY-NC-SA 4.0 |

The voice models are **not** included in this repository. `setup.sh` downloads them from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices). Most of them were fine-tuned from the Lessac voice, whose dataset is licensed for non-commercial use only, and several have NC datasets of their own. This project is non-commercial: made by people, for people.

### Effects

| Effect | SoX chain |
|---|---|
| Chipmunk | `pitch 800 tempo 1.1` |
| Demon | `pitch -700 reverb 30` |
| Robot | `synth sine amod 40` (ring modulation) |
| Cathedral | `reverb 90 50 100 100 20` |
| Drunk | `tempo 0.85 chorus 0.6 0.9 50 0.4 0.25 2 -s` |
| Phone | `highpass 400 lowpass 3200 overdrive 4` |

SoX keeps the tail of a stream in its buffers until more input arrives. To flush it, the plugin pushes 0.6 s of silence after each utterance, which also lets reverb tails ring out.

### Commands

Command names follow the UI language:

| English | Polish | What it does |
|---|---|---|
| `/say text [voice] [effect]` | `/powiedz tekst [glos] [efekt]` | Speak a text, optionally with a one-off voice or effect |
| `/tts-voice [voice]` | `/glos [glos]` | Set the voice; with no argument, show the current one |
| `/tts-effect [effect]` | `/efekt [efekt]` | Set the effect; with no argument, show the current one |
| `/tts-tempo value` | `/tempo wartosc` | Set the tempo, 0.5 to 2 (lower is faster) |
| `/tts-stop` | `/cisza` | Stop speaking and clear the queue |

## Requirements

- Linux with PipeWire and `pipewire-pulse` (provides `pactl` and `pw-play`)
- `sox`
- Python 3 (for Piper's venv)
- Vencord [built from source](https://docs.vencord.dev/installing/) (userplugins require it)
- The official Discord desktop client. Vesktop and the web client also capture through PipeWire, so the virtual mic should work there too, but this is untested.

## Installation

```sh
git clone https://github.com/Srb404/vencord-tts-mic /path/to/Vencord/src/userplugins/ttsMic
/path/to/Vencord/src/userplugins/ttsMic/setup.sh   # all voices; or: setup.sh pl / setup.sh en
cd /path/to/Vencord && pnpm build && pnpm inject   # inject only on first install
```

`setup.sh` creates a venv with `piper-tts` and downloads the voices into `~/.local/share/vencord-tts` (60 to 115 MB per model: about 350 MB for Polish, 700 MB for English). Run it again with the other language at any time to add it.

The plugin must physically live in `src/userplugins`. A symlink won't work, because esbuild resolves it to the real path, where Vencord's `@api/...` import aliases don't apply.

Then:

1. **Fully restart Discord** (quit from the tray; a reload isn't enough, because `native.ts` runs in the main process).
2. Enable **TtsMic** in Vencord's plugin settings.
3. In Discord, go to *Voice & Video → Input Device* and select **Mikrofon TTS (Vencord)**.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Language | English | UI language: menu, commands, setting descriptions (English or Polish) |
| Voice languages | All | Show Polish voices, English voices or both |
| Voice | Lessac | Same as `/tts-voice` |
| Effect | none | Same as `/tts-effect` |
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

The code is [GPL-3.0-or-later](LICENSE), like Vencord, which this plugin is built against. The voice models are distributed separately under their own licenses (several of them non-commercial, see [Voices](#voices)). This is a non-commercial project.
