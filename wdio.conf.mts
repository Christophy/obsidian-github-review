import * as path from "path";
import { env } from "process";

// wdio-obsidian-service downloads sandboxed Obsidian builds into this dir (cached).
const cacheDir = path.resolve(".obsidian-cache");

// Desktop-only for v1. To test more versions set OBSIDIAN_VERSIONS, e.g. "earliest latest".
const appVersion = env.OBSIDIAN_VERSIONS ?? "latest";

export const config: WebdriverIO.Config = {
    runner: "local",
    framework: "mocha",

    specs: ["./test/specs/**/*.e2e.ts"],

    maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),

    capabilities: [{
        browserName: "obsidian",
        browserVersion: appVersion,
        "wdio:obsidianOptions": {
            installerVersion: "latest",
            plugins: ["."],
            vault: "test/vaults/simple",
        },
    }],

    services: ["obsidian"],
    reporters: ["obsidian"],

    mochaOpts: {
        ui: "bdd",
        timeout: 60 * 1000,
    },
    waitforInterval: 250,
    waitforTimeout: 5 * 1000,
    logLevel: "warn",

    cacheDir,

    injectGlobals: false,
};
