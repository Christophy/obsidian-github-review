import { App, Component, MarkdownRenderer, Modal, Setting } from "obsidian";
import {
    assembleIssueBody,
    type IssueFormAnswer,
    type IssueFormField,
    type IssueTemplate,
} from "../core/issue-template";
import { MentionAutocomplete } from "./mention-autocomplete";

export interface NewIssueModalOptions {
    /** "owner/repo" the issue will be created in. */
    repoLabel: string;
    /** Load templates to offer (plus a built-in "Blank issue"). Awaited after the modal opens. */
    loadTemplates: () => Promise<IssueTemplate[]>;
    /** Enables @mention autocomplete in free-text fields. */
    getMentionHandles?: () => string[];
    /** Create the issue. Reject to keep the modal open (an error was shown). */
    onSubmit: (title: string, body: string, labels: string[]) => Promise<void>;
}

/**
 * Compose a new issue. A Markdown template (or blank) is edited in a single body
 * textarea; a YAML issue form renders one control per field (like GitHub) and the
 * body is assembled from the answers on submit. A Write / Preview toggle shows the
 * rendered Markdown either way.
 */
export class NewIssueModal extends Modal {
    private readonly component = new Component();
    private templatePicker!: HTMLElement;
    private templates: IssueTemplate[] = [];
    private current: IssueTemplate | null = null;
    private titleInput!: HTMLInputElement;
    private writeEl!: HTMLElement;
    private previewEl!: HTMLElement;
    private writeTab!: HTMLButtonElement;
    private previewTab!: HTMLButtonElement;
    private submitButton!: HTMLButtonElement;
    private busy = false;

    /** Set for Markdown/blank templates. */
    private bodyInput: HTMLTextAreaElement | null = null;
    /** Set for issue forms: an answer reader per field, aligned with `current.fields`. */
    private fieldReaders: (() => IssueFormAnswer)[] = [];

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

        this.templatePicker = contentEl.createDiv({ cls: "ghr-issue-template-picker" });
        this.templatePicker.createDiv({ cls: "ghr-issue-loading", text: "Loading templates…" });

        new Setting(contentEl).setName("Title").addText((text) => {
            this.titleInput = text.inputEl;
            this.titleInput.addClass("ghr-issue-title");
            text.setPlaceholder("Title");
            text.onChange(() => this.updateSubmitState());
        });

        const tabs = contentEl.createDiv({ cls: "ghr-tabs ghr-issue-tabs" });
        this.writeTab = tabs.createEl("button", { cls: "ghr-tab ghr-tab-active", text: "Write" });
        this.previewTab = tabs.createEl("button", { cls: "ghr-tab", text: "Preview" });
        this.writeTab.addEventListener("click", () => this.setMode("write"));
        this.previewTab.addEventListener("click", () => this.setMode("preview"));

        const bodyWrap = contentEl.createDiv({ cls: "ghr-issue-body" });
        this.writeEl = bodyWrap.createDiv({ cls: "ghr-issue-write" });
        this.previewEl = bodyWrap.createDiv({ cls: "ghr-issue-preview markdown-rendered" });
        this.previewEl.hide();

        new Setting(contentEl).addButton((btn) => {
            this.submitButton = btn.buttonEl;
            this.submitButton.addClass("ghr-issue-submit");
            btn.setButtonText("Create issue")
                .setCta()
                .onClick(() => void this.submit());
        });

        this.renderWrite();
        this.updateSubmitState();
        void this.populateTemplates();
    }

    private async populateTemplates(): Promise<void> {
        let templates: IssueTemplate[] = [];
        try {
            templates = await this.opts.loadTemplates();
        } catch {
            // templates are optional; fall back to a blank issue
        }
        this.templates = templates;
        this.templatePicker.empty();
        if (templates.length === 0) {
            return;
        }
        new Setting(this.templatePicker).setName("Template").addDropdown((dd) => {
            dd.addOption("-1", "Blank issue");
            templates.forEach((t, i) => {
                dd.addOption(String(i), t.name);
            });
            dd.setValue("-1");
            dd.onChange((v) => this.applyTemplate(Number(v)));
        });
    }

    private applyTemplate(index: number): void {
        this.current = index >= 0 ? (this.templates[index] ?? null) : null;
        if (this.current?.title) {
            this.titleInput.value = this.current.title;
        }
        this.setMode("write");
        this.renderWrite();
        this.updateSubmitState();
    }

    /** (Re)build the Write area: a form for issue forms, else a single Markdown textarea. */
    private renderWrite(): void {
        this.writeEl.empty();
        this.bodyInput = null;
        this.fieldReaders = [];

        const fields = this.current?.fields;
        if (fields && fields.length > 0) {
            for (const field of fields) {
                this.fieldReaders.push(this.renderField(this.writeEl, field));
            }
            return;
        }

        const ta = this.writeEl.createEl("textarea", { cls: "ghr-comment-input ghr-issue-input" });
        ta.placeholder = "Leave a description";
        ta.value = this.current?.body ?? "";
        if (this.opts.getMentionHandles) {
            new MentionAutocomplete(ta, this.opts.getMentionHandles);
        }
        ta.addEventListener("input", () => this.updateSubmitState());
        this.bodyInput = ta;
    }

    /** Render one form field and return a reader for its answer (aligned with fields[]). */
    private renderField(parent: HTMLElement, field: IssueFormField): () => IssueFormAnswer {
        if (field.kind === "markdown") {
            const el = parent.createDiv({ cls: "ghr-form-md markdown-rendered" });
            void MarkdownRenderer.render(this.app, field.value, el, "", this.component);
            return () => ({});
        }

        const wrap = parent.createDiv({ cls: "ghr-form-field" });
        const labelEl = wrap.createDiv({ cls: "ghr-form-label", text: field.label });
        if (field.required) {
            labelEl.createSpan({ cls: "ghr-form-required", text: " *" });
        }
        if (field.description) {
            wrap.createDiv({ cls: "ghr-form-desc", text: field.description });
        }

        if (field.kind === "input") {
            const input = wrap.createEl("input", { attr: { type: "text" }, cls: "ghr-form-input" });
            input.placeholder = field.placeholder;
            input.addEventListener("input", () => this.updateSubmitState());
            return () => ({ text: input.value });
        }
        if (field.kind === "textarea") {
            const ta = wrap.createEl("textarea", { cls: "ghr-comment-input ghr-form-textarea" });
            ta.placeholder = field.placeholder;
            if (this.opts.getMentionHandles) {
                new MentionAutocomplete(ta, this.opts.getMentionHandles);
            }
            ta.addEventListener("input", () => this.updateSubmitState());
            return () => ({ text: ta.value });
        }
        if (field.kind === "dropdown") {
            const select = wrap.createEl("select", { cls: "dropdown ghr-form-select" });
            const placeholder = select.createEl("option", { text: "Select…" });
            placeholder.value = "";
            for (const option of field.options) {
                select.createEl("option", { text: option }).value = option;
            }
            select.addEventListener("change", () => this.updateSubmitState());
            return () => ({ text: select.value });
        }

        // checkboxes
        const boxes: HTMLInputElement[] = [];
        for (const option of field.options) {
            const row = wrap.createEl("label", { cls: "ghr-form-check" });
            boxes.push(row.createEl("input", { attr: { type: "checkbox" } }));
            row.createSpan({ text: ` ${option}` });
        }
        return () => ({ checked: boxes.map((b) => b.checked) });
    }

    private gatherAnswers(): IssueFormAnswer[] {
        return this.fieldReaders.map((read) => read());
    }

    private currentBody(): string {
        const fields = this.current?.fields;
        if (fields && fields.length > 0) {
            return assembleIssueBody(fields, this.gatherAnswers());
        }
        return this.bodyInput?.value ?? "";
    }

    private setMode(mode: "write" | "preview"): void {
        const write = mode === "write";
        this.writeTab.toggleClass("ghr-tab-active", write);
        this.previewTab.toggleClass("ghr-tab-active", !write);
        this.writeEl.toggle(write);
        this.previewEl.toggle(!write);
        if (!write) {
            void this.renderPreview();
        }
    }

    private async renderPreview(): Promise<void> {
        const markdown = this.currentBody().trim() || "_Nothing to preview._";
        this.previewEl.empty();
        await MarkdownRenderer.render(this.app, markdown, this.previewEl, "", this.component);
    }

    private updateSubmitState(): void {
        this.submitButton.disabled = this.busy || !this.canSubmit();
    }

    /** A title is always required; required free-text form fields must be filled too. */
    private canSubmit(): boolean {
        if (this.titleInput.value.trim() === "") {
            return false;
        }
        const fields = this.current?.fields;
        if (fields && fields.length > 0) {
            const answers = this.gatherAnswers();
            return fields.every((f, i) => {
                if (!f.required || f.kind === "markdown" || f.kind === "checkboxes") {
                    return true;
                }
                return (answers[i]?.text ?? "").trim() !== "";
            });
        }
        return true;
    }

    private async submit(): Promise<void> {
        if (!this.canSubmit() || this.busy) {
            return;
        }
        this.busy = true;
        this.updateSubmitState();
        try {
            await this.opts.onSubmit(
                this.titleInput.value.trim(),
                this.currentBody(),
                this.current?.labels ?? [],
            );
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
