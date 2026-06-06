/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import { getRepo, isNewer, UpdateLogger } from "@utils/updater";
import { Forms, React, Select } from "@webpack/common";

import gitHash from "~git-hash";

import { CommonProps, HashLink, Newer, Updatable } from "./Components";

function VesktopSection() {
    if (!IS_VESKTOP) return null;

    const [isVesktopOutdated] = useAwaiter<boolean>(VesktopNative.app.isOutdated, { fallbackValue: false });

    return (
        <Flex className={Margins.bottom20} flexDirection="column" gap="1em">
            <Card variant="info">
                <HeadingSecondary>Vesktop & Vencord</HeadingSecondary>
                <Paragraph>Vesktop and Vencord are two separate things. This updater is for Vencord.</Paragraph>
                <Paragraph className={Margins.top8}>
                    You receive separate popups for Vesktop updates. You can also manually update by installing the <Link href="https://vesktop.dev/install">latest version</Link>.
                </Paragraph>
            </Card>

            {isVesktopOutdated && (
                <Card variant="warning">
                    <HeadingSecondary>Vesktop Outdated</HeadingSecondary>
                    <Flex flexDirection="column" gap="0.5em">
                        <Paragraph>Your version of Vesktop is outdated!</Paragraph>
                        <Button variant="link" onClick={() => VesktopNative.app.openUpdater()}>Open Vesktop Updater</Button>
                    </Flex>
                </Card>
            )}
        </Flex>
    );
}

function Updater() {
    const settings = useSettings([
        "autoUpdate",
        "autoUpdateNotification",
        "autoInject",
        "discordInstallBranch",
        "discordInstallLocation"
    ]);

    const [repo, err, repoPending] = useAwaiter(getRepo, {
        fallbackValue: "Loading...",
        onError: e => UpdateLogger.error("Failed to retrieve repo", err)
    });

    const commonProps: CommonProps = {
        repo,
        repoPending
    };

    return (
        <SettingsTab>
            <VesktopSection />

            <FormSwitch
                title="Automatically update"
                description="Check for updates on Discord launch and every 30 minutes. Pulls from your fork on GitHub, rebuilds, injects, and loads the new version before Discord opens."
                value={settings.autoUpdate}
                onChange={(v: boolean) => settings.autoUpdate = v}
            />
            <FormSwitch
                title="Automatically inject after update"
                description="Re-patch Discord with the latest build after each update (uses --branch auto by default, or your custom install path below)"
                value={settings.autoInject}
                onChange={(v: boolean) => settings.autoInject = v}
                disabled={!settings.autoUpdate}
            />
            <FormSwitch
                title="Get notified when an automatic update completes"
                description="Show a notification when Vencord automatically updates"
                value={settings.autoUpdateNotification}
                onChange={(v: boolean) => settings.autoUpdateNotification = v}
                disabled={!settings.autoUpdate}
            />

            <Forms.FormTitle tag="h5" className={Margins.top20}>Discord install</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                Used for auto-inject. Leave the custom path empty to patch by branch.
            </Forms.FormText>
            <Select
                options={[
                    { label: "Auto (first found)", value: "auto", default: true },
                    { label: "Stable", value: "stable" },
                    { label: "PTB", value: "ptb" },
                    { label: "Canary", value: "canary" },
                ]}
                select={v => settings.discordInstallBranch = v}
                isSelected={v => v === settings.discordInstallBranch}
                serialize={v => String(v)}
                closeOnSelect={true}
                disabled={!settings.autoInject || !!settings.discordInstallLocation}
            />
            <Forms.FormText className={Margins.top8}>Custom install path (optional)</Forms.FormText>
            <Forms.FormTextInput
                value={settings.discordInstallLocation}
                placeholder="C:\Users\you\AppData\Local\Discord"
                onChange={(v: string) => settings.discordInstallLocation = v}
                disabled={!settings.autoInject}
            />

            <Forms.FormTitle tag="h5" className={Margins.top20}>Repo</Forms.FormTitle>

            <Forms.FormText>
                {repoPending
                    ? repo
                    : err
                        ? "Failed to retrieve - check console"
                        : (
                            <Link href={repo}>
                                {repo.split("/").slice(-2).join("/")}
                            </Link>
                        )
                }
                {" "}
                (<HashLink hash={gitHash} repo={repo} disabled={repoPending} />)
            </Forms.FormText>

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <Forms.FormTitle tag="h5">Updates</Forms.FormTitle>

            {isNewer
                ? <Newer {...commonProps} />
                : <Updatable {...commonProps} />
            }
        </SettingsTab>
    );
}

export default IS_UPDATER_DISABLED
    ? null
    : wrapTab(Updater, "Updater");
