/*
 * Launch safety — relaunch budget, boot lock, Discord-running checks.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { REPO_SETTINGS_DIR } from "../utils/repoRoot";
import {
    ARTIFACTS,
    BOOT_LOCK_STALE_MS,
    RELAUNCH_BUDGET_MAX,
    RELAUNCH_BUDGET_WINDOW_MS,
    RELAUNCH_GUARD_MAX_AGE_MS,
    SESSION_MARKER_STALE_MS,
    UPDATE_LOCK_STALE_MS,
} from "./launchConstants";

const BUDGET_PATH = join(REPO_SETTINGS_DIR, ARTIFACTS.relaunchBudget);
const BOOT_LOCK_PATH = join(REPO_SETTINGS_DIR, ARTIFACTS.bootLock);

function isPidAlive(pid: number) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readTimestampFile(path: string) {
    try {
        return Number(readFileSync(path, "utf8").trim());
    } catch {
        return 0;
    }
}

/** True when any Discord.exe exists (for external tools: inject, preLaunchVerify). */
export function isDiscordRunning() {
    return countDiscordProcesses() > 0;
}

/**
 * True when another Discord instance besides this process is running.
 * Used inside Discord during bootstrap — we are always Discord.exe ourselves.
 */
export function isOtherDiscordRunning() {
    return countDiscordProcesses() > 1;
}

function countDiscordProcesses() {
    if (process.platform === "win32") {
        try {
            const out = execSync('tasklist /FI "IMAGENAME eq Discord.exe" /NH', {
                encoding: "utf8",
                shell: true,
            });
            return (out.match(/Discord\.exe/gi) ?? []).length;
        } catch {
            return 0;
        }
    }

    try {
        const out = execSync("pgrep -x Discord 2>/dev/null || true", {
            encoding: "utf8",
            shell: true,
        }).trim();
        if (!out) return 0;
        return out.split("\n").filter(Boolean).length;
    } catch {
        return 0;
    }
}

/** Remove only stale artifacts — never delete a fresh relaunch guard or session marker. */
export function sanitizeStaleLaunchArtifacts() {
    const cleaned: string[] = [];

    const tryClean = (path: string, name: string) => {
        if (!existsSync(path)) return;
        try {
            unlinkSync(path);
            cleaned.push(name);
        } catch { /* ignore */ }
    };

    const updateLock = join(REPO_SETTINGS_DIR, ARTIFACTS.updateLock);
    if (existsSync(updateLock)) {
        const [pidStr, timeStr] = readFileSync(updateLock, "utf8").trim().split(":");
        const age = Date.now() - Number(timeStr);
        if (!(isPidAlive(Number(pidStr)) && age < UPDATE_LOCK_STALE_MS)) {
            tryClean(updateLock, ARTIFACTS.updateLock);
        }
    }

    const guardPath = join(REPO_SETTINGS_DIR, ARTIFACTS.relaunchGuard);
    if (existsSync(guardPath)) {
        const written = readTimestampFile(guardPath);
        if (!written || Date.now() - written > RELAUNCH_GUARD_MAX_AGE_MS) {
            tryClean(guardPath, ARTIFACTS.relaunchGuard);
        }
    }

    const markerPath = join(REPO_SETTINGS_DIR, ARTIFACTS.sessionUpdated);
    if (existsSync(markerPath)) {
        const age = Date.now() - statSync(markerPath).mtimeMs;
        if (age > SESSION_MARKER_STALE_MS) {
            tryClean(markerPath, ARTIFACTS.sessionUpdated);
        }
    }

    if (existsSync(BOOT_LOCK_PATH)) {
        const [pidStr, timeStr] = readFileSync(BOOT_LOCK_PATH, "utf8").trim().split(":");
        const age = Date.now() - Number(timeStr);
        if (!(isPidAlive(Number(pidStr)) && age < BOOT_LOCK_STALE_MS)) {
            tryClean(BOOT_LOCK_PATH, ARTIFACTS.bootLock);
        }
    }

    if (cleaned.length) {
        console.log(`[Vencord] Cleaned stale launch artifacts: ${cleaned.join(", ")}`);
    }
}

export function acquireBootLock() {
    if (existsSync(BOOT_LOCK_PATH)) {
        const [pidStr, timeStr] = readFileSync(BOOT_LOCK_PATH, "utf8").trim().split(":");
        const age = Date.now() - Number(timeStr);
        if (age < BOOT_LOCK_STALE_MS && isPidAlive(Number(pidStr))) return false;
        try { unlinkSync(BOOT_LOCK_PATH); } catch { /* stale */ }
    }

    writeFileSync(BOOT_LOCK_PATH, `${process.pid}:${Date.now()}`);
    return true;
}

export function releaseBootLock() {
    if (!existsSync(BOOT_LOCK_PATH)) return;

    const [pidStr] = readFileSync(BOOT_LOCK_PATH, "utf8").trim().split(":");
    if (Number(pidStr) !== process.pid) return;

    try {
        unlinkSync(BOOT_LOCK_PATH);
    } catch { /* ignore */ }
}

function readBudget() {
    if (!existsSync(BUDGET_PATH)) return { count: 0, windowStart: 0 };
    try {
        return JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
    } catch {
        return { count: 0, windowStart: 0 };
    }
}

export function isRelaunchBudgetAvailable() {
    const budget = readBudget();
    const now = Date.now();
    if (!budget.windowStart || now - budget.windowStart > RELAUNCH_BUDGET_WINDOW_MS) return true;
    return budget.count < RELAUNCH_BUDGET_MAX;
}

export function recordRelaunchAttempt() {
    const now = Date.now();
    let budget = readBudget();

    if (!budget.windowStart || now - budget.windowStart > RELAUNCH_BUDGET_WINDOW_MS) {
        budget = { count: 0, windowStart: now };
    }

    budget.count += 1;
    writeFileSync(BUDGET_PATH, JSON.stringify(budget));
    return budget.count;
}

export function clearRelaunchBudget() {
    try {
        unlinkSync(BUDGET_PATH);
    } catch { /* ignore */ }
}

export function prepareBootstrapLock(): string | null {
    sanitizeStaleLaunchArtifacts();
    if (!acquireBootLock()) {
        return "another Vencord bootstrap is already in progress";
    }
    return null;
}

export function ensureColdStartSafe(): string | null {
    if (isOtherDiscordRunning()) {
        releaseBootLock();
        return "another Discord instance is already running — close all instances (system tray too), then launch once";
    }
    return null;
}

process.on("exit", () => releaseBootLock());
