/*
 * Leetify URL parsing + Public CS API (https://api-public-docs.cs-prod.leetify.com/)
 */

import { PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";

const Native = VencordNative.pluginHelpers.TrackerLinkCards as PluginNative<typeof import("./native")>;

const LEETIFY_PROFILE_ID_RE = /leetify\.com\/app\/profile(?:\/s)?\/([a-zA-Z0-9-]+)/i;
const LEETIFY_MATCH_ID_RE = /leetify\.com\/app\/match-details\/([a-f0-9-]{36})/i;

const LEETIFY_PROFILE_PATTERNS: RegExp[] = [
    /https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/[a-zA-Z0-9-]+(?:\?[^\s<>"')\]]*)?/gi,
    /\[[^\]]*\]\((https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/[a-zA-Z0-9-]+(?:\?[^\s)]*)?)\)/gi,
    /<(https?:\/\/(?:www\.)?leetify\.com\/app\/profile(?:\/s)?\/[a-zA-Z0-9-]+(?:\?[^\s>]*)?)>/gi,
];

const LEETIFY_MATCH_PATTERNS: RegExp[] = [
    /https?:\/\/(?:www\.)?leetify\.com\/app\/match-details\/[a-f0-9-]{36}(?:\?[^\s<>"')\]]*)?/gi,
    /\[[^\]]*\]\((https?:\/\/(?:www\.)?leetify\.com\/app\/match-details\/[a-f0-9-]{36}(?:\?[^\s)]*)?)\)/gi,
    /<(https?:\/\/(?:www\.)?leetify\.com\/app\/match-details\/[a-f0-9-]{36}(?:\?[^\s>]*)?)>/gi,
];

/** @deprecated Use messageContainsLeetifyLink or parseLeetifyUrls */
export const LEETIFY_PROFILE_URL_RE = LEETIFY_PROFILE_PATTERNS[0];

export interface LeetifyRecentMatch {
    id: string;
    map_name: string;
    outcome: string;
    score: [number, number];
    leetify_rating: number;
    finished_at: string;
    data_source?: string;
}

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
    recent_matches: LeetifyRecentMatch[];
    profileUrl: string;
}

export interface LeetifyParseResult {
    raw: string;
    id: string;
    profileUrl: string;
}

export interface LeetifyMatchParseResult {
    raw: string;
    gameId: string;
    matchUrl: string;
}

export interface LeetifyMatchPlayer {
    steam64_id: string;
    name: string;
    total_kills: number;
    total_deaths: number;
    kd_ratio: number;
    leetify_rating: number | null;
    initial_team_number: number;
}

export interface LeetifyMatchDetails {
    id: string;
    map_name: string;
    data_source: string;
    finished_at: string;
    team_scores: { team_number: number; score: number; }[];
    players: LeetifyMatchPlayer[];
    matchUrl: string;
}

export type LeetifyLink =
    | { kind: "profile"; link: LeetifyParseResult; }
    | { kind: "match"; link: LeetifyMatchParseResult; };

const profileCache = new Map<string, { at: number; data: LeetifyProfile | null; error?: string; }>();
const matchCache = new Map<string, { at: number; data: LeetifyMatchDetails | null; error?: string; }>();
const CACHE_MS = 5 * 60 * 1000;

export function clearLeetifyCache() {
    profileCache.clear();
    matchCache.clear();
}

function normalizeProfileUrl(raw: string): LeetifyParseResult | null {
    const trimmed = raw.trim().replace(/[.,;:!?)]+$/, "");
    const match = LEETIFY_PROFILE_ID_RE.exec(trimmed);
    if (!match) return null;

    const id = match[1];
    return { raw: trimmed, id, profileUrl: `https://leetify.com/app/profile/${id}` };
}

function normalizeMatchUrl(raw: string): LeetifyMatchParseResult | null {
    const trimmed = raw.trim().replace(/[.,;:!?)]+$/, "");
    const match = LEETIFY_MATCH_ID_RE.exec(trimmed);
    if (!match) return null;

    const gameId = match[1];
    return { raw: trimmed, gameId, matchUrl: `https://leetify.com/app/match-details/${gameId}` };
}

function parseWithPatterns<T>(
    content: string,
    patterns: RegExp[],
    normalize: (raw: string) => T | null,
    key: (item: T) => string,
): T[] {
    if (!content) return [];

    const results: T[] = [];
    const seen = new Set<string>();

    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (const match of content.matchAll(pattern)) {
            const candidate = match[1] ?? match[0];
            const parsed = normalize(candidate);
            if (!parsed) continue;

            const id = key(parsed);
            if (seen.has(id)) continue;
            seen.add(id);
            results.push(parsed);
        }
    }

    return results;
}

export function parseLeetifyUrls(content: string): LeetifyParseResult[] {
    return parseWithPatterns(content, LEETIFY_PROFILE_PATTERNS, normalizeProfileUrl, p => p.id);
}

export function parseLeetifyMatchUrls(content: string): LeetifyMatchParseResult[] {
    return parseWithPatterns(content, LEETIFY_MATCH_PATTERNS, normalizeMatchUrl, m => m.gameId);
}

export function parseAllLeetifyLinks(content: string): LeetifyLink[] {
    const links: LeetifyLink[] = [];

    for (const link of parseLeetifyMatchUrls(content))
        links.push({ kind: "match", link });
    for (const link of parseLeetifyUrls(content))
        links.push({ kind: "profile", link });

    return links;
}

function collectMessageSources(message: Message): string[] {
    const sources = [message.content ?? ""];
    for (const embed of message.embeds ?? []) {
        if (embed.url) sources.push(embed.url);
        if (embed.description) sources.push(embed.description);
    }
    return sources;
}

export function parseAllLeetifyLinksFromMessage(message: Message): LeetifyLink[] {
    const results: LeetifyLink[] = [];
    const seen = new Set<string>();

    for (const source of collectMessageSources(message)) {
        for (const item of parseAllLeetifyLinks(source)) {
            const key = `${item.kind}:${item.kind === "profile" ? item.link.id : item.link.gameId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(item);
        }
    }

    return results;
}

/** @deprecated Use parseAllLeetifyLinksFromMessage */
export function parseLeetifyUrlsFromMessage(message: Message): LeetifyParseResult[] {
    return parseAllLeetifyLinksFromMessage(message)
        .filter((l): l is LeetifyLink & { kind: "profile"; } => l.kind === "profile")
        .map(l => l.link);
}

export function messageContainsLeetifyLink(content: string): boolean {
    return parseAllLeetifyLinks(content).length > 0;
}

function profileUrlFromId(id: string, steam64?: string) {
    if (steam64) return `https://leetify.com/app/profile/${steam64}`;
    return `https://leetify.com/app/profile/${id}`;
}

function mapRecentMatch(raw: Record<string, unknown>): LeetifyRecentMatch {
    const scoreRaw = raw.score;
    const score: [number, number] = Array.isArray(scoreRaw)
        ? [Number(scoreRaw[0] ?? 0), Number(scoreRaw[1] ?? 0)]
        : [0, 0];

    return {
        id: String(raw.id ?? ""),
        map_name: String(raw.map_name ?? "Unknown map"),
        outcome: String(raw.outcome ?? ""),
        score,
        leetify_rating: Number(raw.leetify_rating ?? 0),
        finished_at: String(raw.finished_at ?? ""),
        data_source: raw.data_source != null ? String(raw.data_source) : undefined,
    };
}

function mapProfile(json: Record<string, unknown>, fallbackId: string): LeetifyProfile {
    const id = String(json.id ?? fallbackId);
    const steam64 = json.steam64_id != null ? String(json.steam64_id) : undefined;
    const recentRaw = json.recent_matches;
    const recent_matches = Array.isArray(recentRaw)
        ? recentRaw.map(m => mapRecentMatch(m as Record<string, unknown>))
        : [];

    return {
        id,
        name: String(json.name ?? "Unknown"),
        steam64_id: steam64,
        winrate: Number(json.winrate ?? 0),
        total_matches: Number(json.total_matches ?? 0),
        ranks: (json.ranks ?? {}) as LeetifyProfile["ranks"],
        rating: (json.rating ?? {}) as LeetifyProfile["rating"],
        recent_matches,
        profileUrl: profileUrlFromId(id, steam64),
    };
}

function mapMatchPlayer(raw: Record<string, unknown>): LeetifyMatchPlayer {
    return {
        steam64_id: String(raw.steam64_id ?? ""),
        name: String(raw.name ?? "Unknown"),
        total_kills: Number(raw.total_kills ?? 0),
        total_deaths: Number(raw.total_deaths ?? 0),
        kd_ratio: Number(raw.kd_ratio ?? 0),
        leetify_rating: raw.leetify_rating != null ? Number(raw.leetify_rating) : null,
        initial_team_number: Number(raw.initial_team_number ?? 0),
    };
}

function mapMatchDetails(json: Record<string, unknown>, gameId: string): LeetifyMatchDetails {
    const teamRaw = json.team_scores;
    const team_scores = Array.isArray(teamRaw)
        ? teamRaw.map(t => {
            const row = t as Record<string, unknown>;
            return {
                team_number: Number(row.team_number ?? 0),
                score: Number(row.score ?? 0),
            };
        }).sort((a, b) => a.team_number - b.team_number)
        : [];

    const statsRaw = json.stats;
    const players = Array.isArray(statsRaw)
        ? statsRaw.map(s => mapMatchPlayer(s as Record<string, unknown>))
        : [];

    return {
        id: String(json.id ?? gameId),
        map_name: String(json.map_name ?? "Unknown map"),
        data_source: String(json.data_source ?? ""),
        finished_at: String(json.finished_at ?? ""),
        team_scores,
        players,
        matchUrl: `https://leetify.com/app/match-details/${String(json.id ?? gameId)}`,
    };
}

export async function fetchLeetifyProfile(id: string, apiKey?: string): Promise<LeetifyProfile> {
    const cacheKey = `${id}:${apiKey?.trim() ?? ""}`;
    const hit = profileCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
        if (hit.data) return hit.data;
        throw new Error(hit.error ?? "Failed to load Leetify profile");
    }

    const res = await Native.fetchProfile(id, apiKey?.trim() || undefined);
    if (!res.ok) {
        profileCache.set(cacheKey, { at: Date.now(), data: null, error: res.error });
        throw new Error(res.error);
    }

    const profile = mapProfile(res.data as Record<string, unknown>, id);
    profileCache.set(cacheKey, { at: Date.now(), data: profile });
    return profile;
}

export async function fetchLeetifyMatch(gameId: string, apiKey?: string): Promise<LeetifyMatchDetails> {
    const cacheKey = `${gameId}:${apiKey?.trim() ?? ""}`;
    const hit = matchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
        if (hit.data) return hit.data;
        throw new Error(hit.error ?? "Failed to load Leetify match");
    }

    const res = await Native.fetchMatch(gameId, apiKey?.trim() || undefined);
    if (!res.ok) {
        matchCache.set(cacheKey, { at: Date.now(), data: null, error: res.error });
        throw new Error(res.error);
    }

    const match = mapMatchDetails(res.data as Record<string, unknown>, gameId);
    matchCache.set(cacheKey, { at: Date.now(), data: match });
    return match;
}

export function getLastMatch(profile: LeetifyProfile): LeetifyRecentMatch | null {
    return profile.recent_matches[0] ?? null;
}

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

export function formatMatchScore(scores: { score: number; }[]) {
    if (!scores.length) return "—";
    if (scores.length === 1) return String(scores[0].score);
    return `${scores[0].score}–${scores[1].score}`;
}

export function formatMatchOutcome(outcome: string) {
    const o = outcome.toLowerCase();
    if (o.includes("win")) return "W";
    if (o.includes("loss") || o.includes("lose")) return "L";
    if (o.includes("tie") || o.includes("draw")) return "T";
    return outcome.slice(0, 1).toUpperCase();
}

export function formatLeetifyMatchRating(value: number) {
    const rounded = Math.round(value * 100) / 100;
    return rounded >= 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}

export function formatRelativeTime(iso: string) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export function formatLastMatchLine(match: LeetifyRecentMatch) {
    return `Last: ${match.map_name} · ${match.score[0]}–${match.score[1]} ${formatMatchOutcome(match.outcome)} · ${formatLeetifyMatchRating(match.leetify_rating)} · ${formatRelativeTime(match.finished_at)}`;
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

export function formatLastMatchShareMessage(profile: LeetifyProfile): string | null {
    const match = getLastMatch(profile);
    if (!match) return null;

    const matchUrl = match.id
        ? `https://leetify.com/app/match-details/${match.id}`
        : profile.profileUrl;

    return [
        `**${profile.name}** · Last CS2 match (Leetify)`,
        `${match.map_name} · ${match.score[0]}–${match.score[1]} ${formatMatchOutcome(match.outcome)} · Rating ${formatLeetifyMatchRating(match.leetify_rating)}`,
        matchUrl,
    ].join("\n");
}

export function formatShareBlock(profile: LeetifyProfile) {
    return `\n\n${formatShareMessage(profile)}`;
}

export function formatMatchShareMessage(match: LeetifyMatchDetails, highlightSteamId?: string) {
    const score = formatMatchScore(match.team_scores);
    const you = highlightSteamId
        ? match.players.find(p => p.steam64_id === highlightSteamId)
        : undefined;

    const lines = [
        `**${match.map_name}** · ${score} · CS2 match (Leetify)`,
        match.data_source ? `Source: ${match.data_source.replace(/_/g, " ")}` : "",
        you
            ? `${you.name}: ${you.total_kills}/${you.total_deaths} · Rating ${you.leetify_rating != null ? formatLeetifyMatchRating(you.leetify_rating) : "—"}`
            : "",
        match.matchUrl,
    ].filter(Boolean);

    return lines.join("\n");
}

export function friendlyError(message: string) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit")) {
        return "Leetify rate limit — add an API key in plugin settings (saves automatically).";
    }
    if (lower.includes("non-user") || lower.includes("not found") || lower.includes("404")) {
        return "Not found on Leetify — profile must be registered or match not processed yet.";
    }
    return message;
}
