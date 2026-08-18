/**
 * Moderation decisions, as the people they are about read them.
 *
 * A moderator hides a comment, or looks at a flag and leaves the post where it was. Two
 * people are owed the reason: whoever wrote the post, and whoever raised the flag. Neither
 * of them may read public.moderation_actions — that log is written *to other moderators*,
 * in the shorthand of people who have read the whole queue, and it names the moderator. So
 * the same sentence is written twice: once into the log, and once into
 * public.moderation_notices, addressed to a person.
 *
 * This module reads the second one. It is browser-only, like src/lib/activity.ts and for the
 * same reason: a decision about your post is not in the static export and must never be.
 *
 * What a notice never carries, and what the policy behind it is doing:
 *
 *   * **No moderator's name.** The row has no column for one. A hide is the site's decision,
 *     not one person's, and naming the hand turns an appeal into a grievance.
 *   * **No flagger's name.** An author is told their post was flagged and decided. Who
 *     raised it is not part of the answer, and telling them is how a moderation system
 *     becomes a weapon.
 *   * **One row per recipient**, so the policy is `recipient_id = auth.uid()` and nothing
 *     more delicate than that. See the migration for why that shape was chosen.
 *
 * The feed at /account/activity/ says *that* something was decided. This says *why*. Both
 * exist because a notification nobody can act on is noise, and an explanation nobody is told
 * about is a file in a drawer.
 */
import { getSupabase } from './supabase';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'Moderation decisions cannot be loaded right now. Try again in a few minutes; nothing has been lost.';

/** What the decision did, in the words a member reads. Mirrors public.moderation_outcome. */
export type NoticeOutcome = 'hidden' | 'kept' | 'restored';

/** Why you are being told. Mirrors public.notice_recipient. */
export type NoticeRole = 'author' | 'flagger';

export type NoticeSubject = 'report' | 'debate' | 'comment' | 'entry';

export interface Notice {
  readonly id: string;
  readonly subjectType: NoticeSubject;
  readonly subjectId: string;
  /** The heading of the post — and for a comment, the heading of the thread it is in.
   *  Never a comment body: the same rule as public.activity.label. */
  readonly label: string | null;
  readonly outcome: NoticeOutcome;
  readonly explanation: string;
  readonly role: NoticeRole;
  readonly createdAt: string;
}

/**
 * Every decision this account has been told about, newest first.
 *
 * No filter by recipient is written here, and that is deliberate rather than sloppy:
 * `moderation_notices_select_own` returns the caller's rows and nothing else, so a filter
 * would be a second copy of a rule that is already the only reason this query returns
 * anything. Where the same choice went the other way — loadOwnReports() writes the author
 * filter out — it is because that table also has a moderator policy, and a query that reads
 * correctly for a member would quietly return the whole corpus to a moderator.
 */
export async function loadNotices(): Promise<Result<Notice[]>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('moderation_notices')
      .select('id, subject_type, subject_id, label, outcome, explanation, recipient_role, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return { ok: false, message: UNAVAILABLE };

    return {
      ok: true,
      value: (data ?? []).map((row) => ({
        id: row.id as string,
        subjectType: row.subject_type as NoticeSubject,
        subjectId: row.subject_id as string,
        label: (row.label as string | null) ?? null,
        outcome: row.outcome as NoticeOutcome,
        explanation: row.explanation as string,
        role: row.recipient_role as NoticeRole,
        createdAt: row.created_at as string,
      })),
    };
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
}

const NOUN: Record<NoticeSubject, string> = {
  report: 'report',
  debate: 'debate',
  comment: 'comment',
  entry: 'network entry',
};

/**
 * One decision as a heading.
 *
 * Written from the reader's side, which is why the same outcome produces two sentences: to
 * an author "your report was hidden" is the news, and to the person who flagged it the news
 * is that their flag was answered. A single neutral sentence would serve neither.
 */
export function noticeHeading(notice: Notice): string {
  const noun = NOUN[notice.subjectType];

  if (notice.role === 'flagger') {
    switch (notice.outcome) {
      case 'hidden':
        return `The ${noun} you flagged was hidden`;
      case 'kept':
        return `The ${noun} you flagged stays up`;
      case 'restored':
        return `The ${noun} you flagged was restored`;
    }
  }

  switch (notice.outcome) {
    case 'hidden':
      return `Your ${noun} was hidden`;
    case 'kept':
      return `Your ${noun} was flagged, and stays up`;
    case 'restored':
      return `Your ${noun} is back`;
  }
}

/** What to do next, where there is anything to do. Only an author whose own post is hidden
 *  has a next step; everybody else is being told, not asked. */
export function noticeFollowUp(notice: Notice): string | null {
  if (notice.role !== 'author' || notice.outcome !== 'hidden') return null;

  switch (notice.subjectType) {
    case 'report':
      return 'You can edit it while it is hidden and ask for it to be looked at again.';
    case 'entry':
      return 'You can edit it while it is hidden and ask for it to be looked at again.';
    case 'debate':
      return 'Post a differently worded claim if the point still stands.';
    case 'comment':
      return 'The thread is still there, and you can reply to it again.';
  }
}
