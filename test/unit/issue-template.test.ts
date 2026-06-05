import { describe, it } from "mocha";
import { expect } from "chai";
import { parseIssueTemplate, assembleIssueBody } from "../../src/core/issue-template";

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
    const FORM = [
        "name: Feature request",
        "title: '[Feature]: '",
        "labels: [enhancement]",
        "body:",
        "  - type: markdown",
        "    attributes:",
        "      value: Thanks for taking the time!",
        "  - type: textarea",
        "    attributes:",
        "      label: What problem does this solve?",
        "      description: Be specific.",
        "      placeholder: e.g. ...",
        "    validations:",
        "      required: true",
        "  - type: input",
        "    attributes:",
        "      label: Version",
        "  - type: dropdown",
        "    attributes:",
        "      label: Severity",
        "      options:",
        "        - Low",
        "        - High",
        "  - type: checkboxes",
        "    attributes:",
        "      label: Areas",
        "      options:",
        "        - label: API",
        "        - label: UI",
    ].join("\n");

    it("parses each field into its own control (kind/label/description/required/options)", () => {
        const t = parseIssueTemplate("feature.yml", FORM);
        expect(t.title).to.equal("[Feature]: ");
        expect(t.labels).to.deep.equal(["enhancement"]);
        const fields = t.fields!;
        expect(fields.map((f) => f.kind)).to.deep.equal([
            "markdown",
            "textarea",
            "input",
            "dropdown",
            "checkboxes",
        ]);
        expect(fields[0]!.value).to.equal("Thanks for taking the time!");
        expect(fields[1]!.label).to.equal("What problem does this solve?");
        expect(fields[1]!.description).to.equal("Be specific.");
        expect(fields[1]!.placeholder).to.equal("e.g. ...");
        expect(fields[1]!.required).to.equal(true);
        expect(fields[2]!.required).to.equal(false);
        expect(fields[3]!.options).to.deep.equal(["Low", "High"]);
        expect(fields[4]!.options).to.deep.equal(["API", "UI"]);
    });

    it("assembles a GitHub-style body from answers (one ### per field, _No response_ default)", () => {
        const fields = parseIssueTemplate("feature.yml", FORM).fields!;
        const body = assembleIssueBody(fields, [
            {}, // markdown — skipped
            { text: "Slow startup" }, // textarea
            { text: "" }, // input — empty -> _No response_
            { text: "High" }, // dropdown
            { checked: [true, false] }, // checkboxes
        ]);
        expect(body).to.equal(
            [
                "### What problem does this solve?",
                "",
                "Slow startup",
                "",
                "### Version",
                "",
                "_No response_",
                "",
                "### Severity",
                "",
                "High",
                "",
                "### Areas",
                "",
                "- [x] API",
                "- [ ] UI",
            ].join("\n"),
        );
    });

    it("tolerates malformed YAML (no fields)", () => {
        expect(parseIssueTemplate("broken.yml", "body: [: not valid").fields).to.deep.equal([]);
    });
});
