# Moderation

**Draft.** Everything in the first four sections is a proposal to be revised before the
site opens to real users — particularly the names, the scope rule, and the appeals address.
The rest describes what the code does today and is accurate.

---

## The shape of it, in one paragraph

**Nothing is reviewed before it is published.** A report, a debate and a network entry are
all live the moment they are written. Moderators do not approve anything and cannot: the
actions that did that were removed on 2026-08-19 and `public.moderate()` refuses them by
name. What a moderator does is answer a **flag**: somebody reads something, thinks it does
not belong, and says so. The moderator decides whether it stays up or comes down, and
**writes an explanation that both the author and the flagger read.**

Why this way round is in `docs/decisions.md` under *Post-moderation*. The short version:
pre-moderation put two volunteers between a mathematician and the corpus, scaled with
submissions rather than with problems, and made a corpus of unvetted first-hand accounts
read as though somebody had vetted it.

## Who moderates

| Role | Held by | May |
|---|---|---|
| `admin` | *(to fill in — the person who owns the Supabase project)* | Everything a moderator may, plus process erasure requests |
| `moderator` | *(to fill in — two people, not one)* | Hide, unhide, close flags, ban |
| `member` | Everyone else | Post, comment, rate, confirm, flag |

Roles live in `public.profiles.role` and are set with direct database access. There is no
interface for granting one, deliberately: a screen that can make somebody a moderator is a
screen that can be used to make an attacker one, and this is a decision taken roughly once a
year.

**Two moderators, not one.** A moderator cannot decide anything about their own content or
answer a flag they raised themselves — the database refuses both by name — so a single
moderator would have no second reading on anything, and no way to have their own work looked
at.

Moderation is volunteer-run. That means careful rather than fast, and it is honest to say so
up front: a flag may take days. Since nothing waits on a moderator to be published, a slow
queue no longer means a slow site — it means something questionable stays up a little longer,
which is the trade this design makes deliberately.

## What is in scope

The rule, in one sentence: **moderation is about whether a post belongs in this corpus, not
about whether it is right.**

In scope:

- Not a first-hand account of using an AI tool in mathematical work.
- Third-party unpublished material in a transcript — a referee report, somebody else's
  preprint, private correspondence. This is the specific hazard this site creates by asking
  people to paste real sessions, and it is the one flag reason that should be acted on
  before it is understood.
- An attempt to identify a pseudonymous contributor, or anything that reads as a step
  toward one.
- Abuse, harassment, or sustained hostility toward a person.
- Fabrication: an account of work that was not done, an invented transcript, an invented
  verification step.
- Promotion of a product or of oneself in place of a genuine account.

Out of scope, and this is the important half:

- **Being wrong.** A report reporting that a tool did something it cannot do is a
  contribution to a corpus about what people believe tools do. The answer is a comment
  saying so, not a hide.
- **Being negative.** "This did not work and I would not use it again" is the kind of
  account this corpus is shortest of.
- **Being unfashionable.** Reporting that a widely condemned tool worked, or that a widely
  praised one failed, is a contribution and is treated as one.
- **Heavy AI use.** Admitting to it is the thing this site exists to make possible.
- **Being incomplete.** A verification section that describes what the model said rather
  than what the author checked used to be sent back with a note. There is no sending back
  now. It is a comment asking the question, and the author can still edit the report if
  nobody has answered it yet.

## The explanation, which is the part that is new

Every decision carries one, and it reaches two people.

- **The author of the content** — so that being moderated is something you are told, in
  words, rather than something you discover by absence.
- **Whoever flagged it** — so that flagging is not a message into a void. This is the half
  people forget, and a flag queue that answers nobody teaches the community that flagging
  does nothing.

It lives in `public.moderation_notices`, one row per recipient, and is read at
`/account/#decisions`. Two rules about what it may contain, both enforced by the table
having no column for the thing:

- **It never names the moderator.** A hide is the site's decision, not one person's, and a
  name turns an appeal into a grievance.
- **It never names the flagger.** An author is told their post was flagged and what was
  decided. Who raised it is not part of the answer, and telling them is how a moderation
  system becomes a weapon.

`public.moderation_actions` — the audit log — is a different thing and stays moderators-only.
It names you, and it is written to the other moderators in the shorthand of people who have
read the whole queue. The notice is the same sentence written to a member. In practice this
means **write the reason for the person it is about**, because that is who reads it.

There is a second channel: `public.activity`, the feed at `/account/activity/`. It says
*that* something was decided and links to the explanation. It never carries the reason text
itself. Two channels because a notification nobody can act on is noise, and an explanation
nobody is told about is a file in a drawer.

## Appeals

*(Draft — the address below is the general contact address. Consider a separate one before
opening, so an appeal does not arrive in the same inbox as a missing-institution report.)*

If your content is hidden or your account is suspended, you are told what rule was applied
and why, on your account page. To appeal, write to <matesimpatica@gmail.com> with the
address of the page. A different moderator than the one who decided will read it wherever
there is a different moderator to ask.

Two things that do not get a warning first: attempting to deanonymise a pseudonymous
contributor, and harassment. Everything else does.

An appeal is a private conversation. The moderation log is not published and is not shown to
the person moderated — but the sentence written about them is, which is the change from how
this used to work. What is withheld is the moderator's name and the flagger's, not the
reasoning.

## Editing, and when it stops

**A report is editable by its author while it is hidden, and until somebody else has
answered it.** An answer is a "still works / no longer works" confirmation or a comment.
After that the text is fixed, for anyone, including its author.

The rule is one sentence but it replaced two, so it is worth being explicit about why:

- The freeze exists because **confirmations attest to a version**. Somebody says a report
  still works; if the report can then be rewritten, their confirmation points at text nobody
  can read any more. A comment quoting it has the same problem.
- Until an answer exists there is nothing pointing at the old text, so a correction misleads
  nobody. The old rule froze at publication, which was a proxy for this — a good one while
  publication was a decision somebody took days later, and a useless one now that publishing
  is instant. Without the change, a typo would be permanent one second after it was made.

It is enforced twice, and both are needed: `reports_update_own_editable` refuses the
statement, and `private.protect_report_columns()` decides which *columns* an otherwise
allowed update may touch. `report_tools` and `report_tags` defer to the same condition,
which is what lets `public.submit_report()` insert a report's tools in the same transaction
as the report.

| Situation | What happens |
|---|---|
| A typo, spotted immediately | Edit it from "Your submissions" on the account page. |
| A mistake found after somebody has confirmed or commented | The text is fixed. Post a comment on your own report saying so; the thread is part of the record. A serious error is a case for flagging it yourself. |
| A tool version was wrong | Same, and the tools freeze with the text — a confirmation attests to a tool and a date. |
| The author wants it gone | They can soft-delete their own report at any time. The body is hidden, the thread structure survives, and it leaves the corpus. |
| It is wrong in a way that misleads | Flag it. Hiding is reversible; publishing a correction is not the same thing. |

A **network entry** is editable only while hidden: it has no confirmations and no comments to
freeze against, and it is one link and two paragraphs.

A **comment** is editable for 24 hours, and that window closes early once anybody has
replied. Both limits are in the guard trigger, and both raise a sentence written for the
person who hits them. The 24 hours is one build cycle: comments carry TeX, TeX is rendered
at build time, and a shorter window would mean nobody could fix a formula that came out
wrong.

A **debate**'s wording freezes at its first rating, for the same reason a report's freezes at
its first answer — people agreed with the sentence in front of them.

### How edits are surfaced

They are not, and there is now slightly more to surface than there used to be. There is no
revision history table, no "edited" marker, and no diff:

- A report edited before anyone answered it has, by construction, nothing attached to it that
  the change could mislead.
- A report edited while hidden is read next by a moderator, who sees `updated_at` on the
  hidden queue and a line saying it has been revised.
- A comment edited within 24 hours has, by construction, no replies and is less than a day
  old. `updated_at` is stored and could carry an "edited" marker later; it does not today.

If revision history is ever wanted, the honest version is a table of past versions with a
visible diff, not an "edited" badge. That is a feature, not a patch.

---

## The screen

`/moderate/`. There is no link to it anywhere on the site.

It ships as the not-found page, word for word, and reveals the queue only after the signed-in
account's own profile row comes back with a moderator or admin role. Anyone else — signed
out, a member, or unable to reach the database — sees exactly what a mistyped address gives
them.

**Be clear about what that is worth.** It is not a secret: the templates are in the page's
HTML and the logic is in the bundle, so anyone who guesses the address and reads the source
knows the screen exists. What it prevents is the ordinary case — a crawler indexing it, a
link being shared, a curious reader finding a "you are not allowed" page and concluding there
is something here worth attacking. The page is manners. The wall is row level security: a
member who runs the same queries by hand gets empty arrays, and `public.moderate()` refuses
them by name.

Three sections, in the order they are worked:

1. **Open flags** — oldest first, with the whole of what was flagged shown inline. For a
   report that means the entire submission, verification section and transcript included,
   because a flag saying "this verification is not verification" cannot be answered from a
   title.
2. **Hidden** — everything currently hidden, so that a decision can be reversed and so that
   a revision by its author can be noticed. A report or entry revised while hidden says so,
   with the date.
3. **Erasure requests** — admins only.

`?fixtures` fills the queues with invented rows and skips the gate, for working on the screen
without a moderator account. It exists only in `astro dev`: `import.meta.env.DEV` is `false`
in a production build, so the branch and the fixture data are removed before deploy. Check
the built bundle rather than believing this.

## The actions, and what each one does

Every action goes through `public.moderate()` and writes a row to
`public.moderation_actions` in the same transaction. There is no other route: the moderator
UPDATE policies were dropped in `20260815200300_audited_moderation_only.sql`, so the same
write attempted directly from a console silently changes nothing.

| Action | Effect | Explanation |
|---|---|---|
| Hide it | → `hidden`. Text and attribution are preserved; the author can see it was hidden and can edit it. **Closes every open flag against the same post**, as `actioned`, one audit row each. | **Required.** Read by the author and by every flagger. |
| Leave it up | The flag is `dismissed`. The content does not move. | **Required.** Read by the flagger, and by the author — who learns from it that a flag existed, and never who raised it. |
| Close: already gone | The flag is `actioned` without touching the content. Offered only when what it named is already hidden or deleted. | **Required.** Read by the flagger. |
| Unhide | → `published`, or `active` for a debate. Nothing records the status before hiding, so unhiding publishes. | **Required.** Read by the author. |
| Ban | `profiles.is_banned`. Blocks posting, commenting, rating, confirming and flagging. Reversible. | **Required.** |
| Unban | Lifts it. | **Required.** |
| Erase | Deletes the account. Admins only, and only against a standing request. | Not required — it is a request being carried out, not a judgement. |

**Hiding closes the flags.** This is the one piece of automation in the whole path and it
exists because the alternative was two decisions where there is one: a moderator hides a
comment, and three flags about that comment sit open, and the three people who raised them
are never told. Each closure is still a real audit row with a hand and a time on it.

**`publish`, `request_changes` and `promote` refuse by name.** They are the removed gate.
They raise a sentence saying so rather than "that action does not apply", because a moderator
who has not read the migration will press one and a generic refusal reads as a bug.

### What the log records

Actor, action, target kind, target id, reason, timestamp. It is readable by moderators and
admins and by nobody else — not by the person moderated, not by the flagger. What those two
get is the notice, which is the same sentence without the moderator's name on it.

It is **append-only, including for the table owner**: a trigger refuses every UPDATE and
DELETE. Correcting an entry means adding another. To genuinely remove one — a reason field
containing something it should not — a migration has to `ALTER TABLE ... DISABLE TRIGGER`
explicitly, which leaves the fact in the repository where it belongs.

The single exception is a moderator erasing their own account: the foreign key nulls
`actor_id`, which reaches the table as an UPDATE, and the trigger permits exactly that shape
and nothing else. The decisions stand; the name comes off. The notices they wrote stay too —
they belong to their recipients, and cascade with them rather than with their author.

**An erasure records that it happened and refuses to record whose account it was.** Keeping
the user id would preserve, in a table designed never to be edited, exactly the fact somebody
asked us to forget.

## Erasure

Only admins, and only against a pending row in `public.deletion_requests`, which only the
account holder can write. An admin cannot erase somebody who has not asked, and cannot erase
their own account from this screen — the log would lose the hand that did it to the same
cascade that removed the account.

What erasure does, all of it from foreign keys that have been in the schema since the
beginning:

- the account and its profile are deleted;
- reports and comments have `author_id` set to null — they stay, under CC BY, with no name
  on them;
- ratings and confirmations cascade away — they are answers, not contributions;
- citations and flags keep the row and lose the hand;
- activity rows and moderation notices cascade — both are messages to one person, and a
  message addressed to nobody is not a record;
- the erasure request itself cascades, which is correct: afterwards there must be no row
  saying this person asked to be forgotten.

Nobody sees an address at any point. There is no address column in the exposed schema, no
view over `auth.users`, and no function that returns one — `supabase/tests/002_exposure.test.sql`
asserts all three.

## What is not built yet

Honest list, because a runbook that overstates what exists is how a volunteer discovers a gap
mid-decision.

- **No pagination.** Both queues load in full. Fine at the current size, wrong at a thousand
  open flags.
- **No notification that leaves the site.** Everything a person is told, they are told here:
  a feed row at `/account/activity/` and the explanation at `/account/#decisions`. What does
  not exist is **mail** — nothing reaches somebody who does not come back to the site. That
  would go through Supabase's own templates and 300 messages a day, and is a real design
  decision rather than a switch. It matters more under post-moderation than it did under
  pre-moderation: a hide is now the first thing an author hears about their post, and they
  hear it only if they return.
- **No edit screen for a network entry.** A hidden report is read and rewritten under "Your
  submissions". An entry appears in the same list with the same explanation on it, and there
  the path stops: acting on it means deleting the entry and submitting it again. The row says
  so rather than offering a button that goes nowhere. `network_entries_update_own_hidden`
  already permits the edit, so what is missing is the form and a `resubmit_entry` alongside
  `resubmit_report`, not a policy.
- **A moderator cannot see past decisions on the screen.** `public.moderation_notices` and
  `public.moderation_actions` are both readable by a moderator through PostgREST, and neither
  is shown beside the hidden row it is about. It should be: "this was hidden in July for
  this reason" is the first thing anybody needs when a second flag arrives.
- **Removing a citation is not logged.** A moderator may delete a citation whose stored
  excerpt should not be there — the one hard delete on the site — and that path predates the
  audit log and still bypasses it.
- **Banning is barely visible.** A banned account gets one line in its activity feed saying
  so, and a notice with the reason. Everything else about it still looks ordinary — the post
  forms are not disabled, and the refusal when it tries to post still comes from a policy
  rather than from the interface.
- **Nothing rate-limits flagging.** One person can open a flag on every post on the site,
  once each. The unique constraint stops them doing it twice to the same row and nothing
  stops the sweep.
