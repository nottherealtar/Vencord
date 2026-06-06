/*
 * Pre-Discord startup update orchestration with controlled single relaunch.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";

import { RendererSettings } from "../settings";
import { IS_VANILLA } from "../utils/constants";
import { REPO_ROOT, REPO_SETTINGS_DIR } from "../utils/repoRoot";
import { ARTIFACTS } from "./launchConstants";
import {
    clearRelaunchBudget,
    ensureColdStartSafe,
    isRelaunchBudgetAvailable,
    prepareBootstrapLock,
    recordRelaunchAttempt,
} from "./launchSafety";
import {
    clearRelaunchGuard,
    consumeRelaunchGuard,
    hasPostUpdateArg,
    writeRelaunchGuard
} from "./relaunchGuard";
import { markLaunchUpdateRan, markUpdatedThisSession } from "./sessionState";
import { forkScriptEnv } from "./subprocessEnv";

export type LaunchUpdateResult = "continue" | "relaunch" | "abort";

function consumeStartupUpdatedMarker() {
    const markerPath = join(REPO_SETTINGS_DIR, ARTIFACTS.sessionUpdated);
    if (!existsSync(markerPath)) return false;

    const value = readFileSync(markerPath, "utf8").trim();
    try { unlinkSync(markerPath); } catch { /* ignore */ }
    return value === "updated";
}

function markPostUpdateBoot() {
    clearRelaunchBudget();
    clearRelaunchGuard();
    markLaunchUpdateRan();
    markUpdatedThisSession();
}

function abortWith(reason: string): LaunchUpdateResult {
    console.error(`[Vencord] Launch aborted: ${reason}`);
    return "abort";
}

export function runLaunchUpdateFlow(): LaunchUpdateResult {
    if (IS_VANILLA || IS_UPDATER_DISABLED || IS_STANDALONE) return "continue";

    // A — post-update relaunch FIRST (skip Discord-running check: parent may still be exiting)
    if (hasPostUpdateArg()) {
        const lockErr = prepareBootstrapLock();
        if (lockErr) return abortWith(lockErr);

        console.log("[Vencord] Post-update relaunch (--vencord-post-update) — skipping startup update");
        markPostUpdateBoot();
        return "continue";
    }

    if (consumeRelaunchGuard()) {
        const lockErr = prepareBootstrapLock();
        if (lockErr) return abortWith(lockErr);

        console.log("[Vencord] Post-update relaunch (guard file) — skipping startup update");
        markPostUpdateBoot();
        return "continue";
    }

    // B — cold start safety (lock + Discord must not already be running)
    const lockErr = prepareBootstrapLock();
    if (lockErr) return abortWith(lockErr);

    const coldErr = ensureColdStartSafe();
    if (coldErr) return abortWith(coldErr);

    if (!RendererSettings.store.autoUpdate) {
        console.log("[Vencord] Startup update skipped (auto-update disabled)");
        return "continue";
    }

    // C — startup update subprocess
    let updated = false;
    try {
        execFileSync(process.execPath, [join(REPO_ROOT, "scripts/fork/startupUpdate.mjs")], {
            cwd: REPO_ROOT,
            stdio: "inherit",
            env: forkScriptEnv({ VENCORD_LAUNCH_UPDATE: "1" }),
        });
    } catch (err) {
        console.error("[Vencord] Startup update failed, continuing with current version:", err);
    } finally {
        markLaunchUpdateRan();
        updated = consumeStartupUpdatedMarker();
    }

    if (!updated) return "continue";

    // D — single controlled relaunch (never load Discord in this process after rebuild)
    if (!isRelaunchBudgetAvailable()) {
        console.error(
            "[Vencord] Relaunch budget exceeded — loading Discord in this process to prevent a restart loop."
        );
        return "continue";
    }

    recordRelaunchAttempt();
    console.log("[Vencord] Startup update applied — writing relaunch guard");
    writeRelaunchGuard();
    return "relaunch";
}

export function shouldShowUpdateSplash() {
    return RendererSettings.store.startupUpdateSplash !== false;
}
