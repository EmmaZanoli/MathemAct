# Moderation

**Draft.** Everything in the first three sections is a proposal to be revised before the
site opens to real users — particularly the names, the scope rule, and the appeals address.
The rest describes what the code does today and is accurate.

---

## Who moderates

| Role | Held by | May |
|---|---|---|
| `admin` | *(to fill in — the person who owns the Supabase project)* | Everything a moderator may, plus process erasure requests |
| `moderator` | *(to fill in — two people, not one)* | Publish, send back, hide, unhide, promote, close flags, ban |
| `member` | Everyone else | Post, comment, rate, confirm, flag |

Roles live in `public.profiles.role` and are set with direct database access. There is no
interface for granting one, deliberately: a screen that can make somebody a moderator is a
screen that can be used to make an attacker one, and this is a decision taken roughly once a
year.

**Two moderators, not one.** A moderator cannot act on their own contributions — the
database refuses it by name — so a single moderator would have no way to get their own
submissions published, and no second reading on anything.

Moderation is volunteer-run. That means careful rather than fast, and it is honest to say so
up front: a flag may take days. This is already written on the code of conduct page and
should not be quietly dropped from it when the queue gets long.

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

When a submission is incomplete rather than unwelcome — a verification section that
describes what the model said rather than what the author checked is the common case — send
it back with a note. That is not a rejection and should not read as one.

## Appeals

*(Draft — the address below is the general contact address. Consider a separate one before
opening, so an appeal does not arrive in the same inbox as a missing-institution report.)*

If your content is hidden or your account is suspended, you are told what rule was applied
and why. To appeal, write to <matesimpatica@gmail.com> with the address of the page. A
different moderator than the one who decided will read it wherever there is a different
moderator to ask.

Two things that do not get a warning first: attempting to deanonymise a pseudonymous
contributor, and harassment. Everything else does.

An appeal is a private conversation. The moderation log is not published and is not shown to
the person moderated: the reasons in it are written to other moderators, in the shorthand of
people who have read the whole queue, and they are not the explanation somebody is owed.
What you get is a sentence written to you.

## Editing after publication

**A report cannot be edited once it is published, by anyone, including its author.** The
guard trigger on `public.reports` freezes every content column the moment the status
leaves `pending`.

This is a real constraint and it is deliberate. A report carries "still works / no longer
works" confirmations from other people, and those attest to a version. An account that could
be rewritten afterwards would leave the confirmations pointing at text nobody can read any
more, which is worse than an account with a mistake in it.

What to do instead:

| Situation | What happens |
|---|---|
| The author spots a mistake | They cannot fix it. They post a comment on their own report saying so; the thread is part of the record. A more serious error is a case for hiding it and letting them resubmit. |
| A tool version was wrong | Same. The comment is the correction, and the flag queue is where somebody else raises it. |
| The author wants it gone | They can soft-delete their own report at any time. The body is hidden, the thread structure survives, and it leaves the corpus. |
| It is wrong in a way that misleads | Hide it, with a reason. Hiding is reversible; publishing a correction is not the same thing. |

A **comment** is editable for 24 hours, and that window closes early once anybody has
replied. Both limits are in the guard trigger, and both raise a sentence written for the
person who hits them. The 24 hours is one build cycle: comments carry TeX, TeX is rendered
at build time, and a shorter window would mean nobody could fix a formula that came out
wrong.

A **debate**'s wording freezes at its first rating, for the same reason a report's
does at publication — people agreed with the sentence in front of them.

### How edits are surfaced

They are not, because there are almost none. There is no revision history table, no "edited"
marker, and no diff:

- A published report cannot change, so there is nothing to surface.
- A comment edited within 24 hours has, by construction, no replies and is less than a day
  old. `updated_at` is stored and could carry an "edited" marker later; it does not today.
- A **change request** is visible to its author under "Your submissions" on their account
  page, with the date it was asked, for a report and for a network entry alike. It is
  cleared when the submission is published, because it then describes a version that was
  accepted. Since 2026-08-18 the author is also told a change was asked for in their
  activity feed, which links back to that section.

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

Five queues, in the order they are worked:

1. **Reports waiting** — oldest first. The whole submission is on screen, including the
   verification section and the transcript, because a decision made from a title is not a
   decision.
2. **Debates waiting** — a debate promotes itself once five people have answered
   it (`private.settings`, key `debate_activation_ratings`). Promoting one by hand says
   the question is worth asking, not that you agree with it.
3. **Open flags** — with the flagged row shown inline.
4. **Hidden** — everything currently hidden, so unhiding is reachable.
5. **Erasure requests** — admins only.

`?fixtures` fills the queues with invented rows and skips the gate, for working on the screen
without a moderator account. It exists only in `astro dev`: `import.meta.env.DEV` is `false`
in a production build, so the branch and the fixture data are removed before deploy. Check
the built bundle rather than believing this.

## The actions, and what each one does

Every action goes through `public.moderate()` and writes a row to
`public.moderation_actions` in the same transaction. There is no other route: the moderator
UPDATE policies were dropped in `20260815200300_audited_moderation_only.sql`, so the same
write attempted directly from a console silently changes nothing.

| Action | Effect | Reason required |
|---|---|---|
| Publish | `pending` → `published`. Clears any change request. In the corpus at the next build. | No |
| Send back | Stays `pending`. Writes the note onto the report, where its author reads it. | **Yes** |
| Hide | → `hidden`. Text and attribution are preserved; the author can see it was hidden. | **Yes** |
| Unhide | → `published`. Nothing records the status before hiding, so unhiding publishes. | No |
| Promote | A debate: `proposed` → `active`, with the date it joined the record. | No |
| Close: acted / nothing to do | The flag is `actioned` or `dismissed`, with the hand and the time. | No |
| Ban | `profiles.is_banned`. Blocks posting, commenting, rating, confirming and flagging. Reversible. | **Yes** |
| Erase | Deletes the account. Admins only, and only against a standing request. | No |

Hiding something and closing the flag that named it are two decisions and produce two
rows. Do the hiding first: a flag closed against content still on the site is the failure
this ordering exists to prevent.

### What the log records

Actor, action, target kind, target id, reason, timestamp. It is readable by moderators and
admins and by nobody else — not by the person moderated, not by the flagger.

It is **append-only, including for the table owner**: a trigger refuses every UPDATE and
DELETE. Correcting an entry means adding another. To genuinely remove one — a reason field
containing something it should not — a migration has to `ALTER TABLE ... DISABLE TRIGGER`
explicitly, which leaves the fact in the repository where it belongs.

The single exception is a moderator erasing their own account: the foreign key nulls
`actor_id`, which reaches the table as an UPDATE, and the trigger permits exactly that shape
and nothing else. The decisions stand; the name comes off.

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
- the erasure request itself cascades, which is correct: afterwards there must be no row
  saying this person asked to be forgotten.

Nobody sees an address at any point. There is no address column in the exposed schema, no
view over `auth.users`, and no function that returns one — `supabase/tests/002_exposure.test.sql`
asserts all three.

## What is not built yet

Honest list, because a runbook that overstates what exists is how a volunteer discovers a gap
mid-decision.

- **No pagination.** Every queue loads in full. Fine at the current size, wrong at a
  thousand pending rows.
- **No notification that leaves the site.** An author is now told in the interface: every
  decision this screen takes writes a row to `public.activity`, which they read at
  `/account/activity/`. What they see is the outcome and the date — never the moderator's
  name and never the reason text, which is written to another moderator. A change request
  still reads under "Your submissions", where the note itself is. What does not exist is
  **mail**: nothing reaches somebody who does not come back to the site. That would go
  through Supabase's own templates and 300 messages a day, and is a real design decision
  rather than a switch.
- **No edit screen for a network entry.** A report that is sent back is read and rewritten
  under "Your submissions" — that screen has existed since 2026-08-17. An entry appears in
  the same list, in the same state, with the same note on it, and there the path stops:
  acting on the note means deleting the entry and submitting it again. The row says so
  rather than offering a button that goes nowhere. `resources_update_own_pending` already
  permits the edit, so what is missing is the form and a `resubmit_entry` alongside
  `resubmit_report`, not a policy.
- **Removing a citation is not logged.** A moderator may delete a citation whose stored
  excerpt should not be there — the one hard delete on the site — and that path predates the
  audit log and still bypasses it.
- **No view of the log in the interface.** It is readable through PostgREST by any moderator
  and is not on the screen. It should be, next to each queue.
- **Banning is barely visible.** A banned account now gets one line in its activity feed
  saying so. Everything else about it still looks ordinary — the post forms are not
  disabled, and the refusal when it tries to post still comes from a policy rather than
  from the interface.
