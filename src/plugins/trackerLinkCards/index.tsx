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

import { ApplicationCommandInputType } from "@api/Commands";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { React, showToast, Toasts } from "@webpack/common";

import {
    clearLeetifyCache,
    fetchLeetifyProfile,
    formatShareBlock,
    formatShareMessage,
    messageContainsLeetifyLink,
    parseLeetifyUrls,
    parseLeetifyUrlsFromMessage,
} from "./leetify";
import { LeetifyTrackerCard } from "./TrackerCard";

const settings = definePluginSettings({
    mySteamId: {
        type: OptionType.STRING,
        description: "Your Steam64 ID for Share Stats / /cs2stats (17-digit number from your Steam profile URL). Settings save automatically.",
        default: "",
    },
    leetifyApiKey: {
        type: OptionType.STRING,
        description: "Optional API key from leetify.com/app/developer — higher rate limits for stat cards (saves automatically)",
        default: "",
        onChange() {
            clearLeetifyCache();
        },
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

function getMySteamId() {
    return settings.store.mySteamId.trim().replace(/\D/g, "");
}

async function loadMyProfile() {
    const steamId = getMySteamId();
    if (!steamId || steamId.length < 17) {
        showToast(
            "Set your Steam64 ID in Tracker Link Cards settings first.\nSteam profile URL → copy the 17-digit number.",
            Toasts.Type.MESSAGE
        );
        return null;
    }

    try {
        return await fetchLeetifyProfile(steamId, settings.store.leetifyApiKey);
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
        return null;
    }
}

async function insertMyStats() {
    const profile = await loadMyProfile();
    if (!profile) return;

    insertTextIntoChatInputBox(formatShareMessage(profile) + " ");
    showToast("CS2 stats inserted — press Enter to send", Toasts.Type.SUCCESS);
}

async function sendMyStats(channelId: string) {
    const profile = await loadMyProfile();
    if (!profile) return;

    await sendMessage(channelId, { content: formatShareMessage(profile) });
    showToast("CS2 stats posted", Toasts.Type.SUCCESS);
}

const ShareStatsButton: ChatBarButtonFactory = ({ isAnyChat }) => {
    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip="Share my CS2 stats (Leetify)"
            onClick={() => void insertMyStats()}
        >
            <ShareStatsIcon />
        </ChatBarButton>
    );
};

function TrackerMessageAccessory({ message }: { message: Message; }) {
    if (!settings.store.showCards) return null;

    const links = parseLeetifyUrlsFromMessage(message);
    if (!links.length) return null;

    return (
        <div className="vc-tracker-card-stack">
            {links.map(link => (
                <LeetifyTrackerCard
                    key={`${message.id}-${link.id}`}
                    link={link}
                    apiKey={settings.store.leetifyApiKey}
                />
            ))}
        </div>
    );
}

export default definePlugin({
    name: "TrackerLinkCards",
    description: "CS2 Leetify link cards and one-click stat sharing for your stack. Chat bar button (right of input) or /cs2stats.",
    tags: ["CS2", "Chat", "Gaming"],
    authors: [{ name: "nottherealtar", id: 0n }],
    requiresRestart: false,
    settings,

    chatBarButton: {
        icon: ShareStatsIcon,
        render: ShareStatsButton,
    },

    renderMessageAccessory: props => <TrackerMessageAccessory message={props.message} />,
    /** Just above Discord link embeds — same slot as MessageLinkEmbeds. */
    messageAccessoryPosition: 4,

    commands: [{
        name: "cs2stats",
        description: "Post your CS2 Leetify stats in this channel",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: async (_, ctx) => sendMyStats(ctx.channel.id),
    }],

    start() {
        clearLeetifyCache();
    },

    async onBeforeMessageSend(_, messageObj) {
        if (!settings.store.appendStatsOnSend || !messageObj.content) return;
        if (!messageContainsLeetifyLink(messageObj.content)) return;

        const links = parseLeetifyUrls(messageObj.content);
        if (!links.length) return;

        if (/· CS2 \(Leetify\)/.test(messageObj.content)) return;

        try {
            const profile = await fetchLeetifyProfile(links[0].id, settings.store.leetifyApiKey);
            messageObj.content += formatShareBlock(profile);
        } catch {
            // Keep the raw link if stats aren't available.
        }
    },
});
