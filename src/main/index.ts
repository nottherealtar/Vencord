/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import { app, net, protocol } from "electron";
import { join } from "path";
import { pathToFileURL } from "url";

import { runLaunchPipeline } from "./bootstrap/launchPipeline";
import { initCsp } from "./csp";
import { RendererSettings } from "./settings";
import { IS_VANILLA, THEMES_DIR } from "./utils/constants";
import { installExt } from "./utils/extensions";
import { ensureSafePath } from "./utils/safePath";

// Settings must load first (launch pipeline reads autoUpdate from here).
import "./settings";

/**
 * Bootstrap order:
 * 1. settings (above)
 * 2. launch pipeline — update / relaunch decision BEFORE ipcMain or Discord
 * 3. ipcMain + patcher + Discord (only if not relaunching)
 */
const launchOutcome = IS_DISCORD_DESKTOP ? runLaunchPipeline() : "continue";

if (launchOutcome === "continue") {
    require("./ipcMain");

    if (IS_VESKTOP || !IS_VANILLA) {
        app.whenReady().then(() => {
            protocol.handle("vencord", ({ url: unsafeUrl }) => {
                let url = decodeURI(unsafeUrl).slice("vencord://".length).replace(/\?v=\d+$/, "");

                if (url.endsWith("/")) url = url.slice(0, -1);

                if (url.startsWith("/themes/")) {
                    const theme = url.slice("/themes/".length);

                    const safeUrl = ensureSafePath(THEMES_DIR, theme);
                    if (!safeUrl) {
                        return new Response(null, {
                            status: 404
                        });
                    }

                    return net.fetch(pathToFileURL(safeUrl).toString());
                }

                switch (url) {
                    case "renderer.js.map":
                    case "vencordDesktopRenderer.js.map":
                    case "preload.js.map":
                    case "vencordDesktopPreload.js.map":
                    case "patcher.js.map":
                    case "vencordDesktopMain.js.map":
                        return net.fetch(pathToFileURL(join(__dirname, url)).toString());
                    default:
                        return new Response(null, {
                            status: 404
                        });
                }
            });

            try {
                if (RendererSettings.store.enableReactDevtools)
                    installExt("fmkadmapgofadopljbjfkapdkoienihi")
                        .then(() => console.info("[Vencord] Installed React Developer Tools"))
                        .catch(err => console.error("[Vencord] Failed to install React Developer Tools", err));
            } catch { }

            initCsp();
        });
    }

    if (IS_DISCORD_DESKTOP) {
        require("./patcher");
    }
}
