#!/usr/bin/env bash
# Installs Piper into a venv and downloads every Polish voice the plugin knows about.
set -euo pipefail

BASE="$HOME/.local/share/vencord-tts"
mkdir -p "$BASE/voices"

[ -x "$BASE/venv/bin/piper" ] || {
    python3 -m venv "$BASE/venv"
    "$BASE/venv/bin/pip" install -q piper-tts
}

for voice in pl_PL-gosia-medium pl_PL-darkman-medium pl_PL-mc_speech-medium pl_PL-bass-high pl_PL-mls_6892-low; do
    [ -f "$BASE/voices/$voice.onnx" ] || "$BASE/venv/bin/python" -m piper.download_voices --data-dir "$BASE/voices" "$voice"
done
