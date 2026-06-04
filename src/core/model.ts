/**
 * Domain types. Views and services speak these; nobody outside `github/` sees
 * raw GitHub API shapes. Mappers (`core/mappers.ts`) convert raw -> these.
 */

export type RefType = "issue" | "pull";

/** Points at a single issue or pull request. */
export interface Ref {
    owner: string;
    repo: string;
    number: number;
    type: RefType;
}

export interface Comment {
    id: number;
    author: string;
    avatarUrl: string;
    body: string;
    createdAt: string;
    htmlUrl: string;
}

/** A comment inside an existing inline review thread. v1 displays these read-only. */
export interface ReviewThreadComment extends Comment {
    path: string;
    line: number | null;
    diffHunk: string;
}

/** A file changed in a PR. Markdown is shown rendered; everything else as a diff. */
export interface ChangedFile {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    isMarkdown: boolean;
    /** Full file content at the PR head, for rendering (markdown files only). */
    content: string | null;
    /** Unified diff hunks (non-markdown files). */
    patch: string | null;
}

export interface IssueDetail {
    ref: Ref;
    title: string;
    author: string;
    state: string;
    body: string;
    labels: string[];
    htmlUrl: string;
    comments: Comment[];
}

export interface PrDetail {
    ref: Ref;
    title: string;
    author: string;
    state: string;
    merged: boolean;
    draft: boolean;
    body: string;
    labels: string[];
    htmlUrl: string;
    headSha: string;
    changedFiles: ChangedFile[];
    comments: Comment[];
    reviewComments: ReviewThreadComment[];
}

export interface QueueItem {
    ref: Ref;
    title: string;
    state: string;
    repoFullName: string;
    author: string;
    updatedAt: string;
    htmlUrl: string;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
