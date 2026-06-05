import { Buffer } from "node:buffer";
import { describe, it } from "mocha";
import { expect } from "chai";
import { QueueService } from "../../src/core/queue-service";
import { ReviewService } from "../../src/core/review-service";
import { IssueService } from "../../src/core/issue-service";
import { GitHubError, type GitHubClient } from "../../src/github/client";
import type { Ref } from "../../src/core/model";

function base64(text: string): string {
    return Buffer.from(text, "utf-8").toString("base64");
}

function asClient(overrides: Partial<GitHubClient>): GitHubClient {
    return overrides as unknown as GitHubClient;
}

const PR_REF: Ref = { owner: "acme", repo: "widgets", number: 9, type: "pull" };

describe("QueueService", () => {
    it("lists a repo's open issues & PRs (splitting owner/repo) and maps them", async () => {
        let seen: { owner: string; repo: string } | null = null;
        const client = asClient({
            listRepoIssues: async (owner: string, repo: string) => {
                seen = { owner, repo };
                return [
                    {
                        number: 9,
                        title: "feat",
                        html_url: "u",
                        user: { login: "carol", avatar_url: "" },
                        updated_at: "t",
                        pull_request: { url: "x" },
                        repository_url: "https://api.github.com/repos/acme/widgets",
                    },
                ];
            },
        });
        const queue = await new QueueService(client).fetchItems({ repos: ["acme/widgets"] });
        expect(seen).to.deep.equal({ owner: "acme", repo: "widgets" });
        expect(queue).to.have.length(1);
        expect(queue[0]!.repoFullName).to.equal("acme/widgets");
        expect(queue[0]!.ref.type).to.equal("pull");
    });

    it("merges items across multiple repos", async () => {
        const client = asClient({
            listRepoIssues: async (owner: string, repo: string) => [
                {
                    number: 1,
                    title: "x",
                    html_url: "u",
                    user: null,
                    updated_at: "t",
                    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
                },
            ],
        });
        const queue = await new QueueService(client).fetchItems({ repos: ["a/b", "c/d"] });
        expect(queue.map((q) => q.repoFullName)).to.deep.equal(["a/b", "c/d"]);
    });

    it("requests state=all when includeClosed is set", async () => {
        let seenState: string | undefined;
        const client = asClient({
            listRepoIssues: async (
                _o: string,
                _r: string,
                _pp: number,
                state: "open" | "closed" | "all",
            ) => {
                seenState = state;
                return [];
            },
        });
        await new QueueService(client).fetchItems({ repos: ["a/b"], includeClosed: true });
        expect(seenState).to.equal("all");
    });
});

describe("ReviewService.fetchPullRequest", () => {
    it("renders markdown via content and other files via their diff", async () => {
        const contentCalls: string[] = [];
        const client = asClient({
            getPullRequest: async () => ({
                number: 9,
                title: "Design doc",
                state: "open",
                body: "see doc",
                user: { login: "bob", avatar_url: "" },
                labels: [{ name: "design" }],
                html_url: "u",
                merged: false,
                draft: false,
                head: { sha: "sha1" },
            }),
            listPullFiles: async () => [
                { filename: "docs/design.md", status: "modified", additions: 10, deletions: 2 },
                { filename: "src/code.ts", status: "modified", additions: 5, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" },
                { filename: "old.md", status: "removed", additions: 0, deletions: 8 },
            ],
            listIssueComments: async () => [],
            listPullReviewComments: async () => [],
            getContent: async (_o: string, _r: string, p: string) => {
                contentCalls.push(p);
                return { content: Buffer.from(`# ${p}`, "utf-8").toString("base64"), encoding: "base64" };
            },
        });

        const pr = await new ReviewService(client).fetchPullRequest(PR_REF);

        // all files are included, in order
        expect(pr.changedFiles.map((f) => f.filename)).to.deep.equal([
            "docs/design.md",
            "src/code.ts",
            "old.md",
        ]);
        // content is fetched only for the non-removed markdown file
        expect(contentCalls).to.deep.equal(["docs/design.md"]);

        const design = pr.changedFiles.find((f) => f.filename === "docs/design.md")!;
        expect(design.isMarkdown).to.equal(true);
        expect(design.content).to.equal("# docs/design.md");
        expect(design.patch).to.equal(null);

        const code = pr.changedFiles.find((f) => f.filename === "src/code.ts")!;
        expect(code.isMarkdown).to.equal(false);
        expect(code.content).to.equal(null);
        expect(code.patch).to.equal("@@ -1 +1 @@\n-a\n+b");
        expect(code.additions).to.equal(5);
        expect(code.deletions).to.equal(1);

        const removed = pr.changedFiles.find((f) => f.filename === "old.md")!;
        expect(removed.content).to.equal(null);

        expect(pr.headSha).to.equal("sha1");
        expect(pr.labels).to.deep.equal(["design"]);
    });
});

describe("ReviewService.submitReview", () => {
    it("rejects an empty REQUEST_CHANGES before calling the API", async () => {
        let called = false;
        const client = asClient({
            submitReview: async () => {
                called = true;
                return {};
            },
        });
        try {
            await new ReviewService(client).submitReview(PR_REF, "REQUEST_CHANGES", "");
            expect.fail("should have thrown");
        } catch {
            expect(called).to.equal(false);
        }
    });

    it("submits an APPROVE with an empty body", async () => {
        let payload: unknown;
        const client = asClient({
            submitReview: async (_o: string, _r: string, _n: number, event: string, body: string) => {
                payload = { event, body };
                return {};
            },
        });
        await new ReviewService(client).submitReview(PR_REF, "APPROVE", "");
        expect(payload).to.deep.equal({ event: "APPROVE", body: "" });
    });
});

const ISSUE_REF: Ref = { owner: "acme", repo: "widgets", number: 8, type: "issue" };

describe("ReviewService.fetchIssue", () => {
    it("loads the issue and its comments into a domain object", async () => {
        const seen: { num?: number; commentsNum?: number } = {};
        const client = asClient({
            getIssue: async (_o: string, _r: string, num: number) => {
                seen.num = num;
                return {
                    number: 8,
                    title: "A bug report",
                    state: "open",
                    body: "Steps to reproduce.",
                    user: { login: "widget-bot[bot]", avatar_url: "a" },
                    labels: [{ name: "bug" }, { name: "triage" }],
                    html_url: "https://github.com/acme/widgets/issues/8",
                };
            },
            listIssueComments: async (_o: string, _r: string, num: number) => {
                seen.commentsNum = num;
                return [
                    {
                        id: 11,
                        user: { login: "carol", avatar_url: "c" },
                        body: "Confirmed",
                        created_at: "2026-06-02T00:00:00Z",
                        html_url: "u",
                    },
                ];
            },
        });

        const issue = await new ReviewService(client).fetchIssue(ISSUE_REF);

        // both endpoints are queried for the right issue number
        expect(seen).to.deep.equal({ num: 8, commentsNum: 8 });
        expect(issue.ref).to.deep.equal(ISSUE_REF);
        expect(issue.title).to.equal("A bug report");
        expect(issue.author).to.equal("widget-bot[bot]");
        expect(issue.state).to.equal("open");
        expect(issue.body).to.equal("Steps to reproduce.");
        expect(issue.labels).to.deep.equal(["bug", "triage"]);
        expect(issue.comments).to.have.length(1);
        expect(issue.comments[0]!.author).to.equal("carol");
        expect(issue.comments[0]!.body).to.equal("Confirmed");
    });
});

describe("ReviewService write actions", () => {
    it("postComment returns the created comment mapped for optimistic display", async () => {
        const client = asClient({
            createIssueComment: async (_o: string, _r: string, _n: number, body: string) => ({
                id: 99,
                user: { login: "reviewer", avatar_url: "x" },
                body,
                created_at: "2026-06-04T00:00:00Z",
                html_url: "u",
            }),
        });
        const comment = await new ReviewService(client).postComment(ISSUE_REF, "looks good");
        expect(comment.id).to.equal(99);
        expect(comment.author).to.equal("reviewer");
        expect(comment.body).to.equal("looks good");
    });

    it("closeIssue sets the issue state to closed for the right ref", async () => {
        let seen: { owner?: string; repo?: string; num?: number; state?: string } = {};
        const client = asClient({
            setIssueState: async (owner: string, repo: string, num: number, state: string) => {
                seen = { owner, repo, num, state };
                return {};
            },
        });
        await new ReviewService(client).closeIssue(ISSUE_REF);
        expect(seen).to.deep.equal({ owner: "acme", repo: "widgets", num: 8, state: "closed" });
    });
});

describe("IssueService.listTemplates", () => {
    it("parses template files and skips config.yml and sub-directories", async () => {
        const client = asClient({
            listDir: async (_o: string, _r: string, path: string) => {
                expect(path).to.equal(".github/ISSUE_TEMPLATE");
                return [
                    { name: "bug.md", path: ".github/ISSUE_TEMPLATE/bug.md", type: "file" },
                    { name: "config.yml", path: ".github/ISSUE_TEMPLATE/config.yml", type: "file" },
                    { name: "nested", path: ".github/ISSUE_TEMPLATE/nested", type: "dir" },
                    { name: "README.txt", path: ".github/ISSUE_TEMPLATE/README.txt", type: "file" },
                ];
            },
            getContent: async (_o: string, _r: string, p: string) => {
                expect(p).to.equal(".github/ISSUE_TEMPLATE/bug.md");
                return {
                    content: base64("---\nname: Bug\nlabels: [bug]\n---\nBody."),
                    encoding: "base64",
                };
            },
        });
        const templates = await new IssueService(client).listTemplates("acme", "widgets");
        expect(templates).to.have.length(1);
        expect(templates[0]!.name).to.equal("Bug");
        expect(templates[0]!.labels).to.deep.equal(["bug"]);
        expect(templates[0]!.body).to.equal("Body.");
    });

    it("returns no templates when the repo has no ISSUE_TEMPLATE directory (404)", async () => {
        const client = asClient({
            listDir: async () => {
                throw new GitHubError("Not Found", 404, "u");
            },
        });
        expect(await new IssueService(client).listTemplates("acme", "widgets")).to.deep.equal([]);
    });

    it("propagates non-404 errors", async () => {
        const client = asClient({
            listDir: async () => {
                throw new GitHubError("Server error", 500, "u");
            },
        });
        try {
            await new IssueService(client).listTemplates("acme", "widgets");
            expect.fail("should have thrown");
        } catch (err) {
            expect((err as GitHubError).status).to.equal(500);
        }
    });
});

describe("IssueService.createIssue", () => {
    it("posts title/body/labels and returns a ref to the new issue", async () => {
        let seen: unknown;
        const client = asClient({
            createIssue: async (
                owner: string,
                repo: string,
                title: string,
                body: string,
                labels: string[],
            ) => {
                seen = { owner, repo, title, body, labels };
                return {
                    number: 42,
                    title,
                    state: "open",
                    body,
                    user: null,
                    labels: [],
                    html_url: "u",
                };
            },
        });
        const ref = await new IssueService(client).createIssue(
            "acme",
            "widgets",
            "New spec question",
            "Details here",
            ["question"],
        );
        expect(seen).to.deep.equal({
            owner: "acme",
            repo: "widgets",
            title: "New spec question",
            body: "Details here",
            labels: ["question"],
        });
        expect(ref).to.deep.equal({ owner: "acme", repo: "widgets", number: 42, type: "issue" });
    });
});
