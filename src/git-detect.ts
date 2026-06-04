import { execFile } from "child_process";
import { parseGitHubRemote } from "./core/git-remote";

/**
 * Read the GitHub "owner/repo" of the git repo at `cwd` from its origin remote.
 * Returns null when `cwd` isn't a git repo, has no origin, or origin isn't GitHub.
 * Desktop only (uses Node's child_process); never called on mobile.
 */
export function readGitHubRemote(cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
        execFile("git", ["-C", cwd, "config", "--get", "remote.origin.url"], (err, stdout) => {
            resolve(err ? null : parseGitHubRemote(stdout));
        });
    });
}
