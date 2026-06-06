/*
 * Non-interactive Discord inject using the Vencord installer CLI.
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { readUpdaterSettings } from "./readUpdaterSettings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function runAutoInject() {
    const settings = readUpdaterSettings();

    if (settings.autoInject === false) {
        console.log("[Vencord] Auto-inject skipped (disabled in settings)");
        return false;
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
