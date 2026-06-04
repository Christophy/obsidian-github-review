import type { GitHubClient } from "../github/client";
import type { QueueItem } from "./model";
import { mapSearchItem } from "./mappers";

export interface QueueOptions {
    /** "owner/repo" entries to list. */
    repos: string[];
    /** Include closed/merged items as well as open ones. */
    includeClosed?: boolean;
    perPage?: number;
}

/** Stateless. Lists issues & PRs for the given repos. */
export class QueueService {
    constructor(private readonly client: GitHubClient) {}

    async fetchItems(opts: QueueOptions): Promise<QueueItem[]> {
        const state = opts.includeClosed ? "all" : "open";
        const perRepo = await Promise.all(
            opts.repos.map((fullName) => this.fetchRepo(fullName, state, opts.perPage ?? 100)),
        );
        return perRepo.flat();
    }

    private async fetchRepo(
        fullName: string,
        state: "open" | "all",
        perPage: number,
    ): Promise<QueueItem[]> {
        const slash = fullName.indexOf("/");
        if (slash <= 0 || slash === fullName.length - 1) {
            return [];
        }
        const owner = fullName.slice(0, slash);
        const repo = fullName.slice(slash + 1);
        const items = await this.client.listRepoIssues(owner, repo, perPage, state);
        return items.map(mapSearchItem);
    }
}
