/**
 * The activity feed: reading somebody's own events, and turning them into sentences.
 *
 * This is a browser-only module, like src/lib/moderation.ts and for the same kind of reason.
 * A feed is made of exactly the rows the static export must never contain — one person's
 * private view of what they did and what happened to them — so it cannot be built at build
 * time, and the page that shows it is under /account/, which already loads the Supabase
 * client. Nothing here is imported from Astro frontmatter and nothing here may be.
 *
 * The database stores events, not messages: a kind, a target, a timestamp, sometimes an
 * actor. Every word a person reads is composed here, in `describe()`. That is the whole
 * reason this feature is not the "message table" rejected on 2026-08-16 — there is no prose
 * sitting in a row going stale, and rewording a notification is a change to this file rather
 * than a migration over history.
 *
 * Two things `describe()` is careful about, both inherited from the schema:
 *
 *   * **A moderation outcome never names the moderator.** The row carries no actor for one,
 *     so the sentence cannot accidentally acquire a name later.
 *   * **A rating never names the rater.** public.ratings is readable only by its author,
 *     which is what keeps a debate's aggregate hidden until you have taken a position;
 *     "Somebody rated" is the most that may ever be said.
 */
import { getSupabase } from './supabase';
import { path } from './paths';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'Your activity cannot be loaded right now. Nothing has been lost — try again in a few minutes.';

/** Matches public.activity_kind. */
export type ActivityKind =
  | 'posted_report'
  | 'edited_report'
  | 'posted_debate'
  | 'posted_entry'
  | 'commented'
  | 'rated_debate'
  | 'confirmed_report'
  | 'flagged'
  | 'cited'
  | 'report_published'
  | 'report_changes_requested'
  | 'entry_published'
  | 'entry_changes_requested'
  | 'debate_promoted'
  | 'content_hidden'
  | 'content_unhidden'
  | 'account_banned'
  | 'account_unbanned'
  | 'flag_resolved'
  | 'flag_dismissed'
  | 'content_commented'
  | 'comment_reply'
  | 'debate_rated'
  | 'report_confirmed'
  | 'content_cited';

/** Matches public.moderation_target, which public.activity reuses. */
export type ActivityTarget = 'report' | 'debate' | 'comment' | 'flag' | 'entry' | 'account';

export interface ActivityItem {
  readonly id: string;
  readonly kind: ActivityKind;
  /** True when somebody else caused it. Only these count as new. */
  readonly isInbound: boolean;
  readonly actorName: string | null;
  readonly actorIsPseudonym: boolean;
  readonly targetType: ActivityTarget;
  readonly targetId: string;
  readonly commentId: string | null;
  readonly label: string | null;
  readonly createdAt: string;
  /**
   * How many events this row stands for. Always 1 except where `collapse()` below has
   * folded a run of ratings on one debate into a single line.
   */
  readonly count: number;
}

/**
 * The row as it comes back, named rather than inferred.
 *
 * supabase-js types `data` from the *literal type* of the select string, so this exists to
 * be handed to `.overrideTypes<>()`. Getting that wrong types every field below as an error
 * object and produces a screen of complaints that read like renamed columns — see the note
 * in CLAUDE.md. `merge: false` because this replaces the inferred row rather than adding to
 * it: the embedded `actor` comes back as an object here and supabase-js cannot tell that
 * from a one-element array without the schema types generated.
 */
interface ActivityRow {
  id: string;
  kind: ActivityKind;
  is_inbound: boolean;
  target_type: ActivityTarget;
  target_id: string;
  comment_id: string | null;
  label: string | null;
  created_at: string;
  actor: { display_name: string; is_pseudonym: boolean } | null;
}

/**
 * How many rows are fetched. There is no pagination, in common with every other queue on
 * this site: at the sizes this corpus will see for a long while, a hundred lines is a
 * scroll, and the alternative is a "load more" control that exists to be used twice a year.
 * The page says plainly that it shows the most recent hundred.
 */
export const FEED_LIMIT = 100;

// ── Reading ───────────────────────────────────────────────────────────────────────────

/** The most recent events in somebody's feed, newest first, ratings collapsed. */
export async function loadActivity(userId: string): Promise<Result<ActivityItem[]>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    // One string literal, never assembled with `+`. The `actor:actor_id(...)` hint names
    // the foreign key column because this table has two references to profiles and
    // PostgREST cannot pick between them on its own.
    const { data, error } = await supabase
      .from('activity')
      .select(
        'id, kind, is_inbound, target_type, target_id, comment_id, label, created_at, actor:actor_id(display_name, is_pseudonym)',
      )
      .eq('subject_id', userId)
      .order('created_at', { ascending: false })
      .limit(FEED_LIMIT)
      .overrideTypes<ActivityRow[], { merge: false }>();

    if (error) return { ok: false, message: describeError(error) };

    return { ok: true, value: collapse((data ?? []).map(toItem)) };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

/** When this person last looked, or null if they never have. */
export async function loadSeenAt(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('activity_seen')
      .select('seen_at')
      .eq('user_id', userId)
      .maybeSingle<{ seen_at: string }>();

    if (error || !data) return null;
    return data.seen_at;
  } catch {
    return null;
  }
}

/**
 * Move the watermark to now. Called once the feed has rendered, never before — the "new"
 * markers are computed against the previous value, so writing first would mean nothing was
 * ever new.
 *
 * A failure is swallowed. The consequence is that the same items are marked new next time,
 * which is the harmless direction; an error panel over a feed the person is already reading
 * would be worse than a badge that lingers.
 */
export async function markSeen(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    await supabase
      .from('activity_seen')
      .upsert({ user_id: userId, seen_at: new Date().toISOString() });
  } catch {
    // See above.
  }
}

/**
 * How many inbound events have arrived since the watermark.
 *
 * A head count rather than a fetch, because this runs on report and debate pages — anywhere
 * the Supabase client is already loaded — purely to keep the header's badge roughly honest.
 * It must never be the reason a page is slow, so it asks for no rows at all.
 */
export async function countUnread(userId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  try {
    const seenAt = await loadSeenAt(userId);

    let query = supabase
      .from('activity')
      .select('id', { count: 'exact', head: true })
      .eq('subject_id', userId)
      .eq('is_inbound', true);

    if (seenAt) query = query.gt('created_at', seenAt);

    const { count, error } = await query;
    if (error) return 0;

    return count ?? 0;
  } catch {
    return 0;
  }
}

function toItem(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    kind: row.kind,
    isInbound: row.is_inbound,
    actorName: row.actor?.display_name ?? null,
    actorIsPseudonym: row.actor?.is_pseudonym ?? false,
    targetType: row.target_type,
    targetId: row.target_id,
    commentId: row.comment_id,
    label: row.label,
    createdAt: row.created_at,
    count: 1,
  };
}

/**
 * Fold every rating on one debate into a single line.
 *
 * A debate that lands well collects ratings in bursts, and twenty consecutive rows saying
 * "Somebody rated your debate" is not twenty pieces of information — it is one, badly told,
 * burying everything else in the feed. The surviving row is the most recent of the run and
 * carries the count, so the line reads "20 people rated your debate" and sits where the
 * latest of them did.
 *
 * Only ratings. Comments, confirmations and citations each name a person and each say
 * something different, so folding those would lose the part worth reading.
 */
function collapse(items: readonly ActivityItem[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  const seen = new Map<string, number>();

  for (const item of items) {
    if (item.kind !== 'debate_rated') {
      out.push(item);
      continue;
    }

    const at = seen.get(item.targetId);

    if (at === undefined) {
      seen.set(item.targetId, out.length);
      out.push(item);
      continue;
    }

    out[at] = { ...out[at], count: out[at].count + 1 };
  }

  return out;
}

// ── Saying it ─────────────────────────────────────────────────────────────────────────

export interface ActivityLine {
  /** A complete sentence. The label, if there is one, is shown beneath it as the link. */
  readonly text: string;
  readonly label: string | null;
  readonly href: string | null;
}

/** "a report" / "a debate" / "an entry", for sentences that need the noun. */
function noun(target: ActivityTarget): string {
  switch (target) {
    case 'report':
      return 'report';
    case 'debate':
      return 'debate';
    case 'entry':
      return 'network entry';
    default:
      return 'post';
  }
}

/**
 * Who did it, in a form safe to print.
 *
 * "Somebody" is not a fallback for a missing join — it is the correct answer whenever the
 * row carries no actor, which is every moderation outcome and every rating. It is also what
 * an erased account reads as, which is the same sentence for the same reason.
 */
function who(item: ActivityItem): string {
  return item.actorName ?? 'Somebody';
}

/**
 * Where the row points.
 *
 * Reports and debates go to the client-rendered view pages rather than to /reports/<id>/,
 * and that is the same rule the freshness overlay follows. A feed is a list of things that
 * just happened, so it is precisely the place where the last nightly export cannot be
 * trusted to contain the row — and a link to a static page that has not been built yet is a
 * 404 dressed up as a result.
 *
 * Null for the rows where a link would be a lie: a flag, which has no page; an account
 * action, which is about you rather than about a thing; and anything of your own that may
 * still be pending, which is unreadable at its public address and belongs under "Your
 * submissions" instead.
 */
function href(item: ActivityItem): string | null {
  switch (item.kind) {
    case 'posted_report':
    case 'edited_report':
    case 'report_changes_requested':
      return path('/account/#your-submissions');

    case 'posted_entry':
    case 'entry_changes_requested':
      return null;

    case 'flagged':
    case 'flag_resolved':
    case 'flag_dismissed':
    case 'account_banned':
    case 'account_unbanned':
      return null;

    default:
      break;
  }

  const fragment = item.commentId ? `#comment-${item.commentId}` : '';

  switch (item.targetType) {
    case 'report':
      return `${path('/reports/view/')}?id=${item.targetId}${fragment}`;
    case 'debate':
      return `${path('/debates/view/')}?id=${item.targetId}${fragment}`;
    case 'entry':
      return path('/network/');
    default:
      return null;
  }
}

/** One event as a sentence, a label, and somewhere to go. */
export function describe(item: ActivityItem): ActivityLine {
  return { text: sentence(item), label: item.label, href: href(item) };
}

function sentence(item: ActivityItem): string {
  switch (item.kind) {
    // ── Things you did ───────────────────────────────────────────────────────────────
    case 'posted_report':
      return 'You posted a report. It waits for a moderator before it joins the corpus.';
    case 'edited_report':
      return 'You edited your submission and sent it back for review.';
    case 'posted_debate':
      return 'You suggested a debate.';
    case 'posted_entry':
      return 'You submitted an entry to the network.';
    case 'commented':
      return `You commented on a ${noun(item.targetType)}.`;
    case 'rated_debate':
      // Covers an explicit "no opinion" as well as a score, which is why it does not say
      // "you rated": a null score is a real answer and it is not a rating.
      return 'You recorded your view on a debate.';
    case 'confirmed_report':
      return 'You said whether a report still works.';
    case 'flagged':
      return 'You flagged something for the moderators.';
    case 'cited':
      return `You referenced a ${noun(item.targetType)}.`;

    // ── Moderation ───────────────────────────────────────────────────────────────────
    case 'report_published':
      return 'A moderator published your report. It is part of the corpus now.';
    case 'report_changes_requested':
      return 'A moderator asked for changes to your report. What to change is under "Your submissions".';
    case 'entry_published':
      return 'A moderator published your network entry.';
    case 'entry_changes_requested':
      return 'A moderator asked for changes to your network entry.';
    case 'debate_promoted':
      return 'A moderator opened your debate for rating.';
    case 'content_hidden':
      return item.commentId
        ? 'A moderator hid your comment.'
        : `A moderator hid your ${noun(item.targetType)}.`;
    case 'content_unhidden':
      return item.commentId
        ? 'A moderator restored your comment.'
        : `A moderator restored your ${noun(item.targetType)}.`;
    case 'account_banned':
      return 'Your account has been suspended. You can still read the site, but not post.';
    case 'account_unbanned':
      return 'Your account has been restored. You can post again.';
    case 'flag_resolved':
      return 'A moderator acted on something you flagged.';
    case 'flag_dismissed':
      return 'A moderator looked at something you flagged and left it where it was.';

    // ── Other people ─────────────────────────────────────────────────────────────────
    case 'content_commented':
      return `${who(item)} commented on your ${noun(item.targetType)}.`;
    case 'comment_reply':
      return `${who(item)} replied to your comment.`;
    case 'debate_rated':
      // Never a name: see the header. The count is what this line is for.
      return item.count === 1
        ? 'Somebody rated your debate.'
        : `${item.count} people rated your debate.`;
    case 'report_confirmed':
      return `${who(item)} said whether your report still works.`;
    case 'content_cited':
      return `${who(item)} referenced your ${noun(item.targetType)}.`;
  }
}

function describeError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';

  if (code === '42501') {
    return 'This session is no longer signed in. Sign in again to see your activity.';
  }

  return UNAVAILABLE;
}
