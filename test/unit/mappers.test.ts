import { Buffer } from "node:buffer";
import { describe, it } from "mocha";
import { expect } from "chai";
import {
    buildReviewPayload,
    decodeBase64Content,
    isMarkdownFile,
    mapIssue,
    mapPull,
    mapSearchItem,
    parseRepositoryUrl,
} from "../../src/core/mappers";
import type { Ref } from "../../src/core/model";
import type { RawIssue, RawPull, RawSearchItem } from "../../src/github/types";

const ISSUE_REF: Ref = { owner: "o", repo: "r", number: 1, type: "issue" };

describe("mappers", () => {
    describe("mapIssue", () => {
        it("maps fields, flattens labels, and keeps the supplied ref", () => {
            const raw: RawIssue = {
                number: 1,
                title: "A bug",
                state: "open",
                body: "details",
                user: { login: "alice", avatar_url: "http://a/x.png" },
                labels: [{ name: "bug" }, { name: "p1" }],
                html_url: "http://gh/o/r/issues/1",
            };
            const issue = mapIssue(ISSUE_REF, raw, []);
            expect(issue.ref).to.equal(ISSUE_REF);
            expect(issue.author).to.equal("alice");
            expect(issue.labels).to.deep.equal(["bug", "p1"]);
            expect(issue.comments).to.deep.equal([]);
        });

        it("falls back to a placeholder author and empty body when null", () => {
            const raw: RawIssue = {
                number: 1,
                title: "x",
                state: "open",
                body: null,
                user: null,
                labels: [],
                html_url: "u",
            };
            const issue = mapIssue(ISSUE_REF, raw, []);
            expect(issue.author).to.equal("(unknown)");
            expect(issue.body).to.equal("");
        });
    });

    describe("mapPull", () => {
        it("defaults draft to false and carries head sha + changed files", () => {
            const raw: RawPull = {
                number: 9,
                title: "Design doc",
                state: "open",
                body: "see doc",
                user: { login: "bob", avatar_url: "" },
                labels: [],
                html_url: "u",
                merged: false,
                head: { sha: "deadbeef" },
            };
            const files = [
                {
                    filename: "docs/x.md",
                    status: "modified",
                    additions: 1,
                    deletions: 0,
                    isMarkdown: true,
                    content: "# Hi",
                    patch: null,
                },
            ];
            const pr = mapPull({ ...ISSUE_REF, type: "pull", number: 9 }, raw, files, [], []);
            expect(pr.draft).to.equal(false);
            expect(pr.headSha).to.equal("deadbeef");
            expect(pr.changedFiles).to.equal(files);
        });
    });

    describe("mapSearchItem", () => {
        it("derives owner/repo from repository_url and detects a PR", () => {
            const raw: RawSearchItem = {
                number: 12,
                title: "feat",
                html_url: "u",
                user: { login: "carol", avatar_url: "" },
                updated_at: "2026-06-01T00:00:00Z",
                pull_request: { url: "..." },
                repository_url: "https://api.github.com/repos/acme/widgets",
            };
            const item = mapSearchItem(raw);
            expect(item.repoFullName).to.equal("acme/widgets");
            expect(item.ref).to.deep.equal({
                owner: "acme",
                repo: "widgets",
                number: 12,
                type: "pull",
            });
        });

        it("detects an issue when pull_request is absent", () => {
            const raw: RawSearchItem = {
                number: 3,
                title: "bug",
                html_url: "u",
                user: null,
                updated_at: "t",
                repository_url: "https://api.github.com/repos/a/b",
            };
            expect(mapSearchItem(raw).ref.type).to.equal("issue");
        });
    });

    describe("parseRepositoryUrl", () => {
        it("extracts owner and repo", () => {
            expect(parseRepositoryUrl("https://api.github.com/repos/a/b")).to.deep.equal({
                owner: "a",
                repo: "b",
            });
        });
        it("throws on a malformed url", () => {
            expect(() => parseRepositoryUrl("https://api.github.com/x")).to.throw();
        });
    });

    describe("isMarkdownFile", () => {
        it("matches .md and .markdown case-insensitively", () => {
            expect(isMarkdownFile("a/b/Doc.MD")).to.equal(true);
            expect(isMarkdownFile("readme.markdown")).to.equal(true);
        });
        it("rejects non-markdown", () => {
            expect(isMarkdownFile("src/index.ts")).to.equal(false);
        });
    });

    describe("decodeBase64Content", () => {
        it("decodes line-wrapped base64 to UTF-8 text", () => {
            // A multibyte string with a newline, since GitHub line-wraps base64 payloads.
            const text = "# Design\nok";
            const b64 = Buffer.from(text, "utf-8").toString("base64");
            const wrapped = b64.slice(0, 4) + "\n" + b64.slice(4);
            expect(decodeBase64Content({ content: wrapped, encoding: "base64" })).to.equal(text);
        });
        it("passes through non-base64 encodings unchanged", () => {
            expect(decodeBase64Content({ content: "raw", encoding: "utf-8" })).to.equal("raw");
        });
    });

    describe("buildReviewPayload", () => {
        it("allows an empty body for APPROVE", () => {
            expect(buildReviewPayload("APPROVE", "")).to.deep.equal({ event: "APPROVE", body: "" });
        });
        it("requires a body for REQUEST_CHANGES", () => {
            expect(() => buildReviewPayload("REQUEST_CHANGES", "  ")).to.throw();
        });
        it("requires a body for COMMENT", () => {
            expect(() => buildReviewPayload("COMMENT", "")).to.throw();
        });
    });
});
