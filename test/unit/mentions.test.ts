import { describe, it } from "mocha";
import { expect } from "chai";
import {
    applyMention,
    botMentionHandle,
    extractMentionQuery,
    filterHandles,
} from "../../src/core/mentions";
import { MentionService } from "../../src/core/mention-service";
import type { GitHubClient } from "../../src/github/client";

function asClient(overrides: Partial<GitHubClient>): GitHubClient {
    return overrides as unknown as GitHubClient;
}

describe("botMentionHandle", () => {
    it("strips the [bot] suffix", () => {
        expect(botMentionHandle("dependabot[bot]")).to.equal("dependabot");
        expect(botMentionHandle("widget-bot[bot]")).to.equal("widget-bot");
    });
    it("leaves a plain login unchanged", () => {
        expect(botMentionHandle("octocat")).to.equal("octocat");
    });
});

describe("extractMentionQuery", () => {
    it("finds a mention at the start", () => {
        expect(extractMentionQuery("@dep", 4)).to.deep.equal({ query: "dep", start: 0 });
    });
    it("finds a mention mid-text after whitespace", () => {
        expect(extractMentionQuery("hi @cod", 7)).to.deep.equal({ query: "cod", start: 3 });
    });
    it("treats a bare @ as an empty query", () => {
        expect(extractMentionQuery("@", 1)).to.deep.equal({ query: "", start: 0 });
    });
    it("ignores an @ glued to a previous word (email-like)", () => {
        expect(extractMentionQuery("a@b", 3)).to.equal(null);
    });
    it("returns null when there is no mention", () => {
        expect(extractMentionQuery("hello", 5)).to.equal(null);
    });
    it("returns null once a space follows the @token", () => {
        expect(extractMentionQuery("@dep ", 5)).to.equal(null);
    });
});

describe("applyMention", () => {
    it("replaces the in-progress token with @handle and a trailing space", () => {
        const result = applyMention("hi @dep", 3, 7, "dependabot");
        expect(result.text).to.equal("hi @dependabot ");
        expect(result.caret).to.equal("hi @dependabot ".length);
    });
});

describe("filterHandles", () => {
    it("prefix-matches case-insensitively", () => {
        expect(filterHandles(["dependabot", "coderabbitai"], "Co")).to.deep.equal(["coderabbitai"]);
    });
    it("returns all on empty query", () => {
        expect(filterHandles(["a", "b"], "")).to.deep.equal(["a", "b"]);
    });
});

describe("MentionService.discoverAppHandles", () => {
    function item(login: string, type: string) {
        return {
            number: 1,
            title: "x",
            html_url: "u",
            user: { login, avatar_url: "", type },
            updated_at: "t",
            repository_url: "https://api.github.com/repos/acme/widgets",
        };
    }

    it("collects distinct bot authors of the repo's issues/PRs as sorted @handles", async () => {
        const client = asClient({
            listRepoIssues: async () => [
                item("widget-bot[bot]", "Bot"),
                item("alice", "User"),
                item("dependabot[bot]", "Bot"),
                item("dependabot[bot]", "Bot"),
            ],
        });
        const handles = await new MentionService(client).discoverAppHandles("acme", "widgets");
        expect(handles).to.deep.equal(["dependabot", "widget-bot"]);
    });

    it("returns empty when no bots have participated", async () => {
        const client = asClient({ listRepoIssues: async () => [item("alice", "User")] });
        expect(await new MentionService(client).discoverAppHandles("acme", "widgets")).to.deep.equal(
            [],
        );
    });
});
