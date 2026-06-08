import { describe, it } from "mocha";
import { expect } from "chai";
import {
    mergeContextServer,
    stripContextServer,
    contextServerConfigJson,
    CONTEXT_SERVER_KEY,
    type StdioServerSpec,
} from "../../src/ai/claudian-config";

const spec: StdioServerSpec = {
    command: "node",
    args: ["/vault/plugins/github-review/mcp-stdio.js", "/vault/plugins/github-review/context.json"],
};

describe("claudian-config", () => {
    describe("mergeContextServer", () => {
        it("writes our server as a stdio entry (command/args + alwaysLoad), visible (contextSaving:false)", () => {
            const out = mergeContextServer({}, spec);
            const entry = out.mcpServers![CONTEXT_SERVER_KEY] as Record<string, unknown>;
            // We spawn bare `node` (not Obsidian's binary, whose launcher stub can't run as Node);
            // the client resolves it from PATH, so no env / ELECTRON_RUN_AS_NODE is needed.
            expect(entry.command).to.equal("node");
            expect(entry.args).to.deep.equal(spec.args);
            expect(entry.env).to.equal(undefined);
            expect(entry.alwaysLoad).to.equal(true);
            const meta = out._claudian!.servers![CONTEXT_SERVER_KEY] as Record<string, unknown>;
            expect(meta).to.deep.equal({ enabled: true, contextSaving: false });
        });

        it("PRESERVES other servers and their Claudian metadata (no clobbering)", () => {
            const existing = {
                mcpServers: { other: { type: "http", url: "http://x" } },
                _claudian: { servers: { other: { enabled: false, contextSaving: true } } },
                somethingElse: 42,
            };
            const out = mergeContextServer(existing, spec);
            expect(out.mcpServers!.other).to.deep.equal({ type: "http", url: "http://x" });
            expect(out._claudian!.servers!.other).to.deep.equal({ enabled: false, contextSaving: true });
            expect(out.somethingElse).to.equal(42);
        });

        it("updates our entry in place when re-run (others intact, not duplicated)", () => {
            const first = mergeContextServer({ mcpServers: { other: { type: "stdio" } } }, spec);
            const second = mergeContextServer(first, { ...spec, args: ["/new/mcp-stdio.js", "/new/context.json"] });
            const entry = second.mcpServers![CONTEXT_SERVER_KEY] as Record<string, unknown>;
            expect(entry.args).to.deep.equal(["/new/mcp-stdio.js", "/new/context.json"]);
            expect(second.mcpServers!.other).to.deep.equal({ type: "stdio" });
            expect(Object.keys(second.mcpServers!)).to.have.members([CONTEXT_SERVER_KEY, "other"]);
        });

        it("starts fresh on a non-object / garbage existing value (no throw)", () => {
            for (const bad of [null, undefined, "nope", 7, []]) {
                const out = mergeContextServer(bad, spec);
                expect(out.mcpServers![CONTEXT_SERVER_KEY]).to.not.equal(undefined);
            }
        });
    });

    describe("stripContextServer", () => {
        it("removes ONLY our entry, keeping other servers + metadata", () => {
            const existing = mergeContextServer(
                {
                    mcpServers: { other: { type: "stdio", command: "do-thing" } },
                    _claudian: { servers: { other: { enabled: true } } },
                },
                spec,
            );
            const out = stripContextServer(existing);
            expect(out.mcpServers![CONTEXT_SERVER_KEY]).to.equal(undefined);
            expect(out._claudian!.servers![CONTEXT_SERVER_KEY]).to.equal(undefined);
            expect(out.mcpServers!.other).to.deep.equal({ type: "stdio", command: "do-thing" });
            expect(out._claudian!.servers!.other).to.deep.equal({ enabled: true });
        });

        it("leaves a file that never had our entry untouched", () => {
            const out = stripContextServer({ mcpServers: { other: { type: "stdio" } } });
            expect(out.mcpServers).to.deep.equal({ other: { type: "stdio" } });
        });
    });

    it("contextServerConfigJson is valid JSON containing our stdio entry", () => {
        const parsed = JSON.parse(contextServerConfigJson(spec)) as {
            mcpServers: Record<string, { command: string }>;
        };
        expect(parsed.mcpServers[CONTEXT_SERVER_KEY]!.command).to.equal(spec.command);
    });
});
