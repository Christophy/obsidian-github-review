/**
 * Pure helpers for the MCP config file Claudian reads at `<vault>/.claude/mcp.json`.
 * Kept side-effect-free so the merge/remove logic — which mutates a file the user
 * may share with other MCP servers — is unit-tested in isolation. The file I/O
 * lives in main.ts; the rules for *what* to write live here.
 */

/** Shape of the config file (open: other tools may add their own keys). */
export interface ClaudianMcpFile {
    mcpServers?: Record<string, unknown>;
    _claudian?: { servers?: Record<string, unknown> };
    [key: string]: unknown;
}

/** A stdio MCP server entry: a command the client spawns (no port, no service). */
export interface StdioServerSpec {
    command: string;
    args: string[];
}

export const CLAUDIAN_MCP_DIR = ".claude";
export const CLAUDIAN_MCP_FILE = ".claude/mcp.json";
/** The key our server is stored under (mcp__github_review__* tools come from it). */
export const CONTEXT_SERVER_KEY = "github-review";

function asFile(existing: unknown): ClaudianMcpFile {
    return existing && typeof existing === "object" ? (existing as ClaudianMcpFile) : {};
}

function serverEntry(spec: StdioServerSpec): Record<string, unknown> {
    return {
        command: spec.command,
        args: spec.args,
        // keep the tools in the prompt instead of deferred behind tool search
        alwaysLoad: true,
    };
}

/**
 * Merge our stdio context server into an existing config object, preserving every
 * other server and Claudian's per-server metadata. Returns a new object (no
 * mutation). `contextSaving:false` keeps the tools visible without an @mention.
 */
export function mergeContextServer(existing: unknown, spec: StdioServerSpec): ClaudianMcpFile {
    const base = asFile(existing);
    return {
        ...base,
        mcpServers: {
            ...(base.mcpServers ?? {}),
            [CONTEXT_SERVER_KEY]: serverEntry(spec),
        },
        _claudian: {
            ...(base._claudian ?? {}),
            servers: {
                ...(base._claudian?.servers ?? {}),
                [CONTEXT_SERVER_KEY]: { enabled: true, contextSaving: false },
            },
        },
    };
}

/** Remove only our entry, preserving every other server and metadata. */
export function stripContextServer(existing: unknown): ClaudianMcpFile {
    const base = asFile(existing);
    const without = (obj: Record<string, unknown> | undefined): Record<string, unknown> =>
        Object.fromEntries(Object.entries(obj ?? {}).filter(([key]) => key !== CONTEXT_SERVER_KEY));
    return {
        ...base,
        mcpServers: without(base.mcpServers),
        _claudian: { ...base._claudian, servers: without(base._claudian?.servers) },
    };
}

/** The config snippet a user pastes into a non-Claudian client (or for reference). */
export function contextServerConfigJson(spec: StdioServerSpec): string {
    return JSON.stringify(mergeContextServer({}, spec), null, 2);
}
