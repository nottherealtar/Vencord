/*
 * Leetify match-details card rendered under messages.
 */

import { React, useEffect, useState } from "@webpack/common";

import {
    fetchLeetifyMatch,
    formatLeetifyMatchRating,
    formatMatchScore,
    formatRelativeTime,
    friendlyError,
    LeetifyMatchParseResult,
    LeetifyMatchDetails,
} from "./leetify";

interface Props {
    link: LeetifyMatchParseResult;
    apiKey?: string;
    highlightSteamId?: string;
}

export function LeetifyMatchCard({ link, apiKey, highlightSteamId }: Props) {
    const [match, setMatch] = useState<LeetifyMatchDetails | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setMatch(null);

        fetchLeetifyMatch(link.gameId, apiKey)
            .then(data => {
                if (!cancelled) setMatch(data);
            })
            .catch(err => {
                if (!cancelled) setError(friendlyError(err?.message ?? String(err)));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [link.gameId, apiKey]);

    const topPlayers = match?.players
        .slice()
        .sort((a, b) => (b.leetify_rating ?? -999) - (a.leetify_rating ?? -999))
        .slice(0, 5) ?? [];

    const openUrl = match?.matchUrl ?? link.matchUrl;

    return (
        <div className="vc-tracker-card vc-tracker-card-match">
            <div className="vc-tracker-card-header">
                <span className="vc-tracker-card-title">
                    {match?.map_name ?? "CS2 match"}
                </span>
                <span className="vc-tracker-card-badge">Match</span>
            </div>

            {loading && (
                <div className="vc-tracker-card-loading">Loading match stats…</div>
            )}

            {!loading && match && (
                <>
                    <div className="vc-tracker-card-row">
                        {formatMatchScore(match.team_scores)}
                        {match.data_source && (
                            <> · {match.data_source.replace(/_/g, " ")}</>
                        )}
                    </div>
                    <div className="vc-tracker-card-row-muted">
                        {formatRelativeTime(match.finished_at)}
                        {" · "}
                        {match.players.length} players
                    </div>
                    {topPlayers.length > 0 && (
                        <div className="vc-tracker-match-players">
                            {topPlayers.map(player => {
                                const highlighted = highlightSteamId && player.steam64_id === highlightSteamId;
                                return (
                                    <div
                                        key={player.steam64_id || player.name}
                                        className={`vc-tracker-match-player${highlighted ? " vc-tracker-match-player-you" : ""}`}
                                    >
                                        <span className="vc-tracker-match-player-name">{player.name}</span>
                                        <span className="vc-tracker-match-player-stats">
                                            {player.total_kills}/{player.total_deaths}
                                            {player.leetify_rating != null && (
                                                <> · {formatLeetifyMatchRating(player.leetify_rating)}</>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {!loading && error && (
                <div className="vc-tracker-card-error">{error}</div>
            )}

            <span
                className="vc-tracker-card-link"
                onClick={() => VencordNative.native.openExternal(openUrl)}
            >
                Open on Leetify
            </span>
        </div>
    );
}
