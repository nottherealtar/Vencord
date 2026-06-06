/*
 * Game Screenshot — global hotkey captures while gaming, saved to Pictures.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const Native = VencordNative.pluginHelpers.GameScreenshot as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    hotkey: {
        type: OptionType.STRING,
        description: "Global hotkey (works while in-game). Examples: F12, Ctrl+Shift+F12, PrintScreen",
        default: "Ctrl+Shift+F12",
        onChange() {
            void syncHotkeys();
        },
    },
    saveFolder: {
        type: OptionType.STRING,
        description: "Save folder (leave empty for Pictures/Vencord Screenshots)",
        default: "",
    },
    captureTarget: {
        type: OptionType.SELECT,
        description: "Which monitor to capture",
        options: [
            { label: "Monitor under cursor (recommended for games)", value: "active", default: true },
            { label: "Primary monitor only", value: "primary" },
            { label: "All monitors (one file each)", value: "all" },
        ],
    },
    copyToClipboard: {
        type: OptionType.BOOLEAN,
        description: "Also copy the screenshot to clipboard",
        default: false,
    },
    showNotification: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when a hotkey capture saves",
        default: true,
    },
});

async function syncHotkeys() {
    await Native.unregisterHotkeys();
    const result = await Native.registerHotkeys({
        accelerator: settings.store.hotkey,
        saveDir: settings.store.saveFolder || undefined,
        target: settings.store.captureTarget as "primary" | "active" | "all",
        copyToClipboard: settings.store.copyToClipboard,
        showNotification: settings.store.showNotification,
    });

    if (!result.ok) {
        showToast(`Screenshot hotkey: ${result.error}`, Toasts.Type.FAILURE);
    }
}

async function takeScreenshot(notify = true) {
    const result = await Native.captureScreen({
        saveDir: settings.store.saveFolder || undefined,
        target: settings.store.captureTarget as "primary" | "active" | "all",
        copyToClipboard: settings.store.copyToClipboard,
        showNotification: false,
    });

    if (result.ok) {
        if (notify) {
            const extra = result.paths.length > 1 ? ` (+${result.paths.length - 1} more)` : "";
            showToast(`Saved ${result.fileName}${extra}`, Toasts.Type.SUCCESS);
        }
        return result;
    }

    if (notify) showToast(result.error, Toasts.Type.FAILURE);
    return result;
}

export default definePlugin({
    name: "GameScreenshot",
    description: "Global hotkey game screenshots saved to your Pictures folder (works while Discord is in the background)",
    tags: ["Gaming", "Utility"],
    authors: [{ name: "nottherealtar", id: 0n }],
    settings,

    toolboxActions: {
        "Take screenshot": () => void takeScreenshot(),
        "Open screenshot folder": () => void Native.openSaveFolder(settings.store.saveFolder || undefined),
    },

    commands: [{
        name: "screenshot",
        description: "Capture a screenshot to your Pictures folder",
        execute: async () => {
            const result = await takeScreenshot(false);
            if (result.ok) {
                const extra = result.paths.length > 1 ? ` (+${result.paths.length - 1} more)` : "";
                return { content: `Saved **${result.fileName}**${extra}` };
            }
            return { content: `Failed: ${result.error}` };
        },
    }],

    async start() {
        await syncHotkeys();
    },

    async stop() {
        await Native.unregisterHotkeys();
    },
});
