/**
 * A guess at how many notifications are waiting, made without loading Supabase.
 *
 * The same trade-off as session-hint.ts and mod-hint.ts, and it is worth restating because
 * this is the one where the temptation to do it properly is strongest. A notification badge
 * wants to be live. Making it live would mean the header asking the database on every page —
 * including /reports/ and /debates/, which are deliberately free of the auth bundle and must
 * stay that way. That is the read/write split in CLAUDE.md, and a badge is not a good enough
 * reason to spend it.
 *
 * So the count is written to localStorage by the pages that talk to the database anyway —
 * the account pages, and any report or debate page, through the comment thread — and the
 * header reads whatever was left there. It is stale between those visits and honest about
 * it: the header only ever offers a way in, and the activity page itself is where the truth
 * is. Being wrong costs a click.
 *
 * The failure direction is "no badge", never "a badge that is not there when you arrive":
 * an unreadable store, a missing key or anything unparseable all read as zero.
 */

const COUNT_KEY = 'mathemact-activity';

export function readActivityHint(): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 0;

    const raw = window.localStorage.getItem(COUNT_KEY);
    if (!raw) return 0;

    const count = Number.parseInt(raw, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

export function setActivityHint(count: number): void {
  try {
    window.localStorage.setItem(COUNT_KEY, String(Math.max(0, Math.trunc(count))));
  } catch {
    // Storage blocked. The badge will not appear; the activity page still works.
  }
}

export function clearActivityHint(): void {
  try {
    window.localStorage.removeItem(COUNT_KEY);
  } catch {}
}
