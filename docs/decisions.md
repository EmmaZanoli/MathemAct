# Decisions

One entry per non-obvious choice: what was decided, and the reasoning that would otherwise
have to be reconstructed. Append; do not rewrite history. If a decision is reversed, add a
new entry saying so and leave the old one standing.

---

## 2026-08-13 — Astro as the site generator

Static output is a hard requirement (GitHub Pages, no application server), and the site is
overwhelmingly content: practice pages, proposition pages, listings. Astro ships zero
JavaScript by default and lets the few genuinely interactive parts — the submission form,
the rating widget, the auth flow — opt in individually.

That default matters for this audience specifically. Pages are read on institutional
networks and old hardware, and a corpus meant to be citable for years should not depend on
a client-side framework to render its own text.

Rejected: Next.js and SvelteKit, whose static export modes are a supported side path
rather than the primary one. Rejected: a bare static site generator with no component
model, because the practice page is a dense, repeated, structured layout and building it
from string templates would not survive contact with a dozen field types.

## 2026-08-13 — Reads are static; the database serves writes and auth only

A nightly job exports published content and rating aggregates to JSON committed to
`data/`, and the site builds from those files. Browsers reach Supabase only to log in,
submit, comment, rate, or confirm a practice.

This is what makes the free tier viable in production rather than merely cheap:

- A traffic spike — the realistic scenario being a link circulating on a mailing list —
  never touches the 5 GB egress quota, because reads never reach the database.
- Reading still works when the database is paused, over quota, or down. The site degrades
  to read-only instead of to a blank page.
- The export doubles as the backup the free tier does not provide, *and* as the citable
  machine-readable dataset the project owes its researcher audience. One job, three jobs
  done.
- The job's own nightly activity prevents the free tier's ~1 week inactivity pause.

Cost: content is up to a day stale. Mitigated by a freshness overlay — listing pages
render from static JSON, then make one background query for rows newer than the build
timestamp and prepend them. When the database is unreachable the overlay fails silently
and the static content stands, which is the correct failure mode.

## 2026-08-13 — Supabase, chosen for the exit and not for the free tier

Supabase is real Postgres and is open source. The exit is therefore `pg_dump` to any other
Postgres host, and the worst case is self-hosting the same components. No proprietary
query language, no proprietary schema format, no data model that only makes sense inside
one vendor.

The corollary is a standing constraint, not just a preference: **keep logic in Postgres.**
Constraints, triggers, RLS policies, plain SQL. Anything expressed in a vendor-specific
layer — Edge Functions in particular — makes that exit more expensive and should be
avoided unless something genuinely needs an outbound network call at request time.

The free tier's limits (500 MB database, 5 GB egress, no backups, no SLA, pause after
inactivity) shaped the read/write split above rather than the choice of vendor.

## 2026-08-13 — EU region, and why it is load-bearing

The project's users are professional mathematicians, skewed European, working at
institutions with data protection offices that read privacy notices. Personal data
processed here — email addresses, which are additionally never displayed or exported —
stays in the EU, so the privacy notice can say so without qualification and no transfer
mechanism has to be argued for.

Two operational consequences worth writing down:

1. **The region is irreversible.** Changing it means creating a new project and migrating.
   Treat the project ref as fixed.
2. It constrains every future service choice, not just this one. A processor that cannot
   keep EU data in the EU is disqualified regardless of price, because the whole point is
   a privacy notice this audience will accept at face value.

Processors to disclose: Supabase (database, auth), Brevo (transactional email), Cloudflare
(Turnstile), GitHub (hosting).

## 2026-08-13 — The Supabase GitHub integration is not used

Migrations are plain SQL in `supabase/migrations/`, applied by the Supabase CLI from
`.github/workflows/migrate.yml`.

The integration's headline feature is database branching, which is billed per branch-hour
and therefore violates the zero-budget constraint outright. Beyond cost, it would couple
the migration flow to a vendor feature for no gain: the CLI applying numbered SQL files is
already the portable path, and it is the same command a developer runs locally, so there
is one mechanism to understand instead of two.

The workflow connects with `supabase db push --db-url "$SUPABASE_DB_URL"` rather than
linking a project on disk, so the CLI's local state in `supabase/.temp/` never needs to be
committed. That directory was tracked by an earlier commit and is now ignored.

## 2026-08-13 — Served at emmazanoli.github.io/MathemAct/, no custom domain

Decided with Emma: the default GitHub Pages project-site URL, not a custom domain. A
domain costs money and the budget is zero.

The cost of this decision is a `/MathemAct` path prefix on every internal URL. It is
contained in two places:

- `base: '/MathemAct'` in [astro.config.mjs](../astro.config.mjs).
- `path()` and `asset()` in [src/lib/paths.ts](../src/lib/paths.ts), which every internal
  link and asset reference goes through. Hardcoded absolute paths are a bug.

Reversal is cheap **because** of that containment: set `site` to the new domain, set `base`
to `'/'`, add `public/CNAME`, configure DNS. Every link built through `path()` keeps
working with no template changes. Should MathemAct acquire institutional backing and a
domain, this is a one-commit change — which is the reason for the indirection.

Related: `trailingSlash: 'always'` with directory-format output, so GitHub Pages serves
`index.html` directly instead of issuing a 301 to add the slash. `path()` enforces the
trailing slash so it cannot be forgotten in a template; `asset()` deliberately does not,
because a trailing slash on a filename names a different, non-existent resource.

## 2026-08-13 — GitHub Actions pinned to commit SHAs

Every third-party action is pinned to a full commit SHA with the version in a trailing
comment. A tag is a mutable pointer: whoever controls the action's repository can move
`v5` to different code, and that code would run with this repository's `pages: write`
permission and, in the migration workflow, with a connection string to the live database.
A SHA cannot be moved.

The cost is that updates are manual and visible in review, which for a workflow that can
write to the production database is the right trade.

## 2026-08-13 — The three public keys are Actions variables, not secrets

`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `PUBLIC_TURNSTILE_SITE_KEY` are
stored as repository **variables**. Astro inlines any `PUBLIC_`-prefixed value into the
built JavaScript, so all three are readable by anyone viewing source on the deployed site.
Storing them as secrets would not hide them from anyone; it would only mask them in our
own CI logs and, worse, imply that leaking one is an incident. It is not. The anon key
identifies the anonymous *role*, and row level security is what decides what that role can
do.

This split also makes the genuine secrets easier to police: anything in the secrets list is
something whose exposure *is* an incident.

## 2026-08-13 — The migration workflow warns rather than fails when secrets are absent

`migrate.yml` checks whether `SUPABASE_DB_URL` and `SUPABASE_ACCESS_TOKEN` are set and, if
not, emits a GitHub warning annotation and skips the push instead of erroring.

The reason is that the alternative failure mode is worse than it looks. A red X on a
workflow that was never configured trains the maintainer to ignore red X marks, which is
how a real migration failure gets missed. The check is loud in the run summary, so the
unconfigured state is visible without being indistinguishable from a broken migration.

The credential test compares each secret to the empty string inside an expression, which
yields a plain boolean and exposes nothing; the secret values are injected only into the
step that runs `db push`.

## 2026-08-13 — `compressHTML: false`

Astro's HTML compressor does not collapse whitespace between a text node and an adjacent
inline element — it deletes it. A paragraph wrapped like this:

```
  ... exported nightly as JSON and licensed
  <a href="...">CC BY 4.0</a>, so it can be analysed
```

ships as "licensedCC BY 4.0". The bug is invisible in the source, survives review, and is
caught only by looking at the rendered page. It occurred three times in the first two days
of this project.

Keeping the source correct by hand is not a fix, because the editor's formatter re-wraps
long lines on save and reintroduces it — that is how two of the three occurrences got
there. Turning the compressor off removes the failure mode entirely. The output is a few
hundred bytes larger before compression and near-identical after gzip, which is a trade
worth making for an audience that reads a missing space as carelessness.

## 2026-08-13 — The font stylesheet lives in `public/`, not `src/styles/`

CSS cannot call `path()`, and the site is served under a `/MathemAct` prefix, so
`url('/MathemAct/fonts/…')` inside a stylesheet would hardcode exactly what
[src/lib/paths.ts](../src/lib/paths.ts) exists to keep in one place.

Putting `fonts.css` next to the woff2 files instead means every `src` is a bare filename
resolved against the stylesheet's own URL. That is correct under any base and survives a
move to a custom domain untouched. The cost is one extra stylesheet request rather than
being bundled, offset by preloading the two faces that appear on every page. The file
never changes, so it also caches independently of the page CSS.

Fourteen files: seven faces, each as a latin and a latin-ext subset, with real
`unicode-range` values so latin-ext is fetched only when a page contains a character in
it. That is not a rounding error on this site — Erdős, Poincaré, Ważewski, and Lindelöf
all live in latin-ext.

## 2026-08-13 — Markdown is sanitised *before* KaTeX renders, not after

The pipeline is: parse → GFM → find math → to HTML → **sanitise** → render TeX →
serialise.

Sanitising after KaTeX would mean allowlisting KaTeX's output — dozens of layout classes
on nested spans plus a parallel MathML tree — which in practice means allowing arbitrary
spans and classes and giving up most of what the sanitiser was for. Sanitising first is
also sufficient: by the time KaTeX runs, all that survives of a formula is its TeX source
as a text node, and KaTeX escapes what it renders.

Three defences, deliberately independent:

1. `remark-rehype` is called without `allowDangerousHtml`, so raw HTML is discarded before
   the sanitiser sees it.
2. `rehype-sanitize` runs on the untrusted input, with the default schema extended in
   exactly one respect: `math-inline` and `math-display` are allowed as class *values* on
   span and div, because `rehype-katex` finds formulas by that class and the default schema
   would otherwise strip it — leaving every formula on the site rendered as raw TeX.
3. KaTeX runs with `trust: false`, which rejects `\href`, `\url`, `\includegraphics`, and
   `\htmlClass`.

Verified against a page of hostile input before shipping: `<script>`, `<iframe>`,
`onerror=`, `onclick=`, a `javascript:` link, and a `data:text/html` href were all removed,
and no attribute in the output contains a dangerous URL.

Note there is no `throwOnError` option: `rehype-katex` omits it deliberately and always
catches parse errors itself, rendering the offending source in a `.katex-error` span. That
is the behaviour user-submitted TeX needs — one malformed formula must not fail the build.

## 2026-08-13 — Outcome colours go on the tombstone glyph, never on the label

`--outcome-partial` (`#8A6A1F`) measures 4.41:1 against the ground, just under the 4.5:1
AA floor for body text. The other two clear it (worked 5.5:1, failed 6.7:1).

Rather than alter a colour CLAUDE.md specifies, the rule is uniform: the outcome colour
sets the square, and the text label stays in ink. As a graphic the square only needs 3:1,
which all three clear comfortably. More importantly this is the correct ordering anyway —
colour must never be the sole carrier of meaning, so the words should be the primary
signal and the colour a secondary cue. Applying it uniformly is also less shouty than
coloured labels, which suits the audience.

## 2026-08-13 — Cascade layers for the global stylesheet

`base.css` declares `@layer reset, base, layout` and wraps every reset selector in
`:where()`, so those rules carry zero specificity. Astro's scoped component styles are
unlayered, and unlayered styles beat layered ones regardless of specificity, so a
component always wins against a global default without needing a longer selector or
`!important`.

The practical effect is that nobody has to know `base.css` exists in order to style a
component correctly, which is the only reliable way to keep specificity fights from
accumulating.

One consequence worth knowing, learned the hard way: Astro's scoping attribute is *not*
applied to a child component's root element. Passing `class="example"` to a component and
styling `.example` in the parent compiles to a selector that matches nothing. Wrap the
component in an element belonging to the parent file instead.

## 2026-08-14 — The affiliation trigger is SECURITY DEFINER; the guard that protects it is not

`private.protect_profile_columns()` reverts every system-owned column on
`public.profiles`. It is deliberately **SECURITY INVOKER**, and that is the single most
important line in the identity migrations.

Inside a `SECURITY DEFINER` function, `current_user` is the function's *owner*, not the
caller. The guard decides whether to revert by asking who is running the statement. Had it
been DEFINER, that question would have returned the owner on every call — including calls
made by a browser — so it would have concluded that every caller was trusted, reverted
nothing, and read in review as though it worked. A guard that protects nothing while
appearing to is worse than no guard, because it stops anyone looking again.

As INVOKER, `current_user` is `authenticated` for a browser and the table owner when the
badge trigger (which *is* DEFINER, because it must read the private schema) performs its
update. That is exactly the distinction needed.

The trusted set is computed from the table's real owner via `pg_has_role` rather than a
hardcoded role name, so it stays correct if migrations are ever applied as a different
role, and it fails safe: an unanticipated role is guarded rather than trusted.

## 2026-08-14 — Protection is doubled: column grants and a trigger

`UPDATE` on `public.profiles` is granted per column, so an attempt to write `role` is
rejected by Postgres before any trigger runs. The trigger then reverts the same columns
anyway.

Either alone would hold today. The trigger exists for the day someone adds a feature,
finds the column list in the way, and writes `grant update on public.profiles to
authenticated`. The pgTAP suite tests exactly that scenario — it widens the grant itself
and asserts the badge still cannot be forged.

Institution columns are reverted for admins too. An admin override would make "verified"
mean "verified, or an admin said so", which is not a claim this project can make.

## 2026-08-14 — The badge is re-derived when a confirmed address changes

The brief asked only for the null → non-null transition on `email_confirmed_at`. That
alone leaves a hole: confirm at a university, collect the badge, move the account to a
personal address, keep the institution forever. The trigger therefore also fires when a
confirmed address changes, and a failed match *clears* the columns rather than leaving
them. Failing open there would have been the whole vulnerability.

## 2026-08-14 — The institution is a snapshot, and has no foreign key

`institution_name` and `institution_country` are copied onto the profile when the badge is
issued and never refreshed. A badge claims "this address was confirmed at this institution
on this date"; rewriting it because ROR later renamed a record would make the claim untrue.

For the same reason there is no foreign key to `private.ror_institutions`. CI reloads that
table wholesale, and a routine data refresh must not be able to fail, cascade, or mutate
anyone's profile.

## 2026-08-14 — Candidate suffixes are enumerated, not matched with LIKE

`private.match_institution()` builds the list of suffixes of a domain and compares each
with equality. The obvious alternative, `where $1 like '%.' || domain`, cannot use an index
because of the leading wildcard, and this runs on a table of every domain in ROR.

The bare TLD is never a candidate. A single-label ROR domain would be a data error, and
treating one as a match would hand a badge to an entire country.

## 2026-08-14 — Database tests run in CI, because they cannot run here

WSL is blocked by group policy on the development machine — `wsl` fails with
`0x80070569`, "the user has not been granted the requested logon type at this computer" —
so Rancher Desktop cannot start, there is no container runtime, and `supabase start` is
impossible locally.

`.github/workflows/test-db.yml` stands up the full local stack on a runner and runs the
pgTAP suite there. The full stack rather than a bare Postgres, because the `auth` schema,
`auth.users`, and the `anon` and `authenticated` roles are created by the auth service and
every test depends on at least one of them.

This is the better home for it regardless: it now gates every future change instead of
depending on someone remembering to run it. It runs on branches and pull requests, and
`migrate.yml` only runs on `main`, so the tests are a gate in front of production rather
than a report after the fact.

## 2026-08-14 — What the Security Advisor flags, and why it is accepted

Checked from `migrate.yml` against the Management API rather than by eye in the dashboard,
so the answer is in the run log. **Zero error-level findings.** Five in total:

- **3 × `rls_enabled_no_policy` (INFO)** on the three `private` tables. This is the intended
  design, not a gap: RLS enabled with no policies is deny-all, and the tables are reachable
  only by the table owner and by `SECURITY DEFINER` functions owned by it. Adding a policy
  would weaken it.
- **2 × `*_security_definer_function_executable` (WARN)** on `public.rls_auto_enable`. Not
  ours. It is created by Supabase's "Automatic RLS: ON" project setting, and it returns
  `event_trigger`, so Postgres refuses to invoke it directly whoever holds EXECUTE. Left
  alone deliberately: it is a platform-managed object, and revoking on it risks breaking a
  feature we chose to have, to silence a warning that is not exploitable.

Because a clean advisor run says nothing about our own objects specifically, `migrate.yml`
also asserts the invariant we actually control: no function in the `private` schema grants
EXECUTE to `anon` or `authenticated`. Postgres grants EXECUTE to PUBLIC on every new
function by default, so that is always one forgotten `REVOKE` away from being false.

## 2026-08-14 — The ROR loader reconciles; it does not only upsert

`scripts/load-ror.mjs` stages the whole dump, upserts, then **deletes rows the dump no
longer contains**, in one transaction. A pure upsert is idempotent but not correct over
time: when ROR withdraws a record or drops a domain, a stale row would sit here forever,
still handing out badges for a domain the institution no longer claims.

It refuses a load that would more than halve the table, because that is what happens when
someone points it at a filtered or truncated file, and the failure would otherwise be a
quiet mass deletion. `--allow-shrink` overrides it.

It streams rather than reading the file. The v2.11 dump is 291 MB for 135,710 records, and
`JSON.parse` on that wants roughly 2 GB of heap and dies with an allocation failure rather
than a message.

Full detail, including the licence and the refresh cadence, is in [ror.md](ror.md).

## 2026-08-14 — Only 23% of ROR records carry a domain, and we do not paper over it

101,926 of 135,710 records in v2.11 have an empty `domains` array. Among them: the Max
Planck Society, the MPI for Mathematics in the Sciences, the MPI for Mathematics in Bonn,
Oberwolfach, Institut Mittag-Leffler, and Leiden University. None of those can receive an
institutional badge as things stand.

The tempting fix — fall back to the `links` website field — is rejected. Leiden's recorded
website is `leiden.edu`, while its mathematicians write from `@leidenuniv.nl` and
`@universiteitleiden.nl`. Deriving a match domain from a marketing URL produces badges
that are *wrong* rather than merely absent, and this project survives a missing badge far
better than a false one.

[ror.md](ror.md) sets out the three honest options: contribute the domains upstream to
ROR, maintain a small curated supplement in its own table with provenance per row, or
accept the gap. None is chosen yet, because choosing the second means becoming the
authority for those rows, and that is a governance decision rather than a technical one.
