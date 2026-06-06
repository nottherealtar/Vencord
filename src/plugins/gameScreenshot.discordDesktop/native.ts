/*
 * Main-process game screenshots — global hotkeys + desktopCapturer.
 */

import {
    app,
    clipboard,
    desktopCapturer,
    globalShortcut,
    nativeImage,
    Notification,
    screen,
    shell,
    type IpcMainInvokeEvent,
} from "electron";
import { mkdir, writeFile } from "fs/promises";
import { basename, join } from "path";

export type CaptureTarget = "primary" | "active" | "all";

export interface CaptureOptions {
    saveDir?: string;
    target?: CaptureTarget;
    copyToClipboard?: boolean;
    showNotification?: boolean;
}

export type CaptureResult =
    | { ok: true; path: string; paths: string[]; fileName: string; }
    | { ok: false; error: string; };

interface HotkeyState extends CaptureOptions {
    accelerator: string;
}

let hotkeyState: HotkeyState | null = null;

function defaultSaveDir() {
    return join(app.getPath("pictures"), "Vencord Screenshots");
}

async function resolveSaveDir(saveDir?: string) {
    const dir = saveDir?.trim() || defaultSaveDir();
    await mkdir(dir, { recursive: true });
    return dir;
}

function timestampName(index = 0) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const base = `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    return index > 0 ? `${base} (${index + 1}).png` : `${base}.png`;
}

function displaysForTarget(target: CaptureTarget) {
    if (target === "all") return screen.getAllDisplays();
    if (target === "primary") return [screen.getPrimaryDisplay()];
    return [screen.getDisplayNearestPoint(screen.getCursorScreenPoint())];
}

function maxThumbnailSize(displays: Electron.Display[]) {
    let width = 0;
    let height = 0;
    for (const display of displays) {
        width = Math.max(width, Math.floor(display.size.width * display.scaleFactor));
        height = Math.max(height, Math.floor(display.size.height * display.scaleFactor));
    }
    return {
        width: Math.min(Math.max(width, 1), 7680),
        height: Math.min(Math.max(height, 1), 4320),
    };
}

async function captureDisplays(options: CaptureOptions): Promise<CaptureResult> {
    try {
        const target = options.target ?? "active";
        const displays = displaysForTarget(target);
        const saveDir = await resolveSaveDir(options.saveDir);
        const thumbnailSize = maxThumbnailSize(displays);

        const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize,
        });

        const paths: string[] = [];

        for (let i = 0; i < displays.length; i++) {
            const display = displays[i];
            const source = sources.find(s => s.display_id === String(display.id))
                ?? sources[i];

            if (!source?.thumbnail || source.thumbnail.isEmpty()) continue;

            const fileName = timestampName(paths.length);
            const filePath = join(saveDir, fileName);
            await writeFile(filePath, source.thumbnail.toPNG());
            paths.push(filePath);
        }

        if (!paths.length) {
            return { ok: false, error: "Could not capture any display" };
        }

        if (options.copyToClipboard) {
            clipboard.writeImage(nativeImage.createFromPath(paths[0]));
        }

        return {
            ok: true,
            path: paths[0],
            paths,
            fileName: basename(paths[0]),
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

function notifySaved(result: CaptureResult & { ok: true; }) {
    if (!hotkeyState?.showNotification) return;
    if (!Notification.isSupported()) return;

    const body = result.paths.length > 1
        ? `${result.fileName} (+${result.paths.length - 1} more)`
        : result.fileName;

    const notification = new Notification({
        title: "Screenshot saved",
        body,
    });

    notification.on("click", () => {
        shell.showItemInFolder(result.path);
    });

    notification.show();
}

async function runHotkeyCapture() {
    if (!hotkeyState) return;
    const result = await captureDisplays(hotkeyState);
    if (result.ok) notifySaved(result);
}

export async function getDefaultSaveDir() {
    return defaultSaveDir();
}

export async function captureScreen(_: IpcMainInvokeEvent, options: CaptureOptions): Promise<CaptureResult> {
    return captureDisplays(options);
}

export async function registerHotkeys(_: IpcMainInvokeEvent, config: HotkeyState): Promise<{ ok: boolean; error?: string; }> {
    await unregisterHotkeys(_);

    const accelerator = config.accelerator?.trim();
    if (!accelerator) {
        return { ok: false, error: "No hotkey configured" };
    }

    const registered = globalShortcut.register(accelerator, () => {
        void runHotkeyCapture();
    });

    if (!registered) {
        return { ok: false, error: `Could not register hotkey: ${accelerator}` };
    }

    hotkeyState = { ...config, accelerator };
    return { ok: true };
}

export async function unregisterHotkeys(_: IpcMainInvokeEvent) {
    if (hotkeyState?.accelerator) {
        try {
            globalShortcut.unregister(hotkeyState.accelerator);
        } catch { /* non-fatal */ }
    }
    hotkeyState = null;
}

export async function openSaveFolder(_: IpcMainInvokeEvent, saveDir?: string) {
    const dir = saveDir?.trim() || defaultSaveDir();
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
}
