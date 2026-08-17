/**
 * The two status axes a report carries, and the words used for them.
 *
 * These are kept apart on purpose, because they are independent facts and collapsing
 * them into one enum produces twelve meaningless combinations:
 *
 *   Verification — has anyone confirmed this still works? Drives whether the tombstone
 *                  is filled or open. This is the signature element of the whole site.
 *   Outcome      — what the author reports happened. Drives the glyph's colour only.
 *
 * A report can report "did not work" and still be verified and current; a report can
 * report "worked" and be three model generations stale. Both are worth knowing, and the
 * second is the one people forget to ask about.
 *
 * Wording lives here rather than in the component so that the same phrases reach the
 * export, the filter controls, and the submission form without being retyped.
 */

export const TOMBSTONE_STATUSES = ['verified', 'unverified', 'stale', 'broken'] as const;
export type TombstoneStatus = (typeof TOMBSTONE_STATUSES)[number];

export const OUTCOMES = ['worked', 'partial', 'failed'] as const;
export type Outcome = (typeof OUTCOMES)[number];

interface Descriptor {
  /** Short, for chips and dense listings. */
  readonly label: string;
  /** Full phrase, used as the accessible name. Must stand alone out of context. */
  readonly description: string;
}

interface TombstoneDescriptor extends Descriptor {
  /** Filled square, or open. Only one status earns a filled one. */
  readonly filled: boolean;
}

/**
 * A filled square requires both halves: a correctness verification on record *and*
 * confirmation that it still works. Everything else is open. A report written against
 * a 2025 model is misleading by 2026, and the glyph has to say so without being read.
 */
export const TOMBSTONE_STATUS: Record<TombstoneStatus, TombstoneDescriptor> = {
  verified: {
    filled: true,
    label: 'Verified',
    description: 'Correctness verification recorded, and confirmed still working',
  },
  unverified: {
    filled: false,
    label: 'Unverified',
    description: 'No confirmation on record that this still works',
  },
  stale: {
    filled: false,
    label: 'Stale',
    description: 'Last confirmed against an older model, and not rechecked since',
  },
  broken: {
    filled: false,
    label: 'No longer works',
    description: 'Reported as no longer working',
  },
};

export const OUTCOME: Record<Outcome, Descriptor> = {
  worked: { label: 'Worked', description: 'Reported outcome: worked' },
  partial: { label: 'Partially worked', description: 'Reported outcome: partially worked' },
  failed: { label: 'Did not work', description: 'Reported outcome: did not work' },
};

/**
 * The accessible name for a tombstone. Both axes are spoken in full, because a screen
 * reader user gets no glyph and no colour — the sentence is the entire signal.
 */
export function tombstoneName(status: TombstoneStatus, outcome?: Outcome): string {
  const verification = TOMBSTONE_STATUS[status].description;
  return outcome ? `${OUTCOME[outcome].description}. ${verification}` : verification;
}
