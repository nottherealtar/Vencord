/*
 * Runs before Discord loads. Pulls from origin and rebuilds when auto-update
 * is enabled so the current launch uses the latest build.
 *
 * Exit 0 = success or nothing to do. Exit 1 = failure.
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SETTINGS_CANDIDATES = [
    process.env.VENCORD_USER_DATA_DIR && join(process.env.VENCORD_USER_DATA_DIR, "settings", "settings.json"),
    join(ROOT, "settings", "settings.json"),
].filter(Boolean);

const git = (args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function readAutoUpdateEnabled() {
    for (const path of SETTINGS_CANDIDATES) {
        if (!existsSync(path)) continue;
        try {
            const settings = JSON.parse(readFileSync(path, "utf8"));
            return settings.autoUpdate !== false;
        } catch {
            continue;
        }
    }
    return true;
}

function main() {
    if (process.env.VENCORD_STARTUP_UPDATE === "0") return;

    if (!readAutoUpdateEnabled()) {
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
        stdio: "inherit"
    });

    console.log("[Vencord] Rebuilding...");
    execSync("node scripts/build/build.mjs", { cwd: ROOT, stdio: "inherit" });

    console.log("[Vencord] Startup update complete");
}

try {
    main();
} catch (err) {
    console.error("[Vencord] Startup update failed:", err?.message ?? err);
    process.exit(1);
}
