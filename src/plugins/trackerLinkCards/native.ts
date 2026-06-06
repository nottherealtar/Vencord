/*
 * Main-process Leetify API fetch (bypasses Discord renderer CSP / CORS).
 */

import { IpcMainInvokeEvent } from "electron";

const API_BASE = "https://api-public.cs-prod.leetify.com";

type LeetifyResult = { ok: true; data: unknown; } | { ok: false; error: string; };

async function leetifyGet(_: IpcMainInvokeEvent, path: string, apiKey?: string): Promise<LeetifyResult> {
    try {
        const headers: Record<string, string> = { Accept: "application/json" };
        const key = apiKey?.trim();
        if (key) {
            headers.Authorization = `Bearer ${key}`;
            headers._leetify_key = key;
        }

        const res = await fetch(`${API_BASE}${path}`, { headers });
        const text = await res.text();

        let json: Record<string, unknown>;
        try {
            json = JSON.parse(text);
        } catch {
            return { ok: false, error: `Invalid response (${res.status})` };
        }

        if (!res.ok || json.error) {
            return { ok: false, error: String(json.error ?? `${res.status} ${res.statusText}`) };
        }

        return { ok: true, data: json };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function fetchProfile(
    event: IpcMainInvokeEvent,
    id: string,
    apiKey?: string,
): Promise<LeetifyResult> {
    return leetifyGet(event, `/v3/profile?id=${encodeURIComponent(id)}`, apiKey);
}

export async function fetchMatch(
    event: IpcMainInvokeEvent,
    gameId: string,
    apiKey?: string,
): Promise<LeetifyResult> {
    return leetifyGet(event, `/v2/matches/${encodeURIComponent(gameId)}`, apiKey);
}
