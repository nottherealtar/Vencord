/*
 * Run fork scripts via the Electron binary in Node mode (not as a new Discord window).
 */

/** Env for execFileSync(process.execPath, [script.mjs]) from inside Discord. */
export function forkScriptEnv(extra = {}) {
    return {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        ...extra,
    };
}

/** Env for spawning a full Discord restart (must NOT inherit ELECTRON_RUN_AS_NODE). */
export function discordSpawnEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}
