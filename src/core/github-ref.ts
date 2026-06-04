import type { Ref, RefType } from "./model";

const PATH_TYPE: Record<string, RefType | undefined> = {
    pull: "pull",
    pulls: "pull",
    issues: "issue",
    issue: "issue",
};

/**
 * Parse a GitHub issue/PR web URL into a {@link Ref}.
 * Accepts http/https, optional `www.`, trailing slash, query and fragment.
 * Throws with a clear message on anything that is not an issue/PR URL.
 */
export function parseGitHubRef(input: string): Ref {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new Error(`Not a valid URL: ${input}`);
    }

    const host = url.hostname.replace(/^www\./, "");
    if (host !== "github.com") {
        throw new Error(`Not a github.com URL: ${input}`);
    }

    const segments = url.pathname.split("/").filter((s) => s.length > 0);
    const [owner, repo, kind, rawNumber] = segments;
    if (!owner || !repo || !kind || !rawNumber) {
        throw new Error(`URL is not a GitHub issue or pull request: ${input}`);
    }

    const type = PATH_TYPE[kind];
    if (!type) {
        throw new Error(`URL is not a GitHub issue or pull request: ${input}`);
    }
    if (!/^\d+$/.test(rawNumber)) {
        throw new Error(`Missing or invalid issue/PR number: ${input}`);
    }

    return { owner, repo, number: Number(rawNumber), type };
}
