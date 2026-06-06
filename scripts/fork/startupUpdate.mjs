/*
 * Runs before Discord loads. Pulls from origin, rebuilds, and injects when
 * auto-update is enabled so the current launch uses the latest build.
 *
 * Exit 0 = success or nothing to do. Exit 1 = failure.
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { readUpdaterSettings } from "./readUpdaterSettings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const git = (args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function main() {
    if (process.env.VENCORD_STARTUP_UPDATE === "0") return;

    const settings = readUpdaterSettings();
    if (!settings.autoUpdate) {
        console.log("[Vencord] Startup update skipped (auto-update disabled)");
        return;
    }

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

    // Subprocess so build/inject always use scripts from the commit we just pulled
    execFileSync(process.execPath, [join(ROOT, "scripts/fork/postUpdate.mjs")], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, VENCORD_USER_DATA_DIR: process.env.VENCORD_USER_DATA_DIR ?? ROOT },
    });

    console.log("[Vencord] Startup update complete");
}

try {
    main();
} catch (err) {
    console.error("[Vencord] Startup update failed:", err?.message ?? err);
    process.exit(1);
}
