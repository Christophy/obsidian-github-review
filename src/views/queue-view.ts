import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { QueueItem, Ref, RefType } from "../core/model";
import type { QueueService } from "../core/queue-service";

export const VIEW_TYPE_QUEUE = "ghr-queue";

export interface QueueViewDeps {
    getQueueService: () => QueueService | null;
    getQueueRepos: () => string[];
    getScopeLabel: () => string;
    getShowClosed: () => boolean;
    getPollSeconds: () => number;
    openReview: (ref: Ref) => Promise<void>;
}

/** Sidebar of the scoped repo(s)' issues & PRs, split into PR / Issue tabs. */
export class QueueView extends ItemView {
    private items: QueueItem[] = [];
    private activeTab: RefType = "pull";
    private lastSig = "";

    constructor(
        leaf: WorkspaceLeaf,
        private readonly deps: QueueViewDeps,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_QUEUE;
    }

    getDisplayText(): string {
        return "GitHub review queue";
    }

    getIcon(): string {
        return "git-pull-request";
    }

    async onOpen(): Promise<void> {
        await this.refresh();
        const seconds = this.deps.getPollSeconds();
        if (seconds > 0) {
            this.registerInterval(
                window.setInterval(() => void this.refresh({ silent: true }), seconds * 1000),
            );
        }
    }

    /** Fetch and render. `silent` polls quietly and only re-renders when something changed. */
    async refresh(opts: { silent?: boolean } = {}): Promise<void> {
        const service = this.deps.getQueueService();
        const repos = this.deps.getQueueRepos();

        if (!service) {
            this.lastSig = "";
            if (!opts.silent) {
                this.renderMessage("Set your GitHub token in settings to load issues & PRs.");
            }
            return;
        }
        if (repos.length === 0) {
            this.lastSig = "";
            if (!opts.silent) {
                this.renderMessage(
                    "No GitHub repo for this vault. Open a vault whose git remote is on GitHub, or set repositories in settings.",
                );
            }
            return;
        }

        let items: QueueItem[];
        try {
            items = await service.fetchItems({ repos, includeClosed: this.deps.getShowClosed() });
        } catch (err) {
            this.lastSig = "";
            if (!opts.silent) {
                this.renderMessage(`Failed to load: ${(err as Error).message}`);
            }
            return;
        }

        const sig = JSON.stringify({
            items,
            label: this.deps.getScopeLabel(),
            closed: this.deps.getShowClosed(),
        });
        if (opts.silent && sig === this.lastSig) {
            return;
        }
        this.lastSig = sig;
        this.items = items;
        this.render();
    }

    private renderHeader(root: HTMLElement): void {
        const header = root.createDiv({ cls: "ghr-queue-header" });
        const titles = header.createDiv();
        titles.createEl("h4", { text: this.deps.getScopeLabel() });
        titles.createEl("div", {
            cls: "ghr-queue-sub",
            text: this.deps.getShowClosed() ? "All issues & PRs" : "Open issues & PRs",
        });
        header.createEl("button", { text: "Refresh" }).addEventListener("click", () => {
            void this.refresh();
        });
    }

    private renderMessage(text: string): void {
        const root = this.contentEl;
        root.empty();
        root.addClass("ghr-queue-view");
        this.renderHeader(root);
        root.createDiv({ cls: "ghr-queue-empty", text });
    }

    private render(): void {
        const root = this.contentEl;
        root.empty();
        root.addClass("ghr-queue-view");
        this.renderHeader(root);

        const body = root.createDiv({ cls: "ghr-queue-body" });
        const prs = this.items.filter((i) => i.ref.type === "pull");
        const issues = this.items.filter((i) => i.ref.type === "issue");

        const tabs = body.createDiv({ cls: "ghr-tabs" });
        this.renderTab(tabs, "pull", `Pull requests (${prs.length})`);
        this.renderTab(tabs, "issue", `Issues (${issues.length})`);

        const list = body.createDiv({ cls: "ghr-queue-list" });
        this.renderItems(list, this.activeTab === "pull" ? prs : issues);
    }

    private renderTab(tabs: HTMLElement, type: RefType, label: string): void {
        const btn = tabs.createEl("button", { text: label, cls: "ghr-tab" });
        if (this.activeTab === type) {
            btn.addClass("ghr-tab-active");
        }
        btn.addEventListener("click", () => {
            if (this.activeTab !== type) {
                this.activeTab = type;
                this.render();
            }
        });
    }

    private renderItems(list: HTMLElement, items: QueueItem[]): void {
        if (items.length === 0) {
            list.createDiv({
                cls: "ghr-queue-empty",
                text: this.activeTab === "pull" ? "No pull requests." : "No issues.",
            });
            return;
        }
        const byRepo = groupByRepo(items);
        const showRepoHeaders = byRepo.size > 1;
        for (const [repo, group] of byRepo) {
            if (showRepoHeaders) {
                list.createEl("div", { cls: "ghr-queue-repo", text: repo });
            }
            for (const item of group) {
                const row = list.createDiv({ cls: "ghr-queue-item" });
                if (item.state !== "open") {
                    row.addClass("ghr-queue-item-closed");
                }
                setIcon(
                    row.createSpan({ cls: "ghr-queue-icon" }),
                    item.ref.type === "pull" ? "git-pull-request" : "circle-dot",
                );
                row.createSpan({
                    cls: "ghr-queue-title",
                    text: `#${item.ref.number} ${item.title}`,
                });
                row.addEventListener("click", () => void this.deps.openReview(item.ref));
            }
        }
    }
}

function groupByRepo(items: QueueItem[]): Map<string, QueueItem[]> {
    const map = new Map<string, QueueItem[]>();
    for (const item of items) {
        const arr = map.get(item.repoFullName) ?? [];
        arr.push(item);
        map.set(item.repoFullName, arr);
    }
    return map;
}
