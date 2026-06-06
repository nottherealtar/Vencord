/*
 * Ordered pre-Discord bootstrap. Nothing that loads Discord or heavy IPC runs before this completes.
 */

import { app } from "electron";

import { runLaunchUpdateFlow, shouldShowUpdateSplash } from "../updater/launchUpdateFlow";
import { schedulePostUpdateRelaunch } from "../updater/updateSplash";
import { IS_VANILLA } from "../utils/constants";

export type LaunchOutcome = "continue" | "relaunch_scheduled" | "aborted";

export function runLaunchPipeline(): LaunchOutcome {
    if (!IS_DISCORD_DESKTOP || IS_VANILLA) return "continue";

    console.log("[Vencord] Launch pipeline starting (strict order: sanitize → lock → update → relaunch-or-continue)");

    const result = runLaunchUpdateFlow();

    if (result === "abort") {
        console.log("[Vencord] Launch pipeline aborted — exiting without loading Discord");
        app.exit(0);
        return "aborted";
    }

    if (result === "relaunch") {
        console.log("[Vencord] Launch pipeline: scheduling single relaunch (Discord will NOT load in this process)");
        schedulePostUpdateRelaunch(shouldShowUpdateSplash());
        return "relaunch_scheduled";
    }

    // Boot lock is held for the process lifetime (released on exit) to block duplicate bootstraps.
    console.log("[Vencord] Launch pipeline complete — proceeding to Discord");
    return "continue";
}
