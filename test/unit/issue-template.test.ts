import { describe, it } from "mocha";
import { expect } from "chai";
import { parseIssueTemplate } from "../../src/core/issue-template";

describe("parseIssueTemplate – Markdown templates", () => {
    it("extracts name, title, labels (YAML list) and the body from frontmatter", () => {
        const content = [
            "---",
            "name: Bug report",
            "about: Report a problem",
            "title: '[Bug]: '",
            "labels:",
            "  - bug",
            "  - triage",
            "---",
            "",
            "## Steps to reproduce",
            "",
            "1. ...",
        ].join("\n");

        const t = parseIssueTemplate("bug.md", content);

        expect(t.name).to.equal("Bug report");
        expect(t.title).to.equal("[Bug]: ");
        expect(t.labels).to.deep.equal(["bug", "triage"]);
        expect(t.body).to.equal("## Steps to reproduce\n\n1. ...");
    });

    it("accepts labels as a comma-separated string", () => {
        const content = ["---", "name: Chore", "labels: chore, good first issue", "---", "Body."].join(
            "\n",
        );
        const t = parseIssueTemplate("chore.md", content);
        expect(t.labels).to.deep.equal(["chore", "good first issue"]);
    });

    it("falls back to the filename and treats a file with no frontmatter as all body", () => {
        const t = parseIssueTemplate("freeform.md", "Just a plain template body.");
        expect(t.name).to.equal("freeform.md");
        expect(t.title).to.equal("");
        expect(t.labels).to.deep.equal([]);
        expect(t.body).to.equal("Just a plain template body.");
    });
});

describe("parseIssueTemplate – YAML issue forms", () => {
    it("renders one `### heading` per field, GitHub-style (excludes markdown + descriptions)", () => {
        const content = [
            "name: Feature request",
            "description: Suggest an idea",
            "title: '[Feature]: '",
            "labels: [enhancement]",
            "body:",
            "  - type: markdown",
            "    attributes:",
            "      value: Thanks for taking the time!",
            "  - type: textarea",
            "    attributes:",
            "      label: What problem does this solve?",
            "      description: A clear description.",
            "  - type: input",
            "    attributes:",
            "      label: Version",
        ].join("\n");

        const t = parseIssueTemplate("feature.yml", content);

        expect(t.name).to.equal("Feature request");
        expect(t.title).to.equal("[Feature]: ");
        expect(t.labels).to.deep.equal(["enhancement"]);
        // markdown instruction and helper description are dropped (form-only, like GitHub);
        // each input becomes a heading with a blank line under it to answer in.
        expect(t.body).to.equal("### What problem does this solve?\n\n### Version");
    });

    it("renders a checkboxes field as a task list under its heading", () => {
        const content = [
            "body:",
            "  - type: checkboxes",
            "    attributes:",
            "      label: Affected platforms",
            "      options:",
            "        - label: Desktop",
            "        - label: Mobile",
        ].join("\n");
        expect(parseIssueTemplate("forms.yml", content).body).to.equal(
            "### Affected platforms\n\n- [ ] Desktop\n- [ ] Mobile",
        );
    });

    it("ignores fields without a label and tolerates malformed YAML", () => {
        expect(parseIssueTemplate("broken.yml", "body: [: not valid").body).to.equal("");
    });
});
