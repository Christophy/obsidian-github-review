/**
 * Parse "owner/repo" from a GitHub remote URL. Handles https and ssh forms,
 * with or without a trailing ".git". Returns null for non-GitHub remotes.
 */
export function parseGitHubRemote(remoteUrl: string): string | null {
    const m = remoteUrl
        .trim()
        .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
    if (!m) {
        return null;
    }
    const owner = m[1];
    const repo = m[2];
    if (!owner || !repo) {
        return null;
    }
    return `${owner}/${repo}`;
}
