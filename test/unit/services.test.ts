import { Buffer } from "node:buffer";
import { describe, it } from "mocha";
import { expect } from "chai";
import { QueueService } from "../../src/core/queue-service";
import { ReviewService } from "../../src/core/review-service";
import type { GitHubClient } from "../../src/github/client";
import type { Ref } from "../../src/core/model";

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
