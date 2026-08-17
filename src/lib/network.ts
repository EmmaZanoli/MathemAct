/**
 * Entry data access — build-time reads from data/network.json.
 *
 * All reads happen at build time from the nightly export. Nothing here talks to Supabase
 * at build time; that is what readCorpus() is for. The PostgREST client is only loaded
 * on pages that need live writes (the submission form).
 */
import rawJson from '../../data/network.json';

export type NetworkCategory =
  | 'research_tool'
  | 'educational'
  | 'formalisation'
  | 'guidelines_and_policy'
  | 'community'
  | 'reading';

export type NetworkLinkStatus = 'ok' | 'unreachable' | 'redirected' | null;

export interface NetworkSubmitter {
  readonly id: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
  readonly institution: {
    readonly name: string;
    readonly country: string;
    readonly verifiedAt: string;
  } | null;
}

export interface Entry {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly urlNormalised: string;
  readonly category: NetworkCategory;
  readonly description: string;
  readonly relevance: string;
  readonly createdAt: string;
  readonly linkStatus: NetworkLinkStatus;
  readonly linkCheckedAt: string | null;
  readonly submitter: NetworkSubmitter | null;
}

export const CATEGORIES: readonly { value: NetworkCategory; label: string }[] = [
  { value: 'research_tool',        label: 'Research tool' },
  { value: 'educational',          label: 'Educational' },
  { value: 'formalisation',        label: 'Formalisation' },
  { value: 'guidelines_and_policy', label: 'Guidelines and policy' },
  { value: 'community',            label: 'Community' },
  { value: 'reading',              label: 'Reading' },
];

export function categoryLabel(value: NetworkCategory): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

let _entries: Entry[] | null = null;

export function listNetwork(): Entry[] {
  if (_entries !== null) return _entries;
  _entries = (rawJson as Entry[]);
  return _entries;
}

export function getEntry(id: string): Entry | undefined {
  return listNetwork().find((r) => r.id === id);
}

/** One person's published entries, for their author page. Erased submitters are absent by
 *  construction: their rows keep the entry and lose the name. */
export function entriesBySubmitter(submitterId: string): Entry[] {
  return listNetwork().filter((r) => r.submitter?.id === submitterId);
}

/**
 * Client-side URL normalisation, kept in sync with private.normalise_url() in
 * supabase/migrations/20260816100000_resources.sql.
 *
 * Used in the submission form to check for duplicates before submitting.
 */
export function normaliseUrl(url: string): string {
  const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'msclkid', 'origin', 'ref',
    'source', 'utm_campaign', 'utm_content', 'utm_creative_format',
    'utm_id', 'utm_marketing_tactic', 'utm_medium', 'utm_source',
    'utm_source_platform', 'utm_term',
  ]);

  let u = url.toLowerCase().replace(/^https?:\/\//, '');
  const qmark = u.indexOf('?');

  if (qmark === -1) {
    return u.replace(/\/+$/, '');
  }

  const pathPart = u.slice(0, qmark).replace(/\/+$/, '');
  const params = u
    .slice(qmark + 1)
    .split('&')
    .filter((p) => p !== '' && !TRACKING_PARAMS.has(p.split('=')[0]))
    .sort()
    .join('&');

  return params ? `${pathPart}?${params}` : pathPart;
}
