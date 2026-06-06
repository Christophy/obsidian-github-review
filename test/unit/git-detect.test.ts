import { describe, it } from "mocha";
import { expect } from "chai";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readGitHubRemote } from "../../src/git-detect";

/** Create a throwaway dir whose .git/config has the given origin URL. */
function repoWithOrigin(url: string): string {
    const dir = mkdtempSync(join(tmpdir(), "ghr-git-"));
    mkdirSync(join(dir, ".git"));
    writeFileSync(
        join(dir, ".git", "config"),
        `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    );
    return dir;
}

describe("readGitHubRemote (reads .git/config, no shell)", () => {
    it("parses the origin remote from .git/config", async () => {
        const dir = repoWithOrigin("git@github.com:acme/widgets.git");
        try {
            expect(await readGitHubRemote(dir)).to.equal("acme/widgets");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("walks up from a sub-directory to find the repo root", async () => {
        const dir = repoWithOrigin("https://github.com/acme/widgets");
        const sub = join(dir, "notes", "deep");
        mkdirSync(sub, { recursive: true });
        try {
            expect(await readGitHubRemote(sub)).to.equal("acme/widgets");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("returns null when origin isn't GitHub", async () => {
        const dir = repoWithOrigin("git@gitlab.com:acme/widgets.git");
        try {
            expect(await readGitHubRemote(dir)).to.equal(null);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
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
