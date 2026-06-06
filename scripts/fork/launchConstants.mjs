/*
 * Shared launch safety constants — keep in sync with src/main/updater/launchConstants.ts
 */

export const RELAUNCH_GUARD_MAX_AGE_MS = 120_000;
export const RELAUNCH_BUDGET_MAX = 1;
export const RELAUNCH_BUDGET_WINDOW_MS = 180_000;
export const BOOT_LOCK_STALE_MS = 120_000;
export const UPDATE_LOCK_STALE_MS = 600_000;
export const SESSION_MARKER_STALE_MS = 600_000;

export const ARTIFACTS = {
    bootLock: ".vencord-boot.lock",
    relaunchGuard: ".vencord-relaunch-guard",
    relaunchBudget: ".vencord-relaunch-budget",
    sessionUpdated: ".session-updated",
    updateLock: ".update.lock",
};

export const POST_UPDATE_ARG = "--vencord-post-update";
