import type { PluginTool } from "../tool";

/** Fetch a pull request or issue's details (without bulky file contents). */
export const getItemTool: PluginTool = {
    name: "get_item",
    description:
        "Get a pull request or issue: title, state, author, labels, body, comments, and — for pull requests — the list of changed files with their stats. Use get_changed_file for a file's content or diff.",
    handler: async (_args, ctx) => {
        if (ctx.ref.type === "pull") {
            const pr = await ctx.review.fetchPullRequest(ctx.ref);
            return JSON.stringify(
                {
                    type: "pull_request",
                    number: pr.ref.number,
                    title: pr.title,
                    state: pr.merged ? "merged" : pr.draft ? "draft" : pr.state,
                    author: pr.author,
                    labels: pr.labels,
                    body: pr.body,
                    changedFiles: pr.changedFiles.map((f) => ({
                        filename: f.filename,
                        status: f.status,
                        additions: f.additions,
                        deletions: f.deletions,
                        isMarkdown: f.isMarkdown,
                    })),
                    comments: pr.comments.map((c) => ({
                        author: c.author,
                        body: c.body,
                        createdAt: c.createdAt,
                    })),
                    inlineComments: pr.reviewComments.length,
                },
                null,
                2,
            );
        }
        const issue = await ctx.review.fetchIssue(ctx.ref);
        return JSON.stringify(
            {
                type: "issue",
                number: issue.ref.number,
                title: issue.title,
                state: issue.state,
                author: issue.author,
                labels: issue.labels,
                body: issue.body,
                comments: issue.comments.map((c) => ({
                    author: c.author,
                    body: c.body,
                    createdAt: c.createdAt,
                })),
            },
            null,
            2,
        );
    },
};
