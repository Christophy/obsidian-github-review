import { parse as parseYaml } from "yaml";

/** A starting point for a new issue, derived from a repo's issue template. */
export interface IssueTemplate {
    /** Display name for the picker (the template's `name`, falling back to the filename). */
    name: string;
    /** Default issue title from the template (may be empty). */
    title: string;
    /** Labels the template applies. */
    labels: string[];
    /** Pre-filled issue body (Markdown). */
    body: string;
}

/**
 * Parse a GitHub issue template file into an {@link IssueTemplate}. Handles both
 * formats GitHub supports:
 *  - Markdown templates (`.md`): YAML frontmatter (`name`/`title`/`labels`) + a body.
 *  - Issue forms (`.yml`): the GitHub form schema, rendered to a Markdown skeleton
 *    (one `### label` section per field). This plugin edits Markdown, not interactive
 *    forms, so a form becomes a fill-in-the-blanks body.
 */
export function parseIssueTemplate(filename: string, content: string): IssueTemplate {
    return /\.ya?ml$/i.test(filename)
        ? parseIssueForm(filename, content)
        : parseMarkdownTemplate(filename, content);
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
    const fields = Array.isArray(form.body) ? form.body : [];
    const sections: string[] = [];

    for (const field of fields) {
        if (!field || typeof field !== "object") {
            continue;
        }
        const f = field as { type?: unknown; attributes?: unknown };
        const attrs = (f.attributes && typeof f.attributes === "object" ? f.attributes : {}) as Record<
            string,
            unknown
        >;
        // A "markdown" field is static instructional text, kept verbatim.
        if (f.type === "markdown") {
            const value = asString(attrs.value).trim();
            if (value) {
                sections.push(value);
            }
            continue;
        }
        const label = asString(attrs.label).trim();
        if (!label) {
            continue;
        }
        const desc = asString(attrs.description).trim();
        sections.push(desc ? `### ${label}\n\n${desc}` : `### ${label}`);
    }

    return {
        name: asString(form.name) || filename,
        title: asString(form.title),
        labels: asLabels(form.labels),
        body: sections.join("\n\n"),
    };
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
