const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
];

/**
 * Format an ISO timestamp relative to `now`, e.g. "2 days ago". Falls back to
 * the raw string for an unparseable input. `locale` is exposed for tests.
 */
export function formatRelativeTime(iso: string, now: Date, locale?: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) {
        return iso;
    }
    const diffSec = Math.round((then - now.getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, secs] of UNITS) {
        if (Math.abs(diffSec) >= secs) {
            return rtf.format(Math.round(diffSec / secs), unit);
        }
    }
    return rtf.format(diffSec, "second");
}
