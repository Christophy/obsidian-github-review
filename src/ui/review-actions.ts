import type { ReviewEvent } from "../core/model";
import { MentionAutocomplete } from "./mention-autocomplete";

export interface ReviewActionsOptions {
    /** False when the viewer authored the PR — GitHub forbids approving your own PR. */
    canApprove: boolean;
    cannotApproveReason?: string;
    onSubmit: (event: ReviewEvent, body: string) => Promise<void>;
    /** When provided, enables @mention autocomplete in the summary box. */
    getMentionHandles?: () => string[];
}

interface EventOption {
    value: ReviewEvent;
    label: string;
}

const EVENT_OPTIONS: EventOption[] = [
    { value: "COMMENT", label: "Comment" },
    { value: "APPROVE", label: "Approve" },
    { value: "REQUEST_CHANGES", label: "Request changes" },
];

let groupSeq = 0;

/**
 * Mirrors GitHub's review flow: a "Review changes" button that reveals the
 * "Finish your review" form (Comment / Approve / Request changes + Submit review).
 * Collapsed by default — the always-visible conversation comment box is separate.
 */
export class ReviewActions {
    private readonly textarea: HTMLTextAreaElement;
    private readonly submitButton: HTMLButtonElement;
    private readonly panel: HTMLElement;
    private readonly inputs: HTMLInputElement[] = [];
    private selected: ReviewEvent = "COMMENT";
    private open = false;

    constructor(parent: HTMLElement, private readonly opts: ReviewActionsOptions) {
        const wrap = parent.createDiv({ cls: "ghr-review-actions" });

        const toggle = wrap.createEl("button", { cls: "ghr-review-toggle", text: "Review changes" });
        this.panel = wrap.createDiv({ cls: "ghr-review-panel" });
        this.panel.toggle(false);
        toggle.addEventListener("click", () => {
            this.open = !this.open;
            this.panel.toggle(this.open);
            if (this.open) {
                this.textarea.focus();
            }
        });

        this.panel.createDiv({ cls: "ghr-review-heading", text: "Finish your review" });
        this.textarea = this.panel.createEl("textarea", { cls: "ghr-review-body" });
        this.textarea.placeholder = "Leave a comment";
        if (opts.getMentionHandles) {
            new MentionAutocomplete(this.textarea, opts.getMentionHandles);
        }

        const group = `ghr-review-${groupSeq++}`;
        const options = this.panel.createDiv({ cls: "ghr-review-options" });
        for (const opt of EVENT_OPTIONS) {
            const label = options.createEl("label", { cls: "ghr-review-option" });
            const input = label.createEl("input", {
                attr: { type: "radio", name: group, value: opt.value },
            });
            label.createSpan({ text: opt.label });
            input.checked = opt.value === this.selected;
            input.addEventListener("change", () => {
                this.selected = opt.value;
            });
            if (opt.value === "APPROVE" && !opts.canApprove) {
                input.disabled = true;
                const reason = opts.cannotApproveReason ?? "You can't approve this pull request.";
                label.addClass("ghr-review-option-disabled");
                label.title = reason;
                options.createDiv({ cls: "ghr-approve-hint", text: reason });
            }
            this.inputs.push(input);
        }

        this.submitButton = this.panel.createEl("button", {
            cls: "mod-cta ghr-review-submit",
            text: "Submit review",
        });
        this.submitButton.addEventListener("click", () => void this.submit());
    }

    private async submit(): Promise<void> {
        const body = this.textarea.value.trim();
        this.setBusy(true);
        try {
            await this.opts.onSubmit(this.selected, body);
            if (this.selected !== "APPROVE") {
                this.textarea.value = "";
            }
        } finally {
            this.setBusy(false);
        }
    }

    private setBusy(busy: boolean): void {
        this.submitButton.disabled = busy;
        this.textarea.disabled = busy;
        for (const input of this.inputs) {
            const blockedApprove = input.value === "APPROVE" && !this.opts.canApprove;
            input.disabled = busy || blockedApprove;
        }
    }
}
