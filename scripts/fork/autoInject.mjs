/*
 * Non-interactive Discord inject using the Vencord installer CLI.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { readUpdaterSettings } from "./readUpdaterSettings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function normalizePath(p) {
    return p.replace(/\\+/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function getInstalledPatcherPath(content) {
    const match = content.match(/require\("(.+?patcher\.js)"\)/);
    return match?.[1]?.replace(/\\\\/g, "\\") ?? null;
}

function findDiscordResourcesDir(settings) {
    const roots = [];
    if (settings.discordInstallLocation) {
        roots.push(settings.discordInstallLocation);
    } else if (process.env.LOCALAPPDATA) {
        roots.push(join(process.env.LOCALAPPDATA, "Discord"));
    }

    for (const root of roots) {
        if (!existsSync(root)) continue;

        const appDirs = readdirSync(root, { withFileTypes: true })
            .filter(d => d.isDirectory() && /^app-\d/.test(d.name))
            .map(d => join(root, d.name));

        for (const appDir of appDirs) {
            const resources = join(appDir, "resources");
            if (existsSync(join(resources, "app.asar"))) return resources;
        }
    }

    return null;
}

export function isDevInstallCurrent(settings = readUpdaterSettings()) {
    const resources = findDiscordResourcesDir(settings);
    if (!resources) return false;

    const appAsar = join(resources, "app.asar");
    const patcherPath = join(ROOT, "dist", "patcher.js");

    try {
        const content = readFileSync(appAsar, "utf8");
        const installed = getInstalledPatcherPath(content);
        return installed !== null && normalizePath(installed) === normalizePath(patcherPath);
    } catch {
        return false;
    }
}

export function runAutoInject() {
    const settings = readUpdaterSettings();

    if (settings.autoInject === false) {
        console.log("[Vencord] Auto-inject skipped (disabled in settings)");
        return false;
    }

    if (isDevInstallCurrent(settings)) {
        console.log("[Vencord] Dev install already points at this repo — rebuild is sufficient, skipping re-inject");
        return true;
    }

    const args = ["scripts/runInstaller.mjs", "--", "--install"];
    if (settings.discordInstallLocation) {
        args.push("--location", settings.discordInstallLocation);
    } else {
        args.push("--branch", settings.discordInstallBranch || "auto");
    }

    console.log("[Vencord] Injecting into Discord...");
    execFileSync(process.execPath, args, {
        cwd: ROOT,
        stdio: "inherit",
        env: {
            ...process.env,
            VENCORD_USER_DATA_DIR: process.env.VENCORD_USER_DATA_DIR ?? ROOT,
            VENCORD_DEV_INSTALL: "1",
        },
    });
    console.log("[Vencord] Inject complete");
    return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        runAutoInject();
    } catch (err) {
        console.error("[Vencord] Auto-inject failed:", err?.message ?? err);
        process.exit(1);
    }
}
