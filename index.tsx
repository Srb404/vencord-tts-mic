/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, registerCommand, sendBotMessage, unregisterCommand } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import definePlugin, { IconComponent, makeRange, OptionType, PluginNative, PluginSettingComponentProps } from "@utils/types";
import { ChannelStore, ContextMenuApi, FluxDispatcher, GuildMemberStore, Menu, Select, showToast, useEffect, UserStore, useState } from "@webpack/common";

import { EFFECT_IDS, Lang, STRINGS } from "./i18n";
import { openVoiceManager } from "./VoiceManager";
import { DEFAULT_VOICE, modelOf, SPOKEN, VoiceLang, VOICES } from "./voices";

const Native = VencordNative.pluginHelpers.TtsMic as PluginNative<typeof import("./native")>;

/** Current UI strings; also usable before the plugin starts (settings page), hence the fallback. */
const t = () => {
    try {
        return STRINGS[settings.store.language as Lang] ?? STRINGS.en;
    } catch {
        return STRINGS.en;
    }
};

const lang = (): Lang => t() === STRINGS.pl ? "pl" : "en";

const voiceOf = (id: string) => VOICES.find(v => v.id === id);
const voiceLabel = (id: string) => voiceOf(id)?.label[lang()] ?? id;

/** Model names present in ~/.local/share/vencord-tts/voices; null until the first scan. */
let installed: Set<string> | null = null;

const refreshInstalled = () => Native.listVoices()
    .then(models => {
        installed = new Set(models);
        registerCommands();
    })
    .catch(e => console.error("[TtsMic] listVoices", e));

/** Voices allowed by the language filter and actually downloaded. */
function visibleVoices() {
    let filter = "all";
    try { filter = settings.store.voiceLanguages; } catch { }
    return VOICES.filter(v =>
        (filter === "all" || v.lang === filter) && (!installed || installed.has(modelOf(v.id))));
}

/** After hiding a language, move off a voice that is no longer listed. */
function ensureVisibleVoice() {
    const visible = visibleVoices();
    if (visible.length && !visible.some(v => v.id === settings.store.voice))
        settings.store.voice = visible[0].id;
}
const effectLabel = (id: string) => t().effects[id] ?? id;

const choices = (ids: readonly string[], label: (id: string) => string) =>
    ids.map(value => ({ name: value, displayName: label(value), label: label(value), value }));

const remountMic = () => Native.setupMic(settings.store.mixRealMic, settings.store.realMic.trim())
    .catch(e => console.error("[TtsMic] setupMic", e));

const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        description: "Language / Język (menu, commands, settings)",
        options: [
            { label: "English", value: "en", default: true },
            { label: "Polski", value: "pl" }
        ],
        onChange: () => registerCommands()
    },
    voiceLanguages: {
        type: OptionType.SELECT,
        get description() { return t().settings.voiceLanguages; },
        options: (["all", "pl", "en"] as const).map((value, i) => ({
            get label() { return t().voiceLanguages[value]; }, value, default: i === 0
        })),
        onChange: () => {
            ensureVisibleVoice();
            registerCommands();
        }
    },
    voice: {
        type: OptionType.SELECT,
        get description() { return t().settings.voice; },
        // getter, so the dropdown follows the language filter and what's installed
        get options() {
            return visibleVoices().map(v => ({ label: voiceLabel(v.id), value: v.id, default: v.id === DEFAULT_VOICE }));
        },
        onChange: () => warmup()
    },
    effect: {
        type: OptionType.SELECT,
        get description() { return t().settings.effect; },
        options: EFFECT_IDS.map((value, i) => ({ get label() { return effectLabel(value); }, value, default: i === 0 }))
    },
    lengthScale: {
        type: OptionType.SLIDER,
        get description() { return t().settings.lengthScale; },
        markers: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        stickToMarkers: false,
        default: 1
    },
    volume: {
        type: OptionType.SLIDER,
        get description() { return t().settings.volume; },
        markers: makeRange(0, 2, 0.25),
        stickToMarkers: false,
        default: 0.8
    },
    monitor: {
        type: OptionType.BOOLEAN,
        get description() { return t().settings.monitor; },
        default: true
    },
    mixRealMic: {
        type: OptionType.BOOLEAN,
        get description() { return t().settings.mixRealMic; },
        default: true,
        onChange: remountMic
    },
    realMic: {
        type: OptionType.COMPONENT,
        default: "",
        component: props => <RealMicPicker {...props} />,
        onChange: remountMic
    },
    voiceManager: {
        type: OptionType.COMPONENT,
        component: () => <Button onClick={openManager}>{t().manager.openButton}</Button>
    }
});

/** Picks the real mic from the capture devices PulseAudio knows, so there is no source name to mistype. */
function RealMicPicker({ setValue }: PluginSettingComponentProps) {
    const { realMic, mixRealMic } = settings.use(["realMic", "mixRealMic"]);
    const [sources, setSources] = useState<{ name: string; label: string; }[] | null>(null);
    const s = t().settings;

    useEffect(() => {
        Native.listSources().then(setSources).catch(e => {
            console.error("[TtsMic] listSources", e);
            setSources([]);
        });
    }, []);

    const options = [
        { label: s.realMicDefault, value: "" },
        ...(sources ?? []).map(src => ({ label: src.label, value: src.name }))
    ];
    // a saved mic that is unplugged right now stays listed, rather than looking like the default
    if (sources && realMic && !sources.some(src => src.name === realMic))
        options.push({ label: `${realMic} (${s.realMicMissing})`, value: realMic });

    return (
        <SettingsSection id="realMic" description={s.realMic}>
            <Select
                options={options}
                maxVisibleItems={5}
                closeOnSelect={true}
                select={setValue}
                isSelected={v => v === realMic}
                serialize={v => String(v)}
                isDisabled={!mixRealMic || !sources}
            />
        </SettingsSection>
    );
}

function openManager() {
    openVoiceManager({
        strings: t,
        lang,
        currentVoice: () => settings.store.voice,
        setVoice: id => settings.store.voice = id,
        volume: () => settings.store.volume,
        onChanged: () => refreshInstalled().then(ensureVisibleVoice)
    });
}

const hasVoices = () => !installed || installed.size > 0;

const voiceOpts = () => ({
    voice: settings.store.voice,
    lengthScale: settings.store.lengthScale,
    volume: settings.store.volume,
    monitor: settings.store.monitor,
    effect: settings.store.effect
});

const warmup = () => Native.warmup(voiceOpts()).catch(e => console.error("[TtsMic] warmup", e));

/** Raw message markup -> something a voice can read. */
function toSpeech(content: string, words: typeof SPOKEN[VoiceLang], guildId?: string | null) {
    return content
        .replace(/<a?:(\w+):\d+>/g, "$1")
        .replace(/<@!?(\d+)>/g, (_, id) => {
            const user = UserStore.getUser(id);
            return (guildId && GuildMemberStore.getNick(guildId, id)) || user?.globalName || user?.username || words.someone;
        })
        .replace(/<#(\d+)>/g, (_, id) => ChannelStore.getChannel(id)?.name ?? words.channel)
        .replace(/<@&\d+>/g, words.role)
        .replace(/https?:\/\/\S+/g, words.link)
        .replace(/[*_~`|>]/g, "");
}

async function say(text: string, guildId?: string | null, voice?: string, effect?: string) {
    const opts = { ...voiceOpts(), ...(voice && { voice }), ...(effect && { effect }) };
    const words = SPOKEN[voiceOf(opts.voice)?.lang ?? "en"];
    try {
        await Native.speak(toSpeech(text, words, guildId), opts);
    } catch (e) {
        console.error("[TtsMic] speak", e);
        showToast(`${t().manager.error}: ${(e as Error)?.message ?? e}`, "failure");
    }
}

let ttsMode = false;

function TtsMenu() {
    const s = settings.use(["voice", "effect", "lengthScale", "volume", "monitor", "language", "voiceLanguages"]);
    const m = t().menu;

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
            aria-label={m.title}
        >
            <Menu.MenuItem id="vc-tts-voices" label={`${m.voice}: ${voiceLabel(s.voice)}`}>
                {(["pl", "en"] as const).map(l => {
                    const voices = visibleVoices().filter(v => v.lang === l);
                    return voices.length > 0 && (
                        <Menu.MenuGroup key={l} label={m.langNames[l]}>
                            {voices.map(({ id }) => (
                                <Menu.MenuRadioItem
                                    key={id}
                                    id={`vc-tts-voice-${id}`}
                                    group="vc-tts-voice"
                                    label={voiceLabel(id)}
                                    checked={s.voice === id}
                                    action={() => settings.store.voice = id}
                                />
                            ))}
                        </Menu.MenuGroup>
                    );
                })}
            </Menu.MenuItem>
            <Menu.MenuItem id="vc-tts-effects" label={`${m.effect}: ${effectLabel(s.effect)}`}>
                {EFFECT_IDS.map(value => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-tts-effect-${value}`}
                        group="vc-tts-effect"
                        label={effectLabel(value)}
                        checked={s.effect === value}
                        action={() => settings.store.effect = value}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuSeparator />
            <Menu.MenuGroup>
                {slider("vc-tts-tempo", `${m.tempo} (${s.lengthScale}, ${m.tempoHint})`, "lengthScale", 0.5, 2)}
                {slider("vc-tts-volume", `${m.volume} (${s.volume})`, "volume", 0, 2)}
                <Menu.MenuCheckboxItem
                    id="vc-tts-monitor"
                    label={m.monitor}
                    checked={s.monitor}
                    action={() => settings.store.monitor = !s.monitor}
                />
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="vc-tts-preview"
                label={m.preview}
                action={() => Native.preview(SPOKEN[voiceOf(s.voice)?.lang ?? "en"].sample, voiceOpts()).catch(e => console.error("[TtsMic] preview", e))}
            />
            <Menu.MenuItem
                id="vc-tts-stop"
                label={m.stop}
                color="danger"
                action={() => Native.stopSpeaking()}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-tts-manage" label={m.manage} action={openManager} />
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
            tooltip={enabled ? t().tooltipOn : t().tooltipOff}
            onClick={() => {
                if (!enabled && !hasVoices()) {
                    showToast(t().manager.noVoice, "message");
                    return openManager();
                }
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

let registered: string[] = [];

function unregisterCommands() {
    registered.forEach(name => unregisterCommand(name));
    registered = [];
}

/** Commands are built per language, so switching it re-registers them under the new names. */
function registerCommands() {
    unregisterCommands();
    const { cmd, replies: r } = t();
    const voiceChoices = choices(visibleVoices().map(v => v.id), voiceLabel);
    const effectChoices = choices(EFFECT_IDS, effectLabel);

    const list = [
        {
            ...cmd.say,
            options: [
                { ...cmd.text, type: ApplicationCommandOptionType.STRING, required: true },
                { ...cmd.oneOffVoice, type: ApplicationCommandOptionType.STRING, choices: voiceChoices },
                { ...cmd.oneOffEffect, type: ApplicationCommandOptionType.STRING, choices: effectChoices }
            ],
            execute: (args, { channel }) => {
                say(findOption(args, cmd.text.name, ""), channel.guild_id,
                    findOption(args, cmd.oneOffVoice.name, ""), findOption(args, cmd.oneOffEffect.name, ""));
            }
        },
        {
            ...cmd.voice,
            options: [{ ...cmd.newVoice, type: ApplicationCommandOptionType.STRING, choices: voiceChoices }],
            execute: (args, { channel }) => {
                const voice = findOption(args, cmd.newVoice.name, "");
                if (voice) {
                    settings.store.voice = voice as typeof settings.store.voice;
                    warmup();
                }
                sendBotMessage(channel.id, {
                    content: `${voice ? r.voiceSet : r.voiceCurrent}: **${voiceLabel(settings.store.voice)}**\n${r.available}: ${visibleVoices().map(v => voiceLabel(v.id)).join(", ")}`
                });
            }
        },
        {
            ...cmd.effect,
            options: [{ ...cmd.newEffect, type: ApplicationCommandOptionType.STRING, choices: effectChoices }],
            execute: (args, { channel }) => {
                const effect = findOption(args, cmd.newEffect.name, "");
                if (effect) {
                    settings.store.effect = effect as typeof settings.store.effect;
                    warmup();
                }
                sendBotMessage(channel.id, {
                    content: `${effect ? r.effectSet : r.effectCurrent}: **${effectLabel(settings.store.effect)}**\n${r.available}: ${EFFECT_IDS.map(effectLabel).join(", ")}`
                });
            }
        },
        {
            ...cmd.tempo,
            options: [{ ...cmd.tempoValue, type: ApplicationCommandOptionType.NUMBER, required: true }],
            execute: (args, { channel }) => {
                const value = Math.min(2, Math.max(0.5, Number(findOption(args, cmd.tempoValue.name, 1))));
                settings.store.lengthScale = value;
                warmup();
                sendBotMessage(channel.id, { content: `${r.tempo}: **${value}**` });
            }
        },
        {
            ...cmd.stop,
            execute: (_, { channel }) => {
                Native.stopSpeaking();
                sendBotMessage(channel.id, { content: r.stopped });
            }
        }
    ] satisfies Omit<Parameters<typeof registerCommand>[0], "inputType">[];

    for (const command of list) {
        registerCommand({ ...command, inputType: ApplicationCommandInputType.BUILT_IN }, "TtsMic");
        registered.push(command.name);
    }
}

export default definePlugin({
    name: "TtsMic",
    description: "Virtual microphone that speaks what you type with a neural voice, Polish or English (Piper). In Discord, pick the input device \"TTS Microphone (Vencord)\".",
    authors: [{ name: "Srb404", id: 256522090134372362n }],
    settings,

    start() {
        remountMic();
        registerCommands();
        refreshInstalled();
    },

    stop() {
        unregisterCommands();
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
    }
});
