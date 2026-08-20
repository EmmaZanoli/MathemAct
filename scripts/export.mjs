#!/usr/bin/env node
/**
 * Export the public corpus to data/, as JSON the site builds from and CSV people can cite.
 *
 *   node scripts/export.mjs [--out data] [--dry-run] [--allow-shrink]
 *
 * This script is the read path. CLAUDE.md's read/write split is what makes a free tier
 * viable in production: the site is built from these files, so a traffic spike never touches
 * the egress quota, reading still works while the database is paused or over quota, and this
 * job's own activity is what stops the project being paused for inactivity in the first
 * place. Nothing a reader does opens a connection to Supabase.
 *
 * ── The rule that matters most ──────────────────────────────────────────────────────
 *
 * **This connects with a role that bypasses row level security, so the WHERE clauses below
 * are the entire boundary between public and private.** Everywhere else in this project the
 * policies do that work and a mistake is caught by them. Not here. Every query states its own
 * public filter explicitly, even where a filter looks redundant, and each one is written next
 * to the reason it exists. If you add a query, write its filter first.
 *
 * What is excluded, and why each would be a real leak:
 *
 *   auth.users            addresses. Never read, by anything, ever. There is no join to it
 *                         anywhere below and there must never be one.
 *   pending, hidden       content nobody has approved, and content a moderator removed. The
 *                         second is worse: an export would republish exactly what was hidden.
 *   deleted               soft-deleted reports and the bodies of deleted comments.
 *   public.flags        who complained about whom.
 *   moderation_actions    the audit log, including the reasons moderators wrote each other.
 *   deletion_requests     who is leaving.
 *   public.ratings        individual answers. A rating row is readable only by its author,
 *                         and the aggregate is the *only* form any of it may take. One
 *                         attributable row would undo the promise the whole scale rests on.
 *   profiles.role         who the moderators are.
 *   profiles.is_banned    a public list of banned accounts is a punishment nobody agreed to.
 *   institution_source    which of the three domain layers issued a badge. Never displayed;
 *                         the surest way to keep that true is for it never to leave the
 *                         database.
 *   has_prompts,          two generated booleans that exist so the freshness overlay can
 *   has_transcript        answer a filter without fetching a transcript. Not a leak, just
 *                         redundant here: this file carries the text itself.
 *
 * ── Why a direct connection and not the service role key ────────────────────────────
 *
 * The prompt for this work names both SUPABASE_DB_URL and the service role key. Only the
 * first is used, and the second is deliberately not passed to this job.
 *
 * They authorise the same thing — a read that bypasses row level security — but through
 * different doors. Over PostgREST the service role key would need paginating past a default
 * 1000-row limit, cannot express the lateral aggregates below, and would take one request per
 * dataset per page. A direct connection is one round trip per dataset, is the same path
 * `supabase db push` already uses from CI, and is the same `pg_dump`-shaped exit this project
 * chose Supabase for. Handing a job a credential it does not need is how credentials end up
 * in logs.
 *
 * ── Shapes ──────────────────────────────────────────────────────────────────────────
 *
 * The JSON is camelCase because the site consumes it directly: each file deserialises into
 * the interface of the same name in src/lib/. **When one of those interfaces changes, the
 * mapping below changes with it**, and there is no type checker spanning the two — this
 * script is plain Node and the site is TypeScript. The CSV is snake_case because it mirrors
 * the column names in supabase/migrations/, which is what a researcher reading the schema
 * will have in front of them.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const USAGE = `
Export the public corpus to JSON and CSV.

  node scripts/export.mjs [options]

Options
  --out <dir>      Where to write. Default: data
  --dry-run        Query and report; write nothing.
  --allow-shrink   Permit an export that drops more than half the reports in the
                   previous manifest. Refused otherwise, because the usual cause is a
                   broken query rather than a mass deletion.

Environment
  SUPABASE_DB_URL  Connection string. Direct connection, not PostgREST.

    $env:SUPABASE_DB_URL = "postgresql://..."      # PowerShell
    export SUPABASE_DB_URL="postgresql://..."      # bash

  In CI it is a repository secret and is used by .github/workflows/export.yml and by
  migrate.yml, and by nothing else.
`;

// ── Arguments ─────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const options = {
  out: valueOf('--out') ?? 'data',
  dryRun: argv.includes('--dry-run'),
  allowShrink: argv.includes('--allow-shrink'),
};

function valueOf(flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

// ══ Queries ═══════════════════════════════════════════════════════════════════════════
// One per file. Each carries its own public filter; see the header for why that is not
// belt-and-braces here but the only belt there is.

/**
 * Published reports, newest first, with their tools, their tags, and the derived staleness
 * that drives the tombstone.
 *
 * Staleness is joined rather than recomputed. The same answer has to appear in a listing, on
 * a report page, and in this file, and the one place it is decided is
 * public.report_staleness.
 *
 * The author is embedded rather than left as an id, because every consumer needs the name
 * and the alternative is making them join two files. Four institution columns and nothing
 * else: no role, no ban flag, no source, and — it does not exist to select — no address.
 */
const REPORTS = `
  select
    p.id,
    p.schema_version,
    p.title,
    p.area::text,
    p.area_other,
    p.task_type::text,
    -- The enum array cast whole rather than element by element: ::text[] on an enum array is
    -- one cast, and node-postgres hands it back as a JS array of strings.
    p.task_secondary::text[] as task_secondary,
    p.career_stage,
    p.aim,
    p.method,
    p.outcome::text,
    p.outcome_notes,
    p.verification,
    p.prompts,
    p.transcript_excerpt,
    p.transcript_url,
    p."references",
    p.caveats,
    p.time_spent_minutes,
    p.was_published,
    p.was_disclosed,
    p.author_confidence,
    p.rating_helpfulness,
    p.rating_time_saved,
    p.rating_trust_before_checking,
    p.rating_verification_effort,
    p.rating_novelty,
    p.rating_understanding_gained,
    p.cost_more_time_than_saved,
    p.generalises,
    p.created_at,

    a.id                      as author_id,
    a.display_name            as author_display_name,
    a.is_pseudonym            as author_is_pseudonym,
    a.institution_name        as author_institution_name,
    a.institution_country     as author_institution_country,
    a.institution_verified_at as author_institution_verified_at,

    -- to_char rather than the date itself: node-postgres turns a date column into a JS Date
    -- at local midnight, which JSON.stringify then renders as a timestamp one day out in any
    -- timezone west of UTC. The corpus says "used on 9 August"; it must not depend on where
    -- the export ran.
    to_char(s.latest_tool_use, 'YYYY-MM-DD') as latest_tool_use,
    s.latest_verdict::text,
    s.latest_confirmation_at,
    -- count(*) is bigint, which node-postgres hands back as a string to avoid losing
    -- precision it will never have. Cast here so the JSON holds a number and the CSV holds
    -- a bare integer rather than a quoted one.
    s.confirmation_count::int as confirmation_count,
    s.tombstone_status,
    s.is_verified,

    coalesce(tools.rows, '[]'::json) as tools,
    coalesce(tags.rows,  '[]'::json) as tags

  from public.reports p
  left join public.profiles a on a.id = p.author_id
  left join public.report_staleness s on s.report_id = p.id

  left join lateral (
    select json_agg(
             json_build_object('name', t.tool_name, 'version', t.tool_version,
                               'usedOn', to_char(t.used_on, 'YYYY-MM-DD'),
                               'role', t.role)
             order by t.used_on desc, t.tool_name
           ) as rows
      from public.report_tools t
     where t.report_id = p.id
  ) tools on true

  left join lateral (
    select json_agg(
             json_build_object('code', g.code, 'label', g.label) order by g.sort_order, g.code
           ) as rows
      from public.report_tags pt
      join public.tags g on g.id = pt.tag_id
     where pt.report_id = p.id
  ) tags on true

  where p.status = 'published' and p.deleted_at is null
  order by p.created_at desc
`;

/**
 * Debates that are not hidden. `active` is the only status anything is written in since
 * post-moderation; `proposed` still appears on rows older than that.
 *
 * "Active" is the promoted set, and exporting only those would drop every claim still
 * collecting answers from the site that lists them. Proposed is neither pending nor hidden:
 * it is public by policy, rateable, and being rated is how it gets promoted. Hidden is the
 * moderated-away state and is the one this filter is for.
 */
const DEBATES = `
  select
    q.id,
    q.statement,
    q.rationale,
    q.status::text,
    q.area::text,
    q.created_at,
    q.activated_at,
    a.id           as author_id,
    a.display_name as author_display_name,
    a.is_pseudonym as author_is_pseudonym
  from public.debates q
  left join public.profiles a on a.id = q.author_id
  where q.status <> 'hidden'
  order by q.created_at desc
`;

/**
 * The distribution per debate: histogram, median, counts. **Never an individual rating,
 * and never a mean.**
 *
 * public.rating_aggregate() is the one place either is computed, and this reads the view over
 * it rather than reaching into public.ratings — so a change to how coverage is defined cannot
 * be true on the site and false in the dataset. There is no mean in the view and none is
 * derived here; the histogram is in the file, so anyone who wants central tendency has the
 * median and anyone who wants spread has the whole shape.
 *
 * This file is for the dataset. **Nothing in src/ imports it**, and that is deliberate: a
 * reader is not shown the distribution until they have answered, and a histogram baked into
 * the built HTML would make that a decoration view-source defeats.
 */
const AGGREGATES = `
  select
    r.debate_id,
    r.histogram,
    r.median,
    r.total_raters::int    as total_raters,
    r.opinion_count::int   as opinion_count,
    r.no_opinion_count::int as no_opinion_count,
    r.coverage
  from public.debate_ratings r
  join public.debates q on q.id = r.debate_id
  where q.status <> 'hidden'
  order by r.debate_id
`;

/** The tag vocabulary: the 32 arXiv mathematics categories as seeded, minus any retired
 *  since. Retired tags are excluded here but stay on the reports that used them, which is
 *  correct — the tag was applied when it was current. */
const TAGS = `
  select id, code, label, scheme, sort_order
    from public.tags
   where is_active
   order by sort_order, code
`;

/**
 * Public profile fields, for accounts with something public attached.
 *
 * Not every profile. A person with an account and no contributions has published nothing,
 * and copying their display name into a file that is committed to a public repository — and
 * so into its history, forever — would publish something on their behalf. The set here is
 * exactly the set already visible in the corpus.
 *
 * Erasure removes an account from every future export; it cannot remove it from a commit
 * somebody already has. data/README.md says so in as many words, because a privacy notice
 * that overstates what erasure can do is worse than one that admits the limit.
 */
const PROFILES = `
  select
    f.id,
    f.display_name,
    f.is_pseudonym,
    f.bio,
    f.institution_name,
    f.institution_country,
    f.institution_verified_at,
    f.created_at
  from public.profiles f
  where exists (
          select 1 from public.reports p
           where p.author_id = f.id and p.status = 'published' and p.deleted_at is null)
     or exists (
          select 1 from public.debates q
           where q.author_id = f.id and q.status <> 'hidden')
     or exists (
          select 1 from public.comments c
           where c.author_id = f.id and c.status = 'published' and c.deleted_at is null)
     or exists (
          select 1 from public.network_entries r
           where r.submitter_id = f.id and r.status = 'published' and r.deleted_at is null)
  order by f.created_at
`;

/**
 * Discussion. Published comments on a parent that is itself public.
 *
 * The parent condition is what stops a thread outliving the thing it is about: hide a
 * report and its comments leave the export with it, without anything having to walk them.
 * It is the same clause as the read policy on public.comments, restated because the policy is
 * not consulted on this connection.
 *
 * Soft-deleted comments are included and are already empty: the trigger writes '' into the
 * body and null into the author in the same statement that sets deleted_at. The node has to
 * survive or the replies under it stop making sense.
 */
const COMMENTS = `
  select
    c.id,
    c.parent_type::text,
    c.parent_id,
    c.in_reply_to,
    c.body,
    c.created_at,
    c.updated_at,
    c.deleted_at,
    a.id                      as author_id,
    a.display_name            as author_display_name,
    a.is_pseudonym            as author_is_pseudonym,
    a.institution_name        as author_institution_name,
    a.institution_country     as author_institution_country,
    a.institution_verified_at as author_institution_verified_at
  from public.comments c
  left join public.profiles a on a.id = c.author_id
  where c.status = 'published'
    and (
      (c.parent_type = 'report' and exists (
         select 1 from public.reports p
          where p.id = c.parent_id and p.status = 'published' and p.deleted_at is null))
      or
      (c.parent_type = 'debate' and exists (
         select 1 from public.debates q
          where q.id = c.parent_id and q.status <> 'hidden'))
    )
  order by c.created_at
`;

/**
 * Published entries, newest first, with their submitter.
 *
 * link_status is in the export so the listing can show broken-link badges without a live
 * query. link_checked_at tells researchers how fresh that status is.
 */
const NETWORK = `
  select
    r.id,
    r.title,
    r.url,
    r.url_normalised,
    r.category::text,
    r.description,
    r.relevance,
    r.created_at,
    r.link_status::text,
    r.link_checked_at,
    a.id                      as submitter_id,
    a.display_name            as submitter_display_name,
    a.is_pseudonym            as submitter_is_pseudonym,
    a.institution_name        as submitter_institution_name,
    a.institution_country     as submitter_institution_country,
    a.institution_verified_at as submitter_institution_verified_at
  from public.network_entries r
  left join public.profiles a on a.id = r.submitter_id
  where r.status = 'published' and r.deleted_at is null
  order by r.created_at desc
`;

/**
 * The citation graph, restricted to arrows with both ends public.
 *
 * Both ends, and this is the one filter here that is about content rather than about
 * permissions: a citation carries a verbatim excerpt of its target. An arrow that outlived
 * its target being hidden would republish, in a third file, exactly the passage a moderator
 * removed.
 */
const CITATIONS = `
  select
    n.id,
    n.source_type::text,
    n.source_id,
    n.source_comment_id,
    n.target_type::text,
    n.target_id,
    n.target_comment_id,
    n.excerpt,
    n.context,
    n.created_at
  from public.citations n
  where (
      (n.source_type = 'report' and exists (
         select 1 from public.reports p
          where p.id = n.source_id and p.status = 'published' and p.deleted_at is null))
      or
      (n.source_type = 'debate' and exists (
         select 1 from public.debates q
          where q.id = n.source_id and q.status <> 'hidden'))
    )
    and (
      (n.target_type = 'report' and exists (
         select 1 from public.reports p
          where p.id = n.target_id and p.status = 'published' and p.deleted_at is null))
      or
      (n.target_type = 'debate' and exists (
         select 1 from public.debates q
          where q.id = n.target_id and q.status <> 'hidden'))
    )
  order by n.created_at
`;

// ══ Shaping ═══════════════════════════════════════════════════════════════════════════
// Snake case out of Postgres, camel case into the files, because the files deserialise into
// the interfaces in src/lib/. Dates are ISO strings: node-postgres hands back Date objects
// for timestamptz, and JSON.stringify would render them correctly but a `date` column comes
// back as a string already. to_char in the SQL above keeps used_on unambiguous.

const iso = (value) => (value instanceof Date ? value.toISOString() : (value ?? null));

function reportAuthor(row) {
  if (!row.author_id) return null;

  return {
    id: row.author_id,
    displayName: row.author_display_name,
    isPseudonym: row.author_is_pseudonym,
    institution:
      row.author_institution_name &&
      row.author_institution_country &&
      row.author_institution_verified_at
        ? {
            name: row.author_institution_name,
            country: row.author_institution_country,
            verifiedAt: iso(row.author_institution_verified_at),
          }
        : null,
  };
}

function toReport(row) {
  return {
    id: row.id,
    // Carried so an analysis can tell a report that answered a question from one that was
    // never asked it. Anything written before 2026-08-20 is version 1 and answers none of
    // the version 2 fields; nothing in the corpus is version 1 today, because the migration
    // that introduced version 2 deleted the three example reports that were.
    schemaVersion: row.schema_version,
    title: row.title,
    area: row.area,
    areaOther: row.area_other,
    taskType: row.task_type,
    taskSecondary: row.task_secondary ?? [],
    careerStage: row.career_stage,
    aim: row.aim,
    method: row.method,
    outcome: row.outcome,
    outcomeNotes: row.outcome_notes,
    verification: row.verification,
    prompts: row.prompts,
    transcriptExcerpt: row.transcript_excerpt,
    transcriptUrl: row.transcript_url,
    caveats: row.caveats,
    // jsonb comes back parsed. `label` is absent rather than null on a link that has none,
    // so it is normalised here — the site's type says `string | null`, and a key that is
    // sometimes missing and sometimes null is two shapes for one fact.
    references: (row.references ?? []).map((reference) => ({
      kind: reference.kind,
      url: reference.url,
      label: reference.label ?? null,
    })),
    timeSpentMinutes: row.time_spent_minutes,
    wasPublished: row.was_published,
    wasDisclosed: row.was_disclosed,
    authorConfidence: row.author_confidence,
    ratings: {
      rating_helpfulness: row.rating_helpfulness,
      rating_time_saved: row.rating_time_saved,
      rating_trust_before_checking: row.rating_trust_before_checking,
      rating_verification_effort: row.rating_verification_effort,
      rating_novelty: row.rating_novelty,
      rating_understanding_gained: row.rating_understanding_gained,
    },
    costMoreTimeThanSaved: row.cost_more_time_than_saved,
    generalises: row.generalises,
    createdAt: iso(row.created_at),
    author: reportAuthor(row),
    tools: (row.tools ?? []).map((tool) => ({
      name: tool.name,
      version: tool.version,
      usedOn: tool.usedOn,
      role: tool.role ?? null,
    })),
    tags: row.tags,
    staleness: {
      latestToolUse: row.latest_tool_use ?? null,
      latestVerdict: row.latest_verdict ?? null,
      latestConfirmationAt: iso(row.latest_confirmation_at),
      confirmationCount: Number(row.confirmation_count ?? 0),
      // A report with no staleness row cannot happen — the view produces one per report
      // — but an unverified open square is the honest default for "we do not know".
      tombstoneStatus: row.tombstone_status ?? 'unverified',
      isVerified: row.is_verified ?? false,
    },
  };
}

function toDebate(row) {
  return {
    id: row.id,
    statement: row.statement,
    rationale: row.rationale,
    status: row.status,
    area: row.area,
    createdAt: iso(row.created_at),
    activatedAt: iso(row.activated_at),
    author: row.author_id
      ? {
          id: row.author_id,
          displayName: row.author_display_name,
          isPseudonym: row.author_is_pseudonym,
        }
      : null,
  };
}

function toAggregate(row) {
  return {
    debateId: row.debate_id,
    histogram: row.histogram,
    median: row.median === null ? null : Number(row.median),
    totalRaters: Number(row.total_raters ?? 0),
    opinionCount: Number(row.opinion_count ?? 0),
    noOpinionCount: Number(row.no_opinion_count ?? 0),
    coverage: row.coverage === null ? null : Number(row.coverage),
  };
}

function toTag(row) {
  return { id: row.id, code: row.code, label: row.label, scheme: row.scheme, sortOrder: row.sort_order };
}

function toProfile(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    isPseudonym: row.is_pseudonym,
    bio: row.bio,
    institution:
      row.institution_name && row.institution_country && row.institution_verified_at
        ? {
            name: row.institution_name,
            country: row.institution_country,
            verifiedAt: iso(row.institution_verified_at),
          }
        : null,
    createdAt: iso(row.created_at),
  };
}

function toComment(row) {
  return {
    id: row.id,
    parentType: row.parent_type,
    parentId: row.parent_id,
    inReplyTo: row.in_reply_to,
    body: row.body,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at),
    author: row.author_id
      ? {
          id: row.author_id,
          displayName: row.author_display_name,
          isPseudonym: row.author_is_pseudonym,
          institution:
            row.author_institution_name &&
            row.author_institution_country &&
            row.author_institution_verified_at
              ? {
                  name: row.author_institution_name,
                  country: row.author_institution_country,
                  verifiedAt: iso(row.author_institution_verified_at),
                }
              : null,
        }
      : null,
  };
}

function toEntry(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    urlNormalised: row.url_normalised,
    category: row.category,
    description: row.description,
    relevance: row.relevance,
    createdAt: iso(row.created_at),
    linkStatus: row.link_status ?? null,
    linkCheckedAt: iso(row.link_checked_at),
    submitter: row.submitter_id
      ? {
          id: row.submitter_id,
          displayName: row.submitter_display_name,
          isPseudonym: row.submitter_is_pseudonym,
          institution:
            row.submitter_institution_name &&
            row.submitter_institution_country &&
            row.submitter_institution_verified_at
              ? {
                  name: row.submitter_institution_name,
                  country: row.submitter_institution_country,
                  verifiedAt: iso(row.submitter_institution_verified_at),
                }
              : null,
        }
      : null,
  };
}

function toCitation(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceCommentId: row.source_comment_id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetCommentId: row.target_comment_id,
    excerpt: row.excerpt,
    context: row.context,
    createdAt: iso(row.created_at),
  };
}

// ══ CSV ═══════════════════════════════════════════════════════════════════════════════
// The citable dataset. RFC 4180: everything quoted, quotes doubled, CRLF line endings —
// which is what the standard says and what stops Excel guessing wrong about a field
// containing a newline, and a transcript excerpt is full of them.
//
// Column names are the database's, not the site's. Somebody analysing this will have the
// migrations open beside it, and a CSV whose header says `taskType` where the schema says
// `task_type` costs them a rename in every script.

function csv(columns, rows) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return `"${value.toISOString()}"`;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    // A Postgres array, which node-postgres hands back as a JS array. Joined with a
    // semicolon rather than left to String(), which uses a comma — inside a quoted field
    // that is legal and still reads, to anybody scanning the file, as a column boundary
    // that got away. Only `task_secondary` reaches this, and its values are bare enum
    // labels with no separator of their own.
    if (Array.isArray(value)) return `"${value.join(';').replaceAll('"', '""')}"`;
    return `"${String(value).replaceAll('"', '""')}"`;
  };

  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));

  return lines.join('\r\n') + '\r\n';
}

const REPORT_CSV_COLUMNS = [
  'id',
  'schema_version',
  'title',
  'area',
  'area_other',
  'task_type',
  // The one repeated value that stays in this file rather than getting a file of its own.
  // It is capped at three and every value is a bare enum label with no separator in it, so
  // `proof_drafting;computation` is parseable without a decision; a tool name is not.
  'task_secondary',
  'career_stage',
  'aim',
  'method',
  'outcome',
  'outcome_notes',
  'verification',
  'prompts',
  'transcript_excerpt',
  'transcript_url',
  'caveats',
  'time_spent_minutes',
  'was_published',
  'was_disclosed',
  'author_confidence',
  'rating_helpfulness',
  'rating_time_saved',
  'cost_more_time_than_saved',
  'rating_trust_before_checking',
  'rating_verification_effort',
  'rating_novelty',
  'rating_understanding_gained',
  'generalises',
  'created_at',
  'author_id',
  'author_display_name',
  'author_is_pseudonym',
  'author_institution_name',
  'author_institution_country',
  'latest_tool_use',
  'latest_verdict',
  'confirmation_count',
  'tombstone_status',
  'is_verified',
];

// The rows go in as Postgres returned them: `cell()` already renders a Date as ISO, and the
// one-to-many parts are their own files rather than a comma-joined cell. A cell containing
// "Lean|ChatGPT" is a parsing problem handed to every person who opens this. `references` is
// absent from the columns above for the same reason and is `csv/report-references.csv`
// instead — a cell of JSON in a CSV is the worst of both formats.

// ══ Running ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    fail(
      'SUPABASE_DB_URL is not set, so there is nothing to export from.\n' +
        'In CI it is a repository secret. Locally, see the usage note: node scripts/export.mjs --help',
    );
  }

  const { default: pg } = await import('pg').catch(() => ({ default: null }));
  if (!pg) fail('The "pg" package is missing. Run: npm install');

  const client = new pg.Client({ connectionString: dbUrl });

  try {
    await client.connect();
  } catch (error) {
    fail(
      `Could not connect: ${error.message}` +
        (/self.signed|certificate/i.test(error.message)
          ? '\nThat looks like a TLS problem. Append ?sslmode=require to SUPABASE_DB_URL.'
          : ''),
    );
  }

  const started = Date.now();
  let datasets;

  try {
    // One transaction, read only, one snapshot. Without it a report published between the
    // first query and the last would appear in citations.json and be absent from
    // reports.json, and the site would build a reference to a page it never generated.
    await client.query('begin isolation level repeatable read, read only');

    const [reports, debates, aggregates, tags, profiles, comments, citations, entries] =
      await Promise.all([
        client.query(REPORTS),
        client.query(DEBATES),
        client.query(AGGREGATES),
        client.query(TAGS),
        client.query(PROFILES),
        client.query(COMMENTS),
        client.query(CITATIONS),
        client.query(NETWORK),
      ]);

    await client.query('commit');

    datasets = { reports, debates, aggregates, tags, profiles, comments, citations, entries };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    await client.end().catch(() => {});
    fail(`Query failed: ${error.message}`);
  }

  await client.end();

  // ── The files ───────────────────────────────────────────────────────────────────────

  const files = new Map();

  files.set('reports.json', datasets.reports.rows.map(toReport));
  files.set('debates.json', datasets.debates.rows.map(toDebate));
  files.set('debate-ratings.json', datasets.aggregates.rows.map(toAggregate));
  files.set('tags.json', datasets.tags.rows.map(toTag));
  files.set('profiles.json', datasets.profiles.rows.map(toProfile));
  files.set('comments.json', datasets.comments.rows.map(toComment));
  files.set('citations.json', datasets.citations.rows.map(toCitation));
  files.set('network.json', datasets.entries.rows.map(toEntry));

  assertNoAddressFields(files);

  const toolRows = [];
  const tagRows = [];
  const referenceRows = [];
  for (const row of datasets.reports.rows) {
    for (const tool of row.tools ?? []) {
      toolRows.push({
        report_id: row.id,
        tool_name: tool.name,
        tool_version: tool.version,
        used_on: tool.usedOn,
        role: tool.role ?? null,
      });
    }
    for (const tag of row.tags) {
      tagRows.push({ report_id: row.id, tag_code: tag.code, tag_label: tag.label });
    }
    // Its own file rather than a jsonb cell inside csv/reports.csv. A cell of JSON in a CSV
    // is the worst of both formats: too structured to read and too embedded to parse.
    for (const reference of row.references ?? []) {
      referenceRows.push({
        report_id: row.id,
        kind: reference.kind,
        url: reference.url,
        label: reference.label ?? null,
      });
    }
  }

  const NETWORK_CSV_COLUMNS = [
    'id',
    'title',
    'url',
    'url_normalised',
    'category',
    'description',
    'relevance',
    'created_at',
    'link_status',
    'link_checked_at',
    'submitter_id',
    'submitter_display_name',
    'submitter_is_pseudonym',
    'submitter_institution_name',
    'submitter_institution_country',
  ];

  const csvFiles = new Map([
    ['csv/reports.csv', csv(REPORT_CSV_COLUMNS, datasets.reports.rows)],
    [
      'csv/report-tools.csv',
      csv(['report_id', 'tool_name', 'tool_version', 'used_on', 'role'], toolRows),
    ],
    ['csv/report-tags.csv', csv(['report_id', 'tag_code', 'tag_label'], tagRows)],
    [
      'csv/report-references.csv',
      csv(['report_id', 'kind', 'url', 'label'], referenceRows),
    ],
    ['csv/network.csv', csv(NETWORK_CSV_COLUMNS, datasets.entries.rows)],
  ]);

  // ── The shrink guard ────────────────────────────────────────────────────────────────
  // The usual cause of an export losing most of the corpus is a broken query, not a mass
  // deletion, and the committed files are what the site serves. Refusing is recoverable;
  // committing an empty corpus over a full one is a bad hour.

  const previous = await readPreviousManifest(options.out);
  const before = previous?.files?.['reports.json']?.rows ?? 0;
  const after = files.get('reports.json').length;

  if (!options.allowShrink && before > 0 && after < before / 2) {
    fail(
      `Refusing to write: reports would go from ${before} to ${after}.\n` +
        'If that is genuinely right, re-run with --allow-shrink.',
    );
  }

  // ── Write ───────────────────────────────────────────────────────────────────────────

  const manifest = {
    // The site reads this to know what "since the last build" means. Every listing page
    // queries for rows newer than it and prepends what it finds.
    exportedAt: new Date().toISOString(),
    generator: 'scripts/export.mjs',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    files: {},
  };

  const serialised = new Map();

  for (const [name, rows] of files) {
    const body = JSON.stringify(rows, null, 2) + '\n';
    serialised.set(name, body);
    manifest.files[name] = { rows: rows.length, bytes: Buffer.byteLength(body) };
  }

  for (const [name, body] of csvFiles) {
    serialised.set(name, body);
    manifest.files[name] = {
      // A header line is not a row. Counting it would make the CSV and JSON counts disagree
      // by one for the same data, which is the kind of discrepancy that costs an afternoon.
      rows: body.trim() ? body.trim().split('\r\n').length - 1 : 0,
      bytes: Buffer.byteLength(body),
    };
  }

  report(manifest, Date.now() - started);

  if (options.dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const out = path.resolve(options.out);
  await mkdir(path.join(out, 'csv'), { recursive: true });

  // Stale files from a dataset that has been renamed or dropped would otherwise sit in the
  // directory forever, still being served by a build that no longer mentions them.
  await removeUnlisted(out, serialised);

  for (const [name, body] of serialised) {
    await writeFile(path.join(out, name), body, 'utf8');
  }

  await writeFile(
    path.join(out, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  console.log(`\nWritten to ${options.out}/`);
}

/**
 * A last check that nothing here is an address.
 *
 * Deliberately a check on **field names**, not on values. A transcript excerpt can legitimately
 * contain an address somebody pasted into a conversation and quoted here, and refusing the
 * whole export over one would be a guard that gets disabled the first time it fires. What
 * this catches is the realistic mistake: somebody adding `f.email` to a select list, or a
 * column growing into one of these queries because it was convenient.
 */
function assertNoAddressFields(files) {
  const suspect = /mail|address|username|login/i;
  const found = [];

  const walk = (value, trail) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      // One element is enough: every row in a file has the same shape.
      if (value.length) walk(value[0], trail);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (suspect.test(key)) found.push(`${trail}.${key}`);
      walk(nested, `${trail}.${key}`);
    }
  };

  for (const [name, rows] of files) walk(rows, name);

  if (found.length) {
    fail(
      'Refusing to write: a field looks like a contact detail.\n  ' +
        found.join('\n  ') +
        '\nNothing in the exposed schema holds an address. If this is a false positive, the ' +
        'field wants renaming rather than the check relaxing.',
    );
  }
}

async function readPreviousManifest(dir) {
  const file = path.join(path.resolve(dir), 'manifest.json');
  if (!existsSync(file)) return null;

  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function removeUnlisted(out, serialised) {
  const keep = new Set([...serialised.keys(), 'manifest.json', 'README.md', '.gitkeep']);

  for (const entry of await readdir(out, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'csv') continue;
      for (const nested of await readdir(path.join(out, 'csv'))) {
        if (!keep.has(`csv/${nested}`)) await rm(path.join(out, 'csv', nested));
      }
      continue;
    }
    if (!keep.has(entry.name)) await rm(path.join(out, entry.name));
  }
}

function report(manifest, ms) {
  const names = Object.keys(manifest.files);
  const width = Math.max(...names.map((name) => name.length));
  let total = 0;

  console.log(`Exported at ${manifest.exportedAt} in ${(ms / 1000).toFixed(1)}s\n`);

  for (const name of names) {
    const { rows, bytes } = manifest.files[name];
    total += bytes;
    console.log(
      `  ${name.padEnd(width)}  ${String(rows).padStart(6)} rows  ${humanBytes(bytes).padStart(9)}`,
    );
  }

  console.log(`  ${'total'.padEnd(width)}  ${' '.repeat(11)}  ${humanBytes(total).padStart(9)}`);
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fail(message) {
  console.error(`\nExport failed.\n\n${message}\n`);
  process.exit(1);
}

await main();
