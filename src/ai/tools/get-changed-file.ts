import { z } from "zod";
import type { PluginTool } from "../tool";

/** Content (Markdown) or unified diff (other files) of one changed file in a PR. */
export const getChangedFileTool: PluginTool = {
    name: "get_changed_file",
    description:
        "Get the content (Markdown files) or unified diff (other files) of one changed file in this pull request, by its path.",
    schema: { filename: z.string().describe("Path of the changed file, e.g. docs/design.md") },
    handler: async (args, ctx) => {
        if (ctx.ref.type !== "pull") {
            return "This item is an issue, not a pull request, so it has no changed files.";
        }
        const filename = typeof args.filename === "string" ? args.filename : "";
        const pr = await ctx.review.fetchPullRequest(ctx.ref);
        const file = pr.changedFiles.find((f) => f.filename === filename);
        if (!file) {
            const names = pr.changedFiles.map((f) => f.filename).join(", ");
            return `No changed file named "${filename}". Changed files: ${names}`;
        }
        return file.content ?? file.patch ?? "(no content available for this file)";
    },
};
