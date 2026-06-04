import { MentionAutocomplete } from "./mention-autocomplete";

export interface CommentBoxOptions {
    placeholder?: string;
    submitLabel?: string;
    onSubmit: (text: string) => Promise<void>;
    /** Optional secondary action (e.g. "Close pull request"); fires even when empty. */
    secondaryLabel?: string;
    onSecondary?: (text: string) => Promise<void>;
    /** When provided, enables @mention autocomplete from these handles. */
    getMentionHandles?: () => string[];
}

/** Reusable comment input: textarea + Comment button, plus an optional secondary action. */
export class CommentBox {
    private readonly textarea: HTMLTextAreaElement;
    private readonly buttons: HTMLButtonElement[] = [];

    constructor(parent: HTMLElement, opts: CommentBoxOptions) {
        const wrap = parent.createDiv({ cls: "ghr-comment-box" });
        this.textarea = wrap.createEl("textarea", { cls: "ghr-comment-input" });
        this.textarea.placeholder = opts.placeholder ?? "Leave a comment";
        if (opts.getMentionHandles) {
            new MentionAutocomplete(this.textarea, opts.getMentionHandles);
        }

        const row = wrap.createDiv({ cls: "ghr-comment-buttons" });
        if (opts.secondaryLabel && opts.onSecondary) {
            const onSecondary = opts.onSecondary;
            const secondary = row.createEl("button", {
                cls: "ghr-comment-secondary",
                text: opts.secondaryLabel,
            });
            secondary.addEventListener("click", () => void this.run(onSecondary, false));
            this.buttons.push(secondary);
        }
        const primary = row.createEl("button", {
            cls: "mod-cta ghr-comment-submit",
            text: opts.submitLabel ?? "Comment",
        });
        primary.addEventListener("click", () => void this.run(opts.onSubmit, true));
        this.buttons.push(primary);
    }

    private async run(
        action: (text: string) => Promise<void>,
        requireText: boolean,
    ): Promise<void> {
        const text = this.textarea.value.trim();
        if (requireText && !text) {
            return;
        }
        this.setBusy(true);
        try {
            await action(this.textarea.value);
            if (requireText) {
                this.textarea.value = "";
            }
        } finally {
            this.setBusy(false);
        }
    }

    private setBusy(busy: boolean): void {
        this.textarea.disabled = busy;
        for (const button of this.buttons) {
            button.disabled = busy;
        }
    }
}
