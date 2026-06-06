/*
 * Reads updater-related settings from the Vencord settings file.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SETTINGS_CANDIDATES = [
    process.env.VENCORD_USER_DATA_DIR && join(process.env.VENCORD_USER_DATA_DIR, "settings", "settings.json"),
    join(ROOT, "settings", "settings.json"),
].filter(Boolean);

const DEFAULTS = {
    autoUpdate: true,
    autoInject: true,
    startupUpdateSplash: true,
    discordInstallBranch: "auto",
    discordInstallLocation: "",
};

export function readUpdaterSettings() {
    for (const path of SETTINGS_CANDIDATES) {
        if (!existsSync(path)) continue;
        try {
            return { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) };
        } catch {
            continue;
        }
    }
    return { ...DEFAULTS };
}
