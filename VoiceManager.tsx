/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Forms, Modal, openModal, showToast, Toasts, useEffect, useState } from "@webpack/common";

import { Strings } from "./i18n";
import { MODEL_SIZE_MB, modelOf, VoiceLang,VOICES } from "./voices";

const Native = VencordNative.pluginHelpers.TtsMic as PluginNative<typeof import("./native")>;

type Status = Awaited<ReturnType<typeof Native.getStatus>>;

export interface ManagerContext {
    strings: () => Strings;
    lang: () => "en" | "pl";
    currentVoice: () => string;
    setVoice: (id: string) => void;
    volume: () => number;
    /** called after anything was downloaded or deleted */
    onChanged: () => void;
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--background-modifier-accent)" };
const muted: React.CSSProperties = { color: "var(--text-muted)", fontSize: 12 };

function useStatus() {
    const [status, setStatus] = useState<Status | null>(null);
    useEffect(() => {
        let alive = true;
        const tick = () => Native.getStatus().then(s => alive && setStatus(s));
        tick();
        // polling is cheap (a readdir) and keeps download progress live
        const id = setInterval(tick, 500);
        return () => {
            alive = false;
            clearInterval(id);
            Native.stopSample();
        };
    }, []);
    return status;
}

function VoiceManager({ rootProps, ctx }: { rootProps: RenderModalProps; ctx: ManagerContext; }) {
    const status = useStatus();
    const [, rerender] = useState(0);
    const m = ctx.strings().manager;
    const { langNames } = ctx.strings().menu;

    const fail = (e: unknown) => showToast(`${m.error}: ${(e as Error)?.message ?? e}`, Toasts.Type.FAILURE);

    const installedModels = new Set(status?.installed ?? []);
    const installedMB = [...installedModels].reduce((sum, model) => sum + (MODEL_SIZE_MB[model] ?? 0), 0);

    const download = (model: string) => Native.downloadVoice(model)
        .then(() => {
            ctx.onChanged();
            // first voice ever, or the current one isn't on disk: switch to what was just downloaded
            if (!installedModels.has(modelOf(ctx.currentVoice()))) ctx.setVoice(VOICES.find(v => modelOf(v.id) === model)!.id);
        })
        .catch(fail);

    const remove = (model: string) => {
        Native.deleteVoice(model).then(ctx.onChanged).catch(fail);
    };

    const voiceRow = (id: string, label: string) => {
        const model = modelOf(id);
        const isInstalled = installedModels.has(model);
        const progress = status?.downloads[model];
        const shared = VOICES.filter(v => modelOf(v.id) === model).length > 1;
        const isCurrent = ctx.currentVoice() === id;

        return (
            <div key={id} style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "var(--text-default)" }}>{label}</div>
                    <div style={muted}>{MODEL_SIZE_MB[model]} MB{shared ? ` · ${m.sharedModel}` : ""}</div>
                </div>
                <Button size="small" variant="secondary" onClick={() => Native.playSample(id, ctx.volume()).catch(fail)}>
                    ▶ {m.sample}
                </Button>
                {progress !== undefined ? (
                    <Button size="small" variant="dangerSecondary" onClick={() => Native.cancelDownload(model)}>
                        {Math.round(progress * 100)}% · {m.cancel}
                    </Button>
                ) : isInstalled ? (
                    <>
                        <Button size="small" variant={isCurrent ? "positive" : "primary"} disabled={isCurrent}
                            onClick={() => { ctx.setVoice(id); rerender(x => x + 1); }}>
                            {isCurrent ? m.inUse : m.use}
                        </Button>
                        <Button size="small" variant="dangerSecondary" onClick={() => remove(model)}>{m.remove}</Button>
                    </>
                ) : (
                    <Button size="small" variant="primary" onClick={() => download(model)}>
                        {m.download}
                    </Button>
                )}
            </div>
        );
    };

    return (
        <Modal {...rootProps} title={m.title} subtitle={m.subtitle} size="md">
            <div style={{ ...row, borderBottom: "none" }}>
                <div style={{ flex: 1 }}>
                    <div style={{ color: "var(--text-default)" }}>{m.engine}</div>
                    <div style={muted}>{status?.engineError ?? m.engineHint}</div>
                </div>
                {status?.engine ? (
                    <span style={{ color: "var(--text-positive)" }}>✓ {m.engineReady}</span>
                ) : (
                    <Button size="small" disabled={!status || status.engineInstalling} onClick={() => Native.installEngine().catch(fail)}>
                        {status?.engineInstalling ? m.installing : m.installEngine}
                    </Button>
                )}
            </div>

            {(["pl", "en"] as VoiceLang[]).map(l => (
                <section key={l} style={{ marginTop: 16 }}>
                    <Forms.FormTitle tag="h3">{langNames[l]}</Forms.FormTitle>
                    {VOICES.filter(v => v.lang === l).map(v => voiceRow(v.id, v.label[ctx.lang()]))}
                </section>
            ))}

            <div style={{ ...muted, marginTop: 12 }}>{m.installedTotal.replace("{n}", String(installedMB))}</div>
        </Modal>
    );
}

export function openVoiceManager(ctx: ManagerContext) {
    openModal(props => <VoiceManager rootProps={props} ctx={ctx} />);
}
