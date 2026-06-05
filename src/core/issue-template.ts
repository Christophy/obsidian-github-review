import { parse as parseYaml } from "yaml";

export type IssueFieldKind = "markdown" | "input" | "textarea" | "dropdown" | "checkboxes";

/** One field of a GitHub issue form, rendered as its own control in the composer. */
export interface IssueFormField {
    kind: IssueFieldKind;
    /** Field label / heading (empty for `markdown` instruction blocks). */
    label: string;
    /** Helper text shown under the control. */
    description: string;
    /** Input/textarea placeholder. */
    placeholder: string;
    required: boolean;
    /** Choices for `dropdown` / `checkboxes`. */
    options: string[];
    /** Static instructional Markdown for `markdown` fields. */
    value: string;
}

/** A starting point for a new issue, derived from a repo's issue template. */
export interface IssueTemplate {
    /** Display name for the picker (the template's `name`, falling back to the filename). */
    name: string;
    /** Default issue title from the template (may be empty). */
    title: string;
    /** Labels the template applies. */
    labels: string[];
    /** Markdown templates: the body. Issue forms: an empty-answer fallback skeleton. */
    body: string;
    /** Present for YAML issue forms — render each as its own input. */
    fields?: IssueFormField[];
}

/** A user's answer to one field, positionally aligned with the template's `fields`. */
export interface IssueFormAnswer {
    /** input / textarea / dropdown value. */
    text?: string;
    /** checkboxes: checked state per option, aligned with the field's `options`. */
    checked?: boolean[];
}

/**
 * Parse a GitHub issue template file into an {@link IssueTemplate}.
 *  - Markdown templates (`.md`): YAML frontmatter (`name`/`title`/`labels`) + a body.
 *  - Issue forms (`.yml`): the GitHub form schema, parsed into `fields` so the
 *    composer can render one control per field; the body is assembled from the
 *    user's answers on submit (see {@link assembleIssueBody}).
 */
export function parseIssueTemplate(filename: string, content: string): IssueTemplate {
    return /\.ya?ml$/i.test(filename)
        ? parseIssueForm(filename, content)
        : parseMarkdownTemplate(filename, content);
}

/**
 * Assemble a GitHub-style issue body from a form's fields and the user's answers:
 * one `### <label>` section per non-markdown field, with the answer (or
 * `_No response_`) underneath. Checkboxes render as a task list.
 */
export function assembleIssueBody(fields: IssueFormField[], answers: IssueFormAnswer[]): string {
    const sections: string[] = [];
    fields.forEach((field, i) => {
        if (field.kind === "markdown") {
            return;
        }
        const answer = answers[i] ?? {};
        let response: string;
        if (field.kind === "checkboxes") {
            response = field.options.length
                ? field.options.map((o, j) => `- [${answer.checked?.[j] ? "x" : " "}] ${o}`).join("\n")
                : "_No response_";
        } else {
            response = (answer.text ?? "").trim() || "_No response_";
        }
        sections.push(`### ${field.label}\n\n${response}`);
    });
    return sections.join("\n\n");
}

function parseMarkdownTemplate(filename: string, content: string): IssueTemplate {
    const { data, body } = extractFrontmatter(content);
    return {
        name: asString(data.name) || filename,
        title: asString(data.title),
        labels: asLabels(data.labels),
        body: body.trim(),
    };
}

function parseIssueForm(filename: string, content: string): IssueTemplate {
    const form = safeParseYaml(content);
    const rawFields = Array.isArray(form.body) ? form.body : [];
    const fields: IssueFormField[] = [];
    for (const raw of rawFields) {
        const field = toFormField(raw);
        if (field) {
            fields.push(field);
        }
    }
    return {
        name: asString(form.name) || filename,
        title: asString(form.title),
        labels: asLabels(form.labels),
        body: assembleIssueBody(fields, []),
        fields,
    };
}

function toFormField(raw: unknown): IssueFormField | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const r = raw as { type?: unknown; attributes?: unknown; validations?: unknown };
    const kind = normalizeKind(r.type);
    if (!kind) {
        return null;
    }
    const attrs = (r.attributes && typeof r.attributes === "object" ? r.attributes : {}) as Record<
        string,
        unknown
    >;
    if (kind === "markdown") {
        const value = asString(attrs.value).trim();
        return value ? blankField("markdown", { value }) : null;
    }
    const label = asString(attrs.label).trim();
    if (!label) {
        return null;
    }
    return blankField(kind, {
        label,
        description: asString(attrs.description).trim(),
        placeholder: asString(attrs.placeholder).trim(),
        required: isRequired(r.validations),
        options: kind === "dropdown" || kind === "checkboxes" ? optionLabels(attrs.options) : [],
    });
}

function blankField(kind: IssueFieldKind, over: Partial<IssueFormField>): IssueFormField {
    return {
        kind,
        label: "",
        description: "",
        placeholder: "",
        required: false,
        options: [],
        value: "",
        ...over,
    };
}

function normalizeKind(type: unknown): IssueFieldKind | null {
    return type === "markdown" ||
        type === "input" ||
        type === "textarea" ||
        type === "dropdown" ||
        type === "checkboxes"
        ? type
        : null;
}

function isRequired(validations: unknown): boolean {
    return !!(
        validations &&
        typeof validations === "object" &&
        (validations as Record<string, unknown>).required === true
    );
}

/** Option labels for dropdown (plain strings) or checkboxes (`{ label }` objects). */
function optionLabels(options: unknown): string[] {
    if (!Array.isArray(options)) {
        return [];
    }
    return options
        .map((o) =>
            o && typeof o === "object" ? asString((o as Record<string, unknown>).label) : asString(o),
        )
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Split a leading `---` YAML frontmatter block from the Markdown body. */
function extractFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
    const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
    if (!match) {
        return { data: {}, body: content };
    }
    return { data: safeParseYaml(match[1] ?? ""), body: match[2] ?? "" };
}

function safeParseYaml(text: string): Record<string, unknown> {
    try {
        const data: unknown = parseYaml(text);
        return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** Labels in templates come as a YAML list or a comma-separated string. */
function asLabels(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}
