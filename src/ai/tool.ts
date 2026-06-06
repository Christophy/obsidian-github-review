import type { PluginContext } from "./plugin-context";

/**
 * A plugin capability used to build the context snapshot the stdio MCP server
 * serves. The handler does the fetch + serialization; the tool's JSON schema is
 * declared in the stdio server (mcp-stdio-source.ts), not here.
 */
export interface PluginTool {
    /** Tool name. */
    name: string;
    description: string;
    /** Run the tool and return text for the model. */
    handler: (args: Record<string, unknown>, ctx: PluginContext) => Promise<string>;
}
