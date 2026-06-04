import { describe, it } from "mocha";
import { expect } from "chai";
import { parseGitHubRef } from "../../src/core/github-ref";

describe("parseGitHubRef", () => {
    it("parses a pull request URL", () => {
        const ref = parseGitHubRef("https://github.com/octocat/hello-world/pull/123");
        expect(ref).to.deep.equal({
            owner: "octocat",
            repo: "hello-world",
            number: 123,
            type: "pull",
        });
    });

    it("parses an issue URL", () => {
        const ref = parseGitHubRef("https://github.com/octocat/hello-world/issues/45");
        expect(ref).to.deep.equal({
            owner: "octocat",
            repo: "hello-world",
            number: 45,
            type: "issue",
        });
    });

    it("tolerates trailing slash, query string and fragment", () => {
        const ref = parseGitHubRef(
            "https://github.com/octocat/hello-world/pull/7/?foo=bar#issuecomment-99",
        );
        expect(ref.number).to.equal(7);
        expect(ref.type).to.equal("pull");
    });

    it("tolerates http and a www host", () => {
        const ref = parseGitHubRef("http://www.github.com/a/b/issues/2");
        expect(ref).to.deep.equal({ owner: "a", repo: "b", number: 2, type: "issue" });
    });

    it("rejects a non-GitHub host", () => {
        expect(() => parseGitHubRef("https://gitlab.com/a/b/issues/1")).to.throw();
    });

    it("rejects a URL with no issue/PR number", () => {
        expect(() => parseGitHubRef("https://github.com/a/b")).to.throw();
    });

    it("rejects an unrelated GitHub path", () => {
        expect(() => parseGitHubRef("https://github.com/a/b/blob/main/README.md")).to.throw();
    });

    it("rejects a non-numeric number", () => {
        expect(() => parseGitHubRef("https://github.com/a/b/pull/abc")).to.throw();
    });

    it("rejects garbage input", () => {
        expect(() => parseGitHubRef("not a url")).to.throw();
    });
});
