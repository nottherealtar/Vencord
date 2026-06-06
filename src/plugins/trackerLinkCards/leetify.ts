/*
 * Leetify URL parsing + Public CS API (https://api-public-docs.cs-prod.leetify.com/)
 */

export const LEETIFY_PROFILE_URL_RE =
    /https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/([a-zA-Z0-9-]+)/gi;

const API_BASE = "https://api-public.cs-prod.leetify.com";

export interface LeetifyProfile {
    id: string;
    name: string;
    steam64_id?: string;
    winrate: number;
    total_matches: number;
    ranks: {
        premier?: number;
        faceit?: number;
        faceit_elo?: number;
        leetify?: number;
        wingman?: number;
    };
    rating: {
        aim?: number;
        positioning?: number;
        utility?: number;
    };
    profileUrl: string;
}

export interface LeetifyParseResult {
    raw: string;
    id: string;
    profileUrl: string;
}

const cache = new Map<string, { at: number; data: LeetifyProfile | null; error?: string; }>();
const CACHE_MS = 5 * 60 * 1000;

export function parseLeetifyUrls(content: string): LeetifyParseResult[] {
    const results: LeetifyParseResult[] = [];
    LEETIFY_PROFILE_URL_RE.lastIndex = 0;

    for (const match of content.matchAll(LEETIFY_PROFILE_URL_RE)) {
        const raw = match[0];
        const id = match[1];
        if (results.some(r => r.raw === raw)) continue;

        results.push({
            raw,
            id,
            profileUrl: raw.split("?")[0],
        });
    }

    return results;
}

function profileUrlFromId(id: string, steam64?: string) {
    if (steam64) return `https://leetify.com/app/profile/s/${steam64}`;
    if (/^\d{17}$/.test(id)) return `https://leetify.com/app/profile/s/${id}`;
    return `https://leetify.com/app/profile/${id}`;
}

function mapProfile(json: Record<string, unknown>, fallbackUrl: string): LeetifyProfile {
    const id = String(json.id ?? "");
    const steam64 = json.steam64_id != null ? String(json.steam64_id) : undefined;

    return {
        id,
        name: String(json.name ?? "Unknown"),
        steam64_id: steam64,
        winrate: Number(json.winrate ?? 0),
        total_matches: Number(json.total_matches ?? 0),
        ranks: (json.ranks ?? {}) as LeetifyProfile["ranks"],
        rating: (json.rating ?? {}) as LeetifyProfile["rating"],
        profileUrl: profileUrlFromId(id || fallbackUrl, steam64),
    };
}

export async function fetchLeetifyProfile(id: string, apiKey?: string): Promise<LeetifyProfile> {
    const cacheKey = `${id}:${apiKey ?? ""}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
        if (hit.data) return hit.data;
        throw new Error(hit.error ?? "Failed to load Leetify profile");
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

    const res = await fetch(`${API_BASE}/v3/profile?id=${encodeURIComponent(id)}`, { headers });

    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const err = await res.json();
            if (err?.error) message = String(err.error);
        } catch { /* ignore */ }

        cache.set(cacheKey, { at: Date.now(), data: null, error: message });
        throw new Error(message);
    }

    const json = await res.json();
    if (json?.error) {
        cache.set(cacheKey, { at: Date.now(), data: null, error: String(json.error) });
        throw new Error(String(json.error));
    }

    const profile = mapProfile(json, profileUrlFromId(id));
    cache.set(cacheKey, { at: Date.now(), data: profile });
    return profile;
}

/** Leetify display rules: 0–100 ratings without a % suffix. */
export function formatRating(value?: number) {
    if (value == null || Number.isNaN(value)) return "—";
    return String(Math.round(value));
}

export function formatPremier(value?: number) {
    if (value == null || !value) return null;
    return value.toLocaleString("en-US");
}

export function formatWinrate(value: number) {
    return `${Math.round(value * 100)}%`;
}

export function formatShareMessage(profile: LeetifyProfile) {
    const premier = formatPremier(profile.ranks.premier);
    const aim = formatRating(profile.rating.aim);
    const pos = formatRating(profile.rating.positioning);
    const util = formatRating(profile.rating.utility);

    const lines = [
        `**${profile.name}** · CS2 (Leetify)`,
        premier
            ? `Premier ${premier} · Aim ${aim} · Positioning ${pos} · Utility ${util}`
            : `Aim ${aim} · Positioning ${pos} · Utility ${util}`,
        `Win rate ${formatWinrate(profile.winrate)} · ${profile.total_matches.toLocaleString("en-US")} matches`,
        profile.profileUrl,
    ];

    return lines.join("\n");
}

export function formatShareBlock(profile: LeetifyProfile) {
    return `\n\n${formatShareMessage(profile)}`;
}
