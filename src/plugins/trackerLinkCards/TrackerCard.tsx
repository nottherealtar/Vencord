/*
 * Leetify stat card rendered under messages (Vencord client-side accessory).
 */

import { React, useEffect, useState } from "@webpack/common";

import {
    fetchLeetifyProfile,
    formatLastMatchLine,
    formatPremier,
    formatRating,
    formatWinrate,
    friendlyError,
    getLastMatch,
    LeetifyParseResult,
    LeetifyProfile,
} from "./leetify";

interface Props {
    link: LeetifyParseResult;
    apiKey?: string;
    showLastMatch?: boolean;
}

export function LeetifyTrackerCard({ link, apiKey, showLastMatch }: Props) {
    const [profile, setProfile] = useState<LeetifyProfile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setProfile(null);

        fetchLeetifyProfile(link.id, apiKey)
            .then(data => {
                if (!cancelled) setProfile(data);
            })
            .catch(err => {
                if (!cancelled) setError(friendlyError(err?.message ?? String(err)));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [link.id, apiKey]);

    const premier = profile ? formatPremier(profile.ranks.premier) : null;
    const lastMatch = profile && showLastMatch ? getLastMatch(profile) : null;
    const openUrl = profile?.profileUrl ?? link.profileUrl;

    return (
        <div className="vc-tracker-card">
            <div className="vc-tracker-card-header">
                <span className="vc-tracker-card-title">
                    {profile?.name ?? (link.id.length >= 17 ? "CS2 player" : "Leetify profile")}
                </span>
                <span className="vc-tracker-card-badge">Leetify</span>
            </div>

            {loading && (
                <div className="vc-tracker-card-loading">Loading CS2 stats…</div>
            )}

            {!loading && profile && (
                <>
                    {premier && (
                        <div className="vc-tracker-card-row">Premier {premier}</div>
                    )}
                    <div className="vc-tracker-card-row">
                        Aim {formatRating(profile.rating.aim)}
                        {" · Pos "}
                        {formatRating(profile.rating.positioning)}
                        {" · Util "}
                        {formatRating(profile.rating.utility)}
                    </div>
                    <div className="vc-tracker-card-row-muted">
                        {formatWinrate(profile.winrate)} WR
                        {" · "}
                        {profile.total_matches.toLocaleString("en-US")} matches
                        {profile.ranks.leetify != null && profile.ranks.leetify > 0 && (
                            <> · Rating {formatRating(profile.ranks.leetify)}</>
                        )}
                        {profile.ranks.faceit != null && profile.ranks.faceit > 0 && (
                            <> · Faceit L{profile.ranks.faceit}</>
                        )}
                    </div>
                    {lastMatch && (
                        <div className="vc-tracker-card-row-last">
                            {formatLastMatchLine(lastMatch)}
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
