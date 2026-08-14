/**
 * Field rules shared between the forms and the display layer.
 *
 * Every limit here mirrors a CHECK constraint in supabase/migrations/. That direction
 * matters: the constraint is the truth and this is the convenience. A rule that exists
 * only in this file is a rule a determined caller does not have, because PostgREST is a
 * public endpoint and our forms are not the only way to reach it. When you change a limit,
 * change the migration first.
 *
 *   display_name   profiles_display_name_length      1..80 after trimming
 *   bio            profiles_bio_length               <= 1000
 *   note           deletion_requests_note_length     <= 1000
 *
 * Each function returns a message to show, or null when the value is fine. Messages say
 * what is wrong and what to do about it, and none of them apologises.
 */

export const LIMITS = {
  displayName: { min: 1, max: 80 },
  bio: { max: 1000 },
  note: { max: 1000 },
  /**
   * Not a database constraint — Supabase Auth enforces the password minimum, and its
   * setting is in the dashboard rather than in any migration. Keep this number and the
   * dashboard's "Minimum password length" in step; docs/auth.md says where it lives.
   */
  password: { min: 10 },
} as const;

export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length < LIMITS.displayName.min) {
    return 'Enter a display name. It is what appears on everything you post, and it may be a pseudonym.';
  }

  if (trimmed.length > LIMITS.displayName.max) {
    return `Shorten the display name to ${LIMITS.displayName.max} characters or fewer. It is currently ${trimmed.length}.`;
  }

  return null;
}

export function validateBio(value: string): string | null {
  if (value.length > LIMITS.bio.max) {
    return `Shorten the bio to ${LIMITS.bio.max} characters or fewer. It is currently ${value.length}.`;
  }

  return null;
}

export function validateNote(value: string): string | null {
  if (value.length > LIMITS.note.max) {
    return `Shorten the note to ${LIMITS.note.max} characters or fewer. It is currently ${value.length}.`;
  }

  return null;
}

/**
 * Deliberately permissive. A stricter pattern than "something, an @, a dotted something"
 * rejects real addresses — plus-addressing, apostrophes, internationalised domains — and
 * the only check that ever settles the question is whether the confirmation email arrives.
 * This exists to catch a typo before a round trip, not to adjudicate RFC 5322.
 */
export function validateEmail(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return 'Enter the email address you want to use for this account.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'Enter a complete email address, including the part after the @.';
  }

  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < LIMITS.password.min) {
    return `Use at least ${LIMITS.password.min} characters. A passphrase of a few words is easier to remember and harder to guess than a short password.`;
  }

  return null;
}
