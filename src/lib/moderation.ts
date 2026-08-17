/**
 * The moderation queue: what is waiting, and the one function that acts on it.
 *
 * Everything here runs in a browser. That is unlike the rest of src/lib/, where reads happen
 * at build time and only writes reach the database — and it is forced rather than chosen. A
 * queue is made of exactly the rows the static export does not contain: pending submissions,
 * hidden content, open flags, standing erasure requests. None of them may be built into a
 * public file, and none of them is visible to the anonymous key the build uses. So the
 * moderation screen is the one page on this site that genuinely needs a live session, and it
 * is the only reading page that loads the Supabase client.
 *
 * Two rules shape every query below.
 *
 * **No address, ever.** There is no email column in the exposed schema and there is no
 * function that returns one, so this is not a matter of discipline here — but the rule is
 * worth restating where a moderator's screen is being designed, because "who is this person"
 * is exactly the question that invites somebody to add one. A moderator sees a display name
 * and a badge, the same as any reader.
 *
 * **Nothing changes state except through `act()`.** It calls public.moderate(), which is the
 * only route the database now offers: the moderator UPDATE policies were dropped in
 * 20260815200300, so a direct write from here would silently do nothing. That is deliberate.
 * The effect and its audit row are one transaction, so there is no ordering of events in
 * which something is hidden and no row says who hid it.
 */
import { getSupabase } from './supabase';
import type { Area, TaskType } from './report-schema';
import type { Outcome } from './status';
import type { FlagReason, FlagSubject } from './comments';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'The database cannot be reached right now. Nothing was changed. Try again in a few minutes.';

// ── Who is looking ────────────────────────────────────────────────────────────────────

export type Role = 'member' | 'moderator' | 'admin';

export function moderates(role: Role): boolean {
  return role === 'moderator' || role === 'admin';
}

/**
 * The signed-in person's role, read from their own profile row.
 *
 * A failure returns 'member'. The gate this feeds is "show the moderation screen or show a
 * page not found", and the safe answer to "we could not tell" is the 404 — an interface that
 * revealed itself whenever the network hiccuped would be worse than useless, because the one
 * thing it must not do is confirm that the address exists to someone who is guessing.
 */
export async function loadRole(userId: string): Promise<Role> {
  const supabase = getSupabase();
  if (!supabase) return 'member';

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role, is_banned')
      .eq('id', userId)
      .maybeSingle<{ role: string; is_banned: boolean }>();

    if (error || !data || data.is_banned) return 'member';
    return data.role === 'admin' || data.role === 'moderator' ? data.role : 'member';
  } catch {
    return 'member';
  }
}

// ── What a queue item carries ─────────────────────────────────────────────────────────
// Enough to decide without opening anything else. A moderator who has to click through to
// read the verification section will stop reading it, and that section is the whole reason
// this corpus is worth having.

export interface QueueAuthor {
  readonly id: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
  readonly institution: { readonly name: string; readonly country: string } | null;
}

export interface QueueTool {
  readonly name: string;
  readonly version: string;
  readonly usedOn: string;
}

export interface QueueReport {
  readonly id: string;
  readonly status: 'pending' | 'published' | 'hidden';
  readonly title: string;
  readonly area: Area;
  readonly taskType: TaskType;
  readonly aim: string;
  readonly method: string;
  readonly outcome: Outcome;
  readonly outcomeNotes: string;
  readonly verification: string;
  readonly transcriptExcerpt: string | null;
  readonly transcriptUrl: string | null;
  readonly caveats: string | null;
  readonly thirdPartyMaterialConfirmed: boolean;
  readonly timeSpentMinutes: number | null;
  readonly wasPublished: boolean | null;
  readonly wasDisclosed: boolean | null;
  readonly authorConfidence: number | null;
  readonly createdAt: string;
  readonly author: QueueAuthor | null;
  readonly tools: readonly QueueTool[];
  readonly tags: readonly string[];
  /** The current change request, if this has already been sent back once. */
  readonly note: string | null;
  readonly noteAt: string | null;
}

export interface QueueDebate {
  readonly id: string;
  readonly status: 'proposed' | 'active' | 'hidden';
  readonly statement: string;
  readonly rationale: string | null;
  readonly area: Area;
  readonly createdAt: string;
  readonly author: QueueAuthor | null;
  readonly ratingCount: number;
}

export interface QueueComment {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly status: 'published' | 'hidden';
  readonly author: QueueAuthor | null;
  readonly parentType: 'report' | 'debate';
  readonly parentId: string;
}

export interface QueueEntry {
  readonly id: string;
  readonly status: 'pending' | 'published' | 'hidden';
  readonly title: string;
  readonly url: string;
  readonly category: string;
  readonly description: string;
  readonly relevance: string;
  readonly createdAt: string;
  readonly author: QueueAuthor | null;
  readonly note: string | null;
  readonly noteAt: string | null;
}

export interface QueueFlag {
  readonly id: string;
  readonly subjectType: FlagSubject;
  readonly subjectId: string;
  readonly reason: FlagReason;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly flagger: QueueAuthor | null;
  /** The flagged thing itself, so the decision can be made on this screen. Null when it
   *  has since been deleted outright — a soft-deleted comment keeps no text. */
  readonly subject: {
    readonly kind: FlagSubject;
    readonly heading: string;
    readonly body: string;
    readonly status: string;
    readonly author: QueueAuthor | null;
  } | null;
}

export interface QueueErasure {
  readonly id: string;
  readonly requestedAt: string;
  readonly note: string | null;
  readonly member: QueueAuthor | null;
  /** What erasure will detach. Shown because "this will unname 14 reports" is the fact an
   *  admin needs before pressing the button, and it is not recoverable afterwards. */
  readonly reportCount: number;
  readonly commentCount: number;
}

export interface Queues {
  readonly reports: readonly QueueReport[];
  readonly debates: readonly QueueDebate[];
  readonly entries: readonly QueueEntry[];
  readonly flags: readonly QueueFlag[];
  readonly hiddenReports: readonly QueueReport[];
  readonly hiddenDebates: readonly QueueDebate[];
  readonly hiddenComments: readonly QueueComment[];
  readonly hiddenEntries: readonly QueueEntry[];
  /** Empty for a moderator: erasure is an account action and only admins see it. */
  readonly erasures: readonly QueueErasure[];
}

// ── Reading the queues ────────────────────────────────────────────────────────────────

const AUTHOR_COLUMNS =
  'id,display_name,is_pseudonym,institution_name,institution_country';

const REPORT_COLUMNS = [
  'id,status,title,area,task_type,aim,method,outcome,outcome_notes,verification',
  'transcript_excerpt,transcript_url,caveats,third_party_material_confirmed',
  'time_spent_minutes,was_published,was_disclosed,author_confidence,created_at',
  'moderation_note,moderation_note_at',
  `author:profiles!reports_author_id_fkey(${AUTHOR_COLUMNS})`,
  'report_tools(tool_name,tool_version,used_on)',
  'report_tags(tags(code))',
].join(',');

const DEBATE_COLUMNS = [
  'id,status,statement,rationale,area,created_at',
  `author:profiles!debates_author_id_fkey(${AUTHOR_COLUMNS})`,
].join(',');

const COMMENT_COLUMNS = [
  'id,body,created_at,status,parent_type,parent_id',
  `author:profiles!comments_author_id_fkey(${AUTHOR_COLUMNS})`,
].join(',');

const NETWORK_COLUMNS = [
  'id,status,title,url,category,description,relevance,created_at',
  'moderation_note,moderation_note_at',
  `author:profiles!network_entries_submitter_id_fkey(${AUTHOR_COLUMNS})`,
].join(',');

interface RawAuthor {
  id: string;
  display_name: string;
  is_pseudonym: boolean;
  institution_name: string | null;
  institution_country: string | null;
}

function toAuthor(row: RawAuthor | null | undefined): QueueAuthor | null {
  if (!row) return null;

  return {
    id: row.id,
    displayName: row.display_name,
    isPseudonym: row.is_pseudonym,
    institution:
      row.institution_name && row.institution_country
        ? { name: row.institution_name, country: row.institution_country }
        : null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toReport(row: any): QueueReport {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    area: row.area,
    taskType: row.task_type,
    aim: row.aim,
    method: row.method,
    outcome: row.outcome,
    outcomeNotes: row.outcome_notes,
    verification: row.verification,
    transcriptExcerpt: row.transcript_excerpt,
    transcriptUrl: row.transcript_url,
    caveats: row.caveats,
    thirdPartyMaterialConfirmed: row.third_party_material_confirmed,
    timeSpentMinutes: row.time_spent_minutes,
    wasPublished: row.was_published,
    wasDisclosed: row.was_disclosed,
    authorConfidence: row.author_confidence,
    createdAt: row.created_at,
    author: toAuthor(row.author),
    tools: (row.report_tools ?? []).map((tool: any) => ({
      name: tool.tool_name,
      version: tool.tool_version,
      usedOn: tool.used_on,
    })),
    tags: (row.report_tags ?? []).flatMap((link: any) =>
      link.tags ? [link.tags.code] : [],
    ),
    note: row.moderation_note ?? null,
    noteAt: row.moderation_note_at ?? null,
  };
}

/**
 * The rating count comes from public.debate_ratings rather than from the ratings table,
 * and it has to. A rating row is readable only by the person who wrote it — that is the rule
 * that keeps individual answers unattributable — so counting through an embed would report
 * how many times the moderator had rated it, which is a plausible-looking zero.
 */
function toDebate(row: any, raters: Map<string, number>): QueueDebate {
  return {
    id: row.id,
    status: row.status,
    statement: row.statement,
    rationale: row.rationale,
    area: row.area,
    createdAt: row.created_at,
    author: toAuthor(row.author),
    ratingCount: raters.get(row.id) ?? 0,
  };
}

function toComment(row: any): QueueComment {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    status: row.status,
    author: toAuthor(row.author),
    parentType: row.parent_type,
    parentId: row.parent_id,
  };
}

function toEntry(row: any): QueueEntry {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    url: row.url,
    category: row.category,
    description: row.description,
    relevance: row.relevance,
    createdAt: row.created_at,
    author: toAuthor(row.author),
    note: row.moderation_note ?? null,
    noteAt: row.moderation_note_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Everything waiting, in one round of queries.
 *
 * Deliberately not one query per queue in sequence: a moderator opening this page is about
 * to read carefully for twenty minutes, and the whole point of showing four queues together
 * is that the shape of the backlog is visible at a glance. Nothing here is paginated yet,
 * which is the right trade while the corpus is small and the wrong one later; the note is in
 * docs/moderation.md rather than in a TODO nobody reads.
 */
export async function loadQueues(role: Role): Promise<Result<Queues>> {
  if (import.meta.env.DEV && usingFixtures()) return { ok: true, value: FIXTURES };

  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const [
      reports,
      debates,
      entries,
      flags,
      hiddenReports,
      hiddenDebates,
      hiddenComments,
      hiddenEntries,
    ] = await Promise.all([
      supabase
        .from('reports')
        .select(REPORT_COLUMNS)
        .eq('status', 'pending')
        .is('deleted_at', null)
        // Oldest first: the submission that has waited longest is the one to look at next.
        .order('created_at', { ascending: true }),
      supabase
        .from('debates')
        .select(DEBATE_COLUMNS)
        .eq('status', 'proposed')
        .order('created_at', { ascending: true }),
      supabase
        .from('network_entries')
        .select(NETWORK_COLUMNS)
        .eq('status', 'pending')
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('flags')
        .select(
          `id,subject_type,subject_id,reason,detail,created_at,flagger:profiles!flags_flagger_id_fkey(${AUTHOR_COLUMNS})`,
        )
        .eq('status', 'open')
        .order('created_at', { ascending: true }),
      supabase
        .from('reports')
        .select(REPORT_COLUMNS)
        .eq('status', 'hidden')
        .order('created_at', { ascending: false }),
      supabase
        .from('debates')
        .select(DEBATE_COLUMNS)
        .eq('status', 'hidden')
        .order('created_at', { ascending: false }),
      supabase
        .from('comments')
        .select(COMMENT_COLUMNS)
        .eq('status', 'hidden')
        .order('created_at', { ascending: false }),
      supabase
        .from('network_entries')
        .select(NETWORK_COLUMNS)
        .eq('status', 'hidden')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ]);

    const failed = [
      reports,
      debates,
      entries,
      flags,
      hiddenReports,
      hiddenDebates,
      hiddenComments,
      hiddenEntries,
    ].find((response) => response.error);

    if (failed?.error) return { ok: false, message: describe(failed.error) };

    const raters = await countRaters([
      ...(debates.data ?? []),
      ...(hiddenDebates.data ?? []),
    ]);

    const value: Queues = {
      reports: (reports.data ?? []).map(toReport),
      debates: (debates.data ?? []).map((row) => toDebate(row, raters)),
      entries: (entries.data ?? []).map(toEntry),
      flags: await withSubjects(flags.data ?? []),
      hiddenReports: (hiddenReports.data ?? []).map(toReport),
      hiddenDebates: (hiddenDebates.data ?? []).map((row) =>
        toDebate(row, raters),
      ),
      hiddenComments: (hiddenComments.data ?? []).map(toComment),
      hiddenEntries: (hiddenEntries.data ?? []).map(toEntry),
      erasures: role === 'admin' ? await loadErasures() : [],
    };

    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** How many people have answered each of these debates, from the aggregate view. Five
 *  is the threshold that promotes one without a moderator, so this number is the difference
 *  between "promote it" and "leave it, it will promote itself". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countRaters(rows: any[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const supabase = getSupabase();
  if (!supabase || !rows.length) return counts;

  const { data } = await supabase
    .from('debate_ratings')
    .select('debate_id,total_raters')
    .in(
      'debate_id',
      rows.map((row) => row.id),
    );

  for (const row of data ?? []) {
    counts.set(row.debate_id as string, Number(row.total_raters ?? 0));
  }

  return counts;
}

/**
 * Attach the flagged content to each flag.
 *
 * A flag names a row by kind and id, which no join can follow — the subject is
 * polymorphic. So this is three queries by id, and it is worth them: a queue that showed
 * "comment flagged as abusive" without the comment would send a volunteer to another page
 * to find out, and the decision would get made on the flagger's summary instead of on the
 * thing itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withSubjects(rows: any[]): Promise<QueueFlag[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const idsOf = (kind: FlagSubject) =>
    rows.filter((row) => row.subject_type === kind).map((row) => row.subject_id);

  const [reports, debates, comments] = await Promise.all([
    idsOf('report').length
      ? supabase
          .from('reports')
          .select(`id,title,aim,status,author:profiles!reports_author_id_fkey(${AUTHOR_COLUMNS})`)
          .in('id', idsOf('report'))
      : Promise.resolve({ data: [], error: null }),
    idsOf('debate').length
      ? supabase
          .from('debates')
          .select(
            `id,statement,rationale,status,author:profiles!debates_author_id_fkey(${AUTHOR_COLUMNS})`,
          )
          .in('id', idsOf('debate'))
      : Promise.resolve({ data: [], error: null }),
    idsOf('comment').length
      ? supabase.from('comments').select(COMMENT_COLUMNS).in('id', idsOf('comment'))
      : Promise.resolve({ data: [], error: null }),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // supabase-js types a `select()` by parsing the column string at the type level, which it
  // can only do for a literal. Ours are assembled from constants so that the author embed is
  // written once, so the rows arrive untyped and are shaped by hand below.
  const index = new Map<string, any>();
  for (const row of (reports.data ?? []) as any[]) index.set(`report:${row.id}`, row);
  for (const row of (debates.data ?? []) as any[]) index.set(`debate:${row.id}`, row);
  for (const row of (comments.data ?? []) as any[]) index.set(`comment:${row.id}`, row);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return rows.map((row) => {
    const found = index.get(`${row.subject_type}:${row.subject_id}`);

    return {
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      reason: row.reason,
      detail: row.detail,
      createdAt: row.created_at,
      flagger: toAuthor(row.flagger),
      subject: found
        ? {
            kind: row.subject_type,
            heading:
              row.subject_type === 'report'
                ? found.title
                : row.subject_type === 'debate'
                  ? found.statement
                  : 'Comment',
            body:
              row.subject_type === 'report'
                ? found.aim
                : row.subject_type === 'debate'
                  ? (found.rationale ?? '')
                  : found.body,
            status: found.status,
            author: toAuthor(found.author),
          }
        : null,
    };
  });
}

/** Standing erasure requests, with the size of what erasing will detach. Admins only: the
 *  policy on public.deletion_requests returns nothing to a moderator, so this is not a
 *  second gate but the same one, stated where a reader of this file will see it. */
async function loadErasures(): Promise<QueueErasure[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('deletion_requests')
    .select('id,user_id,note,requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });

  if (error || !data?.length) return [];

  // deletion_requests references auth.users, not profiles, so there is no embed to follow.
  const ids = data.map((row) => row.user_id as string);
  const { data: people } = await supabase.from('profiles').select(AUTHOR_COLUMNS).in('id', ids);

  const byId = new Map<string, QueueAuthor>();
  for (const person of people ?? []) {
    const author = toAuthor(person as unknown as RawAuthor);
    if (author) byId.set(author.id, author);
  }

  return Promise.all(
    data.map(async (row) => {
      const userId = row.user_id as string;

      const [reports, comments] = await Promise.all([
        supabase
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', userId),
        supabase
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', userId),
      ]);

      return {
        id: row.id as string,
        requestedAt: row.requested_at as string,
        note: (row.note as string | null) ?? null,
        member: byId.get(userId) ?? null,
        reportCount: reports.count ?? 0,
        commentCount: comments.count ?? 0,
      };
    }),
  );
}

// ── Acting ────────────────────────────────────────────────────────────────────────────

export type Target = 'report' | 'debate' | 'comment' | 'flag' | 'entry' | 'account';

export type Action =
  | 'publish'
  | 'request_changes'
  | 'hide'
  | 'unhide'
  | 'promote'
  | 'resolve_flag'
  | 'dismiss_flag'
  | 'ban'
  | 'unban'
  | 'erase_account';

/** The actions that will not go through without a reason, mirrored from the CHECK on
 *  public.moderation_actions so the form can say so before the round trip. */
export const NEEDS_REASON: readonly Action[] = ['hide', 'request_changes', 'ban'];

/**
 * The single call. Everything the screen does goes through here, because everything the
 * database will accept goes through public.moderate().
 *
 * For an erasure, `targetId` is the id of the *request* rather than of the person. That is
 * not an abstraction leak to tidy away: it is what makes an admin unable to erase somebody
 * who has not asked, and the screen should be written the way the database behaves.
 */
export async function act(
  targetType: Target,
  targetId: string,
  action: Action,
  reason: string,
): Promise<Result<null>> {
  if (import.meta.env.DEV && usingFixtures()) return { ok: true, value: null };

  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { error } = await supabase.rpc('moderate', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_action: action,
      p_reason: reason.trim() || null,
    });

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

// ── Turning a failure into a sentence ─────────────────────────────────────────────────

/**
 * public.moderate() raises finished sentences on purpose — "This is your own submission, and
 * it goes through the same review as anyone else's" is written for the person who will read
 * it, not for a log. So prose is passed through and only the codes Postgres raises on its
 * own behalf are translated.
 */
function describe(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';

  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown })?.message ?? error ?? '');
  const lower = message.toLowerCase();

  if (looksLikeProse(message)) return message;

  switch (code) {
    case '42501':
      return 'That is not an action this account may take.';

    case '23503':
      return 'That row is no longer there. Reload the queue.';

    case '23514':
      return 'That action does not apply in this state. Reload the queue.';

    case 'PGRST202':
      return 'Moderation is not available on this deployment: the database has no moderate() function.';

    case 'PGRST301':
      return 'This session has ended. Sign in again.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return UNAVAILABLE;
  }

  return 'That did not go through, and nothing was changed.';
}

function looksLikeProse(message: string): boolean {
  return /^[A-Z].*[.!?]$/.test(message.trim()) && !message.includes('_');
}

// ── Fixtures, for development only ────────────────────────────────────────────────────
//
// `?fixtures` fills the queues with invented rows and skips the role check, so the screen
// can be worked on — and screenshotted — without a moderator account and without seeding the
// production database with rubbish. Every entry point is guarded by `import.meta.env.DEV`,
// which Vite replaces with the literal `false` in a production build, so the branches and
// everything they reference are removed by dead-code elimination. Nothing below reaches the
// deployed site; grep the built bundle for "Kolmogorov" if you want to check, and it is
// worth checking rather than believing.
//
// This is not a way around the gate. The gate that matters is row level security, which no
// browser can talk its way past: with fixtures on, the page renders invented rows and every
// action is a no-op.

function usingFixtures(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('fixtures')
  );
}

export function fixturesActive(): boolean {
  return import.meta.env.DEV && usingFixtures();
}

const HANNA: QueueAuthor = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Hanna Lindqvist',
  isPseudonym: false,
  institution: { name: 'Uppsala universitet', country: 'SE' },
};

const CATEGORY_OF_ONE: QueueAuthor = {
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'category_of_one',
  isPseudonym: true,
  institution: null,
};

const TOMAS: QueueAuthor = {
  id: '00000000-0000-4000-8000-000000000003',
  displayName: 'Tomáš Brázda',
  isPseudonym: false,
  institution: { name: 'Univerzita Karlova', country: 'CZ' },
};

const NOOR: QueueAuthor = {
  id: '00000000-0000-4000-8000-000000000004',
  displayName: 'Noor Haddad',
  isPseudonym: false,
  institution: { name: 'Weizmann Institute of Science', country: 'IL' },
};

const FIXTURES: Queues = {
  reports: [
    {
      id: '00000000-0000-4000-9000-000000000001',
      status: 'pending',
      title: 'Check a lemma on sumsets with a proof assistant',
      area: 'research',
      taskType: 'proof_checking',
      aim: 'I had a lemma about doubling constants that I believed but could not prove cleanly, and wanted to know whether it was true before spending a week on it.',
      method:
        '1. Stated the lemma in Lean 4 with Mathlib.\n2. Asked the model for a proof sketch, twice, from a clean context each time.\n3. Both sketches used induction on the size of the sumset.\n4. Translated the first into tactics; three of five goals closed.\n5. Did the remaining two by hand, which took an afternoon.',
      outcome: 'partial',
      outcomeNotes:
        'The induction was the right idea and the base case was for the wrong statement — it had silently strengthened the hypothesis to a set of positive density. Two goals closed directly. The other three needed the hypothesis I actually had.',
      verification:
        'Lean accepted the final proof, so the formal statement is verified. I checked separately that the formal statement says what I meant, by rederiving the informal version by hand from the Lean one.',
      transcriptExcerpt:
        '> Prove: if |A + A| ≤ K|A| then A is covered by K^C translates of a set of size ≤ |A|.\n\nBy induction on |A|. Assume A has positive density in its ambient group…\n\n> A has no ambient group here. A is a finite subset of the integers.\n\nYou are right. Let me restate without that assumption…',
      transcriptUrl: null,
      caveats:
        'I would state all the hypotheses in full before asking. Most of the wasted time came from it filling in an assumption I had left implicit, and then being confident about it.',
      thirdPartyMaterialConfirmed: true,
      timeSpentMinutes: 260,
      wasPublished: false,
      wasDisclosed: null,
      authorConfidence: 8,
      createdAt: '2026-08-11T09:14:00Z',
      author: HANNA,
      tools: [
        { name: 'Lean', version: '4.9.0', usedOn: '2026-08-09' },
        { name: 'Claude', version: 'Opus 4.1', usedOn: '2026-08-09' },
      ],
      tags: ['math.NT', 'math.CO'],
      note: null,
      noteAt: null,
    },
    {
      id: '00000000-0000-4000-9000-000000000002',
      status: 'pending',
      title: 'Ask for a literature search on a Diophantine equation',
      area: 'research',
      taskType: 'literature_search',
      aim: 'Find out whether the specific family of equations I had reduced my problem to was already in the literature.',
      method:
        '1. Described the family precisely.\n2. Asked for references, with the instruction that it should say so if it did not know.\n3. Received six references.\n4. Looked up all six.',
      outcome: 'failed',
      outcomeNotes:
        'Two of the six do not exist. One is a real paper by a real author with an invented title. The remaining three exist and are about something else. The invented reference is the dangerous one — it is plausible, the author works in the area, and I nearly cited it.',
      verification:
        'Checked every reference against MathSciNet and arXiv by hand. Emailed one author to ask whether the attributed result was theirs; it was not.',
      transcriptExcerpt: null,
      transcriptUrl: null,
      caveats:
        'A failure worth recording rather than a complaint. I would not use a model for this again without a retrieval tool attached, and I would still check every line.',
      thirdPartyMaterialConfirmed: true,
      timeSpentMinutes: 95,
      wasPublished: null,
      wasDisclosed: null,
      authorConfidence: 9,
      createdAt: '2026-08-12T16:02:00Z',
      author: CATEGORY_OF_ONE,
      tools: [{ name: 'GPT-5', version: '2026-06', usedOn: '2026-08-12' }],
      tags: ['math.NT'],
      note: 'The verification section describes what the model told you rather than what you checked. Say what you did with MathSciNet, and it can go in.',
      noteAt: '2026-08-13T11:20:00Z',
    },
    {
      id: '00000000-0000-4000-9000-000000000003',
      status: 'pending',
      title: 'Translate a 1962 paper from Russian for a seminar',
      area: 'learning',
      taskType: 'translation',
      aim: 'Read a paper of Gelfond that has never been translated, well enough to present it.',
      method:
        '1. Scanned the paper and ran it through OCR.\n2. Translated section by section, keeping the original beside it.\n3. Checked every formula against the scan by eye, since OCR loses subscripts.',
      outcome: 'worked',
      outcomeNotes:
        'The mathematics came through intact. Two proper names were mangled and one Cyrillic subscript became a Latin one, which changed the meaning of a displayed formula until I caught it.',
      verification:
        'Rederived the two main lemmas from the translation without looking at the original, then compared. A colleague who reads Russian checked the introduction and the statement of the theorem.',
      transcriptExcerpt: null,
      transcriptUrl: null,
      caveats: 'Do not trust it on subscripts. Everything else was better than I expected.',
      thirdPartyMaterialConfirmed: true,
      timeSpentMinutes: 420,
      wasPublished: null,
      wasDisclosed: null,
      authorConfidence: 7,
      createdAt: '2026-08-14T08:41:00Z',
      author: TOMAS,
      tools: [{ name: 'Gemini', version: '3.0 Pro', usedOn: '2026-08-13' }],
      tags: ['math.NT', 'math.HO'],
      note: null,
      noteAt: null,
    },
  ],

  debates: [
    {
      id: '00000000-0000-4000-a000-000000000001',
      status: 'proposed',
      statement: 'A model-generated reference must be checked against a database before it is cited.',
      rationale:
        'Fabricated references are the failure mode this community will meet first and most often, and the check takes a minute.',
      area: 'writing',
      createdAt: '2026-08-13T19:30:00Z',
      author: CATEGORY_OF_ONE,
      ratingCount: 4,
    },
    {
      id: '00000000-0000-4000-a000-000000000002',
      status: 'proposed',
      statement: 'Referees should be told which parts of a paper were drafted with a model.',
      rationale: null,
      area: 'writing',
      createdAt: '2026-08-15T07:05:00Z',
      author: NOOR,
      ratingCount: 1,
    },
  ],

  flags: [
    {
      id: '00000000-0000-4000-b000-000000000001',
      subjectType: 'comment',
      subjectId: '00000000-0000-4000-c000-000000000001',
      reason: 'third_party_material',
      detail:
        'This quotes a referee report I wrote. It was not published and I did not agree to it being posted.',
      createdAt: '2026-08-15T06:12:00Z',
      flagger: NOOR,
      subject: {
        kind: 'comment',
        heading: 'Comment',
        body: 'The report on that paper said the argument in §3 “collapses under any uniformity assumption”, which is exactly what happened here.',
        status: 'published',
        author: CATEGORY_OF_ONE,
      },
    },
    {
      id: '00000000-0000-4000-b000-000000000002',
      subjectType: 'report',
      subjectId: '00000000-0000-4000-9000-000000000009',
      reason: 'inaccurate',
      detail: 'Version 4.9.0 of Lean cannot do what this describes. I think the version is wrong.',
      createdAt: '2026-08-15T10:48:00Z',
      flagger: TOMAS,
      subject: {
        kind: 'report',
        heading: 'Close a goal in Lean with a tactic suggestion',
        body: 'Get a stuck goal closed without reading the whole of Mathlib.',
        status: 'published',
        author: HANNA,
      },
    },
  ],

  entries: [
    {
      id: '00000000-0000-4000-e000-000000000001',
      status: 'pending' as const,
      title: 'Lean4 by Example',
      url: 'https://leanprover-community.github.io/lean4-samples/',
      category: 'formalisation',
      description: 'A community-maintained collection of annotated Lean 4 examples.',
      relevance:
        'Fills a practical gap: the reference manual explains what Lean 4 can do; this shows how to do it step by step, in mathematics.',
      createdAt: '2026-08-15T14:32:00Z',
      author: HANNA,
      note: null,
      noteAt: null,
    },
  ],

  hiddenReports: [],

  hiddenDebates: [],

  hiddenComments: [
    {
      id: '00000000-0000-4000-c000-000000000002',
      body: 'Anyone who trusts a chatbot with a proof is not a serious mathematician, and the people posting here know it.',
      createdAt: '2026-08-10T21:07:00Z',
      status: 'hidden',
      // Hiding keeps the name. Only deleting strips it, and a deleted comment keeps no text
      // to show here either — which is why a moderator handling a flag about one is told
      // to hide rather than wait.
      author: {
        id: '00000000-0000-4000-8000-000000000006',
        displayName: 'Wolfgang Amsel',
        isPseudonym: false,
        institution: { name: 'Universität Bonn', country: 'DE' },
      },
      parentType: 'report',
      parentId: '00000000-0000-4000-9000-000000000001',
    },
  ],

  hiddenEntries: [],

  erasures: [
    {
      id: '00000000-0000-4000-d000-000000000001',
      requestedAt: '2026-08-14T13:26:00Z',
      note: 'Please detach my reports rather than removing them — I would rather they stayed in the corpus without my name.',
      member: {
        id: '00000000-0000-4000-8000-000000000005',
        displayName: 'Kolmogorov Complexity Enjoyer',
        isPseudonym: true,
        institution: null,
      },
      reportCount: 3,
      commentCount: 11,
    },
  ],
};
