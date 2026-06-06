/*
 * Run fork scripts via the Electron binary in Node mode (not as a new Discord window).
 */

export function forkScriptEnv(extra: Record<string, string | undefined> = {}) {
    return {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        ...extra,
    };
}

export function discordSpawnEnv(extra: Record<string, string | undefined> = {}) {
    const env = { ...process.env, ...extra };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}
