/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument --
   E2E glue: `executeObsidian` serializes these callbacks and runs them inside Obsidian's
   browser context, where raw DOM and the (untyped) plugin/app internals are accessed on
   purpose. Strict typing is enforced in src/, not in this driver code. */
import { browser, expect, $ } from "@wdio/globals";
import { describe, it, before } from "mocha";

/**
 * Drives the whole plugin stack inside a real Obsidian, with the network faked
 * via the __GHR_TEST_HTTP__ seam so data is deterministic and no token is needed.
 */
describe("GitHub Review – review flows (stubbed network)", function () {
    before(async function () {
        await browser.executeObsidian(async ({ app }) => {
            const calls: { url: string; method: string; body?: string }[] = [];
            (window as any).__ghrCalls = calls;

            (window as any).__GHR_TEST_HTTP__ = async (req: any) => {
                const u = req.url as string;
                const method = (req.method ?? "GET") as string;
                calls.push({ url: u, method, body: req.body });
                const json = route(u, method);
                return { status: 200, headers: {}, text: JSON.stringify(json), json };

                function route(url: any, m: any): any {
                    if (url.endsWith("/user")) return { login: "reviewer", avatar_url: "" };
                    if (url.split("?")[0].endsWith("/issues") && m === "POST") {
                        // create issue -> returns the new issue (#42)
                        const posted = JSON.parse(req.body ?? "{}");
                        return {
                            number: 42,
                            title: posted.title,
                            state: "open",
                            body: posted.body,
                            user: { login: "reviewer", avatar_url: "" },
                            labels: (posted.labels ?? []).map((n: string) => ({ name: n })),
                            html_url: "https://github.com/acme/widgets/issues/42",
                        };
                    }
                    if (url.split("?")[0].endsWith("/issues")) {
                        // repo issues list (returns open issues AND PRs)
                        return [
                            {
                                number: 7,
                                title: "Add design doc",
                                state: "open",
                                html_url: "https://github.com/acme/widgets/pull/7",
                                user: { login: "author1", avatar_url: "" },
                                updated_at: "2026-06-01T00:00:00Z",
                                pull_request: { url: "x" },
                                repository_url: "https://api.github.com/repos/acme/widgets",
                            },
                            {
                                number: 8,
                                title: "A bug report",
                                state: "open",
                                html_url: "https://github.com/acme/widgets/issues/8",
                                user: { login: "widget-bot[bot]", avatar_url: "", type: "Bot" },
                                updated_at: "2026-05-30T00:00:00Z",
                                repository_url: "https://api.github.com/repos/acme/widgets",
                            },
                        ];
                    }
                    if (url.includes("/pulls/7/files")) {
                        return [
                            { filename: "docs/design.md", status: "modified", additions: 10, deletions: 2 },
                            {
                                filename: "src/app.ts",
                                status: "modified",
                                additions: 1,
                                deletions: 1,
                                patch: "@@ -1,2 +1,2 @@\n context\n-old line\n+new line",
                            },
                        ];
                    }
                    if (url.includes("/pulls/7/comments")) return [];
                    if (url.includes("/pulls/7/reviews") && m === "POST") return {};
                    if (url.split("?")[0].endsWith("/pulls/7")) {
                        return {
                            number: 7,
                            title: "Add design doc",
                            state: "open",
                            body: "Please review the **design**.",
                            user: { login: "author1", avatar_url: "" },
                            labels: [{ name: "design" }],
                            html_url: "https://github.com/acme/widgets/pull/7",
                            merged: false,
                            draft: false,
                            head: { sha: "sha1" },
                        };
                    }
                    if (url.includes("/issues/7/comments") && m === "POST") {
                        const posted = JSON.parse(req.body ?? "{}");
                        return {
                            id: 99,
                            user: { login: "reviewer", avatar_url: "" },
                            body: posted.body,
                            created_at: "2026-06-04T00:00:00Z",
                            html_url: "u",
                        };
                    }
                    if (url.includes("/issues/7/comments")) {
                        // base comment plus any the test injects to simulate new server data
                        return [
                            {
                                id: 11,
                                user: { login: "carol", avatar_url: "" },
                                body: "Looks promising",
                                created_at: "2026-06-02T00:00:00Z",
                                html_url: "u",
                            },
                            ...((window as any).__ghrExtra7 ?? []),
                        ];
                    }
                    // issue #8 detail (a real issue, not a PR)
                    if (url.includes("/issues/8/comments")) {
                        // any comments the test injects to simulate new server data
                        return [...((window as any).__ghrExtra8 ?? [])];
                    }
                    if (url.split("?")[0].endsWith("/issues/8")) {
                        return {
                            number: 8,
                            title: "A bug report",
                            state: "open",
                            body: "Steps to **reproduce** the bug.",
                            user: { login: "widget-bot[bot]", avatar_url: "", type: "Bot" },
                            labels: [{ name: "bug" }],
                            html_url: "https://github.com/acme/widgets/issues/8",
                        };
                    }
                    // created issue #42 (opened after the new-issue flow)
                    if (url.includes("/issues/42/comments")) return [];
                    if (url.split("?")[0].endsWith("/issues/42")) {
                        return {
                            number: 42,
                            title: "[Bug]:",
                            state: "open",
                            body: "## Steps",
                            user: { login: "reviewer", avatar_url: "" },
                            labels: [{ name: "bug" }],
                            html_url: "https://github.com/acme/widgets/issues/42",
                        };
                    }
                    // issue templates (.github/ISSUE_TEMPLATE)
                    if (url.includes("/contents/.github/ISSUE_TEMPLATE/bug_report.md")) {
                        return {
                            content: btoa(
                                "---\nname: Bug report\ntitle: '[Bug]: '\nlabels: [bug]\n---\n## Steps\n\n1. ",
                            ),
                            encoding: "base64",
                        };
                    }
                    if (url.includes("/contents/.github/ISSUE_TEMPLATE/feature.yml")) {
                        return {
                            content: btoa(
                                "name: Feature request\n" +
                                    "title: '[Feature]: '\n" +
                                    "labels: [enhancement]\n" +
                                    "body:\n" +
                                    "  - type: textarea\n" +
                                    "    attributes:\n" +
                                    "      label: Summary\n" +
                                    "    validations:\n" +
                                    "      required: true\n" +
                                    "  - type: dropdown\n" +
                                    "    attributes:\n" +
                                    "      label: Severity\n" +
                                    "      options:\n" +
                                    "        - Low\n" +
                                    "        - High\n" +
                                    "  - type: checkboxes\n" +
                                    "    attributes:\n" +
                                    "      label: Areas\n" +
                                    "      options:\n" +
                                    "        - label: API\n" +
                                    "        - label: UI\n",
                            ),
                            encoding: "base64",
                        };
                    }
                    if (url.split("?")[0].endsWith("/contents/.github/ISSUE_TEMPLATE")) {
                        return [
                            {
                                name: "bug_report.md",
                                path: ".github/ISSUE_TEMPLATE/bug_report.md",
                                type: "file",
                            },
                            { name: "config.yml", path: ".github/ISSUE_TEMPLATE/config.yml", type: "file" },
                            {
                                name: "feature.yml",
                                path: ".github/ISSUE_TEMPLATE/feature.yml",
                                type: "file",
                            },
                        ];
                    }
                    if (url.includes("/contents/docs/design.md")) {
                        return { content: btoa("# Design Title\n\nHello body"), encoding: "base64" };
                    }
                    return {};
                }
            };

            const plugin = (app as any).plugins.plugins["github-review"];
            plugin.settings.token = "test-token";
            plugin.settings.followVaultRepo = false;
            plugin.settings.repos = ["acme/widgets"];
            await plugin.saveSettings();
        });

        // viewer login resolves asynchronously through the stub; wait for it.
        await browser.waitUntil(
            () =>
                browser.executeObsidian(
                    ({ app }) => !!(app as any).plugins.plugins["github-review"].viewerLogin,
                ),
            { timeout: 5000, timeoutMsg: "viewer login never resolved" },
        );
    });

    it("lists the PR in the review queue", async () => {
        await browser.executeObsidianCommand("github-review:open-queue");
        const item = $(".ghr-queue-item");
        await item.waitForExist({ timeout: 5000 });
        await expect(item).toHaveText(/#7/);
    });

    it("opens the PR and renders the design doc as Markdown", async () => {
        await $(".ghr-queue-item").click();
        await $(".ghr-title").waitForExist({ timeout: 8000 });
        await expect($(".ghr-title")).toHaveText("Add design doc");
        await expect($(".ghr-doc-body h1")).toHaveText("Design Title");
    });

    it("renders a non-markdown file as a diff and the Viewed checkbox collapses it", async () => {
        const hasAddedLine = await browser.executeObsidian(() =>
            Array.from(document.querySelectorAll(".ghr-diff")).some((el) =>
                (el as HTMLElement).innerText.includes("new line"),
            ),
        );
        expect(hasAddedLine).toBe(true);

        const collapsedAfterViewed = await browser.executeObsidian(() => {
            const file = Array.from(document.querySelectorAll(".ghr-file")).find((f) =>
                (f as HTMLElement).innerText.includes("src/app.ts"),
            ) as HTMLElement;
            const checkbox = file.querySelector(".ghr-file-viewed input") as HTMLInputElement;
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            const body = file.querySelector(".ghr-file-body") as HTMLElement;
            return body.style.display === "none";
        });
        expect(collapsedAfterViewed).toBe(true);
    });

    it("enables the Approve option because the viewer is not the author", async () => {
        const approveDisabled = await browser.executeObsidian(() => {
            const toggle = document.querySelector(".ghr-review-toggle");
            if (toggle instanceof HTMLElement) {
                toggle.click();
            }
            document.querySelector(".ghr-review-actions")?.scrollIntoView();
            const input = document.querySelector('.ghr-review-options input[value="APPROVE"]');
            return input instanceof HTMLInputElement ? input.disabled : null;
        });
        expect(approveDisabled).toBe(false);
    });

    it("submits a Request changes review through to the API", async () => {
        await browser.executeObsidian(() => {
            const ta = document.querySelector(".ghr-review-body") as HTMLTextAreaElement;
            ta.value = "please tweak the wording";
            const rc = document.querySelector(
                '.ghr-review-options input[value="REQUEST_CHANGES"]',
            ) as HTMLInputElement;
            rc.checked = true;
            rc.dispatchEvent(new Event("change", { bubbles: true }));
            (document.querySelector(".ghr-review-submit") as HTMLButtonElement).click();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(
                    () =>
                        ((window as any).__ghrCalls as any[]).some(
                            (c) => c.method === "POST" && c.url.includes("/pulls/7/reviews"),
                        ),
                ),
            { timeout: 5000, timeoutMsg: "review POST never happened" },
        );
        const review = await browser.executeObsidian(
            () =>
                ((window as any).__ghrCalls as any[]).find((c) =>
                    c.url.includes("/pulls/7/reviews"),
                ),
        );
        expect(JSON.parse(review.body).event).toBe("REQUEST_CHANGES");
    });

    it("posts a PR comment and shows it immediately (no refetch)", async () => {
        await browser.executeObsidian(() => {
            const box = document.querySelector(
                ".ghr-comment-box .ghr-comment-input",
            ) as HTMLTextAreaElement;
            box.value = "looks good to me";
            (document.querySelector(".ghr-comment-box .ghr-comment-submit") as HTMLButtonElement).click();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(() =>
                    Array.from(document.querySelectorAll(".ghr-comment-body")).some((el) =>
                        (el as HTMLElement).innerText.includes("looks good to me"),
                    ),
                ),
            { timeout: 5000, timeoutMsg: "posted comment did not appear in the list" },
        );
    });

    it("requests closed items when 'include closed' is enabled", async () => {
        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            plugin.settings.showClosed = true;
            (window as any).__ghrCalls.length = 0;
            const leaf = (app.workspace as any).getLeavesOfType("ghr-queue")[0];
            await leaf.view.refresh();
        });
        const call = await browser.executeObsidian(() =>
            ((window as any).__ghrCalls as any[]).find((c) => c.url.includes("/issues?")),
        );
        expect(call.url).toContain("state=all");
    });

    it("scopes the queue to the vault's detected repo when following is on", async () => {
        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            plugin.vaultRepo = "acme/widgets";
            plugin.settings.followVaultRepo = true;
            plugin.settings.repos = [];
            const leaf = (app.workspace as any).getLeavesOfType("ghr-queue")[0];
            await leaf.view.refresh();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(
                    () =>
                        !!Array.from(document.querySelectorAll(".ghr-queue-header h4")).find(
                            (h) => h.textContent === "acme/widgets",
                        ),
                ),
            { timeout: 5000, timeoutMsg: "queue did not scope to acme/widgets" },
        );
        await expect($(".ghr-queue-item")).toHaveText(/#7/);
    });

    it("splits PRs and Issues into separate tabs", async () => {
        await browser.executeObsidian(async ({ app }) => {
            const leaf = (app.workspace as any).getLeavesOfType("ghr-queue")[0];
            leaf.view.activeTab = "pull";
            await leaf.view.refresh();
        });
        // default Pull requests tab: only the PR (#7), not the issue (#8)
        await browser.waitUntil(
            () =>
                browser.executeObsidian(() => {
                    const items = Array.from(
                        document.querySelectorAll(".ghr-queue-list .ghr-queue-item"),
                    ).map((e) => (e as HTMLElement).innerText);
                    return items.length === 1 && items[0]!.includes("#7");
                }),
            { timeout: 5000, timeoutMsg: "PR tab should show only #7" },
        );
        // switch to Issues tab -> only the issue (#8)
        await browser.executeObsidian(() => {
            const tab = Array.from(document.querySelectorAll(".ghr-tab")).find((t) =>
                (t as HTMLElement).innerText.startsWith("Issues"),
            ) as HTMLButtonElement;
            tab.click();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(() => {
                    const items = Array.from(
                        document.querySelectorAll(".ghr-queue-list .ghr-queue-item"),
                    ).map((e) => (e as HTMLElement).innerText);
                    return items.length === 1 && items[0]!.includes("#8");
                }),
            { timeout: 5000, timeoutMsg: "Issues tab should show only #8" },
        );
    });

    it("autocompletes an installed app (@mention) in the PR comment box", async () => {
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const leaf = (app.workspace as any).getLeavesOfType("ghr-review")[0];
                    return (leaf?.view?.mentionHandles ?? []).length > 0;
                }),
            { timeout: 5000, timeoutMsg: "mention handles never loaded" },
        );
        await browser.executeObsidian(() => {
            const ta = document.querySelector(
                ".ghr-comment-box .ghr-comment-input",
            ) as HTMLTextAreaElement;
            ta.value = "@wid";
            ta.setSelectionRange(4, 4);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const item = $(".ghr-comment-box .ghr-mention-dropdown .ghr-mention-item");
        await item.waitForExist({ timeout: 5000 });
        await expect(item).toHaveText("@widget-bot");
        await browser.executeObsidian(() => {
            (
                document.querySelector(
                    ".ghr-comment-box .ghr-mention-dropdown .ghr-mention-item",
                ) as HTMLElement
            ).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        const value = await browser.executeObsidian(
            () =>
                (document.querySelector(".ghr-comment-box .ghr-comment-input") as HTMLTextAreaElement)
                    .value,
        );
        expect(value).toContain("@widget-bot ");
    });

    it("reuses the existing tab when the same item is opened again", async () => {
        const leafCount = await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            const ref = { owner: "acme", repo: "widgets", number: 7, type: "pull" };
            await plugin.openReview(ref);
            await plugin.openReview(ref);
            return (app.workspace as any).getLeavesOfType("ghr-review").length;
        });
        expect(leafCount).toBe(1);
    });

    it("closes the pull request via the Close button (PATCH state=closed)", async () => {
        await browser.executeObsidian(() => {
            (window as any).__ghrCalls.length = 0;
            const btn = document.querySelector(".ghr-comment-box .ghr-comment-secondary");
            if (btn instanceof HTMLElement) {
                btn.click();
            }
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(() =>
                    ((window as any).__ghrCalls as any[]).some(
                        (c) => c.method === "PATCH" && c.url.includes("/issues/7"),
                    ),
                ),
            { timeout: 5000, timeoutMsg: "no PATCH to close the PR" },
        );
        const call = await browser.executeObsidian(() =>
            ((window as any).__ghrCalls as any[]).find(
                (c) => c.method === "PATCH" && c.url.includes("/issues/7"),
            ),
        );
        expect(JSON.parse(call.body).state).toBe("closed");
    });

    it("disables Approve when the viewer authored the PR", async () => {
        // The PR author is "author1"; make the viewer the author and re-render.
        const approveDisabled = await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            plugin.viewerLogin = "author1";
            const leaf = (app.workspace as any).getLeavesOfType("ghr-review")[0];
            await leaf.view.refresh();
            const toggle = document.querySelector(".ghr-review-toggle");
            if (toggle instanceof HTMLElement) {
                toggle.click();
            }
            const input = document.querySelector('.ghr-review-options input[value="APPROVE"]');
            return input instanceof HTMLInputElement ? input.disabled : null;
        });
        expect(approveDisabled).toBe(true);
    });

    it("opens an issue (not a PR): renders the body, a Close issue action, and no changed files", async () => {
        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            await plugin.openReview({ owner: "acme", repo: "widgets", number: 8, type: "issue" });
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(({ app }) => {
                    const leaf = (app.workspace as any)
                        .getLeavesOfType("ghr-review")
                        .find((l: any) => l.view?.ref?.number === 8);
                    return (
                        !!leaf &&
                        leaf.view.contentEl.querySelector(".ghr-title")?.textContent === "A bug report"
                    );
                }),
            { timeout: 8000, timeoutMsg: "issue #8 never rendered" },
        );
        const result = await browser.executeObsidian(({ app }) => {
            const leaf = (app.workspace as any)
                .getLeavesOfType("ghr-review")
                .find((l: any) => l.view?.ref?.number === 8);
            const root = leaf.view.contentEl as HTMLElement;
            return {
                body: (root.querySelector(".ghr-body") as HTMLElement)?.innerText ?? "",
                secondary: root.querySelector(".ghr-comment-box .ghr-comment-secondary")?.textContent ?? "",
                hasFiles: !!root.querySelector(".ghr-files"),
            };
        });
        expect(result.body).toContain("reproduce");
        // an issue closes with "Close issue", a PR with "Close pull request"
        expect(result.secondary).toBe("Close issue");
        // the "Changed files" section is PR-only
        expect(result.hasFiles).toBe(false);
    });

    it("silent poll leaves the DOM (and a typed draft) untouched when nothing changed", async () => {
        const result = await browser.executeObsidian(async ({ app }) => {
            const leaf = (app.workspace as any)
                .getLeavesOfType("ghr-review")
                .find((l: any) => l.view?.ref?.number === 7);
            const view = leaf.view;
            const root = view.contentEl as HTMLElement;
            await view.refresh(); // baseline render; records the data signature
            // element identity tells us whether refresh rebuilt the DOM or left it intact
            const titleBefore = root.querySelector(".ghr-title");
            (root.querySelector(".ghr-comment-input") as HTMLTextAreaElement).value = "draft in progress";
            await view.refresh({ silent: true }); // data unchanged -> must skip the rebuild
            return {
                notRebuilt: root.querySelector(".ghr-title") === titleBefore,
                draftKept:
                    (root.querySelector(".ghr-comment-input") as HTMLTextAreaElement).value ===
                    "draft in progress",
            };
        });
        expect(result.notRebuilt).toBe(true);
        expect(result.draftKept).toBe(true);
    });

    it("silent poll rebuilds when the data changed but preserves the in-progress draft", async () => {
        const result = await browser.executeObsidian(async ({ app }) => {
            const leaf = (app.workspace as any)
                .getLeavesOfType("ghr-review")
                .find((l: any) => l.view?.ref?.number === 7);
            const view = leaf.view;
            const root = view.contentEl as HTMLElement;
            await view.refresh(); // baseline
            const titleBefore = root.querySelector(".ghr-title");
            (root.querySelector(".ghr-comment-input") as HTMLTextAreaElement).value = "draft survives rebuild";
            // a new comment appears on the server between polls
            (window as any).__ghrExtra7 = [
                {
                    id: 77,
                    user: { login: "dave", avatar_url: "" },
                    body: "freshly arrived",
                    created_at: "2026-06-05T00:00:00Z",
                    html_url: "u",
                },
            ];
            await view.refresh({ silent: true });
            (window as any).__ghrExtra7 = []; // reset for any later test
            const hasNew = Array.from(root.querySelectorAll(".ghr-comment-body")).some((el) =>
                (el as HTMLElement).innerText.includes("freshly arrived"),
            );
            return {
                rebuilt: root.querySelector(".ghr-title") !== titleBefore,
                hasNew,
                draftKept:
                    (root.querySelector(".ghr-comment-input") as HTMLTextAreaElement).value ===
                    "draft survives rebuild",
            };
        });
        expect(result.rebuilt).toBe(true);
        expect(result.hasNew).toBe(true);
        expect(result.draftKept).toBe(true);
    });

    it("opens an item from a pasted GitHub URL via the command", async () => {
        // clear existing review tabs so we can prove the URL flow created the view
        await browser.executeObsidian(({ app }) => {
            (app.workspace as any).getLeavesOfType("ghr-review").forEach((l: any) => l.detach());
        });
        await browser.executeObsidianCommand("github-review:open-by-url");
        const input = $(".modal-container input[type='text']");
        await input.waitForExist({ timeout: 5000 });
        await browser.executeObsidian(() => {
            const el = document.querySelector(
                ".modal-container input[type='text']",
            ) as HTMLInputElement;
            el.value = "https://github.com/acme/widgets/pull/7";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            const btn = Array.from(document.querySelectorAll(".modal-container button")).find(
                (b) => b.textContent === "Open",
            ) as HTMLButtonElement;
            btn.click();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(
                    ({ app }) =>
                        !!(app.workspace as any)
                            .getLeavesOfType("ghr-review")
                            .find((l: any) => l.view?.ref?.number === 7),
                ),
            { timeout: 8000, timeoutMsg: "open-by-URL did not open PR #7" },
        );
    });

    it("creates a new issue from a template (prefill + Write/Preview) and opens it", async () => {
        await browser.executeObsidian(() => {
            (window as any).__ghrCalls.length = 0;
        });
        await browser.executeObsidianCommand("github-review:new-issue");

        // modal opens immediately; the template dropdown appears once templates load
        await $(".ghr-new-issue .ghr-issue-title").waitForExist({ timeout: 8000 });
        await $(".ghr-new-issue select").waitForExist({ timeout: 8000 });

        // choosing the template prefills the title and body
        const prefilled = await browser.executeObsidian(() => {
            const select = document.querySelector(".ghr-new-issue select") as HTMLSelectElement;
            select.value = "0";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return {
                title: (document.querySelector(".ghr-issue-title") as HTMLInputElement).value,
                body: (document.querySelector(".ghr-issue-input") as HTMLTextAreaElement).value,
            };
        });
        expect(prefilled.title).toBe("[Bug]: ");
        expect(prefilled.body).toContain("## Steps");

        // the Preview tab renders the Markdown body
        await browser.executeObsidian(() => {
            const tab = Array.from(document.querySelectorAll(".ghr-issue-tabs .ghr-tab")).find(
                (t) => t.textContent === "Preview",
            ) as HTMLButtonElement;
            tab.click();
        });
        await $(".ghr-issue-preview h2").waitForExist({ timeout: 5000 });
        await expect($(".ghr-issue-preview h2")).toHaveText("Steps");

        // Create posts the issue with the template's title + labels
        await browser.executeObsidian(() => {
            (document.querySelector(".ghr-issue-submit") as HTMLButtonElement).click();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(() =>
                    ((window as any).__ghrCalls as any[]).some(
                        (c) => c.method === "POST" && c.url.split("?")[0].endsWith("/issues"),
                    ),
                ),
            { timeout: 8000, timeoutMsg: "new issue was never POSTed" },
        );
        const post = await browser.executeObsidian(() =>
            ((window as any).__ghrCalls as any[]).find(
                (c) => c.method === "POST" && c.url.split("?")[0].endsWith("/issues"),
            ),
        );
        expect(JSON.parse(post.body).title).toBe("[Bug]:");
        expect(JSON.parse(post.body).labels).toEqual(["bug"]);

        // the created issue (#42) opens in a review tab
        await browser.waitUntil(
            () =>
                browser.executeObsidian(
                    ({ app }) =>
                        !!(app.workspace as any)
                            .getLeavesOfType("ghr-review")
                            .find((l: any) => l.view?.ref?.number === 42),
                ),
            { timeout: 8000, timeoutMsg: "created issue #42 did not open" },
        );
    });

    it("renders a YAML issue form as individual fields and assembles the body on submit", async () => {
        await browser.executeObsidian(() => {
            (window as any).__ghrCalls.length = 0;
        });
        await browser.executeObsidianCommand("github-review:new-issue");
        await $(".ghr-new-issue select").waitForExist({ timeout: 8000 });

        // pick the form template (index 1) and fill each field control
        const shape = await browser.executeObsidian(() => {
            const select = document.querySelector(".ghr-new-issue select") as HTMLSelectElement;
            select.value = "1";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            const write = document.querySelector(".ghr-issue-write") as HTMLElement;
            const textarea = write.querySelector(".ghr-form-textarea") as HTMLTextAreaElement;
            const dropdown = write.querySelector(".ghr-form-select") as HTMLSelectElement;
            const checks = Array.from(
                write.querySelectorAll<HTMLInputElement>(".ghr-form-check input"),
            );
            textarea.value = "It is slow";
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            dropdown.value = "High";
            dropdown.dispatchEvent(new Event("change", { bubbles: true }));
            const firstArea = checks[0];
            if (firstArea) {
                firstArea.checked = true;
                firstArea.dispatchEvent(new Event("change", { bubbles: true }));
            }
            return {
                fieldCount: write.querySelectorAll(".ghr-form-field").length,
                checkCount: checks.length,
                singleTextarea: !write.querySelector(".ghr-issue-input"), // not the markdown path
            };
        });
        expect(shape.fieldCount).toBe(3); // Summary, Severity, Areas
        expect(shape.checkCount).toBe(2); // API, UI
        expect(shape.singleTextarea).toBe(true);

        await browser.executeObsidian(() => {
            (document.querySelector(".ghr-issue-submit") as HTMLButtonElement).click();
        });
        await browser.waitUntil(
            () =>
                browser.executeObsidian(() =>
                    ((window as any).__ghrCalls as any[]).some(
                        (c) => c.method === "POST" && c.url.split("?")[0].endsWith("/issues"),
                    ),
                ),
            { timeout: 8000, timeoutMsg: "form issue was never POSTed" },
        );
        const post = await browser.executeObsidian(() =>
            ((window as any).__ghrCalls as any[]).find(
                (c) => c.method === "POST" && c.url.split("?")[0].endsWith("/issues"),
            ),
        );
        const body = JSON.parse(post.body);
        expect(body.title).toBe("[Feature]:");
        expect(body.labels).toEqual(["enhancement"]);
        // each field became its own ### section, assembled from the answers
        expect(body.body).toContain("### Summary\n\nIt is slow");
        expect(body.body).toContain("### Severity\n\nHigh");
        expect(body.body).toContain("### Areas\n\n- [x] API\n- [ ] UI");
    });

    it("writes a keyed context store + stdio mcp.json, and the stdio server serves the open item", async function () {
        this.timeout(30000);
        // close other review tabs and open PR #7, then make it the active item
        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            (app.workspace as any).getLeavesOfType("ghr-review").forEach((l: any) => l.detach());
            await plugin.openReview({ owner: "acme", repo: "widgets", number: 7, type: "pull" });
            const leaf = (app.workspace as any)
                .getLeavesOfType("ghr-review")
                .find((l: any) => l.view?.currentRef?.()?.number === 7);
            (app.workspace as any).setActiveLeaf(leaf, { focus: true });
        });

        // the plugin auto-writes the stdio config so the user adds nothing by hand
        const mcpFile = await browser.executeObsidian(async ({ app }) => {
            const a = (app.vault as any).adapter;
            return (await a.exists(".claude/mcp.json")) ? await a.read(".claude/mcp.json") : null;
        });
        expect(typeof mcpFile).toBe("string");
        const parsed = JSON.parse(mcpFile as string);
        const entry = parsed.mcpServers["github-review"];
        // spawn bare `node` (the client resolves it from PATH); NOT Obsidian's own
        // binary, whose macOS launcher stub can't run as Node -> "Connection closed".
        expect(entry.command).toBe("node");
        expect(entry.env).toBe(undefined);
        expect(entry.alwaysLoad).toBe(true);
        expect(parsed._claudian.servers["github-review"].contextSaving).toBe(false);
        const serverAbs: string = entry.args[0]; // the plugin wrote mcp-stdio.js here
        const storeAbs: string = entry.args[1];

        // the plugin actually wrote the server file at the path the config points to
        const fs = await import("node:fs/promises");
        await fs.access(serverAbs);

        // the store is keyed by ref (so projects don't conflate) with #7 current
        const store = JSON.parse(await fs.readFile(storeAbs, "utf8"));
        expect(store.current).toBe("acme/widgets/pull/7");
        expect(typeof store.items["acme/widgets/pull/7"].item).toBe("string");

        // the runtime-written stdio server serves the store over MCP, spawned EXACTLY
        // as the written config tells the client to (bare `node` resolved from PATH).
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        const client = new Client({ name: "e2e", version: "1.0.0" });
        await client.connect(
            new StdioClientTransport({
                command: entry.command as string,
                args: entry.args as string[],
            }),
        );
        try {
            const names = (await client.listTools()).tools.map((t) => t.name);
            expect(names).toContain("get_current_item");
            expect(names).toContain("get_item");
            const current = await client.callTool({ name: "get_current_item", arguments: {} });
            expect((current.content as { text: string }[]).map((c) => c.text).join("")).toContain(
                '"number": 7',
            );
            const pinned = await client.callTool({
                name: "get_item",
                arguments: { owner: "acme", repo: "widgets", number: 7, type: "pull" },
            });
            expect((pinned.content as { text: string }[]).map((c) => c.text).join("")).toContain(
                '"number": 7',
            );
        } finally {
            await client.close();
        }
    });

    it("re-writes the context store when the OPEN issue gets a new comment (not only on tab switch)", async function () {
        this.timeout(30000);

        // open issue #8 (a real issue) with no extra comments, make it the active item
        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as any).plugins.plugins["github-review"];
            (app.workspace as any).getLeavesOfType("ghr-review").forEach((l: any) => l.detach());
            (window as any).__ghrExtra8 = [];
            await plugin.openReview({ owner: "acme", repo: "widgets", number: 8, type: "issue" });
            const leaf = (app.workspace as any)
                .getLeavesOfType("ghr-review")
                .find((l: any) => l.view?.currentRef?.()?.number === 8);
            (app.workspace as any).setActiveLeaf(leaf, { focus: true });
        });

        // read the store the MCP server reads (<plugin>/context.json), via the vault adapter
        const readStore = async (): Promise<string | null> =>
            browser.executeObsidian(async ({ app }) => {
                const plugin = (app as any).plugins.plugins["github-review"];
                const p = `${plugin.manifest.dir}/context.json`;
                const a = (app.vault as any).adapter;
                return (await a.exists(p)) ? ((await a.read(p)) as string) : null;
            });

        // issue #8 is current and its snapshot has no "Fresh comment" yet
        await browser.waitUntil(
            async () => {
                const s = await readStore();
                return !!s && JSON.parse(s).current === "acme/widgets/issue/8";
            },
            { timeout: 10000, timeoutMsg: "context store never recorded issue #8 as current" },
        );
        expect(await readStore()).not.toContain("Fresh comment via poll");

        // a new comment lands server-side and the view's (silent) poll picks it up —
        // the SAME item, content changed, no tab switch.
        await browser.executeObsidian(async ({ app }) => {
            (window as any).__ghrExtra8 = [
                {
                    id: 21,
                    user: { login: "dave", avatar_url: "" },
                    body: "Fresh comment via poll",
                    created_at: "2026-06-05T00:00:00Z",
                    html_url: "u",
                },
            ];
            const leaf = (app.workspace as any)
                .getLeavesOfType("ghr-review")
                .find((l: any) => l.view?.currentRef?.()?.number === 8);
            await leaf.view.refresh({ silent: true });
        });

        // the store the MCP serves MUST now contain the new comment, without a tab switch
        await browser.waitUntil(async () => (await readStore())?.includes("Fresh comment via poll"), {
            timeout: 10000,
            timeoutMsg: "context.json did not pick up the new comment after the view refreshed",
        });
    });
});
