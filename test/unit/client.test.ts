import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import {
    GitHubClient,
    GitHubError,
    type HttpRequest,
    type HttpResponse,
} from "../../src/github/client";

/** A fake HttpFn that records the last request and returns a programmed response. */
function fakeHttp(response: Partial<HttpResponse>) {
    const calls: HttpRequest[] = [];
    const fn = async (req: HttpRequest): Promise<HttpResponse> => {
        calls.push(req);
        return {
            status: 200,
            headers: {},
            text: "",
            json: null,
            ...response,
        };
    };
    return { fn, calls };
}

function clientWith(response: Partial<HttpResponse>) {
    const http = fakeHttp(response);
    const client = new GitHubClient({ token: "tok_123", request: http.fn });
    return { client, http };
}

describe("GitHubClient", () => {
    describe("request shape", () => {
        let captured: HttpRequest;

        beforeEach(async () => {
            const { client, http } = clientWith({ json: [] });
            await client.listRepoIssues("octocat", "hello-world", 25, "all");
            captured = http.calls[0]!;
        });

        it("targets the repo issues endpoint with encoded query params", () => {
            const url = new URL(captured.url);
            expect(url.origin + url.pathname).to.equal(
                "https://api.github.com/repos/octocat/hello-world/issues",
            );
            expect(url.searchParams.get("state")).to.equal("all");
            expect(url.searchParams.get("per_page")).to.equal("25");
            expect(url.searchParams.get("sort")).to.equal("updated");
        });

        it("sends auth, accept and api-version headers", () => {
            expect(captured.headers?.Authorization).to.equal("Bearer tok_123");
            expect(captured.headers?.Accept).to.equal("application/vnd.github+json");
            expect(captured.headers?.["X-GitHub-Api-Version"]).to.equal("2022-11-28");
        });
    });

    it("builds the pull request URL", async () => {
        const { client, http } = clientWith({ json: {} });
        await client.getPullRequest("octocat", "hello-world", 42);
        expect(http.calls[0]!.url).to.equal(
            "https://api.github.com/repos/octocat/hello-world/pulls/42",
        );
        expect(http.calls[0]!.method).to.equal("GET");
    });

    it("encodes nested content paths and passes the ref", async () => {
        const { client, http } = clientWith({ json: { content: "", encoding: "base64" } });
        await client.getContent("o", "r", "docs/design doc.md", "abc123");
        const url = new URL(http.calls[0]!.url);
        expect(url.pathname).to.equal("/repos/o/r/contents/docs/design%20doc.md");
        expect(url.searchParams.get("ref")).to.equal("abc123");
    });

    it("POSTs an issue comment with a JSON body", async () => {
        const { client, http } = clientWith({ json: { id: 1 } });
        await client.createIssueComment("o", "r", 7, "looks good");
        const req = http.calls[0]!;
        expect(req.method).to.equal("POST");
        expect(req.url).to.equal("https://api.github.com/repos/o/r/issues/7/comments");
        expect(JSON.parse(req.body ?? "{}")).to.deep.equal({ body: "looks good" });
    });

    it("POSTs a review with the event and body", async () => {
        const { client, http } = clientWith({ json: {} });
        await client.submitReview("o", "r", 9, "REQUEST_CHANGES", "please fix");
        const req = http.calls[0]!;
        expect(req.url).to.equal("https://api.github.com/repos/o/r/pulls/9/reviews");
        expect(JSON.parse(req.body ?? "{}")).to.deep.equal({
            event: "REQUEST_CHANGES",
            body: "please fix",
        });
    });

    it("returns parsed JSON on success", async () => {
        const { client } = clientWith({ status: 200, json: { number: 5, title: "Hi" } });
        const issue = await client.getIssue("o", "r", 5);
        expect(issue).to.deep.equal({ number: 5, title: "Hi" });
    });

    it("throws GitHubError carrying the API message on non-2xx", async () => {
        const { client } = clientWith({ status: 404, json: { message: "Not Found" } });
        try {
            await client.getIssue("o", "r", 999);
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).to.be.instanceOf(GitHubError);
            const ghe = err as GitHubError;
            expect(ghe.status).to.equal(404);
            expect(ghe.message).to.contain("Not Found");
        }
    });

    it("gives a credentials hint on 401", async () => {
        const { client } = clientWith({ status: 401, json: { message: "Bad credentials" } });
        try {
            await client.getIssue("o", "r", 1);
            expect.fail("should have thrown");
        } catch (err) {
            expect((err as GitHubError).message.toLowerCase()).to.contain("credentials");
        }
    });

    it("surfaces rate-limit reset on a 403 with no remaining quota", async () => {
        const resetUnix = 1_900_000_000;
        const { client } = clientWith({
            status: 403,
            headers: {
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Limit": "5000",
                "X-RateLimit-Reset": String(resetUnix),
            },
            json: { message: "API rate limit exceeded" },
        });
        try {
            await client.listRepoIssues("o", "r");
            expect.fail("should have thrown");
        } catch (err) {
            const ghe = err as GitHubError;
            expect(ghe.status).to.equal(403);
            expect(ghe.message.toLowerCase()).to.contain("rate limit");
            expect(ghe.rateLimit?.remaining).to.equal(0);
            expect(ghe.rateLimit?.resetAt.getTime()).to.equal(resetUnix * 1000);
        }
    });

    describe("ETag conditional caching", () => {
        function sequenceClient(responses: Partial<HttpResponse>[]) {
            const calls: HttpRequest[] = [];
            let i = 0;
            const fn = async (req: HttpRequest): Promise<HttpResponse> => {
                calls.push(req);
                const r = responses[Math.min(i, responses.length - 1)] ?? {};
                i += 1;
                return { status: 200, headers: {}, text: "", json: null, ...r };
            };
            return { client: new GitHubClient({ token: "t", request: fn }), calls };
        }

        it("sends If-None-Match on the repeat GET and reuses the body on 304", async () => {
            const { client, calls } = sequenceClient([
                { status: 200, headers: { ETag: '"v1"' }, json: { n: 1 } },
                { status: 304, headers: { ETag: '"v1"' }, json: null },
            ]);
            const first = await client.getIssue("o", "r", 1);
            const second = await client.getIssue("o", "r", 1);
            expect(first).to.deep.equal({ n: 1 });
            expect(second).to.deep.equal({ n: 1 });
            expect(calls[0]!.headers?.["If-None-Match"]).to.equal(undefined);
            expect(calls[1]!.headers?.["If-None-Match"]).to.equal('"v1"');
        });

        it("updates the cache when the resource changes (200)", async () => {
            const { client } = sequenceClient([
                { status: 200, headers: { ETag: '"v1"' }, json: { n: 1 } },
                { status: 200, headers: { ETag: '"v2"' }, json: { n: 2 } },
            ]);
            await client.getIssue("o", "r", 1);
            expect(await client.getIssue("o", "r", 1)).to.deep.equal({ n: 2 });
        });
    });
});
