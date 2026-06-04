import { browser, expect } from "@wdio/globals";
import { describe, it } from "mocha";

type PluginsApp = {
    plugins: { plugins: Record<string, unknown>; enabledPlugins: Set<string> };
};

describe("GitHub Review – plugin bootstrap", function () {
    it("is enabled and loaded in Obsidian", async function () {
        const state = await browser.executeObsidian(({ app }) => {
            const a = app as unknown as PluginsApp;
            return {
                enabled: a.plugins.enabledPlugins.has("github-review"),
                loaded: !!a.plugins.plugins["github-review"],
            };
        });
        expect(state.enabled).toBe(true);
        expect(state.loaded).toBe(true);
    });
});
