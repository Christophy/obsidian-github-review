import { App, Modal, Setting } from "obsidian";

/** A tiny modal that asks for a GitHub issue/PR URL and hands it back. */
export class UrlPromptModal extends Modal {
    private value = "";

    constructor(
        app: App,
        private readonly onSubmit: (url: string) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Open a GitHub issue or pull request" });

        new Setting(contentEl).setName("URL").addText((text) => {
            text.setPlaceholder("https://github.com/owner/repo/pull/123").onChange((v) => {
                this.value = v.trim();
            });
            text.inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    this.submit();
                }
            });
        });

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Open")
                .setCta()
                .onClick(() => this.submit()),
        );
    }

    private submit(): void {
        if (this.value) {
            this.close();
            this.onSubmit(this.value);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
