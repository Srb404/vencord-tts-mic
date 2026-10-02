#!/usr/bin/env bash
# Optional: the plugin's voice manager does the same from inside Discord.
# Installs Piper into a venv and, if languages are given, downloads all their voices.
# Usage: ./setup.sh [pl] [en]   (no arguments = engine only)
set -euo pipefail

BASE="$HOME/.local/share/vencord-tts"

# keep in sync with voices.ts
PL_VOICES=(pl_PL-gosia-medium pl_PL-darkman-medium pl_PL-mc_speech-medium pl_PL-bass-high pl_PL-mls_6892-low)
EN_VOICES=(en_US-lessac-high en_US-ryan-high en_US-amy-medium en_US-kristin-medium en_US-joe-medium
           en_GB-cori-high en_GB-alan-medium en_GB-northern_english_male-medium en_GB-semaine-medium)

voices=()
for lang in "$@"; do
    case "$lang" in
        pl) voices+=("${PL_VOICES[@]}") ;;
        en) voices+=("${EN_VOICES[@]}") ;;
        *) echo "unknown language: $lang (use pl and/or en)" >&2; exit 1 ;;
    esac
done

mkdir -p "$BASE/voices"

[ -x "$BASE/venv/bin/piper" ] || {
    python3 -m venv "$BASE/venv"
    "$BASE/venv/bin/pip" install -q "piper-tts==1.8.0"  # keep in sync with PIPER_PACKAGE in native.ts
}

for voice in "${voices[@]}"; do
    [ -f "$BASE/voices/$voice.onnx" ] || "$BASE/venv/bin/python" -m piper.download_voices --data-dir "$BASE/voices" "$voice"
done
