/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { IpcEvents } from "@shared/IpcEvents";
import { execFile as cpExecFile } from "child_process";
import { ipcMain } from "electron";
import { promisify } from "util";

import { serializeErrors } from "./common";
import {
    acquireUpdateLock,
    finishUpdate,
    getUpdateSession,
    releaseUpdateLock,
    tryBeginUpdate
} from "./sessionState";
import { REPO_ROOT } from "../utils/repoRoot";

const VENCORD_SRC_DIR = REPO_ROOT;

const execFile = promisify(cpExecFile);

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

function git(...args: string[]) {
    const opts = { cwd: VENCORD_SRC_DIR };

    if (isFlatpak) return execFile("flatpak-spawn", ["--host", "git", ...args], opts);
    else return execFile("git", args, opts);
}

async function getRepo() {
    const res = await git("remote", "get-url", "origin");
    return res.stdout.trim()
        .replace(/git@(.+):/, "https://$1/")
        .replace(/\.git$/, "");
}

async function calculateGitChanges() {
    await git("fetch");

    const branch = (await git("branch", "--show-current")).stdout.trim();

    const existsOnOrigin = (await git("ls-remote", "origin", branch)).stdout.length > 0;
    if (!existsOnOrigin) return [];

    const res = await git("log", `HEAD..origin/${branch}`, "--pretty=format:%an/%h/%s");

    const commits = res.stdout.trim();
    return commits ? commits.split("\n").map(line => {
        const [author, hash, ...rest] = line.split("/");
        return {
            hash, author,
            message: rest.join("/").split("\n")[0]
        };
    }) : [];
}

async function pull() {
    const branch = (await git("branch", "--show-current")).stdout.trim();
    await git("pull", "--rebase", "--autostash", "origin", branch);
    return true;
}

async function build() {
    const opts = { cwd: VENCORD_SRC_DIR };

    const command = isFlatpak ? "flatpak-spawn" : "node";
    const args = isFlatpak ? ["--host", "node", "scripts/build/build.mjs"] : ["scripts/build/build.mjs"];

    if (IS_DEV) args.push("--dev");

    const res = await execFile(command, args, opts);

    return !res.stderr.includes("Build failed");
}

async function guardedPull(manual: boolean) {
    if (!acquireUpdateLock()) {
        throw new Error("Another update is already in progress");
    }
    if (!tryBeginUpdate(manual)) {
        releaseUpdateLock();
        throw new Error("Update already completed or in progress this session");
    }

    try {
        return await pull();
    } catch (err) {
        finishUpdate(false);
        releaseUpdateLock();
        throw err;
    }
}

async function guardedBuild() {
    try {
        const ok = await build();
        finishUpdate(ok);
        return ok;
    } catch (err) {
        finishUpdate(false);
        throw err;
    } finally {
        releaseUpdateLock();
    }
}

ipcMain.on(IpcEvents.GET_LAUNCH_UPDATE_RAN, e => {
    e.returnValue = getUpdateSession().launchUpdateRan;
});

ipcMain.on(IpcEvents.GET_UPDATE_SESSION, e => {
    e.returnValue = getUpdateSession();
});

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(getRepo));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors((_, manual?: boolean) => guardedPull(!!manual)));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(guardedBuild));
