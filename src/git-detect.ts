import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseGitHubRemote } from "./core/git-remote";

/** Pull the origin URL out of a git config file's [remote "origin"] section. */
function originUrl(configText: string): string | null {
    let inOrigin = false;
    for (const raw of configText.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("[")) {
            inOrigin = line.toLowerCase() === '[remote "origin"]';
            continue;
        }
        if (inOrigin) {
            const m = line.match(/^url\s*=\s*(.+)$/);
            if (m?.[1]) {
                return m[1].trim();
            }
        }
    }
    return null;
}

/**
 * Read the GitHub "owner/repo" for the repo containing `cwd`, by parsing its
 * `.git/config` (no shell — avoids spawning `git`). Walks up to find the repo
 * root. Returns null when there's no git repo, no origin, or origin isn't GitHub.
 * Desktop only; never called on mobile.
 */
export async function readGitHubRemote(cwd: string): Promise<string | null> {
    let dir = cwd;
    for (let i = 0; i < 8; i++) {
        try {
            const text = await readFile(join(dir, ".git", "config"), "utf8");
            const url = originUrl(text);
            return url ? parseGitHubRemote(url) : null;
        } catch {
            const parent = dirname(dir);
            if (parent === dir) {
                break; // reached filesystem root
            }
            dir = parent;
        }
    }
    return null;
}
