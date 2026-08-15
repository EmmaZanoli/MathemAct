/**
 * Reading and writing practices. The submission form calls nothing else.
 *
 * Why submission is an RPC and not three inserts
 * ---------------------------------------------
 * A practice must record at least one tool, enforced by a DEFERRABLE INITIALLY DEFERRED
 * constraint trigger. Deferred means at the end of the transaction, and PostgREST gives
 * every request its own — so inserting the practice and then its tools fails on the first
 * request, at commit, before the tools exist. No ordering fixes it: the tools reference an
 * id that does not exist until the practice is inserted.
 *
 * `public.submit_practice` is that transaction. It is SECURITY INVOKER, so every policy on
 * the underlying tables still applies and the author is `auth.uid()` rather than anything
 * this file could send.
 */
import { getSupabase } from './supabase';
import type { Area, TaskType } from './practice-schema';
import type { Outcome } from './status';

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

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'The database cannot be reached right now. Your draft is saved in this browser — try again in a few minutes and nothing will be lost.';

/**
 * The tag vocabulary, read from the database rather than duplicated here.
 *
 * It is seeded by a migration and curated; there is no INSERT grant on it for any browser
 * role. Fetching it means one source of truth rather than a TypeScript copy that drifts
 * the first time a tag is retired.
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

/** Returns the new practice's id. */
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

  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error ?? '');
  const lower = message.toLowerCase();

  switch (code) {
    case '23514':
      // A CHECK constraint. Several of these raise their own sentence — the at-least-one
      // tool rule and the future-dated tool among them — so the message is passed through
      // when it reads like prose and replaced when it reads like a constraint name.
      return looksLikeProse(message)
        ? message
        : 'One of the fields is outside the limits the form shows. Check the counters and the dates, then try again.';

    case '23505':
      return 'That looks like a duplicate of something already submitted. If you meant to send it twice, it is already there.';

    case '42501':
      // Row level security, or a missing grant, and they are indistinguishable from here.
      return 'This account is not allowed to post. That usually means the email address has not been confirmed yet — check the confirmation email.';

    case '53400':
      return looksLikeProse(message)
        ? message
        : 'You have reached the number of practices one account can post in a day. This exists so nobody can bury a volunteer moderation queue; try again tomorrow.';

    case '22P02':
      return 'One of the choices was not one of the offered values. Reload the page and try again.';

    case 'PGRST301':
      return 'Your session has ended. Sign in again — your draft is saved in this browser.';

    case 'PGRST202':
      // The function is missing from the schema cache, which in practice means the
      // migration has not been applied to this project yet.
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

  return 'That did not go through, and nothing was saved to the site. Your draft is still in this browser. If it keeps failing, the details are worth reporting.';
}

/** Whether a database message was written for a person. The functions in
 *  supabase/migrations/ raise finished sentences on purpose; Postgres itself does not. */
function looksLikeProse(message: string): boolean {
  return /^[A-Z].*[.!?]$/.test(message.trim()) && !message.includes('_');
}
