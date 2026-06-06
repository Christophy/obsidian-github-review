import type { PluginContext } from "./plugin-context";
import type { Ref } from "../core/model";
import { getItemTool } from "./tools/get-item";

/**
 * A serialized snapshot of one PR/issue. The plugin writes a store of these to a
 * file; the stdio MCP server (mcp-stdio.ts) reads it and serves the tools — so the
 * server needs no GitHub token and makes no network calls (the token never leaves
 * the plugin).
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

const NO_CURRENT =
    "No pull request or issue is currently open in the Obsidian GitHub Review tab. Ask the user to open one there.";
const notOpen = (ref: { owner: string; repo: string; number: number }) =>
    `${ref.owner}/${ref.repo} #${ref.number} isn't open in the GitHub Review tab. Ask the user to open it there, then try again.`;

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

function emptyStore(): ContextStore {
    return { current: null, items: {} };
}

/** Coerce parsed JSON into a ContextStore (tolerates a missing/garbage file). */
export function asStore(parsed: unknown): ContextStore {
    if (!parsed || typeof parsed !== "object") {
        return emptyStore();
    }
    const obj = parsed as Partial<ContextStore>;
    return {
        current: typeof obj.current === "string" ? obj.current : null,
        items: obj.items && typeof obj.items === "object" ? obj.items : {},
    };
}

/** Tool text for get_current_item, given the loaded store. */
export function currentItemText(store: ContextStore): string {
    const snap = store.current ? store.items[store.current] : undefined;
    return snap?.item || NO_CURRENT;
}

/** Tool text for get_item (by ref), served only if that item is currently open. */
export function itemText(store: ContextStore, ref: Ref): string {
    const snap = store.items[refKey(ref)];
    return snap?.item ?? notOpen(ref);
}

/** Tool text for get_changed_file of the current item. */
export function changedFileText(store: ContextStore, filename: string): string {
    const snap = store.current ? store.items[store.current] : undefined;
    if (!snap) {
        return NO_CURRENT;
    }
    const content = snap.changedFiles[filename];
    if (content !== undefined) {
        return content;
    }
    const names = Object.keys(snap.changedFiles);
    if (names.length === 0) {
        return "The current item has no changed files (it may be an issue, not a pull request).";
    }
    return `No changed file named "${filename}". Changed files: ${names.join(", ")}`;
}
