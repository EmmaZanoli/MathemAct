/**
 * The shape of a practice: its vocabularies, its limits, and the words used to ask for
 * each field.
 *
 * This file is the form's script. It exists as data rather than as markup because the same
 * words have to appear in three places that must not drift — the submission form, the
 * display of a submitted practice, and eventually the disclosure template a journal could
 * adopt. A label written into a template is a label that gets reworded in one of the three.
 *
 * Every cap below mirrors a CHECK constraint in supabase/migrations/20260815100200_practices.sql.
 * The database is the truth and this is the convenience: PostgREST is a public endpoint and
 * our form is not the only way to reach it. When a cap changes, it changes in the migration
 * first and here second.
 *
 * On the microcopy
 * ----------------
 * Every field gets one line saying what it is for, and the ones where people reliably guess
 * wrong get a real example. The examples are deliberately ordinary — a lemma, a literature
 * search, a translation — because an example of a spectacular result would teach people
 * that spectacular results are what belongs here, and they are not. Failures are.
 */
import type { Outcome } from './status';

// ── Limits ────────────────────────────────────────────────────────────────────────────
// Mirrors the CHECK constraints. A counter is shown against every one of these, because a
// cap you discover by being rejected is a cap that cost you the paragraph you just wrote.

export const PRACTICE_LIMITS = {
  title: 120,
  aim: 600,
  method: 6000,
  outcomeNotes: 1500,
  verification: 3000,
  transcriptExcerpt: 20000,
  transcriptUrl: 500,
  caveats: 2000,
  toolName: 120,
  toolVersion: 60,
  /** Roughly seventy days. High enough never to reject an honest answer. */
  timeSpentMinutes: 100000,
  tools: 20,
} as const;

/** The site's 11-point scale, same anchors as the agreement scale. */
export const CONFIDENCE = { min: 0, max: 10 } as const;

/** Nothing before this is plausible as AI-assisted mathematical work, and a mistyped year
 *  is the thing this catches. Mirrors practice_tools_used_on_lower_bound. */
export const EARLIEST_TOOL_USE = '2015-01-01';

// ── Vocabularies ──────────────────────────────────────────────────────────────────────
// Values match the Postgres enums exactly. Nothing translates between the database, the
// form, and the export.

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  /** One line. Shown beside the option, not in a tooltip. */
  readonly hint?: string;
}

export const AREAS = [
  { value: 'research', label: 'Research', hint: 'Work intended to produce new mathematics.' },
  { value: 'learning', label: 'Learning', hint: 'Understanding something already known, for yourself.' },
  { value: 'teaching', label: 'Teaching', hint: 'Preparing or delivering material for others.' },
  { value: 'writing', label: 'Writing', hint: 'Exposition, papers, talks, notes.' },
  { value: 'other', label: 'Other', hint: 'Say which in the account below.' },
] as const satisfies readonly Choice<string>[];

export type Area = (typeof AREAS)[number]['value'];

export const TASK_TYPES = [
  { value: 'literature_search', label: 'Literature search', hint: 'Finding what is already known.' },
  { value: 'conjecture_generation', label: 'Conjecture generation', hint: 'Proposing statements to try to prove.' },
  { value: 'proof_drafting', label: 'Proof drafting', hint: 'Producing an argument or an outline of one.' },
  { value: 'proof_checking', label: 'Proof checking', hint: 'Looking for gaps in an argument you have.' },
  { value: 'formalisation', label: 'Formalisation', hint: 'Stating mathematics in a proof assistant.' },
  { value: 'computation', label: 'Computation', hint: 'Calculating, searching, or generating examples.' },
  { value: 'exposition', label: 'Exposition', hint: 'Explaining known mathematics readably.' },
  { value: 'translation', label: 'Translation', hint: 'Between languages, or between notations.' },
  { value: 'referee_work', label: 'Referee work', hint: 'Reading and reporting on somebody else’s work.' },
  { value: 'other', label: 'Other', hint: 'Say which in the account below.' },
] as const satisfies readonly Choice<string>[];

export type TaskType = (typeof TASK_TYPES)[number]['value'];

/**
 * The three outcomes, in the order they appear on the form.
 *
 * They are ordered by what happened rather than by how good it is, and the interface gives
 * them identical weight: same size, same border, same type. A corpus of only successes is
 * worthless and reads as advertising, and failure modes are precisely what nobody
 * publishes. If a future change makes one of these smaller, quieter, or last, it has broken
 * the thing the corpus is for.
 */
export const OUTCOME_CHOICES = [
  {
    value: 'worked',
    label: 'It worked',
    hint: 'The result was what you needed, and it held up when you checked it.',
  },
  {
    value: 'partial',
    label: 'It partly worked',
    hint: 'Some of it was usable. The rest was wrong, irrelevant, or needed redoing.',
  },
  {
    value: 'failed',
    label: 'It did not work',
    hint: 'It produced nothing usable, or produced something confidently wrong.',
  },
] as const satisfies readonly Choice<Outcome>[];

/**
 * Suggested tool names, offered as a datalist and never as a closed list. Free text is
 * always accepted: a controlled vocabulary of tools would be out of date within a month,
 * and the interesting accounts are the ones using something nobody thought to list.
 */
export const COMMON_TOOLS = [
  'ChatGPT',
  'GPT-5',
  'Claude',
  'Gemini',
  'DeepSeek',
  'Copilot',
  'Lean',
  'Mathlib',
  'Rocq',
  'Isabelle',
  'Agda',
  'SageMath',
  'Mathematica',
  'Maple',
  'MATLAB',
  'Magma',
  'GAP',
  'PARI/GP',
  'Macaulay2',
  'Singular',
  'SymPy',
  'OEIS',
  'AlphaProof',
] as const;

// ── The questions ─────────────────────────────────────────────────────────────────────
// One line each, and a real example wherever people reliably guess wrong about the level
// of detail wanted.

export const FIELD_COPY = {
  title: {
    hint: 'One line, saying what you did. Imperative where it reads naturally.',
    example: 'Check a lemma in additive combinatorics with a proof assistant',
  },
  aim: {
    hint: 'The problem, not the session. What were you actually trying to find out?',
    example:
      'I had a lemma I believed but could not see a clean proof of, and wanted to know whether it was true before spending a week on it.',
  },
  method: {
    hint: 'Stepwise. Enough that somebody could try the same thing.',
    example:
      '1. Stated the lemma in Lean 4 with Mathlib.\n2. Asked the model for a proof sketch.\n3. It suggested induction on the size of the sumset.\n4. Translated the sketch into tactics and closed three of five goals.\n5. Did the remaining two by hand.',
  },
  outcomeNotes: {
    hint: 'A few sentences on what actually happened. Specifics beat adjectives.',
    example:
      'The induction was the right idea but the base case it gave was for the wrong statement. Two of the five goals closed directly; the others needed a hypothesis it had silently assumed.',
  },
  verification: {
    hint: 'How you established the result was correct — or established that it was not.',
    example:
      'Lean accepted the final proof, so the formal statement is verified. I checked separately that the formal statement says what I meant by rederiving the informal version by hand.',
  },
  transcriptExcerpt: {
    hint: 'Paste the part that matters. Trim the rest.',
    example: '',
  },
  transcriptUrl: {
    hint: 'A share link, if you have one. Supplementary only.',
    example: '',
  },
  caveats: {
    hint: 'What you would do differently, and what a reader should be careful about.',
    example:
      'I would state the hypotheses in full before asking. Most of the wasted time came from it filling in an assumption I had left implicit.',
  },
} as const;

// ── The sections, in the order CLAUDE.md gives them ───────────────────────────────────
// Used by the progress indicator, which counts sections rather than fields so that "4 of
// 12" means something to somebody deciding whether to start.

export interface Section {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** Whether an answer is required for the submission to be accepted. */
  readonly required: boolean;
}

export const SECTIONS: readonly Section[] = [
  { id: 'title', number: 1, title: 'Title', required: true },
  { id: 'area', number: 2, title: 'Area', required: true },
  { id: 'task-type', number: 3, title: 'Task type', required: true },
  { id: 'tools', number: 4, title: 'Tools used', required: true },
  { id: 'aim', number: 5, title: 'What you were trying to do', required: true },
  { id: 'method', number: 6, title: 'What you actually did', required: true },
  { id: 'outcome', number: 7, title: 'Outcome', required: true },
  { id: 'verification', number: 8, title: 'How you verified correctness', required: true },
  { id: 'transcript', number: 9, title: 'Transcript', required: true },
  { id: 'caveats', number: 10, title: 'Caveats', required: false },
  { id: 'tags', number: 11, title: 'Subject areas', required: false },
  { id: 'counting', number: 12, title: 'So this can be counted', required: false },
];
