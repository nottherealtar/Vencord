/*
 * Run BEFORE opening Discord. Validates the full launch pipeline preconditions.
 *
 * Usage: node scripts/fork/preLaunchVerify.mjs
 *   or:  pnpm verify:launch
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { isDevInstallCurrent } from "./autoInject.mjs";
import { isDiscordRunning, isRelaunchBudgetAvailable, sanitizeStaleLaunchArtifacts } from "./launchSafety.mjs";
import { readUpdaterSettings } from "./readUpdaterSettings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const checks = [];

function pass(name, detail = "") {
    checks.push({ name, ok: true, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
    checks.push({ name, ok: false, detail });
    console.log(`  ✗ ${name} — ${detail}`);
}

function git(args) {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

console.log("\n=== Vencord Pre-Launch Verification ===\n");
console.log("Run this with Discord fully closed before your first launch.\n");

sanitizeStaleLaunchArtifacts(ROOT);

if (isDiscordRunning()) {
    fail("Discord closed", "Discord.exe is still running — close it and all system tray instances");
} else {
    pass("Discord closed");
}

if (existsSync(join(ROOT, "dist", "patcher.js"))) {
    pass("Build exists", "dist/patcher.js");
} else {
    fail("Build exists", "Run: pnpm build");
}

if (isDevInstallCurrent()) {
    pass("Dev inject", "app.asar → repo dist/patcher.js (re-inject not needed after rebuilds)");
} else {
    fail("Dev inject", "Run: pnpm inject (Discord must be closed)");
}

const settings = readUpdaterSettings();
pass("Settings", `autoUpdate=${settings.autoUpdate}, autoInject=${settings.autoInject}`);

if (settings.autoUpdate) {
    try {
        git(["fetch", "origin"]);
        const branch = git(["branch", "--show-current"]);
        const behind = git(["rev-list", "--count", `HEAD..origin/${branch}`]);
        pass("Git sync", behind === "0" ? "up to date with origin" : `${behind} commit(s) behind (will update on launch)`);
    } catch (err) {
        fail("Git sync", err?.message ?? String(err));
    }
}

if (isRelaunchBudgetAvailable(ROOT)) {
    pass("Relaunch budget", "available (no restart loop risk)");
} else {
    fail("Relaunch budget", "exceeded — wait 3 minutes or delete settings/.vencord-relaunch-budget");
}

try {
    execSync("node scripts/fork/startupUpdate.mjs", {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, VENCORD_USER_DATA_DIR: ROOT },
    });
    pass("Startup update dry-run", "completed without error");
} catch (err) {
    fail("Startup update dry-run", err?.message ?? String(err));
}

console.log("\n=== Launch flow (when you open Discord) ===");
console.log("  1. Boot lock acquired (blocks duplicate bootstraps)");
console.log("  2. If behind origin → pull + build (NO inject)");
console.log("  3. If updated → spawn ONE new Discord (--vencord-post-update) → this process exits");
console.log("  4. Post-update boot → skip pull → load Discord with one consistent build");
console.log("  5. Renderer never auto-pulls mid-session (notify only)");
console.log("  6. Subprocess scripts use ELECTRON_RUN_AS_NODE (never spawn extra Discord.exe)\n");

const failed = checks.filter(c => !c.ok);
if (failed.length) {
    console.log(`FAILED: ${failed.length} check(s) — fix before opening Discord.\n`);
    process.exit(1);
}

console.log("All checks passed — safe to open Discord.\n");
