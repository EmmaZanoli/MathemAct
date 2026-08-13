# MathemAct

## What this is

A platform for the mathematics research community to collect **structured, first-hand
accounts of how AI tools are actually used in mathematical work** — and to record where
the community agrees and disagrees about how they should be used.

Mission: *collectively shaping the future of mathematical research in the age of AI.*

## Positioning (read this before making product judgement calls)

The Leiden Declaration on AI and Mathematics (June 2026, endorsed by the International
Mathematical Union) supplies the **principles**. It asks mathematicians to include a
"Tool and computational resource disclosure" section in their papers, while noting the
form of such a section will evolve.

MathemAct is the **practice layer** underneath those principles. It is not a general
forum about AI. Its job is to accumulate a corpus concrete and well-structured enough
that journals could adopt the posting schema as a disclosure template.

Consequences for design decisions:

- **Structure beats expressiveness.** Every field that constrains what an author writes
  is a feature, not friction. We are building a reporting standard, closer to CONSORT or
  PRISMA than to a message board.
- **Failures are first-class content.** A corpus of only successes is worthless and reads
  as advertising. Never design UI that makes reporting a failure feel like a lesser
  contribution.
- **The corpus must be machine-readable and downloadable.** Researchers studying AI
  adoption in mathematics are a target audience. Export completeness is a product feature.

## Audience

Professional mathematicians, skewed European, mostly senior, extremely
sceptical, and unusually sensitive to typographic and mathematical sloppiness. Many do
not have and will not create a GitHub account. Some will only contribute pseudonymously
because admitting heavy AI reliance carries professional stigma.

The single most important flow is: **a researcher submits a well-structured account in
under ten minutes.**

## Hard constraints — do not violate these

1. **Zero budget.** Every service used must be free with no credit card. If a task seems
   to require a paid service, stop and say so rather than picking one.
2. **Static hosting.** The site is built to static files and served by GitHub Pages.
   There is no application server. All dynamic behaviour is either build-time or
   client-side calls to Supabase.
3. **No secrets in the client or in the repo.** The Supabase project URL and the
   anon/publishable key are designed to be public and may be committed. The
   `service_role` key and the database connection string are GitHub Actions secrets only,
   used exclusively by workflows. Never reference them in site code.
4. **Verification happens server-side.** See "Identity" below. Any path by which a user
   could set their own affiliation is a critical bug.
5. **Keep logic in Postgres.** Constraints, triggers, RLS, plain SQL. These are portable
   to any Postgres host. Avoid Supabase Edge Functions unless something genuinely needs
   to make an outbound network call at request time.
6. **No Google Fonts CDN, no third-party analytics, no external trackers.** Self-host
   font files. EU users, GDPR, and an audience that will check.

## Stack

| Layer | Choice |
|---|---|
| Site generator | Astro, static output |
| Hosting | GitHub Pages via GitHub Actions |
| Database + auth | Supabase free tier, **EU region (Frankfurt or Ireland)** |
| Auth method | Email + password with mandatory email confirmation, custom SMTP |
| Bot defence | Cloudflare Turnstile on signup |
| Math rendering | KaTeX, rendered at build time where possible |
| Full-text search | Pagefind, over built HTML |
| Institution data | ROR (Research Organization Registry), CC0 dump loaded into Postgres |
| Backups + export | Nightly GitHub Actions job dumping to JSON in-repo |
| DOI | Zenodo GitHub release integration (later phase) |

### Why Supabase and what that implies

Chosen for portability, not for the free tier. It is real Postgres, so the exit is a
`pg_dump` to any other Postgres host, and it is open source, so the worst case is
self-hosting the same components. Do not write anything that would make that exit
expensive.

Free tier facts that shape the architecture: 500 MB database, 5 GB egress, no backups,
no SLA, and projects pause after about a week of inactivity.

### Read/write split — the core architectural rule

**Reads are served statically. The database handles writes and auth only.**

A nightly workflow exports published content and rating aggregates to JSON committed to
the repo; the site builds from those files. Browsers only talk to Supabase when someone
logs in, submits, comments, votes, or confirms a practice.

This is what makes a free tier viable in production: a traffic spike never touches the
egress quota, reading still works if the database is paused or over quota, the nightly
export doubles as the backup and the citable dataset, and the export job's own activity
prevents the inactivity pause.

**Freshness overlay:** because static data is up to a day stale, listing pages hydrate
from static JSON, then make one background query to Supabase for rows created after the
build timestamp and prepend them. Build timestamp is emitted into the JSON at export
time. When the database is unreachable, the overlay fails silently and the static content
stands.

## Identity and badges

Three independent signals. Institutional and ORCID stack on top of Registered.

| Tier | Basis | Displayed as |
|---|---|---|
| Registered | Confirmed email, any domain | Display name only |
| Institutional | Confirmed email domain matched to a ROR record | Institution name, country, verification month |
| ORCID-linked | Submitted iD resolved against the ORCID public API | ORCID icon linking out |

Rules that are not negotiable:

- Affiliation is derived from the **confirmed** email address by a `SECURITY DEFINER`
  trigger, never from user input. `profiles` columns holding affiliation, verification
  timestamps, role, and ban status are protected by a `BEFORE UPDATE` trigger that
  reverts any user attempt to change them.
- **Never display or expose the email address itself**, not in the API response, not in
  the export, not to admins in the UI.
- Domain matching uses ROR domains with **longest-suffix** matching, so
  `maths.ox.ac.uk` resolves to Oxford. TLD heuristics like `.edu` or `.ac.uk` are
  forbidden — they fail on `ens.fr`, `inria.fr`, `mis.mpg.de`, `sissa.it`, `weizmann.ac.il`,
  which are exactly our users.
- Badges state only what was verified: "Institutional email verified — Universität Bonn
  (Aug 2026)". Never imply faculty status, seniority, or current employment.
  Verification date is always visible; prompt re-verification annually.
- Pseudonymous display names are allowed at every tier. An institutionally verified user
  may show the badge with a pseudonym.

## Content model, in brief

**Practice** — a first-hand account. Required fields, in this order:

1. Title (one line, imperative where possible)
2. Area — research / learning / teaching / writing / other
3. Task type — literature search, conjecture generation, proof drafting, proof checking,
   formalisation, computation, exposition, translation, referee work, other
4. Tools used — name, version, date of use
5. What I was trying to do (hard character cap)
6. What I actually did — stepwise
7. Outcome — worked / partially worked / did not work, plus short prose
8. **How I verified correctness** — required, no exceptions. This field is what makes the
   corpus mathematically serious rather than anecdotal.
9. Transcript excerpt (primary) and optional link (supplementary)
10. Caveats and what I would do differently
11. Tags — MSC / arXiv categories, used for filtering
12. Structured metadata — time spent, whether the output was published, whether the AI
    use was disclosed in the paper, author's confidence in the result

**Transcripts:** the pasted excerpt is the canonical artifact and is stored in our
database. Share links expire, get revoked, and may breach provider terms, so they are
never the only record. The submission form must require an explicit confirmation that
third-party unpublished material has been removed.

**Staleness:** model, version, and date of use are mandatory, and every practice carries
a lightweight "still works / no longer works" confirmation any logged-in user can add.
Listings sort by recency by default. A practice written against a 2025 model is
misleading by 2026 and the UI must make that visible.

**Proposition** — a single well-formed claim that can be agreed with, e.g. "AI-assisted
literature search should be disclosed in papers." Ratings attach to propositions, never
to discussions or practices.

## The agreement scale

An 11-point integer scale, 0 to 10.

- Anchors are always labelled: 0 = strongly disagree, 5 = neutral, 10 = strongly agree.
  An unlabelled 0–10 reads as intensity, and people interpret 0 as "no opinion".
- There is an explicit **"no opinion / outside my expertise"** option, stored as a NULL
  score on a real row, off the scale. Without it, a mathematician who has never used Lean
  will pick 5 on a formalisation question and quietly corrupt every aggregate. Report
  coverage — how many raters expressed an opinion — as its own number.
- Display the **median and the full histogram**. The mean of an 11-point bipolar scale is
  misleading when the distribution is bimodal, and bimodal is exactly what to expect on
  the contested propositions.
- **Do not reveal the aggregate to a user until they have rated**, to limit bandwagon
  effects. This community's minority position is frequently the correct one.
- One rating per user per proposition, enforced by a unique constraint. Ratings are
  editable; keep the current value only, no history needed.

## Governance, legal, deletion

- Content licence: **CC BY 4.0**, stated on every practice page and in the export.
- Soft-delete only. Deleting a practice or comment strips author attribution and hides
  the body but preserves thread structure so surrounding discussion does not collapse.
- Account erasure must actually work: a documented flow that removes profile data and
  detaches authored content. This is a genuine advantage of the database over a
  git-based store, and part of why we chose it.
- Moderation is volunteer-run. Every user-visible content table needs a
  `status` column (`pending` / `published` / `hidden`) and there is a `reports` table.
  Nothing ships to real users without a working hide path.

## Design direction

The audience will judge this typographically. Execute precisely; the direction is
restrained with one signature.

- **Ground:** cool paper `#EDF0F2`. **Ink:** `#0F1519`. **Rules and borders:** `#C9D2D8`.
- **Accent:** chalk blue `#1D4E6F`, used for links, focus rings, and the histogram.
- **Outcome semantics:** worked `#2E6B4F`, partially `#8A6A1F`, did not work `#8A3A34`.
  These three colours appear nowhere else.
- **Type:** IBM Plex Serif for display and headings, IBM Plex Sans for body, IBM Plex
  Mono for all metadata — model names, versions, dates, scores, tags. The Mono/Sans/Serif
  split is doing real work: monospace marks anything a machine could parse. Self-host
  woff2 subsets.
- **Signature element:** the QED tombstone. A filled square `■` marks a practice whose
  correctness verification is recorded and confirmed still-working; an open square `□`
  marks one that is unverified, stale, or reported as no longer working. It is the
  status system, the list bullet, and the section divider. It encodes something true
  rather than decorating.
- Do not use: cream backgrounds with terracotta accents, near-black with acid green,
  hairline-rule broadsheet pastiche, numbered `01 / 02 / 03` markers where the content is
  not a sequence, or gradient hero panels.
- Quality floor, unannounced: responsive to mobile, visible keyboard focus, `prefers-reduced-motion`
  respected, semantic landmarks, form labels bound to inputs, colour never the sole carrier
  of meaning (pair every outcome colour with the tombstone glyph or text).

## Copy conventions

Active voice, sentence case, plain verbs. A button says what happens: "Publish" produces
"Published". Errors say what went wrong and how to fix it, and never apologise. Empty
states are invitations to act, not mood pieces. Never call the fields "metadata" in
user-facing text.

## Repo layout

```
/                       Astro project root
  src/pages/            routes
  src/components/       UI components
  src/layouts/
  src/lib/              supabase client, formatting, validation shared with forms
  src/styles/tokens.css design tokens, single source of truth
  public/fonts/         self-hosted woff2
  data/                 committed JSON export the site builds from
  supabase/migrations/  numbered SQL migrations, applied in order
  supabase/tests/       pgTAP tests, RLS especially
  scripts/              one-off and scheduled Node/Python scripts
  .github/workflows/    deploy, nightly export, embeddings
  docs/                 governance, code of conduct, decisions log
```

## Working conventions

- **Migrations are append-only.** Never edit an applied migration; add a new one.
- Every migration file starts with a comment saying what it does and why.
- TypeScript throughout the site. Shared validation logic lives in `src/lib/` and is used
  by both the form and, where feasible, mirrored as a Postgres `CHECK`. Client validation
  is convenience; the database constraint is the truth.
- Do not install a UI component library or Tailwind. Plain CSS with the tokens in
  `src/styles/tokens.css`. The design is small and specific enough that a framework costs
  more than it saves.
- After each task: run the build, fix warnings, then commit with a message describing the
  change. Do not commit `.env`.
- Keep `docs/decisions.md` updated with one short entry per non-obvious choice.

## Things that will go wrong, so anticipate them

- GitHub Pages serves at `/<repo>/` unless a custom domain is configured. Astro needs
  `base` set correctly and every internal link must respect it. Getting this wrong breaks
  every link only after deploy, not locally.
- GitHub Pages has no SPA fallback. Generate real pages, plus a `404.html`.
- Supabase's built-in email sender is rate-limited to a handful per hour and will fail
  the moment a group of testers signs up. Custom SMTP must be configured before any user
  testing.
- RLS defaults to permissive if you forget to enable it on a table. Every new table gets
  `ENABLE ROW LEVEL SECURITY` in the same migration that creates it, without exception.