import { FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS, GitHubReviewSettingTab, type GitHubReviewSettings } from "./settings";
import { GitHubClient, type HttpFn } from "./github/client";
import { QueueService } from "./core/queue-service";
import { ReviewService } from "./core/review-service";
import { MentionService } from "./core/mention-service";
import { QueueView, VIEW_TYPE_QUEUE } from "./views/queue-view";
import { ReviewView, VIEW_TYPE_REVIEW } from "./views/review-view";
import { parseGitHubRef } from "./core/github-ref";
import { readGitHubRemote } from "./git-detect";
import { UrlPromptModal } from "./ui/url-prompt";
import type { Ref } from "./core/model";

/**
 * Adapts Obsidian's requestUrl to the client's HttpFn. `throw: false` lets us
 * inspect status. A `__GHR_TEST_HTTP__` global (set only by e2e tests) overrides
 * the real network so views can be driven with deterministic data in Obsidian.
 */
const obsidianHttp: HttpFn = async (req) => {
    const override = (globalThis as Record<string, unknown>).__GHR_TEST_HTTP__ as
        | HttpFn
        | undefined;
    if (override) {
        return override(req);
    }
    const res = await requestUrl({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
        throw: false,
    });
    return { status: res.status, headers: res.headers, text: res.text, json: res.json };
};

export default class GitHubReviewPlugin extends Plugin {
    settings: GitHubReviewSettings = { ...DEFAULT_SETTINGS };
    queueService: QueueService | null = null;
    reviewService: ReviewService | null = null;

    private client: GitHubClient | null = null;
    private viewerLogin: string | null = null;
    private vaultRepo: string | null = null;
    private mentionService: MentionService | null = null;
    private readonly mentionCache = new Map<string, string[]>();

    async onload(): Promise<void> {
        await this.loadSettings();
        this.rebuildClient();
        await this.detectVaultRepo();

        this.registerView(
            VIEW_TYPE_QUEUE,
            (leaf) =>
                new QueueView(leaf, {
                    getQueueService: () => this.queueService,
                    getQueueRepos: () => this.queueRepos(),
                    getScopeLabel: () => this.scopeLabel(),
                    getShowClosed: () => this.settings.showClosed,
                    getPollSeconds: () => this.settings.pollSeconds,
                    openReview: (ref) => this.openReview(ref),
                }),
        );
        this.registerView(
            VIEW_TYPE_REVIEW,
            (leaf) =>
                new ReviewView(leaf, {
                    getReviewService: () => this.reviewService,
                    getViewerLogin: () => this.viewerLogin,
                    getPollSeconds: () => this.settings.pollSeconds,
                    fetchMentionHandles: (ref) => this.mentionHandlesFor(ref),
                }),
        );

        this.addRibbonIcon("git-pull-request", "GitHub review queue", () => {
            void this.activateQueue();
        });

        this.addCommand({
            id: "open-queue",
            name: "Open review queue",
            callback: () => void this.activateQueue(),
        });
        this.addCommand({
            id: "open-by-url",
            name: "Open issue or pull request by URL",
            callback: () => this.openByUrl(),
        });

        this.addSettingTab(new GitHubReviewSettingTab(this.app, this));
    }

    async loadSettings(): Promise<void> {
        const data = (await this.loadData()) as Partial<GitHubReviewSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.rebuildClient();
        this.refreshQueueViews();
    }

    private refreshQueueViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QUEUE)) {
            const view = leaf.view;
            if (view instanceof QueueView) {
                void view.refresh();
            }
        }
    }

    /** Rebuild the client + services from the current token (the one wiring point). */
    private rebuildClient(): void {
        this.mentionCache.clear();
        if (this.settings.token) {
            this.client = new GitHubClient({ token: this.settings.token, request: obsidianHttp });
            this.queueService = new QueueService(this.client);
            this.reviewService = new ReviewService(this.client);
            this.mentionService = new MentionService(this.client);
            void this.refreshViewer();
        } else {
            this.client = null;
            this.queueService = null;
            this.reviewService = null;
            this.mentionService = null;
            this.viewerLogin = null;
        }
    }

    /** @mention handles for the apps installed on a ref's repo (cached per repo). */
    private async mentionHandlesFor(ref: Ref): Promise<string[]> {
        const key = `${ref.owner}/${ref.repo}`;
        const cached = this.mentionCache.get(key);
        if (cached) {
            return cached;
        }
        if (!this.mentionService) {
            return [];
        }
        try {
            const handles = await this.mentionService.discoverAppHandles(ref.owner, ref.repo);
            this.mentionCache.set(key, handles);
            return handles;
        } catch {
            return [];
        }
    }

    private async refreshViewer(): Promise<void> {
        try {
            this.viewerLogin = this.client ? (await this.client.getViewer()).login : null;
        } catch {
            this.viewerLogin = null;
        }
    }

    /** Detect the GitHub repo this vault belongs to (desktop only; reads its git remote). */
    private async detectVaultRepo(): Promise<void> {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            this.vaultRepo = null;
            return;
        }
        this.vaultRepo = await readGitHubRemote(adapter.getBasePath());
    }

    /** Repos the queue should show: the vault's repo when following, else the manual list. */
    private queueRepos(): string[] {
        if (this.settings.followVaultRepo && this.vaultRepo) {
            return [this.vaultRepo];
        }
        return this.settings.repos;
    }

    private scopeLabel(): string {
        const repos = this.queueRepos();
        if (repos.length > 0) {
            return repos.join(", ");
        }
        return this.settings.followVaultRepo
            ? "No GitHub repo detected for this vault"
            : "No repositories set";
    }

    async activateQueue(): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_QUEUE)[0] ?? null;
        if (!leaf) {
            leaf = workspace.getLeftLeaf(false) ?? workspace.getLeftLeaf(true);
            if (!leaf) {
                return;
            }
            await leaf.setViewState({ type: VIEW_TYPE_QUEUE, active: true });
        }
        await workspace.revealLeaf(leaf);
    }

    async openReview(ref: Ref): Promise<void> {
        const { workspace } = this.app;
        // Reuse a tab already showing this exact item instead of opening a duplicate.
        const existing = workspace.getLeavesOfType(VIEW_TYPE_REVIEW).find((leaf) => {
            const open = (leaf.getViewState().state as { ref?: Ref } | undefined)?.ref;
            return (
                open != null &&
                open.owner === ref.owner &&
                open.repo === ref.repo &&
                open.number === ref.number &&
                open.type === ref.type
            );
        });
        if (existing) {
            await workspace.revealLeaf(existing);
            return;
        }
        const leaf = workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW_TYPE_REVIEW, active: true, state: { ref } });
        await workspace.revealLeaf(leaf);
    }

    private openByUrl(): void {
        new UrlPromptModal(this.app, (url) => {
            try {
                const ref = parseGitHubRef(url);
                void this.openReview(ref);
            } catch (err) {
                new Notice((err as Error).message);
            }
        }).open();
    }
}
