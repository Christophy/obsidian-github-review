import { describe, it } from "mocha";
import { expect } from "chai";
import { parseGitHubRemote } from "../../src/core/git-remote";

describe("parseGitHubRemote", () => {
    it("parses https with .git", () => {
        expect(parseGitHubRemote("https://github.com/acme/widgets.git")).to.equal("acme/widgets");
    });
    it("parses https without .git, with trailing slash", () => {
        expect(parseGitHubRemote("https://github.com/acme/widgets/")).to.equal("acme/widgets");
    });
    it("parses the scp-like ssh form", () => {
        expect(parseGitHubRemote("git@github.com:acme/widgets.git")).to.equal("acme/widgets");
    });
    it("parses the ssh:// form", () => {
        expect(parseGitHubRemote("ssh://git@github.com/acme/widgets.git")).to.equal("acme/widgets");
    });
    it("trims trailing whitespace from git output", () => {
        expect(parseGitHubRemote("https://github.com/a/b.git\n")).to.equal("a/b");
    });
    it("returns null for a non-GitHub host", () => {
        expect(parseGitHubRemote("https://gitlab.com/a/b.git")).to.equal(null);
    });
    it("returns null for garbage", () => {
        expect(parseGitHubRemote("not a url")).to.equal(null);
    });
});
