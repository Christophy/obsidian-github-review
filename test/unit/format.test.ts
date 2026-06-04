import { describe, it } from "mocha";
import { expect } from "chai";
import { formatRelativeTime } from "../../src/core/format";

const NOW = new Date("2026-06-04T12:00:00Z");

describe("formatRelativeTime", () => {
    it("formats days ago", () => {
        expect(formatRelativeTime("2026-06-02T12:00:00Z", NOW, "en")).to.equal("2 days ago");
    });
    it("formats hours ago", () => {
        expect(formatRelativeTime("2026-06-04T09:00:00Z", NOW, "en")).to.equal("3 hours ago");
    });
    it("formats a future time", () => {
        expect(formatRelativeTime("2026-06-05T12:00:00Z", NOW, "en")).to.equal("tomorrow");
    });
    it("falls back to the raw string for an invalid date", () => {
        expect(formatRelativeTime("not a date", NOW, "en")).to.equal("not a date");
    });
});
