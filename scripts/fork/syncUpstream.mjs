/*
 * Rebases this fork onto Vendicated/Vencord main, auto-resolving conflicts
 * in fork-owned paths and re-applying fork patches afterward.
 *
 * Usage:
 *   node scripts/fork/syncUpstream.mjs          # rebase only
 *   node scripts/fork/syncUpstream.mjs --push   # rebase and push origin main
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, cpSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

import { ensureForkPatches } from "./ensureForkPatches.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const UPSTREAM = "https://github.com/Vendicated/Vencord.git";
const FORK_PATHS_FILE = join(ROOT, ".github/fork-paths.txt");
const CONSTANTS = "src/utils/constants.ts";

const git = (args, opts = {}) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();

const gitTry = (args) => {
    try {
        return git(args);
    } catch {
        return null;
    }
};

function loadForkPaths() {
    return readFileSync(FORK_PATHS_FILE, "utf8")
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"));
}

function isForkPath(file, forkPaths) {
    const normalized = file.replace(/\\/g, "/");
    return forkPaths.some(p => normalized === p.replace(/\/$/, "") || normalized.startsWith(p));
}

function rebaseInProgress() {
    return existsSync(join(ROOT, ".git/rebase-merge")) ||
        existsSync(join(ROOT, ".git/rebase-apply"));
}

function getConflictedFiles() {
    return git(["diff", "--name-only", "--diff-filter=U"])
        .split("\n")
        .filter(Boolean);
}

function backupForkFiles(forkPaths) {
    const dir = mkdtempSync(join(tmpdir(), "vencord-fork-backup-"));
    for (const p of forkPaths) {
        const src = join(ROOT, p);
        if (!existsSync(src)) continue;
        cpSync(src, join(dir, p), { recursive: true });
    }
    return dir;
}

function restoreMissingForkFiles(backupDir, forkPaths) {
    for (const p of forkPaths) {
        const dest = join(ROOT, p);
        const src = join(backupDir, p);
        if (existsSync(dest) || !existsSync(src)) continue;
        cpSync(src, dest, { recursive: true });
        git(["add", p]);
        console.log(`Restored missing fork file: ${p}`);
    }
}

function resolveConflicts(forkPaths) {
    for (const file of getConflictedFiles()) {
        if (isForkPath(file, forkPaths)) {
            git(["checkout", "--theirs", "--", file]);
            console.log(`Conflict: kept fork version of ${file}`);
        } else if (file === CONSTANTS) {
            git(["checkout", "--ours", "--", file]);
            console.log(`Conflict: took upstream ${file}, will re-apply fork patches`);
        } else {
            git(["checkout", "--ours", "--", file]);
            console.log(`Conflict: took upstream version of ${file}`);
        }
        git(["add", "--", file]);
    }
}

function continueRebase() {
    execFileSync("git", ["-c", "core.editor=true", "rebase", "--continue"], {
        cwd: ROOT,
        stdio: "inherit"
    });
}

function abortRebase() {
    if (rebaseInProgress()) {
        git(["rebase", "--abort"]);
    }
}

function ensureUpstreamRemote() {
    const remotes = git(["remote"]);
    if (!remotes.split("\n").includes("upstream")) {
        git(["remote", "add", "upstream", UPSTREAM]);
    }
}

function main() {
    const push = process.argv.includes("--push");
    const forkPaths = loadForkPaths();
    const backupDir = backupForkFiles(forkPaths);

    process.chdir(ROOT);
    ensureUpstreamRemote();
    git(["fetch", "upstream", "main"]);

    if (gitTry(["merge-base", "--is-ancestor", "upstream/main", "HEAD"]) === "") {
        console.log("Already up to date with upstream/main");
        rmSync(backupDir, { recursive: true, force: true });
        return;
    }

    try {
        execFileSync("git", ["rebase", "upstream/main"], { cwd: ROOT, stdio: "inherit" });
    } catch {
        if (!rebaseInProgress()) {
            rmSync(backupDir, { recursive: true, force: true });
            throw new Error("Rebase failed before conflicts could be resolved");
        }
    }

    let attempts = 0;
    while (rebaseInProgress()) {
        if (++attempts > 50) {
            abortRebase();
            rmSync(backupDir, { recursive: true, force: true });
            throw new Error("Rebase exceeded maximum conflict resolution attempts");
        }

        if (getConflictedFiles().length === 0) {
            try {
                continueRebase();
            } catch {
                if (!rebaseInProgress()) break;
            }
            continue;
        }

        resolveConflicts(forkPaths);

        try {
            continueRebase();
        } catch {
            if (!rebaseInProgress() && getConflictedFiles().length === 0) break;
            if (getConflictedFiles().length === 0 && rebaseInProgress()) continue;
        }
    }

    if (rebaseInProgress()) {
        const remaining = getConflictedFiles();
        abortRebase();
        rmSync(backupDir, { recursive: true, force: true });
        throw new Error(
            "Could not auto-resolve rebase conflicts:\n" +
            remaining.map(f => `  - ${f}`).join("\n")
        );
    }

    ensureForkPatches();
    restoreMissingForkFiles(backupDir, forkPaths);

    const patchDiff = gitTry(["diff", "--name-only"]);
    if (patchDiff) {
        git(["add", "-A"]);
        git(["commit", "-m", "Apply fork patches after upstream sync"]);
    }

    rmSync(backupDir, { recursive: true, force: true });
    console.log("Successfully rebased onto upstream/main");

    if (push) {
        git(["push", "origin", "main", "--force-with-lease"]);
        console.log("Pushed to origin/main");
    }
}

try {
    main();
} catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
}
