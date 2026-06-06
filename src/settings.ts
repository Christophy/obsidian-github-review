import { App, PluginSettingTab, Setting } from "obsidian";
import type GitHubReviewPlugin from "./main";

export interface GitHubReviewSettings {
    token: string;
    /** When true, scope the queue to the GitHub repo this vault belongs to. */
    followVaultRepo: boolean;
    /** "owner/repo" entries used when not following the vault repo (or none detected). */
    repos: string[];
    /** When true, the queue also lists closed/merged issues & PRs. */
    showClosed: boolean;
    /** Auto-refresh interval (seconds) for open views; 0 disables polling. */
    pollSeconds: number;
    /** Expose the open PR/issue to a Claude client via a local stdio MCP server. */
    contextServerEnabled: boolean;
}

export const DEFAULT_SETTINGS: GitHubReviewSettings = {
    token: "",
    followVaultRepo: true,
    repos: [],
    showClosed: false,
    pollSeconds: 30,
    contextServerEnabled: true,
};

export class GitHubReviewSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private readonly plugin: GitHubReviewPlugin,
    ) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("GitHub token")
            .setDesc(
                "Fine-grained personal access token. Stored in plaintext in this vault's data.json — don't sync the vault anywhere untrusted.",
            )
            .addText((text) => {
                text.inputEl.type = "password";
                text.setPlaceholder("Fine-grained personal access token")
                    .setValue(this.plugin.settings.token)
                    .onChange(async (value) => {
                        this.plugin.settings.token = value.trim();
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Follow this vault's GitHub repository")
            .setDesc(
                "Show open issues and pull requests for the repository this vault belongs to (detected from its Git remote). Turn off to use the manual list below.",
            )
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.followVaultRepo).onChange(async (value) => {
                    this.plugin.settings.followVaultRepo = value;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("Repositories")
            .setDesc(
                "Used when the toggle above is off, or when no repo is detected for this vault. One owner/repo per line.",
            )
            .addTextArea((ta) => {
                ta.inputEl.rows = 5;
                ta.setPlaceholder("One owner/repo per line")
                    .setValue(this.plugin.settings.repos.join("\n"))
                    .onChange(async (value) => {
                        this.plugin.settings.repos = value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Include closed issues & pull requests")
            .setDesc("Also list closed and merged items in the queue, not just open ones.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showClosed).onChange(async (value) => {
                    this.plugin.settings.showClosed = value;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("Auto-refresh interval (seconds)")
            .setDesc(
                "Poll open views for updates using cheap conditional requests (304s are free). 0 disables polling. Takes effect when a view is next opened.",
            )
            .addText((text) => {
                text.inputEl.type = "number";
                text.setValue(String(this.plugin.settings.pollSeconds)).onChange(async (value) => {
                    const n = Number(value);
                    this.plugin.settings.pollSeconds = Number.isFinite(n) && n >= 0 ? n : 0;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl).setName("AI client integration").setHeading();
        new Setting(containerEl)
            .setName("Expose the open issue or pull request to AI clients")
            .setDesc(
                "Let an external AI client read the pull request or issue you're viewing. No port, no token, read-only. The config is written to your vault's .claude/mcp.json automatically, so a client like Claudian picks it up on reload — you don't add anything by hand.",
            )
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.contextServerEnabled).onChange(async (value) => {
                    this.plugin.settings.contextServerEnabled = value;
                    await this.plugin.saveData(this.plugin.settings);
                    await this.plugin.restartContextIntegration();
                }),
            );

        if (this.plugin.settings.contextServerEnabled) {
            new Setting(containerEl)
                .setName("Other AI clients")
                .setDesc(
                    "The recommended client needs no setup (see above). For another client, copy the config and add it there.",
                )
                .addButton((btn) =>
                    btn.setButtonText("Copy config").onClick(() => this.plugin.copyContextServerConfig()),
                );
        }
    }
}
