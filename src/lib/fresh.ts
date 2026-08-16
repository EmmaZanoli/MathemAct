/**
 * The freshness overlay: what has been posted since the site was last built.
 *
 * The corpus is served as static files exported nightly, which means a practice posted this
 * morning is invisible until tomorrow. For most of this site that is the right trade — it is
 * what keeps a free tier viable — but for somebody who has just posted, and for anybody
 * arriving from a link they were sent, a day-long silence looks like the submission was
 * lost. So each listing hydrates from the static page and then asks one question: is there
 * anything newer than the export?
 *
 * Four rules, and each is the difference between an overlay and a liability.
 *
 * **Plain fetch, never the Supabase client.** A listing is a reading page. Importing
 * src/lib/supabase.ts would pull the auth client, its storage adapter and its session
 * machinery into a page whose job is to be read, and CLAUDE.md forbids exactly that. This is
 * one GET against PostgREST with the publishable key, which is public by design.
 *
 * **Capped.** At most two dozen rows, and never a second page. This is a nudge toward the
 * newest handful, not a substitute for the export: if a hundred practices arrive in a day,
 * the answer is the nightly build, not a listing that quietly turns into a live query.
 *
 * **Time-limited.** A few seconds, then abandoned. The static content is already on screen
 * and correct; a request that hangs must not delay anything or hold a connection open.
 *
 * **Silent on failure.** Every path returns an empty array. A paused project, a network
 * failure, an over-quota database, a deployment with no keys configured: all of them mean
 * the reader sees the corpus as it stood at the last build, which is the whole point of
 * building it into files. There is no error state here and there should not be one — an
 * error message about a database on a page that is already showing its content would teach
 * readers that this site depends on something it does not.
 */

/** At most this many rows, ever. See the header. */
const LIMIT = 24;

/** Abandoned after this. Long enough for a slow connection, short enough that nobody waits. */
const TIMEOUT_MS = 4000;

const URL_BASE = import.meta.env.PUBLIC_SUPABASE_URL;
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export interface FreshPractice {
  readonly id: string;
  readonly title: string;
  readonly aim: string;
  readonly area: string;
  readonly taskType: string;
  readonly outcome: 'worked' | 'partial' | 'failed';
  readonly createdAt: string;
  readonly authorName: string | null;
  readonly tools: readonly { name: string; version: string }[];
  readonly tags: readonly string[];
}

export interface FreshProposition {
  readonly id: string;
  readonly statement: string;
  readonly area: string;
  readonly createdAt: string;
}

/**
 * One request, or none.
 *
 * `AbortController` with a timer rather than `AbortSignal.timeout`, which several browsers
 * this audience still uses do not have. A silent overlay that throws a ReferenceError in
 * Safari 15 is not silent — it takes the rest of the page's script with it.
 */
async function ask<T>(query: string): Promise<T[]> {
  if (!URL_BASE || !KEY) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${URL_BASE}/rest/v1/${query}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      signal: controller.signal,
    });

    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Published practices created after `since`.
 *
 * The filters restate what row level security already enforces for the anonymous key. That
 * is not redundancy for its own sake: this is the one query in the project whose result is
 * prepended to a page as though it came from the corpus, and the day somebody widens a
 * policy is the day it would start showing pending submissions to everybody.
 */
export async function practicesSince(since: string): Promise<FreshPractice[]> {
  const select = [
    'id,title,aim,area,task_type,outcome,created_at',
    'author:profiles!practices_author_id_fkey(display_name,is_pseudonym)',
    'practice_tools(tool_name,tool_version)',
    'practice_tags(tags(code))',
  ].join(',');

  const rows = await ask<RawFreshPractice>(
    `practices?select=${encodeURIComponent(select)}` +
      `&status=eq.published&deleted_at=is.null&created_at=gt.${encodeURIComponent(since)}` +
      `&order=created_at.desc&limit=${LIMIT}`,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    aim: row.aim,
    area: row.area,
    taskType: row.task_type,
    outcome: row.outcome,
    createdAt: row.created_at,
    // The name only. A fresh card carries no institutional badge, because a badge is an
    // attestation with a date on it and the date is not in this query.
    authorName: row.author?.display_name ?? null,
    tools: (row.practice_tools ?? []).map((tool) => ({
      name: tool.tool_name,
      version: tool.tool_version,
    })),
    tags: (row.practice_tags ?? []).flatMap((link) => (link.tags ? [link.tags.code] : [])),
  }));
}

/** Propositions created after `since`. Anything this new is `proposed`: nothing is born
 *  active, and the threshold that promotes one takes five people. */
export async function propositionsSince(since: string): Promise<FreshProposition[]> {
  const rows = await ask<RawFreshProposition>(
    'propositions?select=id,statement,area,created_at' +
      `&status=eq.proposed&created_at=gt.${encodeURIComponent(since)}` +
      `&order=created_at.desc&limit=${LIMIT}`,
  );

  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    area: row.area,
    createdAt: row.created_at,
  }));
}

interface RawFreshPractice {
  id: string;
  title: string;
  aim: string;
  area: string;
  task_type: string;
  outcome: 'worked' | 'partial' | 'failed';
  created_at: string;
  author: { display_name: string; is_pseudonym: boolean } | null;
  practice_tools: { tool_name: string; tool_version: string }[];
  practice_tags: { tags: { code: string } | null }[];
}

interface RawFreshProposition {
  id: string;
  statement: string;
  area: string;
  created_at: string;
}
