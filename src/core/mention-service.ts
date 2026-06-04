import type { GitHubClient } from "../github/client";
import { botMentionHandle } from "./mentions";

/**
 * Stateless. Discovers bot @mention handles for a repo.
 *
 * GitHub doesn't expose "apps installed on a repo" to a personal access token
 * (both /user/installations and /orgs/{org}/installations return 403 for PATs),
 * so we discover bots from repo activity instead: the authors of the repo's
 * issues & PRs that are GitHub Apps (user.type === "Bot").
 */
export class MentionService {
    constructor(private readonly client: GitHubClient) {}

    async discoverAppHandles(owner: string, repo: string): Promise<string[]> {
        const items = await this.client.listRepoIssues(owner, repo, 100, "all");
        const handles = new Set<string>();
        for (const item of items) {
            if (item.user?.type === "Bot") {
                handles.add(botMentionHandle(item.user.login));
            }
        }
        return Array.from(handles).sort();
    }
}
