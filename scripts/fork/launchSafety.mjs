/*
 * Launch safety utilities — shared by startupUpdate and preLaunchVerify.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import {
    ARTIFACTS,
    BOOT_LOCK_STALE_MS,
    RELAUNCH_BUDGET_MAX,
    RELAUNCH_BUDGET_WINDOW_MS,
    RELAUNCH_GUARD_MAX_AGE_MS,
    SESSION_MARKER_STALE_MS,
    UPDATE_LOCK_STALE_MS,
} from "./launchConstants.mjs";

function settingsDir(root) {
    return join(root, "settings");
}

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readTimestampFile(path) {
    try {
        return Number(readFileSync(path, "utf8").trim());
    } catch {
        return 0;
    }
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

/** External tools (inject, verify): any Discord.exe running. */
export function isDiscordRunning() {
    return countDiscordProcesses() > 0;
}

export function sanitizeStaleLaunchArtifacts(root) {
    const dir = settingsDir(root);
    const cleaned = [];

    const tryClean = (path, name) => {
        if (!existsSync(path)) return;
        try {
            unlinkSync(path);
            cleaned.push(name);
        } catch { /* ignore */ }
    };

    const updateLock = join(dir, ARTIFACTS.updateLock);
    if (existsSync(updateLock)) {
        const [pidStr, timeStr] = readFileSync(updateLock, "utf8").trim().split(":");
        const age = Date.now() - Number(timeStr);
        if (!(isPidAlive(Number(pidStr)) && age < UPDATE_LOCK_STALE_MS)) {
            tryClean(updateLock, ARTIFACTS.updateLock);
        }
    }

    const guardPath = join(dir, ARTIFACTS.relaunchGuard);
    if (existsSync(guardPath)) {
        const written = readTimestampFile(guardPath);
        if (!written || Date.now() - written > RELAUNCH_GUARD_MAX_AGE_MS) {
            tryClean(guardPath, ARTIFACTS.relaunchGuard);
        }
    }

    const markerPath = join(dir, ARTIFACTS.sessionUpdated);
    if (existsSync(markerPath)) {
        const age = Date.now() - statSync(markerPath).mtimeMs;
        if (age > SESSION_MARKER_STALE_MS) {
            tryClean(markerPath, ARTIFACTS.sessionUpdated);
        }
    }

    const bootLock = join(dir, ARTIFACTS.bootLock);
    if (existsSync(bootLock)) {
        const [pidStr, timeStr] = readFileSync(bootLock, "utf8").trim().split(":");
        const age = Date.now() - Number(timeStr);
        if (!(isPidAlive(Number(pidStr)) && age < BOOT_LOCK_STALE_MS)) {
            tryClean(bootLock, ARTIFACTS.bootLock);
        }
    }

    if (cleaned.length) {
        console.log(`[Vencord] Cleaned stale launch artifacts: ${cleaned.join(", ")}`);
    }

    return cleaned;
}

function readBudget(root) {
    const path = join(settingsDir(root), ARTIFACTS.relaunchBudget);
    if (!existsSync(path)) return { count: 0, windowStart: 0 };

    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return { count: 0, windowStart: 0 };
    }
}

export function isRelaunchBudgetAvailable(root) {
    const budget = readBudget(root);
    const now = Date.now();

    if (!budget.windowStart || now - budget.windowStart > RELAUNCH_BUDGET_WINDOW_MS) {
        return true;
    }

    return budget.count < RELAUNCH_BUDGET_MAX;
}

export function clearRelaunchBudget(root) {
    try {
        unlinkSync(join(settingsDir(root), ARTIFACTS.relaunchBudget));
    } catch { /* ignore */ }
}
