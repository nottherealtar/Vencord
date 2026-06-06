/*
 * Build after git pull during startup update.
 * Inject is intentionally omitted — dev installs load from dist/ directly,
 * and injecting while Discord is starting causes file-lock loops.
 */

import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

console.log("[Vencord] Rebuilding...");
execSync("node scripts/build/build.mjs", { cwd: ROOT, stdio: "inherit" });

console.log("[Vencord] Post-update build complete");
