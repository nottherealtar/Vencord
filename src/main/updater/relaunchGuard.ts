/*
 * One-shot guard so post-update relaunch never loops back into pull/rebuild.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { REPO_SETTINGS_DIR } from "../utils/repoRoot";
import { ARTIFACTS, POST_UPDATE_ARG, RELAUNCH_GUARD_MAX_AGE_MS } from "./launchConstants";

export { POST_UPDATE_ARG };

const GUARD_PATH = join(REPO_SETTINGS_DIR, ARTIFACTS.relaunchGuard);

export function writeRelaunchGuard() {
    writeFileSync(GUARD_PATH, String(Date.now()));
}

export function clearRelaunchGuard() {
    try {
        unlinkSync(GUARD_PATH);
    } catch { /* ignore */ }
}

export function isRelaunchGuardPending() {
    if (!existsSync(GUARD_PATH)) return false;

    const written = Number(readFileSync(GUARD_PATH, "utf8").trim());
    return !!written && Date.now() - written <= RELAUNCH_GUARD_MAX_AGE_MS;
}

/** @returns true when this launch is the single post-update relaunch */
export function consumeRelaunchGuard() {
    if (!existsSync(GUARD_PATH)) return false;

    const written = Number(readFileSync(GUARD_PATH, "utf8").trim());
    try { unlinkSync(GUARD_PATH); } catch { /* ignore */ }

    if (!written || Date.now() - written > RELAUNCH_GUARD_MAX_AGE_MS) {
        console.warn("[Vencord] Stale relaunch guard ignored");
        return false;
    }

    return true;
}

export function hasPostUpdateArg(argv: string[] = process.argv) {
    return argv.includes(POST_UPDATE_ARG);
}

export function buildRelaunchArgs(argv: string[] = process.argv) {
    return [...argv.slice(1).filter(a => a !== POST_UPDATE_ARG), POST_UPDATE_ARG];
}
