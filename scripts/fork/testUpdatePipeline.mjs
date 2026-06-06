/*
 * End-to-end verification for the fork update pipeline.
 * Run: node scripts/fork/testUpdatePipeline.mjs
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { runAutoInject, isDevInstallCurrent } from "./autoInject.mjs";
import { readUpdaterSettings } from "./readUpdaterSettings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SETTINGS_PATH = join(ROOT, "settings", "settings.json");

const results = [];

function git(args) {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function isDiscordRunning() {
    try {
        const out = execSync('tasklist /FI "IMAGENAME eq Discord.exe" /NH', { encoding: "utf8", shell: true });
        return out.includes("Discord.exe");
    } catch {
        return false;
    }
}

function canInject() {
    if (isDiscordRunning()) return "Discord is running";
    return null;
}

function tryInject() {
    try {
        runAutoInject();
    } catch {
        return "inject failed (files likely locked) — runs at launch before Discord opens";
    }
    return null;
}

function test(name, fn) {
    process.stdout.write(`  ${name} ... `);
    try {
        fn();
        results.push({ name, ok: true });
        console.log("PASS");
    } catch (err) {
        results.push({ name, ok: false, error: err?.message ?? String(err) });
        console.log("FAIL");
        console.error(`    ${err?.message ?? err}`);
    }
}

function testOrSkip(name, skipReason, fn) {
    process.stdout.write(`  ${name} ... `);
    const reason = typeof skipReason === "function" ? skipReason() : skipReason;
    if (reason) {
        results.push({ name, ok: true, skipped: true, reason });
        console.log(`SKIP (${reason})`);
        return;
    }
    try {
        fn();
        results.push({ name, ok: true });
        console.log("PASS");
    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.startsWith("SKIP:")) {
            results.push({ name, ok: true, skipped: true, reason: msg.slice(5) });
            console.log(`SKIP (${msg.slice(5)})`);
            return;
        }
        results.push({ name, ok: false, error: msg });
        console.log("FAIL");
        console.error(`    ${msg}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function backupSettings() {
    if (!existsSync(SETTINGS_PATH)) return null;
    return readFileSync(SETTINGS_PATH, "utf8");
}

function restoreSettings(backup) {
    if (backup === null) return;
    writeFileSync(SETTINGS_PATH, backup);
}

function ensureSettingsDefaults() {
    mkdirSync(join(ROOT, "settings"), { recursive: true });
    if (!existsSync(SETTINGS_PATH)) {
        writeFileSync(SETTINGS_PATH, JSON.stringify({
            autoUpdate: true,
            autoInject: true,
            autoUpdateNotification: true,
            discordInstallBranch: "auto",
            discordInstallLocation: "",
        }, null, 4));
    }
}

console.log("\n=== Vencord Update Pipeline Tests ===\n");

ensureSettingsDefaults();
const settingsBackup = backupSettings();

// --- Static / unit checks ---
console.log("Unit checks:");

test("readUpdaterSettings returns autoUpdate + autoInject enabled", () => {
    const s = readUpdaterSettings();
    assert(s.autoUpdate === true, `autoUpdate=${s.autoUpdate}`);
    assert(s.autoInject === true, `autoInject=${s.autoInject}`);
});

test("dist/patcher.js exists after prior build", () => {
    assert(existsSync(join(ROOT, "dist/patcher.js")), "dist/patcher.js missing — run pnpm build first");
});

test("origin remote points to fork", () => {
    const url = git(["remote", "get-url", "origin"]);
    assert(url.includes("nottherealtar/Vencord"), `unexpected origin: ${url}`);
});

test("git fetch origin succeeds", () => {
    git(["fetch", "origin"]);
});

// --- Test A: startup no-op (already up to date) ---
console.log("\nTest A — Startup update (already up to date):");

test("startupUpdate exits 0 when nothing to pull", () => {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/fork/startupUpdate.mjs")], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, VENCORD_USER_DATA_DIR: ROOT },
    });
    assert(out.includes("Already on latest version"), `unexpected output: ${out}`);
});

// --- Test B: autoInject standalone ---
console.log("\nTest B — Auto-inject standalone:");

test("dev install points at repo patcher.js (re-inject not needed after rebuild)", () => {
    assert(isDevInstallCurrent(), "Expected dev install stub pointing at dist/patcher.js");
});

testOrSkip("autoInject patches Discord non-interactively", canInject, () => {
    runAutoInject();
});

test("Discord Stable install is patched (app.asar points to patcher.js)", () => {
    const discordPath = join(process.env.LOCALAPPDATA ?? "", "Discord");
    assert(existsSync(discordPath), `Discord not found at ${discordPath}`);

    const appDirs = execSync(`dir /b /ad "${discordPath}"`, { encoding: "utf8", shell: true })
        .split(/\r?\n/).map(l => l.trim()).filter(l => /^app-\d/.test(l));
    assert(appDirs.length > 0, "No app-* folder in Discord install");

    const appAsar = join(discordPath, appDirs[0], "resources", "app.asar");
    assert(existsSync(appAsar), "app.asar stub missing — Discord may not be patched");
    const content = readFileSync(appAsar, "utf8");
    assert(content.includes("patcher.js"), "app.asar does not reference patcher.js");
    assert(content.includes("Vencord") || content.includes("Github"), "app.asar does not point to Vencord install");
});

// --- Test C: autoInject disabled ---
console.log("\nTest C — Auto-inject skip when disabled:");

test("autoInject skips when autoInject=false", () => {
    const current = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    writeFileSync(SETTINGS_PATH, JSON.stringify({ ...current, autoInject: false }, null, 4));
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/fork/autoInject.mjs")], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, VENCORD_USER_DATA_DIR: ROOT },
    });
    assert(out.includes("Auto-inject skipped"), `expected skip message, got: ${out}`);
    restoreSettings(settingsBackup);
});

// --- Test D: full startup update simulation (one commit behind) ---
console.log("\nTest D — Full startup update (simulate being behind origin):");

test("startupUpdate pulls, rebuilds, and injects when 1 commit behind", () => {
    const headBefore = git(["rev-parse", "HEAD"]);
    const behindCheck = git(["rev-list", "--count", `HEAD..origin/main`]);
    assert(behindCheck === "0", "Must start in sync with origin for simulation setup");

    // Stash any local WIP
    let stashed = false;
    try {
        const status = git(["status", "--porcelain"]);
        if (status) {
            git(["stash", "push", "-m", "testUpdatePipeline WIP"]);
            stashed = true;
        }
    } catch { }

    try {
        git(["reset", "--hard", "HEAD~1"]);
        const behind = git(["rev-list", "--count", "HEAD..origin/main"]);
        assert(behind === "1", `Expected 1 commit behind, got ${behind}`);

        execFileSync(process.execPath, [join(ROOT, "scripts/fork/startupUpdate.mjs")], {
            cwd: ROOT,
            stdio: "inherit",
            env: { ...process.env, VENCORD_USER_DATA_DIR: ROOT },
        });

        const headAfter = git(["rev-parse", "HEAD"]);
        assert(headAfter === headBefore, `HEAD not restored: ${headAfter} vs ${headBefore}`);
        assert(existsSync(join(ROOT, "dist/patcher.js")), "Build output missing after update");
        assert(existsSync(join(ROOT, "dist/renderer.js")), "Renderer output missing after update");
    } finally {
        if (stashed) {
            try { git(["stash", "pop"]); } catch { /* may conflict */ }
        }
    }
});

// --- Test E: in-app updater path (git pull + build + inject) ---
console.log("\nTest E — In-app updater path (git fetch → pull → build → inject):");

test("manual in-app update sequence succeeds", () => {
    git(["fetch", "origin"]);
    const branch = git(["branch", "--show-current"]);
    const behind = git(["rev-list", "--count", `HEAD..origin/${branch}`]);
    assert(behind === "0", "Already behind — run Test D first or pull manually");

    execSync("node scripts/build/build.mjs", { cwd: ROOT, stdio: "inherit" });
    runAutoInject();
});

// --- Summary ---
console.log("\n=== Results ===");
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log(`${passed}/${results.length} passed${results.some(r => r.skipped) ? ` (${results.filter(r => r.skipped).length} skipped)` : ""}`);
if (results.some(r => r.skipped)) {
    console.log("\nSkipped (expected when Discord is open):");
    for (const s of results.filter(r => r.skipped)) console.log(`  - ${s.name}: ${s.reason}`);
}
if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(1);
}
console.log("\nAll update pipeline tests passed.\n");
