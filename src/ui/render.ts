import { App, Component, MarkdownRenderer } from "obsidian";

/**
 * Render Markdown into `el` using Obsidian's own renderer, so design docs and
 * comments look exactly like notes do. `component` owns the lifecycle of any
 * child renderers (embeds, etc.) and must be the calling view.
 */
export async function renderMarkdown(
    app: App,
    markdown: string,
    el: HTMLElement,
    component: Component,
    sourcePath = "",
): Promise<void> {
    el.empty();
    await MarkdownRenderer.render(app, markdown, el, sourcePath, component);
}
