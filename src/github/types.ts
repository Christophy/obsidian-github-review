/**
 * Raw GitHub REST API response shapes. Only the fields this plugin uses are
 * listed. These never leave the `github/` layer — `core/mappers.ts` turns them
 * into the domain types in `core/model.ts`.
 */

export interface RawUser {
    login: string;
    avatar_url: string;
    /** "User" | "Bot" | "Organization" — used to find bots for @mention. */
    type?: string;
}

export interface RawLabel {
    name: string;
}

export interface RawComment {
    id: number;
    user: RawUser | null;
    body: string;
    created_at: string;
    html_url: string;
}

export interface RawIssue {
    number: number;
    title: string;
    state: string;
    body: string | null;
    user: RawUser | null;
    labels: RawLabel[];
    html_url: string;
    /** Present when this "issue" is actually a pull request. */
    pull_request?: unknown;
}

export interface RawPull {
    number: number;
    title: string;
    state: string;
    body: string | null;
    user: RawUser | null;
    labels: RawLabel[];
    html_url: string;
    merged: boolean;
    draft?: boolean;
    head: { sha: string };
}

export interface RawPullFile {
    filename: string;
    status: string;
    additions?: number;
    deletions?: number;
    patch?: string;
}

export interface RawReviewComment {
    id: number;
    user: RawUser | null;
    body: string;
    created_at: string;
    html_url: string;
    path: string;
    line: number | null;
    diff_hunk: string;
}

export interface RawContent {
    content: string;
    encoding: string;
}

export interface RawSearchItem {
    number: number;
    title: string;
    state?: string;
    html_url: string;
    user: RawUser | null;
    updated_at: string;
    /** Present when the search hit is a pull request. */
    pull_request?: unknown;
    /** e.g. https://api.github.com/repos/owner/repo */
    repository_url: string;
}

