# ROR data

The institutional badge is derived by matching a confirmed email domain against the
**Research Organization Registry**. This is where that data comes from, what it costs, and
what it does not cover.

## Licence

ROR data is released under **[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)**,
a public domain dedication. There is nothing to attribute, no terms to accept, and no
restriction on redistribution — the dump can be loaded, transformed, and included in our
own exports without qualification.

We credit ROR anyway, on the about page and here, because it is a community-run public
good and saying where the data came from is the whole point of a disclosure project.

## Where the dump comes from

Releases live on Zenodo under a **concept DOI** that always resolves to the newest one:

> **<https://doi.org/10.5281/zenodo.6347574>**

Download the `.zip`, unzip it, and pass the JSON file to the loader. Do not commit it: it
is 290 MB unzipped, it changes on ROR's schedule rather than ours, and a copy in the
repository would go stale silently. It is in `.gitignore` by extension — keep it outside
the working tree.

### The release this was built against

| | |
|---|---|
| Version | `v2.11` |
| Published | 2026-08-03 |
| DOI | [10.5281/zenodo.21773148](https://doi.org/10.5281/zenodo.21773148) |
| Archive | `v2.11-2026-08-03-ror-data.zip`, 34 MB |
| JSON | `v2.11-2026-08-03-ror-data.json`, 291 MB |
| Records | 135,710 |

### A naming change worth knowing about

Releases from **1.45 (2024-04-11) to 1.74 (2025-11-24)** shipped both schema versions in
one archive, and the v2 file ends `_schema_v2.json`. From **2.0 (2025-12-16)** onward
there is only schema v2 and the suffix is gone, e.g. `v2.11-2026-08-03-ror-data.json`.

The loader reads schema v2 only. If it reports that the file is not a ROR dump, check
that you unzipped it and passed the `.json` rather than the `.csv`.

## Loading it

```sh
# Parse and report without touching any database. Needs no credentials.
node scripts/load-ror.mjs path/to/v2.11-2026-08-03-ror-data.json --dry-run

# Load for real.
export SUPABASE_DB_URL="postgresql://..."     # $env:SUPABASE_DB_URL in PowerShell
node scripts/load-ror.mjs path/to/v2.11-2026-08-03-ror-data.json
```

The load is one transaction. It stages the whole dump, upserts, and then **deletes rows
the dump no longer contains** — a pure upsert would leave a withdrawn institution handing
out badges forever. If a load would more than halve the table it refuses, on the
assumption that a partial file was passed by mistake; `--allow-shrink` overrides that.

Profiles are untouched by a reload. `profiles.institution_name` and
`institution_country` are a point-in-time snapshot with deliberately no foreign key, so a
data refresh cannot rewrite anyone's badge or fail because someone holds one.

## Refresh quarterly

ROR publishes roughly monthly. **Reload once a quarter**, and after any ROR schema
announcement.

Quarterly rather than monthly because the cost of being slightly behind is small and
bounded — a new institution's staff cannot get a badge until the next load — while the
cost of an unattended automated load against production is not. Someone should be watching
when the institution table is rewritten.

`.github/workflows/ror-verify.yml` runs monthly on a throwaway database: it downloads the
current release, runs the loader against it, and reports what the matcher makes of a list
of real mathematics institutes. That catches a schema change on disposable infrastructure
before anyone runs a real load. It never touches production.

## What gets loaded, and what gets skipped

Only four fields are extracted: the ROR id, the `ror_display` name, the country code and
name from the first location, and every entry in `domains`. Domains are lowercased, a
leading `www.` is stripped, and anything that is not a plausible hostname is dropped.

From v2.11:

```
records read              135,710
institutions loaded        30,780
domains loaded             31,125

skipped
  no domains field        101,926
  inactive or withdrawn     3,004   (inactive 1,595, withdrawn 1,409)
```

## The limitation that matters

**Only about 23% of active ROR records carry a domain at all.** A record with no `domains`
entry can never produce a badge, no matter how well known the institution is. This is not
a bug in the loader; the field is genuinely empty upstream.

Verified in v2.11, all present, all active, all with an empty `domains` array:

| Institution | ROR | Website recorded | Domain recorded |
|---|---|---|---|
| Max Planck Society | `01hhn8329` | mpg.de | — |
| MPI for Mathematics in the Sciences, Leipzig | `00ez2he07` | mis.mpg.de | — |
| MPI for Mathematics, Bonn | `02dh8ja68` | mpim-bonn.mpg.de | — |
| Mathematical Research Institute of Oberwolfach | `001zbj766` | mfo.de | — |
| Institut Mittag-Leffler | `02z85gz67` | mittag-leffler.se | — |
| Leiden University | `027bh9e22` | leiden.edu | — |

Leiden University is on that list, which is a pointed illustration given whose declaration
this project works under.

**We do not fall back to the `links` website field**, and should not. Leiden's recorded
website is `leiden.edu`, while its staff actually write from `@leidenuniv.nl` and
`@universiteitleiden.nl`. Deriving a match domain from a marketing URL would produce
badges that are wrong rather than merely absent, and a wrong badge is far more damaging to
this project than a missing one.

The honest options, none of them taken yet:

1. **Contribute the domains upstream.** ROR accepts curation requests, and a fix there
   helps everyone rather than only us. Slow, and correct.
2. **A small curated supplement**, in its own table, consulted after ROR, with each entry
   recording who added it and on what evidence. Faster, and it makes us the authority for
   those rows — which is a real responsibility, not a shortcut.
3. **Accept the gap.** Affected users are Registered rather than Institutional. Their
   accounts work; the badge is simply absent.

Until one is chosen, expect a mathematician at Oberwolfach or the MPI in Bonn to sign up
and get no badge, and expect them to ask why. The answer is above.
