import type { PluginContext } from "./plugin-context";
import type { Ref } from "../core/model";
import { getItemTool } from "./tools/get-item";

/**
 * A serialized snapshot of one PR/issue. The plugin writes a store of these to a
 * file; the standalone stdio MCP server (see mcp-stdio-source.ts) reads it and
 * serves the tools — so that server needs no GitHub token and makes no network
 * calls (the token never leaves the plugin).
 */
export interface ContextSnapshot {
    /** The JSON text get_current_item / get_item returns for this item. */
    item: string;
    /** For pull requests: filename -> content (Markdown) or unified diff. */
    changedFiles: Record<string, string>;
}

/**
 * The whole store the plugin writes. Keyed by ref so multiple open repos/items
 * never get conflated; `current` points at the item in the active review tab.
 */
export interface ContextStore {
    current: string | null;
    items: Record<string, ContextSnapshot>;
}

/** Stable key for an item: owner/repo/type/number. */
export function refKey(ref: Ref): string {
    return `${ref.owner}/${ref.repo}/${ref.type}/${ref.number}`;
}

/** Build a snapshot from live plugin state (runs in the plugin, with the token). */
export async function buildContextSnapshot(ctx: PluginContext): Promise<ContextSnapshot> {
    const item = await getItemTool.handler({}, ctx);
    const changedFiles: Record<string, string> = {};
    if (ctx.ref.type === "pull") {
        // ETag-cached, so this repeat fetch is a free 304 after get_item's fetch.
        const pr = await ctx.review.fetchPullRequest(ctx.ref);
        for (const file of pr.changedFiles) {
            changedFiles[file.filename] = file.content ?? file.patch ?? "(no content available for this file)";
        }
    }
    return { item, changedFiles };
}
