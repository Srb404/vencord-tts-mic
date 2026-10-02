# vencord-tts-mic

Vencord userplugin that turns typed text into speech on a virtual microphone, so you can "talk" in Discord voice channels by typing. Built for Polish (Piper voices), works offline.

The desktop Discord client captures audio natively, so the plugin can't inject audio from inside the page. Instead it creates a PipeWire virtual source, **Mikrofon TTS (Vencord)**, fed by the TTS output and (optionally) your real microphone.

## Features

- TTS mode toggle in the chat bar: messages sent while it's on are spoken instead of posted
- Right-click menu: voice, effect, tempo, volume, local monitoring, local-only preview, stop
- 5 Polish Piper voices: Gosia, Darkman, MC Speech, Bass, MLS
- Effects via sox: chipmunk, demon, robot, cathedral, drunk, phone
- Commands: `/powiedz tekst [glos] [efekt]`, `/glos`, `/efekt`, `/tempo`, `/cisza`

## Requirements

Linux with PipeWire (`pipewire-pulse`, `pactl`, `pw-play`), `sox`, Python 3, Vencord built from source.

## Install

```sh
git clone <this repo> /path/to/Vencord/src/userplugins/ttsMic
/path/to/Vencord/src/userplugins/ttsMic/setup.sh   # Piper venv + voices in ~/.local/share/vencord-tts
cd /path/to/Vencord && pnpm build
```

The plugin has to physically live in `src/userplugins`: a symlink doesn't work, because esbuild resolves it to the real path, where Vencord's `@api/...` aliases don't apply.

Fully restart Discord, enable **TtsMic** in Vencord settings, then pick **Mikrofon TTS (Vencord)** as the input device in Discord's voice settings.

## License

GPL-3.0-or-later, same as Vencord.
