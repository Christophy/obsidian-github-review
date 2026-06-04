import type { ReviewEvent } from "../core/model";
import type {
    RawComment,
    RawContent,
    RawIssue,
    RawPull,
    RawPullFile,
    RawReviewComment,
    RawSearchItem,
    RawUser,
} from "./types";

/**
 * Minimal HTTP contract. Deliberately matches the subset of Obsidian's
 * `requestUrl` we use, but is defined here so this module never imports
 * `obsidian` — that keeps it unit-testable under plain Node with a fake.
 * The adapter that wires Obsidian's `requestUrl` to this lives in `main.ts`.
 */
export interface HttpRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
    json: unknown;
}

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

export interface RateLimit {
    limit: number;
    remaining: number;
    resetAt: Date;
}

export class GitHubError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly url: string,
        readonly rateLimit?: RateLimit,
    ) {
        super(message);
        this.name = "GitHubError";
    }
}

export interface GitHubClientOptions {
    token: string;
    request: HttpFn;
    baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";

/** Thin transport over the GitHub REST API. Returns raw JSON; mapping happens upstream. */
export class GitHubClient {
    private readonly token: string;
    private readonly request: HttpFn;
    private readonly baseUrl: string;
    /** Per-GET ETag cache: a 304 response reuses the cached body and is free of rate limit. */
    private readonly etagCache = new Map<string, { etag: string; data: unknown }>();

    constructor(opts: GitHubClientOptions) {
        this.token = opts.token;
        this.request = opts.request;
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    }

    // ---------- endpoints ----------

    /** The authenticated token owner (used to detect self-authored PRs). */
    getViewer(): Promise<RawUser> {
        return this.send("GET", "/user") as Promise<RawUser>;
    }

    /**
     * All open issues & PRs in a repo. The issues endpoint returns both (a PR is
     * an issue, flagged by `pull_request`), and unlike /search/issues it doesn't
     * require an `is:issue`/`is:pull-request` qualifier.
     */
    listRepoIssues(
        owner: string,
        repo: string,
        perPage = 100,
        state: "open" | "closed" | "all" = "open",
    ): Promise<RawSearchItem[]> {
        return this.send("GET", `/repos/${owner}/${repo}/issues`, {
            state,
            per_page: perPage,
            sort: "updated",
            direction: "desc",
        }) as Promise<RawSearchItem[]>;
    }

    getIssue(owner: string, repo: string, num: number): Promise<RawIssue> {
        return this.send("GET", `/repos/${owner}/${repo}/issues/${num}`) as Promise<RawIssue>;
    }

    listIssueComments(owner: string, repo: string, num: number): Promise<RawComment[]> {
        return this.send("GET", `/repos/${owner}/${repo}/issues/${num}/comments`, {
            per_page: 100,
        }) as Promise<RawComment[]>;
    }

    getPullRequest(owner: string, repo: string, num: number): Promise<RawPull> {
        return this.send("GET", `/repos/${owner}/${repo}/pulls/${num}`) as Promise<RawPull>;
    }

    listPullFiles(owner: string, repo: string, num: number): Promise<RawPullFile[]> {
        return this.send("GET", `/repos/${owner}/${repo}/pulls/${num}/files`, {
            per_page: 100,
        }) as Promise<RawPullFile[]>;
    }

    listPullReviewComments(owner: string, repo: string, num: number): Promise<RawReviewComment[]> {
        return this.send("GET", `/repos/${owner}/${repo}/pulls/${num}/comments`, {
            per_page: 100,
        }) as Promise<RawReviewComment[]>;
    }

    getContent(owner: string, repo: string, filePath: string, ref: string): Promise<RawContent> {
        const encoded = filePath.split("/").map(encodeURIComponent).join("/");
        return this.send("GET", `/repos/${owner}/${repo}/contents/${encoded}`, {
            ref,
        }) as Promise<RawContent>;
    }

    createIssueComment(owner: string, repo: string, num: number, body: string): Promise<RawComment> {
        return this.send("POST", `/repos/${owner}/${repo}/issues/${num}/comments`, undefined, {
            body,
        }) as Promise<RawComment>;
    }

    submitReview(
        owner: string,
        repo: string,
        num: number,
        event: ReviewEvent,
        body: string,
    ): Promise<unknown> {
        return this.send("POST", `/repos/${owner}/${repo}/pulls/${num}/reviews`, undefined, {
            event,
            body,
        });
    }

    setIssueState(
        owner: string,
        repo: string,
        num: number,
        state: "open" | "closed",
    ): Promise<unknown> {
        return this.send("PATCH", `/repos/${owner}/${repo}/issues/${num}`, undefined, { state });
    }

    // ---------- low level ----------

    private buildUrl(path: string, query?: Record<string, string | number>): string {
        const url = new URL(this.baseUrl + path);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                url.searchParams.set(k, String(v));
            }
        }
        return url.toString();
    }

    private async send(
        method: string,
        path: string,
        query?: Record<string, string | number>,
        body?: unknown,
    ): Promise<unknown> {
        const url = this.buildUrl(path, query);
        const key = `${method} ${url}`;
        const cached = method === "GET" ? this.etagCache.get(key) : undefined;

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION,
            "User-Agent": "obsidian-github-review",
        };
        if (cached) {
            headers["If-None-Match"] = cached.etag;
        }

        const res = await this.request({
            url,
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        const resHeaders = lowerKeys(res.headers);
        const rateLimit = parseRateLimit(resHeaders);

        // 304: nothing changed; reuse the cached body (this response is free of rate limit).
        if (res.status === 304 && cached) {
            return cached.data;
        }
        if (res.status >= 200 && res.status < 300) {
            const etag = resHeaders["etag"];
            if (method === "GET" && etag) {
                this.etagCache.set(key, { etag, data: res.json });
            }
            return res.json;
        }
        throw toGitHubError(res, url, rateLimit);
    }
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        out[k.toLowerCase()] = v;
    }
    return out;
}

function parseRateLimit(headers: Record<string, string>): RateLimit | undefined {
    const remaining = headers["x-ratelimit-remaining"];
    const limit = headers["x-ratelimit-limit"];
    const reset = headers["x-ratelimit-reset"];
    if (remaining === undefined || limit === undefined || reset === undefined) {
        return undefined;
    }
    return {
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: new Date(Number(reset) * 1000),
    };
}

function toGitHubError(res: HttpResponse, url: string, rateLimit?: RateLimit): GitHubError {
    const body = res.json as { message?: string } | null;
    let message =
        body && typeof body.message === "string" ? body.message : `GitHub API error ${res.status}`;

    if (res.status === 401) {
        message = `Bad GitHub credentials (401). Check your token in settings. ${message}`;
    } else if (res.status === 403 && rateLimit && rateLimit.remaining === 0) {
        message = `GitHub rate limit reached (0/${rateLimit.limit}); resets at ${rateLimit.resetAt.toISOString()}.`;
    }

    return new GitHubError(message, res.status, url, rateLimit);
}
