/**
 * Everything the site knows about practices: reading the corpus at build time, and the two
 * things a browser does to it.
 *
 * The swap point
 * --------------
 * `readCorpus()` below is the only function that knows where the corpus comes from, and it
 * is the only one a later change touches. Today it prefers a committed JSON export and
 * falls back to querying Supabase over PostgREST; when the nightly export job exists, the
 * fallback goes and the JSON is the whole story. No page imports anything but the named
 * functions under it, so that change is one file.
 *
 * Reads happen at build time, not in the browser. That is the read/write split in CLAUDE.md
 * doing its job: a traffic spike never touches the egress quota, and the site keeps serving
 * if the database is paused — which on the free tier it will be, after about a week of
 * quiet. It also means every practice is a real page with a real URL, which matters for a
 * corpus meant to be cited.
 *
 * Writes stay in the browser, because they are the only thing that genuinely cannot be
 * static: submitting a practice, and reporting whether one still works.
 */
import { getSupabase } from './supabase';
import type { Area, TaskType } from './practice-schema';
import type { Outcome, TombstoneStatus } from './status';

// ── What a page gets ──────────────────────────────────────────────────────────────────

export interface CorpusAuthor {
  readonly id: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
  readonly institution: {
    readonly name: string;
    readonly country: string;
    readonly verifiedAt: string;
  } | null;
}

export interface CorpusTool {
  readonly name: string;
  readonly version: string;
  readonly usedOn: string;
}

export interface CorpusTag {
  readonly code: string;
  readonly label: string;
}

/** The derived tombstone, computed in SQL by public.practice_staleness. Never recomputed
 *  here: the same answer has to appear in a listing, on a page, and in the export. */
export interface Staleness {
  readonly latestToolUse: string | null;
  readonly latestVerdict: 'still_works' | 'no_longer_works' | null;
  readonly latestConfirmationAt: string | null;
  readonly confirmationCount: number;
  readonly tombstoneStatus: TombstoneStatus;
  readonly isVerified: boolean;
}

export interface Practice {
  readonly id: string;
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
  readonly timeSpentMinutes: number | null;
  readonly wasPublished: boolean | null;
  readonly wasDisclosed: boolean | null;
  readonly authorConfidence: number | null;
  readonly createdAt: string;
  /** Null when the account was erased. The contribution stays; the name goes. */
  readonly author: CorpusAuthor | null;
  readonly tools: readonly CorpusTool[];
  readonly tags: readonly CorpusTag[];
  readonly staleness: Staleness;
}

// ── The swap point ────────────────────────────────────────────────────────────────────

/**
 * A committed export, if there is one.
 *
 * `import.meta.glob` rather than `node:fs` on purpose: it resolves at build time, returns
 * an empty object when the file is absent instead of throwing, and involves no Node
 * builtins — so this module stays importable from a browser script, which is what lets the
 * write functions at the bottom live in the same file as the read functions.
 */
const EXPORTED = import.meta.glob<{ default: Practice[] }>('/data/practices.json', {
  eager: true,
});

let cached: Practice[] | null = null;

async function readCorpus(): Promise<Practice[]> {
  if (cached) return cached;

  const exported = Object.values(EXPORTED)[0]?.default;
  if (exported) {
    cached = exported;
    return cached;
  }

  cached = await queryCorpus();
  return cached;
}

/**
 * The fallback: PostgREST, with the publishable key, at build time.
 *
 * Plain fetch rather than supabase-js, because this runs in Node during the build and the
 * client library brings a session, a storage adapter and a realtime socket that a build has
 * no use for.
 *
 * A failure returns an empty corpus rather than throwing. A paused project must produce a
 * site with no practices on it, not a red build — the free tier pauses after about a week
 * of inactivity, and the whole point of building the corpus into static files is that the
 * database being down is not a reader's problem.
 */
async function queryCorpus(): Promise<Practice[]> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  // `author:profiles!practices_author_id_fkey` names the constraint explicitly. There are
  // two foreign keys from practices to profiles — author_id and deleted_by — and without
  // the constraint name PostgREST cannot tell which embed is meant and refuses the request.
  const select = [
    'id,title,area,task_type,aim,method,outcome,outcome_notes,verification',
    'transcript_excerpt,transcript_url,caveats,time_spent_minutes,was_published',
    'was_disclosed,author_confidence,created_at',
    'author:profiles!practices_author_id_fkey(id,display_name,is_pseudonym,institution_name,institution_country,institution_verified_at)',
    'practice_tools(tool_name,tool_version,used_on)',
    'practice_tags(tags(code,label))',
  ].join(',');

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    const [rows, staleness] = await Promise.all([
      fetch(
        `${url}/rest/v1/practices?select=${encodeURIComponent(select)}` +
          '&status=eq.published&deleted_at=is.null&order=created_at.desc',
        { headers },
      ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch(`${url}/rest/v1/practice_staleness?select=*`, { headers }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
    ]);

    // Joined here rather than embedded. PostgREST can only embed a view when it can infer
    // the relationship, which for a view over several tables it frequently cannot, and a
    // build that fails on a schema-cache detail is worse than one extra request.
    const byId = new Map<string, RawStaleness>(
      (staleness as RawStaleness[]).map((row) => [row.practice_id, row]),
    );

    return (rows as RawPractice[]).map((row) => toPractice(row, byId.get(row.id)));
  } catch {
    return [];
  }
}

// ── Shapes as PostgREST returns them ──────────────────────────────────────────────────

interface RawStaleness {
  practice_id: string;
  latest_tool_use: string | null;
  latest_verdict: 'still_works' | 'no_longer_works' | null;
  latest_confirmation_at: string | null;
  confirmation_count: number;
  tombstone_status: TombstoneStatus;
  is_verified: boolean;
}

interface RawPractice {
  id: string;
  title: string;
  area: Area;
  task_type: TaskType;
  aim: string;
  method: string;
  outcome: Outcome;
  outcome_notes: string;
  verification: string;
  transcript_excerpt: string | null;
  transcript_url: string | null;
  caveats: string | null;
  time_spent_minutes: number | null;
  was_published: boolean | null;
  was_disclosed: boolean | null;
  author_confidence: number | null;
  created_at: string;
  author: {
    id: string;
    display_name: string;
    is_pseudonym: boolean;
    institution_name: string | null;
    institution_country: string | null;
    institution_verified_at: string | null;
  } | null;
  practice_tools: { tool_name: string; tool_version: string; used_on: string }[];
  practice_tags: { tags: { code: string; label: string } | null }[];
}

function toPractice(row: RawPractice, staleness: RawStaleness | undefined): Practice {
  return {
    id: row.id,
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
    timeSpentMinutes: row.time_spent_minutes,
    wasPublished: row.was_published,
    wasDisclosed: row.was_disclosed,
    authorConfidence: row.author_confidence,
    createdAt: row.created_at,
    author: row.author
      ? {
          id: row.author.id,
          displayName: row.author.display_name,
          isPseudonym: row.author.is_pseudonym,
          institution:
            row.author.institution_name &&
            row.author.institution_country &&
            row.author.institution_verified_at
              ? {
                  name: row.author.institution_name,
                  country: row.author.institution_country,
                  verifiedAt: row.author.institution_verified_at,
                }
              : null,
        }
      : null,
    tools: row.practice_tools.map((tool) => ({
      name: tool.tool_name,
      version: tool.tool_version,
      usedOn: tool.used_on,
    })),
    tags: row.practice_tags.flatMap((link) => (link.tags ? [link.tags] : [])),
    // A practice with no staleness row cannot happen — the view produces one per practice —
    // but a corpus read from a hand-edited export could be missing one, and an unverified
    // open square is the honest default for "we do not know".
    staleness: {
      latestToolUse: staleness?.latest_tool_use ?? null,
      latestVerdict: staleness?.latest_verdict ?? null,
      latestConfirmationAt: staleness?.latest_confirmation_at ?? null,
      confirmationCount: staleness?.confirmation_count ?? 0,
      tombstoneStatus: staleness?.tombstone_status ?? 'unverified',
      isVerified: staleness?.is_verified ?? false,
    },
  };
}

// ── What pages call ───────────────────────────────────────────────────────────────────

/** Every published practice, newest first. */
export async function listPractices(): Promise<Practice[]> {
  return readCorpus();
}

export async function getPractice(id: string): Promise<Practice | undefined> {
  return (await readCorpus()).find((practice) => practice.id === id);
}

export async function practicesByAuthor(authorId: string): Promise<Practice[]> {
  return (await readCorpus()).filter((practice) => practice.author?.id === authorId);
}

/** Everyone with at least one published practice. Erased accounts are absent by
 *  construction: their contributions have no author to page. */
export async function listAuthors(): Promise<CorpusAuthor[]> {
  const authors = new Map<string, CorpusAuthor>();

  for (const practice of await readCorpus()) {
    if (practice.author) authors.set(practice.author.id, practice.author);
  }

  return [...authors.values()];
}

/** The distinct tool names in the corpus, for the listing filter. Case-folded so that
 *  "Lean" and "lean" are one filter rather than two. */
export async function listToolNames(): Promise<string[]> {
  const names = new Map<string, string>();

  for (const practice of await readCorpus()) {
    for (const tool of practice.tools) {
      const key = tool.name.trim().toLowerCase();
      if (key && !names.has(key)) names.set(key, tool.name.trim());
    }
  }

  return [...names.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

export async function listUsedTags(): Promise<CorpusTag[]> {
  const tags = new Map<string, CorpusTag>();

  for (const practice of await readCorpus()) {
    for (const tag of practice.tags) tags.set(tag.code, tag);
  }

  return [...tags.values()].sort((a, b) => a.code.localeCompare(b.code, 'en'));
}

// ══ Writes ════════════════════════════════════════════════════════════════════════════
// Everything below runs in a browser and always will. Submitting a practice and reporting
// whether one still works are the two things that genuinely cannot be static, and they are
// the only reasons a reader's browser ever opens a connection to the database.

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'The database cannot be reached right now. Your draft is saved in this browser — try again in a few minutes and nothing will be lost.';

export interface Tag {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly scheme: string;
}

export interface SubmissionTool {
  name: string;
  version: string;
  usedOn: string;
}

export interface Submission {
  title: string;
  area: Area;
  taskType: TaskType;
  tools: readonly SubmissionTool[];
  aim: string;
  method: string;
  outcome: Outcome;
  outcomeNotes: string;
  verification: string;
  transcriptExcerpt: string;
  transcriptUrl: string;
  caveats: string;
  thirdPartyMaterialConfirmed: boolean;
  timeSpentMinutes: number | null;
  wasPublished: boolean | null;
  wasDisclosed: boolean | null;
  authorConfidence: number | null;
  tagCodes: readonly string[];
}

/**
 * The tag vocabulary, read from the database rather than duplicated here. It is seeded by a
 * migration and curated — no browser role can write to it — so the table is the one source
 * of truth, and a TypeScript copy would drift the first time a tag is retired.
 */
export async function loadTags(): Promise<Result<Tag[]>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('tags')
      .select('id, code, label, scheme')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: (data ?? []) as Tag[] };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/**
 * Returns the new practice's id.
 *
 * One RPC rather than three inserts, because the at-least-one-tool constraint is deferred
 * and PostgREST gives every request its own transaction. See the migration that creates
 * public.submit_practice.
 */
export async function submitPractice(submission: Submission): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase.rpc('submit_practice', {
      p_title: submission.title.trim(),
      p_area: submission.area,
      p_task_type: submission.taskType,
      p_tools: submission.tools.map((tool) => ({
        name: tool.name.trim(),
        version: tool.version.trim(),
        used_on: tool.usedOn,
      })),
      p_aim: submission.aim.trim(),
      p_method: submission.method.trim(),
      p_outcome: submission.outcome,
      p_outcome_notes: submission.outcomeNotes.trim(),
      p_verification: submission.verification.trim(),
      p_third_party_material_confirmed: submission.thirdPartyMaterialConfirmed,
      p_transcript_excerpt: submission.transcriptExcerpt.trim() || null,
      p_transcript_url: submission.transcriptUrl.trim() || null,
      p_caveats: submission.caveats.trim() || null,
      p_time_spent_minutes: submission.timeSpentMinutes,
      p_was_published: submission.wasPublished,
      p_was_disclosed: submission.wasDisclosed,
      p_author_confidence: submission.authorConfidence,
      p_tag_codes: submission.tagCodes,
    });

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: String(data) };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

// ── Still works / no longer works ─────────────────────────────────────────────────────

export type Verdict = 'still_works' | 'no_longer_works';

export interface Confirmation {
  readonly id: string;
  readonly userId: string;
  readonly verdict: Verdict;
  readonly note: string;
  readonly createdAt: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
}

export interface ConfirmationState {
  readonly all: readonly Confirmation[];
  /** The signed-in reader's own, if they have one. Null when signed out. */
  readonly mine: Confirmation | null;
}

/**
 * The live tally, read from the browser rather than taken from the build.
 *
 * The static page already carries a count, and this replaces it a moment later with one
 * that includes anything filed since the last build. A tally is exactly the kind of number
 * a reader will act on — "three people say this no longer works" changes whether they spend
 * an afternoon on it — so a day-stale one is worth one small query to correct.
 */
export async function loadConfirmations(
  practiceId: string,
  viewerId: string | null,
): Promise<Result<ConfirmationState>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('practice_confirmations')
      .select(
        'id, user_id, verdict, note, created_at, profiles!practice_confirmations_user_id_fkey(display_name, is_pseudonym)',
      )
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false });

    if (error) return { ok: false, message: describe(error) };

    const all: Confirmation[] = (data ?? []).map((row) => {
      const person = row.profiles as unknown as
        | { display_name: string; is_pseudonym: boolean }
        | null;

      return {
        id: row.id as string,
        userId: row.user_id as string,
        verdict: row.verdict as Verdict,
        note: (row.note as string | null) ?? '',
        createdAt: row.created_at as string,
        // An erased account leaves its confirmations behind only in principle: the row
        // cascades with the account. A null here is a race, not a state.
        displayName: person?.display_name ?? 'A former member',
        isPseudonym: person?.is_pseudonym ?? false,
      };
    });

    return {
      ok: true,
      value: { all, mine: all.find((one) => one.userId === viewerId) ?? null },
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** One row per person per practice, so this is an upsert on that pair. Changing your mind
 *  edits the row rather than adding a second one. */
export async function saveConfirmation(
  practiceId: string,
  userId: string,
  verdict: Verdict,
  note: string,
): Promise<Result<null>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { error } = await supabase
      .from('practice_confirmations')
      .upsert(
        {
          practice_id: practiceId,
          user_id: userId,
          verdict,
          note: note.trim() || null,
        },
        { onConflict: 'practice_id,user_id' },
      );

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Withdrawing is a delete, so that "I no longer have a view" is representable. Without it
 *  the only way out of a verdict would be to hold a different one. */
export async function withdrawConfirmation(
  practiceId: string,
  userId: string,
): Promise<Result<null>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { error } = await supabase
      .from('practice_confirmations')
      .delete()
      .eq('practice_id', practiceId)
      .eq('user_id', userId);

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

// ── Turning a failure into a sentence ─────────────────────────────────────────────────

/**
 * A write that fails from the browser gives you a SQLSTATE and a message written for
 * whoever wrote the constraint. Neither belongs in front of somebody who has just spent ten
 * minutes on a submission, so each is mapped to what they should do about it.
 *
 * **When a write fails unexpectedly, check the grants before the policies.** A table with
 * no grant and a table whose policy returns nothing are indistinguishable from here: both
 * are 42501, or both are an empty result. Grants decide whether the endpoint exists;
 * policies decide which rows it returns. Both are needed, and the one people forget is the
 * grant, because the policy is the part that felt like the security work.
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

  switch (code) {
    case '23514':
      // Several of our own constraints raise finished sentences — the at-least-one tool
      // rule, the future-dated tool, the daily limit — so the message is passed through
      // when it reads like prose and replaced when it reads like a constraint name.
      return looksLikeProse(message)
        ? message
        : 'One of the fields is outside the limits the form shows. Check the counters and the dates, then try again.';

    case '23505':
      return 'That looks like a duplicate of something already submitted. If you meant to send it twice, it is already there.';

    case '42501':
      return 'This account is not allowed to do that. It usually means the email address has not been confirmed yet — check the confirmation email.';

    case '53400':
      return looksLikeProse(message)
        ? message
        : 'You have reached what one account can post in a day. This exists so nobody can bury a volunteer moderation queue; try again tomorrow.';

    case '22P02':
      return 'One of the choices was not one of the offered values. Reload the page and try again.';

    case 'PGRST301':
      return 'Your session has ended. Sign in again — your draft is saved in this browser.';

    case 'PGRST202':
      return 'Submitting is not available on this deployment yet. Your draft is saved in this browser.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return UNAVAILABLE;
  }

  return 'That did not go through, and nothing was saved to the site. If it keeps failing, the details are worth reporting.';
}

/** Whether a database message was written for a person. The functions in
 *  supabase/migrations/ raise finished sentences on purpose; Postgres itself does not. */
function looksLikeProse(message: string): boolean {
  return /^[A-Z].*[.!?]$/.test(message.trim()) && !message.includes('_');
}
