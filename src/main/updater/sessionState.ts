/*
 * Single-session update state for the main process.
 * At most one pull+build per Discord process; launch update takes priority over renderer auto-update.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { REPO_SETTINGS_DIR } from "../utils/repoRoot";
import { ARTIFACTS, UPDATE_LOCK_STALE_MS } from "./launchConstants";

const LOCK_PATH = join(REPO_SETTINGS_DIR, ARTIFACTS.updateLock);

function isPidAlive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** File lock shared with scripts/fork/startupUpdate.mjs */
export function acquireUpdateLock() {
    if (existsSync(LOCK_PATH)) {
        const [pidStr, timeStr] = readFileSync(LOCK_PATH, "utf8").trim().split(":");
        const pid = Number(pidStr);
        const age = Date.now() - Number(timeStr);

        if (age < UPDATE_LOCK_STALE_MS && isPidAlive(pid)) return false;
        try { unlinkSync(LOCK_PATH); } catch { /* stale */ }
    }

    writeFileSync(LOCK_PATH, `${process.pid}:${Date.now()}`);
    return true;
}

export function releaseUpdateLock() {
    if (!existsSync(LOCK_PATH)) return;

    const [pidStr] = readFileSync(LOCK_PATH, "utf8").trim().split(":");
    if (Number(pidStr) !== process.pid) return;

    try {
        unlinkSync(LOCK_PATH);
    } catch { /* already released */ }
}

export interface UpdateSessionState {
    launchUpdateRan: boolean;
    updatedThisSession: boolean;
    updateInProgress: boolean;
}

let launchUpdateRan = false;
let updatedThisSession = false;
let updateInProgress = false;

export function markLaunchUpdateRan() {
    launchUpdateRan = true;
}

/** @deprecated use getUpdateSession().launchUpdateRan */
export function didRunLaunchUpdate() {
    return launchUpdateRan;
}

export function markUpdatedThisSession() {
    updatedThisSession = true;
    launchUpdateRan = true;
}

export function getUpdateSession(): UpdateSessionState {
    return { launchUpdateRan, updatedThisSession, updateInProgress };
}

/** Renderer auto-update on init — only when launch update did not run. */
export function canAutoApplyUpdates() {
    return !launchUpdateRan && !updatedThisSession && !updateInProgress;
}

/**
 * @param manual Manual updater tab / support helper — allowed after launch check if not yet updated.
 */
export function tryBeginUpdate(manual = false) {
    if (updateInProgress || updatedThisSession) return false;
    if (!manual && launchUpdateRan) return false;

    updateInProgress = true;
    return true;
}

export function finishUpdate(success: boolean) {
    updateInProgress = false;
    if (success) updatedThisSession = true;
}
