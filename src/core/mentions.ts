/**
 * Pure helpers for @mention support: turning a bot login into a mention handle,
 * and tracking/replacing an in-progress @mention token in a textarea.
 */

/** A bot's GitHub login is "name[bot]"; you @mention it as "@name". */
export function botMentionHandle(login: string): string {
    const suffix = "[bot]";
    return login.endsWith(suffix) ? login.slice(0, -suffix.length) : login;
}

export interface MentionToken {
    /** Text typed after the '@', so far. */
    query: string;
    /** Index of the '@' in the source text. */
    start: number;
}

/**
 * Find an in-progress @mention ending at the caret: an '@' that starts a word
 * (preceded by start-of-text or whitespace) followed only by mention chars.
 */
export function extractMentionQuery(text: string, caret: number): MentionToken | null {
    for (let i = caret - 1; i >= 0; i -= 1) {
        const ch = text[i] ?? "";
        if (ch === "@") {
            const before = i > 0 ? (text[i - 1] ?? "") : "";
            if (before === "" || /\s/.test(before)) {
                const query = text.slice(i + 1, caret);
                if (/^[A-Za-z0-9-]*$/.test(query)) {
                    return { query, start: i };
                }
            }
            return null;
        }
        if (/\s/.test(ch)) {
            return null;
        }
    }
    return null;
}

/** Replace the @query spanning [start, caret) with `@handle ` and report the new caret. */
export function applyMention(
    text: string,
    start: number,
    caret: number,
    handle: string,
): { text: string; caret: number } {
    const inserted = `@${handle} `;
    return {
        text: text.slice(0, start) + inserted + text.slice(caret),
        caret: start + inserted.length,
    };
}

/** Case-insensitive prefix filter over candidate handles. */
export function filterHandles(handles: string[], query: string): string[] {
    const q = query.toLowerCase();
    return handles.filter((h) => h.toLowerCase().startsWith(q));
}
