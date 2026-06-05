import { GitHubError, type GitHubClient } from "../github/client";
import type { Ref } from "./model";
import { decodeBase64Content } from "./mappers";
import { parseIssueTemplate, type IssueTemplate } from "./issue-template";

const TEMPLATE_DIR = ".github/ISSUE_TEMPLATE";

/** Stateless. Lists a repo's issue templates and creates new issues. */
export class IssueService {
    constructor(private readonly client: GitHubClient) {}

    /**
     * The repo's issue templates, or `[]` if it defines none. Reads
     * `.github/ISSUE_TEMPLATE/` (both Markdown templates and YAML issue forms),
     * skipping `config.yml` (which configures the chooser, it isn't a template).
     */
    async listTemplates(owner: string, repo: string): Promise<IssueTemplate[]> {
        let entries;
        try {
            entries = await this.client.listDir(owner, repo, TEMPLATE_DIR);
        } catch (err) {
            if (err instanceof GitHubError && err.status === 404) {
                return [];
            }
            throw err;
        }

        const files = entries.filter(
            (e) =>
                e.type === "file" &&
                /\.(md|ya?ml)$/i.test(e.name) &&
                e.name.toLowerCase() !== "config.yml",
        );

        return Promise.all(
            files.map(async (file) => {
                const raw = await this.client.getContent(owner, repo, file.path);
                return parseIssueTemplate(file.name, decodeBase64Content(raw));
            }),
        );
    }

    /** Create an issue and return a ref to it for opening. */
    async createIssue(
        owner: string,
        repo: string,
        title: string,
        body: string,
        labels: string[] = [],
    ): Promise<Ref> {
        const raw = await this.client.createIssue(owner, repo, title, body, labels);
        return { owner, repo, number: raw.number, type: "issue" };
    }
}
