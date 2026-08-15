# MathemAct

*Collectively shaping the future of mathematical research in the age of AI.*

A platform for the mathematics research community to collect **structured, first-hand
accounts of how AI tools are actually used in mathematical work** — and to record where
the community agrees and disagrees about how they should be used.

The Leiden Declaration on AI and Mathematics supplies the principles, including its call
for a "Tool and computational resource disclosure" section in papers. MathemAct is the
practice layer underneath: a corpus concrete and well-structured enough that journals
could adopt its posting schema as a disclosure template.

Two consequences worth stating up front. **Failures are first-class content** — a corpus
of only successes is worthless and reads as advertising. And **the corpus is
machine-readable and downloadable**, because researchers studying AI adoption in
mathematics are part of the intended audience.

## Status

Public site, identity layer, account flows, the submission form, and reading built.
**Nothing is moderated yet** — no submission can reach the corpus until a moderator can
publish it.

| | |
|---|---|
| ✅ | Deploy pipeline, GitHub Pages, 404 |
| ✅ | Design system, self-hosted IBM Plex, the QED tombstone |
| ✅ | Home, about, privacy, code of conduct — written, not stubbed |
| ✅ | Markdown-with-TeX rendering, sanitised at build time |
| ✅ | Profiles, RLS, institutional badges derived server-side |
| ✅ | ROR loader, 132,706 institutions, 116,985 domains |
| ✅ | Sign up, confirm, sign in, reset, profile, erasure request |
| ✅ | Practices schema: RLS, tags, confirmations, staleness, rate limits |
| ✅ | The submission form: twelve sections, draft autosave, one-transaction submit |
| ✅ | Reading: listing with linkable filters, practice pages, author pages |
| ✅ | Propositions, the agreement scale, and the histogram — median, never a mean |
| ⬜ | Moderation, nightly export, search |

The account pages need `PUBLIC_SUPABASE_ANON_KEY` and `PUBLIC_TURNSTILE_SITE_KEY`, plus
the dashboard configuration in [docs/auth.md](docs/auth.md). Without them they render a
plain "accounts are not switched on for this deployment yet", and the rest of the site is
unaffected.

## Stack

| Layer | Choice |
|---|---|
| Site generator | Astro, static output |
| Hosting | GitHub Pages via GitHub Actions |
| Database + auth | Supabase (free tier, EU region) |
| Auth method | Email + password, mandatory email confirmation |
| Transactional email | Brevo SMTP relay |
| Bot defence | Cloudflare Turnstile, verified by Supabase Auth |
| Math rendering | KaTeX, at build time |
| Full-text search | Pagefind, over built HTML |
| Institution data | ROR, CC0 dump loaded into Postgres — see [docs/ror.md](docs/ror.md) |

### The one architectural rule

**Reads are served statically. The database handles writes and auth only.**

A nightly workflow exports published content to JSON committed to `data/`, and the site
builds from those files. Browsers only talk to Supabase when someone logs in, submits,
comments, votes, or confirms a practice. A traffic spike therefore never touches the
egress quota, and reading still works if the database is paused or over quota.

### Identity, in one paragraph

Two tiers: Registered, and Institutional on top of it. Affiliation is never claimed — it
is derived from the confirmed email domain, matched against ROR by a `SECURITY DEFINER`
trigger. **There is no request shape that carries an affiliation from a browser into the
database.** Those columns have no `UPDATE` grant *and* are reverted by a `BEFORE UPDATE`
trigger, and the pgTAP suite proves both by widening the grant itself and trying anyway.
The email address is never displayed, never returned by the API, never exported, and never
shown to moderators.

### Accounts

Email and password with mandatory confirmation, Cloudflare Turnstile on the four pages that
send mail or take a password, and no account enumeration anywhere — sign-in gives one
message for a wrong password and an unknown address, and the reset confirmation is phrased
conditionally on purpose.

All of it is client-side, because there is no server. `src/lib/auth.ts` holds every
operation and returns finished prose rather than error objects; `src/lib/session.ts` is a
four-state store where "signed out" and "we cannot tell you" are different answers. The
header does **not** load any of this — it guesses from `localStorage`, so a reading page
ships 240 bytes of JavaScript and never touches Supabase.

Dashboard configuration — redirect URLs, CAPTCHA, SMTP, and rewritten email templates —
is in [docs/auth.md](docs/auth.md). None of it is in this repository, which is where the
secrets are not.

## Local development

Requires **Node 22.19 or newer**.

```sh
npm install
cp .env.example .env     # then fill in the two blank values
npm run dev              # http://localhost:4321/MathemAct/
npm run build            # writes dist/
npm run preview          # serves dist/
npm run check            # Astro + TypeScript diagnostics
```

Note the `/MathemAct/` path in the dev URL. The site is a GitHub Pages project site, so
it is served under a path prefix, and `astro dev` reproduces that. **Never hardcode
internal paths** — build them with `path()` or `asset()` from
[src/lib/paths.ts](src/lib/paths.ts).

### Environment variables

The three `PUBLIC_*` variables in [.env.example](.env.example) are public by design and
ship to the browser. The Supabase service role key, the Brevo SMTP key, and the Turnstile
secret key must never appear in this repository — that file documents where each of them
actually lives.

### Database migrations

Plain SQL in `supabase/migrations/`, applied in order by the Supabase CLI. **Append-only:
never edit an applied migration, add a new one.**

```sh
supabase login
supabase link --project-ref fgnmafmzracdytpfqpel
supabase db push          # apply to the remote database
supabase start            # full local stack in Docker
supabase test db          # run the pgTAP suite against it
```

Pushing to `main` with changes under `supabase/migrations/` applies them via
[.github/workflows/migrate.yml](.github/workflows/migrate.yml), which then reports the
Security Advisor findings and asserts that nothing in the `private` schema is executable by
a browser role.

**Branch first for anything touching the database.** `test-db.yml` runs on branches and
pull requests; `migrate.yml` runs only on `main`. So the suite is a gate in front of
production rather than a report after it.

### Database tests

233 pgTAP assertions across thirteen files in `supabase/tests/`, covering domain matching, the
API surface, badge derivation, write protection, matching precedence, what signup metadata
is allowed to set, who may file or read an erasure request, every practice policy from both
directions, the constraints that make a practice a report, the tombstone rule, the rate
limits, the submission RPC, and the agreement scale.

Every policy is asserted from both sides. A test that only checks the allowed case proves
the feature works and says nothing about whether it is a door.

They run in CI rather than locally, because the primary development machine is a managed
Windows laptop where WSL is blocked by group policy — there is no container runtime, so
`supabase start` cannot run at all. That turned out to be the better home for them: they
now gate every change rather than depending on someone remembering.

### Loading ROR

```sh
node scripts/load-ror.mjs path/to/ror-data.json --dry-run   # no database needed
```

Full instructions, the licence, the refresh cadence, and the domain-coverage caveats are in
[docs/ror.md](docs/ror.md). `ror-verify.yml` loads the current release into a throwaway
database monthly and reports what the matcher makes of real mathematics institutes.

## Repository layout

```
src/pages/              home, about, privacy, code of conduct, 404
src/pages/account/      sign up, confirm, sign in, sign out, reset, password, profile, erase
src/pages/practices/    the listing, a practice, the submission form
src/pages/authors/      one contributor's published practices
src/pages/propositions/ the index, a proposition, and the suggest form
src/components/         Tombstone, Markdown, Badges, Field, FormStatus, Turnstile
src/layouts/            Base (shell), Page (long-form prose), Account (forms + session gate)
src/lib/                paths, site constants, status vocabulary, markdown, auth, session,
                        profile queries, validation, formatting, form helpers
src/styles/             tokens.css (single source of truth), base.css, forms.css
public/fonts/           self-hosted IBM Plex woff2 + the @font-face that loads them
data/                   committed JSON export the site builds from (not yet populated)
supabase/migrations/    numbered SQL, applied in order, append-only
supabase/tests/         pgTAP: RLS, grants, triggers, matching
scripts/load-ror.mjs    streams the ROR dump into the private schema
.github/workflows/      deploy, migrate, test-db, ror-verify, auth-config
docs/                   decisions log, ROR notes, auth runbook
```

Non-obvious choices are recorded in [docs/decisions.md](docs/decisions.md), including the
ones that turned out to be wrong — superseded entries are marked rather than deleted.

## Licence

Content contributed to MathemAct — practices, propositions, comments, and the exported
dataset — is published under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Contributors retain copyright
and are credited; reuse requires attribution.
