import type {
    RawComment,
    RawContent,
    RawIssue,
    RawPull,
    RawReviewComment,
    RawSearchItem,
} from "../github/types";
import type {
    ChangedFile,
    Comment,
    IssueDetail,
    PrDetail,
    QueueItem,
    Ref,
    ReviewEvent,
    ReviewThreadComment,
} from "./model";

const UNKNOWN_USER = "(unknown)";

export function mapComment(raw: RawComment): Comment {
    return {
        id: raw.id,
        author: raw.user?.login ?? UNKNOWN_USER,
        avatarUrl: raw.user?.avatar_url ?? "",
        body: raw.body ?? "",
        createdAt: raw.created_at,
        htmlUrl: raw.html_url,
    };
}

function mapReviewComment(raw: RawReviewComment): ReviewThreadComment {
    return {
        ...mapComment(raw),
        path: raw.path,
        line: raw.line,
        diffHunk: raw.diff_hunk,
    };
}

export function mapIssue(ref: Ref, raw: RawIssue, comments: RawComment[]): IssueDetail {
    return {
        ref,
        title: raw.title,
        author: raw.user?.login ?? UNKNOWN_USER,
        state: raw.state,
        body: raw.body ?? "",
        labels: raw.labels.map((l) => l.name),
        htmlUrl: raw.html_url,
        comments: comments.map(mapComment),
    };
}

export function mapPull(
    ref: Ref,
    raw: RawPull,
    changedFiles: ChangedFile[],
    comments: RawComment[],
    reviewComments: RawReviewComment[],
): PrDetail {
    return {
        ref,
        title: raw.title,
        author: raw.user?.login ?? UNKNOWN_USER,
        state: raw.state,
        merged: raw.merged,
        draft: raw.draft ?? false,
        body: raw.body ?? "",
        labels: raw.labels.map((l) => l.name),
        htmlUrl: raw.html_url,
        headSha: raw.head.sha,
        changedFiles,
        comments: comments.map(mapComment),
        reviewComments: reviewComments.map(mapReviewComment),
    };
}

export function mapSearchItem(raw: RawSearchItem): QueueItem {
    const { owner, repo } = parseRepositoryUrl(raw.repository_url);
    return {
        ref: {
            owner,
            repo,
            number: raw.number,
            type: raw.pull_request ? "pull" : "issue",
        },
        title: raw.title,
        state: raw.state ?? "open",
        repoFullName: `${owner}/${repo}`,
        author: raw.user?.login ?? UNKNOWN_USER,
        updatedAt: raw.updated_at,
        htmlUrl: raw.html_url,
    };
}

export function parseRepositoryUrl(repositoryUrl: string): { owner: string; repo: string } {
    const m = repositoryUrl.match(/\/repos\/([^/]+)\/([^/]+)\/?$/);
    const owner = m?.[1];
    const repo = m?.[2];
    if (!owner || !repo) {
        throw new Error(`Unexpected repository_url: ${repositoryUrl}`);
    }
    return { owner, repo };
}

export function isMarkdownFile(filename: string): boolean {
    return /\.(md|markdown)$/i.test(filename);
}

/** Decode a GitHub Contents API payload (base64, often line-wrapped) to UTF-8 text. */
export function decodeBase64Content(raw: RawContent): string {
    if (raw.encoding !== "base64") {
        return raw.content;
    }
    const cleaned = raw.content.replace(/\s/g, "");
    const binary = atob(cleaned);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Assemble and validate a PR review submission. GitHub requires a comment body
 * for REQUEST_CHANGES and COMMENT events; APPROVE may be empty.
 */
export function buildReviewPayload(
    event: ReviewEvent,
    body: string,
): { event: ReviewEvent; body: string } {
    if ((event === "REQUEST_CHANGES" || event === "COMMENT") && body.trim() === "") {
        throw new Error(`A "${event}" review requires a non-empty comment.`);
    }
    return { event, body };
}
