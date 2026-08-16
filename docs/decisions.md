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

`practice_confirmations.user_id` cascades, and the contrast is deliberate. A confirmation
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

## 2026-08-15 — An author may confirm their own practice

This looks like a hole and is not. The most valuable confirmation anyone will ever file is
an author returning to their own account a year later to report that it no longer
reproduces — the single most likely source of a truthful `no_longer_works`. Forbidding
self-confirmation would refuse precisely the report the staleness system exists to collect.
The tombstone is not a popularity score, so there is nothing to inflate: it reflects the
most recent verdict, whoever filed it.

## 2026-08-15 — The status column grant is wide, and the policy is what narrows it

`grant update (status, ...) on public.practices to authenticated` includes a column most
callers must never write. It has to: moderators reach PostgREST as the same `authenticated`
role as everybody else, so no column grant can distinguish them. The moderator policy and
`private.protect_practice_columns()` are what actually restrict it, and both are asserted
in `008_practice_rls.test.sql`.

`author_id` is the contrast worth noticing. It has no column grant at all, so reassigning a
practice fails with a permission error before any trigger runs — and the guard reverts it
too, which the test proves by widening the grant and trying anyway.

## 2026-08-15 — Submission is one RPC, because a deferred constraint made it one

`practices` must record at least one tool, enforced by a DEFERRABLE INITIALLY DEFERRED
constraint trigger. Deferred means at the end of the transaction, and PostgREST gives every
request its own — so a browser inserting the practice and then its tools fails on the first
request, at commit, before the tools exist. No ordering fixes it: the tools reference an id
that does not exist until the practice is inserted. The form could not submit at all
without `public.submit_practice`.

It is **SECURITY INVOKER**, and that is the whole safety argument: it buys a transaction and
nothing else. Every policy, grant, constraint and trigger that guards those tables directly
still guards them through it, and `012_submit_practice.test.sql` asserts it — unconfirmed
and banned accounts are refused by the *policy* rather than by the function, and `author_id`
is `auth.uid()` rather than a parameter. A DEFINER function here would be a hole around all
of it and would look exactly the same.

`p_author_confidence` is `integer` although the column is `smallint`. Postgres will not
implicitly narrow an integer literal while resolving which function to call, so a smallint
parameter makes `submit_practice(..., 8, ...)` fail with "function does not exist" — which
sends you looking for a missing migration rather than a missing cast.

## 2026-08-15 — A transcript link may not stand alone

CLAUDE.md's content model says a share link is never the only record: links expire, get
revoked, and may breach provider terms. The schema was not enforcing it, so
`practices_link_needs_excerpt` now does. A practice carrying a link and no excerpt is one
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
- **Astro needs the ids at build time to generate `/practices/<id>/` at all**, and GitHub
  Pages has no SPA fallback. Fetching would mean one page with a query parameter, and a
  corpus meant to be cited needs real URLs.

`readCorpus()` is the single swap point. It already prefers a committed
`data/practices.json` and falls back to querying; when the nightly export exists the
fallback goes and no page changes. A failed query returns an empty corpus rather than
throwing, so a paused project produces a site with no practices rather than a red build.

## 2026-08-15 — `[hidden]` needs `!important`, and this cost three shipped bugs

The browser's own `[hidden] { display: none }` is in the *user-agent* stylesheet, which any
author rule outranks. So the moment a component sets `display: flex` on a class,
`element.hidden = true` silently stops working on it.

It had already shipped three times, each presenting as an unrelated logic bug: listing
filters that updated the count, the chips and the tallies while hiding no cards; the account
deletion form left visible underneath the request it had just filed; and the disclosure
question on the submission form shown for practices that were never published. All three
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

Every tombstone on the site comes from `public.practice_staleness`. Nothing in TypeScript
derives one, and `StalenessNote.astro` only decides how to *say* what the view already
computed. The same answer has to appear in a listing, on a practice page, in the nightly
export, and in whatever a researcher runs against the dumped corpus; a second
implementation would be a second definition of "verified".

The one thing the interface adds is the plainly worded note for an account over a year old.
Its wording is deliberate: it says the tool has moved, which is a fact, rather than that the
practice is wrong, which nobody has checked.

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
row, a user id, or a score attributable to anybody. It refuses hidden propositions. The view
over it stays `security_invoker`, which still does real work: it joins `public.propositions`,
so a hidden proposition's aggregate does not appear in a listing to somebody who cannot see
the proposition.

**The Security Advisor flags this**, twice — `anon_security_definer_function_executable` and
the `authenticated` equivalent. Both are expected and accepted. It is flagging the pattern,
not a mistake, and the pattern is the only way to satisfy both requirements. Four warnings
is now the baseline; a fifth means something new.

The honest caveat: on a proposition with one rating the aggregate *is* that person's score,
and anyone who knows they rated it learns what they said. That is true of every aggregate
ever computed. It is why the function refuses hidden propositions and why promotion needs
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
bimodal distribution — which is what to expect on precisely the contested propositions — a
mean reports mild agreement for a community that has split cleanly into two camps. It would
smooth over the exact thing this corpus exists to make visible.

## 2026-08-15 — The distribution is fetched, not built, so withholding it means something

CLAUDE.md says not to reveal the aggregate to a reader until they have rated. If the
histogram were built into the page and hidden with CSS, that would be a decoration
view-source defeats. So the proposition page ships without it and fetches it once a rating
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

## 2026-08-15 — Comments post immediately; practices wait

Every other user-content table on this site starts `pending`. `public.comments` defaults to
`published` and is moderated reactively, with the same `status` column and the same
moderator hide policy as everything else.

A practice is a contribution to a corpus and can wait for a volunteer to read it. A reply
that appears a day after the thing it replies to is not a reply. Pre-moderating discussion
on a site with volunteer moderators means no discussion.

The trade is that something can be visible for a while before anyone acts on it. That is
what the hide path, the report queue and the per-account daily limit are for, and all three
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

The cost is real and worth naming: a comment that was reported and then deleted cannot be
read by the moderator handling the report. The alternative is a table that retains text
people asked to have removed, on a site whose privacy notice promises erasure works.
Moderators who need the text intact should **hide** — hiding preserves everything and is the
whole of the moderator power on this table.

There is deliberately no `deleted_by` column, unlike `public.practices`. Only the author can
delete a comment, so the column would record exactly the name the deletion just removed.

The marker a reader sees is rendered from `deleted_at`, not stored. Storing "Removed by its
author" as data would put English prose into the export and into every future consumer, as
though somebody had written it.

## 2026-08-15 — A citation's endpoints are pages; its provenance is comments

`public.citations` links a practice or proposition to another. Comments are not endpoints —
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

## 2026-08-15 — `public.reports` added early, because a report control that files nothing is worse than none

Prompt 10 asks for a report control on every comment. CLAUDE.md has always required the
table; this is the minimum shape of it, built now so the control does something.

It lives in `public` because a browser moderation UI will read it, which makes two policies
the ones worth reviewing closely. A reporter reads their own reports and nobody else's —
without that, the table is a list of who has complained about whom, readable by everyone it
names. And nothing about a report is ever shown on the page: a visible report count turns
reporting into a downvote.

Reports cannot be withdrawn or edited by their author. The queue is a record of what was
raised, and a report retractable after a moderator has read it makes the log incomplete in
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
four moderator UPDATE policies on practices, propositions, comments and reports were dropped
in the same push, and the resolution columns on `reports` lost their UPDATE grant as well.

The alternative — keep the policies, write the audit row from the browser — would have made
"every action writes an audit row" a property of our interface rather than of the database.
The first person to open a console would be outside it. For an audience that reads its own
network tab, a log that can be stepped around is worse than no log, because it invites trust
it has not earned.

Consequences worth knowing before changing anything here:

- A moderator's direct `update public.practices set status = 'hidden'` now succeeds and
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

Enforced in `public.moderate()` by name, for practices, propositions and comments, and backed
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

## 2026-08-16 — "Request changes" writes to the practice, because there is nowhere else

A note to an author has to reach them, and this site has no route to a person: no address any
of our code may read, no server to send mail from, no inbox. So `practices.moderation_note`
holds the current change request and the author reads it under "Your submissions" on their
account page.

The two alternatives were worse. A comment on the pending practice is visible to author and
moderators today and to everybody the moment it is published — a private note that becomes
public on acceptance is a trap. A message table is a second inbox nobody checks.

One note at a time, cleared when the practice is published, because it then describes a
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
limit, cannot express the lateral aggregates the practices query uses, and would cost one
request per dataset per page. A direct connection is one round trip per dataset, is the same
path `supabase db push` already uses from CI, and is the `pg_dump`-shaped exit this project
chose Supabase for in the first place. Handing a job a credential it does not need is how
credentials end up in logs.

The consequence is the line at the top of scripts/export.mjs, in bold: the connection sees
everything, so the WHERE clauses in that file are the entire boundary between public and
private. Everywhere else in this project the policies do that work and a mistake is caught by
them. Not there.

## 2026-08-16 — The build reads data/ or reads nothing

The PostgREST fallback in practices.ts, propositions.ts, comments.ts and citations.ts is
gone. It was correct while the export did not exist and wrong the moment it did: a build with
credentials silently produced a different site from a build without them, and a paused
database would have gone unnoticed until somebody wondered why the corpus had stopped
growing. A missing export now warns on stderr and produces the empty state, which is a
designed state rather than a failure.

This is also what makes the check in prompt 12 meaningful. With every request to
`*supabase.co*` blocked in devtools, all four reading pages render their main content: the
listing, a practice with its comment thread, the propositions index, and a proposition with
its references. The only requests any of them make are the overlay and, on pages that carry a
comment form, the thread's own live top-up — all of which fail silently.

## 2026-08-16 — A freshness card has no link, and that is the honest version

`/practices/<id>/` is generated at build time from the export, so a practice newer than the
export has no page. The overlay could link to one anyway and let GitHub Pages serve the 404;
it does not. The card's title is plain text and the marker says "new since the last build —
its own page follows at the next one".

The alternative designs were worse. Linking is a 404 dressed as a result. Hiding fresh rows
entirely means the first practice ever posted sits under "nothing has been published yet" for
up to a day, which is exactly when a contributor is most likely to conclude the submission
was lost — so both listings also carry a landing place for the overlay in their empty state.

The overlay uses plain `fetch` rather than the Supabase client, deliberately: importing
`supabase.ts` would pull the auth client and its storage adapter into a page whose job is to
be read. Checked in the built output — `/practices/` and `/propositions/` load no supabase
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

## 2026-08-16 — The "related practices" reason is rule-based, not generated

The one-line reason on each related practice is derived from shared metadata (task type,
tags, area) in a fixed priority order, not from model output or any generated text. The
words are always taken from the practice's own fields. This is the constraint the prompt
named: "the words shown are always the author's own". A generated summary of why two
practices are similar would risk mischaracterising the author's stated position, which
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
export has committed fresh practices.json) is a reasonable tradeoff: the related practices
and near-duplicate suggestions are allowed to be a week stale. The moderation queue catches
true duplicates before they are published anyway.
