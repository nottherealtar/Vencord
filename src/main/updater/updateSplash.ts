/*
 * Minimal splash shown while Discord relaunches after a startup update.
 * Spawns the new process synchronously before exit — timers after app.exit() are not reliable.
 */

import { spawn } from "child_process";
import { app, BrowserWindow } from "electron";

import { buildRelaunchArgs } from "./relaunchGuard";
import { releaseBootLock } from "./launchSafety";
import { discordSpawnEnv } from "./subprocessEnv";

const SPLASH_MIN_MS = 800;

const SPLASH_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    background: #1e1f22;
    color: #f2f3f5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    user-select: none;
    -webkit-app-region: drag;
  }
  .title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
  .sub { font-size: 12px; color: #b5bac1; }
  .bar {
    margin-top: 14px;
    width: 200px;
    height: 3px;
    background: #383a40;
    border-radius: 2px;
    overflow: hidden;
  }
  .bar > div {
    height: 100%;
    width: 40%;
    background: #5865f2;
    border-radius: 2px;
    animation: slide 1s ease-in-out infinite;
  }
  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
</style>
</head>
<body>
  <div class="title">Updating Vencord</div>
  <div class="sub">Restarting Discord with the new build…</div>
  <div class="bar"><div></div></div>
</body>
</html>`;

function createUpdateSplash() {
    const win = new BrowserWindow({
        width: 360,
        height: 130,
        frame: false,
        resizable: false,
        center: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: "#1e1f22",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
    win.once("ready-to-show", () => win.show());
    return win;
}

function exitForRelaunch() {
    releaseBootLock();

    const relaunchArgs = buildRelaunchArgs();
    console.log("[Vencord] Spawning fresh Discord process (--vencord-post-update)");

    // Must spawn before exit — setTimeout after app.exit() may never fire.
    // Post-update boot skips the Discord-running check, so immediate spawn is safe.
    spawn(process.execPath, relaunchArgs, {
        detached: true,
        stdio: "ignore",
        env: discordSpawnEnv(),
    }).unref();
    app.exit(0);
}

export function schedulePostUpdateRelaunch(showSplash: boolean) {
    const onReady = () => {
        if (!showSplash) {
            exitForRelaunch();
            return;
        }

        const splash = createUpdateSplash();
        setTimeout(() => {
            splash.destroy();
            exitForRelaunch();
        }, SPLASH_MIN_MS);
    };

    if (typeof app.prependOnceListener === "function") {
        app.prependOnceListener("ready", onReady);
    } else {
        app.once("ready", onReady);
    }
}
