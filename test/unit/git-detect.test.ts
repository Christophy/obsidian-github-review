import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readGitHubRemote } from "../../src/git-detect";

// Integration test: exercises the real `git config` read path against a real
// throwaway repo (same Node runtime the desktop plugin uses).
describe("readGitHubRemote (real git)", () => {
    let dir: string;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), "ghr-git-"));
        execFileSync("git", ["init", "-q"], { cwd: dir });
        execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/widgets.git"], {
            cwd: dir,
        });
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("reads and parses the origin remote of a real repo", async () => {
        expect(await readGitHubRemote(dir)).to.equal("acme/widgets");
    });

    it("returns null for a directory that is not a git repo", async () => {
        const plain = mkdtempSync(join(tmpdir(), "ghr-plain-"));
        try {
            expect(await readGitHubRemote(plain)).to.equal(null);
        } finally {
            rmSync(plain, { recursive: true, force: true });
        }
    });
});
