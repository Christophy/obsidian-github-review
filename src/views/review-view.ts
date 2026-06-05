import { ItemView, Notice, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type {
    ChangedFile,
    Comment,
    IssueDetail,
    PrDetail,
    Ref,
    ReviewEvent,
    ReviewThreadComment,
} from "../core/model";
import type { ReviewService } from "../core/review-service";
import { formatRelativeTime } from "../core/format";
import { renderMarkdown } from "../ui/render";
import { CommentBox } from "../ui/comment-box";
import { ReviewActions } from "../ui/review-actions";

export const VIEW_TYPE_REVIEW = "ghr-review";

export interface ReviewViewDeps {
    getReviewService: () => ReviewService | null;
    getViewerLogin: () => string | null;
    getPollSeconds: () => number;
    fetchMentionHandles: (ref: Ref) => Promise<string[]>;
}

/**
 * Main panel. Orchestrates: load detail -> render via ui components -> wire
 * actions -> on success re-fetch and re-render. Rendering details live in `ui/`.
 */
export class ReviewView extends ItemView {
    private ref: Ref | null = null;
    private commentsEl: HTMLElement | null = null;
    private commentsHeading: HTMLElement | null = null;
    private commentCount = 0;
    private mentionHandles: string[] = [];
    private readonly viewedFiles = new Set<string>();
    private lastSig = "";

    constructor(
        leaf: WorkspaceLeaf,
        private readonly deps: ReviewViewDeps,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_REVIEW;
    }

    getDisplayText(): string {
        return this.ref ? `${this.ref.type} #${this.ref.number}` : "GitHub review";
    }

    getIcon(): string {
        return "github";
    }

    /**
     * The plugin opens this view via setViewState with `{ ref }`. Going through
     * view state (rather than calling a method on leaf.view) is what makes this
     * work with Obsidian's deferred views — setState fires once the view loads.
     */
    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        const s = state as { ref?: Ref } | null;
        if (s?.ref) {
            this.ref = s.ref;
            this.viewedFiles.clear();
            this.lastSig = "";
            await this.refresh();
        }
    }

    getState(): Record<string, unknown> {
        return { ref: this.ref };
    }

    /** The issue/PR this view is showing, if any (used to target a new issue at the same repo). */
    currentRef(): Ref | null {
        return this.ref;
    }

    async onOpen(): Promise<void> {
        const seconds = this.deps.getPollSeconds();
        if (seconds > 0) {
            this.registerInterval(
                window.setInterval(() => void this.refresh({ silent: true }), seconds * 1000),
            );
        }
    }

    /** Fetch and render. `silent` polls quietly and only rebuilds when the data changed. */
    async refresh(opts: { silent?: boolean } = {}): Promise<void> {
        const root = this.contentEl;
        const service = this.deps.getReviewService();
        const ref = this.ref;

        if (!service || !ref) {
            if (!opts.silent) {
                root.empty();
                root.addClass("ghr-review-view");
                root.createDiv({ cls: "ghr-review-empty", text: "Open an item from the review queue." });
            }
            return;
        }

        if (!opts.silent) {
            root.empty();
            root.addClass("ghr-review-view");
            root.createDiv({ cls: "ghr-review-empty", text: "Loading…" });
        }

        let detail: PrDetail | IssueDetail;
        try {
            detail =
                ref.type === "pull"
                    ? await service.fetchPullRequest(ref)
                    : await service.fetchIssue(ref);
        } catch (err) {
            if (!opts.silent) {
                root.empty();
                root.createDiv({
                    cls: "ghr-review-empty",
                    text: `Failed to load: ${(err as Error).message}`,
                });
            }
            return;
        }

        const sig = JSON.stringify(detail);
        if (opts.silent && sig === this.lastSig) {
            return; // polled, nothing changed — leave the DOM (and any typing) untouched
        }
        this.lastSig = sig;

        // Preserve an in-progress comment draft and scroll position across the rebuild.
        const draft = this.captureDraft();
        const scrollTop = root.scrollTop;

        root.empty();
        root.addClass("ghr-review-view");

        this.mentionHandles = [];
        void this.deps.fetchMentionHandles(ref).then((handles) => {
            this.mentionHandles = handles;
        });

        if (ref.type === "pull") {
            await this.renderPr(root, detail as PrDetail, service);
        } else {
            // detail is PrDetail | IssueDetail, both assignable to IssueDetail — no cast needed.
            await this.renderIssue(root, detail, service);
        }

        this.restoreDraft(draft);
        root.scrollTop = scrollTop;
    }

    private captureDraft(): { comment: string } {
        const ta = this.contentEl.querySelector<HTMLTextAreaElement>(".ghr-comment-input");
        return { comment: ta?.value ?? "" };
    }

    private restoreDraft(draft: { comment: string }): void {
        if (!draft.comment) {
            return;
        }
        const ta = this.contentEl.querySelector<HTMLTextAreaElement>(".ghr-comment-input");
        if (ta) {
            ta.value = draft.comment;
        }
    }

    // ---------- rendering ----------

    private renderHeader(
        parent: HTMLElement,
        opts: { title: string; number: number; author: string; state: string; htmlUrl: string },
    ): void {
        const header = parent.createDiv({ cls: "ghr-header" });
        const titleRow = header.createDiv({ cls: "ghr-title-row" });
        titleRow.createEl("h2", { cls: "ghr-title", text: opts.title });
        titleRow.createEl("button", { cls: "ghr-refresh", text: "Refresh" }).addEventListener(
            "click",
            () => void this.refresh(),
        );
        const meta = header.createDiv({ cls: "ghr-meta" });
        meta.createSpan({ cls: `ghr-badge ghr-badge-${opts.state}`, text: opts.state });
        meta.createSpan({ text: ` #${opts.number} · by ${opts.author} · ` });
        meta.createEl("a", { text: "Open on GitHub", href: opts.htmlUrl });
    }

    private async renderBody(parent: HTMLElement, body: string): Promise<void> {
        const el = parent.createDiv({ cls: "ghr-body markdown-rendered" });
        await renderMarkdown(this.app, body || "_No description._", el, this);
    }

    private async renderComments(parent: HTMLElement, comments: Comment[]): Promise<void> {
        const section = parent.createDiv({ cls: "ghr-comments" });
        this.commentCount = comments.length;
        this.commentsHeading = section.createEl("h4", { text: `Comments (${comments.length})` });
        this.commentsEl = section.createDiv({ cls: "ghr-comment-list" });
        for (const c of comments) {
            await this.renderCommentCard(c);
        }
    }

    private async renderCommentCard(c: Comment): Promise<void> {
        if (!this.commentsEl) {
            return;
        }
        await this.renderCommentLike(this.commentsEl, c, "commented");
    }

    /** A GitHub-style comment: avatar + a card with a byline header and the body. */
    private async renderCommentLike(
        parent: HTMLElement,
        c: Comment,
        action: string,
    ): Promise<void> {
        const card = parent.createDiv({ cls: "ghr-comment" });
        this.renderAvatar(card, c.author, c.avatarUrl);

        const main = card.createDiv({ cls: "ghr-comment-main" });
        const head = main.createDiv({ cls: "ghr-comment-head" });
        head.createSpan({ cls: "ghr-comment-author", text: c.author });
        const meta = head.createSpan({ cls: "ghr-comment-meta" });
        meta.createSpan({ text: ` ${action} ` });
        meta.createEl("a", { text: formatRelativeTime(c.createdAt, new Date()), href: c.htmlUrl });

        const bodyEl = main.createDiv({ cls: "ghr-comment-body markdown-rendered" });
        await renderMarkdown(this.app, c.body, bodyEl, this);
    }

    private renderAvatar(parent: HTMLElement, name: string, url: string): void {
        if (url) {
            const img = parent.createEl("img", { cls: "ghr-avatar" });
            img.src = url;
            img.alt = name;
        } else {
            parent
                .createDiv({ cls: "ghr-avatar ghr-avatar-fallback" })
                .setText((name[0] ?? "?").toUpperCase());
        }
    }

    /** Optimistically show a just-posted comment (GitHub's read-after-write can lag a refetch). */
    private appendComment(c: Comment): void {
        this.commentCount += 1;
        this.commentsHeading?.setText(`Comments (${this.commentCount})`);
        void this.renderCommentCard(c);
    }

    private postCommentHandler(service: ReviewService, ref: Ref): (text: string) => Promise<void> {
        return async (text) => {
            try {
                const created = await service.postComment(ref, text);
                new Notice("Comment posted");
                this.appendComment(created);
            } catch (err) {
                new Notice((err as Error).message);
                throw err;
            }
        };
    }

    private async renderInlineThreads(
        parent: HTMLElement,
        comments: ReviewThreadComment[],
    ): Promise<void> {
        if (comments.length === 0) {
            return;
        }
        const section = parent.createDiv({ cls: "ghr-threads" });
        section.createEl("h4", { text: `Inline comments (${comments.length}, read-only)` });
        for (const c of comments) {
            const where = `on ${c.path}${c.line != null ? `:${c.line}` : ""}`;
            await this.renderCommentLike(section, c, `commented ${where}`);
        }
    }

    /** One changed file: collapsible, with a "Viewed" checkbox; markdown rendered, else a diff. */
    private async renderFile(parent: HTMLElement, file: ChangedFile): Promise<void> {
        const block = parent.createDiv({ cls: "ghr-file" });

        const header = block.createDiv({ cls: "ghr-file-header" });
        const chevron = header.createSpan({ cls: "ghr-file-chevron" });
        header.createSpan({ cls: "ghr-file-name", text: file.filename });
        header.createSpan({
            cls: "ghr-file-stats",
            text: `+${file.additions} −${file.deletions}`,
        });
        const viewedLabel = header.createEl("label", { cls: "ghr-file-viewed" });
        const checkbox = viewedLabel.createEl("input", { attr: { type: "checkbox" } });
        viewedLabel.createSpan({ text: "Viewed" });

        const body = block.createDiv({ cls: "ghr-file-body" });
        if (file.isMarkdown && file.content != null) {
            const el = body.createDiv({ cls: "ghr-doc-body markdown-rendered" });
            await renderMarkdown(this.app, file.content, el, this, file.filename);
        } else if (file.patch) {
            // Reuse Obsidian's own ```diff highlighting (Prism) rather than a custom renderer.
            const el = body.createDiv({ cls: "ghr-diff markdown-rendered" });
            await renderMarkdown(this.app, "```diff\n" + file.patch + "\n```", el, this, file.filename);
        } else {
            body.createDiv({
                cls: "ghr-review-empty",
                text: file.status === "removed" ? "File removed." : "No diff available.",
            });
        }

        let collapsed = this.viewedFiles.has(file.filename);
        const apply = (): void => {
            body.toggle(!collapsed);
            setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
            block.toggleClass("ghr-file-collapsed", collapsed);
        };
        checkbox.checked = collapsed;
        apply();

        header.addEventListener("click", () => {
            collapsed = !collapsed;
            apply();
        });
        viewedLabel.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
            collapsed = checkbox.checked;
            if (checkbox.checked) {
                this.viewedFiles.add(file.filename);
            } else {
                this.viewedFiles.delete(file.filename);
            }
            apply();
        });
    }

    private async renderIssue(
        root: HTMLElement,
        issue: IssueDetail,
        service: ReviewService,
    ): Promise<void> {
        this.renderHeader(root, {
            title: issue.title,
            number: issue.ref.number,
            author: issue.author,
            state: issue.state,
            htmlUrl: issue.htmlUrl,
        });
        await this.renderBody(root, issue.body);
        await this.renderComments(root, issue.comments);

        new CommentBox(root, {
            placeholder: "Leave a comment",
            onSubmit: this.postCommentHandler(service, issue.ref),
            secondaryLabel: "Close issue",
            onSecondary: (text) => this.closeHandler(service, issue.ref, text),
            getMentionHandles: () => this.mentionHandles,
        });
    }

    private async renderPr(root: HTMLElement, pr: PrDetail, service: ReviewService): Promise<void> {
        this.renderHeader(root, {
            title: pr.title,
            number: pr.ref.number,
            author: pr.author,
            state: pr.merged ? "merged" : pr.draft ? "draft" : pr.state,
            htmlUrl: pr.htmlUrl,
        });
        await this.renderBody(root, pr.body);

        // all changed files: markdown rendered, everything else as a unified diff
        if (pr.changedFiles.length > 0) {
            const section = root.createDiv({ cls: "ghr-files" });
            section.createEl("h4", { text: `Changed files (${pr.changedFiles.length})` });
            for (const file of pr.changedFiles) {
                await this.renderFile(section, file);
            }
        }

        // Review verdict (Comment / Approve / Request changes), kept with the changed
        // docs and separate from the conversation comment box below.
        const viewer = this.deps.getViewerLogin();
        const canApprove = viewer != null && viewer !== pr.author;
        new ReviewActions(root, {
            canApprove,
            cannotApproveReason:
                viewer === pr.author ? "GitHub doesn't let you approve your own pull request." : undefined,
            onSubmit: (event: ReviewEvent, body: string) =>
                this.runAction(() => service.submitReview(pr.ref, event, body), `Review submitted: ${event}`),
            getMentionHandles: () => this.mentionHandles,
        });

        await this.renderComments(root, pr.comments);
        await this.renderInlineThreads(root, pr.reviewComments);

        // Conversation comment box, like GitHub's: Comment + Close pull request.
        new CommentBox(root, {
            placeholder: "Leave a comment",
            onSubmit: this.postCommentHandler(service, pr.ref),
            secondaryLabel: "Close pull request",
            onSecondary: (text) => this.closeHandler(service, pr.ref, text),
            getMentionHandles: () => this.mentionHandles,
        });
    }

    /** Optionally post the typed comment, then close the issue/PR, then refresh. */
    private async closeHandler(service: ReviewService, ref: Ref, text: string): Promise<void> {
        try {
            if (text.trim()) {
                await service.postComment(ref, text);
            }
            await service.closeIssue(ref);
            new Notice(ref.type === "pull" ? "Pull request closed" : "Issue closed");
            await this.refresh();
        } catch (err) {
            new Notice((err as Error).message);
            throw err;
        }
    }

    /** Run a write action, surface success/error via Notice, then refresh on success. */
    private async runAction(action: () => Promise<void>, successMsg: string): Promise<void> {
        try {
            await action();
            new Notice(successMsg);
            await this.refresh();
        } catch (err) {
            new Notice((err as Error).message);
            throw err;
        }
    }
}
