/*
 * Cross-process mutex for git pull / build.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { ARTIFACTS, UPDATE_LOCK_STALE_MS } from "./launchConstants.mjs";

export function getLockPath(root) {
    return join(root, "settings", ARTIFACTS.updateLock);
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

export function acquireUpdateLock(root) {
    const lockPath = getLockPath(root);

    if (existsSync(lockPath)) {
        const [pidStr, timeStr] = readFileSync(lockPath, "utf8").trim().split(":");
        const pid = Number(pidStr);
        const age = Date.now() - Number(timeStr);

        if (age < UPDATE_LOCK_STALE_MS && isPidAlive(pid)) return false;
        try { unlinkSync(lockPath); } catch { /* stale */ }
    }

    writeFileSync(lockPath, `${process.pid}:${Date.now()}`);
    return true;
}

export function releaseUpdateLock(root) {
    const lockPath = getLockPath(root);
    if (!existsSync(lockPath)) return;

    const [pidStr] = readFileSync(lockPath, "utf8").trim().split(":");
    if (Number(pidStr) !== process.pid) return;

    try {
        unlinkSync(lockPath);
    } catch { /* already released */ }
}
