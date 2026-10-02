/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Lang = "en" | "pl";

export const EFFECT_IDS = ["none", "chipmunk", "demon", "robot", "cathedral", "drunk", "phone"] as const;

const en = {
    effects: {
        none: "No effect",
        chipmunk: "Chipmunk",
        demon: "Demon",
        robot: "Robot",
        cathedral: "Cathedral (echo)",
        drunk: "Drunk",
        phone: "Phone"
    },

    settings: {
        voice: "Voice (Piper, offline)",
        voiceLanguages: "Voice languages to show (in the menu, commands and here)",
        effect: "Voice effect",
        lengthScale: "Tempo: lower = faster",
        volume: "Speech volume",
        monitor: "Also play locally (hear what the TTS says)",
        mixRealMic: "Mix your real microphone into the virtual one (talk and type at the same time)",
        realMic: "PulseAudio source name of your real microphone (empty = default, list: pactl list short sources)"
    },

    menu: {
        title: "TTS microphone",
        voice: "Voice",
        effect: "Effect",
        tempo: "Tempo",
        tempoHint: "lower = faster",
        langNames: { pl: "Polish", en: "English" },
        volume: "Volume",
        monitor: "Hear TTS locally",
        preview: "Preview sample (only you hear it)",
        stop: "Stop speaking"
    },
    voiceLanguages: { all: "All", pl: "Polish only", en: "English only" },
    tooltipOn: "TTS mode: messages go to the microphone (right-click: voice and options)",
    tooltipOff: "Enable TTS mode (right-click: voice and options)",

    cmd: {
        say: { name: "say", description: "Speak text on the TTS microphone" },
        text: { name: "text", description: "Text to speak" },
        oneOffVoice: { name: "voice", description: "Use a different voice this once" },
        oneOffEffect: { name: "effect", description: "Use a different effect this once" },
        voice: { name: "tts-voice", description: "Change the TTS voice (no argument: show the current one)" },
        newVoice: { name: "voice", description: "New voice" },
        effect: { name: "tts-effect", description: "Change the TTS effect (no argument: show the current one)" },
        newEffect: { name: "effect", description: "New effect" },
        tempo: { name: "tts-tempo", description: "Change the TTS tempo (0.5–2, lower = faster)" },
        tempoValue: { name: "value", description: "E.g. 0.8 faster, 1.2 slower" },
        stop: { name: "tts-stop", description: "Stop speaking and clear the TTS queue" }
    },
    replies: {
        voiceSet: "Voice set",
        voiceCurrent: "Current voice",
        effectSet: "Effect set",
        effectCurrent: "Current effect",
        available: "Available",
        tempo: "Tempo",
        stopped: "TTS stopped."
    }
};

export type Strings = typeof en;

const pl: Strings = {
    effects: {
        none: "Bez efektu",
        chipmunk: "Wiewiórka",
        demon: "Demon",
        robot: "Robot",
        cathedral: "Katedra (echo)",
        drunk: "Pijany",
        phone: "Telefon"
    },

    settings: {
        voice: "Głos (Piper, offline)",
        voiceLanguages: "Języki głosów do pokazania (w menu, komendach i tutaj)",
        effect: "Efekt głosu",
        lengthScale: "Tempo: mniej = szybciej",
        volume: "Głośność syntezy",
        monitor: "Odtwarzaj też u siebie (słyszysz, co mówi TTS)",
        mixRealMic: "Domieszaj prawdziwy mikrofon do wirtualnego (możesz mówić normalnie i pisać)",
        realMic: "Nazwa źródła PulseAudio prawdziwego mikrofonu (puste = domyślne, lista: pactl list short sources)"
    },

    menu: {
        title: "Mikrofon TTS",
        voice: "Głos",
        effect: "Efekt",
        tempo: "Tempo",
        tempoHint: "mniej = szybciej",
        langNames: { pl: "Polskie", en: "Angielskie" },
        volume: "Głośność",
        monitor: "Słyszę TTS u siebie",
        preview: "Odsłuchaj próbkę (tylko u siebie)",
        stop: "Przerwij czytanie"
    },
    voiceLanguages: { all: "Wszystkie", pl: "Tylko polskie", en: "Tylko angielskie" },
    tooltipOn: "Tryb TTS: wiadomości idą na mikrofon (PPM: głos i opcje)",
    tooltipOff: "Włącz tryb TTS (PPM: głos i opcje)",

    cmd: {
        say: { name: "powiedz", description: "Przeczytaj tekst na mikrofonie TTS" },
        text: { name: "tekst", description: "Tekst do przeczytania" },
        oneOffVoice: { name: "glos", description: "Jednorazowo innym głosem" },
        oneOffEffect: { name: "efekt", description: "Jednorazowo z innym efektem" },
        voice: { name: "glos", description: "Zmień głos TTS (bez argumentu: pokaż aktualny)" },
        newVoice: { name: "glos", description: "Nowy głos" },
        effect: { name: "efekt", description: "Zmień efekt głosu TTS (bez argumentu: pokaż aktualny)" },
        newEffect: { name: "efekt", description: "Nowy efekt" },
        tempo: { name: "tempo", description: "Zmień tempo TTS (0.5–2, mniej = szybciej)" },
        tempoValue: { name: "wartosc", description: "Np. 0.8 szybciej, 1.2 wolniej" },
        stop: { name: "cisza", description: "Przerwij czytanie i wyczyść kolejkę TTS" }
    },
    replies: {
        voiceSet: "Głos ustawiony",
        voiceCurrent: "Aktualny głos",
        effectSet: "Efekt ustawiony",
        effectCurrent: "Aktualny efekt",
        available: "Dostępne",
        tempo: "Tempo",
        stopped: "TTS przerwany."
    }
};

export const STRINGS: Record<Lang, Strings> = { en, pl };
