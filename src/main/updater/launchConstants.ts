/*
 * Shared launch safety constants — keep scripts/fork/*.mjs and src/main/updater/*.ts in sync.
 */

/** Relaunch guard file + post-update detection window */
export const RELAUNCH_GUARD_MAX_AGE_MS = 120_000;

/** Max relaunch attempts within the budget window */
export const RELAUNCH_BUDGET_MAX = 1;
export const RELAUNCH_BUDGET_WINDOW_MS = 180_000;

/** Boot / update lock staleness */
export const BOOT_LOCK_STALE_MS = 120_000;
export const UPDATE_LOCK_STALE_MS = 600_000;

/** Orphaned session marker cleanup */
export const SESSION_MARKER_STALE_MS = 600_000;

export const ARTIFACTS = {
    bootLock: ".vencord-boot.lock",
    relaunchGuard: ".vencord-relaunch-guard",
    relaunchBudget: ".vencord-relaunch-budget",
    sessionUpdated: ".session-updated",
    updateLock: ".update.lock",
} as const;

export const POST_UPDATE_ARG = "--vencord-post-update";
