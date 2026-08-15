/**
 * Propositions and the agreement scale.
 *
 * Same shape as src/lib/practices.ts: `readPropositions()` is the single swap point, reads
 * happen at build time, and writes happen in a browser. Two things are different, and both
 * come from the rules in CLAUDE.md rather than from anything technical.
 *
 * **The aggregate is never built into a page.** A reader is not shown the distribution until
 * they have answered, to limit bandwagon effects — this community's minority position is
 * frequently the correct one. Baking the histogram into the HTML would make that a
 * decoration that view-source defeats, so the aggregate is fetched after a rating exists.
 *
 * Be honest about what that is: it limits bandwagoning, it does not prevent access. The
 * aggregate endpoint is public by design and anyone determined can query it. What it
 * prevents is the ordinary reader seeing a distribution before they have thought about the
 * question, which is where the effect actually comes from.
 *
 * **Nothing here computes a mean.** Not from the histogram, not from the counts, not
 * anywhere. The mean of an 11-point bipolar scale is misleading exactly when the
 * distribution is bimodal, and bimodal is what to expect on the contested propositions.
 */
import { getSupabase } from './supabase';
import type { Area } from './practice-schema';

// ── The scale ─────────────────────────────────────────────────────────────────────────

export const SCALE_MIN = 0;
export const SCALE_MAX = 10;

/** Every point on the scale, in order. */
export const SCALE_POINTS = Array.from(
  { length: SCALE_MAX - SCALE_MIN + 1 },
  (_, i) => SCALE_MIN + i,
);

/**
 * The three permanent labels.
 *
 * They are always shown, never on hover. An unlabelled 0 to 10 reads as intensity rather
 * than as a position, and people interpret 0 as "no opinion" — which is a different answer
 * that this scale records separately and must not be confused with total disagreement.
 */
export const SCALE_ANCHORS: Record<number, string> = {
  0: 'strongly disagree',
  5: 'neutral',
  10: 'strongly agree',
};

/** The wording for declining, used identically on the control and in the aggregate. */
export const NO_OPINION_LABEL = 'No opinion, or outside my expertise';

// ── What a page gets ──────────────────────────────────────────────────────────────────

export interface PropositionAuthor {
  readonly id: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
}

export interface Proposition {
  readonly id: string;
  readonly statement: string;
  readonly rationale: string | null;
  readonly status: 'proposed' | 'active';
  readonly area: Area;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly author: PropositionAuthor | null;
}

/**
 * The aggregate, exactly as public.proposition_ratings reports it.
 *
 * There is no `mean` field and there must never be one. If a future consumer wants central
 * tendency, it has the median; if it wants spread, it has the whole histogram.
 */
export interface Aggregate {
  /** Eleven counts. Index i holds the number of people who chose score i. */
  readonly histogram: readonly number[];
  /** Null when nobody has expressed an opinion — everyone declined, or nobody answered. */
  readonly median: number | null;
  /** Everyone who answered, including those who declined. */
  readonly totalRaters: number;
  readonly opinionCount: number;
  readonly noOpinionCount: number;
  /** opinionCount / totalRaters, or null when nobody has answered at all. */
  readonly coverage: number | null;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'The database cannot be reached right now. Try again in a few minutes.';

// ── The swap point ────────────────────────────────────────────────────────────────────

const EXPORTED = import.meta.glob<{ default: Proposition[] }>('/data/propositions.json', {
  eager: true,
});

let cached: Proposition[] | null = null;

async function readPropositions(): Promise<Proposition[]> {
  if (cached) return cached;

  const exported = Object.values(EXPORTED)[0]?.default;
  if (exported) {
    cached = exported;
    return cached;
  }

  cached = await queryPropositions();
  return cached;
}

async function queryPropositions(): Promise<Proposition[]> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  const select = [
    'id,statement,rationale,status,area,created_at,activated_at',
    'author:profiles!propositions_author_id_fkey(id,display_name,is_pseudonym)',
  ].join(',');

  try {
    // Hidden propositions are excluded by row level security for the anonymous key, and the
    // filter is written out anyway so the intent survives a policy being loosened.
    const response = await fetch(
      `${url}/rest/v1/propositions?select=${encodeURIComponent(select)}` +
        '&status=in.(proposed,active)&order=created_at.desc',
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );

    if (!response.ok) return [];

    return (await response.json()).map(toProposition);
  } catch {
    // A paused project produces a site with no propositions, not a failed build.
    return [];
  }
}

interface RawProposition {
  id: string;
  statement: string;
  rationale: string | null;
  status: 'proposed' | 'active';
  area: Area;
  created_at: string;
  activated_at: string | null;
  author: { id: string; display_name: string; is_pseudonym: boolean } | null;
}

function toProposition(row: RawProposition): Proposition {
  return {
    id: row.id,
    statement: row.statement,
    rationale: row.rationale,
    status: row.status,
    area: row.area,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    author: row.author
      ? {
          id: row.author.id,
          displayName: row.author.display_name,
          isPseudonym: row.author.is_pseudonym,
        }
      : null,
  };
}

export async function listPropositions(): Promise<Proposition[]> {
  return readPropositions();
}

export async function getProposition(id: string): Promise<Proposition | undefined> {
  return (await readPropositions()).find((proposition) => proposition.id === id);
}

// ══ Writes and the aggregate ══════════════════════════════════════════════════════════

/**
 * The reader's own rating, if they have one.
 *
 * Returns `{ rated: false }` when they have not answered. That is a different state from a
 * rating of null, which means they answered "no opinion" — and the page treats them
 * differently: one hides the aggregate, the other shows it.
 */
export async function loadMyRating(
  propositionId: string,
  userId: string,
): Promise<Result<{ rated: boolean; score: number | null }>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('ratings')
      .select('score')
      .eq('proposition_id', propositionId)
      .eq('user_id', userId)
      .maybeSingle<{ score: number | null }>();

    if (error) return { ok: false, message: describe(error) };

    return {
      ok: true,
      value: data ? { rated: true, score: data.score } : { rated: false, score: null },
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** `score` of null is the "no opinion / outside my expertise" answer, and is stored. */
export async function saveRating(
  propositionId: string,
  userId: string,
  score: number | null,
): Promise<Result<null>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { error } = await supabase
      .from('ratings')
      .upsert(
        { proposition_id: propositionId, user_id: userId, score },
        { onConflict: 'proposition_id,user_id' },
      );

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/**
 * The distribution. Fetched rather than built into the page, so that it is not in the
 * source for somebody who has not answered yet — see the header of this file.
 */
export async function loadAggregate(propositionId: string): Promise<Result<Aggregate>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('proposition_ratings')
      .select('histogram, median, total_raters, opinion_count, no_opinion_count, coverage')
      .eq('proposition_id', propositionId)
      .maybeSingle();

    if (error) return { ok: false, message: describe(error) };
    if (!data) {
      return { ok: false, message: 'That proposition has no readable aggregate.' };
    }

    return {
      ok: true,
      value: {
        histogram: (data.histogram as number[]) ?? SCALE_POINTS.map(() => 0),
        median: data.median as number | null,
        totalRaters: (data.total_raters as number) ?? 0,
        opinionCount: (data.opinion_count as number) ?? 0,
        noOpinionCount: (data.no_opinion_count as number) ?? 0,
        coverage: data.coverage === null ? null : Number(data.coverage),
      },
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function proposeProposition(
  userId: string,
  statement: string,
  rationale: string,
  area: Area,
): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('propositions')
      .insert({
        author_id: userId,
        statement: statement.trim(),
        rationale: rationale.trim() || null,
        area,
      })
      .select('id')
      .single<{ id: string }>();

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: data.id };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

// ── Turning a failure into a sentence ─────────────────────────────────────────────────

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
      return 'That statement is either shorter than a claim or longer than a sentence. One claim, between 10 and 200 characters.';
    case '23505':
      return 'You have already answered this one. Changing your answer updates it rather than adding a second.';
    case '42501':
      return 'This account cannot do that. It usually means the email address has not been confirmed yet — check the confirmation email.';
    case 'PGRST301':
      return 'Your session has ended. Sign in again.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return UNAVAILABLE;
  }

  return 'That did not go through, and nothing was saved. If it keeps failing, the details are worth reporting.';
}
