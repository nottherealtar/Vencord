/*
 * Re-applies fork-specific patches after an upstream sync.
 * Safe to run repeatedly — skips anything already present.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CONSTANTS = join(ROOT, "src/utils/constants.ts");

const TAR_DEV = `    Tar: {
        name: "Tar",
        id: 985226198508511302n,
    },`;

export function ensureForkPatches() {
    ensureTarDev();
    ensureForkSyncScript();
}

function ensureForkSyncScript() {
    const pkgPath = join(ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.scripts?.["fork:sync"]) return;

    pkg.scripts ??= {};
    pkg.scripts["fork:sync"] = "node scripts/fork/syncUpstream.mjs";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n");
    console.log("Applied fork patch: fork:sync script in package.json");
}

function ensureTarDev() {
    if (!existsSync(CONSTANTS)) return;

    const content = readFileSync(CONSTANTS, "utf8");
    if (/\bTar:\s*\{/.test(content)) return;

    let updated;
    if (/koish1:\s*\{/.test(content)) {
        updated = content.replace(/(koish1:\s*\{[^}]+\},)/, `$1\n${TAR_DEV}`);
    } else {
        updated = content.replace(
            /(\n}\s*satisfies Record<string, Dev>\);)/,
            `,\n${TAR_DEV}$1`
        );
    }

    if (updated === content) {
        throw new Error("Could not insert Devs.Tar into constants.ts");
    }

    writeFileSync(CONSTANTS, updated);
    console.log("Applied fork patch: Devs.Tar in constants.ts");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    ensureForkPatches();
}
