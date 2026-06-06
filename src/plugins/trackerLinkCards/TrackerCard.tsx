/*
 * Leetify stat card rendered under messages (Vencord client-side accessory).
 */

import { React, useEffect, useState } from "@webpack/common";

import {
    fetchLeetifyProfile,
    formatPremier,
    formatRating,
    formatWinrate,
    LeetifyParseResult,
    LeetifyProfile,
} from "./leetify";

interface Props {
    link: LeetifyParseResult;
    apiKey?: string;
}

export function LeetifyTrackerCard({ link, apiKey }: Props) {
    const [profile, setProfile] = useState<LeetifyProfile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchLeetifyProfile(link.id, apiKey)
            .then(data => {
                if (!cancelled) setProfile(data);
            })
            .catch(err => {
                if (!cancelled) setError(err?.message ?? String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [link.id, apiKey]);

    const premier = profile ? formatPremier(profile.ranks.premier) : null;

    return (
        <div className="vc-tracker-card">
            <div className="vc-tracker-card-header">
                <span className="vc-tracker-card-title">
                    {profile?.name ?? `Profile ${link.id.slice(0, 8)}…`}
                </span>
                <span className="vc-tracker-card-badge">CS2 · Leetify</span>
            </div>

            {loading && (
                <div className="vc-tracker-card-loading">Loading stats…</div>
            )}

            {!loading && profile && (
                <div className="vc-tracker-card-stats">
                    {premier && <div>Premier {premier}</div>}
                    <div>
                        Aim {formatRating(profile.rating.aim)}
                        {" · "}
                        Positioning {formatRating(profile.rating.positioning)}
                        {" · "}
                        Utility {formatRating(profile.rating.utility)}
                    </div>
                    <div className="vc-tracker-card-meta">
                        Win rate {formatWinrate(profile.winrate)}
                        {" · "}
                        {profile.total_matches.toLocaleString("en-US")} matches
                    </div>
                </div>
            )}

            {!loading && error && (
                <div className="vc-tracker-card-error">
                    {error.includes("non-user") || error.includes("not found")
                        ? "No Leetify data — player may need to sign up at leetify.com with Steam."
                        : error}
                </div>
            )}

            <div className="vc-tracker-card-meta">
                <span
                    className="vc-tracker-card-link"
                    onClick={() => VencordNative.native.openExternal(profile?.profileUrl ?? link.profileUrl)}
                >
                    {profile?.profileUrl ?? link.profileUrl}
                </span>
            </div>
        </div>
    );
}
