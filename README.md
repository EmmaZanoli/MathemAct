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

Status: skeleton. The deployment pipeline works; no features are built yet.

## Stack

| Layer | Choice |
|---|---|
| Site generator | Astro, static output |
| Hosting | GitHub Pages via GitHub Actions |
| Database + auth | Supabase (free tier, EU region) |
| Auth method | Email + password, mandatory email confirmation |
| Transactional email | Brevo SMTP relay |
| Bot defence | Cloudflare Turnstile, verified by Supabase Auth |
| Math rendering | KaTeX, at build time where possible |
| Full-text search | Pagefind, over built HTML |
| Institution data | ROR, CC0 dump loaded into Postgres |

### The one architectural rule

**Reads are served statically. The database handles writes and auth only.**

A nightly workflow exports published content to JSON committed to `data/`, and the site
builds from those files. Browsers only talk to Supabase when someone logs in, submits,
comments, votes, or confirms a practice. A traffic spike therefore never touches the
egress quota, and reading still works if the database is paused or over quota.

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
supabase test db          # run pgTAP tests
supabase start            # full local stack in Docker, for destructive experiments
```

Pushing to `main` with changes under `supabase/migrations/` applies them via
[.github/workflows/migrate.yml](.github/workflows/migrate.yml).

## Repository layout

```
src/pages/              routes
src/components/         UI components
src/layouts/
src/lib/                supabase client, formatting, validation shared with forms
src/styles/tokens.css   design tokens, single source of truth
public/fonts/           self-hosted woff2
data/                   committed JSON export the site builds from
supabase/migrations/    numbered SQL migrations, applied in order
supabase/tests/         pgTAP tests, RLS especially
scripts/                one-off and scheduled scripts
.github/workflows/      deploy, migrate, nightly export, embeddings, link check
docs/                   governance, runbook, decisions log
```

Non-obvious choices are recorded in [docs/decisions.md](docs/decisions.md).

## Licence

Content contributed to MathemAct — practices, propositions, comments, and the exported
dataset — is published under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Contributors retain copyright
and are credited; reuse requires attribution.
