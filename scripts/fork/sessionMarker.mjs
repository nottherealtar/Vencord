/*
 * Signals from startupUpdate (subprocess) back to the patcher (main process).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { ARTIFACTS } from "./launchConstants.mjs";

function markerPath(root) {
    return join(root, "settings", ARTIFACTS.sessionUpdated);
}

/** @param {"updated"} kind */
export function writeSessionMarker(root, kind) {
    writeFileSync(markerPath(root), kind);
}

export function consumeSessionMarker(root) {
    const path = markerPath(root);
    if (!existsSync(path)) return null;

    const value = readFileSync(path, "utf8").trim();
    try { unlinkSync(path); } catch { /* ignore */ }
    return value;
}
