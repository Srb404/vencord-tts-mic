/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type VoiceLang = "pl" | "en";

export interface Voice {
    /** Piper model name, plus `#<speaker id>` for multi-speaker models */
    id: string;
    lang: VoiceLang;
    label: { en: string; pl: string; };
}

// keep in sync with setup.sh
export const VOICES: Voice[] = [
    { id: "pl_PL-gosia-medium", lang: "pl", label: { en: "Gosia (female)", pl: "Gosia (kobiecy)" } },
    { id: "pl_PL-darkman-medium", lang: "pl", label: { en: "Darkman (male)", pl: "Darkman (męski)" } },
    { id: "pl_PL-mc_speech-medium", lang: "pl", label: { en: "MC Speech (male)", pl: "MC Speech (męski)" } },
    { id: "pl_PL-bass-high", lang: "pl", label: { en: "Bass (male, deep, high quality)", pl: "Bass (męski, niski, wysoka jakość)" } },
    { id: "pl_PL-mls_6892-low", lang: "pl", label: { en: "MLS (male, low quality)", pl: "MLS (męski, niska jakość)" } },

    { id: "en_US-lessac-high", lang: "en", label: { en: "Lessac (female, US, high quality)", pl: "Lessac (kobiecy, USA, wysoka jakość)" } },
    { id: "en_US-ryan-high", lang: "en", label: { en: "Ryan (male, US, high quality)", pl: "Ryan (męski, USA, wysoka jakość)" } },
    { id: "en_US-amy-medium", lang: "en", label: { en: "Amy (female, US)", pl: "Amy (kobiecy, USA)" } },
    { id: "en_US-kristin-medium", lang: "en", label: { en: "Kristin (female, US)", pl: "Kristin (kobiecy, USA)" } },
    { id: "en_US-joe-medium", lang: "en", label: { en: "Joe (male, US)", pl: "Joe (męski, USA)" } },
    { id: "en_GB-cori-high", lang: "en", label: { en: "Cori (female, British, high quality)", pl: "Cori (kobiecy, brytyjski, wysoka jakość)" } },
    { id: "en_GB-alan-medium", lang: "en", label: { en: "Alan (male, British)", pl: "Alan (męski, brytyjski)" } },
    { id: "en_GB-northern_english_male-medium", lang: "en", label: { en: "Northern English (male)", pl: "Północna Anglia (męski)" } },
    { id: "en_GB-semaine-medium#0", lang: "en", label: { en: "Prudence (female, British, pragmatic)", pl: "Prudence (kobiecy, brytyjski, rzeczowy)" } },
    { id: "en_GB-semaine-medium#3", lang: "en", label: { en: "Poppy (female, British, cheerful)", pl: "Poppy (kobiecy, brytyjski, radosny)" } },
    { id: "en_GB-semaine-medium#1", lang: "en", label: { en: "Spike (male, British, aggressive)", pl: "Spike (męski, brytyjski, agresywny)" } },
    { id: "en_GB-semaine-medium#2", lang: "en", label: { en: "Obadiah (male, British, gloomy)", pl: "Obadiah (męski, brytyjski, ponury)" } }
];

export const DEFAULT_VOICE = "en_US-lessac-high";

export const modelOf = (voiceId: string) => voiceId.split("#")[0];

/** What a voice says in place of markup it can't read, plus the preview sentence. */
export const SPOKEN: Record<VoiceLang, { someone: string; channel: string; role: string; link: string; sample: string; }> = {
    en: { someone: "someone", channel: "channel", role: "role", link: "link", sample: "Hi, this is how this voice sounds. The quick brown fox jumps over the lazy dog." },
    pl: { someone: "ktoś", channel: "kanał", role: "rola", link: "link", sample: "Cześć, tak brzmi ten głos. Zażółć gęślą jaźń." }
};
