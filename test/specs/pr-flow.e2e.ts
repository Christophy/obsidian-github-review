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
describe("GitHub Review – PR review flow (stubbed network)", function () {
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
                        return [
                            {
                                id: 11,
                                user: { login: "carol", avatar_url: "" },
                                body: "Looks promising",
                                created_at: "2026-06-02T00:00:00Z",
                                html_url: "u",
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
});
