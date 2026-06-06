/*
 * Leetify URL parsing + Public CS API (https://api-public-docs.cs-prod.leetify.com/)
 */

import { PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";

const Native = VencordNative.pluginHelpers.TrackerLinkCards as PluginNative<typeof import("./native")>;

/** Core profile path — steam64 (17 digits) or Leetify UUID. */
const LEETIFY_PROFILE_ID_RE = /leetify\.com\/app\/profile(?:\/s)?\/([a-zA-Z0-9-]+)/i;

/**
 * Registered Leetify link shapes (free public URLs only).
 * Add patterns here when Leetify introduces new share formats.
 */
const LEETIFY_LINK_PATTERNS: RegExp[] = [
    // Plain / markdown-autolinked URLs
    /https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/[a-zA-Z0-9-]+(?:\?[^\s<>"')\]]*)?/gi,
    // Discord markdown: [label](url)
    /\[[^\]]*\]\((https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/[a-zA-Z0-9-]+(?:\?[^\s)]*)?)\)/gi,
    // Discord autolink: <url>
    /<(https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/[a-zA-Z0-9-]+(?:\?[^\s>]*)?)>/gi,
];

/** @deprecated Use messageContainsLeetifyLink or parseLeetifyUrls */
export const LEETIFY_PROFILE_URL_RE = LEETIFY_LINK_PATTERNS[0];

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

export function clearLeetifyCache() {
    cache.clear();
}

function normalizeLeetifyUrl(raw: string): LeetifyParseResult | null {
    const trimmed = raw.trim().replace(/[.,;:!?)]+$/, "");
    const match = LEETIFY_PROFILE_ID_RE.exec(trimmed);
    if (!match) return null;

    const id = match[1];
    const profileUrl = `https://leetify.com/app/profile/${id}`;

    return { raw: trimmed, id, profileUrl };
}

export function parseLeetifyUrls(content: string): LeetifyParseResult[] {
    if (!content) return [];

    const results: LeetifyParseResult[] = [];
    const seenIds = new Set<string>();

    for (const pattern of LEETIFY_LINK_PATTERNS) {
        pattern.lastIndex = 0;

        for (const match of content.matchAll(pattern)) {
            const candidate = match[1] ?? match[0];
            const parsed = normalizeLeetifyUrl(candidate);
            if (!parsed || seenIds.has(parsed.id)) continue;

            seenIds.add(parsed.id);
            results.push(parsed);
        }
    }

    return results;
}

export function parseLeetifyUrlsFromMessage(message: Message): LeetifyParseResult[] {
    const sources = [message.content ?? ""];

    for (const embed of message.embeds ?? []) {
        if (embed.url) sources.push(embed.url);
        if (embed.description) sources.push(embed.description);
    }

    const results: LeetifyParseResult[] = [];
    const seenIds = new Set<string>();

    for (const source of sources) {
        for (const link of parseLeetifyUrls(source)) {
            if (seenIds.has(link.id)) continue;
            seenIds.add(link.id);
            results.push(link);
        }
    }

    return results;
}

export function messageContainsLeetifyLink(content: string): boolean {
    return parseLeetifyUrls(content).length > 0;
}

function profileUrlFromId(id: string, steam64?: string) {
    if (steam64) return `https://leetify.com/app/profile/${steam64}`;
    if (/^\d{17}$/.test(id)) return `https://leetify.com/app/profile/${id}`;
    return `https://leetify.com/app/profile/${id}`;
}

function mapProfile(json: Record<string, unknown>, fallbackId: string): LeetifyProfile {
    const id = String(json.id ?? fallbackId);
    const steam64 = json.steam64_id != null ? String(json.steam64_id) : undefined;

    return {
        id,
        name: String(json.name ?? "Unknown"),
        steam64_id: steam64,
        winrate: Number(json.winrate ?? 0),
        total_matches: Number(json.total_matches ?? 0),
        ranks: (json.ranks ?? {}) as LeetifyProfile["ranks"],
        rating: (json.rating ?? {}) as LeetifyProfile["rating"],
        profileUrl: profileUrlFromId(id, steam64),
    };
}

export async function fetchLeetifyProfile(id: string, apiKey?: string): Promise<LeetifyProfile> {
    const cacheKey = `${id}:${apiKey?.trim() ?? ""}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
        if (hit.data) return hit.data;
        throw new Error(hit.error ?? "Failed to load Leetify profile");
    }

    const res = await Native.fetchProfile(id, apiKey?.trim() || undefined);

    if (!res.ok) {
        cache.set(cacheKey, { at: Date.now(), data: null, error: res.error });
        throw new Error(res.error);
    }

    const profile = mapProfile(res.data as Record<string, unknown>, id);
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

export function friendlyError(message: string) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit")) {
        return "Leetify rate limit — add an API key in plugin settings (saves automatically).";
    }
    if (lower.includes("non-user") || lower.includes("not found") || lower.includes("404")) {
        return "No Leetify profile — player must sign up at leetify.com with Steam.";
    }
    return message;
}
