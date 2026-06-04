import { applyMention, extractMentionQuery, filterHandles, type MentionToken } from "../core/mentions";

/**
 * Attaches an `@`-mention autocomplete to a textarea. Candidate handles come
 * from `getHandles` (the apps installed on the repo). Pure text logic lives in
 * core/mentions; this class only does the DOM/keyboard wiring.
 */
export class MentionAutocomplete {
    private dropdown: HTMLElement | null = null;
    private matches: string[] = [];
    private selectedIndex = 0;
    private token: MentionToken | null = null;

    constructor(
        private readonly textarea: HTMLTextAreaElement,
        private readonly getHandles: () => string[],
    ) {
        textarea.addEventListener("input", () => this.update());
        textarea.addEventListener("keydown", (e) => this.onKeyDown(e));
        textarea.addEventListener("blur", () => window.setTimeout(() => this.close(), 120));
    }

    private update(): void {
        const caret = this.textarea.selectionStart ?? this.textarea.value.length;
        const token = extractMentionQuery(this.textarea.value, caret);
        if (!token) {
            this.close();
            return;
        }
        const matches = filterHandles(this.getHandles(), token.query);
        if (matches.length === 0) {
            this.close();
            return;
        }
        this.token = token;
        this.matches = matches;
        this.selectedIndex = 0;
        this.render();
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (!this.dropdown) {
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex + 1) % this.matches.length;
            this.render();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex - 1 + this.matches.length) % this.matches.length;
            this.render();
        } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            this.accept(this.matches[this.selectedIndex]);
        } else if (e.key === "Escape") {
            e.preventDefault();
            this.close();
        }
    }

    private accept(handle: string | undefined): void {
        if (!handle || !this.token) {
            return;
        }
        const caret = this.textarea.selectionStart ?? this.textarea.value.length;
        const result = applyMention(this.textarea.value, this.token.start, caret, handle);
        this.textarea.value = result.text;
        this.textarea.setSelectionRange(result.caret, result.caret);
        this.close();
        this.textarea.focus();
    }

    private render(): void {
        const parent = this.textarea.parentElement;
        if (!parent) {
            return;
        }
        if (!this.dropdown) {
            this.dropdown = parent.createDiv({ cls: "ghr-mention-dropdown" });
        }
        this.dropdown.empty();
        this.dropdown.setCssStyles({
            top: `${this.textarea.offsetTop + this.textarea.offsetHeight}px`,
            left: `${this.textarea.offsetLeft}px`,
        });
        this.matches.forEach((handle, i) => {
            const item = this.dropdown!.createDiv({ cls: "ghr-mention-item", text: `@${handle}` });
            if (i === this.selectedIndex) {
                item.addClass("ghr-mention-item-active");
            }
            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                this.accept(handle);
            });
        });
    }

    private close(): void {
        this.dropdown?.remove();
        this.dropdown = null;
        this.token = null;
        this.matches = [];
    }
}
