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

import { onceDefined } from "@shared/onceDefined";
import electron, { app, BrowserWindowConstructorOptions, Menu } from "electron";
import { dirname, join } from "path";

import { RendererSettings } from "./settings";
import { IS_VANILLA } from "./utils/constants";

console.log("[Vencord] Patcher: applying Discord hooks");

// Our injector file at app/index.js
const injectorPath = require.main!.filename;

// special discord_arch_electron injection method
const asarName = require.main!.path.endsWith("app.asar") ? "_app.asar" : "app.asar";

// The original app.asar
const asarPath = join(dirname(injectorPath), "..", asarName);

const discordPkg = require(join(asarPath, "package.json"));
require.main!.filename = join(asarPath, discordPkg.main);

// @ts-expect-error Untyped method? Dies from cringe
app.setAppPath(asarPath);

if (!IS_VANILLA) {
    const settings = RendererSettings.store;

    if (process.platform === "win32") {
        require("./patchWin32Updater");

        if (settings.winCtrlQ) {
            const originalBuild = Menu.buildFromTemplate;
            Menu.buildFromTemplate = function (template) {
                if (template[0]?.label === "&File") {
                    const { submenu } = template[0];
                    if (Array.isArray(submenu)) {
                        submenu.push({
                            label: "Quit (Hidden)",
                            visible: false,
                            acceleratorWorksWhenHidden: true,
                            accelerator: "Control+Q",
                            click: () => app.quit()
                        });
                    }
                }
                return originalBuild.call(this, template);
            };
        }
    }

    class BrowserWindow extends electron.BrowserWindow {
        constructor(options: BrowserWindowConstructorOptions) {
            if (!options?.webPreferences?.preload || !options.title) {
                super(options);
                return;
            }

            const { frameless, winNativeTitleBar, disableMinSize, transparent, macosVibrancyStyle, windowsMaterial } = settings;

            const original = options.webPreferences.preload;
            options.webPreferences.preload = join(__dirname, "preload.js");
            options.webPreferences.sandbox = false;
            options.webPreferences.backgroundThrottling = false;

            if (frameless) {
                options.frame = false;
            } else if (process.platform === "win32" && winNativeTitleBar) {
                delete options.frame;
            }

            if (disableMinSize) {
                options.minWidth = 0;
                options.minHeight = 0;
            }

            if (transparent) {
                options.transparent = true;
                options.backgroundColor = "#00000000";
            }
            if (process.platform === "darwin" && macosVibrancyStyle) {
                options.vibrancy = macosVibrancyStyle;
                options.backgroundColor = "#00000000";
            }
            if (process.platform === "win32" && windowsMaterial && windowsMaterial !== "none") {
                options.backgroundMaterial = windowsMaterial;
                options.backgroundColor = "#00000000";
            }

            process.env.DISCORD_PRELOAD = original;

            super(options);

            if (disableMinSize) {
                this.setMinimumSize = (_width: number, _height: number) => { };
            }
        }
    }
    Object.assign(BrowserWindow, electron.BrowserWindow);
    Object.defineProperty(BrowserWindow, "name", { value: "BrowserWindow", configurable: true });

    const electronPath = require.resolve("electron");
    delete require.cache[electronPath]!.exports;
    require.cache[electronPath]!.exports = {
        ...electron,
        BrowserWindow
    };

    onceDefined(global, "appSettings", s => {
        s.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING", true);
    });

    process.env.DATA_DIR = join(app.getPath("userData"), "..", "Vencord");

    const originalAppend = app.commandLine.appendSwitch;
    app.commandLine.appendSwitch = function (...args) {
        if (args[0] === "disable-features") {
            const disabledFeatures = new Set((args[1] ?? "").split(","));
            disabledFeatures.add("WidgetLayering");
            disabledFeatures.add("UseEcoQoSForBackgroundProcess");
            args[1] += [...disabledFeatures].join(",");
        }
        return originalAppend.apply(this, args);
    };

    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
} else {
    console.log("[Vencord] Running in vanilla mode. Not loading Vencord");
}

console.log("[Vencord] Loading original Discord app.asar");
require(require.main!.filename);
