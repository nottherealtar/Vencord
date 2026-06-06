/*
 * One-shot guard so post-update relaunch never loops back into pull/rebuild.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { ARTIFACTS, POST_UPDATE_ARG, RELAUNCH_GUARD_MAX_AGE_MS } from "./launchConstants.mjs";

export { POST_UPDATE_ARG };

function guardPath(root) {
    return join(root, "settings", ARTIFACTS.relaunchGuard);
}

export function writeRelaunchGuard(root) {
    writeFileSync(guardPath(root), String(Date.now()));
}

export function isRelaunchGuardPending(root) {
    const path = guardPath(root);
    if (!existsSync(path)) return false;

    const written = Number(readFileSync(path, "utf8").trim());
    return !!written && Date.now() - written <= RELAUNCH_GUARD_MAX_AGE_MS;
}

/**
 * @returns {boolean} true when this launch is the single post-update relaunch
 */
export function consumeRelaunchGuard(root) {
    const path = guardPath(root);
    if (!existsSync(path)) return false;

    const written = Number(readFileSync(path, "utf8").trim());
    try { unlinkSync(path); } catch { /* ignore */ }

    if (!written || Date.now() - written > RELAUNCH_GUARD_MAX_AGE_MS) {
        console.warn("[Vencord] Stale relaunch guard ignored");
        return false;
    }

    return true;
}

export function hasPostUpdateArg(argv = process.argv) {
    return argv.includes(POST_UPDATE_ARG);
}
