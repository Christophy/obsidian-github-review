import { FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS, GitHubReviewSettingTab, type GitHubReviewSettings } from "./settings";
import { GitHubClient, parseJsonSafe, type HttpFn } from "./github/client";
import { QueueService } from "./core/queue-service";
import { ReviewService } from "./core/review-service";
import { MentionService } from "./core/mention-service";
import { IssueService } from "./core/issue-service";
import { QueueView, VIEW_TYPE_QUEUE } from "./views/queue-view";
import { ReviewView, VIEW_TYPE_REVIEW } from "./views/review-view";
import { parseGitHubRef } from "./core/github-ref";
import { readGitHubRemote } from "./git-detect";
import { UrlPromptModal } from "./ui/url-prompt";
import { NewIssueModal } from "./ui/new-issue-modal";
import process from "node:process";
import { join } from "node:path";
import {
    CLAUDIAN_MCP_DIR,
    CLAUDIAN_MCP_FILE,
    contextServerConfigJson,
    mergeContextServer,
    stripContextServer,
    type StdioServerSpec,
} from "./ai/claudian-config";
import {
    buildContextSnapshot,
    refKey,
    type ContextSnapshot,
    type ContextStore,
} from "./ai/context-snapshot";
import { MCP_STDIO_SOURCE } from "./mcp-stdio-source";
import type { PluginContext } from "./ai/plugin-context";
import type { Ref } from "./core/model";

/**
 * Adapts Obsidian's requestUrl to the client's HttpFn. `throw: false` lets us
 * inspect status. A `__GHR_TEST_HTTP__` global (set only by e2e tests) overrides
 * the real network so views can be driven with deterministic data in Obsidian.
 */
const obsidianHttp: HttpFn = async (req) => {
    const override = (window as unknown as Record<string, unknown>).__GHR_TEST_HTTP__ as
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
    // Don't use res.json — its getter does JSON.parse(text) and throws on an empty
    // body (e.g. a 304 Not Modified from an ETag conditional request).
    return { status: res.status, headers: res.headers, text: res.text, json: parseJsonSafe(res.text) };
};

export default class GitHubReviewPlugin extends Plugin {
    settings: GitHubReviewSettings = { ...DEFAULT_SETTINGS };
    queueService: QueueService | null = null;
    reviewService: ReviewService | null = null;
    issueService: IssueService | null = null;

    private client: GitHubClient | null = null;
    private viewerLogin: string | null = null;
    private vaultRepo: string | null = null;
    private mentionService: MentionService | null = null;
    private readonly mentionCache = new Map<string, string[]>();
    /** In-memory snapshots of the open review items, written to the store file the
     *  stdio MCP server reads. Keyed by ref. */
    private readonly contextItems = new Map<string, ContextSnapshot>();
    private lastStoreSig = "";

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
                    newIssue: () => this.newIssue(),
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
        this.addCommand({
            id: "new-issue",
            name: "Create new issue",
            callback: () => void this.newIssue(),
        });
        this.addCommand({
            id: "copy-mcp-config",
            name: "Copy AI client config",
            callback: () => this.copyContextServerConfig(),
        });

        this.addSettingTab(new GitHubReviewSettingTab(this.app, this));

        void this.startContextIntegration();

        // Keep the context store in sync with the open / active review tabs.
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => void this.refreshContextStore()),
        );
        this.registerEvent(
            this.app.workspace.on("layout-change", () => void this.refreshContextStore()),
        );
    }

    /** Context for a ref's tool handlers, or null if GitHub isn't configured. */
    private contextFor(ref: Ref): PluginContext | null {
        return this.client && this.reviewService
            ? { client: this.client, review: this.reviewService, ref }
            : null;
    }

    private activeReviewRef(): Ref | null {
        return (
            this.app.workspace.getActiveViewOfType(ReviewView)?.currentRef() ??
            this.firstOpenReviewRef()
        );
    }

    private vaultBasePath(): string | null {
        const adapter = this.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
    }

    /**
     * The stdio MCP server entry: Obsidian's own Node (process.execPath with
     * ELECTRON_RUN_AS_NODE) runs our shipped script, which reads the store file —
     * no port, no separate Node install, no token.
     */
    private stdioSpec(): StdioServerSpec | null {
        const base = this.vaultBasePath();
        const dir = this.manifest.dir;
        if (!base || !dir) {
            return null;
        }
        return {
            command: process.execPath,
            args: [join(base, dir, "mcp-stdio.js"), join(base, dir, "context.json")],
            env: { ELECTRON_RUN_AS_NODE: "1" },
        };
    }

    /** Vault-relative path of the store file (inside the plugin's own folder). */
    private storeFilePath(): string | null {
        const dir = this.manifest.dir;
        return dir ? `${dir}/context.json` : null;
    }

    /** Enable the Claudian integration: write the server + the stdio config + the store. */
    private async startContextIntegration(): Promise<void> {
        if (!this.settings.contextServerEnabled) {
            return;
        }
        await this.writeStdioServer();
        await this.writeClaudianConfig();
        await this.refreshContextStore(true);
    }

    /**
     * Materialize the bundled stdio MCP server to <plugin>/mcp-stdio.js. It's
     * embedded in main.js (not shipped as a separate file), because Obsidian's
     * community installer only delivers main.js / manifest.json / styles.css.
     */
    private async writeStdioServer(): Promise<void> {
        const dir = this.manifest.dir;
        if (!dir) {
            return;
        }
        try {
            await this.app.vault.adapter.write(`${dir}/mcp-stdio.js`, MCP_STDIO_SOURCE);
        } catch {
            // best-effort
        }
    }

    /** Re-apply after the enable toggle changes. */
    async restartContextIntegration(): Promise<void> {
        if (this.settings.contextServerEnabled) {
            await this.startContextIntegration();
        } else {
            await this.removeClaudianConfig();
            await this.removeStdioServerFiles();
        }
    }

    /** Clean up the files we wrote, when the integration is turned off. */
    private async removeStdioServerFiles(): Promise<void> {
        const dir = this.manifest.dir;
        if (!dir) {
            return;
        }
        const adapter = this.app.vault.adapter;
        for (const path of [`${dir}/mcp-stdio.js`, `${dir}/context.json`]) {
            try {
                if (await adapter.exists(path)) {
                    await adapter.remove(path);
                }
            } catch {
                // best-effort
            }
        }
    }

    /**
     * Write the open review items to the store file the stdio server reads. Re-fetches
     * only the active item (ETag-cheap) and skips entirely when nothing changed.
     */
    private async refreshContextStore(force = false): Promise<void> {
        if (!this.settings.contextServerEnabled) {
            return;
        }
        const storePath = this.storeFilePath();
        if (!storePath) {
            return;
        }
        const openKeys = new Set<string>();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)) {
            const ref = leaf.view instanceof ReviewView ? leaf.view.currentRef() : null;
            if (ref) {
                openKeys.add(refKey(ref));
            }
        }
        const activeRef = this.activeReviewRef();
        const activeKey = activeRef ? refKey(activeRef) : null;
        const sig = `${activeKey ?? ""}|${[...openKeys].sort().join(",")}`;
        if (!force && sig === this.lastStoreSig) {
            return;
        }
        this.lastStoreSig = sig;
        for (const key of [...this.contextItems.keys()]) {
            if (!openKeys.has(key)) {
                this.contextItems.delete(key); // tab closed
            }
        }
        if (activeRef && activeKey) {
            const ctx = this.contextFor(activeRef);
            if (ctx) {
                try {
                    this.contextItems.set(activeKey, await buildContextSnapshot(ctx));
                } catch {
                    // keep any previous snapshot for this item
                }
            }
        }
        const store: ContextStore = { current: activeKey, items: Object.fromEntries(this.contextItems) };
        try {
            await this.app.vault.adapter.write(storePath, JSON.stringify(store, null, 2));
        } catch {
            // best-effort
        }
    }

    /** Merge our stdio server into <vault>/.claude/mcp.json, preserving anything else. */
    private async writeClaudianConfig(): Promise<void> {
        const spec = this.stdioSpec();
        if (!spec) {
            return;
        }
        const adapter = this.app.vault.adapter;
        try {
            const existing = (await adapter.exists(CLAUDIAN_MCP_FILE))
                ? parseJsonSafe(await adapter.read(CLAUDIAN_MCP_FILE))
                : null;
            const merged = mergeContextServer(existing, spec);
            if (!(await adapter.exists(CLAUDIAN_MCP_DIR))) {
                await adapter.mkdir(CLAUDIAN_MCP_DIR);
            }
            await adapter.write(CLAUDIAN_MCP_FILE, JSON.stringify(merged, null, 2));
        } catch {
            // best-effort; the "Copy config" command is the manual fallback
        }
    }

    /** Remove our entry from <vault>/.claude/mcp.json (when the server is turned off). */
    private async removeClaudianConfig(): Promise<void> {
        const adapter = this.app.vault.adapter;
        try {
            if (!(await adapter.exists(CLAUDIAN_MCP_FILE))) {
                return;
            }
            const stripped = stripContextServer(parseJsonSafe(await adapter.read(CLAUDIAN_MCP_FILE)));
            await adapter.write(CLAUDIAN_MCP_FILE, JSON.stringify(stripped, null, 2));
        } catch {
            // best-effort
        }
    }

    /** The MCP config a Claude client needs to reach this server, or null if off. */
    contextServerConfig(): string | null {
        if (!this.settings.contextServerEnabled) {
            return null;
        }
        const spec = this.stdioSpec();
        return spec ? contextServerConfigJson(spec) : null;
    }

    copyContextServerConfig(): void {
        const config = this.contextServerConfig();
        if (!config) {
            new Notice("Context server is off. Enable it in the plugin settings.");
            return;
        }
        void navigator.clipboard.writeText(config);
        new Notice("MCP config copied. Add it in your Claude client (or <vault>/.claude/mcp.json).");
    }

    async loadSettings(): Promise<void> {
        const data = (await this.loadData()) as
            | (Partial<GitHubReviewSettings> & { settings?: Partial<GitHubReviewSettings> })
            | null;
        // Back-compat: a short-lived version wrapped settings in a { settings } envelope.
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? data ?? {});
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
            this.issueService = new IssueService(this.client);
            this.mentionService = new MentionService(this.client);
            void this.refreshViewer();
        } else {
            this.client = null;
            this.queueService = null;
            this.reviewService = null;
            this.issueService = null;
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
            await this.refreshContextStore(true);
            return;
        }
        const leaf = workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW_TYPE_REVIEW, active: true, state: { ref } });
        await workspace.revealLeaf(leaf);
        await this.refreshContextStore(true);
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

    /** Compose and create a new issue, following the target repo's templates. */
    async newIssue(): Promise<void> {
        const service = this.issueService;
        if (!service) {
            new Notice("Set your GitHub token in settings first.");
            return;
        }
        // Prefer the repo of the PR/issue you're viewing, then the queue's scope,
        // then any open review tab — so "New issue" works wherever you trigger it.
        const activeRef = this.app.workspace.getActiveViewOfType(ReviewView)?.currentRef() ?? null;
        const target =
            (activeRef && `${activeRef.owner}/${activeRef.repo}`) ||
            this.queueRepos()[0] ||
            this.anyOpenReviewRepo();
        const [owner, repo] = target?.split("/") ?? [];
        if (!owner || !repo) {
            new Notice(
                "No GitHub repo found. Open an issue or pull request, or set a repository in settings.",
            );
            return;
        }

        // Load @mention handles in the background; the modal opens immediately.
        let handles: string[] = [];
        void this.mentionHandlesFor({ owner, repo, number: 0, type: "issue" }).then((h) => {
            handles = h;
        });

        new NewIssueModal(this.app, {
            repoLabel: `${owner}/${repo}`,
            loadTemplates: () => service.listTemplates(owner, repo),
            getMentionHandles: () => handles,
            onSubmit: async (title, body, labels) => {
                try {
                    const ref = await service.createIssue(owner, repo, title, body, labels);
                    new Notice("Issue created");
                    await this.openReview(ref);
                    this.refreshQueueViews();
                } catch (err) {
                    new Notice((err as Error).message);
                    throw err;
                }
            },
        }).open();
    }

    /** The repo of any currently-open review tab, if any. */
    private anyOpenReviewRepo(): string | undefined {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)) {
            const ref = leaf.view instanceof ReviewView ? leaf.view.currentRef() : null;
            if (ref) {
                return `${ref.owner}/${ref.repo}`;
            }
        }
        return undefined;
    }

    private firstOpenReviewRef(): Ref | null {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)) {
            const ref = leaf.view instanceof ReviewView ? leaf.view.currentRef() : null;
            if (ref) {
                return ref;
            }
        }
        return null;
    }

}
