# Decisions

One entry per non-obvious choice: what was decided, and the reasoning that would otherwise
have to be reconstructed. Append; do not rewrite history. If a decision is reversed, add a
new entry saying so and leave the old one standing.

---

## 2026-08-13 — Astro as the site generator

Static output is a hard requirement (GitHub Pages, no application server), and the site is
overwhelmingly content: report pages, debate pages, listings. Astro ships zero
JavaScript by default and lets the few genuinely interactive parts — the submission form,
the rating widget, the auth flow — opt in individually.

That default matters for this audience specifically. Pages are read on institutional
networks and old hardware, and a corpus meant to be citable for years should not depend on
a client-side framework to render its own text.

Rejected: Next.js and SvelteKit, whose static export modes are a supported side path
rather than the primary one. Rejected: a bare static site generator with no component
model, because the report page is a dense, repeated, structured layout and building it
from string templates would not survive contact with a dozen field types.

## 2026-08-13 — Reads are static; the database serves writes and auth only

A nightly job exports published content and rating aggregates to JSON committed to
`data/`, and the site builds from those files. Browsers reach Supabase only to log in,
submit, comment, rate, or confirm a report.

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

**Superseded the same day — see the next entry. The reasoning above is wrong.**

## 2026-08-14 — Three domain layers, and the correction to the entry above

Measured rather than assumed, the previous entry does not hold. A vanity domain nobody
sends mail from produces a **useless** derived entry, not a harmful one: the badge is
absent either way. The genuinely dangerous outcome is a derived host that another record
has already curated, and that is precisely detectable.

Against ROR v2.11, deriving a domain from each record's website and accepting it only when
the host is claimed by exactly one record in the whole dump refuses 752 already-curated
hosts, 3,196 shared by two or more records, 9 public suffixes, and 49 parents of three or
more curated domains — and accepts 85,860. The headline number that forced this: only
**41.1%** of active European `education` records carry a domain, so ROR's curated field
alone leaves most European universities unreachable.

A domain now comes from one of three layers, and `profiles.institution_source` records
which one issued each badge:

| | |
|---|---|
| `manual` | `private.manual_domains`, added by a human with written evidence |
| `ror_domain` | ROR's curated `domains` field |
| `ror_website` | derived by the loader, unique hosts only |

**Longest suffix wins first; source only breaks ties at equal length.** Specificity is a
question of correctness — `mis.mpg.de` names a different institution than `mpg.de` — while
authority is a question of trust, and correctness comes first. The block list still
overrides everything, including a mistaken manual entry.

The parent-of-many guard is the one worth keeping. Without it the loader was about to map
`min-saude.pt`, the Portuguese health ministry, to a single hospital whose website is a
page on it, and `europa.eu` to the European Council. Those cases are withheld and reported
for a human decision instead, which is also how the high-value ones get found: `psl.eu`,
`kyoto-u.ac.jp`, `unam.mx`.

`institution_source` is stored and never displayed. The badge claims "an address at this
institution's domain was confirmed on this date", equally true whichever table supplied
the domain. The column exists so a bad derived domain can be traced to the badges it
issued rather than guessed at.

Still unsolved, and not solvable this way: a researcher at an institution ROR does not
list, or one working from a personal address. That needs a request-and-review path with
moderation tooling behind it.

## 2026-08-14 — ORCID removed entirely

**Superseded by this entry, but kept because the findings below survive the removal.**

The ORCID tier is gone. Two tiers remain, Registered and Institutional. `profiles.orcid`
and `profiles.orcid_verified` are dropped, along with the identity trigger; nothing
user-facing mentions ORCID.

Removed for scope, not because it did not work. It did — 14 pgTAP assertions covered
linking, unlinking, non-ORCID identities, a malformed subject, and the issuer fallback —
but it could do nothing at all until somebody registered an ORCID client and configured a
custom provider in the Supabase dashboard, and it added a fifth data processor to the
privacy notice for a badge nobody had asked for yet. Two working tiers now beat three
tiers where one is inert.

**If it is ever revived, these three things are already established and should not be
re-derived:**

1. **A self-declared iD is not acceptable.** Resolving a submitted iD against ORCID's
   public API proves the iD exists and nothing about who submitted it. A badge reading
   "ORCID-linked" on that basis is an overclaim, and this project's own rule is that a
   badge states only what was verified. If the tier returns, it returns as OAuth.
2. **It must be a link on an existing account, never a sign-in.** ORCID's OIDC returns no
   email claim — the advertised set is `sub`, `name`, `given_name`, `family_name`, `iss`,
   `auth_time`. An account created by signing in with ORCID would have no email address,
   and therefore no institutional badge (that tier derives from a confirmed email domain),
   no password reset, and no way to reach the person.
3. **The mechanics are known.** ORCID is a conformant OIDC provider at issuer
   `https://orcid.org`; the `sub` claim *is* the iD (`"sub": "0000-0002-5062-2209"`); the
   `openid` scope alone returns it; Supabase's custom OIDC providers are available on the
   free plan (up to three) and hold the client secret in their dashboard, so nothing enters
   this repository. The implementation is in the git history at migration
   `20260814140000_orcid_verified_by_oauth.sql` and its test file.

One more thing worth carrying forward: an ORCID iD is a real name, and this site permits
pseudonyms at every tier deliberately. Linking one to a pseudonymous account connects the
two for anyone who looks, and the interface would have to say so at the point of the
decision rather than afterwards.

## 2026-08-14 — ORCID is verified by OAuth, and is a link rather than a login

The original design resolved a *submitted* iD against ORCID's public API. That proves the
iD exists and nothing about who submitted it, so anyone could have pasted a well-known
mathematician's iD and worn an "ORCID-linked" badge. Against this project's own rule —
a badge states only what was verified — that is an overclaim, and worse than no badge.

ORCID is a conformant OIDC provider whose `sub` claim is the iD itself, and the `openid`
scope alone returns it. Supabase performs the code exchange, so the client secret sits in
its dashboard beside the Turnstile and Brevo secrets and never enters this repository.
`profiles.orcid` is now read from `auth.identities` by trigger and is system-owned: the
column grant is revoked and the guard reverts it, exactly like the institution columns.

`orcid` and `orcid_verified` are tied by a constraint rather than merely kept in step. An
iD that is present but unverified is now unrepresentable, which is a stronger statement
than a convention nobody can see.

**ORCID is offered as a link on an existing account, never as a way to sign in.** Its OIDC
returns no email claim at all — the advertised set is `sub`, `name`, `given_name`,
`family_name`, `iss`, `auth_time`. An account created by signing in with ORCID would have
no email address, and therefore no institutional badge (that whole tier derives from a
confirmed email domain), no password reset, and no way to reach the person. This is the
decisive constraint, not a preference.

Configuration is manual and deliberately not in a migration: registering the ORCID client
and adding the custom provider are dashboard steps, written up in [orcid.md](orcid.md).
Until they are done the trigger never fires, which is inert rather than broken.

One consequence worth stating in the interface and not only here: an ORCID iD is a real
name, and this site permits pseudonyms at every tier for good reason. Linking one to a
pseudonymous account connects the two for anyone who looks. The privacy notice and the
about page now say so; the linking UI must say so at the point of the decision.

## 2026-08-14 — Implicit flow rather than PKCE for email links

PKCE is the more secure of the two and the one Supabase recommends. It is the wrong choice
here, and the reason is entirely about who uses this site.

Under PKCE the code in a confirmation link is worthless without a verifier held in the
browser that started the flow. Our users sign up on a laptop in an office and open their
mail on a phone, and under PKCE that produces an error indistinguishable from a broken
link — for an audience already inclined to read an unfamiliar automated email as phishing.
The cost of the failure is not one annoyed person; it is a signup that never completes and
never gets reported, from exactly the senior, sceptical readers this project needs.

Under implicit flow the tokens arrive in the URL fragment. A fragment is never sent to any
server, and there is no server here in any case; the client strips it from the address bar
on arrival, and the link is single-use. The residual exposure is browser history and
anything with access to the page's URL. That is a real cost, and it is smaller than a
confirmation flow that breaks whenever mail is read on a different device.

## 2026-08-14 — The header guesses whether you are signed in

The header is on every page, including the ones people come here to read. Deciding between
"Sign in" and "Account" by asking the real session store would mean loading the Supabase
client — 122 KB before compression — on the home page, which is precisely the coupling the
read/write split exists to prevent.

So `src/lib/session-hint.ts` reads `localStorage` directly, matching Supabase's storage key
by shape, and takes a guess. Both destinations are real pages that establish the truth for
themselves, so a wrong guess costs a click and never a broken flow. It does mean depending
on a key name that is an implementation detail; the match is deliberately loose, and a
rename upstream degrades it to "always signed out", which is the harmless direction.

Measured result: the home page ships 240 bytes of JavaScript and the account pages ship the
client. Reading the site never loads it.

## 2026-08-14 — Four session states, not two

"Signed out" and "we cannot tell you" are different facts, and the interface that conflates
them is the one that tells a visitor their password was rejected when the truth is that the
deployment has no keys configured. `SessionState` therefore has `loading`, `signed-in`,
`signed-out`, and `unavailable` with a reason, and `Account.astro` renders each of them in
its own words.

This is what makes the degraded state honest rather than merely non-crashing. A checkout
with an unfilled `.env` — which is the state this repository is in right now — builds,
deploys, serves every page, and says "accounts are not switched on for this deployment yet"
on the eight pages that need them.

## 2026-08-14 — Erasure is a row, not an email

The privacy notice promises that account erasure actually works. A `mailto:` cannot prove
the request came from the account it names, so `public.deletion_requests` is written by an
authenticated session and the `user_id` is established by the session rather than typed
into a field. Withdrawing deletes the row outright rather than marking it cancelled, so
changing your mind leaves nothing behind.

There is no UPDATE grant and no UPDATE policy on the table. `status` is the operator's, and
is unreachable from a browser in either direction. Reading is limited to the requester and
to admins — not moderators: erasure is an account action, not a content action, and the
moderation queue has no reason to know who has asked to leave.

Acting on a request is manual and belongs to the moderation tooling. Nothing in the site
deletes anything.

## 2026-08-14 — Signup metadata is read for exactly two keys

`raw_user_meta_data` is whatever the browser sent. `private.handle_new_user()` reads
`display_name` and `is_pseudonym` out of it and nothing else, and both name columns the
user is allowed to write anyway. The restraint is the security property: a version of this
that copied the object wholesale, or read `role`, would hand out moderator accounts to
anyone who could open a network tab. `006_signup_metadata.test.sql` asserts that a signup
asking for `role: admin`, `is_banned: false` and an institution gets none of them.

The pseudonym preference is read at signup rather than set afterwards because the people
most likely to want it are the ones for whom the gap between signing up and fixing it is
the risk.

## 2026-08-14 — No account enumeration, in the copy as well as the code

Supabase is configured not to reveal whether an address is registered: with email
confirmation required, signup returns a decoy user rather than an error. That protection is
trivially undone by an interface that says "this address is already in use", so the copy
had to be written to match it. Sign-in gives the same message for a wrong password and an
unknown address; the password-reset confirmation is phrased conditionally — "if that
address has an account" — rather than "check your email", which quietly asserts the thing
we are refusing to tell you.

This is not theoretical for this community. Some members have professional reasons to keep
their participation here private, and a form that answers "is this person registered" hands
that away to anyone who can type.

## 2026-08-14 — A dashboard setting that must match the repo gets a workflow

The minimum password length lives in two places that cannot see each other: `LIMITS.password.min`
in `src/lib/validation.ts`, which the form enforces, and Supabase Auth's own setting, which
lives in a dashboard nobody can grep. Both directions of drift are defects. If the dashboard
is lower, the form is the only thing enforcing the length we told people about. If it is
higher, the form accepts a password the server then rejects, so the failure arrives after
the button rather than beside the field.

`auth-config.yml` reads the setting through the Management API and fails on a mismatch. The
part worth keeping is the **schedule**: a dashboard change leaves no commit, so there is
nothing to trigger on, and a check that only ran on push would never fire in the case it
exists for. It runs weekly as well as on changes to `validation.ts`.

It fails rather than warns, unlike the "no credentials" path it inherits from `migrate.yml`.
A missing secret means the check could not run; a mismatch means it ran and found the
defect, and those deserve different colours. It also fails when it cannot find
`password: { min: N }` in the source, so restructuring `LIMITS` produces a failed check
rather than a silently vacuous one.

This is the first of the `docs/auth.md` checklist to be automated rather than read by a
human. The same mechanism extends to the rest of that response — SMTP, CAPTCHA, the
redirect allow-list, `mailer_autoconfirm` — and each is a few more lines. They are left out
for now because they would fail immediately against a project whose dashboard is still
being set up, and a workflow that is red for a known reason quickly becomes a workflow
nobody reads.

## 2026-08-15 — profiles.confirmed_at exists because a policy cannot read auth.users

"An authenticated, confirmed, non-banned user may insert" has no sound implementation
without a column like this one. A policy is evaluated with the caller's privileges, and
`authenticated` holds none on `auth.users` and no USAGE on the `private` schema, so it can
neither read `email_confirmed_at` nor call a helper that does. The remaining route is the
JWT's `user_metadata.email_verified`, which is written by the browser through
`updateUser({ data })` — a policy trusting it would let anyone mark themselves confirmed,
and it is the first thing anyone would try.

So the fact is copied to where a policy can reach it, by the SECURITY DEFINER trigger that
already reads `auth.users` to derive the badge. A timestamp saying an address was confirmed
reveals nothing about what the address was.

It is called `confirmed_at` rather than `email_confirmed_at` on purpose.
`002_exposure.test.sql` asserts that no column in the exposed schema is named like an email
address — a blunt instrument aimed at exactly this kind of well-meaning addition. Naming
the column after the account rather than the address keeps that assertion doing its job
instead of needing an exception carved into it.

## 2026-08-15 — Erasure detaches: author_id is nullable, ON DELETE SET NULL

Every other foreign key to a person in this schema cascades. This one does not, and the
difference is the whole account erasure flow: the account goes, the profile goes, and the
contribution stays in the corpus under CC BY without a name on it. A cascade here would
make "delete my account" also mean "delete the discussion other people had about my work",
which is not what anyone is asking for and not what the licence permits us to promise.

`report_confirmations.user_id` cascades, and the contrast is deliberate. A confirmation
is one person's report rather than a durable contribution: an unattributed one could not be
corrected, replaced, or counted against the one-per-person rule.

## 2026-08-15 — The staleness window is a literal in the view, not a setting

Every other threshold in this schema is a row in `private.settings`, changeable with one
UPDATE. The twelve months that separates "verified" from "stale" is not, and the reason is
the view's own security model: `security_invoker = on` means every name in it resolves with
the caller's privileges, and anonymous callers have no USAGE on the private schema. A
settings lookup would fail for exactly the readers the view exists to serve.

Changing it is therefore a migration. That is the right weight for a number that changes
the meaning of every tombstone on the site at once.

## 2026-08-15 — An author may confirm their own report

This looks like a hole and is not. The most valuable confirmation anyone will ever file is
an author returning to their own account a year later to report that it no longer
reproduces — the single most likely source of a truthful `no_longer_works`. Forbidding
self-confirmation would refuse precisely the report the staleness system exists to collect.
The tombstone is not a popularity score, so there is nothing to inflate: it reflects the
most recent verdict, whoever filed it.

## 2026-08-15 — The status column grant is wide, and the policy is what narrows it

`grant update (status, ...) on public.reports to authenticated` includes a column most
callers must never write. It has to: moderators reach PostgREST as the same `authenticated`
role as everybody else, so no column grant can distinguish them. The moderator policy and
`private.protect_report_columns()` are what actually restrict it, and both are asserted
in `008_report_rls.test.sql`.

`author_id` is the contrast worth noticing. It has no column grant at all, so reassigning a
report fails with a permission error before any trigger runs — and the guard reverts it
too, which the test proves by widening the grant and trying anyway.

## 2026-08-15 — Submission is one RPC, because a deferred constraint made it one

`reports` must record at least one tool, enforced by a DEFERRABLE INITIALLY DEFERRED
constraint trigger. Deferred means at the end of the transaction, and PostgREST gives every
request its own — so a browser inserting the report and then its tools fails on the first
request, at commit, before the tools exist. No ordering fixes it: the tools reference an id
that does not exist until the report is inserted. The form could not submit at all
without `public.submit_report`.

It is **SECURITY INVOKER**, and that is the whole safety argument: it buys a transaction and
nothing else. Every policy, grant, constraint and trigger that guards those tables directly
still guards them through it, and `012_submit_report.test.sql` asserts it — unconfirmed
and banned accounts are refused by the *policy* rather than by the function, and `author_id`
is `auth.uid()` rather than a parameter. A DEFINER function here would be a hole around all
of it and would look exactly the same.

`p_author_confidence` is `integer` although the column is `smallint`. Postgres will not
implicitly narrow an integer literal while resolving which function to call, so a smallint
parameter makes `submit_report(..., 8, ...)` fail with "function does not exist" — which
sends you looking for a missing migration rather than a missing cast.

## 2026-08-15 — A transcript link may not stand alone

CLAUDE.md's content model says a share link is never the only record: links expire, get
revoked, and may breach provider terms. The schema was not enforcing it, so
`reports_link_needs_excerpt` now does. A report carrying a link and no excerpt is one
whose evidence lives on somebody else's server, under terms they can change, for as long as
they feel like hosting it — a hole in a corpus that is meant to be downloadable in full, and
one nobody notices until the link is dead.

The asymmetry is the rule: an excerpt with no link is ordinary and common. It is the link
without an excerpt that is refused.

## 2026-08-15 — The three outcomes are given identical weight, deliberately and structurally

A corpus of only successes is worthless and reads as advertising, and failure modes are
precisely what nobody publishes. `OutcomeChoice.astro` therefore fixes: identical size,
border, padding and type for all three; the outcome colour on the tombstone glyph only, with
labels in ink; every square open, because a new submission is unverified whatever its
outcome; and a sentence underneath saying outright that all three are equally useful,
because layout can imply a ranking however carefully it is balanced.

These are constraints on any future change to that component, not observations about the
current one.

## 2026-08-15 — Draft autosave is per account, in localStorage

Losing a half-written submission is how a contributor is lost. A well-structured account
takes the better part of an hour, the audience is senior and busy, and somebody who loses
one does not write it again — they conclude the site is not serious.

Keyed by account id because a shared machine is a real thing in a mathematics department and
one person's draft appearing in another's form would be both alarming and a disclosure.
localStorage rather than the database because a draft is not content: not moderated, not
exported, not published, and not anybody else's business — and because sending every
keystroke to Postgres would put a rate limit and an egress quota in the path of typing.

The draft is discarded only after the write is confirmed. Clearing it on submit would lose
it to a failed request, which is the moment it is most needed.

## 2026-08-15 — Reading is built, not fetched

prompts/8.md says to query Supabase for now, and `readCorpus()` does — over PostgREST, with
the publishable key, **during the build** rather than from a reader's browser. Four reasons,
and the last one is the one that settles it:

- The read/write split in CLAUDE.md exists so a traffic spike never touches the egress
  quota. Client-side reads spend egress per reader.
- The free tier pauses a project after about a week of inactivity. A site whose pages are
  files keeps serving; a site that fetches its content does not.
- A reader waits for a round trip before seeing anything, on every page.
- **Astro needs the ids at build time to generate `/reports/<id>/` at all**, and GitHub
  Pages has no SPA fallback. Fetching would mean one page with a query parameter, and a
  corpus meant to be cited needs real URLs.

`readCorpus()` is the single swap point. It already prefers a committed
`data/reports.json` and falls back to querying; when the nightly export exists the
fallback goes and no page changes. A failed query returns an empty corpus rather than
throwing, so a paused project produces a site with no reports rather than a red build.

## 2026-08-15 — `[hidden]` needs `!important`, and this cost three shipped bugs

The browser's own `[hidden] { display: none }` is in the *user-agent* stylesheet, which any
author rule outranks. So the moment a component sets `display: flex` on a class,
`element.hidden = true` silently stops working on it.

It had already shipped three times, each presenting as an unrelated logic bug: listing
filters that updated the count, the chips and the tallies while hiding no cards; the account
deletion form left visible underneath the request it had just filed; and the disclosure
question on the submission form shown for reports that were never published. All three
were one line of CSS.

`base.css` now carries `[hidden] { display: none !important }` — not wrapped in `:where()`,
and the only `!important` in the project. It has to beat component scoped styles, which are
unlayered and otherwise win.

## 2026-08-15 — Filters are URL state, and a stale link says so

Filters are query parameters so a filtered view can be linked in an email or cited in a
paper. That only means something if the link still shows what the sender saw, so a URL
naming a value the corpus no longer has — a retired tag, a tool nobody uses any more — is
reported rather than dropped: "you are seeing more than the person who sent it."

Silently ignoring it is the tempting behaviour and the wrong one. It widens a cited view
without either party finding out, which is the specific failure a citable URL exists to
prevent.

## 2026-08-15 — The staleness rule is read, never recomputed

Every tombstone on the site comes from `public.report_staleness`. Nothing in TypeScript
derives one, and `StalenessNote.astro` only decides how to *say* what the view already
computed. The same answer has to appear in a listing, on a report page, in the nightly
export, and in whatever a researcher runs against the dumped corpus; a second
implementation would be a second definition of "verified".

The one thing the interface adds is the plainly worded note for an account over a year old.
Its wording is deliberate: it says the tool has moved, which is a fact, rather than that the
report is wrong, which nobody has checked.

## 2026-08-15 — The aggregate is a SECURITY DEFINER function under a security_invoker view

Two requirements pull against each other and both are right. A rating row is readable only
by the person who wrote it — individual ratings are never shown attributed to a name, and
the sturdiest guarantee of that is that the row is unreadable. And the aggregate is readable
by everyone.

A plain view cannot do both. `security_invoker = on`, which every view in the exposed schema
must have, makes the view read `public.ratings` as the caller — who can see exactly one row.
The histogram would be a histogram of one.

So the counting is in `public.rating_aggregate()`, SECURITY DEFINER, which returns a
histogram, a median and three counts and has no argument by which it can be made to return a
row, a user id, or a score attributable to anybody. It refuses hidden debates. The view
over it stays `security_invoker`, which still does real work: it joins `public.debates`,
so a hidden debate's aggregate does not appear in a listing to somebody who cannot see
the debate.

**The Security Advisor flags this**, twice — `anon_security_definer_function_executable` and
the `authenticated` equivalent. Both are expected and accepted. It is flagging the pattern,
not a mistake, and the pattern is the only way to satisfy both requirements. Four warnings
is now the baseline; a fifth means something new.

The honest caveat: on a debate with one rating the aggregate *is* that person's score,
and anyone who knows they rated it learns what they said. That is true of every aggregate
ever computed. It is why the function refuses hidden debates and why promotion needs
several answers.

## 2026-08-15 — The median is percentile_disc, and there is no mean

`percentile_cont` interpolates: on an even number of raters it returns 6.5, which is not a
point on an eleven-point scale and is arrived at by averaging the two middle values. That is
a mean of a sort, and CLAUDE.md's rule is absolute. `percentile_disc` returns a value
somebody actually chose.

`013_ratings.test.sql` asserts the absence of a mean against the catalogue rather than
against a list of objects, so it covers whatever gets added next: no function and no view in
the exposed schema may contain `avg(`.

The reason is worth restating because it is not squeamishness about statistics. On a
bimodal distribution — which is what to expect on precisely the contested debates — a
mean reports mild agreement for a community that has split cleanly into two camps. It would
smooth over the exact thing this corpus exists to make visible.

## 2026-08-15 — The distribution is fetched, not built, so withholding it means something

CLAUDE.md says not to reveal the aggregate to a reader until they have rated. If the
histogram were built into the page and hidden with CSS, that would be a decoration
view-source defeats. So the debate page ships without it and fetches it once a rating
exists.

Be straight about what this is: it limits bandwagoning, it does not prevent access. The
aggregate endpoint is public by design and anyone determined can query it. What it prevents
is the ordinary reader forming a view after seeing where everybody else landed, which is
where the effect actually comes from.

An anonymous reader cannot rate, so they do not see the distribution either. That is
deliberate — the rule is about who has formed a view before looking, not about who is
logged in, and an exception there would be the loophole.

## 2026-08-15 — A hidden grid child breaks automatic placement

A second-order consequence of the `[hidden] { display: none !important }` fix from the
reading work, and worth recording because it will happen again. Now that `hidden` really
hides, a hidden grid child is removed from the flow entirely — so under automatic placement
every following child shifts up a row.

The histogram has a "you" marker and a "median" marker that are absent from nine of its
eleven columns. Each column laid itself out according to which markers it happened to carry,
and the result was eleven baselines at eleven different heights. Every child now has an
explicit `grid-row`. Any grid whose children can be `hidden` needs the same.

## 2026-08-15 — Comments post immediately; reports wait

Every other user-content table on this site starts `pending`. `public.comments` defaults to
`published` and is moderated reactively, with the same `status` column and the same
moderator hide policy as everything else.

A report is a contribution to a corpus and can wait for a volunteer to read it. A reply
that appears a day after the thing it replies to is not a reply. Pre-moderating discussion
on a site with volunteer moderators means no discussion.

The trade is that something can be visible for a while before anyone acts on it. That is
what the hide path, the flag queue and the per-account daily limit are for, and all three
exist before the first comment does.

## 2026-08-15 — The comment edit window is in a trigger because permissive policies are OR'd

This is the trap of the prompt, and it is not obvious in review.

An author may edit a comment for 24 hours, and may delete one at any age. Two permissive
UPDATE policies, therefore — and PostgreSQL ORs permissive policies together, both their
USING clauses and their WITH CHECK clauses. With the window written into
`comments_update_own`, an out-of-window edit still passes: it satisfies the *delete*
policy's USING (the author's, undeleted), and then satisfies the *edit* policy's WITH CHECK
(the author's, undeleted). The window would be decorative and would read, in the migration,
exactly like a working rule.

A BEFORE UPDATE trigger is the only single choke point an update has, so the window lives in
`private.protect_comment_columns()` and raises 23514 with a finished sentence. The same
place enforces the second half of the rule: the text freezes as soon as anybody replies,
because people replied to the sentence in front of them.

The general lesson: **a restriction cannot live in one permissive policy if another
permissive policy on the same command would admit the row.** Restrictive policies or a
trigger are the options; a trigger is the one that can also explain itself.

## 2026-08-15 — Deleting a comment destroys the text, and there is no `deleted_by`

CLAUDE.md says soft deletion "strips author attribution and hides the body". Prompt 10 says
"replaced with a neutral marker". This implementation takes the stronger reading: on
deletion the trigger sets `body` to the empty string and `author_id` to null, and a CHECK
requires exactly that shape, so a half-finished deletion is not representable.

The cost is real and worth naming: a comment that was flagged and then deleted cannot be
read by the moderator handling the flag. The alternative is a table that retains text
people asked to have removed, on a site whose privacy notice promises erasure works.
Moderators who need the text intact should **hide** — hiding preserves everything and is the
whole of the moderator power on this table.

There is deliberately no `deleted_by` column, unlike `public.reports`. Only the author can
delete a comment, so the column would record exactly the name the deletion just removed.

The marker a reader sees is rendered from `deleted_at`, not stored. Storing "Removed by its
author" as data would put English prose into the export and into every future consumer, as
though somebody had written it.

## 2026-08-15 — A citation's endpoints are pages; its provenance is comments

`public.citations` links a report or debate to another. Comments are not endpoints —
a graph in which every remark is a node is a graph nobody can read, and the useful question
is "which accounts bear on this claim", not "which sentence did somebody quote".

But a quotation nearly always comes from a comment or lands in one, so both ends carry an
optional `*_comment_id` beside the page id. The graph stays coarse; the provenance stays
exact, and a "referenced by" entry can link to the paragraph rather than the top of a long
page. A trigger requires each comment id to belong to the page at its end, so the two halves
cannot disagree.

Two further rules do most of the work. A citation is visible only when **both** endpoints
are — the `excerpt` column is a verbatim copy of the target's text, so a citation outliving
its target being hidden would republish, on a third page, exactly the passage a moderator
removed. And there is no UPDATE grant at all: immutability is a grant-level fact, so it
holds even if somebody later adds a permissive policy without thinking.

## 2026-08-15 — Citations are the one hard delete on the site

Everything else here is soft-deleted, because everything else has replies hanging off it or
attribution to preserve. A citation has neither: it is a link, its excerpt still exists at
the target, and nothing is threaded under it. The citer may withdraw their own and a
moderator may remove one whose excerpt should not be there.

## 2026-08-15 — Comments render at build time; new ones show as source

Everything in the corpus at build time arrives as sanitised HTML with its formulas already
set. Anything posted since is fetched by the browser and shown as the plain text it was
written as, marked "posted since this page was built".

Rendering markdown in the browser would mean shipping a parser and a copy of KaTeX to every
reader, and doing the sanitising in the one place an attacker controls. Neither is worth an
hour's less latency on one remark.

This is what sets the 24 hour edit window rather than a shorter one: a comment carrying TeX
is first seen *set* at the next build, so a window shorter than one build cycle would mean
nobody could ever fix a formula that came out wrong.

## 2026-08-15 — `public.flags` added early, because a flag control that files nothing is worse than none

Prompt 10 asks for a flag control on every comment. CLAUDE.md has always required the
table; this is the minimum shape of it, built now so the control does something.

It lives in `public` because a browser moderation UI will read it, which makes two policies
the ones worth reviewing closely. A flagger reads their own flags and nobody else's —
without that, the table is a list of who has complained about whom, readable by everyone it
names. And nothing about a flag is ever shown on the page: a visible flag count turns
flagging into a downvote.

Flags cannot be withdrawn or edited by their author. The queue is a record of what was
raised, and a flag retractable after a moderator has read it makes the log incomplete in
exactly the cases that matter.

## 2026-08-15 — `:scope >` in the thread, and why it is not a style preference

A comment element contains its replies, so `item.querySelector('[data-comment-body]')` on a
top-level comment returns the *first reply's* body. In `CommentThread.astro` that would have
offered Delete on somebody else's reply, decided the "already removed" state from the wrong
row, and put an edit box in the wrong place — while reading, in review, exactly like working
code. Every per-comment lookup uses `:scope >`.

## 2026-08-15 — `auth_leaked_password_protection` is permanent, and the baseline is five

The Security Advisor reported five warnings after the comments migration, against a
recorded baseline of four. The fifth is `auth_leaked_password_protection`: Supabase's check
of a new password against a breach corpus is disabled.

It is a paid feature. Constraint 1 of this project is zero budget with no credit card, so
it stays off and the warning is permanent. The baseline is now five and the rule becomes "a
sixth warning means something new".

It appeared between the migrate run at 17:26 and the one at 19:57 on the same day, with no
Auth change in between beyond the minimum password length. The setting was never on — it
could not have been — so what changed is the advisor, not the project. Worth recording
because the obvious inference from the timing is the wrong one.

What is actually lost: a length minimum rejects `hunter2` and accepts
`correcthorsebatterystaple`, which is in every breach corpus there is. Nothing here closes
that gap. A client-side check against Have I Been Pwned was considered and rejected —
Supabase Auth validates the password, not our code, so a browser-side check is advisory
only, and it would put a third-party request into the signup flow of an audience that
reads its own network tab and was promised there are none.

## 2026-08-16 — Moderation goes through one audited function, and the direct path is closed

`public.moderate()` is SECURITY DEFINER, is the only thing that changes a row on a
moderator's behalf, and writes to `public.moderation_actions` in the same transaction. The
four moderator UPDATE policies on reports, debates, comments and flags were dropped
in the same push, and the resolution columns on `flags` lost their UPDATE grant as well.

The alternative — keep the policies, write the audit row from the browser — would have made
"every action writes an audit row" a property of our interface rather than of the database.
The first person to open a console would be outside it. For an audience that reads its own
network tab, a log that can be stepped around is worse than no log, because it invites trust
it has not earned.

Consequences worth knowing before changing anything here:

- A moderator's direct `update public.reports set status = 'hidden'` now succeeds and
  changes nothing. That silence is correct — an error would be indistinguishable from a bug
  — and it is asserted in three test files precisely because it is surprising.
- The moderator branches came out of all three column guards. They were unreachable (no
  policy admits a moderator's update) and unnecessary (`public.moderate()` runs as the owner
  and takes the trusted path), and leaving them would have meant that re-adding a policy in
  some later migration silently restored self-approval.
- `public.moderate()` authorises on `auth.uid()`, not `current_user`. This looks exactly like
  the DEFINER trap recorded in CLAUDE.md and is its opposite: `current_user` inside a DEFINER
  function is the owner, but `auth.uid()` is a JWT claim and is unaffected.

## 2026-08-16 — A moderator cannot act on their own contributions

Enforced in `public.moderate()` by name, for reports, debates and comments, and backed
by the absent moderator policies rather than only by the function.

This is the rule that makes the queue mean something, and it has a cost worth stating: with
one moderator, that moderator can never get their own submissions published. That is the
argument for appointing two, which is now written into docs/moderation.md rather than assumed.

Banning is restricted further: nobody with moderation standing can be banned from the screen,
and no account can ban itself. One compromised session should not be able to disable the
people who would notice.

## 2026-08-16 — The moderation log is append-only for the owner too, with one exception

A BEFORE UPDATE OR DELETE trigger on `public.moderation_actions` raises for every caller,
including the role that owns the table. Absent grants stop a browser and stop nothing else;
the realistic threat to an audit log is a migration written in a hurry, or a reason field
with something in it somebody wishes were not.

The exception is narrow and load-bearing: `actor_id` going from a value to null with every
other column identical. That is the foreign key doing `ON DELETE SET NULL` when a moderator
erases their own account, and without permitting it the log of a moderator's decisions would
make that moderator undeletable — a table that quietly cancelled the erasure promise in the
privacy notice.

To remove a row for real, a migration must `ALTER TABLE ... DISABLE TRIGGER` explicitly,
which leaves the fact in the repository where it belongs.

## 2026-08-16 — An erasure records that it happened, not whose account it was

`moderation_actions.target_id` is null exactly for `erase_account`, by CHECK constraint. The
audit row says: on this date, this admin, acting on a standing request, erased an account.

Recording the user id would preserve, in a table designed never to be edited, precisely the
fact somebody asked us to forget — and it would outlive the `deletion_requests` row, which
cascades away with the account. The parameter passed to `public.moderate()` is the id of the
*request* rather than of the person, which is also what makes an admin unable to erase
somebody who has not asked: the only way in is a row the account holder wrote themselves.

## 2026-08-16 — "Request changes" writes to the report, because there is nowhere else

A note to an author has to reach them, and this site has no route to a person: no address any
of our code may read, no server to send mail from, no inbox. So `reports.moderation_note`
holds the current change request and the author reads it under "Your submissions" on their
account page.

The two alternatives were worse. A comment on the pending report is visible to author and
moderators today and to everybody the moment it is published — a private note that becomes
public on acceptance is a trap. A message table is a second inbox nobody checks.

One note at a time, cleared when the report is published, because it then describes a
version that was accepted. The history of who asked for what is in the log.

This is only half a feature until there is an edit screen for a pending submission: an author
who is sent back can read the note but cannot yet act on it. That is the next thing to build
and it is listed as missing in docs/moderation.md rather than implied to work.

## 2026-08-16 — /moderate/ ships as the 404 page, and that is manners rather than security

The route reveals itself only after the signed-in account's own profile row comes back with a
moderator role. Everyone else gets the not-found page, word for word.

What it buys: no crawler indexing it, no shareable "you are not allowed" page, nothing
confirming to a stranger that there is an area here worth attacking. What it does not buy:
secrecy. The templates are in the page's HTML and the logic is in the bundle. The data is
defended by row level security, which no browser talks its way past — a member running the
same queries gets empty arrays.

Stating both halves is the point. A gate described as security that is really courtesy is how
somebody later decides row level security on the queue tables is redundant.

`?fixtures` fills the queues with invented rows and skips the gate, so the screen can be
worked on without a moderator account and without seeding production with rubbish. Both entry
points are behind `import.meta.env.DEV`, which Vite replaces with `false` in a production
build; the fixture data is dropped by dead-code elimination and the built bundle was grepped
to confirm it.

## 2026-08-16 — Expect a sixth Security Advisor warning, and it is `public.moderate`

The accepted baseline was five, four of them `*_security_definer_function_executable`.
`public.moderate()` is DEFINER and executable by `authenticated`, so the next migrate run
should report one more of the same lint against it.

It is DEFINER on purpose and for the reason the lint exists to question: it writes rows the
caller may not write — the audit row above all, which has no INSERT grant to anybody. The
authorisation is `auth.uid()` and is not weakened by DEFINER. The baseline is now six, and a
seventh warning means something new.

## 2026-08-16 — The export reads over a direct connection, not with the service role key

The prompt for the export names both `SUPABASE_DB_URL` and the service role key. Only the
first is used, and the second is deliberately not passed to the job.

They authorise the same thing — a read that bypasses row level security — through different
doors. Over PostgREST the service role key would need paginating past a default 1000-row
limit, cannot express the lateral aggregates the reports query uses, and would cost one
request per dataset per page. A direct connection is one round trip per dataset, is the same
path `supabase db push` already uses from CI, and is the `pg_dump`-shaped exit this project
chose Supabase for in the first place. Handing a job a credential it does not need is how
credentials end up in logs.

The consequence is the line at the top of scripts/export.mjs, in bold: the connection sees
everything, so the WHERE clauses in that file are the entire boundary between public and
private. Everywhere else in this project the policies do that work and a mistake is caught by
them. Not there.

## 2026-08-16 — The build reads data/ or reads nothing

The PostgREST fallback in reports.ts, debates.ts, comments.ts and citations.ts is
gone. It was correct while the export did not exist and wrong the moment it did: a build with
credentials silently produced a different site from a build without them, and a paused
database would have gone unnoticed until somebody wondered why the corpus had stopped
growing. A missing export now warns on stderr and produces the empty state, which is a
designed state rather than a failure.

This is also what makes the check in prompt 12 meaningful. With every request to
`*supabase.co*` blocked in devtools, all four reading pages render their main content: the
listing, a report with its comment thread, the debates index, and a debate with
its references. The only requests any of them make are the overlay and, on pages that carry a
comment form, the thread's own live top-up — all of which fail silently.

## 2026-08-16 — A freshness card has no link, and that is the honest version

`/reports/<id>/` is generated at build time from the export, so a report newer than the
export has no page. The overlay could link to one anyway and let GitHub Pages serve the 404;
it does not. The card's title is plain text and the marker says "new since the last build —
its own page follows at the next one".

The alternative designs were worse. Linking is a 404 dressed as a result. Hiding fresh rows
entirely means the first report ever posted sits under "nothing has been published yet" for
up to a day, which is exactly when a contributor is most likely to conclude the submission
was lost — so both listings also carry a landing place for the overlay in their empty state.

The overlay uses plain `fetch` rather than the Supabase client, deliberately: importing
`supabase.ts` would pull the auth client and its storage adapter into a page whose job is to
be read. Checked in the built output — `/reports/` and `/debates/` load no supabase
chunk, while the detail pages do, because they carry a comment form.

## 2026-08-16 — The export commits only when content changed, and asks for the deploy by name

`manifest.json` carries `exportedAt`, which changes on every run, so a commit-on-any-diff
would put a commit and a full site rebuild into the log every night for ever — including the
nights when nothing was posted, which early on is most of them. The workflow stages `data/`
and compares against the index excluding the manifest. Staged first, because `git diff` alone
reports only tracked files and would have dropped the entire first export on the floor.

A push made with `GITHUB_TOKEN` does not start another workflow — GitHub's recursion guard —
so `deploy.yml` would never see the export commit. The job calls `gh workflow run deploy.yml`
instead, which is what `workflow_dispatch` on that workflow has been there for.

The job runs nightly rather than on demand because its own connection is what stops a free
Supabase project pausing after a week of quiet. A night when nothing was posted is exactly
the night that matters.

## 2026-08-16 — profiles.json holds only people with something public

Not every profile. Somebody with an account and no contributions has published nothing, and
copying their display name into a file committed to a public repository — and so into its
history, permanently — would publish something on their behalf. The exported set is exactly
the set already visible in the corpus.

The limit worth stating rather than hiding: erasure removes an account from every future
export and cannot remove it from a commit already in the history, or from a copy anybody has
downloaded. data/README.md says so in as many words, and the privacy notice now says it too.

## 2026-08-16 — Pagefind for full-text search

Pagefind indexes the generated HTML after `astro build`, writing a self-contained index
under `dist/pagefind/`. The JS API (not the default UI) is used so that results can be
grouped by content type and connected to the existing filter vocabulary. The index covers
everything in the built output; `/moderate/` is excluded automatically because that page
carries `<meta name="robots" content="noindex">` and Pagefind respects it.

The pagefind bundle (~7 KB JS entry, index shards lazy-loaded) is imported at runtime on
the search page only. It is not on the critical path for any reading page.

## 2026-08-16 — Embeddings computed locally on CPU, not via an API

`sentence-transformers/all-MiniLM-L6-v2` (Apache 2.0, 384 dimensions) runs inside the
GitHub-hosted runner on CPU. No API key, no external call, no per-token cost. The model
is ~90 MB; it is cached between runs by `actions/cache` on the HuggingFace hub path.

Embeddings are stored as int8 (0–255 per dimension, encoded as base64) — one byte instead
of four per float, about 75% size reduction. The linear map over [-1, 1] introduces at
most ±0.004 error per dimension; negligible for cosine similarity at the 0.70–0.85
thresholds used here.

## 2026-08-16 — The "related reports" reason is rule-based, not generated

The one-line reason on each related report is derived from shared metadata (task type,
tags, area) in a fixed priority order, not from model output or any generated text. The
words are always taken from the report's own fields. This is the constraint the prompt
named: "the words shown are always the author's own". A generated summary of why two
reports are similar would risk mischaracterising the author's stated position, which
for a named mathematician in a citable corpus would be a serious problem.

## 2026-08-16 — Near-duplicate detection uses transformers.js from jsDelivr CDN

The submission form loads `@xenova/transformers` from jsDelivr on blur of the title or
aim fields — lazily, only when the user is actively writing. jsDelivr is not an analytics
service and does not track users across sites; it is a legitimate asset CDN for npm
packages. The form page already loads Turnstile from Cloudflare, so an additional
CDN request for an optional feature is consistent with what the page already does.

The model weights (Xenova/all-MiniLM-L6-v2, ~23 MB quantized) download from HuggingFace
Hub on first use and are cached in the browser's IndexedDB afterwards. The download is
not on the critical path: it happens in the background after the first blur event. If
anything fails — CDN unreachable, model download fails, browser incompatibility — the
warning simply does not appear. Submission is never blocked.

## 2026-08-16 — Embed workflow runs weekly, not nightly

Computing embeddings for every export would add ~90 MB of model download and ~30 seconds
of CPU to a job that already runs nightly. Weekly on Monday morning (after the nightly
export has committed fresh reports.json) is a reasonable tradeoff: the related reports
and near-duplicate suggestions are allowed to be a week stale. The moderation queue catches
true duplicates before they are published anyway.

## 2026-08-16 — Network are a separate content type, not a tag on reports

An entry is a pointer to something useful, not an account of using it. The two are
complements, not duplicates: a report says "I used Lean 4 like this and it worked like
that"; an entry says "here is the Lean 4 documentation". Conflating them into one form
with a type field would produce a form that asks for a verification section from people
adding a link and a URL field from people describing a session, which is two bad experiences
in exchange for one table fewer.

Network have a rate limit (5/day vs 10 for reports) because a link-sharing form is
lower friction and therefore more likely to be abused. The moderation queue treats them
the same way.

## 2026-08-16 — The link-checker uses SUPABASE_DB_URL, not the service role key

The link-check workflow checks URLs and updates `link_status` and `link_checked_at` on
each published entry. It uses a direct Postgres connection (SUPABASE_DB_URL) rather
than the service role key + PostgREST.

The practical reason: both authorise the same thing, but the direct connection is already
a secret in CI for the export, so no new credential is needed. Using PostgREST for UPDATEs
with the service role key would have been a second credential added to CI for no gain.

The security argument: the job is already trusted with the DB URL, which bypasses RLS. A
service role key that can also bypass RLS adds nothing. The principle from the export entry
applies here too: handing a job a credential it does not need is how credentials appear in
logs.

## 2026-08-16 — Bot-rejecting status codes are treated as reachable

The link-checker classifies 403, 405, 406, and 429 as 'ok' (or 'redirected' if the URL
changed). These responses prove the server is alive and actively handling the request, even
if it is rejecting the checker specifically because it is a bot.

404 and 410 are explicit "this is gone" signals and are classified as 'unreachable'.
5xx and connection errors are 'unreachable' because they indicate the server cannot serve
the entry.

The alternative — treating 403 as unreachable — would mark large numbers of academic and
commercial sites as broken because they use Cloudflare or similar services that block
automated HEAD requests from cloud IPs. A false 'unreachable' label is worse than no check:
it tells moderators and readers that working links are broken.

## 2026-08-17 — /debates/view/ is the client-rendered viewer for pre-export debates

The static debate pages at `/debates/<id>/` are generated from the nightly
export. A debate posted between exports has no static page, so the freshness overlay
on the listing previously showed it as unclickable text — visible but unreachable for up to
24 hours.

`/debates/view/?id=<uuid>` is the fix. It follows the same pattern as `/moderate/`: a
single static HTML shell that fetches its content from Supabase at runtime. One anon fetch
against PostgREST gets the statement, rationale, area, author, and dates. The rating
widget and comment thread initialise the same way as on the static pages.

The freshness overlay now links fresh debates to this URL instead of rendering
unclickable text. Once the nightly export runs and the next build generates the static
page, any further links from outside this site will use `/debates/<id>/`; the view
page remains reachable for as long as anyone has a link to it and continues to work
correctly.

Rejected alternatives:
- **Trigger a rebuild on submission** via a Supabase Edge Function calling the GitHub
  workflow_dispatch API. This would generate the canonical static page within ~10 minutes,
  but adds Edge Function infrastructure, a GitHub token in Supabase secrets, and still
  leaves a gap during the build. The view page gives immediate access with no new
  infrastructure and degrades gracefully (falls back to empty when Supabase is paused,
  exactly like the freshness overlay itself).
- **Modifying the 404.html** to detect debate paths. The 404 page is already the
  moderation UI; routing two unrelated things through it would couple them with no benefit.

## 2026-08-17 — Same view-page pattern applied to reports; freshness overlay added to entries

`/reports/view/?id=<uuid>` follows the same pattern as `/debates/view/`. One anon
PostgREST fetch gets the full report record including tool rows, tags, and author. The
staleness-confirmation section and related-reports sidebar are omitted from the view page
(the confirmation section reads `data-report-id` at initialisation rather than at submit
time, so setting it via JS after the fetch is not safe without restructuring it; related
reports require the corpus to be in memory). Both appear in full on the static page once
the build runs.

`.card__fresh` moved from a scoped style in `reports/index.astro` to `corpus.css`,
because entries now use the same class on their fresh overlay cards.

Network do not have internal pages — every card links to an external URL — so the fix for
entries is different: a freshness overlay on `network/index.astro` that prepends newly
published entries to the list, each linking directly to its external URL. `networkSince`
was added to `src/lib/fresh.ts` alongside `reportsSince` and `debatesSince`.

Both changes follow the same "silent on failure" rule: if Supabase is paused or the query
times out, the page stays correct from the export and nothing is shown or broken.

## 2026-08-17 — /account/edit-submission/ closes the "send back for changes" loop

The moderation flow had a half-loop: a moderator could request changes and write a note
the author would see under "Your submissions", but the author had no screen to act on it.
The submission sat as pending indefinitely.

`/account/edit-submission/?id=<uuid>` is the other half. It loads the full report via
`loadPendingReport` (a Supabase query that enforces `status = 'pending'` and
`author_id = auth.uid()`), shows the moderator's note at the top, pre-fills every form
field, and on submit calls the `resubmit_report` RPC. The account page now shows an
"Edit and resubmit" button on any submission that has a moderation note.

**Why an RPC rather than direct table updates** — the at-least-one-tool constraint on
`report_tools` is `DEFERRABLE INITIALLY DEFERRED`. That means it fires at COMMIT, not
after each statement. A browser that deleted all tool rows and then inserted the new set in
two separate PostgREST requests would see the first request fail at commit (no tools).
Inside one RPC call both operations are in the same transaction, so the constraint checks
the final state (the new tools) and is satisfied. This is exactly the reasoning behind
`submit_report`, and `resubmit_report` is structured identically — `SECURITY INVOKER`,
tag codes accepted rather than UUIDs, unknown or retired codes silently dropped.

**No draft system on the edit form** — the submission already exists in the database.
Accumulating a localStorage draft of an in-progress edit would produce a "a draft from
three weeks ago has been restored" message on the next login, which would be confusing and
incorrect. Editing and resubmitting is one deliberate action.

**CLAUDE.md note** — the sentence "Not built: an edit screen for a pending submission —
so 'send back' reaches the author but they cannot yet act on it" in the "What exists"
section can now be removed. `docs/moderation.md` carries the authoritative list.


## 2026-08-17 — /authors/view/, because an author's first report has no author page

Author pages come from `getStaticPaths` over `listAuthors()`, which reads the committed
corpus. So `/authors/<id>/` exists only for somebody who already had a published report
at the last export — and a person's *first* report therefore goes live with their name on
it and a 404 under it, until the nightly build catches up. That window is the worst possible
one: a new contributor has just posted and is showing the link to a colleague. With the
corpus still empty, it was every author.

`/authors/view/?id=<uuid>` is the same answer `/reports/view/` and `/debates/view/`
already give: a client-rendered shell that fetches what the static page bakes in — the
profile, the author's published reports, and `report_staleness` for the tombstones.
`/authors/<id>/` stays the canonical URL, and nothing links to the view page except pages
that are themselves runtime-rendered.

**The tombstone is fetched rather than assumed.** The report view page omits the staleness
block because a fresh report has no confirmations, so it would be empty either way. An
author page is different: it is where a reader judges a body of work, and rendering every
square as `unverified` would misreport the ones that are confirmed. One extra request against
`public.report_staleness`, keyed by report id, and a missing key means `unverified` — a
report nobody has confirmed has no row there for the same reason it has an open square.

**Everything this page links to is a view page too.** A card title pointing at
`/reports/<id>/` would reintroduce the same 404 one level down, and for the same reason:
this page exists precisely when the export cannot be trusted to contain the rows.

**What still points at the static page.** `ReportCard` and `/reports/<id>/` are built
from the corpus, so their author links are always to a page the same build generated. The
one link that was broken was in `/reports/view/`, and it is the one that changed.

**CLAUDE.md note** — the "Fresh cards link to /reports/view/?id=<id>" trap bullet now has
a third view page to name, and the repo layout entry for `src/pages/authors/` covers two
files rather than one.

## 2026-08-17 — Entry submitter badges: the compact variant, and a sibling

`/network/` passed `profile={entry.submitter}` to `Badges`, which takes `institution`.
Astro does not fail on an unknown prop, so the component rendered its no-institution branch
on every row and the badge was silently blank for everyone. `astro check` had it as a type
error the whole time, which is the argument for keeping that at zero.

Two things about the fix. It uses `compact`, the one-line variant written for comment
headers: the full badge block is a bordered card that also states Registered, and one per
row down a list would be the loudest thing on the page — the same reasoning, and the reason
that variant exists rather than a line written somewhere else. And it sits *outside*
`.entry-card__submitter` rather than inside it, because `.badge-line` is a `<p>` and a
`<p>` is not phrasing content — inside a `<span>` it is invalid markup. `.entry-card__meta`
is a wrapping flex row, so a sibling lands where the child would have.

## 2026-08-17 — Author pages cover entry submitters, and list what they submitted

Two consequences of one fact: `getStaticPaths` built author pages from the report corpus,
so a person whose only contribution was an entry had no page — and `/network/` linked
their name to it anyway. Not a stale-export window like `/authors/view/` answers: a permanent
404 that survived every rebuild.

**`listContributors()` in src/lib/authors.ts** is the union of report authors and entry
submitters, and it is now the definition of which author pages exist. `listAuthors()` is gone
rather than left as an unused export, because the next person looking for "the list of author
pages" would have found it first and it is the wrong answer to that question.

**Not everyone in data/profiles.json.** That file also holds people whose only contribution is
a comment or a debate, and nothing links a name from either — a page for them would be
unreachable and Pagefind would index it as an almost-empty result. The rule is that a page
exists exactly where a link to it exists. If comment authors ever become links, this is the
function to change, not the page.

**Its own file, not another function in reports.ts.** `network.ts` statically imports
data/network.json, and reports.ts is imported by browser scripts including the submission
form. Rollup does drop the JSON when only `categoryLabel` is reachable — checked, by grepping
the built chunks for a string only the corpus contains — but "probably tree-shaken" is not a
reason to put a build-time-only join into a module the browser loads.

**Network are listed, not carded.** Title, then the normalised URL and the category on one
mono line under it. On this page the question is what someone thought worth passing on, not
the full case for each link, which is what `/network/` is for. A failed monthly link check
is still stated — a broken link is a fact in the corpus — but in words, with no outcome colour
and no tombstone: the glyph encodes verification of a *report*, and spending it on link
liveness would make all four states mean less.

**Both kinds are labelled now.** With two sorts of contribution on one page, an unlabelled
first list and a labelled second one would read as though the reports were the page and the
entries an afterthought. The labels are set as every other label on this site is — mono,
tracked out, quiet — and the two counts share one line, separated by the rule this site uses
between facts rather than a middot, which at that size reads as part of the word after it.

**The fresh listing cards link their author** to `/authors/view/?id=`, for the reason the card
title already did: a report new enough to arrive via the overlay is frequently somebody's
first, so the static page may not exist yet. `FreshReport` gained an `authorId`; the erased
branch keeps the same italic "Author since erased" the static card shows.

Verified against a local PostgREST stub — the entries branch of `/authors/view/` cannot be
exercised against production, because no entry is published yet.

## 2026-08-17 — Debate authors are contributors too, and their names link

Completing the rule from the entry above: a page exists exactly where a link to it exists.
Debate authors were the remaining case where the *name* was shown and not linked — so
there was no 404, just an inconsistency a reader cannot explain, since a report author's
name is a link and a proposer's was not. Both debate templates now link it, and
`listContributors()` includes debate authors, and author pages list debates between
the reports and the entries: authored accounts, then claims put to the community, then
things pointed at.

**Identity moved to data/profiles.json.** This is the substantive change. The three corpora
disagree about how much they carry: a report and an entry each embed the institution
triple a badge is built from, and a debate embeds only a name and the pseudonym flag.
Taking identity from whichever corpus mentioned somebody first would therefore have dropped
the institutional badge from the page of anyone who has only ever posted a debate —
silently, and in the direction that matters, because a badge that fails to appear looks like
an account nobody verified. `profiles.json` has the institution for every contributor, so it
is now the identity source and the corpora only decide membership. Checked with a fixture
whose debate-only author has a badge: it renders.

**Comment-only contributors still have no page**, because nothing links a name from a comment.
That is the same rule, not an exception to it.

## 2026-08-17 — `.card__facts > li + li` skipped the variant that is not a list

Two of the places using `.card__facts` are a `<p>` of `<span>`s rather than a list: the
debate items on `/debates/` and now on author pages. The separator rule named `li`,
so it did not apply to them — and since a flex container ignores the whitespace between its
items and the column gap on that class is zero, the two facts were rendered flush against
each other: `WritingActive since 20 July 2026`. It had been live on `/debates/` and was
faithfully reproduced on the author page by reusing the class, which is how it was noticed.

Now `> * + *`, which is identical for every list case and fixes both span cases. The general
lesson is the one worth keeping: **an element name inside a shared-class selector is a silent
opt-out.** Nothing warns you that a variant does not match, and the failure looks like missing
copy rather than missing CSS.

**The author summary does not use that class at all**, for a related reason. Three counts and
the outcome breakdown do not fit on one line, and a wrapped flex item keeps the border that
was standing in for a separator — so the second line opened with a rule attached to nothing.
The counts are stacked, one per kind of contribution. Anybody with only reports, which is
nearly everybody, still sees exactly one line.

## 2026-08-17 — The landing page becomes a poster: one red, one diagram

Designed to a supplied reference. The home page now runs a second palette — warm paper
`#f8f5ee`, near-black ink `#1a1a1a`, and exactly one accent, a brick red `#b1231a` — in
place of the teal / violet / gold trio it carried before. Those three colours are gone from
`tokens.css`; nothing else referenced them.

**Why a second palette is allowed here and nowhere else.** The reading pages are a corpus
and the landing page is an argument for reading it. Chalk blue and the three outcome
colours are load-bearing on a report page — a colour there is a claim about a submission
— and none of that machinery exists on the home page, so borrowing it would be decoration.
What does carry across is the discipline: one accent, hairlines, near-zero radii, and the
Serif / Sans / Mono split. The outcome colours are not touched.

**This contradicts two lines of the "Design direction" section of CLAUDE.md**, which
forbids cream grounds with warm accents and `01 / 02 / 03` markers where the content is not
a sequence. The palette is a deliberate, instructed override; the numbers are arguably not
one, since Educate → Agitate → Organize is a progression and the copy already called it
"three connected parts". Both prohibitions have been rescoped in CLAUDE.md to the reading
pages rather than deleted, so a future session does not "fix" this back out.

**Kalam is a fourth font family, fenced to the diagram.** The reference drawing is
handwritten annotation, which is the whole point of it — mathematics as it is done on a
board, rather than a decorative pseudo-formula this audience would read as an insult. It is
self-hosted like Plex (constraint 6: no Google Fonts CDN, and the supplied HTML linked
three faces from it), latin subset only, one weight, ~22 KB, and it is not available to
prose. The Greek α falls through to the serif stack, which is what the drawing did anyway.

**The diagram's colours were rerouted through the tokens** rather than kept as supplied. It
arrived with its own red (`#D42B2B`) and its own greys; shipping those would have put two
nearly-identical reds on one screen, which is exactly the drift `tokens.css` exists to
prevent. Every fill and stroke is now a class.

**The landing shell is 80rem, not the 72rem reading width**, set on `.landing-body` so the
header, the hero and the footer all measure from one edge — the wordmark sitting directly
above the first letter of the headline is most of what makes the masthead read as one
object. The focus ring is overridden to ink on the same selector, because chalk blue does
not appear on this page and a ring in it reads as a rendering fault.

**Two traps, both already in CLAUDE.md, hit again while building this.**

`text-wrap: balance` from `base.css` applies to the hero `h1` through `:where()`, and
balancing a display headline is wrong: it evened the rag by pulling "is" down and split one
sentence into three short lines. Set `text-wrap: wrap` to opt out. The measure is now the
grid column, not a `max-width` in `ch` that has to be re-guessed whenever the grid changes.

`.site-footer__brand span` matched one element too many the moment the wordmark gained a
span of its own, setting "Act" in 12px muted grey in the footer — the same shape as the
`.card__facts > li + li` entry above, and just as quiet, because it reads as a deliberate
lockup rather than as a bug. Now `> span`.

## 2026-08-17 — The reading pages adopt the landing palette. One palette again

Same day, one commit later. The landing page's warm paper, near-black ink and single brick
red now carry the whole site; the chalk-blue accent is gone from `tokens.css`. This is
almost entirely a token edit, which is the payoff for the rule that a raw hex anywhere else
is a bug — four values in one file changed the colour of 29 pages.

The `--home-*` names survive as **aliases** of the real tokens rather than being deleted.
Two reasons: the home page and the footer genuinely read better with role names of their
own ("paper" and "ink", not "ground" and "ink"), and a rename touching every landing rule
would have buried the actual change in noise. They are one line each and cannot drift.

**`--surface` moved from `#ffffff` to `#fffdf7`.** Pure white against warm paper does not
read as raised, it reads as a hole. It needs to be warmer than the ground and lighter than
it, which white is only half of.

**Buttons are the accent pair from the home page now**: filled red primary, red outline
secondary. The old comment on `.button--primary` argued for ink on the grounds that a
filled accent button and a link in the same sentence would be the same colour and neither
would mean anything. That was written when the accent was blue and the primary button was
the only filled thing on the page, and it is now overruled — but the caution is kept in the
file, because it is still true that two red buttons in a row is a design smell.

**Focus rings moved from the accent to ink.** A red ring around a red button is not a focus
indicator, it is a slightly thicker button. Ink is 16:1 on the ground and reads against
every surface including the inside of the primary button. This also deletes the
`--focus-ring` override that the landing page needed a commit earlier.

**The nav is small tracked capitals on every page, with a dot on the current section.** The
underline it used to carry does not survive 0.14em tracking: it runs a full space past the
last letter and reads as a text decoration, which is the one thing a current-page marker
must not look like. The dot is still a second cue alongside the colour, so the rule that
colour never carries meaning alone is intact.

**The accent is red and so is `--outcome-failed`, and that is a real cost.** `#b1231a`
against `#8a3a34`: same family, distinguishable side by side, but no longer orthogonal the
way blue and brick were. It is written up at length in `tokens.css` rather than papered
over. The mitigation is the one already in the design — an outcome is a glyph plus the
words, a link is underlined text — and the fix, if it turns out to mislead once there are
reports to look at, is to move the outcome colour rather than the accent.

**Not changed:** the reading shell stays 72rem while the landing page is 80rem, so the
masthead shifts about 128px between them on a wide screen. Each page is internally aligned,
which matters more than continuity across a navigation; widening every listing to 80rem is
a density change to judge against a corpus that does not exist yet.

## 2026-08-17 — The home page asks for a submission instead of an email address

Posting is open, so the closing section is no longer a holding message. "Posting is not open
yet … Stay updated", with a `mailto:`, becomes "Create an account" and "Post a report",
pointing at `/account/sign-up/` and `/reports/new/`.

The copy names the three fields the form will ask for and the ten minutes it takes, because
the single most important flow on this site is a researcher submitting a well-structured
account in under ten minutes and the honest way to open it is to say what it costs. It also
says an account of something that did not work is worth as much as one that did — that
belongs in the invitation itself, not only in the form, since the decision about whether a
failure is worth writing up is made before anybody opens it.

That sentence was the only place in the repo claiming posting was closed.

## 2026-08-17 — Renamed the three content types, and moved the moderation control aside

Practices are **reports**, propositions are **debates**, resources are the **network**. The
change is everywhere: routes, copy, TypeScript, the corpus filenames, the CSV headers, the
docs, and the schema. Nothing about behaviour moves.

**Why the schema too, rather than an alias at the library boundary.** `src/lib/` could have
translated between a database that still said `practices` and a site that said `reports`, and
that would have been a smaller diff. It would also have been permanent: the schema is the
corpus's public surface, named in `data/csv/*.csv` headers and in every query anyone writes
against a dump of it. Two names for one table is a tax on every future reader, paid so that
one migration could be avoided.

**"Report" was already taken, and that decided the order of everything.** The moderation
control — the button on every report and comment, `public.reports`, `report_reason`,
`report_status` — is now **flag**. Without that move the site would say "report this report",
and the table `public.reports` would mean the opposite of what the word means on the page.
So the incumbent moves out of the way first and only then does `practices` move in, and the
same ordering runs through the enum labels, the object names, and the `private.settings`
keys. Where the ordering is wrong it fails on a duplicate name, which is the good failure.

**"Resources" had no singular.** A report is a report and a debate is a debate, but "network"
is a collection: there is no such thing as "a network" in the sense meant here. So the
section is the **Network** and one row is an **entry** — `public.network_entries`,
`NetworkEntry`, `listNetwork()`, `/network/`. Naming the table `public.entries` was the
alternative and was rejected as too vague to read in a dump.

**What the rename deliberately did not touch.** "Mathematical practice" is the discipline,
not the content type, and it still says practice — on the home page, the about page, and the
footer tagline. So does "in practice", "a referee report" (which is a thing mathematicians
write, not a thing this site holds), "computational resource disclosure" (verbatim from the
Leiden Declaration), and "resource" where it means an HTTP one. A mechanical rename gets all
five of those wrong, which is why the protected list in the rename pass is longer than the
substitution list.

**The staleness control was collateral.** Its button said "Report" and its tally said "3
reports so far", which on a page whose subject is a report reads as a moderation count. It
now uses the word the schema already used: "Add my confirmation", "3 confirmations so far".

**The migration is `20260817130000_rename_vocabulary.sql`, and it checks its own work.**
Views, RLS policies and CHECK constraints store parsed expressions, so their references to a
renamed table, column or enum label follow by themselves — no policy is reissued. Function
bodies are text and do not, so all fourteen that name something renamed are reissued in full.
A rename that is 95% done is worse than one not started: the missing 5% is a function body
that still says `public.practices` and fails months later on somebody's submission. So the
last statement in the file is an assertion over the catalogues, the settings keys and every
function body, and it raises rather than committing if any of the old vocabulary survived.

## 2026-08-18 — Every listing carries its submit action, unconditionally, above the corpus

The three corpus listings each had a way to contribute and each hid it at exactly the wrong
moment.

`/reports/` had the only one inside its empty state, so **the invitation to post disappeared
the day the first report was published** — the corpus started working and the site got harder
to contribute to in the same commit. `/debates/` and `/network/` had theirs at the foot of the
page, below a list that grows without limit; a control nobody scrolls to is a control that is
not there.

There is now one rule for all three: a single `.corpus__action` holding one primary button, at
the end of the introduction, immediately above the corpus. Same place on every listing, so
somebody who has learnt where it is on one page knows where it is on the other two.

**Unconditional, rather than rendered only when the corpus has content.** That was the first
attempt and it was wrong for a reason worth writing down: an empty listing whose freshness
overlay has just found a row hides its own empty state. So on the day the first report is
posted — before the nightly export has run, which is precisely when this was reported — the
page shows a report card and, under the conditional version, no way to write another. The
static corpus being empty is not the same question as the page having nothing on it, and the
button has to answer the second one.

The consequence is that the empty states lost their own primary buttons: `/reports/` keeps
"What this is for" as a secondary, `/debates/` keeps its prose, and `/network/`'s message is
now just the sentence. Two filled reds on one screen makes neither of them the thing to do,
and the surviving button is a few lines above the box in both cases.

One thing this moved that had nothing to do with buttons: the network overlay's insertion
point was `.corpus__submit` — the button now at the top of the page. It anchors on the empty
message instead, which is where the list actually belongs. Appending to `[data-corpus]` would
have worked by accident and put the listing after the `<template>` the cards are cloned from.

## 2026-08-18 — Name the row rather than reflow the select string

`astro check` reported nineteen errors in `loadPendingReport`, every one of them a column
that "does not exist on type `GenericStringError`". The columns exist. supabase-js infers a
row from the **literal type** of the select string, and TypeScript widens `'a,' + 'b'` to
`string`, so a select built by concatenation cannot be parsed and the row type collapses.
Nothing else in the query is wrong.

They predate the vocabulary rename — the pre-rename `loadPendingPractice` is the same code
with different identifiers — and they read exactly like rename fallout, which is what makes
them worth an entry. `astro build` does not typecheck, so they survived every green build.

Two fixes were available. Reflowing the select onto one line restores the literal type and
would have been a one-line diff; it was rejected because it fixes the problem by accident
and the next person to wrap that line for readability breaks it again, with no failure that
names the cause. The other is what `loadProfile` already does with the identically
concatenated `PROFILE_COLUMNS`: name the row and pass it, `.maybeSingle<ProfileRow>()`. So
`loadPendingReport` now has a `PendingReportRow` and calls `.single<PendingReportRow>()`.

That is better than a workaround. The nineteen `data.title as string` casts and the two
`(data as any)` embeds are gone, and the row shape is stated once where a reader can check
it against the select string above it.

## 2026-08-18 — The about page's TeX specimen, restored and actually in display mode

`about.astro` imported `Markdown`, declared a `mathExample`, and carried an `.example` rule
whose comment described "the rendered TeX sample" — and rendered none of it. The specimen
had been dropped from the markup while everything supporting it stayed, so it surfaced as
four unused-declaration hints rather than as a missing demonstration. The page still claimed,
in prose, that TeX between dollar signs is rendered at build time. For this audience a claim
about typesetting with nothing to look at is weaker than no claim.

Restoring it exposed a second thing. The example wrote its display equation as `$$…$$` on a
single line, and remark-math 6 reads that as **inline** math even alone in its own paragraph
— so it rendered, in textstyle, with the Euler product's limits beside the `\prod` instead of
under it. Display math needs the delimiters on their own lines. The sanitiser was cleared of
suspicion first: with the project's schema, a correctly written display formula keeps its
class and comes out as `katex-display`.

Worth knowing because it is a contributor-facing default, not a one-page mistake: anybody
pasting `$$…$$` from a paper onto one line gets cramped inline math and no error.

## 2026-08-18 — The embed job's two bugs: a missing file, and detection that never detected

`embed.yml` had failed on all four of its runs, from the day it was added. The cause was one
line: `git add data/embeddings.json`, on a corpus with nothing in it. `embed.py` prints
"No published reports with content — nothing to embed" and returns 0 without writing a file,
which is correct, and `git add` on a path that does not exist exits **128** and fails the
step. The script was never the problem, which is why the failure survived four runs: the log
reads as a successful embed followed by an inexplicable git error.

A missing file is now handled as what it is — nothing was embedded, so `changed=false` and
the job finishes clean.

Fixing that exposed the step's other half. The intent, per its own comment, was to commit
only when vectors changed, by diffing and dropping lines containing `generatedAt`. That
cannot work. `embed.py` writes the whole file with `json.dumps` and no indent, so it is a
**single line**: any change rewrites that one line, and both versions of it contain
`generatedAt`, so the filter drops the content and leaves the diff's own `---`/`+++` headers,
which match `^[+-]`. Verified in a scratch repo — a timestamp-only change reported
`changed=true`. So once the corpus was non-empty, every weekly run would have committed an
identical file and triggered a deploy for a moved timestamp.

Detection now compares the staged file against the committed one with `generatedAt` removed,
in Python rather than line-wise, because a one-line JSON file cannot be filtered by line.
Tested against five cases before committing: missing file, timestamp-only, changed vector,
new file with none in HEAD, and byte-identical.

**The `SUPABASE_DB_URL` gate is gone.** `embed.py` reads `data/reports.json` and never opens
a connection — there is no `psycopg`, no HTTP client, nothing. The step made the job depend
on a secret it does not use, would have failed it if that secret were ever rotated away, and
its message said "cannot verify" about a verification it was not doing. A stale comment in
`embed.py` about a "direct connection" bypassing RLS came from the same abandoned design and
is corrected.

## 2026-08-18 — A `counter` prop that counted nothing on two of the four forms

`/debates/new/` and `/network/new/` passed `counter` to five `Field.astro` controls between
them and the number never moved off `0`.

The prop is honest about what it does, which is the trap: it renders the counter element and
the cap, and that is all it can do. Astro components used this way have no script of their
own, so the markup is inert until the page wires it. `/reports/new/` and the change-request
form each had their own `syncCounters()` — the same fifteen lines twice — and the two later
forms were written by copying the *markup*, which is the half that looks finished. Nothing
warns you: the counter renders, sits at `0 / 200`, and reads as a component that is still
loading rather than one that was never connected.

It is now `syncCounters()` and `wireCounters()` in `src/lib/forms.ts`, alongside the rest of
the form DOM work that is done once so it cannot be done differently four times. All four
forms use it; the report form keeps calling `syncCounters` from its own `refresh()`, because
that recomputes the progress indicator on the same keystroke and a second pair of listeners
would be doing the same work twice.

Two things the shared version does that neither copy did. It syncs **once on load**, which
matters for the change-request form — rendered with a report already in it — and for a
browser restoring a half-written form on back-navigation, neither of which fires an `input`
event. And it listens for **`reset`, deferred by a tick**: the event fires *before* the
controls are cleared, so counting at that moment just re-reads the values that are about to
go. `/debates/new/` calls `form.reset()` after a successful proposal, so without that the
counters would have kept the withdrawn claim's length.

Verified in headless Chrome over CDP against the built site, typing with real key events
rather than dispatched `input`, on all three submission forms: counter matches
`field.value.length` on each.

`CommentThread.astro` keeps its own inline counter update. It has one hard-coded counter,
looked up inside a per-comment root rather than a form, and moving it would mean giving the
shared helper a second shape for no gain.

## 2026-08-18 — There is a notification centre, and it is an event table rather than an inbox

`public.activity` and `public.activity_seen`, read at `/account/activity/`. This is the first
thing on this site that tells anybody anything, and it reverses part of a decision taken two
days earlier, so both halves are worth writing down.

**What was rejected on 2026-08-16 and stays rejected.** "A message table is a second inbox
nobody checks" — a table of prose somebody had to compose, for a reader to find. That is
still the wrong shape. `reports.moderation_note` is still where a change request lives, and
"Your submissions" is still where it is read; the feed only says *that* changes were asked
for and links there.

**What changed.** The rejected thing was messages. This stores *events* — a kind, a target, a
timestamp, sometimes an actor — and every word a person reads is composed in
`src/lib/activity.ts`. Nothing is written by a human, so nothing goes stale, and rewording a
notification is an edit to one file rather than a migration over history.

**Why a table rather than deriving the feed at read time.** Three of the events cannot be
derived at all, and the third is the one that settles it:

1. `public.reports` has no `published_at`. Status is the current state and carries no date,
   so "your report was published on the 14th" is unrecoverable from the row.
2. `public.moderation_actions` is readable by moderators and by nobody else, deliberately.
   The moderated person cannot read their own row and must not start being able to.
3. `public.ratings` is readable only by its author — that is what keeps a debate's aggregate
   hidden until somebody has taken a position. A debate's author cannot count the ratings on
   their own debate, and should not be able to.

**The moderation trigger hangs off the log, not off the content tables.** One `AFTER INSERT`
on `public.moderation_actions` covers publish, request changes, hide, unhide, promote, ban
and both flag outcomes. The invariant is worth more than the four triggers it replaces: one
audit row per decision, therefore one notification per decision — no logged decision goes
unannounced and nothing announces a decision that was not logged. It also means
`public.moderate()` was not reissued to add this feature, so it could not acquire a
transcription error while doing so.

**Three places the row deliberately says less than it could.** A moderation outcome carries
no actor: the author is told what was decided, never by whom, because naming the moderator
turns a hide into a grievance with an address on it and undoes, one table over, the reason
the log is restricted. A rating carries no actor, for the same reason `public.ratings` is
private. And there is no event at all for *being* flagged — only the flagger hears anything,
when the flag is resolved or dismissed.

**`label` is denormalised, and the rule about what may go in it is the whole of its safety.**
It is always the heading of the report, debate or entry the event is *on* — content the
subject either wrote or can already read. Never a comment body, never a flag's detail, never
a moderator's reason. Copying one of those would republish, in a row nobody moderates,
exactly the text a moderator might later hide. A flagged *comment* resolves to the heading of
its thread rather than to itself.

**`is_inbound` is a column, not a client guess.** A badge that lights up because you posted is
a badge that is ignored within a week, so "something you did" and "something that happened to
you" are separated in the database. `private.log_activity()` classifies every kind with a
`CASE` that has no `ELSE`, so adding an enum value without deciding which half it is in
raises `case_not_found` in CI rather than quietly defaulting.

**The header badge is a guess, like the other two.** A live count would mean the header asking
the database on every page, including `/reports/` and `/debates/`, which are deliberately free
of the auth bundle. So `activity-hint.ts` joins `session-hint.ts` and `mod-hint.ts` in
localStorage, refreshed by the pages that already hold a session — the account pages, and any
report or debate page through `CommentThread.astro`. The link appears only when the stored
count is above zero, which is what makes a third control in a spare header defensible: it is
there when it has something to say. Both hints are now cleared on sign-out, which the
moderation one was not.

**Feed rows are not an audit log.** They cascade away with the account, unlike
`public.moderation_actions`, which outlives the accounts on both ends of it. `39` pgTAP
assertions in `supabase/tests/018_activity.test.sql`; the four that matter are the two
missing actors, the silence toward a flagged author, and the absent INSERT grant.

## 2026-08-18 — The activity feed shipped empty, because a trigger cannot see the past

Every existing account opened `/account/activity/` and read "Nothing here yet" while holding
published reports. Nothing was broken: `public.activity` existed, the grants were right, the
query succeeded, and the table was empty. Triggers observe statements, and everything posted
before `20260818120100` happened with nothing watching.

This is the failure mode worth naming, because it is not a bug and no test would have caught
it. A trigger-fed table is correct from the moment it exists and silent about everything
before, and the interface built on top says the one thing guaranteed to be misread — an empty
state, to a person who knows the opposite is true. The audience least likely to try twice.

`20260818140000_activity_backfill.sql` reconstructs it, and almost all of it is recoverable:
every source table carries `created_at`, and `public.moderation_actions` is a complete dated
log of what was decided, so "a moderator published your report on the 1st" comes back exactly.
Only `edited_report` is unrecoverable — there is no revision history, by the decision in
`docs/moderation.md`, so an edit before today left no trace.

**Real dates, not the migration's date.** Stamping the reconstruction with today would put a
lie in the one column people read as history. `private.log_activity()` therefore gained
`p_created_at`.

**The dedup key is that timestamp, and it works for a precise reason.** The migration lands
after the triggers have been live, so most of what the backfill walks is already there. A
trigger fires in the *same transaction* as the row that fired it, so the activity row's
`now()` and the source row's `created_at` default are the same value rather than merely close
— and that column is also the only thing separating the rows that would otherwise collide,
two people rating one debate among them. It holds because `created_at` is absent from the
INSERT column grant on every source table. Granting it later would quietly break this, which
is why the note is in the function rather than here.

**The moderation routing moved out of the trigger into `private.log_moderation()`.** A trigger
function cannot be called outside a trigger, so the alternative was a second copy of the
longest branch in the feature — the one where a mistake writes a wrong notification to a real
person permanently. The trigger is now a wrapper and its behaviour is unchanged.

`private.backfill_activity()` is a function rather than a `DO` block so that pgTAP can call
it: `supabase/tests/019_activity_backfill.test.sql` turns the triggers off, writes history
underneath them, and asserts the reconstruction has the right dates, the right actors, no
moderator's name, and no duplicates on a second run or over rows the triggers already saw.

## 2026-08-18 — The activity feed pages by keyset, because its timestamps are not unique

`/account/activity/` loads fifty events and offers "Show earlier activity". The choice worth
recording is not that it paginates but *how*, because the obvious option is quietly wrong here.

**`.range()` would break, and not rarely.** Offset pagination is only stable if the sort is
total, and `public.activity.created_at` is nowhere near unique. A trigger writes every row it
produces inside one transaction, so `now()` gives the same answer twice and a single comment
lands two rows equal to the microsecond; `20260818140000` reconstructed whole histories the
same way. An order with ties in it has no defined arrangement between them, so a page boundary
falling inside a group is where a row gets shown twice or skipped — and rows *of this table*
travel in groups by construction.

So the sort is `created_at desc, id desc` and the cursor carries both, resuming with
`created_at < c or (created_at = c and id < i)`. `20260818160000` puts the tiebreaker in
`activity_subject_idx` so that resume is a seek rather than a walk from the top. The partial
index on inbound rows is left alone: it serves a `count(*)` over a range and never orders.

**The timestamp is passed back verbatim and must never touch `Date`.** `timestamptz` carries
microseconds and a JS `Date` carries milliseconds, so round-tripping the cursor through one
moves the boundary by up to 999µs and silently drops or repeats whatever is in the gap. It
goes back exactly as PostgREST returned it; postgrest-js appends it through `URLSearchParams`,
which encodes the `+` of the zone offset.

**A pgTAP assertion pins the premise.** `018` now asserts that the two rows one comment writes
share a `created_at` exactly, and that the index carries the tiebreaker. Without the first,
the `id` half of the cursor reads as superstition and the next person to touch this removes it.

**Ratings are collapsed across every page loaded, not per page.** A run of ratings on one
debate does not respect a page boundary, so folding per page would show that debate as two
events with two counts — worse than not folding at all, because it reads as two things having
happened. The page therefore keeps the raw rows and re-renders the whole list on each append.
The consequence is that a count further up can grow as somebody reads downward: the correct
number arriving late, which is the cheaper of the two surprises.

**A button rather than infinite scroll.** This is a record people read backwards looking for
something, and a list that grows as you approach the end takes the scrollbar — the only honest
indication of how much is left — and makes it lie. The button also lives outside the list, so
re-rendering does not destroy the element focus is on; when the last page arrives it hides
itself and focus moves to the line that replaces it, rather than being left on a hidden
element with nowhere to go.

## 2026-08-19 — Post-moderation: nothing is approved, and every decision is explained to both sides

Content is published when it is written. A moderator's work starts when somebody flags
something, ends with hide or leave-up, and carries a written explanation that the author of
the content and the person who flagged it both read.

This reverses the design the site was built on, so the reasoning for the reversal is the
whole of this entry.

**Why the gate went.** Three costs, and the first is the one that decided it:

- It put a volunteer between a mathematician and the corpus. The most important flow in
  CLAUDE.md is a researcher submitting a well-structured account in under ten minutes, and
  a queue worked "carefully and slowly" turned that ten minutes into an unknown number of
  days. `/reports/submitted/` said "expect a few days, not minutes" in as friendly a way as
  that can be said, and it was still an unpaid wait imposed on a sceptical audience being
  asked to admit something with professional stigma attached.
- It scaled with submissions rather than with problems. Two volunteers reading everything
  caps the corpus at what two people can read. Two volunteers answering flags scales with
  the number of things that turn out to be wrong, which is the quantity that should govern
  the workload.
- It read as approval. A corpus where every account had passed a moderator implies the
  moderators vouched for the mathematics. They did not and cannot — nobody can verify a
  first-hand account of a private session — and the positioning in CLAUDE.md, a reporting
  layer rather than a journal, depends on nobody believing they did.

**What replaced it.** `public.moderate()` keeps its shape: one audited door, one audit row
per decision, still no moderator UPDATE policies on any content table. What changed is what
it is a door to. `publish`, `request_changes` and `promote` now refuse by name, with a
sentence saying the gate is gone rather than "that action does not apply" — a moderator who
has not read the migration will press one, and a generic refusal reads as a bug.

**The explanation is the new obligation, and it has two recipients.** Until now the only
written reason lived in `public.moderation_actions`, which is readable by moderators and by
nobody else. That policy is right and stays: the log names the moderator and is written to
other moderators in the shorthand of people who have read the whole queue. So the same
sentence is written twice — once into the log, and once into `public.moderation_notices`,
addressed to a person.

Both halves of the audience matter, and the second is the one systems forget:

- The author, so that being moderated is something you are told rather than something you
  discover by absence.
- The flagger, so that flagging is not a message into a void. A flag queue that answers
  nobody teaches a community that flagging does nothing, and this community will conclude
  that quickly.

**One row per recipient**, which is a shape decision worth recording. The alternative — one
row per decision, with a policy asking "are you the author of the thing this points at, or
did you flag it?" — needs a polymorphic join inside a `USING` clause, evaluated per row,
over four content tables. One row per recipient makes the policy `recipient_id =
auth.uid()`, which is the same one-line rule as `public.activity` and is checkable by
reading it.

A notice never names the moderator and never names the flagger. The first because a hide is
the site's decision rather than one person's, and a name turns an appeal into a grievance.
The second because telling an author who reported them is how a moderation system becomes a
weapon.

**A dismissal tells the author too, and that was the closest call here.** Until now nothing
told an author that a flag against them existed — deliberately, because it invites them to
work out by whom. The rule as asked for is that the explanation reaches both parties, and on
reflection that is right in both directions: a decision about your post is yours to know,
and an author who is never told is an author who cannot appeal a hide that follows a pattern.
The mitigation is that the notice says what was decided and never who raised it, and the
feed row (`content_kept`) says the same.

**Hiding closes the flags that named it.** One decision, one press. Otherwise a moderator
hides a comment and three flags about that comment stay open, and the three people who
raised them are never answered. Each closure is still a real audit row with a hand and a
time on it, so the log is unchanged in what it can reconstruct. `resolve_flag` survives for
the case a hide cannot cover — a flag against something already hidden or deleted — and
refuses while what it named is still on the site, because otherwise it would be a second,
quieter way to tell a flagger something was done.

**Every action now needs a reason, not just the three that took something away.** The old
rule asked for one on `hide`, `request_changes` and `ban`. The new rule asks on everything
except carrying out an erasure request, which is a standing request being executed rather
than a judgement. The change is possible because there are so few actions left that a
mandatory field no longer produces "ok" a hundred times.

**Editing had to be rethought, and the rule got better rather than merely different.** A
report used to be editable while `pending` and frozen at publication. Publishing is now
instant, so "frozen at publication" would mean a typo was permanent one second after it was
made. The rule is now: **editable while hidden, and until somebody else has answered it** —
an answer being a "still works" confirmation or a comment. That is what the freeze was
always for; "at publication" was a proxy that stopped being a good one the moment publication
stopped being a decision. Two consequences:

- A hide is answerable. The author reads the reason, edits, and the report stays hidden
  until a moderator looks again — `status` is reverted by the guard trigger, so a save
  cannot republish.
- `report_tools` and `report_tags` had to move with it, and this is not cosmetic:
  their policies gated on the parent being `pending`, and `public.submit_report()` is
  SECURITY INVOKER, so under a "hidden only" rule every tool row on every new submission
  would have been refused and the deferred at-least-one-tool constraint would have failed
  the transaction. Post-moderation would have broken posting entirely, silently, in the one
  flow this project cares most about.

**Automatic promotion went with the queue it served.** A debate used to become part of the
record at five ratings, or by a moderator promoting it. Both existed to get claims out of a
queue. A debate is now active when it is written, `private.promote_debate()` and its
threshold are dropped, and `/debates/` is one list instead of two — the active/proposed split
dressed a moderation queue up as a statement about community uptake.

**What this costs, recorded rather than argued away.** Something that should not be on the
site is on the site until somebody flags it and a volunteer answers. That is the trade, and
it is the ordinary one every open publishing system makes. Two things make it survivable
here: the flag control is on every report, debate and comment already, and hiding is
reversible while a wait is not. The one hazard that is not ordinary — third-party unpublished
material in a transcript — is a flag reason of its own, is called out in
`docs/moderation.md` as the one to act on before it is understood, and is still gated at
submission by a confirmation the author must give and the database stores.

**The activity feed keeps its rule and gains one value.** It holds events and never reason
text; the sentence lives in the notices table. `content_kept` is the new kind, for an author
whose post was flagged and left up — no existing value said that, and `flag_dismissed`
belongs to the flagger. The four kinds naming publication and change requests
(`report_published`, `report_changes_requested`, `entry_published`,
`entry_changes_requested`) and `debate_promoted` stay in the enum and in
`src/lib/activity.ts`: nothing writes them now, and rows carrying them are in feeds.

Reversed: the pre-moderation design of 2026-08-15 (`public.practices` born `pending`,
`20260815200200_moderate.sql`) and the change-request loop of 2026-08-17
(`/account/edit-submission/`, which survives with a different job). The `pending` and
`proposed` status values are kept rather than dropped from their enums — the audit log and
two backfilled feeds refer to a world in which they existed, and rows may still carry them.

## 2026-08-19 — Two private.log_activity()s, and every write on the site failing

The post-moderation migration reissued `private.log_activity()` to add one branch to its
classification CASE. It reissued it with the seven-parameter signature the function had when
it was created — and `20260818140000_activity_backfill.sql` had dropped that signature two
migrations earlier and replaced it with an eight-parameter one carrying `p_created_at`.

`create or replace function` does not replace across a signature change. It created a second
overload. Every trigger on the site calls this function with seven arguments, the eighth
parameter has a default, and so every one of those calls became:

```
ERROR: function private.log_activity(uuid, unknown, uuid, unknown, uuid, unknown, text)
       is not unique
```

**Everything that writes content stopped working**: posting a report, a debate or a network
entry, commenting, rating, confirming, flagging, citing. Reading was untouched, because
reading is served from static files and never goes near the database — so the deploy was
green, the site was up, and nothing about it looked wrong.

Three things went wrong at once and each is worth separating.

**The mistake.** Reissuing a function without reading the latest migration that touched it.
The definition that was copied was the one in the file that *created* the function, which is
the file you find first when you go looking for it. Two migrations later it was not the
definition in the database. The rule is now in CLAUDE.md.

**The gate that did not gate.** `test-db.yml` failed on the branch, twice, before the merge.
It was merged anyway, and `migrate.yml` — which runs on the same push to `main` as
`test-db.yml`, in parallel, not after it — applied the migration to production while the
suite was going red beside it. CLAUDE.md said the suite "gates production rather than
reporting after it"; that is true only if a red branch run stops the merge. Also recorded in
CLAUDE.md, next to the trap itself.

**Why it was invisible for a day.** The corpus is empty and the site is pre-launch, so
nothing tried to write. The read/write split that makes the free tier viable also means a
totally broken write path shows no symptom at all until somebody submits something. That is
worth knowing rather than fixing: it is the same property that keeps the site readable when
Supabase is down.

The fix drops the seven-argument overload and reissues the eight-argument one with the
branch it was supposed to get. `018_activity.test.sql` now asserts that
`private.log_activity` and `private.log_moderation` have exactly one overload each — by
count, not by signature, because any second one is the bug whatever shape it has.

One thing was tidied at the same time rather than left. The same migration had inlined a
copy of the moderation-to-feed mapping into `private.activity_on_moderation()`, which
`20260818140000` had deliberately moved out into `private.log_moderation()` so that the
trigger and `private.backfill_activity()` could not drift. Nothing was broken by that — the
trigger is what fires — but the copy the backfill reads was the pre-moderation one, so a
backfill run would have written notifications from a mapping two weeks out of date. The
mapping is back in `log_moderation()`, with the dismissal's second row in it, and the trigger
is a wrapper again.

## 2026-08-19 — "Has anybody answered this?" is a column, because as a subquery it recurses

The editing rule from the post-moderation change — a report is editable while it is hidden,
and until somebody else has confirmed or commented on it — was written as two `not exists`
subqueries inside `reports_update_own_editable`. It raised on the first update anybody tried:

```
ERROR: infinite recursion detected in policy for relation "reports"
```

A policy **on** `public.reports` that reads `public.comments` calls the comment policy, which
reads `public.reports` to check the parent is published, which calls the reports policy.
`report_confirmations_select_with_parent` closes the same loop. Each of those policies is
correct on its own; the cycle only exists when something asks the question from inside the
table both of them point at.

The rule stays and the answer moves. `public.reports.answered_at` is stamped by a trigger the
first time a confirmation or a comment arrives from **somebody other than the author**, and
every policy that needs the rule now reads `status = 'hidden' or answered_at is null`.

Three things this is better at than the subqueries would have been even if they had worked:

- One indexable comparison per row instead of two correlated scans, on a table whose UPDATE
  policy is evaluated on every author edit.
- The same phrase in the policy, in the guard trigger, and in the four policies on
  `report_tools` and `report_tags` — one rule written five times rather than a ten-line
  predicate written five times.
- The browser stops asking. `loadOwnReports()` had to run two extra queries to decide whether
  to offer an author the edit link; it now reads a column it was already selecting the row
  for.

The trigger is `SECURITY DEFINER` for the same reason `private.log_activity()` is: somebody
posting a comment has no privilege on the report they are commenting on, and must not need
one to leave a mark on it. `answered_at` has no INSERT or UPDATE column grant, and the guard
trigger reverts it as well.

Rejected: a `SECURITY DEFINER` helper function in `public` returning the same boolean, which
is the usual way out of recursive RLS. It works, and it would have added a seventh
`security_definer_function_executable` warning to the six accepted in CLAUDE.md — where the
note says a seventh means something new. A column is cheaper at read time and needs no
exception written next to it.

## 2026-08-19 — A ban was in the database and out of reach, and its explanation went nowhere

`ban` and `unban` have been in `public.moderate()` since `20260815200200`, and `not
p.is_banned` has been in every insert policy on the site since the table it guards was created.
So the *effect* of a ban always worked, and 016 has asserted it for weeks. What did not work was
everything a moderator or a banned member would actually touch, and each of the three gaps is
the kind that leaves a feature technically present and practically absent.

**The explanation never arrived.** The function refuses to ban without a reason, writes it to
`public.moderation_actions` — and stops. The account branch was the only branch writing no
`public.moderation_notices` row, so the sentence a moderator is *compelled* to write was read by
other moderators and by nobody else. It could not have been written even deliberately:
`moderation_notices_subject_is_content` restricted `subject_type` to the four content kinds and
an account is not one of them.

That is a direct contradiction of the rule the whole post-moderation design rests on, for the
single harshest decision available, and it was contradicted in public: the code of conduct has
said since it shipped that "if your content is hidden or your account is suspended, you are told
what rule was applied and why, on your account page". `docs/moderation.md` went further and
listed the notice under things that *existed*. The activity feed's `account_banned` row returned
`null` for its link, which was correct at the time and reads now as the tell — there was nowhere
to send somebody, because there was nothing to send them to.

**A ban could not be lifted.** `unban` was in the enum, in the function, in the TypeScript
`Action` union and in `NEEDS_REASON`. Nothing emitted it, and nothing listed banned accounts, so
the reversible half of a decision documented as reversible had no route. A ban that cannot be
lifted is an erasure with the content left behind.

**A ban was reachable only from a flag**, against the author of the flagged post. Spam is the
case bans exist for and it is the case that produces no flag: people leave rather than flag an
advertisement, and **a network entry cannot be flagged at all** — `public.flags.subject_type` is
`public.content_kind`, which has no `entry`. So the one path in was closed in the one situation
that needed it.

What was built: three enum values (`banned`, `unbanned`, `account_holder`), a widened CHECK, a
notice written in the account branch, an accounts section on `/moderate/` with a search and the
banned list, a ban control on hidden rows as well as on flags, a suspension banner on
`/account/`, and `020_account_bans.test.sql`.

Four decisions inside that are worth the space:

- **`recipient_role` gained a third value rather than reusing `author`.** A ban may reach
  somebody who wrote nothing that was decided about. `author` would have made the page say "your
  report was hidden" about an account, and the fix for that would have been a special case in the
  renderer rather than a fact in the row.
- **The audit row moved inside the account branch, and the shared tail at the foot of
  `public.moderate()` went with it.** The notice needs the audit id. Every branch now writes its
  own row and returns, which is one fewer way for an action added later to happen and log the
  wrong target — the tail's `case when p_action = 'erase_account' then null else p_target_id end`
  was already the shape of that hazard.
- **Banning twice is refused.** The effect is idempotent and the notification is not. Without
  the guard, a second ban writes a second notice and a second feed row telling somebody
  something had just happened to their account when nothing had.
- **No "ban and hide everything".** It is the obvious feature for spam and it is deliberately
  absent: one decision writes one audit row and one notice, and thirty of each in a transaction
  turns an explanation into a mailshot. It would also mean hiding posts nobody had read against
  the scope rule. Hiding stays per post; the accounts section links to `/authors/view/?id=…` so
  the walk is short. That is the *runtime* author page on purpose — an account worth looking at
  has often posted everything it posted this afternoon and has no generated page yet.

Recorded rather than fixed: `profiles.is_banned` is readable by anybody, anonymously, because
the SELECT grant on `public.profiles` is table-wide and badges and author pages are built from
it. A moderation outcome that is otherwise moderators-only can therefore be enumerated. Fixing
it means column-level grants, and the caller's own row needs `is_banned` and `role` — which a
column grant cannot make conditional on the row. Also unfixed: a ban has no duration, so a
"two-week suspension" is one only if a volunteer remembers. The honest version of that is a
`banned_until` column and a nightly job, not a sentence in the runbook.

One claim in `docs/moderation.md` was simply wrong and is now deleted rather than softened: that
"the post forms are not disabled" for a banned account. They have been since they were written —
`reports/new.astro`, `debates/new.astro`, `network/new.astro` and `CommentThread.astro` all check
`mayPost()` and say so in prose. What was missing was the account page, which is where somebody
goes to find out why, and it now leads with it.

## 2026-08-20 — Schema version 2 of a report: fifteen sections, and five scales that may all be skipped

The submission form was twelve sections and thin in three places that anybody doing secondary
analysis keeps needing: **who** was working, **what the prompts actually said**, and **how well
it went as numbers rather than adjectives**. It also mixed two axes. `programming` and formal
verification were being written into the narrative because Area is *why you were working* and
Task type is *what the tool was asked to do*, and neither had a home for them — so "I read a
paper with it" was landing in `literature_search`, which is a different question, and code that
is not a formal proof was landing in `formalisation`, which makes the formalisation numbers
overstate themselves.

What arrived: two areas (`outreach`, `administration`), two task types (`comprehension`,
`programming`), a secondary task list, career stage, a Prompts section separate from the
Transcript, a Supporting material section, five 0-to-10 scales, a net-time-cost checkbox, a
generalisation question, and `role` on a tool row. Four more migrations followed the same day —
two task types, `was_published` as text, `time_saved` as an ordered choice in place of the sixth
scale and the checkbox — for six in all, taking the branch to forty-nine migrations and 565
assertions across twenty-one files.

Ten decisions inside it are worth the space.

**The three example reports were deleted, not migrated.** They were written by the moderators to
see the pages render. Backfilling `schema_version = 1` onto them would have left three rows in a
citable dataset that answer none of the new questions and that nobody can complete, because a
report's text fixes itself the moment somebody else confirms or comments on it. `data/` was
emptied in the same commit rather than left for the nightly job, because the export's own shrink
guard would have refused a 2-to-0 drop — correctly — and a red workflow is a worse way to learn
about a decision than a paragraph in `data/README.md`, which now carries one.

**The enums were extended, not converted to text with a CHECK.** The specification asked for the
second; 20260815100100's argument for the first still holds, and it is about friction rather than
storage. `alter type ... add value` is a migration with a comment saying why, which is the right
amount of ceremony for a decision that changes what every past account means. The *new*
vocabularies that had no enum — career stage, generalisation, reference kind — are text with a
CHECK, because each is a short closed list nothing joins against and one of them is read out of
jsonb, where an enum would buy nothing. Both positions are in the tree, each where it costs
least.

**`task_secondary` is an array of the same enum as `task_type`.** A report grouped under "proof
drafting" and a report that also did proof drafting have to be the same filter, and two spellings
of one word is how that stops being true. It follows that the listing's task filter reads primary
and secondary together — a filter that read only the primary would understate the corpus, quietly
and in the direction that flatters it.

**Duplicates and the primary are normalised out rather than refused.** A form that sent
`proof_drafting` as both the primary and a secondary has made a slip with one obvious right
answer, and a submission somebody spent ten minutes on should not fail on one.
`private.normalise_report_tasks()` deduplicates, strips the primary, and sorts — sorting so that
two identical answers are one value in the export rather than two orderings of it. The
cardinality cap is the only hard rule, and it sees the tidied array because the trigger is BEFORE.

**Two scales are conditional, and a hidden scale stores null rather than 0.** Novelty is a
meaningless question about a teaching-prep session and understanding gained is a meaningless
question about a literature search, and six rows of radios is an invitation to straight-line
the lot. The subtlety is what happens when somebody answers novelty and then changes the area:
the radio keeps its value and the row goes away. `ratingsFor()` in `src/lib/reports.ts` is the
one place that decides, and it nulls anything that no longer applies — the form hides a row, and
that function decides what a hidden row means. A 0 there would put "no help at all" into the
corpus for a question the author was never shown, and `data/README.md` now says so twice,
because it is the mistake an analysis will make.

**`cost_more_time_than_saved` is a column because a 0-to-10 scale has no negative.** Without it,
"the tool wasted my afternoon" and "the tool was mildly disappointing" both score 0, and the
first is one of the most useful things this corpus can record.

> Superseded later the same day. The scale-plus-boolean pair became a single ordered
> `time_saved`, and `cost_more` is one of its values rather than a column beside it — the
> reasoning above is why the value exists, and the entry *Time saved is an ordered list of
> durations* below is why it stopped being a boolean. Neither `rating_time_saved` nor
> `cost_more_time_than_saved` exists any more.

**The ratings are sort keys and not filters.** "Reports where helpfulness ≥ 8" reads as a
measurement; an ordering is honest about being rough. Three sorts were added — most helpful,
least work to check, highest novelty — and every one puts unanswered last, which is why
`report-facets.ts` distinguishes an empty string from a zero on the element.

**The third-party affirmation became conditional, which is the one loosening here.** It was
required on every report; it is now required when there is a transcript excerpt or a prompt, and
`prompts` counts because a prompt quotes somebody's unpublished conjecture as readily as a
transcript does. Unconditional read as the stronger rule and was the weaker one: a tick every
submission needs carries no information about any of them and teaches people to tick it without
re-reading what they pasted. `reports_third_party_material_confirmed` is now
`confirmed or (transcript_excerpt is null and prompts is null)`, and 009 asserts both refusals
while 021 asserts the permission.

**`"references"` is a quoted column name, and that was the cheaper of two bad options.**
REFERENCES is reserved, so every SQL reference to it needs quotes; the alternative was
`supporting_material` in the database and `references` in the JSON and the CSV, which is a third
name for one field and a permanent tax on everybody reading the dataset. `select "references"` in
psql is a known annoyance. The per-element rules are a trigger rather than a CHECK because each
of them has a sentence attached and the person who trips one has just pasted a link.

**`role` had to join the tool table's uniqueness key.** "The same tool at the same version on the
same day is one use" was right until a tool row could say what it did: a model that drafted the
sketch and then checked the proof, same version, same afternoon, is two rows and was a unique
violation on the second. It is a functional unique index over `coalesce(role, '')` rather than
`UNIQUE NULLS NOT DISTINCT`, so that two role-less rows are still the duplicate they were before
the column existed, on any Postgres rather than only on this one.

Two things were resolved against the specification and are worth recording as such. Its section
table lists fourteen sections and omits Caveats, while §3 and §8 both keep the field and §0 says
thirteen — so the count in it is unreliable and the content is not. The form is **fifteen**
sections: the live twelve, plus About you, Prompts and Supporting material, with Caveats
relabelled *What you would tell someone trying this* and moved after the Transcript exactly as §3
directs. Nothing the specification keeps was dropped to make a number come out. And its data
model names a `moderation_status` of `draft` / `submitted` / `published` / `rejected`, which
predates post-moderation: `status` stays `published` / `hidden`, moved only by
`public.moderate()`, and a draft stays in localStorage rather than becoming a row somebody has to
moderate. MSC codes are out, as the specification's own last line asks.

Two pieces of scaffolding paid for themselves immediately. `ReportFields.astro` and
`src/lib/report-form.ts` are the form's markup and behaviour, shared by `/reports/new/` and
`/account/edit-submission/`, which had carried two copies of all of it. Twelve sections of plain
fields survived being duplicated; conditional scales would not have, because a scale shown on one
page and not the other stores a number against a question the author never saw — silently, and in
the direction that overstates what was asked. `src/lib/report-facets.ts` is the same argument for
the four derived filter values: `ReportCard.astro` computes them during the build and the
freshness overlay computes them in the browser, and a card whose recency band was worked out a
second way fails a filter it should match with nothing to show that it did.

Recorded rather than fixed: `has_prompts` and `has_transcript` are generated columns that exist
for one caller. The freshness overlay has to answer "includes the prompts" for rows newer than
the export, and the honest alternative was fetching up to twenty-four thousand characters per row
onto a reading page to settle two yes-or-no questions — on the one query in this project that a
reading page is allowed to make, and only because it is small. Two generated booleans are the
cheaper answer, and they are absent from the export, which carries the text itself.

## 2026-08-20 — `was_published` is four answers, and a boolean held three

"Was the work published?" has four honest answers and a boolean has three states for them. `true`
and `false` were fine; `null` was carrying both *not yet* — a paper the author still expects to
submit — and *not applicable*, a teaching session that was never going to be published at all.
Those are not the same fact, and collapsing them makes the most common follow-on question
("of the work that could have been published, how much was?") unanswerable. `20260820120000`
makes the column `text` over `yes` / `not_yet` / `no` / `not_applicable`, and the disclosure
constraint reads `was_disclosed is null or was_published = 'yes'` — disclosure is a question about
a paper that exists, so it stays refused on the other three.

Two implementation notes, both of which cost a CI cycle. `alter column ... using` does not work
here: the Postgres this project runs evaluates the USING expression with the column already at the
new type, so `was_published is true` inside it fails with *argument of IS TRUE must be type
boolean, not type text*. The corpus was emptied by `20260820100000`, so the migration drops and
re-adds the column instead and loses nothing. And the constraint to drop first is
`reports_disclosure_needs_publication`, **not** `practices_disclosure_needs_publication` — the
rename on 2026-08-17 rewrote every constraint name containing `practice`, so the name in the
migration that created it is not the name it has.

## 2026-08-20 — Time saved is an ordered list of durations, not a 0-to-10 score

`rating_time_saved` (0 to 10) and `cost_more_time_than_saved` (boolean) are replaced by one
`time_saved` text column. Two things were wrong with the number. A 0-to-10 scale has no negative,
so the single most useful answer here — the tool cost more time than it saved — needed a checkbox
beside the scale, and the pair had to be read *together* to mean anything; either one alone was
misleading. And "8 out of 10 for time saved" is not comparable between two people, while "about a
day" is. The corpus exists so that durations can be compared across reports, so it now records a
duration.

The vocabulary is `none`, `few_minutes`, `about_an_hour`, `few_hours`, `about_a_day`, `few_days`,
`about_a_week`, `more`, `cost_more` — and `cost_more` is deliberately **last** rather than first,
even though it is the only value below `none`. It is the answer this project most wants and the
one an author is most reluctant to give, and putting it at the end of the list rather than at the
top means the reluctant answer is not also the first thing a reader of the form is asked to rule
out. The ordering lives in `TIME_SAVED` in `src/lib/report-schema.ts`; the CHECK constraint is a
membership test and says nothing about order, which is the usual split in this project between
what the database refuses and what the form means. `20260820150000` revised the list once, adding
`about_an_hour` and renaming `full_day` to `about_a_day` — an hour was the gap everybody's first
example fell into, and `full_day` read as a claim about a working day rather than an approximation.

The consequence for the dataset is that this is **the one v2 field that is not a scale**: five
`rating_*` columns are still 0-to-10 integers and `time_saved` is categorical. Anything computed
against `rating_time_saved` has to be rewritten, and `data/README.md` says so where a reader of
the CSV will meet it.

## 2026-08-20 — A supporting link no longer carries a label

The Supporting material section asked for a label — *shown instead of the bare link* — and it is
gone. It was the only optional field in a repeating row, which is the worst place for one: eight
rows times two fields is sixteen inputs to get through, the label adds nothing a reader cannot get
from the URL and the `kind`, and a field most people skip in a repeater teaches them to skip the
row. The `kind` is what actually does the work of telling a reader what they are about to open.

The field is removed from the form only. `reports."references"` is jsonb, the trigger still
accepts and length-checks a `label`, `/reports/<id>/` still renders `reference.label ?? reference.url`,
and the export still carries the key. That asymmetry is on purpose — nothing had to be migrated,
and a future form could ask again without a schema change — but it means the column is null on
every row rather than null when an author declined, which is a different fact and is the version
`data/README.md` now states.

## 2026-08-20 — Two task types added after the schema landed, in their own migrations

`example_counterexample` (`20260820110000`) and `brainstorming` (`20260820140000`) join the task
type enum. Both are things people actually do first and neither had a home: "find me a
counterexample" is not proof checking, and free-form idea generation before there is a claim to
state is not conjecture generation. They are separate one-line migrations rather than additions to
`20260820100000` for a reason worth remembering — a new enum label cannot be *used* in the same
transaction that adds it, so an enum value and a constraint or default that names it belong in
different migrations. Adding them after the fact costs one file each and sidesteps the question
entirely.

## 2026-08-20 — A dropped column takes its column grant with it, and every submission failed

INSERT and UPDATE on `public.reports` are granted per column — deliberately, so that a caller
cannot name `status` or `created_at` at all — which means a column added by a later migration
arrives with no privilege and a column dropped and re-added loses the privilege it had. Both
happened in this schema version: `20260820120000` drops and re-adds `was_published` to change it
from boolean to text, and `20260820130000` adds `time_saved` in place of two columns it drops.
Neither regranted, and the whole submission path stopped working.

What makes it worth writing down is how it presents. The column is there, the CHECK is there, the
policy matches, and `public.submit_report()` — which is SECURITY INVOKER *precisely* so that the
grants still apply through it — dies with `permission denied for table reports`, so all twelve
failures in `012_submit_report.test.sql` and four in `021` read as a policy that had stopped
matching rather than as one missing grant. It is the long-standing rule again: grants decide
whether the endpoint exists, policies decide which rows it returns, **check the grants first**.
Any migration that adds, drops or retypes a column on a per-column-granted table issues the
`grant` in the same file, and `021_report_schema_v2.test.sql` now asserts both columns on both
commands, because that four-way `has_column_privilege` check is the only thing standing between
this and the next schema version repeating it.

## 2026-08-21 — `Field.astro` has no `input` slot, and `/network/new/` shipped the wrong controls

`Field.astro` renders its own control from its `type` prop. It has exactly one slot, `hint`.
`/network/new/` had been written as though it also had an `input` slot — `<Field><select
slot="input">…</select></Field>` — and Astro drops slotted content addressed to a named slot that
does not exist. So every control on that form was silently the component's default
`<input type="text">`: the category `<select>` never existed, and neither did the two
`<textarea>`s, which meant the 200- and 600-character prose fields were single-line text boxes.
The built page contained zero `<select>` and zero `<textarea>` elements.

Nothing warns you. There is no error, no unused-prop diagnostic, and `astro check` is green,
because passing children to a component is always legal. It presents as a feature request that
was never implemented rather than as markup that was thrown away, which is how a `<select>` added
in the morning was still a free-text box in the afternoon. The tell is in the built HTML, not the
source: grep `dist/` for the element you think you wrote. `src/pages/network/new.astro` was the
only file in the repo using `slot="input"`; every other form already used the props API.

The fix is the props API plus a bespoke `fieldset` for the choice list, which is what
`ReportFields.astro` does. `Field.astro` gained `'url'` in its `type` union — the URL field had
been relying on the discarded slot for `type="url"`. An `input` slot was deliberately *not*
added: it would be a second way to do what the props API already does, and the next form to use
it would have the same silent failure available to it again.

## 2026-08-21 — The network category is a closed vocabulary with an `other`, and it is radios

`public.network_category` gains `other`, and `public.network_entries` gains `category_other`,
required exactly when the category is `other` and refused otherwise — the same both-directions
CHECK as `reports.area_other`, for the same reason: an unqualified `other` is a row that has
opted out of the axis, and a label on a row that is not `other` is a field that will never be
displayed and will be read as data by somebody.

It is a radio list rather than a `<select>`, matching Area on the report form and following the
note already in `forms.css` — a select hides most of the options and every one of their
explanations, and a category chosen without reading the alternatives is the one that makes the
listing filter useless. Each category therefore carries a one-line hint in `CATEGORIES`
(`src/lib/network.ts`), which is also what makes `other` honest: it says "you will be asked to
say which".

The free-text box is cleared when the category changes away from `other`, exactly as
`syncAreaOther()` does on the report form. Left behind, it would fail the CHECK from a field no
longer on screen — the submission is refused because of something the submitter cannot see.

## 2026-08-21 — One prose box on a network entry, not two

"Why mathematicians should care" (`relevance`, 600 characters) was removed from the form and the
description's cap went from 200 to 1000, with a prompt that asks for both halves: *Explain what
it is and why it can be of interest to the community.* Two short prose boxes in a row asked one
question twice, and 200 characters was not enough to say what a thing is once the second box had
taken the interesting half of the answer.

`relevance` is **made nullable, not dropped**. Nothing writes it and the form no longer offers
it, but the column keeps whatever rows were submitted while it was collected: dropping it would
destroy the only copy of text somebody wrote by hand, and a column that is null on every new row
costs one field in the CSV and nothing else. Its length CHECK needed no change, because a CHECK
evaluates to NULL on a NULL input and NULL passes. The listing renders the paragraph only when
there is one — an empty `<p class="entry-card__relevance">` carries a bottom margin and would
open a gap under the description of every entry submitted since.

## 2026-08-21 — The accessibility page states type properties, and claims no conformance from them

`/accessibility/` gained a *Type and legibility* section. It opens by saying that WCAG places no
requirement on typeface choice, and that is the load-bearing sentence: there is no such thing as
an accessible font, no certification behind IBM Plex, and a page that implied otherwise would be
making the one kind of claim this audience checks. What the section does instead is state
properties that can be verified — x-height at 74% of cap height, body at 17px/1.6, sizes in
`rem` so zoom and an OS text-size setting work, latin-ext shipped so a diacritic does not change
face mid-name, `font-display: swap` with a real fallback stack, and no text as an image.

The reason the Serif / Sans / Mono split belongs on an accessibility page rather than only in the
design notes: **Plex Mono dots its zero and the other two families do not.** In Sans and Serif,
`0` and `O` differ only in width. Everything on this site meant to be read character by character
— a model name, a version string, a date, a score — is already Mono for semantic reasons, so the
family that disambiguates is the family carrying the strings where it matters, and that is worth
saying out loud because it is the sort of thing a later refactor breaks by "unifying" the
metadata font. `Il1` is unambiguous in all three; that was checked by rendering the committed
woff2 files, not assumed. Plex Sans does not draw a bare-stem capital I, which is the thing one
expects to find wrong and is not.

Two honest limitations were added rather than omitted: the `0`/`O` width-only distinction in Sans
and Serif, and Kalam, whose `I`, `l` and `1` are near-identical strokes. Kalam is defensible only
because it is fenced to the home page diagram and never touches prose, and because that diagram
carries `role="img"` with a title and a description — so the fix for its illegibility is already
shipped. Stating the limitation is also what keeps the fence visible: the day Kalam appears in a
sentence, this page is wrong.

## 2026-08-21 — The debate statement is the page's `h1`, inside the blockquote

A debate page had no `h1` at all. The statement was a `<p>` inside `<blockquote
class="debate__statement">` — right about the blockquote, which says the site is reporting a
claim rather than making one — but it left the page's first heading as *1. Where do you stand?*
That is what a screen reader's heading list opened on, and it is the rating control, not the
subject.

It is now `<blockquote><h1>`. A blockquote takes flow content so a heading is legal inside one;
the other nesting, an `h1` wrapping a `blockquote`, is not, which is why this is the shape. No
visually hidden duplicate: the statement is announced once, as the heading it already was
visually. `/debates/view/` got the same change, where the `h1` is empty until the fetch lands
and therefore sits inside the existing hidden `[data-content]` wrapper — an `h1` with no text is
worse than no `h1`.

**It fixed a second thing nobody had connected to it.** Pagefind takes a result title from the
first `h1` and falls back to `<title>`, so every debate came back in search as *"… —
MathemAct"* while every report came back clean. Verified in `dist/pagefind/fragment/`: the
indexed title went from `AI is exceptional as a reading assistant. — MathemAct` to `AI is
exceptional as a reading assistant.` A missing heading is not only an assistive-technology
problem; anything deriving structure from the document pays for it.

The CSS is now `.debate__statement > *`, not `> h1`, for the reason already recorded about
`.card__facts > li + li`: an element name inside a shared-class selector is a silent opt-out.
The rule addressed `p`, and the moment the element changed it matched nothing and the claim
would have rendered at body size — no error, no warning. `corpus` is the last layer, so it wins
over `:where(h1)` in `base` regardless of the lower specificity of `> *`.

## 2026-08-21 — `--outcome-partial` is 4.63:1, and the glyph-only rule was never about contrast

`tokens.css` gave two different ratios for `#8a6a1f` in one file — 4.41:1 in the prose comment
and 4.6:1 on the declaration — and `Tombstone.astro`, `OutcomeChoice.astro` and CLAUDE.md all
repeated 4.4:1 with the conclusion that it *fails* the 4.5:1 floor for body text. Computed
against `--ground` it is **4.63:1**, which passes at every text size. Every other documented
ratio in the file checks out to the stated precision, so this was one bad number, not a bad
method.

Nothing in the rendered site changes. The rule — outcome colour on the square, label in ink —
stands on the other reason the same comment gave, and called "the one that matters": colour must
never be the sole carrier of meaning. The correction is worth making because a wrong contrast
figure is the kind of thing somebody later acts on, and the action it invites is darkening
`--outcome-partial` to clear a floor it already clears. The comment now says outright not to
reinstate the contrast argument.

## 2026-08-21 — What the accessibility review changed, and what it deliberately did not

An audit of all 33 built pages (landmarks, labels, names, heading order, duplicate ids,
`autocomplete`, fieldset legends, in-page anchor targets) came back with one real structural
defect, the missing debate `h1` above. Three findings were false positives worth recording so
the next audit does not chase them:

- **Unlabelled controls in the tool and supporting-link rows.** They live in a `<template>`, and
  lxml does not implement `<template>`, so it hoists the content and any "is this inert?" test
  fails. Parse built HTML with html5lib when the question is what is in the accessibility tree.
  The labels are real: `bind()` in `src/lib/report-form.ts` assigns a unique `id` and points
  `label.htmlFor` at it as each row is cloned.
- **Two unnamed `<svg>`s on the home page.** Both sit inside `<div aria-hidden="true">`.
  `aria-hidden` inherits; a check that only looks at the element itself will report these
  forever.
- **Two `<header>`s per page.** `header` is only `role="banner"` when it is *not* inside
  `article`, `aside`, `main`, `nav` or `section`. `.page__header` is inside `main`, so there is
  exactly one banner.

Verified rather than assumed, and now stated on `/accessibility/`: KaTeX really does emit MathML
with `output: 'htmlAndMathml'` and marks the visual copy `aria-hidden` (checked by running the
`src/lib/markdown.ts` plugin chain over a test formula, not by reading the config); no
stylesheet anywhere uses `order` or a `-reverse` flex direction, so DOM order is visual order;
input borders are `--ink-muted` at 8.4:1, not the 1.3:1 hairline; the skip link is the first
element in `<body>`; and the focus ring's 2px offset is load-bearing for contrast as well as for
looks — ink on the page is 16:1, but ink drawn tight against a filled `--accent` button would be
2.6:1.

**The page's claim that there are "no animations by default" was false** and is now stated
exactly: there is one, a 220ms reveal on the report form's conditional scales, and it is set to
`none` under `prefers-reduced-motion`.

Two deviations from the "these three colours appear nowhere else" rule were found and left
alone, because they are design questions rather than accessibility ones and both pass contrast:
`--outcome-partial` on text in `/moderate/` and `--outcome-failed` on the unreachable-entry
badge in `/network/`.

Not built, and the reason it is now a stated limitation on the page rather than a silent one:
**no automated accessibility check runs anywhere.** `test-db.yml` gates the schema and
`auth-config.yml` catches dashboard drift, but every claim on `/accessibility/` was verified by
hand on one day and nothing goes red if one regresses.

## 2026-08-21 — One filter engine behind all three listings

`/reports/`, `/debates/` and `/network/` had drifted into three unrelated things. Reports had
ten filter dimensions with tallies, chips, a linkable URL and a "which filter to loosen"
suggestion, all written inside the page. Debates had a sort menu and no filters. Network had a
category radio group and an Apply button that submitted a GET to a static host, so without JS
it reloaded the page and filtered nothing, and with JS it duplicated a path the script already
handled — and its `.listing__filters`, `.filter-set` and `.filter-chip` classes were only ever
styled inside `search.astro`'s *scoped* block, so on `/network/` they matched nothing and the
whole rail shipped bare. That is the `Field.astro` slot trap in another costume: valid markup,
no warning, and a feature that reads as unimplemented rather than as CSS thrown away.

Now: **`src/lib/listing-filters.ts`** is the engine, **`src/components/Listing.astro`** is the
frame, and **`src/lib/listings.ts`** holds each listing's dimensions, sorts and noun. The last
of those is read twice — by the page's frontmatter to render the rail and the sort menu, and by
the same page's client script to run the engine — because defining them apart is how a sort
option ends up in a menu with no comparator behind it.

**Debates and network get one dimension each, deliberately.** Area, and category. A report
answers fifteen structured sections; a debate is a sentence with an area on it. Offering a
filter the data cannot support reads as a corpus that is empty rather than as a question nobody
asked. The rail is the same rail on all three — a short one is fine, and a dimension added later
extends it rather than re-laying out the page. Nothing on `/debates/` filters on ratings, for
the reason the page already exists to serve: a "has answers" or "most disagreed" filter leaks
where the community landed, one bit at a time, to a reader who has not answered yet.

Three things are new to all three rather than carried over: the rail collapses on a phone behind
a **button and two data attributes rather than a `<details>`** — `<details>` hides its own
content through the UA stylesheet in a way an author rule cannot reliably reach, so a panel
collapsed narrow and then widened would strand the reader with a summary corpus.css has hidden;
`data-collapsible` is set by the engine, not the markup, so a page whose script never ran shows
an open rail and no button instead of a dead control. A vocabulary longer than eight folds
behind **"show all N"**, set with `hidden` rather than a CSS `nth-child` rule, because the
freshness overlay appends options at runtime and a rule counting positions would silently start
hiding the wrong ones — and a group with a ticked option past the fold opens itself, or a link
would filter on something the reader cannot see or undo. And **"clear all" sits at the end of
the chips row**, absent until there is something for it to undo.

`?cat=` still works on `/network/`. The dimension is `category` now and that is what gets
written, but a linkable filter that stops being linkable is a broken promise rather than a
rename, so `legacyParams` maps the old name forward on read.

### The part that was actually broken: filters and what was posted today

Two bugs, both in the same place, and both invisible on a populated corpus.

**The rail lived inside the `length > 0` branch.** So on an empty export there were no filters
at all — and an empty export is precisely the state in which *everything* a reader can see was
posted today and arrived through the freshness overlay. The first day the site has content was
the one day none of it could be filtered. The frame is now rendered in every state; the overlay
creates the fieldsets it needs through `ensureGroup()`, and corpus.css hides a rail with no
fieldsets in it and closes the grid up behind it, so nothing shows an empty sidebar while it
waits.

**`readUrl()` ran once, before the overlay had resolved.** A link filtering on a value only
today's content carries — `/debates/?area=outreach` when the one outreach debate went up this
morning — found no checkbox for it, applied nothing, and told the reader "nothing in the corpus
currently has this". Both halves wrong: the filter silently lost, and the notice saying the
opposite of the truth. `add()` now re-reads the address bar after injecting options. Safe
unconditionally: either the reader has not touched the rail, in which case the URL is still the
link they followed, or they have, in which case `apply(true)` already wrote their state there
and reading it back is a no-op that also clears a notice which no longer applies.

The general rule, which is worth holding on to for anything else built on these pages: **a
listing is built from a nightly export and then asks the database for what is newer, so any
feature that reads the corpus has to work on both halves.** A card the overlay added carries
the same data attributes as one the build wrote — that is what `src/lib/report-facets.ts`
exists to guarantee — and it is counted, sorted, tallied and filtered identically.

One limit, unchanged and deliberate: `src/lib/fresh.ts` caps the overlay at two dozen rows. On
a day when more than that is posted, the filters see the newest two dozen and the rest arrives
with the next nightly build.

Not done, and left as a known gap: none of this is covered by an automated test. The engine was
verified by hand against a seeded corpus and a fake PostgREST answering the three overlay
queries — populated and empty, desktop and mobile, filtered by URL, no-results, retired-value
notice, legacy `?cat=`, and a value that exists only on a row posted today.
