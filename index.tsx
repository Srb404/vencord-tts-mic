/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { IconComponent, makeRange, OptionType, PluginNative } from "@utils/types";
import { ChannelStore, ContextMenuApi, FluxDispatcher, GuildMemberStore, Menu, UserStore, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.TtsMic as PluginNative<typeof import("./native")>;

const VOICES = [
    ["pl_PL-gosia-medium", "Gosia (kobiecy)"],
    ["pl_PL-darkman-medium", "Darkman (męski)"],
    ["pl_PL-mc_speech-medium", "MC Speech (męski)"],
    ["pl_PL-bass-high", "Bass (męski, niski, wysoka jakość)"],
    ["pl_PL-mls_6892-low", "MLS (męski, niska jakość)"]
] as const;

const EFFECTS = [
    ["none", "Bez efektu"],
    ["chipmunk", "Wiewiórka"],
    ["demon", "Demon"],
    ["robot", "Robot"],
    ["cathedral", "Katedra (echo)"],
    ["drunk", "Pijany"],
    ["phone", "Telefon"]
] as const;

const effectLabel = (id: string) => EFFECTS.find(([v]) => v === id)?.[1] ?? id;

const effectChoices = EFFECTS.map(([value, label]) => ({ name: value, displayName: label, label, value }));

const voiceLabel = (id: string) => VOICES.find(([v]) => v === id)?.[1] ?? id;

const voiceChoices = VOICES.map(([value, label]) => ({ name: value, displayName: label, label, value }));

const remountMic = () => Native.setupMic(settings.store.mixRealMic, settings.store.realMic.trim())
    .catch(e => console.error("[TtsMic] setupMic", e));

const settings = definePluginSettings({
    voice: {
        type: OptionType.SELECT,
        description: "Głos (Piper, offline)",
        options: VOICES.map(([value, label], i) => ({ label, value, default: i === 0 })),
        onChange: () => warmup()
    },
    effect: {
        type: OptionType.SELECT,
        description: "Efekt głosu",
        options: EFFECTS.map(([value, label], i) => ({ label, value, default: i === 0 }))
    },
    lengthScale: {
        type: OptionType.SLIDER,
        description: "Tempo: mniej = szybciej",
        markers: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        stickToMarkers: false,
        default: 1
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Głośność syntezy",
        markers: makeRange(0, 2, 0.25),
        stickToMarkers: false,
        default: 0.8
    },
    monitor: {
        type: OptionType.BOOLEAN,
        description: "Odtwarzaj też u siebie (słyszysz, co mówi TTS)",
        default: true
    },
    mixRealMic: {
        type: OptionType.BOOLEAN,
        description: "Domieszaj prawdziwy mikrofon do wirtualnego (możesz mówić normalnie i pisać)",
        default: true,
        onChange: remountMic
    },
    realMic: {
        type: OptionType.STRING,
        description: "Nazwa źródła PulseAudio prawdziwego mikrofonu (puste = domyślne, lista: pactl list short sources)",
        default: "",
        onChange: remountMic
    }
});

const voiceOpts = () => ({
    voice: settings.store.voice,
    lengthScale: settings.store.lengthScale,
    volume: settings.store.volume,
    monitor: settings.store.monitor,
    effect: settings.store.effect
});

const warmup = () => Native.warmup(voiceOpts()).catch(e => console.error("[TtsMic] warmup", e));

/** Raw message markup -> something a voice can read. */
function toSpeech(content: string, guildId?: string | null) {
    return content
        .replace(/<a?:(\w+):\d+>/g, "$1")
        .replace(/<@!?(\d+)>/g, (_, id) => {
            const user = UserStore.getUser(id);
            return (guildId && GuildMemberStore.getNick(guildId, id)) || user?.globalName || user?.username || "ktoś";
        })
        .replace(/<#(\d+)>/g, (_, id) => ChannelStore.getChannel(id)?.name ?? "kanał")
        .replace(/<@&\d+>/g, "rola")
        .replace(/https?:\/\/\S+/g, "link")
        .replace(/[*_~`|>]/g, "");
}

async function say(text: string, guildId?: string | null, voice?: string, effect?: string) {
    try {
        await Native.speak(toSpeech(text, guildId), { ...voiceOpts(), ...(voice && { voice }), ...(effect && { effect }) });
    } catch (e) {
        console.error("[TtsMic] speak", e);
    }
}

let ttsMode = false;

const SAMPLE = "Cześć, tak brzmi ten głos. Zażółć gęślą jaźń.";

function TtsMenu() {
    const s = settings.use(["voice", "effect", "lengthScale", "volume", "monitor"]);

    const slider = (id: string, label: string, key: "lengthScale" | "volume", min: number, max: number) => (
        <Menu.MenuControlItem
            id={id}
            label={label}
            control={(props, ref) => (
                <Menu.MenuSliderControl
                    {...props}
                    ref={ref}
                    minValue={min}
                    maxValue={max}
                    value={s[key]}
                    onChange={(v: number) => settings.store[key] = Math.round(v * 100) / 100}
                />
            )}
        />
    );

    return (
        <Menu.Menu
            navId="vc-tts-mic-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Mikrofon TTS"
        >
            <Menu.MenuGroup label="Głos">
                {VOICES.map(([value, label]) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-tts-voice-${value}`}
                        group="vc-tts-voice"
                        label={label}
                        checked={s.voice === value}
                        action={() => settings.store.voice = value}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-tts-effects" label={`Efekt: ${effectLabel(s.effect)}`}>
                {EFFECTS.map(([value, label]) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-tts-effect-${value}`}
                        group="vc-tts-effect"
                        label={label}
                        checked={s.effect === value}
                        action={() => settings.store.effect = value}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuSeparator />
            <Menu.MenuGroup>
                {slider("vc-tts-tempo", `Tempo (${s.lengthScale}, mniej = szybciej)`, "lengthScale", 0.5, 2)}
                {slider("vc-tts-volume", `Głośność (${s.volume})`, "volume", 0, 2)}
                <Menu.MenuCheckboxItem
                    id="vc-tts-monitor"
                    label="Słyszę TTS u siebie"
                    checked={s.monitor}
                    action={() => settings.store.monitor = !s.monitor}
                />
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="vc-tts-preview"
                label="Odsłuchaj próbkę (tylko u siebie)"
                action={() => Native.preview(SAMPLE, voiceOpts()).catch(e => console.error("[TtsMic] preview", e))}
            />
            <Menu.MenuItem
                id="vc-tts-stop"
                label="Przerwij czytanie"
                color="danger"
                action={() => Native.stopSpeaking()}
            />
        </Menu.Menu>
    );
}

const MicIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M12 2a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Zm-7 9a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 11Z" />
    </svg>
);

const TtsToggle: ChatBarButtonFactory = ({ isMainChat }) => {
    const [enabled, setEnabled] = useState(ttsMode);
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={enabled ? "Tryb TTS: wiadomości idą na mikrofon (PPM: głos i opcje)" : "Włącz tryb TTS (PPM: głos i opcje)"}
            onClick={() => {
                ttsMode = !enabled;
                setEnabled(ttsMode);
                if (ttsMode) warmup();
            }}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <TtsMenu />)}
        >
            <span style={{ display: "flex", color: enabled ? "var(--status-danger)" : undefined }}><MicIcon /></span>
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "TtsMic",
    description: "Wirtualny mikrofon czytający wpisany tekst polskim głosem (Piper). W Discordzie wybierz wejście „Mikrofon TTS (Vencord)”.",
    authors: [{ name: "srb", id: 0n }],
    settings,

    start() {
        remountMic();
    },

    stop() {
        ttsMode = false;
        Native.teardownMic().catch(() => { });
    },

    chatBarButton: {
        icon: MicIcon,
        render: TtsToggle
    },

    onBeforeMessageSend(channelId, msg) {
        if (!ttsMode || !msg.content.trim()) return;
        say(msg.content, ChannelStore.getChannel(channelId)?.guild_id);
        return { cancel: true };
    },

    commands: [
        {
            name: "powiedz",
            description: "Przeczytaj tekst na mikrofonie TTS",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "tekst",
                    description: "Tekst do przeczytania",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "glos",
                    description: "Jednorazowo innym głosem",
                    type: ApplicationCommandOptionType.STRING,
                    choices: voiceChoices
                },
                {
                    name: "efekt",
                    description: "Jednorazowo z innym efektem",
                    type: ApplicationCommandOptionType.STRING,
                    choices: effectChoices
                }
            ],
            execute: (args, { channel }) => {
                say(findOption(args, "tekst", ""), channel.guild_id, findOption(args, "glos", ""), findOption(args, "efekt", ""));
            }
        },
        {
            name: "efekt",
            description: "Zmień efekt głosu TTS (bez argumentu: pokaż aktualny)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "efekt",
                description: "Nowy efekt",
                type: ApplicationCommandOptionType.STRING,
                choices: effectChoices
            }],
            execute: (args, { channel }) => {
                const effect = findOption(args, "efekt", "");
                if (effect) {
                    settings.store.effect = effect as typeof settings.store.effect;
                    warmup();
                }
                sendBotMessage(channel.id, {
                    content: `${effect ? "Efekt ustawiony" : "Aktualny efekt"}: **${effectLabel(settings.store.effect)}**\nDostępne: ${EFFECTS.map(([, l]) => l).join(", ")}`
                });
            }
        },
        {
            name: "glos",
            description: "Zmień głos TTS (bez argumentu: pokaż aktualny)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "glos",
                description: "Nowy głos",
                type: ApplicationCommandOptionType.STRING,
                choices: voiceChoices
            }],
            execute: (args, { channel }) => {
                const voice = findOption(args, "glos", "");
                if (voice) {
                    settings.store.voice = voice as typeof settings.store.voice;
                    warmup();
                }
                sendBotMessage(channel.id, {
                    content: `${voice ? "Głos ustawiony" : "Aktualny głos"}: **${voiceLabel(settings.store.voice)}**\nDostępne: ${VOICES.map(([, l]) => l).join(", ")}`
                });
            }
        },
        {
            name: "tempo",
            description: "Zmień tempo TTS (0.5–2, mniej = szybciej)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "wartosc",
                description: "Np. 0.8 szybciej, 1.2 wolniej",
                type: ApplicationCommandOptionType.NUMBER,
                required: true
            }],
            execute: (args, { channel }) => {
                const value = Math.min(2, Math.max(0.5, Number(findOption(args, "wartosc", 1))));
                settings.store.lengthScale = value;
                warmup();
                sendBotMessage(channel.id, { content: `Tempo: **${value}**` });
            }
        },
        {
            name: "cisza",
            description: "Przerwij czytanie i wyczyść kolejkę TTS",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, { channel }) => {
                Native.stopSpeaking();
                sendBotMessage(channel.id, { content: "TTS przerwany." });
            }
        }
    ]
});
