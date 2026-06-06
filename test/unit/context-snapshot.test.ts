import { describe, it } from "mocha";
import { expect } from "chai";
import {
    asStore,
    buildContextSnapshot,
    changedFileText,
    currentItemText,
    itemText,
    refKey,
    type ContextStore,
} from "../../src/ai/context-snapshot";
import type { PluginContext } from "../../src/ai/plugin-context";

const store: ContextStore = {
    current: "acme/widgets/pull/7",
    items: {
        "acme/widgets/pull/7": {
            item: JSON.stringify({ type: "pull_request", number: 7, title: "PR seven" }),
            changedFiles: { "docs/a.md": "# A" },
        },
        "acme/widgets/issue/20": {
            item: JSON.stringify({ type: "issue", number: 20, title: "Issue twenty" }),
            changedFiles: {},
        },
    },
};

describe("context-snapshot", () => {
    it("refKey is owner/repo/type/number", () => {
        expect(refKey({ owner: "acme", repo: "widgets", number: 7, type: "pull" })).to.equal(
            "acme/widgets/pull/7",
        );
    });

    describe("currentItemText", () => {
        it("returns the active item's content", () => {
            expect(currentItemText(store)).to.contain("PR seven");
        });
        it("guides the client when nothing is open (no silent failure)", () => {
            expect(currentItemText(asStore(null)).toLowerCase()).to.contain("no pull request or issue");
        });
    });

    describe("itemText (pin by ref, only if open)", () => {
        it("returns an open item by ref — keyed so projects don't conflate", () => {
            expect(
                itemText(store, { owner: "acme", repo: "widgets", number: 20, type: "issue" }),
            ).to.contain("Issue twenty");
        });
        it("tells the agent to open an item that isn't currently open", () => {
            const text = itemText(store, { owner: "acme", repo: "widgets", number: 99, type: "pull" });
            expect(text.toLowerCase()).to.contain("isn't open");
        });
    });

    describe("changedFileText", () => {
        it("returns a changed file of the current item", () => {
            expect(changedFileText(store, "docs/a.md")).to.equal("# A");
        });
        it("lists the changed files when the name is wrong", () => {
            expect(changedFileText(store, "nope.md")).to.contain("docs/a.md");
        });
        it("notes when the current item has no changed files (an issue)", () => {
            const issueStore: ContextStore = { current: "acme/widgets/issue/20", items: store.items };
            expect(changedFileText(issueStore, "x").toLowerCase()).to.contain("no changed files");
        });
    });

    describe("asStore", () => {
        it("coerces garbage / missing to an empty store (no throw)", () => {
            expect(asStore("nope")).to.deep.equal({ current: null, items: {} });
            expect(asStore(null)).to.deep.equal({ current: null, items: {} });
        });
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
});
