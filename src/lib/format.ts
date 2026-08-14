/**
 * Formatting shared between the build and the browser.
 *
 * Anything a machine could parse — dates, versions, model names, scores — is set in mono
 * and formatted here rather than at each call site, so the same fact reads identically in
 * a badge, a listing, and the export.
 */

/**
 * The month a verification happened: "Aug 2026".
 *
 * A month rather than a day, and never "2 days ago". A badge attests that an address was
 * confirmed at some point, and the useful question a reader asks is "how old is this" —
 * which a month answers and a relative phrase quietly stops answering the moment the page
 * is cached. en-GB regardless of the reader's locale, because the surrounding copy is in
 * English and a date that switches format mid-sentence looks like a bug.
 */
export function verificationMonth(iso: string | null | undefined): string {
  if (!iso) return '';

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';

  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(when);
}

/** A full date for the record: "14 August 2026". Used where a day genuinely matters. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(when);
}
