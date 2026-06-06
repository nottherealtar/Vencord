/*
 * Build + inject using scripts freshly pulled from disk.
 * Invoked as a subprocess after git pull during startup update.
 */

import { execFileSync, execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { runAutoInject } from "./autoInject.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

console.log("[Vencord] Rebuilding...");
execSync("node scripts/build/build.mjs", { cwd: ROOT, stdio: "inherit" });

runAutoInject();

console.log("[Vencord] Post-update steps complete");
