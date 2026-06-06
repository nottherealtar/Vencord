/*
 * Runs before Discord loads. Pulls from origin and rebuilds when auto-update is enabled.
 * NEVER injects. NEVER runs while Discord.exe is alive.
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { isDiscordRunning, sanitizeStaleLaunchArtifacts } from "./launchSafety.mjs";
import { forkScriptEnv } from "./subprocessEnv.mjs";
import { readUpdaterSettings } from "./readUpdaterSettings.mjs";
import { hasPostUpdateArg, isRelaunchGuardPending } from "./relaunchGuard.mjs";
import { writeSessionMarker } from "./sessionMarker.mjs";
import { acquireUpdateLock, releaseUpdateLock } from "./updateLock.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const git = (args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function main() {
    if (process.env.VENCORD_STARTUP_UPDATE === "0") return;

    if (hasPostUpdateArg()) {
        console.log("[Vencord] Startup update skipped (post-update relaunch boot)");
        return;
    }

    if (isRelaunchGuardPending(ROOT)) {
        console.log("[Vencord] Startup update skipped (relaunch guard pending)");
        return;
    }

    sanitizeStaleLaunchArtifacts(ROOT);

    // When invoked from the launch pipeline, parent Discord is still alive during execFileSync.
    if (!process.env.VENCORD_LAUNCH_UPDATE && isDiscordRunning()) {
        console.log("[Vencord] Startup update skipped (Discord is running)");
        return;
    }

    const settings = readUpdaterSettings();
    if (!settings.autoUpdate) {
        console.log("[Vencord] Startup update skipped (auto-update disabled)");
        return;
    }

    if (!acquireUpdateLock(ROOT)) {
        console.log("[Vencord] Startup update skipped (update already in progress)");
        return;
    }

    try {
        git(["fetch", "origin"]);

        const branch = git(["branch", "--show-current"]);
        const remoteBranch = `origin/${branch}`;

        try {
            git(["rev-parse", "--verify", remoteBranch]);
        } catch {
            console.log(`[Vencord] Startup update skipped (${remoteBranch} not found)`);
            return;
        }

        const behind = git(["rev-list", "--count", `HEAD..${remoteBranch}`]);
        if (behind === "0") {
            console.log("[Vencord] Already on latest version");
            return;
        }

        console.log(`[Vencord] Updating on launch (${behind} commit(s) behind ${remoteBranch})...`);

        execFileSync("git", ["pull", "--rebase", "--autostash", "origin", branch], {
            cwd: ROOT,
            stdio: "inherit",
        });

        execFileSync(process.execPath, [join(ROOT, "scripts/fork/postUpdate.mjs")], {
            cwd: ROOT,
            stdio: "inherit",
            env: forkScriptEnv({
                VENCORD_USER_DATA_DIR: process.env.VENCORD_USER_DATA_DIR ?? ROOT,
            }),
        });

        writeSessionMarker(ROOT, "updated");
        console.log("[Vencord] Startup update complete (build only — no inject)");
    } finally {
        releaseUpdateLock(ROOT);
    }
}

try {
    main();
} catch (err) {
    console.error("[Vencord] Startup update failed:", err?.message ?? err);
    process.exit(1);
}
