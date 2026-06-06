/*
 * Tracker Link Cards — CS2 Leetify profile cards + shareable stat blocks.
 *
 * Setup (one-time):
 *  1. Create a free account at https://leetify.com (Sign in with Steam)
 *  2. Play a match or wait for Leetify to sync — the API only returns registered users
 *  3. Optional: API key from https://leetify.com/app/developer (higher rate limits)
 *  4. Set your Steam64 ID in plugin settings (find it on your Steam profile URL)
 */

import "./styles.css";

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { React, showToast, Toasts } from "@webpack/common";

import {
    fetchLeetifyProfile,
    formatShareBlock,
    LEETIFY_PROFILE_URL_RE,
    parseLeetifyUrls,
} from "./leetify";
import { LeetifyTrackerCard } from "./TrackerCard";

const settings = definePluginSettings({
    mySteamId: {
        type: OptionType.STRING,
        description: "Your Steam64 ID for the Share Stats button (17-digit number from your Steam profile URL)",
        default: "",
    },
    leetifyApiKey: {
        type: OptionType.STRING,
        description: "Optional Leetify API key from leetify.com/app/developer (better rate limits)",
        default: "",
    },
    showCards: {
        type: OptionType.BOOLEAN,
        description: "Show Leetify stat cards under messages (Vencord users)",
        default: true,
    },
    appendStatsOnSend: {
        type: OptionType.BOOLEAN,
        description: "When you send a Leetify link, append a formatted stat block everyone can read",
        default: true,
    },
});

const ShareStatsIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className} aria-hidden>
        <path
            fill="currentColor"
            d="M4 4h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 8h10a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm12 0h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"
        />
    </svg>
);

async function shareMyStats() {
    const steamId = settings.store.mySteamId.trim().replace(/\D/g, "");
    if (!steamId || steamId.length < 17) {
        showToast(
            "Set your Steam64 ID in Tracker Link Cards settings first.\nOpen Steam → your profile → copy the number from the URL.",
            Toasts.Type.MESSAGE
        );
        return;
    }

    try {
        const profile = await fetchLeetifyProfile(steamId, settings.store.leetifyApiKey);
        insertTextIntoChatInputBox(formatShareBlock(profile).trimStart() + " ");
        showToast("CS2 stats inserted — press Enter to send", Toasts.Type.SUCCESS);
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.toLowerCase().includes("rate limit")) {
            showToast("Leetify rate limit — add an API key in plugin settings", Toasts.Type.FAILURE);
        } else {
            showToast(
                "Could not load your Leetify profile. Sign in at leetify.com with Steam and play a match first.",
                Toasts.Type.FAILURE
            );
        }
    }
}

const ShareStatsButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip="Share my CS2 stats (Leetify)"
            onClick={() => void shareMyStats()}
        >
            <ShareStatsIcon />
        </ChatBarButton>
    );
};

function TrackerMessageAccessory({ message }: { message: Message; }) {
    if (!settings.store.showCards || !message.content) return null;

    const links = parseLeetifyUrls(message.content);
    if (!links.length) return null;

    return (
        <>
            {links.map(link => (
                <LeetifyTrackerCard
                    key={`${message.id}-${link.id}`}
                    link={link}
                    apiKey={settings.store.leetifyApiKey}
                />
            ))}
        </>
    );
}

let preSendListener: ((channelId: string, messageObj: { content: string; }) => Promise<void>) | undefined;

export default definePlugin({
    name: "TrackerLinkCards",
    description: "CS2 Leetify link cards and one-click stat sharing for your stack",
    tags: ["CS2", "Chat", "Gaming"],
    authors: [{ name: "nottherealtar", id: 0n }],
    settings,

    chatBarButton: {
        icon: ShareStatsIcon,
        render: ShareStatsButton,
    },

    start() {
        addMessageAccessory("TrackerLinkCards", props => (
            <TrackerMessageAccessory message={props.message} />
        ), 4);

        preSendListener = async (_, messageObj) => {
            if (!settings.store.appendStatsOnSend || !messageObj.content) return;
            if (!LEETIFY_PROFILE_URL_RE.test(messageObj.content)) return;

            LEETIFY_PROFILE_URL_RE.lastIndex = 0;
            const links = parseLeetifyUrls(messageObj.content);
            if (!links.length) return;

            // Skip if we already appended a stat block for this link.
            if (/· CS2 \(Leetify\)/.test(messageObj.content)) return;

            const link = links[0];

            try {
                const profile = await fetchLeetifyProfile(link.id, settings.store.leetifyApiKey);
                messageObj.content += formatShareBlock(profile);
            } catch {
                // Keep the raw link if stats aren't available.
            }
        };

        addMessagePreSendListener(preSendListener);
    },

    stop() {
        removeMessageAccessory("TrackerLinkCards");
        if (preSendListener) removeMessagePreSendListener(preSendListener);
    },
});
