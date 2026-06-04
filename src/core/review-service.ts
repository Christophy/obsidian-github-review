import type { GitHubClient } from "../github/client";
import type { RawPullFile } from "../github/types";
import type {
    ChangedFile,
    Comment,
    IssueDetail,
    PrDetail,
    Ref,
    ReviewEvent,
} from "./model";
import {
    buildReviewPayload,
    decodeBase64Content,
    isMarkdownFile,
    mapComment,
    mapIssue,
    mapPull,
} from "./mappers";

/**
 * Stateless. Reads an issue or PR into a domain object and performs write actions
 * (comment / review / labels / close). Views call this, then re-fetch to refresh.
 */
export class ReviewService {
    constructor(private readonly client: GitHubClient) {}

    async fetchIssue(ref: Ref): Promise<IssueDetail> {
        const [raw, comments] = await Promise.all([
            this.client.getIssue(ref.owner, ref.repo, ref.number),
            this.client.listIssueComments(ref.owner, ref.repo, ref.number),
        ]);
        return mapIssue(ref, raw, comments);
    }

    async fetchPullRequest(ref: Ref): Promise<PrDetail> {
        const [raw, files, comments, reviewComments] = await Promise.all([
            this.client.getPullRequest(ref.owner, ref.repo, ref.number),
            this.client.listPullFiles(ref.owner, ref.repo, ref.number),
            // PR "conversation" comments are issue comments.
            this.client.listIssueComments(ref.owner, ref.repo, ref.number),
            this.client.listPullReviewComments(ref.owner, ref.repo, ref.number),
        ]);
        const changedFiles = await this.fetchChangedFiles(ref, raw.head.sha, files);
        return mapPull(ref, raw, changedFiles, comments, reviewComments);
    }

    private async fetchChangedFiles(
        ref: Ref,
        headSha: string,
        files: RawPullFile[],
    ): Promise<ChangedFile[]> {
        return Promise.all(
            files.map(async (f): Promise<ChangedFile> => {
                const base = {
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions ?? 0,
                    deletions: f.deletions ?? 0,
                    isMarkdown: isMarkdownFile(f.filename),
                };
                // Markdown design docs are shown rendered (their main value); fetch content.
                if (base.isMarkdown && f.status !== "removed") {
                    const raw = await this.client.getContent(ref.owner, ref.repo, f.filename, headSha);
                    return { ...base, content: decodeBase64Content(raw), patch: null };
                }
                // Everything else is shown as a unified diff.
                return { ...base, content: null, patch: f.patch ?? null };
            }),
        );
    }

    async postComment(ref: Ref, body: string): Promise<Comment> {
        const raw = await this.client.createIssueComment(ref.owner, ref.repo, ref.number, body);
        return mapComment(raw);
    }

    async submitReview(ref: Ref, event: ReviewEvent, body: string): Promise<void> {
        const payload = buildReviewPayload(event, body);
        await this.client.submitReview(
            ref.owner,
            ref.repo,
            ref.number,
            payload.event,
            payload.body,
        );
    }

    async closeIssue(ref: Ref): Promise<void> {
        await this.client.setIssueState(ref.owner, ref.repo, ref.number, "closed");
    }
}
