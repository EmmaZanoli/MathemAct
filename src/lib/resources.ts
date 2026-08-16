/**
 * Resource data access — build-time reads from data/resources.json.
 *
 * All reads happen at build time from the nightly export. Nothing here talks to Supabase
 * at build time; that is what readCorpus() is for. The PostgREST client is only loaded
 * on pages that need live writes (the submission form).
 */
import rawJson from '../../data/resources.json';

export type ResourceCategory =
  | 'research_tool'
  | 'educational'
  | 'formalisation'
  | 'guidelines_and_policy'
  | 'community'
  | 'reading';

export type ResourceLinkStatus = 'ok' | 'unreachable' | 'redirected' | null;

export interface ResourceSubmitter {
  readonly id: string;
  readonly displayName: string;
  readonly isPseudonym: boolean;
  readonly institution: {
    readonly name: string;
    readonly country: string;
    readonly verifiedAt: string;
  } | null;
}

export interface Resource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly urlNormalised: string;
  readonly category: ResourceCategory;
  readonly description: string;
  readonly relevance: string;
  readonly createdAt: string;
  readonly linkStatus: ResourceLinkStatus;
  readonly linkCheckedAt: string | null;
  readonly submitter: ResourceSubmitter | null;
}

export const CATEGORIES: readonly { value: ResourceCategory; label: string }[] = [
  { value: 'research_tool',        label: 'Research tool' },
  { value: 'educational',          label: 'Educational' },
  { value: 'formalisation',        label: 'Formalisation' },
  { value: 'guidelines_and_policy', label: 'Guidelines and policy' },
  { value: 'community',            label: 'Community' },
  { value: 'reading',              label: 'Reading' },
];

export function categoryLabel(value: ResourceCategory): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

let _resources: Resource[] | null = null;

export function listResources(): Resource[] {
  if (_resources !== null) return _resources;
  _resources = (rawJson as Resource[]);
  return _resources;
}

export function getResource(id: string): Resource | undefined {
  return listResources().find((r) => r.id === id);
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
