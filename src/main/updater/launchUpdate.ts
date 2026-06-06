/*
 * Tracks whether the pre-Discord launch update already ran this process.
 * Prevents the renderer from running a second pull/rebuild/inject cycle.
 */

let didRunOnLaunch = false;

export function markLaunchUpdateRan() {
    didRunOnLaunch = true;
}

export function didRunLaunchUpdate() {
    return didRunOnLaunch;
}
