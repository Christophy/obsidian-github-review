/**
 * Standalone stdio MCP server, shipped alongside the plugin. A Claude client
 * (Claudian, the `claude` CLI) spawns it on demand — no port, no running service.
 * It reads the store the plugin writes (path passed as argv[2]) and serves the
 * review context. It holds no token and makes no network calls.
 *
 * Run via Obsidian's bundled Node: `<electron-binary> mcp-stdio.js <store>` with
 * ELECTRON_RUN_AS_NODE=1, so no separate Node install is needed.
 */
import process from "node:process";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    asStore,
    changedFileText,
    currentItemText,
    itemText,
    type ContextStore,
} from "./ai/context-snapshot";

const storePath = process.argv[2];

/** Read the store fresh on each call, so the plugin's latest write is picked up. */
function loadStore(): ContextStore {
    if (!storePath) {
        return asStore(null);
    }
    try {
        return asStore(JSON.parse(readFileSync(storePath, "utf8")));
    } catch {
        return asStore(null);
    }
}

const server = new McpServer({ name: "github_review", version: "1.0.0" });

server.registerTool(
    "get_current_item",
    {
        description:
            "Returns the GitHub pull request or issue currently open in the user's Obsidian GitHub Review tab — title, state, author, labels, body, comments, and (for PRs) the changed files. Takes NO arguments and needs NO link or number. ALWAYS call this — instead of asking the user for a link — whenever they mention 'this'/'the current'/'the open' PR or issue, ask what they're looking at, or ask whether you can see their PR/issue. Use get_changed_file for a file's content or diff.",
        inputSchema: {},
    },
    () => ({ content: [{ type: "text" as const, text: currentItemText(loadStore()) }] }),
);

server.registerTool(
    "get_item",
    {
        description:
            "Get a specific GitHub pull request or issue the user has open in a GitHub Review tab, by reference (owner, repo, number, type). Use this to pin to one item even if the active tab changes. Only items currently open in the review tabs are available; otherwise it asks the user to open it.",
        inputSchema: {
            owner: z.string().describe("Repository owner, e.g. acme"),
            repo: z.string().describe("Repository name, e.g. widgets"),
            number: z.number().int().positive().describe("Issue or pull request number"),
            type: z.enum(["issue", "pull"]).describe("Whether the number is an issue or a pull request"),
        },
    },
    (args) => ({
        content: [
            {
                type: "text" as const,
                text: itemText(loadStore(), {
                    owner: typeof args.owner === "string" ? args.owner : "",
                    repo: typeof args.repo === "string" ? args.repo : "",
                    number: typeof args.number === "number" ? args.number : 0,
                    type: args.type === "pull" ? "pull" : "issue",
                }),
            },
        ],
    }),
);

server.registerTool(
    "get_changed_file",
    {
        description:
            "Get the content (Markdown files) or unified diff (other files) of one changed file in the pull request currently open in the review tab, by its path.",
        inputSchema: { filename: z.string().describe("Path of the changed file, e.g. docs/design.md") },
    },
    (args) => ({
        content: [
            {
                type: "text" as const,
                text: changedFileText(loadStore(), typeof args.filename === "string" ? args.filename : ""),
            },
        ],
    }),
);

// No top-level await (cjs/es2018 target): the stdio transport keeps the process
// alive on stdin once connected.
server.connect(new StdioServerTransport()).catch((err: unknown) => {
    process.stderr.write(`github-review mcp-stdio failed: ${String(err)}\n`);
    process.exit(1);
});
