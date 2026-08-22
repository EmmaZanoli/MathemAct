/**
 * Debates and the agreement scale.
 *
 * Same shape as src/lib/reports.ts: `readDebates()` is the single swap point, reads
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
 * **Nothing here computes a mean, and that has not changed.** What changed on 2026-08-21 is
 * that `public.rating_aggregate` now returns one, so this module carries it. It does not derive
 * it: not from the histogram, not from the counts, not anywhere, because a second mean computed
 * to a second definition is the failure the single-source rule exists to prevent.
 *
 * The original reason for having no mean at all survives as a display rule. The mean of an
 * 11-point bipolar scale is misleading exactly when the distribution is bimodal, and bimodal is
 * what to expect on the contested debates — so it is shown beside the median, never as a
 * headline, never on a card, never on a sort control, and never without the histogram beside it.
 */
import { getSupabase } from './supabase';
import type { Area } from './report-schema';

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

export interface DebateAuthor {
  readonly id: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
}

export interface DebateTag {
  readonly code: string;
  readonly label: string;
}

export interface Debate {
  readonly id: string;
  readonly statement: string;
  /** The reasoning behind the claim. Capped at 500 characters since 2026-08-22, because the cap
   *  is the only thing that reliably stops an opening post becoming an essay. */
  readonly rationale: string | null;
  readonly status: 'proposed' | 'active';
  readonly area: Area;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly author: DebateAuthor | null;
  /** arXiv subject classes, from the same vocabulary reports use. Empty rather than null. */
  readonly tags: readonly DebateTag[];
  /** What prompted the claim: an external link, **or** a report from this corpus, or neither.
   *  Never both — `debates_one_source` refuses it. */
  readonly sourceUrl: string | null;
  readonly sourceReportId: string | null;
}

/**
 * The aggregate, exactly as public.debate_ratings reports it.
 *
 * `mean` was added on 2026-08-21 and had been prohibited before it. The analysis behind the
 * prohibition stands — on a bimodal distribution the mean reports mild agreement for a
 * community that has split cleanly in two — so it survives as a **display** rule rather than as
 * an absent field: the mean is shown beside the median, never as a headline, never on a card,
 * never on a sort control, and never without the histogram beside it. See docs/decisions.md.
 */
export interface Aggregate {
  /** Eleven counts. Index i holds the number of people who chose score i. */
  readonly histogram: readonly number[];
  /** Null when nobody has expressed an opinion — everyone declined, or nobody answered. */
  readonly median: number | null;
  /**
   * Secondary, and null on the same condition as the median. **Not zero** when nobody has an
   * opinion: zero is a position on this scale and means strong disagreement.
   */
  readonly mean: number | null;
  /** Everyone who answered, including those who declined. */
  readonly totalRaters: number;
  readonly opinionCount: number;
  readonly noOpinionCount: number;
  /** opinionCount / totalRaters, or null when nobody has answered at all. */
  readonly coverage: number | null;
}

/**
 * The rest of what the export computes per debate, which the live aggregate does not carry.
 *
 * Split from `Aggregate` on purpose, and the split is the boundary between two sources rather
 * than a tidying-up. `Aggregate` is exactly `public.debate_ratings`, so it is the shape both
 * the export and a live browser query return. Everything here is an **export-time product**:
 * `divided` and `consensus` are computed in scripts/export.mjs, and `positionChanges` counts
 * `public.rating_changes`, which no browser role may read at all.
 *
 * A consumer holding only an `Aggregate` therefore cannot accidentally render a figure that
 * would be missing the moment it came from a live call instead.
 */
export interface DebateStats extends Aggregate {
  /**
   * Contributions on this debate, soft-deleted ones included: their positions still count.
   *
   * **Null when the export predates the field**, which is not the same as zero and must not be
   * rendered as one — an export written before 2026-08-21 has debates with contributions and
   * no count of them, and printing "0 contributions" under a chart with contributions beneath
   * it would be the page contradicting itself.
   */
  readonly contributionCount: number | null;
  /** How many people the arguments moved. Distinct people, not edits. Null on the same
   *  condition as above, and for the same reason. */
  readonly positionChanges: number | null;
  /**
   * Twice the smaller of the two sides' shares, over the scored positions only.
   *
   * Null below `sortableMinimum`, and null is not zero: zero means "nobody disagrees", which a
   * debate with four answers has not established.
   */
  readonly divided: number | null;
  /** The largest share held by any one of the five families. Null on the same condition. */
  readonly consensus: number | null;
  /** The threshold the two above need. Carried so the page can say it rather than hard-code it. */
  readonly sortableMinimum: number;
  /**
   * When anything last happened on this debate — the later of its newest contribution and its
   * newest rating activity, falling back to its own date.
   *
   * A timestamp and nothing else. It says *when*, never who moved or to what, so it is not a
   * back door into the per-person history `public.rating_changes` deliberately withholds.
   */
  readonly lastActivityAt: string | null;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE =
  'The database cannot be reached right now. Try again in a few minutes.';

// ── The swap point ────────────────────────────────────────────────────────────────────

const EXPORTED = import.meta.glob<{ default: Debate[] }>('/data/debates.json', {
  eager: true,
});

/**
 * The per-debate statistics from the nightly export.
 *
 * Typed as the full `DebateStats` now rather than the two fields the listing needed, because
 * the debate page reads the distribution from here. Every field is optional in practice: a
 * `data/` written before 2026-08-21 has no `mean`, no `divided` and no `positionChanges`, and a
 * `data/` written before the corpus existed has no rows at all. `statsFor()` is where that is
 * handled once.
 */
const AGGREGATES = import.meta.glob<{
  default: readonly Partial<DebateStats>[] & readonly { debateId: string }[];
}>('/data/debate-ratings.json', { eager: true });

let cached: Debate[] | null = null;

/**
 * The committed export, and nothing else. The PostgREST fallback that stood here until the
 * nightly job existed has gone; see the same note in src/lib/reports.ts for why its
 * absence is the feature rather than a regression.
 *
 * Everything not hidden is in the file. `proposed` is a status nothing enters any more —
 * a debate is active when it is written — but the type keeps it, because rows written
 * before 2026-08-18 were exported under it and an export is a historical document.
 */
async function readDebates(): Promise<Debate[]> {
  if (cached) return cached;

  const exported = Object.values(EXPORTED)[0]?.default;

  if (!exported) {
    console.warn(
      '[debates] data/debates.json is missing, so there are none. ' +
        'Run scripts/export.mjs, or let .github/workflows/export.yml commit one.',
    );
    cached = [];
    return cached;
  }

  // Normalised rather than trusted, as `readComments()` does and for the same reason: an export
  // written before 2026-08-22 has no `tags`, no `sourceUrl` and no `sourceReportId`, and the type
  // above says all three are present. `data/` is a historical document and older files are still
  // valid, so the defaulting lives here rather than at every consumer.
  cached = exported.map((debate) => ({
    ...debate,
    tags: debate.tags ?? [],
    sourceUrl: debate.sourceUrl ?? null,
    sourceReportId: debate.sourceReportId ?? null,
  }));

  return cached;
}

export async function listDebates(): Promise<Debate[]> {
  return readDebates();
}

export async function getDebate(id: string): Promise<Debate | undefined> {
  return (await readDebates()).find((debate) => debate.id === id);
}

/** One person's debates, for their author page. Every status the export carries. */
export async function debatesByAuthor(authorId: string): Promise<Debate[]> {
  return (await readDebates()).filter(
    (debate) => debate.author?.id === authorId,
  );
}

/**
 * Every debate's statistics, by id, from the export. Build time only.
 *
 * A debate missing from the map has no aggregates, and there are two ways to be in that state
 * — posted since the last export, or in an export written before these fields existed. Both are
 * the same fact for every consumer: **render no distribution, and be ineligible for the two
 * aggregate sorts.** Nothing here substitutes a zero for an absence.
 */
let statsCache: Map<string, DebateStats> | null = null;

export function listDebateStats(): Map<string, DebateStats> {
  if (statsCache) return statsCache;

  const stats = new Map<string, DebateStats>();

  for (const row of Object.values(AGGREGATES)[0]?.default ?? []) {
    const histogram = row.histogram;

    // A row with no histogram is not a debate nobody answered — the export writes eleven zeros
    // for those. It is a row from an older file, and it has nothing to render.
    if (!Array.isArray(histogram) || histogram.length !== SCALE_POINTS.length) continue;

    stats.set(row.debateId, {
      histogram,
      median: row.median ?? null,
      mean: row.mean ?? null,
      totalRaters: row.totalRaters ?? 0,
      opinionCount: row.opinionCount ?? 0,
      noOpinionCount: row.noOpinionCount ?? 0,
      coverage: row.coverage ?? null,
      // `?? null`, not `?? 0`. See the note on the type: an older export has debates with
      // contributions and no count of them, and a zero would be the page asserting otherwise.
      contributionCount: row.contributionCount ?? null,
      positionChanges: row.positionChanges ?? null,
      // `?? null` and not `?? 0`. An older export has no shares at all, and the whole point of
      // the null is that it is not a reading.
      divided: row.divided ?? null,
      consensus: row.consensus ?? null,
      sortableMinimum: row.sortableMinimum ?? 10,
      lastActivityAt: row.lastActivityAt ?? null,
    });
  }

  statsCache = stats;
  return stats;
}

/** One debate's statistics, or undefined when the export has none for it. */
export function statsFor(debateId: string): DebateStats | undefined {
  return listDebateStats().get(debateId);
}

/**
 * Interaction count per debate id: positions plus contributions.
 *
 * The ordering key behind the "Most answered" sort, and the number itself is never shown. It
 * now comes entirely from the aggregate file — `contributionCount` is computed there — rather
 * than from a second pass over comments.json. Two files counting the same thing is how a sort
 * key and a page come to disagree.
 */
export function listDebateInteractionCounts(): Map<string, number> {
  const counts = new Map<string, number>();

  for (const [id, stats] of listDebateStats()) {
    // `?? 0` is right here and wrong in the type. As a sort key an unknown contribution count
    // has to be some number, and treating it as none orders the debate by its rater count
    // alone — which is a worse ordering, not a wrong figure. Nothing renders this.
    counts.set(id, stats.totalRaters + (stats.contributionCount ?? 0));
  }

  return counts;
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
  debateId: string,
  userId: string,
): Promise<Result<{ rated: boolean; score: number | null }>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('ratings')
      .select('score')
      .eq('debate_id', debateId)
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
  debateId: string,
  userId: string,
  score: number | null,
): Promise<Result<null>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  // upsert() generates ON CONFLICT DO UPDATE SET debate_id, user_id, score — but the
  // authenticated role only has UPDATE (score). PostgreSQL checks column-level UPDATE
  // privileges at parse time for all SET columns, even when no conflict occurs, so every
  // upsert fails with 42501. INSERT then UPDATE avoids the problem: the UPDATE SET clause
  // only touches score, which is the one column that is granted.
  try {
    const { error: insertError } = await supabase
      .from('ratings')
      .insert({ debate_id: debateId, user_id: userId, score });

    if (!insertError) return { ok: true, value: null };

    if (insertError.code !== '23505') {
      return { ok: false, message: describe(insertError) };
    }

    const { error: updateError } = await supabase
      .from('ratings')
      .update({ score })
      .eq('debate_id', debateId)
      .eq('user_id', userId);

    if (updateError) return { ok: false, message: describe(updateError) };
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/**
 * The distribution. Fetched rather than built into the page, so that it is not in the
 * source for somebody who has not answered yet — see the header of this file.
 */
export async function loadAggregate(debateId: string): Promise<Result<Aggregate>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase
      .from('debate_ratings')
      .select(
        'histogram, median, mean, total_raters, opinion_count, no_opinion_count, coverage',
      )
      .eq('debate_id', debateId)
      .maybeSingle();

    if (error) return { ok: false, message: describe(error) };
    if (!data) {
      return { ok: false, message: 'That debate has no readable aggregate.' };
    }

    return {
      ok: true,
      value: {
        histogram: (data.histogram as number[]) ?? SCALE_POINTS.map(() => 0),
        median: data.median as number | null,
        // `data.mean` arrives as a string: node-postgres and PostgREST both render `numeric`
        // as text rather than risk a float, so Number() is not decoration. Null stays null —
        // nobody has an opinion is not a mean of zero.
        mean: data.mean === null || data.mean === undefined ? null : Number(data.mean),
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

/**
 * Proposing a claim, and stating a position on it, in one call.
 *
 * `public.submit_debate()` rather than an insert, because the two writes have to be one
 * transaction: a debate whose proposer never answered it is the thing the requirement forbids,
 * and two client calls produce exactly that whenever the second one fails. See the migration.
 *
 * `score` of `null` **with** `offScale` true is the off-scale answer and is stored as a null
 * score on a real row. `score` of null with `offScale` false is an unanswered form, and the
 * function refuses it. Those are different things and this signature keeps them apart.
 */
export async function proposeDebate(input: {
  readonly statement: string;
  readonly rationale: string;
  readonly area: Area;
  readonly score: number | null;
  readonly offScale: boolean;
  readonly tagCodes: readonly string[];
  readonly sourceUrl: string | null;
  readonly sourceReportId: string | null;
}): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: UNAVAILABLE };

  try {
    const { data, error } = await supabase.rpc('submit_debate', {
      p_statement: input.statement.trim(),
      p_area: input.area,
      p_score: input.offScale ? null : input.score,
      p_off_scale: input.offScale,
      p_rationale: input.rationale.trim() || null,
      p_tag_codes: [...input.tagCodes],
      p_source_url: input.sourceUrl?.trim() || null,
      p_source_report: input.sourceReportId || null,
    });

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, value: data as string };
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
    /**
     * The site is newer than the database it is talking to.
     *
     * `42703` is an unknown column and `42P01` an unknown table or view. Either means the
     * deployed pages are asking for something a migration has not created yet — which is a real
     * state on this project rather than a theoretical one: `migrate.yml` runs only on `main`, and
     * on `main` it runs on the *same push* as the deploy rather than before it. So a branch
     * preview, and a short window after every merge, both look like this.
     *
     * Named rather than left to the generic fallback, because the fallback says "nothing was
     * saved" — and for a read that is beside the point, while for a write it is often false.
     */
    case '42703':
    case '42P01':
      return 'This part of the site is newer than the database it reads from, so that is not available yet. Nothing you did is lost; try again shortly.';
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
