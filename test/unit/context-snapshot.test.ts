import { describe, it } from "mocha";
import { expect } from "chai";
import { buildContextSnapshot, refKey } from "../../src/ai/context-snapshot";
import type { PluginContext } from "../../src/ai/plugin-context";

describe("context-snapshot", () => {
    it("refKey is owner/repo/type/number (keyed so projects don't conflate)", () => {
        expect(refKey({ owner: "acme", repo: "widgets", number: 7, type: "pull" })).to.equal(
            "acme/widgets/pull/7",
        );
    });

    it("buildContextSnapshot serializes the item + changed-file contents (PR)", async () => {
        const pr = {
            ref: { owner: "acme", repo: "widgets", number: 7, type: "pull" as const },
            title: "P",
            state: "open",
            merged: false,
            draft: false,
            author: "octocat",
            labels: [],
            body: "b",
            changedFiles: [
                { filename: "docs/a.md", status: "modified", additions: 1, deletions: 0, isMarkdown: true, content: "# A" },
            ],
            comments: [],
            reviewComments: [],
        };
        const ctx = {
            ref: pr.ref,
            review: { fetchPullRequest: async () => pr },
        } as unknown as PluginContext;
        const snap = await buildContextSnapshot(ctx);
        expect(snap.item).to.contain('"title": "P"');
        expect(snap.changedFiles["docs/a.md"]).to.equal("# A");
    });

    it("buildContextSnapshot has no changed files for an issue", async () => {
        const issue = {
            ref: { owner: "acme", repo: "widgets", number: 20, type: "issue" as const },
            title: "I",
            state: "open",
            author: "octocat",
            labels: [],
            body: "b",
            comments: [],
        };
        const ctx = {
            ref: issue.ref,
            review: { fetchIssue: async () => issue },
        } as unknown as PluginContext;
        const snap = await buildContextSnapshot(ctx);
        expect(snap.item).to.contain('"title": "I"');
        expect(Object.keys(snap.changedFiles)).to.have.length(0);
    });
});
