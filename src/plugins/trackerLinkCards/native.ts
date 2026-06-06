/*
 * Main-process Leetify API fetch (bypasses Discord renderer CSP / CORS).
 */

import { IpcMainInvokeEvent } from "electron";

const API_BASE = "https://api-public.cs-prod.leetify.com";

export async function fetchProfile(
    _: IpcMainInvokeEvent,
    id: string,
    apiKey?: string,
): Promise<{ ok: true; data: unknown; } | { ok: false; error: string; }> {
    try {
        const headers: Record<string, string> = { Accept: "application/json" };
        const key = apiKey?.trim();
        if (key) {
            headers.Authorization = `Bearer ${key}`;
            headers._leetify_key = key;
        }

        const res = await fetch(`${API_BASE}/v3/profile?id=${encodeURIComponent(id)}`, { headers });
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
