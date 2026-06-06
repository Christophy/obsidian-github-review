import type { ZodRawShape } from "zod";
import type { PluginContext } from "./plugin-context";

/**
 * A plugin capability used to build the context snapshot the stdio MCP server
 * serves. Define one in `tools/` and use it in `ai/context-snapshot.ts`.
 */
export interface PluginTool {
    /** Tool name. */
    name: string;
    description: string;
    /** Zod shape describing the tool's arguments (`{}` for none). */
    schema: ZodRawShape;
    /** Run the tool and return text for the model. */
    handler: (args: Record<string, unknown>, ctx: PluginContext) => Promise<string>;
}
