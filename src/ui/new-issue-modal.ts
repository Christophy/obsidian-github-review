import { App, Component, MarkdownRenderer, Modal, Setting } from "obsidian";
import type { IssueTemplate } from "../core/issue-template";
import { MentionAutocomplete } from "./mention-autocomplete";

export interface NewIssueModalOptions {
    /** "owner/repo" the issue will be created in. */
    repoLabel: string;
    /** Templates to offer (plus a built-in "Blank issue"). */
    templates: IssueTemplate[];
    /** Enables @mention autocomplete in the body. */
    getMentionHandles?: () => string[];
    /** Create the issue. Reject to keep the modal open (an error was shown). */
    onSubmit: (title: string, body: string, labels: string[]) => Promise<void>;
}

/**
 * Compose a new issue: pick a template (which pre-fills title/labels/body), then
 * edit the body with a GitHub-style Write / Preview toggle before creating it.
 */
export class NewIssueModal extends Modal {
    private readonly component = new Component();
    private titleInput!: HTMLInputElement;
    private bodyInput!: HTMLTextAreaElement;
    private preview!: HTMLElement;
    private writeTab!: HTMLButtonElement;
    private previewTab!: HTMLButtonElement;
    private submitButton!: HTMLButtonElement;
    private labels: string[] = [];
    private busy = false;

    constructor(
        app: App,
        private readonly opts: NewIssueModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        this.component.load();
        const { contentEl } = this;
        contentEl.addClass("ghr-new-issue");
        contentEl.createEl("h3", { text: `New issue in ${this.opts.repoLabel}` });

        if (this.opts.templates.length > 0) {
            new Setting(contentEl).setName("Template").addDropdown((dd) => {
                dd.addOption("-1", "Blank issue");
                this.opts.templates.forEach((t, i) => {
                    dd.addOption(String(i), t.name);
                });
                dd.setValue("-1");
                dd.onChange((v) => this.applyTemplate(Number(v)));
            });
        }

        new Setting(contentEl).setName("Title").addText((text) => {
            this.titleInput = text.inputEl;
            this.titleInput.addClass("ghr-issue-title");
            text.setPlaceholder("Title");
            text.onChange(() => this.updateSubmitState());
        });

        const tabs = contentEl.createDiv({ cls: "ghr-tabs ghr-issue-tabs" });
        this.writeTab = tabs.createEl("button", { cls: "ghr-tab ghr-tab-active", text: "Write" });
        this.previewTab = tabs.createEl("button", { cls: "ghr-tab", text: "Preview" });
        this.writeTab.addEventListener("click", () => void this.setMode("write"));
        this.previewTab.addEventListener("click", () => void this.setMode("preview"));

        const bodyWrap = contentEl.createDiv({ cls: "ghr-issue-body" });
        this.bodyInput = bodyWrap.createEl("textarea", {
            cls: "ghr-comment-input ghr-issue-input",
        });
        this.bodyInput.placeholder = "Leave a description";
        if (this.opts.getMentionHandles) {
            new MentionAutocomplete(this.bodyInput, this.opts.getMentionHandles);
        }
        this.preview = bodyWrap.createDiv({ cls: "ghr-issue-preview markdown-rendered" });
        this.preview.hide();

        new Setting(contentEl).addButton((btn) => {
            this.submitButton = btn.buttonEl;
            this.submitButton.addClass("ghr-issue-submit");
            btn.setButtonText("Create issue")
                .setCta()
                .onClick(() => void this.submit());
        });

        this.updateSubmitState();
    }

    private applyTemplate(index: number): void {
        const template: IssueTemplate | undefined =
            index >= 0 ? this.opts.templates[index] : undefined;
        this.labels = template?.labels ?? [];
        if (template?.title) {
            this.titleInput.value = template.title;
        }
        this.bodyInput.value = template?.body ?? "";
        this.updateSubmitState();
        if (this.preview.isShown()) {
            void this.renderPreview();
        }
    }

    private async setMode(mode: "write" | "preview"): Promise<void> {
        const write = mode === "write";
        this.writeTab.toggleClass("ghr-tab-active", write);
        this.previewTab.toggleClass("ghr-tab-active", !write);
        this.bodyInput.toggle(write);
        this.preview.toggle(!write);
        if (!write) {
            await this.renderPreview();
        }
    }

    private async renderPreview(): Promise<void> {
        const markdown = this.bodyInput.value.trim() || "_Nothing to preview._";
        this.preview.empty();
        await MarkdownRenderer.render(this.app, markdown, this.preview, "", this.component);
    }

    private updateSubmitState(): void {
        this.submitButton.disabled = this.busy || this.titleInput.value.trim() === "";
    }

    private async submit(): Promise<void> {
        const title = this.titleInput.value.trim();
        if (!title || this.busy) {
            return;
        }
        this.busy = true;
        this.updateSubmitState();
        try {
            await this.opts.onSubmit(title, this.bodyInput.value, this.labels);
            this.close();
        } catch {
            // onSubmit surfaced the error; let the user retry.
            this.busy = false;
            this.updateSubmitState();
        }
    }

    onClose(): void {
        this.component.unload();
        this.contentEl.empty();
    }
}
