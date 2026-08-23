# Decisions

One entry per non-obvious choice: what was decided, and the reasoning that would otherwise
have to be reconstructed. Append; do not rewrite history. If a decision is reversed, add a
new entry saying so and leave the old one standing.

---

## 2026-08-13 — Astro as the site generator

Static output is a hard requirement (GitHub Pages, no application server), and the site is
overwhelmingly content: report pages, debate pages, listings. Astro ships zero JavaScript by
default and lets the few genuinely interactive parts — the submission form, the rating widget,
the auth flow — opt in individually. That default matters for this audience specifically: pages
are read on institutional networks and old hardware, and a corpus meant to be citable for years
should not depend on a client-side framework to render its own text.

Rejected: Next.js and SvelteKit, whose static export modes are a supported side path rather
than the primary one. Rejected: a bare static site generator with no component model, because
the report page is a dense, repeated, structured layout and building it from string templates
would not survive contact with a dozen field types.

## 2026-08-13 — Reads are static; the database serves writes and auth only

A nightly job exports published content and rating aggregates to JSON committed to `data/`, and
the site builds from those files. Browsers reach Supabase only to log in, submit, comment,
rate, or confirm a report.

This is what makes the free tier viable in production rather than merely cheap:

- A traffic spike — the realistic scenario being a link circulating on a mailing list — never
  touches the 5 GB egress quota, because reads never reach the database.
- Reading still works when the database is paused, over quota, or down. The site degrades to
  read-only instead of to a blank page.
- The export doubles as the backup the free tier does not provide, *and* as the citable
  machine-readable dataset the project owes its researcher audience. One job, three jobs done.
- The job's own nightly activity prevents the free tier's ~1 week inactivity pause.

Cost: content is up to a day stale. Mitigated by a freshness overlay — listing pages render
from static JSON, then make one background query for rows newer than the build timestamp and
prepend them. When the database is unreachable the overlay fails silently and the static
content stands, which is the correct failure mode.

## 2026-08-13 — Supabase, chosen for the exit and not for the free tier

Supabase is real Postgres and is open source. The exit is `pg_dump` to any other Postgres host,
and the worst case is self-hosting the same components. No proprietary query language, no
proprietary schema format.

The corollary is a standing constraint: **keep logic in Postgres.** Constraints, triggers, RLS
policies, plain SQL. Anything expressed in a vendor-specific layer — Edge Functions in
particular — makes that exit more expensive and should be avoided unless something genuinely
needs an outbound network call at request time.

The free tier's limits (500 MB database, 5 GB egress, no backups, no SLA, pause after
inactivity) shaped the read/write split above rather than the choice of vendor.

## 2026-08-13 — EU region, and why it is load-bearing

The project's users are professional mathematicians, skewed European, working at institutions
with data protection offices that read privacy notices. Personal data processed here — email
addresses, which are additionally never displayed or exported — stays in the EU, so the privacy
notice can say so without qualification.

Two operational consequences: (1) **The region is irreversible.** Changing it means creating a
new project and migrating. (2) It constrains every future service choice: a processor that
cannot keep EU data in the EU is disqualified.

Processors to disclose: Supabase (database, auth), Brevo (transactional email), Cloudflare
(Turnstile), GitHub (hosting).

## 2026-08-13 — The Supabase GitHub integration is not used

Its headline feature is database branching, which is billed per branch-hour and violates the
zero-budget constraint outright. Migrations are plain SQL in `supabase/migrations/`, applied by
the Supabase CLI from `.github/workflows/migrate.yml`, which is the portable path and the same
command a developer runs locally.

## 2026-08-13 — Served at emmazanoli.github.io/MathemAct/, no custom domain

A domain costs money. The cost is a `/MathemAct` path prefix, held in `base: '/MathemAct'` in
`astro.config.mjs` and in `path()`/`asset()` in `src/lib/paths.ts`. Reversal: set `site` and
`base: '/'`, add `public/CNAME`, configure DNS.

`trailingSlash: 'always'` so GitHub Pages serves `index.html` directly without a 301. `path()`
enforces the trailing slash; `asset()` does not, because a trailing slash on a filename names a
non-existent resource.

## 2026-08-13 — GitHub Actions pinned to commit SHAs

Every third-party action is pinned to a full commit SHA with the version in a trailing comment.
A tag is a mutable pointer: whoever controls the action's repository can move `v5` to different
code, and that code would run with this repository's `pages: write` permission and, in the
migration workflow, with a connection string to the live database. A SHA cannot be moved. The
cost — updates are manual and visible in review — is the right trade for a workflow that can
write to production.

## 2026-08-13 — The three public keys are Actions variables, not secrets

`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `PUBLIC_TURNSTILE_SITE_KEY` are stored
as repository **variables**. Astro inlines any `PUBLIC_`-prefixed value into the built JavaScript,
so all three are readable by anyone viewing source on the deployed site. Storing them as secrets
would not hide them from anyone; it would only mask them in CI logs and imply that leaking one is
an incident. It is not — the anon key identifies the anonymous *role*, and RLS is what decides
what that role can do. This split also makes the genuine secrets easier to police: anything in
the secrets list is something whose exposure *is* an incident.

## 2026-08-13 — The migration workflow warns rather than fails when secrets are absent

`migrate.yml` checks whether `SUPABASE_DB_URL` and `SUPABASE_ACCESS_TOKEN` are set and, if not,
emits a GitHub warning annotation and skips the push instead of erroring. The alternative failure
mode is worse: a red X on a workflow that was never configured trains the maintainer to ignore
red X marks, which is how a real migration failure gets missed. The check compares each secret to
the empty string inside an expression, which yields a plain boolean and exposes nothing.

## 2026-08-13 — `compressHTML: false`

Astro's HTML compressor deletes whitespace between a text node and an adjacent inline element
rather than collapsing it, producing `licensedCC BY 4.0`. Keeping the source correct by hand is
not a fix because the editor's formatter re-wraps long lines on save and reintroduces it. Turning
the compressor off removes the failure mode entirely; the output is a few hundred bytes larger
before compression and near-identical after gzip.

## 2026-08-13 — The font stylesheet lives in `public/`, not `src/styles/`

CSS cannot call `path()`, and the site is served under a `/MathemAct` prefix. Putting `fonts.css`
next to the woff2 files means every `src` is a bare filename resolved against the stylesheet's
own URL — correct under any base and surviving a move to a custom domain untouched. Fourteen
files: seven faces, each as a latin and a latin-ext subset, with real `unicode-range` values so
latin-ext is fetched only when a page contains a character in it (Erdős, Poincaré, Ważewski, and
Lindelöf all live there).

## 2026-08-13 — Markdown is sanitised *before* KaTeX renders, not after

Sanitising after KaTeX would mean allowlisting KaTeX's output — dozens of layout classes on
nested spans plus a parallel MathML tree — which in practice means allowing arbitrary spans and
classes and giving up most of what the sanitiser was for. Sanitising first is sufficient: by the
time KaTeX runs, all that survives of a formula is its TeX source as a text node, and KaTeX
escapes what it renders.

Three independent defences:

1. `remark-rehype` is called without `allowDangerousHtml`, so raw HTML is discarded before the
   sanitiser sees it.
2. `rehype-sanitize` runs on the untrusted input, with the default schema extended in exactly one
   respect: `math-inline` and `math-display` are allowed as class *values* on span and div,
   because `rehype-katex` finds formulas by that class.
3. KaTeX runs with `trust: false`, which rejects `\href`, `\url`, `\includegraphics`, and
   `\htmlClass`.

Note: there is no `throwOnError` option — `rehype-katex` always catches parse errors itself,
rendering the offending source in a `.katex-error` span. One malformed formula must not fail the
build.

## 2026-08-13 — Outcome colours go on the tombstone glyph, never on the label

The rule is uniform regardless of contrast ratios: the outcome colour sets the square and the
text label stays in ink. As a graphic the square only needs 3:1; as text the label needs 4.5:1,
which all three colours clear. More importantly, colour must never be the sole carrier of
meaning, so the words should be the primary signal and the colour a secondary cue. See also the
`--outcome-partial` contrast entry dated 2026-08-21, which corrected a wrong figure.

## 2026-08-13 — Cascade layers for the global stylesheet

`base.css` declares `@layer reset, base, layout` and wraps every reset selector in `:where()`,
so those rules carry zero specificity. Astro's scoped component styles are unlayered, and
unlayered styles beat layered ones regardless of specificity, so a component always wins against
a global default without needing a longer selector or `!important`. The practical effect is that
nobody has to know `base.css` exists in order to style a component correctly.

## 2026-08-14 — The affiliation trigger is SECURITY DEFINER; the guard that protects it is not

`private.protect_profile_columns()` reverts every system-owned column on `public.profiles` and is
deliberately **SECURITY INVOKER**. Inside a DEFINER function `current_user` is the function's
owner, not the caller; a DEFINER guard would conclude every caller was trusted, revert nothing,
and read in review as though it worked. As INVOKER, `current_user` is `authenticated` for a
browser and the table owner when the badge trigger (DEFINER, because it must read the private
schema) performs its update. The trusted set is computed via `pg_has_role` rather than a
hardcoded role name.

## 2026-08-14 — Protection is doubled: column grants and a trigger

`UPDATE` on `public.profiles` is granted per column; the trigger reverts the same columns
regardless. The trigger exists for the day someone writes `grant update on public.profiles to
authenticated` to clear the way for a feature — the pgTAP suite tests exactly that. Institution
columns are reverted for admins too: an admin override would make "verified" mean "an admin said
so", which is not a claim this project can make.

## 2026-08-14 — The badge is re-derived when a confirmed address changes

The trigger also fires on address change; a failed match *clears* the columns. Confirm at a
university, move the account to a personal address, keep the institution forever — the trigger
closes that hole.

## 2026-08-14 — The institution is a snapshot, and has no foreign key

The institution triple is copied at badge issuance and never refreshed. A badge claims "this
address was confirmed at this institution on this date"; rewriting it because ROR renamed a record
makes the claim untrue. No foreign key — CI reloads `private.ror_institutions` wholesale and a
routine refresh must not cascade into anyone's profile.

## 2026-08-14 — Candidate suffixes are enumerated, not matched with LIKE

`private.match_institution()` builds the suffix list of a domain and compares each with equality.
`like '%.' || domain` cannot use an index and this runs on every domain in ROR. The bare TLD is
never a candidate: treating a single-label domain as a match would badge an entire country.

## 2026-08-14 — Database tests run in CI, because they cannot run here

WSL is blocked by group policy (`0x80070569`). `test-db.yml` stands up the full local stack on a
runner — the full stack because the `auth` schema and roles are created by the auth service and
every test depends on at least one. It runs on branches; `migrate.yml` only on `main`, so the
tests gate production.

## 2026-08-14 — What the Security Advisor flags, and why it is accepted

Initial check: three `rls_enabled_no_policy` (INFO) on the three `private` tables (RLS with no
policies is deny-all, the intended design) and two `*_security_definer_function_executable` (WARN)
on `public.rls_auto_enable`, a platform-managed object. `migrate.yml` also asserts the invariant
we control: no function in the `private` schema grants EXECUTE to `anon` or `authenticated`.
Postgres grants EXECUTE to PUBLIC on every new function by default. The baseline grew with new
DEFINER functions; see the 2026-08-15 and 2026-08-16 entries.

## 2026-08-14 — The ROR loader reconciles; it does not only upsert

`scripts/load-ror.mjs` stages the whole dump, upserts, then **deletes rows the dump no longer
contains** in one transaction. A stale row would forever hand out badges for a domain the
institution no longer claims. It refuses a load that would more than halve the table (`--allow-shrink`
overrides). It streams rather than reads the file: the v2.11 dump is 291 MB and `JSON.parse` on
it dies with an allocation failure.

## 2026-08-14 — Three domain layers, and why the simple approach was wrong

A vanity domain nobody sends mail from produces a **useless** derived entry, not a harmful one —
the badge is absent either way. The genuinely dangerous outcome is a derived host that another
record has already curated, and that is precisely detectable. Against ROR v2.11, deriving from
each record's website and accepting only hosts claimed by exactly one record accepts 85,860 and
refuses 752 already-curated hosts, 3,196 shared by two or more, 9 public suffixes, and 49 parents
of three or more curated domains. The headline number: only **41.1%** of active European
`education` records carry a domain in ROR's curated field alone.

A domain comes from one of three layers:

| | |
|---|---|
| `manual` | `private.manual_domains`, added by a human with written evidence |
| `ror_domain` | ROR's curated `domains` field |
| `ror_website` | derived by the loader, unique hosts only |

**Longest suffix wins first; source only breaks ties at equal length.** Correctness (specificity)
comes before authority (trust). The block list overrides everything.

The parent-of-many guard: without it the loader was about to map `min-saude.pt` (the Portuguese
health ministry) to a single hospital whose website is a page on it. Those cases are withheld for
human decision — which is also how the high-value ones are found: `psl.eu`, `kyoto-u.ac.jp`.
`institution_source` is stored and never displayed, so a bad derived domain can be traced to the
badges it issued.

## 2026-08-14 — ORCID was built, tested, and removed

Built as an OAuth link on an existing account, covered by 14 pgTAP assertions, removed for scope
— it needed a dashboard registration and added a fifth data processor for a badge nobody had asked
for. If revived: (1) OAuth only, not a self-declared iD; (2) a link on an existing account, never
a sign-in — ORCID OIDC returns no email claim, so an account created by signing in with ORCID
would have no email, no institutional badge, no password reset; (3) connecting a real-name iD to a
pseudonymous account must be disclosed at the point of the decision. Implementation in git history
at `20260814140000_orcid_verified_by_oauth.sql`.

## 2026-08-14 — Implicit flow rather than PKCE for email links

Under PKCE the code in a confirmation link is worthless without a verifier held in the browser
that started the flow. Our users sign up on a laptop in an office and open their mail on a phone;
under PKCE that produces an error indistinguishable from a broken link for an audience already
inclined to read an unfamiliar automated email as phishing. The cost is not one annoyed person; it
is a signup that never completes.

Under implicit flow the tokens arrive in the URL fragment. A fragment is never sent to any server;
the client strips it from the address bar on arrival; the link is single-use. The residual
exposure — browser history and anything with access to the URL — is smaller than a confirmation
flow that breaks whenever mail is read on a different device.

## 2026-08-14 — The header guesses whether you are signed in

The header is on every page, including the ones people come here to read. Deciding between
"Sign in" and "Account" by asking the real session store would mean loading the Supabase client
on the home page, which is the coupling the read/write split exists to prevent. `src/lib/session-hint.ts`
reads `localStorage` directly, matching Supabase's storage key by shape. Both destinations are
real pages that establish the truth for themselves, so a wrong guess costs a click and never a
broken flow. A rename upstream degrades it to "always signed out", which is the harmless
direction. Measured result: the home page ships 240 bytes of JavaScript and the account pages
ship the client.

## 2026-08-14 — Four session states, not two

"Signed out" and "we cannot tell you" are different facts. `SessionState` has `loading`,
`signed-in`, `signed-out`, and `unavailable` with a reason; `Account.astro` renders each in its
own words. A checkout with an unfilled `.env` builds, deploys, serves every page, and says
"accounts are not switched on for this deployment yet" on the eight pages that need them.

## 2026-08-14 — Erasure is a row, not an email

`public.deletion_requests` is written by an authenticated session; the `user_id` is established
by the session rather than typed into a field. Withdrawing deletes the row outright rather than
marking it cancelled. There is no UPDATE grant and no UPDATE policy — `status` is the operator's
and is unreachable from a browser. Reading is limited to the requester and to admins (not
moderators: erasure is an account action, not a content action).

## 2026-08-14 — Signup metadata is read for exactly two keys

`private.handle_new_user()` reads `display_name` and `is_pseudonym` and nothing else. A version
that copied the object wholesale or read `role` would hand out moderator accounts to anyone who
could open a network tab. `006_signup_metadata.test.sql` asserts that a signup asking for
`role: admin`, `is_banned: false` and an institution gets none of them.

## 2026-08-14 — No account enumeration, in the copy as well as the code

Supabase returns a decoy user on signup with a taken address. That protection is undone by an
interface that says "this address is already in use". Sign-in gives the same message for a wrong
password and an unknown address; the password-reset confirmation is phrased conditionally. Some
members have professional reasons to keep their participation private, and a form that answers "is
this person registered" hands that away to anyone who can type.

## 2026-08-14 — A dashboard setting that must match the repo gets a workflow

The minimum password length lives in `LIMITS.password.min` in `src/lib/validation.ts` and in
Supabase Auth's dashboard. `auth-config.yml` reads the dashboard setting through the Management
API and fails on a mismatch. It runs **weekly** — a dashboard change leaves no commit, so a check
that only ran on push would never catch it. It fails (not warns) on a mismatch — missing secret
means the check could not run; mismatch means it ran and found the defect.

## 2026-08-15 — profiles.confirmed_at exists because a policy cannot read auth.users

`authenticated` holds no privilege on `auth.users` and no USAGE on the `private` schema. The
JWT's `user_metadata.email_verified` is writable by the browser — trusting it would let anyone
mark themselves confirmed. So the confirmed-at timestamp is copied to `public.profiles` by the
SECURITY DEFINER trigger that already reads `auth.users` for the badge. It is called `confirmed_at`
rather than `email_confirmed_at` because `002_exposure.test.sql` asserts that no exposed column is
named like an email address.

## 2026-08-15 — Erasure detaches: author_id is nullable, ON DELETE SET NULL

A cascade would make "delete my account" mean "delete the discussion other people had about my
work", which the licence does not permit us to promise. `report_confirmations.user_id` cascades:
a confirmation is an attestation rather than a durable contribution, and an unattributed one could
not be corrected or counted against the one-per-person rule.

## 2026-08-15 — The staleness window is a literal in the view, not a setting

`security_invoker = on` means names in the view resolve with the caller's privileges; anonymous
callers have no USAGE on the private schema, so a settings lookup would fail for exactly the
readers the view exists to serve. Changing the window is therefore a migration — the right weight
for a number that changes every tombstone on the site.

## 2026-08-15 — An author may confirm their own report

Forbidding self-confirmation would refuse the most likely source of a truthful `no_longer_works`.
The tombstone reflects the most recent verdict, whoever filed it.

## 2026-08-15 — The status column grant is wide, and the policy is what narrows it

`grant update (status, ...)` includes `status`, which most callers must never write. Moderators
reach PostgREST as the same `authenticated` role — no column grant can distinguish them; the
moderator policy and `private.protect_report_columns()` restrict it. `author_id` has no column
grant: reassigning a report fails before any trigger runs.

## 2026-08-15 — Submission is one RPC, because a deferred constraint made it one

`reports` must record at least one tool, enforced by a DEFERRABLE INITIALLY DEFERRED constraint
trigger — deferred means at the end of the transaction, and PostgREST gives every request its own.
A browser inserting the report and then its tools in two requests fails on the first, at commit,
before the tools exist. `public.submit_report` is **SECURITY INVOKER**: it buys a transaction and
nothing else. Every policy, grant, constraint and trigger that guards those tables still guards
them through it. A DEFINER function here would be a hole around all of it and would look the same.

`p_author_confidence` is `integer` although the column is `smallint` — Postgres will not
implicitly narrow an integer literal while resolving which function to call, so a smallint
parameter makes `submit_report(..., 8, ...)` fail with "function does not exist".

## 2026-08-15 — A transcript link may not stand alone

A link without an excerpt is evidence that lives on somebody else's server under terms they can
change. `reports_link_needs_excerpt` enforces it. An excerpt without a link is ordinary and
common; a link without an excerpt is refused.

## 2026-08-15 — The three outcomes are given identical weight, deliberately

`OutcomeChoice.astro`: identical size, border, padding and type for all three; outcome colour on
the glyph only, labels in ink; a sentence saying all three are equally useful. These are
constraints on any future change to that component, not observations.

## 2026-08-15 — Draft autosave is per account, in localStorage

Keyed by account id so a shared machine shows each person their own draft. localStorage rather
than the database — a draft is not content and every keystroke to Postgres would hit rate limits.
The draft is discarded only after the write is confirmed; clearing on submit would lose it to a
failed request.

## 2026-08-15 — Reading is built, not fetched

`readCorpus()` runs during the build. The decisive reason: **Astro needs the ids at build time to
generate `/reports/<id>/` at all**, and GitHub Pages has no SPA fallback. A corpus meant to be
cited needs real URLs. A missing export warns on stderr and produces the empty state, which is a
designed state.

## 2026-08-15 — `[hidden]` needs `!important`

The browser's own `[hidden] { display: none }` is in the user-agent stylesheet, which any author
rule outranks. So the moment a component sets `display: flex` on a class, `element.hidden = true`
silently stops working on it. `base.css` carries `[hidden] { display: none !important }` — the
only `!important` in the project, not wrapped in `:where()`, because component scoped styles are
unlayered and otherwise win.

## 2026-08-15 — Filters are URL state, and a stale link says so

Filters are query parameters so a filtered view can be cited. A URL naming a value the corpus no
longer has is reported rather than dropped: "you are seeing more than the person who sent it."
Silently ignoring it widens a cited view without either party finding out.

## 2026-08-15 — The staleness rule is read, never recomputed

Every tombstone comes from `public.report_staleness`. A second TypeScript implementation would be
a second definition of "verified" — divergent with nothing to show that it is.

## 2026-08-15 — The aggregate is a SECURITY DEFINER function under a security_invoker view

A rating row is readable only by the person who wrote it. A plain view with `security_invoker = on`
reads `public.ratings` as the caller — who can see exactly one row. The histogram would be a
histogram of one. So the counting is in `public.rating_aggregate()`, SECURITY DEFINER, which
returns a histogram, median and counts and has no argument by which it can return a score
attributable to anybody. It refuses hidden debates. The view over it stays `security_invoker`,
which still joins `public.debates` so a hidden debate's aggregate does not appear in a listing.
The Security Advisor flags this twice — expected and accepted. The baseline was updated
accordingly; see the 2026-08-16 entry.

## 2026-08-15 — The median is percentile_disc; the mean is now shown as a secondary figure

`percentile_disc` returns a value somebody actually chose; `percentile_cont` interpolates and on
an even number of raters returns 6.5, which is not a point on an eleven-point scale. The mean was
originally forbidden because on a bimodal distribution it reports mild agreement for a community
that has split cleanly into two camps — smoothing over the exact thing this corpus exists to make
visible.

**Reversed 2026-08-21**: the mean is now shown beside the median as a secondary figure, never as
a headline and never on its own. The page says in words that a split community produces a mean
reporting mild agreement and a histogram showing the split. If the mean ever appears as a card
headline, on a sort control, or without the histogram beside it, that is the prohibition being
violated in the way that mattered. The test in `013_ratings.test.sql` was updated to permit the
aggregate function while preserving the display-layer rule.

## 2026-08-15 — The distribution is fetched, not built, so withholding it means something

A histogram built into the page and hidden with CSS is a decoration view-source defeats. The page
ships without it and fetches it once a rating exists. Anonymous readers cannot rate, so they do
not see the distribution; the rule is about who has formed a view before looking, not about who is
logged in.

## 2026-08-15 — A hidden grid child breaks automatic placement

A hidden grid child is removed from flow entirely, shifting every following child up a row. The
histogram has markers absent from nine of eleven columns; each column now has an explicit
`grid-row`. Any grid whose children can be `hidden` needs the same.

## 2026-08-15 — Comments post immediately; reports wait

A reply that appears a day later is not a reply. Pre-moderating discussion with volunteer
moderators means no discussion. The trade — visible before anyone acts — is what the hide path,
the flag queue and the per-account daily limit exist for.

## 2026-08-15 — The comment edit window is in a trigger because permissive policies are OR'd

An author may edit for 24 hours and delete at any age — two permissive UPDATE policies. Postgres
ORs permissive policies together (USING and WITH CHECK). An out-of-window edit satisfies the
delete policy's USING (author's, undeleted) and then the edit policy's WITH CHECK — so the window
in one policy is granted by the other and would be decorative. The window lives in
`private.protect_comment_columns()` and raises 23514. **A restriction cannot live in one
permissive policy if another permissive policy on the same command would admit the row.**

## 2026-08-15 — Deleting a comment destroys the text

The trigger sets `body` to empty string and `author_id` to null; a CHECK requires exactly that
shape. Moderators who need the text intact should **hide**. No `deleted_by` column: only the
author can delete, so it would record the name the deletion just removed.

## 2026-08-15 — A citation's endpoints are pages; its provenance is comments

`public.citations` links reports or debates, not comments — but both ends carry an optional
`*_comment_id` so a "referenced by" entry can point to a paragraph. A trigger requires each
comment id to belong to its end's page. A citation is visible only when **both** endpoints are —
a citation outliving a hidden target would republish removed text on a third page. No UPDATE
grant: immutability is a grant-level fact.

## 2026-08-15 — Citations are the one hard delete on the site

No replies, no attribution to preserve, excerpt at the target. The citer may withdraw their own;
a moderator may remove one whose excerpt should not be there.

## 2026-08-15 — Comments render at build time; new ones show as source

Build-time comments arrive as sanitised HTML; live comments are plain text. Rendering markdown in
the browser means shipping a parser and KaTeX to every reader and sanitising in the one place an
attacker controls. The 24 hour edit window follows: a comment carrying TeX is first seen set at
the next build, so a shorter window would mean nobody could fix a formula that came out wrong.

## 2026-08-15 — `public.flags` added early

A flag control that files nothing is worse than none. Lives in `public` because a browser UI reads
it. A flagger reads their own flags only — without that it is a list of who complained about whom.
Nothing about a flag is shown on the page: a visible count turns flagging into a downvote. Flags
cannot be withdrawn or edited; the queue is a record of what was raised.

## 2026-08-15 — `:scope >` in the thread

A comment element contains its replies, so `item.querySelector('[data-comment-body]')` on a
top-level comment returns the *first reply's* body. Every per-comment lookup in `CommentThread.astro`
uses `:scope >`. This stays true for reports after debates go flat, and the component is shared.

## 2026-08-15 — `auth_leaked_password_protection` is permanent, and the baseline is five

Supabase's check of a new password against a breach corpus is a paid feature. Constraint 1 is
zero budget with no credit card, so it stays off and the warning is permanent. **The baseline is
five and a sixth warning means something new.** A client-side check against Have I Been Pwned was
rejected: Supabase Auth validates the password, not our code, so a browser-side check is advisory
only, and it would put a third-party request into the signup flow of an audience that reads its
own network tab and was promised there are none.

## 2026-08-16 — Moderation goes through one audited function, and the direct path is closed

`public.moderate()` is SECURITY DEFINER, writes to `public.moderation_actions` in the same
transaction, and is the only thing that changes a row on a moderator's behalf. The moderator
UPDATE policies were dropped in the same push. A moderator's direct `update` now succeeds and
changes nothing — that silence is correct and is asserted in three test files. `public.moderate()`
authorises on `auth.uid()`, which is a JWT claim and is unaffected by DEFINER.

## 2026-08-16 — A moderator cannot act on their own contributions

Enforced in `public.moderate()` by name for reports, debates and comments, backed by the absent
moderator policies. With one moderator, that moderator's own submissions can never be published —
the argument for appointing two, which is now in `docs/moderation.md`. No account with moderation
standing can be banned from the screen; no account can ban itself.

## 2026-08-16 — The moderation log is append-only for the owner too, with one exception

A BEFORE UPDATE OR DELETE trigger raises for every caller including the table owner. The exception
is `actor_id` going from a value to null — the foreign key doing `ON DELETE SET NULL` when a
moderator erases their own account; without it the log would make a moderator undeletable. To
remove a row for real, a migration must `ALTER TABLE ... DISABLE TRIGGER` explicitly.

## 2026-08-16 — An erasure records that it happened, not whose account it was

`moderation_actions.target_id` is null for `erase_account`, by CHECK. Recording the user id would
preserve in an append-only log precisely the fact somebody asked to forget. The parameter to
`public.moderate()` is the deletion-request id, not the person's — impossible to erase someone
who has not asked.

## 2026-08-16 — "Request changes" writes to the report, because there is nowhere else

No address any code may read, no server to send mail, no inbox. `reports.moderation_note` holds
the current request; the author reads it under "Your submissions". A message table is a second
inbox nobody checks. One note at a time, cleared on publication.

## 2026-08-16 — /moderate/ ships as the 404 page

Reveals itself only after a signed-in profile comes back with a moderator role: no crawler
indexing, no shareable "you are not allowed" page. What it does not buy: secrecy — templates are
in the HTML, logic in the bundle. Data is defended by RLS. **A gate described as security that is
really courtesy is how somebody later decides RLS is redundant.**

## 2026-08-16 — Expect a sixth Security Advisor warning, and it is `public.moderate`

`public.moderate()` is DEFINER and executable by `authenticated`, so the next migrate run reports
one more `*_security_definer_function_executable` against it. It is DEFINER on purpose: it writes
rows the caller may not write — the audit row above all, which has no INSERT grant to anybody.
**The baseline is six, and a seventh warning means something new.**

## 2026-08-16 — The export reads over a direct connection, not with the service role key

Both authorise the same thing through different doors. A direct connection is one round trip per
dataset, can express lateral aggregates, and is the `pg_dump`-shaped exit this project chose
Supabase for. Handing a job a credential it does not need is how credentials end up in logs. The
WHERE clauses in `scripts/export.mjs` are the entire boundary between public and private —
everywhere else in this project the policies do that work.

## 2026-08-16 — The build reads data/ or reads nothing

The PostgREST fallback is gone: a build with credentials silently produced a different site from a
build without them. With every request to `*supabase.co*` blocked in devtools, all reading pages
render their main content. The only requests any of them make are the overlay and the thread's
live top-up, all of which fail silently.

## 2026-08-16 — A freshness card has no link, and that is the honest version

`/reports/<id>/` is generated at build time from the export, so a report newer than the export
has no page. The overlay could link to one anyway and let GitHub Pages serve the 404; it does not.
The card's title is plain text and the marker says "new since the last build — its own page
follows at the next one." The overlay uses plain `fetch` rather than the Supabase client so a
listing does not pull the auth bundle — checked in the built output.

## 2026-08-16 — The export commits only when content changed

`manifest.json` carries `exportedAt`, which changes every run, so the workflow stages `data/` and
compares against the index excluding the manifest. A push made with `GITHUB_TOKEN` does not start
another workflow (GitHub's recursion guard), so the job calls `gh workflow run deploy.yml`. The
job runs nightly rather than on demand because its own connection stops a free Supabase project
pausing after a week of quiet.

## 2026-08-16 — profiles.json holds only people with something public

Somebody with an account and no contributions has published nothing; copying their display name
into a public repository commit would publish something on their behalf. Erasure removes an
account from every future export and cannot remove it from history or from any downloaded copy —
`data/README.md` says so, and the privacy notice too.

## 2026-08-16 — Pagefind for full-text search

Pagefind indexes the generated HTML after build, writing `dist/pagefind/`. The JS API is used
so results group by content type and connect to the existing filter vocabulary. `/moderate/` is
excluded automatically via `noindex`. The bundle loads at runtime on the search page only.

## 2026-08-16 — Embeddings computed locally on CPU, not via an API

`sentence-transformers/all-MiniLM-L6-v2` (Apache 2.0, 384 dimensions) runs in the GitHub-hosted
runner. No API key, no external call. Stored as int8 base64 — one byte instead of four per float,
~75% smaller, ≤±0.004 error per dimension, negligible at the cosine-similarity thresholds used.

## 2026-08-16 — The "related reports" reason is rule-based, not generated

The one-line reason is derived from shared metadata (task type, tags, area) in a fixed priority
order; the words are always taken from the report's own fields. A generated summary risks
mischaracterising the author's stated position — a serious problem in a citable corpus.

## 2026-08-16 — Near-duplicate detection uses transformers.js from jsDelivr CDN

Loaded lazily on blur of title or aim fields. jsDelivr is an asset CDN for npm packages, not an
analytics service. Model weights (~23 MB quantised) download from HuggingFace Hub on first use
and are cached in IndexedDB. If anything fails the warning does not appear; submission is never
blocked.

## 2026-08-16 — Embed workflow runs weekly, not nightly

~90 MB model download and ~30 seconds of CPU for data that can be a week stale is not a good
trade. The moderation queue catches true duplicates before they are published.

## 2026-08-16 — Network are a separate content type, not a tag on reports

An entry is a pointer, not an account of using something. Conflating them would mean asking for
a verification section from people adding a link and a URL field from people describing a session.
Rate limit is 5/day vs 10 for reports — lower friction, more likely to be abused.

## 2026-08-16 — The link-checker uses SUPABASE_DB_URL, not the service role key

The direct connection is already a secret in CI for the export. Same principle as there: handing
a job a credential it does not need is how credentials appear in logs.

## 2026-08-16 — Bot-rejecting status codes are treated as reachable

403, 405, 406, and 429 prove the server is alive and actively handling the request. 404 and 410
are explicit "this is gone" signals. A false 'unreachable' label — marking working links broken
because they use Cloudflare to block automated HEAD requests from cloud IPs — is worse than no
check, because it tells moderators and readers that working links are broken.

## 2026-08-17 — /debates/view/ is the client-rendered viewer for pre-export debates

A debate posted between exports has no static page. `/debates/view/?id=<uuid>` is a static HTML
shell that fetches its content from Supabase at runtime. The freshness overlay links fresh debates
here instead of rendering unclickable text. Once the nightly build generates the static page, new
external links use `/debates/<id>/`; the view page stays reachable for any existing link.

## 2026-08-17 — Same view-page pattern applied to reports; freshness overlay added to entries

`/reports/view/?id=<uuid>` follows the same pattern as `/debates/view/`. The staleness-confirmation
section and related-reports sidebar are omitted (the confirmation section reads `data-report-id`
at initialisation rather than at submit time, and related reports require the corpus in memory).
Both appear on the static page once the build runs. Network have no internal pages — every card
links to an external URL — so the fix for entries is a freshness overlay that prepends newly
published entries linking directly to their external URLs.

## 2026-08-17 — /account/edit-submission/ closes the "send back for changes" loop

A moderator could request changes and write a note, but the author had no screen to act on it.
`/account/edit-submission/?id=<uuid>` loads the full report via `loadPendingReport`, shows the
moderator's note at the top, pre-fills every form field, and on submit calls `resubmit_report` —
an RPC for the same reason `submit_report` is one: the deferred constraint fires at COMMIT, and
two PostgREST requests are not in the same transaction. No draft system: editing and resubmitting
is one deliberate action.

## 2026-08-17 — /authors/view/, because an author's first report has no author page

`/authors/<id>/` exists only for somebody with a published contribution at the last export, so a
person's first report goes live with their name on it and a 404 under it. `/authors/view/?id=<uuid>`
fetches the profile, published reports, and `report_staleness` for the tombstones. Everything this
page links to is a view page too — this page exists precisely when the export cannot be trusted,
so a link to `/reports/<id>/` would reintroduce the 404 one level down.

## 2026-08-17 — Entry submitter badges: the compact variant, and a sibling

`/network/` passed `profile={entry.submitter}` to `Badges`, which takes `institution`. Astro does
not fail on an unknown prop, so the component rendered its no-institution branch and the badge was
silently blank — a type error in `astro check` the whole time, which is the argument for keeping
that at zero. The fix uses `compact` (the one-line variant for comment headers). The badge sits
*outside* `.entry-card__submitter` because `.badge-line` is a `<p>`, and a `<p>` inside a `<span>`
is invalid markup.

## 2026-08-17 — Author pages cover entry submitters, and list what they submitted

`getStaticPaths` previously built author pages from the report corpus only, so a person whose only
contribution was an entry had a permanent 404. **`listContributors()` in `src/lib/authors.ts`** is
now the union of report authors, entry submitters, and debate authors — the definition of which
author pages exist. `listAuthors()` is gone; the next person looking for "the list of author pages"
would have found it first. Comment-only contributors have no page, because nothing links their name.

Identity comes from `data/profiles.json` rather than from whichever corpus mentioned somebody
first. A report and entry each embed the institution triple; a debate embeds only a name and the
pseudonym flag. Taking identity from the first corpus to mention somebody would have dropped the
institutional badge from anyone who had only ever posted a debate — silently, in the direction that
makes a badge appear missing rather than withheld.

## 2026-08-17 — Debate authors are contributors too, and their names link

Completing the rule: a page exists exactly where a link to it exists. Debate authors were the
remaining case where the *name* was shown and not linked. `listContributors()` includes debate
authors, and author pages list debates between the reports and the entries.

## 2026-08-17 — `.card__facts > li + li` skipped the variant that is not a list

The selector named `li`, missing the two places using `.card__facts` as a `<p>` of `<span>`s. The
column gap is zero, so facts ran flush: `WritingActive since 20 July 2026`. Now `> * + *`.
**An element name inside a shared-class selector is a silent opt-out** — the failure reads as
missing copy rather than missing CSS.

## 2026-08-17 — The landing page becomes a poster: one red, one diagram

The home page runs warm paper, near-black ink, and brick red `#b1231a`, overriding two lines of
CLAUDE.md that forbade cream grounds with warm accents and `01/02/03` markers. Both prohibitions
were rescoped in CLAUDE.md to the reading pages rather than deleted. Kalam is a fourth font family,
fenced to the diagram — mathematics as it is done on a board, not a decorative pseudo-formula.
Self-hosted, latin subset only, never in prose.

## 2026-08-17 — The reading pages adopt the landing palette. One palette again

Four values in `tokens.css` changed the colour of 29 pages. The `--home-*` names survive as
aliases of the real tokens: the home page and footer read better with role names, and a rename
would bury the actual change in noise. Focus rings moved from the accent to ink — a red ring
around a red button is not a focus indicator.

## 2026-08-17 — The home page asks for a submission instead of an email address

Posting is open. "Create an account" and "Post a report" replace `mailto:`. The copy names the
three fields the form will ask for and the ten minutes it takes. It also says an account of
something that did not work is worth as much as one that did — that decision is made before
anybody opens the form.

## 2026-08-17 — Renamed the three content types, and moved the moderation control aside

Practices are **reports**, propositions are **debates**, resources are the **network**. The change
is everywhere: routes, copy, TypeScript, corpus filenames, CSV headers, docs, and the schema. Both
names are load-bearing: the schema is the corpus's public surface named in CSV headers and in
every query against a dump.

**"Report" was already taken**, so the moderation control — `public.reports`, `report_reason`,
`report_status` — became **flag** first, and only then did `practices` move in. The last statement
in migration `20260817130000` asserts over the catalogues, settings keys, and every function body,
and raises if any old vocabulary survived.

## 2026-08-18 — Every listing carries its submit action, unconditionally, above the corpus

`/reports/` had its invite inside its empty state, so **the invitation to post disappeared the day
the first report was published**. There is now one rule for all three: a single `.corpus__action`
at the end of the introduction, above the corpus. **Unconditional**, because an empty listing
whose freshness overlay has found a row hides its own empty state — so the page can show a report
card and, under the conditional version, no way to write another.

## 2026-08-18 — Name the row rather than reflow the select string

supabase-js infers a row from the **literal type** of the select string; TypeScript widens
`'a,' + 'b'` to `string`, so a concatenated select is typed `GenericStringError`. Fix: name the
row and pass it — `.single<PendingReportRow>()` — rather than reflowing onto one line (fixes it
by accident until somebody wraps it again). `astro check` sees these errors; `astro build` does not.

## 2026-08-18 — Display math needs the delimiters on their own lines

`$$…$$` written on a single line is read as **inline** math by remark-math 6, even alone in its
own paragraph — so it renders in textstyle, with `\prod` and `\sum` limits beside the operator
instead of under it. The tell in built HTML is the presence of `math-inline` class rather than
`math-display` on the wrapper. On a site whose readers judge the typesetting before the sentence,
that is the expensive kind of quiet.

## 2026-08-18 — The embed job's two bugs: a missing file, and detection that never detected

`embed.py` prints "nothing to embed" and returns 0 without writing a file; `git add embeddings.json`
on a non-existent path exits 128. A missing file is now `changed=false`. Fixing that exposed the
change-detection step: `embed.py` writes a single JSON line, so any change rewrites that one line —
both versions contain `generatedAt` — and the filter was stripping the content and leaving only
diff headers. Detection now compares staged vs committed with `generatedAt` removed in Python.

## 2026-08-18 — A `counter` prop that counted nothing on two of the four forms

`Field.astro`'s `counter` prop renders the counter element; the page must wire it. The counter
reads `0 / 200` and looks like a loading component rather than an unwired one. It is now
`syncCounters()` and `wireCounters()` in `src/lib/forms.ts`; all four forms use it.

## 2026-08-18 — There is a notification centre, and it is an event table rather than an inbox

`public.activity` and `public.activity_seen`, read at `/account/activity/`. This stores *events*
— a kind, a target, a timestamp, sometimes an actor — and every word a person reads is composed in
`src/lib/activity.ts`. Nothing written by a human, so nothing goes stale.

**Why a table rather than deriving the feed at read time.** Three events cannot be derived: (1)
`public.reports` has no `published_at` — status is the current state; (2) `public.moderation_actions`
is moderator-only — the moderated person must not gain access to it; (3) `public.ratings` is
readable only by its author — a debate's author cannot count ratings on their own debate.

**The moderation trigger hangs off the log.** One `AFTER INSERT` on `public.moderation_actions`
covers all decisions. One audit row per decision, therefore one notification per decision.

**`label` is always the heading of the thing the event is on** — content the subject either wrote
or can already read. Never a comment body, flag detail, or moderator's reason. A flagged comment
resolves to the heading of its thread.

**`is_inbound` is a column.** `private.log_activity()` classifies every kind with a `CASE` that
has no `ELSE`, so adding an enum value without deciding which half it is in raises `case_not_found`
in CI. The header badge is a localStorage guess like session-hint and mod-hint — a live count
would load Supabase on every reading page.

## 2026-08-18 — The activity feed shipped empty, because a trigger cannot see the past

Triggers observe statements; everything before `20260818120100` happened unwatched.
`20260818140000_activity_backfill.sql` reconstructs from `created_at` on each source table and the
moderation log. Only `edited_report` is unrecoverable. `private.log_activity()` gained `p_created_at`
so the reconstruction uses real dates. The dedup key is that timestamp: trigger and source row share
the same `now()`. Granting `created_at` INSERT on any content table would break this.

## 2026-08-18 — The activity feed pages by keyset, because its timestamps are not unique

A trigger writes multiple rows in one transaction, equal to the microsecond — offset pagination
would skip or repeat rows at a boundary inside a group. Sort is `created_at desc, id desc`;
cursor carries both. The timestamp never touches `Date`: `timestamptz` has microseconds, JS `Date`
has milliseconds — round-tripping moves the boundary. It goes back exactly as PostgREST returned it.

## 2026-08-19 — Post-moderation: nothing is approved, and every decision is explained to both sides

Content is published when it is written. A moderator's work starts when somebody flags something,
ends with hide or leave-up, and carries a written explanation that the author and the flagger both
read.

**Why the gate went.** Three costs: (1) it put a volunteer between a mathematician and the corpus,
turning a ten-minute submission into an unknown number of days; (2) it scaled with submissions
rather than with problems — two volunteers answering flags scales with the number of things that
turn out to be wrong; (3) it read as approval, implying the moderators vouched for the mathematics.
They did not and cannot.

**What replaced it.** `public.moderate()` keeps its shape: one audited door, one audit row per
decision, still no moderator UPDATE policies. `publish`, `request_changes` and `promote` now
refuse by name, with a sentence saying the gate is gone rather than a generic refusal.

**The explanation is the new obligation, and it has two recipients.** The same sentence goes into
`public.moderation_actions` (moderator-only log) and `public.moderation_notices` (addressed to a
person). One row per recipient, making the policy `recipient_id = auth.uid()`. A notice never
names the moderator and never names the flagger.

**Hiding closes every open flag that named it.** One decision, one press; each closure is still a
real audit row. `resolve_flag` survives for flags against already-hidden or already-deleted content.

**Editing rethought.** Publishing is now instant, so "frozen at publication" would mean a typo was
permanent one second after it was made. The rule is: **editable while hidden, and until somebody
else has answered it**. A hide is answerable — the author reads the reason and edits; `status` is
reverted by the guard trigger so a save cannot republish. `report_tools` and `report_tags` had to
move with it — their policies gated on the parent being `pending`, and under a "hidden only" rule
every new submission would have broken at the deferred constraint.

## 2026-08-19 — Two private.log_activity()s, and every write on the site failing

The post-moderation migration reissued `private.log_activity()` with a seven-parameter signature,
but `20260818140000` had already replaced it with an eight-parameter one. `create or replace function`
does not replace across a signature change — it created a second overload, and every trigger call
became `function ... is not unique`. Every content write stopped working; reading was untouched so
the site looked healthy. The fix drops the seven-argument overload. `018_activity.test.sql` now
asserts both functions have exactly one overload each. **Before reissuing any function, read the
latest migration that touched it**, not the one that created it.

`test-db.yml` failed on the branch before the merge. `migrate.yml` runs on the same push to `main`
in parallel — not after it — so the migration was applied to production while the suite was going
red. A red branch run is a stop sign.

## 2026-08-19 — "Has anybody answered this?" is a column, because as a subquery it recurses

The editing rule — editable while hidden, and until somebody else has answered — was written as
`not exists` subqueries inside `reports_update_own_editable`. It raised `infinite recursion detected`:
a policy on `public.reports` reading `public.comments` calls the comment policy, which reads
`public.reports`. `public.reports.answered_at` is stamped by a SECURITY DEFINER trigger the first
time a confirmation or comment arrives from somebody other than the author, giving one indexable
comparison per row and the same phrase in the policy, the guard trigger, and the four child-table
policies. `answered_at` has no INSERT or UPDATE column grant; the guard trigger reverts it.

## 2026-08-19 — A ban was in the database and out of reach, and its explanation went nowhere

`ban` and `unban` had been in `public.moderate()` since `20260815200200`; the *effect* always
worked. What did not work:

**The explanation never arrived.** `moderation_notices_subject_is_content` restricted `subject_type`
to the four content kinds — an account is not one. The sentence a moderator is compelled to write
reached other moderators and nobody else, directly contradicting the post-moderation rule for the
harshest decision available.

**A ban could not be lifted.** `unban` was in the enum and the function. Nothing emitted it and
nothing listed banned accounts, so the reversible half of a reversible decision had no route.

**A ban was reachable only from a flag.** Spam produces no flag — people leave rather than flag
an advertisement. A network entry cannot be flagged at all (`public.flags.subject_type` is
`public.content_kind`, which has no `entry`).

What was built: widened CHECK, a notice in the account branch, an accounts section on `/moderate/`
with search and the banned list, a ban control on hidden rows and flags, a suspension banner on
`/account/`. Four decisions inside that: `recipient_role` gained `account_holder` rather than
reusing `author` (a ban may reach somebody who wrote nothing that was decided about); the audit
row moved inside the account branch, removing one way for a later action to log the wrong target;
banning twice is refused (the effect is idempotent, the notification is not); and no "ban and hide
everything" — one decision writes one audit row and one notice.

## 2026-08-20 — Schema version 2 of a report: fifteen sections, and five scales that may all be skipped

The form grew from twelve sections to fifteen. See CLAUDE.md for the full content model. Key
decisions:

**The three example reports were deleted, not migrated.** Backfilling `schema_version = 1` would
leave rows in a citable dataset that answer none of the new questions and nobody can complete. `data/`
was emptied in the same commit rather than waiting for the nightly job, because the export's shrink
guard would have refused the drop — correctly.

**The enums were extended, not converted to text.** `alter type ... add value` is the right weight
for a decision that changes what every past account means. New vocabularies with no enum (career
stage, generalisation, reference kind) are text with a CHECK.

**`task_secondary` is an array of the same enum as `task_type`.** Two spellings of one word is how
two entries for the same task stop being the same filter. The listing's task filter reads primary
and secondary together.

**A hidden scale stores null, not 0.** `ratingsFor()` in `src/lib/reports.ts` is the one place
that decides — it nulls anything that no longer applies. A 0 would put "no help at all" into the
corpus for a question the author was never shown.

**The ratings are sort keys and not filters.** "Reports where helpfulness ≥ 8" reads as a
measurement; an ordering is honest about being rough.

**The third-party affirmation became conditional.** Required when there is a transcript excerpt or
a prompt, not on every submission. An unconditional tick carries no information.

**`"references"` is a quoted column name.** REFERENCES is reserved. The alternative —
`supporting_material` in the database and `references` in the JSON and CSV — is a third name for
one field, a permanent tax on everybody reading the dataset.

**`role` joined the tool table's uniqueness key** as a functional index over `coalesce(role, '')`,
so two role-less rows are still the duplicate they were before the column existed.

**`ReportFields.astro` and `src/lib/report-form.ts`** are the form's markup and behaviour, shared
by `/reports/new/` and `/account/edit-submission/`. **`src/lib/report-facets.ts`** holds the four
derived filter values: the build and the freshness overlay both compute them, and a card whose
recency band was worked out a second way fails a filter it should match.

**`has_prompts` and `has_transcript` are generated columns** so the freshness overlay can answer
"includes the prompts" for rows newer than the export without fetching thousands of characters per
row onto a reading page.

## 2026-08-20 — `was_published` is four answers, and a boolean held three

`true` and `false` were fine; `null` was carrying both *not yet* and *not applicable*. Those are
not the same fact: "of the work that could have been published, how much was?" is unanswerable
when both answers map to null. The column is now text over `yes` / `not_yet` / `no` /
`not_applicable`. The disclosure constraint reads `was_disclosed is null or was_published = 'yes'`.

## 2026-08-20 — Time saved is an ordered list of durations, not a 0-to-10 score

`rating_time_saved` (0 to 10) and `cost_more_time_than_saved` (boolean) are replaced by one
`time_saved` text column. Two things were wrong with the number: a scale has no negative, so the
most useful answer needed a checkbox beside it, and the pair had to be read together; and "8 out
of 10 for time saved" is not comparable between two people, while "about a day" is.

The vocabulary is `none`, `few_minutes`, `about_an_hour`, `few_hours`, `about_a_day`, `few_days`,
`about_a_week`, `more`, `cost_more` — and `cost_more` is deliberately **last** even though it is
the only value below `none`. It is the answer this project most wants and the one an author is
most reluctant to give; putting it last means the reluctant answer is not also the first thing the
reader of the form rules out. The ordering lives in `TIME_SAVED` in `src/lib/report-schema.ts`;
the CHECK constraint is a membership test and says nothing about order.

## 2026-08-20 — A supporting link no longer carries a label

It was the only optional field in a repeating row — the worst place for one. The `kind` already
tells a reader what they are about to open. The field is removed from the form only: the jsonb,
the trigger, and `/reports/<id>/` still handle a `label`, so the column is null on every new row
rather than null where an author declined — a different fact, and the version `data/README.md`
now states.

## 2026-08-20 — Two task types added after the schema landed, in their own migrations

`example_counterexample` and `brainstorming` join the task type enum in separate one-line
migrations. A new enum label cannot be *used* in the same transaction that adds it, so an enum
value and a constraint or default that names it belong in different migrations.

## 2026-08-20 — A dropped column takes its column grant with it, and every submission failed

INSERT and UPDATE on `public.reports` are granted per column — deliberately, so a caller cannot
name `status` or `created_at`. A column added by a later migration arrives with no privilege; a
column dropped and re-added loses the privilege it had. Both happened in schema version 2, and the
whole submission path stopped working.

How it presents: the column is there, the CHECK is there, the policy matches, and
`public.submit_report()` — SECURITY INVOKER precisely so the grants still apply through it — dies
with `permission denied for table reports`. It reads as a policy that stopped matching rather than
one missing grant. The rule again: **grants decide whether the endpoint exists, check them first.**
Any migration that adds, drops or retypes a column on a per-column-granted table issues the `grant`
in the same file. `021_report_schema_v2.test.sql` asserts both columns on both commands.

## 2026-08-21 — `Field.astro` has no `input` slot, and `/network/new/` shipped the wrong controls

`Field.astro` renders its own control from its `type` prop. It has exactly one slot, `hint`. Astro
drops slotted content addressed to a named slot that does not exist — no error, no unused-prop
diagnostic, `astro check` is green. `/network/new/` had been written with `<Field><select
slot="input">…</select></Field>`, so every control was the component's default `<input type="text">`:
no `<select>`, no `<textarea>`. The tell is in the built HTML: grep `dist/` for the element you
think you wrote. The fix is the props API plus a bespoke `fieldset` for the choice list. An
`input` slot was deliberately not added — it would make the same silent failure available again.

## 2026-08-21 — The network category is a closed vocabulary with an `other`, and it is radios

`other` and `category_other` follow the same both-directions CHECK as `reports.area_other`: an
unqualified `other` is a row that has opted out of the axis, and a label on a non-`other` row
will never be displayed and will be read as data by somebody. Radios match Area on the report
form: a select hides the options and their one-line hints, and a category chosen without reading
the alternatives is the one that makes the listing filter useless. The free-text box is cleared
when the category changes away from `other` — left behind, it would fail the CHECK from a field
no longer on screen.

## 2026-08-21 — One prose box on a network entry, not two

"Why mathematicians should care" (`relevance`, 600 characters) was removed and the description's
cap went from 200 to 1000. Two short prose boxes in a row asked one question twice, and 200
characters was not enough once the second box had taken the interesting half of the answer.
`relevance` is **made nullable, not dropped**: dropping it would destroy the only copy of text
somebody wrote by hand, and a null column costs nothing.

## 2026-08-21 — The accessibility page states type properties, and claims no conformance from them

`/accessibility/` opens the *Type and legibility* section by saying WCAG places no requirement on
typeface choice — the load-bearing sentence. The section states properties that can be verified:
x-height at 74% of cap height, body at 17px/1.6, sizes in `rem`, latin-ext shipped, `font-display: swap`.
The reason the Serif / Sans / Mono split belongs here: **Plex Mono dots its zero** while Sans and
Serif do not. Everything meant to be read character by character is already Mono for semantic
reasons, so the family that disambiguates is the family carrying the strings where it matters.
Kalam's limitations — `I`, `l` and `1` are near-identical strokes — are stated rather than omitted,
and the fence is what keeps the limitation acceptable: the day Kalam appears in a sentence, the
page is wrong.

## 2026-08-21 — The debate statement is the page's `h1`, inside the blockquote

A debate page had no `h1` at all — the statement was a `<p>` inside a `<blockquote>`, leaving the
page's first heading as *1. Where do you stand?*, the rating control. It is now `<blockquote><h1>`:
a blockquote takes flow content so a heading is legal inside one; the reverse nesting is not.
This also fixed Pagefind: it takes a result title from the first `h1` and falls back to `<title>`,
so every debate came back in search as *"… — MathemAct"*. The CSS is now `.debate__statement > *`
rather than `> h1`, for the reason already recorded about `.card__facts`: an element name inside a
shared-class selector is a silent opt-out.

## 2026-08-21 — `--outcome-partial` is 4.63:1, and the glyph-only rule was never about contrast

`tokens.css` gave two different ratios for `#8a6a1f` — 4.41:1 in prose and 4.6:1 on the
declaration — and `Tombstone.astro`, `OutcomeChoice.astro` and CLAUDE.md all repeated 4.4:1 with
the conclusion it *fails* the 4.5:1 floor. Computed against `--ground` it is **4.63:1**, which
passes at every text size. The rule — outcome colour on the square, label in ink — stands on the
other reason: colour must never be the sole carrier of meaning. A wrong contrast figure is the
kind of thing somebody later acts on, and the action it invites is darkening a colour that already
clears the floor.

## 2026-08-21 — What the accessibility review changed, and what it deliberately did not

An audit of all 33 built pages had one real defect: the missing debate `h1` above. Three false
positives worth recording: (1) unlabelled controls in tool rows — they live in a `<template>`,
which lxml does not implement; parse built HTML with html5lib when the question is what is in the
accessibility tree; (2) unnamed `<svg>`s on the home page — both are inside `<div aria-hidden="true">`,
and `aria-hidden` inherits; (3) two `<header>`s per page — `header` is only `role="banner"` when
not inside `article`, `aside`, `main`, `nav` or `section`; `.page__header` is inside `main`.

Not built: **no automated accessibility check runs anywhere.** Every claim on `/accessibility/`
was verified by hand on one day.

## 2026-08-21 — One filter engine behind all three listings

The three listings had drifted into unrelated things. Network's filter classes were only ever
styled inside `search.astro`'s *scoped* block, so on `/network/` they matched nothing — the
`Field.astro` slot trap in another costume: valid markup, no warning, feature reads as
unimplemented.

Now: **`src/lib/listing-filters.ts`** is the engine, **`src/components/Listing.astro`** is the
frame, and **`src/lib/listings.ts`** holds each listing's dimensions, sorts and noun — read by
both the frontmatter and the client script, because defining them apart is how a sort option ends
up in a menu with no comparator behind it.

**Debates and network get one dimension each** — area, and category. Offering a filter the data
cannot support reads as a corpus that is empty. Nothing on `/debates/` filters on ratings: a "most
disagreed" filter leaks where the community landed to a reader who has not answered yet.

Two bugs fixed, both invisible on a populated corpus: (1) **the rail lived inside the `length > 0`
branch** — on an empty export the first day the site has content was the one day none of it could
be filtered; (2) **`readUrl()` ran before the overlay resolved** — a link filtering on a value
only today's content carries applied nothing and told the reader "nothing currently has this" —
both halves wrong. `add()` now re-reads the address bar after injecting options.

**The general rule: any feature that reads the corpus has to work on both halves.** A card the
overlay added carries the same data attributes as one the build wrote — that is what
`src/lib/report-facets.ts` exists to guarantee.

`?cat=` still works on `/network/` — `legacyParams` maps the old name forward on read.

## 2026-08-23 — A report page reads in the order the work happened, not conclusion-first

Reversed. `src/pages/reports/[id].astro` opened with **Outcome** and **How this was verified** on
a raised surface, ahead of the narrative, on the argument that they are what a reader is deciding
on and that burying them under the method arranges the page for the author. The order is now
tools → aim → method → prompts → outcome → verification → caveats → supporting material.

The old order answered *is this worth reading* before the page said what "this" was. A reader
arriving at a report has not yet met the work: an outcome sentence read before the aim and the
method is a verdict on something unspecified, and "partially worked" carries nothing until you
know what was attempted and with which model. Tools lead because the model and version are the
first thing that decides whether a report is about the reader's situation at all — a 2024 result
from a superseded model is a different document from the same result last week.

Outcome keeps `field-block--key`; **verification lost it**. Two raised blocks in a row stopped
reading as emphasis and started reading as a panel, and the boxed treatment sat oddly mid-page
now that the narrative runs above it. Verification is still required of every report and still
titled — the constraint was never carried by the box.

Both renderings changed together: `[id].astro` and `src/pages/reports/view.astro`, the runtime
fallback for a report with no static page yet. Those two are the same report seen a day apart,
and letting the order drift between them is the `report-facets.ts` problem in another surface.
