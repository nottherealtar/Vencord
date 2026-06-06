/*
 * Vencord repo root — dist/patcher.js lives in dist/, repo is one level up.
 * All fork update markers/locks must use this path, not AppData VencordData.
 */

import { mkdirSync } from "fs";
import { join } from "path";

export const REPO_ROOT = join(__dirname, "..");
export const REPO_SETTINGS_DIR = join(REPO_ROOT, "settings");

mkdirSync(REPO_SETTINGS_DIR, { recursive: true });
