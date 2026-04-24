/**
 * Vencord Plugin — Quest Auto-Complete
 * ─────────────────────────────────────────────────────────────────────────────
 * Full quest lifecycle from one panel:
 *   • Browse & enroll in available quests (auto-starts on enroll)
 *   • WATCH_VIDEO / WATCH_VIDEO_ON_MOBILE — instant timestamp skip
 *   • PLAY_ON_DESKTOP / PLAY_ON_MOBILE / STREAM_ON_DESKTOP — real-time
 *     heartbeat loop with Rich Presence spoofing
 *   • Persists active game quests across Discord restarts
 *   • Optional auto-start of enrolled game quests on plugin load
 *   • Vencord notification on quest completion
 *
 * Bundled with this Vencord build (src/plugins/questAutoComplete).
 * SHORTCUT: Ctrl+Shift+Q (configurable) — open panel from anywhere
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Forms, React, showToast, Toasts } from "@webpack/common";

// ─── Settings ────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    keybind: {
        type:        OptionType.STRING,
        description: "Shortcut to open the quest panel from anywhere (e.g. Ctrl+Shift+Q)",
        default:     "Ctrl+Shift+Q",
    },
    autoStart: {
        type:        OptionType.BOOLEAN,
        description: "When Discord opens: restore game quests you had running last session, and if enabled start heartbeats for every other enrolled play/stream quest too",
        default:     false,
    },
    autoCompleteVideoOnEnroll: {
        type:        OptionType.BOOLEAN,
        description: "After you enroll in a quest, automatically run video progress for watch / mobile-watch quests",
        default:     true,
    },
    autoStartGameOnEnroll: {
        type:        OptionType.BOOLEAN,
        description: "After you enroll, automatically start the heartbeat loop for play / stream quests",
        default:     true,
    },
    verboseVideoToasts: {
        type:        OptionType.BOOLEAN,
        description: "Toast every video API error while progressing (off = only final errors and summaries)",
        default:     false,
    },
    toastOnComplete: {
        type:        OptionType.BOOLEAN,
        description: "Show a toast when a quest finishes",
        default:     true,
    },
    desktopNotifyOnComplete: {
        type:        OptionType.BOOLEAN,
        description: "Show a Vencord desktop notification when a quest finishes (image when available)",
        default:     true,
    },
    heartbeatIntervalSec: {
        type:          OptionType.SLIDER,
        description: "Seconds between heartbeats for play / stream quests (applies to newly started runs)",
        markers:       [15, 20, 30, 45, 60, 90, 120],
        default:       20,
        stickToMarkers: true,
    },
});

// ─── Constants ───────────────────────────────────────────────────────────────

const API            = "https://discord.com/api/v9";
const CDN            = "https://cdn.discordapp.com";
const VIDEO_STEP     = 15;
const VIDEO_DELAY_MS = 500;
const VIDEO_MAX_CONSECUTIVE_FAILURES = 3;

function getHeartbeatIntervalMs(): number {
    const sec = settings.store.heartbeatIntervalSec;
    return Math.max(10_000, Math.min(120_000, sec * 1000));
}

function parseRetryAfterMs(res: Response): number {
    const ra = res.headers.get("retry-after");
    if (!ra) return 5000;
    const sec = Number(ra);
    if (Number.isFinite(sec)) return Math.min(Math.max(sec * 1000, 1000), 120_000);
    return 5000;
}

async function sleep(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
}
const PERSIST_KEY = "QuestAutoComplete_v1";

const GAME_TASK_KEYS = ["PLAY_ON_DESKTOP", "PLAY_ON_MOBILE", "STREAM_ON_DESKTOP"] as const;
type GameTaskKey = typeof GAME_TASK_KEYS[number];

// ─── Lazy module refs ─────────────────────────────────────────────────────────

const TokenModule      = findByPropsLazy("getToken");
const SuperPropsModule = findByPropsLazy("getSuperPropertiesBase64");
const QuestsStore      = findByPropsLazy("getQuest");
const FluxDispatcher   = findByPropsLazy("dispatch", "subscribe");
const QuestsFetcher    = findByPropsLazy("fetchQuests");

// ─── Types ────────────────────────────────────────────────────────────────────

type LogEntry = { text: string; type: "info" | "success" | "error" };

interface GameRunner {
    questId:    string;
    questName:  string;
    appId:      string;
    appName:    string;
    taskKey:    GameTaskKey;
    target:     number;
    startValue: number;
    startedAt:  number;
    intervalId: ReturnType<typeof setInterval>;
    beats:      number;
    failed:     boolean;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const runners     = new Map<string, GameRunner>();
const logBus      = new Map<string, LogEntry[]>();
const videoRunning = new Set<string>(); // quest IDs currently mid-video-completion
let renderListeners: Array<() => void> = [];

// Presence override — set independently of quest runners
let presenceOverride: { appId: string; appName: string } | null = null;

// Detectable apps cache (fetched once from Discord's public endpoint)
let detectableApps: { id: string; name: string; icon?: string }[] = [];

function notify() { renderListeners.forEach(fn => fn()); }

function appendLog(questId: string, entry: LogEntry) {
    const arr = logBus.get(questId) ?? [];
    arr.push(entry);
    logBus.set(questId, arr);
    notify();
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function saveActiveQuests() {
    try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify([...runners.keys()]));
    } catch { /* non-fatal */ }
}

function loadActiveQuestIds(): string[] {
    try { return JSON.parse(localStorage.getItem(PERSIST_KEY) ?? "[]"); }
    catch { return []; }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getHeaders(): Record<string, string> {
    return {
        "Authorization":      TokenModule.getToken(),
        "Content-Type":       "application/json",
        "x-super-properties": SuperPropsModule.getSuperPropertiesBase64(),
        "x-discord-locale":   navigator.language || "en-US",
        "x-discord-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
        "x-debug-options":    "bugReporterEnabled",
    };
}

function fmt(secs: number): string {
    const s = Math.max(0, Math.floor(secs));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function questExpiresAtMs(quest: any): number {
    const exp = quest?.config?.expiresAt;
    if (!exp) return Number.POSITIVE_INFINITY;
    return new Date(exp).getTime();
}

function fmtExpiry(quest: any): string {
    const exp = quest?.config?.expiresAt;
    if (!exp) return "";
    const diff  = new Date(exp).getTime() - Date.now();
    if (diff < 0) return "Expired";
    const days  = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

/** Returns the quest hero image URL, falling back to app icon. */
function getQuestImage(quest: any): string | null {
    const hero = quest?.config?.assets?.hero;
    if (hero) return `${CDN}/${hero}`;
    const appId = quest?.config?.application?.id;
    const icon  = quest?.config?.application?.icon;
    if (appId && icon) return `${CDN}/app-icons/${appId}/${icon}.png?size=256`;
    return null;
}

/** Best-effort reward description from whatever field Discord uses. */
function getRewardText(quest: any): string | null {
    const msgs = quest?.config?.messages;
    return msgs?.questRewardDescription
        ?? msgs?.rewardDescription
        ?? msgs?.reward_description
        ?? null;
}

/** Short human label for what the quest requires, e.g. "Play 15:00". */
function getTaskLabel(quest: any): string {
    const t = quest?.config?.taskConfigV2?.tasks ?? {};
    if (t.WATCH_VIDEO)           return `Watch ${fmt(t.WATCH_VIDEO.target ?? 600)}`;
    if (t.WATCH_VIDEO_ON_MOBILE) return `Watch ${fmt(t.WATCH_VIDEO_ON_MOBILE.target ?? 600)}`;
    if (t.PLAY_ON_DESKTOP)       return `Play ${fmt(t.PLAY_ON_DESKTOP.target ?? 900)}`;
    if (t.PLAY_ON_MOBILE)        return `Play ${fmt(t.PLAY_ON_MOBILE.target ?? 900)}`;
    if (t.STREAM_ON_DESKTOP)     return `Stream ${fmt(t.STREAM_ON_DESKTOP.target ?? 900)}`;
    return "Complete";
}

function questName(quest: any): string {
    return quest?.config?.messages?.questName
        ?? quest?.config?.messages?.game_title
        ?? quest?.config?.application?.name
        ?? quest?.id;
}

function allQuests(): any[] {
    return QuestsStore.quests instanceof Map ? [...QuestsStore.quests.values()] : [];
}

function isExpired(q: any): boolean {
    return !q?.config?.expiresAt || new Date(q.config.expiresAt).getTime() <= Date.now();
}

// ─── Quest filters ────────────────────────────────────────────────────────────

function getVideoQuests(): any[] {
    return allQuests().filter(q =>
        !isExpired(q) && !q.userStatus?.completedAt && !!q.userStatus?.enrolledAt &&
        (q.config?.taskConfigV2?.tasks?.WATCH_VIDEO ||
         q.config?.taskConfigV2?.tasks?.WATCH_VIDEO_ON_MOBILE)
    );
}

function getGameQuests(): any[] {
    return allQuests().filter(q =>
        !isExpired(q) && !q.userStatus?.completedAt && !!q.userStatus?.enrolledAt &&
        GAME_TASK_KEYS.some(k => q.config?.taskConfigV2?.tasks?.[k])
    );
}

/** Quests in the local store that haven't been enrolled yet. */
function getUnenrolledQuests(): any[] {
    return allQuests().filter(q =>
        !isExpired(q) && !q.userStatus?.completedAt && !q.userStatus?.enrolledAt
    );
}

function resolveGameTask(quest: any): { key: GameTaskKey; config: any } | null {
    for (const key of GAME_TASK_KEYS) {
        const config = quest.config?.taskConfigV2?.tasks?.[key];
        if (config) return { key, config };
    }
    return null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

// Discord doesn't expose a bulk GET /quests endpoint — quest data arrives via
// the gateway READY event and lives in QuestsStore. We just re-read the store.

async function fetchDetectableApps(): Promise<{ id: string; name: string; icon?: string }[]> {
    if (detectableApps.length > 0) return detectableApps;
    const res = await fetch(`${API}/applications/detectable`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const list = await res.json() as any[];
    detectableApps = list
        .filter((a: any) => a?.id && a?.name)
        .map((a: any) => ({ id: a.id, name: a.name, icon: a.icon }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
    return detectableApps;
}

async function enrollInQuest(questId: string): Promise<boolean> {
    try {
        const res = await fetch(`${API}/quests/${questId}/enroll`, {
            method: "POST", credentials: "include", headers: getHeaders(),
        });
        return res.ok;
    } catch { return false; }
}

// ─── Video completion ─────────────────────────────────────────────────────────

async function completeOneVideoQuest(quest: any, onLog?: (e: LogEntry) => void): Promise<void> {
    const log = (text: string, type: LogEntry["type"] = "info", toastError = false) => {
        onLog?.({ text, type });
        if (type === "success" && settings.store.toastOnComplete)
            showToast(text, Toasts.Type.SUCCESS);
        if (type === "error" && (toastError || settings.store.verboseVideoToasts))
            showToast(text, Toasts.Type.FAILURE);
    };

    const questId = quest.id;
    const taskKey = quest.config?.taskConfigV2?.tasks?.WATCH_VIDEO ? "WATCH_VIDEO" : "WATCH_VIDEO_ON_MOBILE";
    const target  = quest.config.taskConfigV2.tasks[taskKey]?.target ?? 600;
    const name    = questName(quest);
    let current   = (quest.userStatus?.progress?.[taskKey]?.value ?? 0) + VIDEO_STEP;
    let failed    = false;
    let consecutiveFailures = 0;
    let hadSuccessfulRequest = false;

    videoRunning.add(questId);
    notify();

    try {
        while (current <= target + VIDEO_STEP && !failed) {
            const ts = Math.min(current, target);
            log(`${name}: ${ts}/${target}s`);
            try {
                const res = await fetch(`${API}/quests/${questId}/video-progress`, {
                    method: "POST", credentials: "include",
                    headers: getHeaders(), body: JSON.stringify({ timestamp: ts }),
                });
                if (res.ok) {
                    consecutiveFailures = 0;
                    hadSuccessfulRequest = true;
                } else if (res.status === 404) {
                    log(`${name}: endpoint not found.`, "error", true);
                    failed = true;
                    break;
                } else if (res.status === 429) {
                    const wait = parseRetryAfterMs(res);
                    log(`${name}: rate limited — waiting ${Math.round(wait / 1000)}s`, "info");
                    await sleep(wait);
                    continue;
                } else {
                    consecutiveFailures++;
                    const err = await res.json().catch(() => ({})) as any;
                    log(`${name} @ ${ts}s — ${res.status}: ${err.message ?? res.statusText}`, "error");
                }
            } catch (e: any) {
                consecutiveFailures++;
                log(`${name} — network error: ${e?.message}`, "error");
            }

            if (consecutiveFailures >= VIDEO_MAX_CONSECUTIVE_FAILURES) {
                log(`${name}: stopped after ${VIDEO_MAX_CONSECUTIVE_FAILURES} failed requests in a row.`, "error", true);
                break;
            }

            current += VIDEO_STEP;
            await sleep(VIDEO_DELAY_MS);
        }
    } finally {
        videoRunning.delete(questId);
        notify();
    }

    if (!failed && hadSuccessfulRequest) {
        onLog?.({ text: `${name} — done!`, type: "success" });
        fireCompletionNotification(name, getQuestImage(quest));
    } else if (!failed && !hadSuccessfulRequest) {
        log(`${name}: no successful API responses.`, "error", true);
    }
}

async function completeVideoQuests(onLog?: (e: LogEntry) => void): Promise<void> {
    const quests = getVideoQuests();
    if (!quests.length) {
        onLog?.({ text: "No active video quests found.", type: "error" });
        showToast("No enrolled video quests to complete.", Toasts.Type.MESSAGE);
        return;
    }
    showToast(`Running video progress for ${quests.length} quest(s)…`, Toasts.Type.MESSAGE);
    for (const quest of quests) await completeOneVideoQuest(quest, onLog);
}

// ─── Game heartbeat ───────────────────────────────────────────────────────────

function dispatchPresence(appId: string, appName: string) {
    try {
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: { application_id: appId, name: appName, type: 0, flags: 0 },
            socketId: "QuestAutoComplete",
        });
    } catch { /* non-fatal */ }
}

function applyPresence(appId: string, appName: string) {
    // Manual override always wins; quest presence is suppressed while it's active.
    if (presenceOverride) return;
    dispatchPresence(appId, appName);
}

function refreshPresence() {
    try {
        if (presenceOverride) {
            dispatchPresence(presenceOverride.appId, presenceOverride.appName);
        } else if (runners.size === 0) {
            FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: "QuestAutoComplete" });
        } else {
            const r = runners.values().next().value as GameRunner;
            dispatchPresence(r.appId, r.appName);
        }
    } catch { /* non-fatal */ }
}

function startGameQuest(quest: any): boolean {
    const questId = quest.id;
    if (runners.has(questId)) return false;
    const tc = resolveGameTask(quest);
    if (!tc) return false;

    const { key: taskKey, config: taskConfig } = tc;
    const target     = taskConfig.target ?? 900;
    const name       = questName(quest);
    const appId      = String(quest.config?.application?.id ?? "");
    const appName    = quest.config?.application?.name ?? name;
    const startValue = quest.userStatus?.progress?.[taskKey]?.value ?? 0;

    appendLog(questId, {
        text: `Started — ${fmt(startValue)} already credited, ${fmt(target - startValue)} remaining`,
        type: "info",
    });

    const sendHeartbeat = async () => {
        const runner = runners.get(questId);
        if (!runner) return;
        try {
            const res = await fetch(`${API}/quests/${questId}/heartbeat`, {
                method: "POST", credentials: "include",
                headers: getHeaders(), body: JSON.stringify({}),
            });
            if (res.ok) {
                runner.beats++;
                const elapsed = runner.startValue + Math.floor((Date.now() - runner.startedAt) / 1_000);
                appendLog(questId, { text: `Beat ${runner.beats} — ${fmt(elapsed)} / ${fmt(target)}`, type: "info" });
                if (elapsed >= target) {
                    stopGameQuest(questId);
                    fireCompletionNotification(name, getQuestImage(quest));
                    appendLog(questId, { text: `${name} — complete!`, type: "success" });
                }
            } else if (res.status === 429) {
                const wait = parseRetryAfterMs(res);
                appendLog(questId, { text: `Rate limited — retrying on next beat (~${Math.round(wait / 1000)}s)`, type: "info" });
            } else {
                runner.failed = true;
                const err = await res.json().catch(() => ({})) as any;
                appendLog(questId, { text: `Heartbeat failed ${res.status}: ${err.message ?? res.statusText}`, type: "error" });
                if (res.status === 400 || res.status === 404) stopGameQuest(questId);
            }
        } catch (e: any) {
            appendLog(questId, { text: `Network error: ${e?.message}`, type: "error" });
        }
        notify();
    };

    const intervalId = setInterval(sendHeartbeat, getHeartbeatIntervalMs());
    runners.set(questId, {
        questId, questName: name, appId, appName, taskKey,
        target, startValue, startedAt: Date.now(),
        intervalId, beats: 0, failed: false,
    });
    applyPresence(appId, appName);
    sendHeartbeat();
    saveActiveQuests();
    notify();
    return true;
}

function stopGameQuest(questId: string) {
    const runner = runners.get(questId);
    if (!runner) return;
    clearInterval(runner.intervalId);
    runners.delete(questId);
    appendLog(questId, { text: "Stopped.", type: "info" });
    refreshPresence();
    saveActiveQuests();
    notify();
}

function stopAllGameQuests() {
    [...runners.keys()].forEach(stopGameQuest);
}

// ─── Notifications ────────────────────────────────────────────────────────────

function fireCompletionNotification(name: string, image: string | null) {
    if (settings.store.toastOnComplete)
        showToast(`${name} — complete!`, Toasts.Type.SUCCESS);
    if (settings.store.desktopNotifyOnComplete) {
        showNotification({
            title: "Quest complete",
            body:  name,
            ...(image ? { image } : {}),
            color: "var(--green-360)",
            noPersist: false,
        });
    }
}

// ─── Keybind ──────────────────────────────────────────────────────────────────

function matchesKeybind(e: KeyboardEvent, bind: string): boolean {
    const parts = bind.toLowerCase().replace(/\s/g, "").split("+");
    const key   = parts[parts.length - 1];
    return (
        e.ctrlKey  === parts.includes("ctrl")  &&
        e.shiftKey === parts.includes("shift") &&
        e.altKey   === parts.includes("alt")   &&
        e.key.toLowerCase() === key
    );
}

function openQuestModal() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", width: "100%", padding: "16px 20px 12px" }}>
                    <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>Quest Auto-Complete</Forms.FormTitle>
                    <ModalCloseButton onClick={props.onClose} />
                </div>
            </ModalHeader>
            <ModalContent style={{ padding: "4px 20px 24px" }}>
                <QuestPanel />
            </ModalContent>
        </ModalRoot>
    ));
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function ProgressBar({ pct, done }: { pct: number; done?: boolean }) {
    return (
        <div style={{ height: "4px", borderRadius: "2px", background: "var(--background-modifier-accent)", marginTop: "5px" }}>
            <div style={{
                height: "100%", borderRadius: "2px",
                width: `${Math.min(100, pct)}%`,
                background: done ? "var(--green-360)" : "var(--brand-500)",
                transition: "width 1s linear",
            }} />
        </div>
    );
}

function LogBox({ entries }: { entries: LogEntry[] }) {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [entries.length]);
    if (!entries.length) return null;
    return (
        <div ref={ref} style={{
            marginTop: "6px", background: "var(--background-tertiary)",
            borderRadius: "4px", padding: "5px 9px", maxHeight: "120px",
            overflowY: "auto", fontFamily: "var(--font-code)", fontSize: "11px", lineHeight: "1.5",
        }}>
            {entries.slice(-14).map((e, i) => (
                <div key={i} style={{ color: e.type === "success" ? "var(--green-360)" : e.type === "error" ? "var(--red-400)" : "var(--text-muted)" }}>
                    {e.text}
                </div>
            ))}
        </div>
    );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

type QuestStatus = "available" | "video" | "game_idle" | "game_running" | "completed";

const STATUS_META: Record<QuestStatus, { label: string; bg: string; color: string }> = {
    available:    { label: "Available", bg: "var(--brand-500)",      color: "#fff" },
    video:        { label: "Video",     bg: "#5865f2",               color: "#fff" },
    game_idle:    { label: "Game",      bg: "rgba(255,255,255,0.15)", color: "#fff" },
    game_running: { label: "● Live",    bg: "var(--green-430)",      color: "#fff" },
    completed:    { label: "✓ Done",    bg: "var(--green-430)",      color: "#fff" },
};

function StatusPill({ status }: { status: QuestStatus }) {
    const m = STATUS_META[status];
    return (
        <div style={{
            position: "absolute", top: "7px", left: "8px",
            background: m.bg, color: m.color,
            fontSize: "9px", fontWeight: 700, letterSpacing: "0.5px",
            padding: "2px 7px", borderRadius: "3px",
            textTransform: "uppercase",
        }}>
            {m.label}
        </div>
    );
}

/** Quest card — banner, status pill, name, reward, expiry, inline content, action button. */
function QuestCard({
    quest, status, actionLabel, onAction, actionLoading, actionColor, children,
}: {
    quest: any;
    status?: QuestStatus;
    actionLabel?: string;
    onAction?: () => void;
    actionLoading?: boolean;
    actionColor?: string;
    children?: React.ReactNode;
}) {
    const img    = getQuestImage(quest);
    const name   = questName(quest);
    const reward = getRewardText(quest);
    const expiry = fmtExpiry(quest);
    const task   = getTaskLabel(quest);

    return (
        <div style={{
            borderRadius: "8px", overflow: "hidden",
            background: "var(--background-secondary)",
            marginBottom: "12px",
            border: "1px solid var(--background-modifier-accent)",
            opacity: status === "completed" ? 0.5 : 1,
        }}>
            {/* Banner */}
            <div style={{
                height: "88px",
                background: img
                    ? `url(${img}) center/cover no-repeat`
                    : "linear-gradient(135deg, var(--brand-500) 0%, var(--brand-360) 100%)",
                position: "relative",
            }}>
                {/* Gradient overlay so text is readable if placed over banner */}
                <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)",
                }} />
                {status && <StatusPill status={status} />}
                {expiry && (
                    <div style={{
                        position: "absolute", top: "7px", right: "8px",
                        background: "rgba(0,0,0,0.72)", color: "#fff",
                        fontSize: "10px", fontWeight: 600,
                        padding: "2px 7px", borderRadius: "4px",
                        letterSpacing: "0.2px",
                    }}>
                        {expiry}
                    </div>
                )}
                <div style={{
                    position: "absolute", bottom: "7px", left: "10px",
                    background: "rgba(0,0,0,0.65)", color: "var(--text-muted)",
                    fontSize: "10px", padding: "1px 6px", borderRadius: "3px",
                }}>
                    {task}
                </div>
            </div>

            {/* Body */}
            <div style={{ padding: "9px 12px 10px", display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Forms.FormText style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {name}
                    </Forms.FormText>
                    {reward && (
                        <Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                            🎁 {reward}
                        </Forms.FormText>
                    )}
                    {children}
                </div>
                {onAction && (
                    <Button
                        size={Button.Sizes.SMALL}
                        color={actionColor ?? Button.Colors.BRAND}
                        disabled={actionLoading}
                        onClick={onAction}
                        style={{ flexShrink: 0 }}
                    >
                        {actionLoading ? "…" : actionLabel}
                    </Button>
                )}
            </div>
        </div>
    );
}

// ─── Unified quest list ───────────────────────────────────────────────────────

function getQuestStatus(quest: any): QuestStatus {
    if (quest.userStatus?.completedAt) return "completed";
    if (!quest.userStatus?.enrolledAt) return "available";
    if (GAME_TASK_KEYS.some(k => quest.config?.taskConfigV2?.tasks?.[k]))
        return runners.has(quest.id) ? "game_running" : "game_idle";
    return "video";
}

function UnifiedQuestList() {
    const [, bump] = React.useReducer(n => n + 1, 0);
    const [enrollingId, setEnrollingId] = React.useState<string | null>(null);

    React.useEffect(() => {
        const timer = setInterval(bump, 1_000);
        renderListeners.push(bump);
        return () => { clearInterval(timer); renderListeners = renderListeners.filter(fn => fn !== bump); };
    }, []);

    const byExpiry = (a: any, b: any) => questExpiresAtMs(a) - questExpiresAtMs(b);

    const enroll = async (quest: any) => {
        setEnrollingId(quest.id);
        const ok = await enrollInQuest(quest.id);
        if (ok) {
            showToast(`Enrolled in ${questName(quest)}!`, Toasts.Type.SUCCESS);
            setTimeout(() => {
                try { QuestsFetcher.fetchQuests?.(); } catch { /* non-fatal */ }
                const videoQ = getVideoQuests().find(q => q.id === quest.id);
                const gameQ  = getGameQuests().find(q => q.id === quest.id);
                if (videoQ && settings.store.autoCompleteVideoOnEnroll)
                    completeOneVideoQuest(videoQ, e => appendLog(quest.id, e));
                else if (gameQ && settings.store.autoStartGameOnEnroll)
                    startGameQuest(gameQ);
                notify();
            }, 1_500);
        } else {
            showToast("Could not enroll — you may be ineligible or the quest ended.", Toasts.Type.FAILURE);
        }
        setEnrollingId(null);
    };

    function renderQuestRow(quest: any): React.ReactNode {
        const status = getQuestStatus(quest);

        if (status === "available") {
            return (
                <QuestCard quest={quest} status={status}
                    actionLabel="Enroll"
                    onAction={() => enroll(quest)}
                    actionLoading={enrollingId === quest.id}
                />
            );
        }

        if (status === "video") {
            const tk     = quest.config?.taskConfigV2?.tasks?.WATCH_VIDEO ? "WATCH_VIDEO" : "WATCH_VIDEO_ON_MOBILE";
            const target = quest.config?.taskConfigV2?.tasks?.[tk]?.target ?? 600;
            const cur    = quest.userStatus?.progress?.[tk]?.value ?? 0;
            const pct    = Math.round((cur / target) * 100);
            const isRun  = videoRunning.has(quest.id);
            return (
                <QuestCard quest={quest} status={status}
                    actionLabel={isRun ? "Running…" : "Run video"}
                    actionLoading={isRun}
                    onAction={isRun ? undefined : () => completeOneVideoQuest(quest, e => appendLog(quest.id, e))}
                >
                    <div style={{ marginTop: "5px" }}>
                        <Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {cur}/{target}s ({pct}%)
                        </Forms.FormText>
                        <ProgressBar pct={pct} done={pct >= 100} />
                    </div>
                    <LogBox entries={logBus.get(quest.id) ?? []} />
                </QuestCard>
            );
        }

        if (status === "game_idle" || status === "game_running") {
            const tc        = resolveGameTask(quest);
            const taskKey   = tc?.key ?? "PLAY_ON_DESKTOP";
            const target    = tc?.config?.target ?? 900;
            const saved     = quest.userStatus?.progress?.[taskKey]?.value ?? 0;
            const runner    = runners.get(quest.id);
            const isRun     = !!runner;
            const elapsed   = isRun ? saved + Math.floor((Date.now() - runner!.startedAt) / 1_000) : saved;
            const remaining = Math.max(0, target - elapsed);
            const pct       = Math.round((elapsed / target) * 100);
            const done      = pct >= 100;
            return (
                <QuestCard quest={quest} status={status}
                    actionLabel={isRun ? "Stop" : "Start"}
                    actionColor={isRun ? Button.Colors.RED : Button.Colors.BRAND}
                    onAction={() => isRun ? stopGameQuest(quest.id) : startGameQuest(quest)}
                >
                    <div style={{ marginTop: "5px" }}>
                        <Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {fmt(elapsed)} / {fmt(target)}
                            {isRun && !done && <span style={{ color: "var(--brand-500)", marginLeft: "6px" }}>{fmt(remaining)} left</span>}
                            {done && <span style={{ color: "var(--green-360)", marginLeft: "6px" }}>Done!</span>}
                        </Forms.FormText>
                        <ProgressBar pct={pct} done={done} />
                    </div>
                    {isRun && <LogBox entries={logBus.get(quest.id) ?? []} />}
                </QuestCard>
            );
        }

        return <QuestCard quest={quest} status="completed" />;
    }

    const active = allQuests().filter(q => !isExpired(q));
    const inProgress = active.filter(q => {
        const s = getQuestStatus(q);
        return s === "game_running" || (s === "video" && videoRunning.has(q.id));
    }).sort(byExpiry);

    const upcoming = active.filter(q => {
        const s = getQuestStatus(q);
        return s === "available" || (s === "video" && !videoRunning.has(q.id)) || s === "game_idle";
    }).sort(byExpiry);

    const completed = active.filter(q => getQuestStatus(q) === "completed").sort(byExpiry);

    if (!active.length) {
        return (
            <div style={{ textAlign: "center", padding: "20px 8px" }}>
                <Forms.FormText style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                    No active quests in your client right now.
                </Forms.FormText>
                <Forms.FormText style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                    Tap Refresh after Discord loads new promos, or check back when a quest event goes live.
                </Forms.FormText>
            </div>
        );
    }

    const section = (title: string, hint: string | undefined, ids: any[]) => ids.length > 0 && (
        <>
            <div style={{ marginTop: "18px", marginBottom: "8px" }}>
                <Forms.FormTitle tag="h5" style={{
                    margin: 0, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em",
                    color: "var(--header-secondary)",
                }}>
                    {title}
                </Forms.FormTitle>
                {hint && (
                    <Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                        {hint}
                    </Forms.FormText>
                )}
            </div>
            {ids.map(q => <React.Fragment key={q.id}>{renderQuestRow(q)}</React.Fragment>)}
        </>
    );

    return (
        <div>
            {section("In progress", "Video runs and live game heartbeats", inProgress)}
            {section("Next up", "Enroll or finish here — soonest expiry first", upcoming)}
            {section("Completed", "Finished in Discord; kept for reference", completed)}
        </div>
    );
}

// ─── Presence override section ────────────────────────────────────────────────

function PresenceOverrideSection() {
    const [, bump]       = React.useReducer(n => n + 1, 0);
    const [query,        setQuery]        = React.useState(presenceOverride?.appName ?? "");
    const [loadingApps,  setLoadingApps]  = React.useState(false);
    const [loadError,    setLoadError]    = React.useState<string | null>(null);
    const [localApps,    setLocalApps]    = React.useState<typeof detectableApps>(detectableApps);
    const [showDropdown, setShowDropdown] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        renderListeners.push(bump);
        return () => { renderListeners = renderListeners.filter(fn => fn !== bump); };
    }, []);

    // Load detectable apps on mount if not cached.
    React.useEffect(() => {
        if (detectableApps.length > 0) { setLocalApps(detectableApps); return; }
        setLoadingApps(true);
        fetchDetectableApps()
            .then(apps => setLocalApps(apps))
            .catch(e => setLoadError(e?.message ?? "Failed to load games"))
            .finally(() => setLoadingApps(false));
    }, []);

    const filtered = query.trim().length >= 2
        ? localApps.filter(a => a.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
        : [];

    const setOverride = (app: { id: string; name: string }) => {
        presenceOverride = { appId: app.id, appName: app.name };
        setQuery(app.name);
        setShowDropdown(false);
        dispatchPresence(app.id, app.name);
        showToast(`Presence set to ${app.name}`, Toasts.Type.SUCCESS);
        notify();
    };

    const clearOverride = () => {
        presenceOverride = null;
        setQuery("");
        refreshPresence();
        showToast("Presence override cleared", Toasts.Type.MESSAGE);
        notify();
    };

    const isActive = !!presenceOverride;

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <Forms.FormTitle style={{ margin: 0 }}>Presence Override</Forms.FormTitle>
                {isActive && (
                    <Button size={Button.Sizes.NONE} color={Button.Colors.RED} onClick={clearOverride}>
                        Clear
                    </Button>
                )}
            </div>
            <Forms.FormText style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "10px" }}>
                Spoof any game as your Discord status, independent of quests.
                {isActive && (
                    <span style={{ color: "var(--green-360)", marginLeft: "6px", fontWeight: 600 }}>
                        Active: {presenceOverride!.appName}
                    </span>
                )}
            </Forms.FormText>

            {loadError && (
                <Forms.FormText style={{ color: "var(--red-400)", fontSize: "12px", marginBottom: "8px" }}>
                    {loadError}
                </Forms.FormText>
            )}

            {/* Search input */}
            <div style={{ position: "relative" }}>
                <input
                    ref={inputRef}
                    value={query}
                    placeholder={loadingApps ? "Loading games…" : "Search games…"}
                    disabled={loadingApps}
                    onChange={e => { setQuery(e.currentTarget.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    style={{
                        width: "100%", boxSizing: "border-box",
                        background: "var(--background-secondary)",
                        border: "1px solid var(--background-modifier-accent)",
                        borderRadius: "4px",
                        color: "#fff",
                        padding: "8px 10px",
                        fontSize: "14px",
                        outline: "none",
                    }}
                />

                {/* Dropdown */}
                {showDropdown && filtered.length > 0 && (
                    <div style={{
                        position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 999,
                        background: "#2b2d31",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                        overflow: "hidden",
                    }}>
                        {filtered.map(app => (
                            <div
                                key={app.id}
                                onMouseDown={() => setOverride(app)}
                                style={{
                                    display: "flex", alignItems: "center", gap: "10px",
                                    padding: "8px 12px",
                                    cursor: "pointer",
                                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "")}
                            >
                                {app.icon && (
                                    <img
                                        src={`${CDN}/app-icons/${app.id}/${app.icon}.png?size=32`}
                                        style={{ width: "24px", height: "24px", borderRadius: "4px", flexShrink: 0 }}
                                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                )}
                                <span style={{ color: "#fff", fontSize: "13px" }}>{app.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Root panel ───────────────────────────────────────────────────────────────

function QuestPanel() {
    const [, bump] = React.useReducer(n => n + 1, 0);
    const [refreshing, setRefreshing] = React.useState(false);

    React.useEffect(() => {
        renderListeners.push(bump);
        return () => { renderListeners = renderListeners.filter(fn => fn !== bump); };
    }, []);

    const refresh = async () => {
        setRefreshing(true);
        try {
            await Promise.resolve(QuestsFetcher.fetchQuests?.());
            showToast("Synced quests from Discord", Toasts.Type.MESSAGE);
        } catch {
            showToast("Could not refresh quests", Toasts.Type.FAILURE);
        } finally {
            setRefreshing(false);
            notify();
        }
    };

    const liveBits = [
        runners.size > 0 && `${runners.size} game loop${runners.size === 1 ? "" : "s"}`,
        videoRunning.size > 0 && `${videoRunning.size} video run${videoRunning.size === 1 ? "" : "s"}`,
    ].filter(Boolean) as string[];
    const liveSummary = liveBits.length ? liveBits.join(" · ") : "Nothing running right now";

    return (
        <div style={{ padding: "8px 0" }}>
            <div style={{
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px",
                marginBottom: "12px", justifyContent: "space-between",
            }}>
                <Forms.FormText style={{ color: "var(--text-muted)", fontSize: "12px", margin: 0, flex: "1 1 200px" }}>
                    <kbd style={{
                        background: "var(--background-secondary)",
                        border: "1px solid var(--background-modifier-accent)",
                        borderRadius: "3px", padding: "1px 5px",
                        fontFamily: "var(--font-code)", fontSize: "11px",
                    }}>{settings.store.keybind}</kbd>
                    {" "}opens this panel from anywhere. Slash commands:{" "}
                    <span style={{ fontFamily: "var(--font-code)", fontSize: "11px" }}>/quests</span>
                    {", "}
                    <span style={{ fontFamily: "var(--font-code)", fontSize: "11px" }}>/completevideo</span>
                    .
                </Forms.FormText>
                <Button size={Button.Sizes.SMALL} disabled={refreshing} onClick={() => void refresh()}>
                    {refreshing ? "Refreshing…" : "Refresh"}
                </Button>
            </div>

            <div style={{
                fontSize: "12px", color: "var(--header-secondary)", marginBottom: "12px",
                padding: "8px 10px", borderRadius: "6px",
                background: "var(--background-secondary)",
                border: "1px solid var(--background-modifier-accent)",
            }}>
                {liveSummary}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                <Button
                    size={Button.Sizes.SMALL}
                    disabled={!getVideoQuests().length || videoRunning.size > 0}
                    onClick={() => completeVideoQuests().catch(e =>
                        showToast(e instanceof Error ? e.message : String(e), Toasts.Type.FAILURE))}
                >
                    All video quests
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => {
                        const list = getGameQuests().filter(q => !runners.has(q.id));
                        if (!list.length) {
                            showToast("No enrolled game quests to start.", Toasts.Type.MESSAGE);
                            return;
                        }
                        let n = 0;
                        for (const q of list) if (startGameQuest(q)) n++;
                        showToast(n ? `Started ${n} game quest(s)` : "Could not start (check each quest)", n ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE);
                    }}
                >
                    Start all games
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    disabled={runners.size === 0}
                    onClick={() => {
                        const n = runners.size;
                        stopAllGameQuests();
                        showToast(n ? `Stopped ${n} game loop(s)` : "Nothing to stop", Toasts.Type.MESSAGE);
                    }}
                >
                    Stop all games
                </Button>
            </div>

            <UnifiedQuestList />
            <div style={{ height: "1px", background: "var(--background-modifier-accent)", margin: "20px 0" }} />
            <PresenceOverrideSection />
        </div>
    );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

let keybindHandler: (e: KeyboardEvent) => void;

export default definePlugin({
    name:        "QuestAutoComplete",
    description: "Browse and finish Discord quests: watch-video progress, play/stream heartbeats, presence override, enroll shortcuts, and bulk actions",
    authors:     [Devs.Tar],
    tags:        ["Quests", "Utility"],
    enabledByDefault: true,

    settings,
    settingsAboutComponent: QuestPanel,

    toolboxActions: {
        "Quest Auto-Complete": openQuestModal,
    },

    start() {
        keybindHandler = (e: KeyboardEvent) => {
            if (matchesKeybind(e, settings.store.keybind)) {
                e.preventDefault();
                openQuestModal();
            }
        };
        window.addEventListener("keydown", keybindHandler);

        // Restore persisted runners + optionally auto-start enrolled quests.
        // Delay to let QuestsStore hydrate after Discord startup.
        setTimeout(() => {
            const persistedIds = loadActiveQuestIds();
            const gameQuests   = getGameQuests();

            for (const questId of persistedIds) {
                const quest = gameQuests.find(q => q.id === questId);
                if (quest && !runners.has(questId)) {
                    startGameQuest(quest);
                    appendLog(questId, { text: "Resumed after restart.", type: "info" });
                }
            }

            if (settings.store.autoStart) {
                for (const quest of gameQuests) {
                    if (!runners.has(quest.id)) startGameQuest(quest);
                }
            }
        }, 3_000);
    },

    stop() {
        window.removeEventListener("keydown", keybindHandler);
        stopAllGameQuests();
        presenceOverride = null;
        try { FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: "QuestAutoComplete" }); } catch { /* non-fatal */ }
    },

    commands: [
        {
            name:        "completevideo",
            description: "Send watch / mobile-watch progress for all enrolled video quests",
            execute: async () => {
                completeVideoQuests().catch(e =>
                    showToast(e instanceof Error ? e.message : String(e), Toasts.Type.FAILURE));
                return { content: "Video progress started — watch the toasts for results." };
            },
        },
        {
            name:        "startgamequests",
            description: "Start heartbeat loops for all enrolled game-play quests",
            execute: async () => {
                const quests = getGameQuests();
                if (!quests.length) return { content: "No active game quests found." };
                const started = quests.filter(q => startGameQuest(q)).length;
                return { content: `▶ Started ${started} game quest(s). Open plugin settings to monitor.` };
            },
        },
        {
            name:        "stopgamequests",
            description: "Stop all running game quest heartbeat loops",
            execute: async () => {
                const count = runners.size;
                if (!count) return { content: "No game quests currently running." };
                stopAllGameQuests();
                return { content: `⏹ Stopped ${count} game quest(s).` };
            },
        },
        {
            name:        "quests",
            description: "Open the Quest Auto-Complete panel (same as the keybind)",
            execute: async () => {
                openQuestModal();
                return { content: "Opened the quest panel." };
            },
        },
    ],
});
