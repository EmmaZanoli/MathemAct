-- The activity feed: who is told what, and — more important — who is not.
--
-- Four of the assertions in this file are the reason it exists, and each of them is a rule
-- that would be invisible if it broke. A feature that tells people things fails silently in
-- both directions: a missing notification looks like nothing happening, and an extra one
-- looks like a feature.
--
--   **A moderation outcome never names the moderator.** The author is told what was decided.
--   Naming who decided it turns a hide into a grievance with an address on it, and it would
--   hand back, in a table the moderated person can read, exactly what keeps
--   public.moderation_actions restricted to moderators.
--
--   **A rating never names the rater.** public.ratings is readable only by its author, which
--   is what keeps a debate's aggregate hidden until somebody has taken a position. A feed row
--   carrying the rater's id would be that policy undone one table over.
--
--   **The person flagged is never told.** Not that it happened, not by whom. There is no
--   enum value for it, and this asserts that none appears by another route.
--
--   **Nobody can write a row.** There is no INSERT grant to any browser role, so a
--   notification is always something the database observed rather than something an account
--   claimed. A forged "a moderator published your report" is worth more to an attacker than
--   most of what this schema protects.
--
-- Fixtures are created as the table owner, which is how every other file here works: the
-- triggers under test fire on the statement regardless of who ran it, and the assertions
-- that are about a browser run under `set local role`.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(39);

-- ── People ──────────────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'author@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reader@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'moderator@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leaver@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now();

update public.profiles set role = 'moderator' where id = '11111111-0000-0000-0000-000000000003';

-- ── Things to be told about ─────────────────────────────────────────────────────────

insert into public.reports (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed
) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'published', 'Checking a lemma in Lean', 'research', 'proof_checking',
   'Confirm a lemma.', 'Stated it in Lean.', 'worked', 'It closed.', 'Lean accepted it.', true),

  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'pending', 'Still waiting for review', 'writing', 'exposition',
   'Draft a seminar note.', 'Asked, then rewrote.', 'partial', 'Half usable.',
   'Checked by hand.', true);

insert into public.debates (id, author_id, statement, area, status, activated_at)
values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'AI-assisted literature search should be disclosed in papers.', 'writing', 'active', now());

-- ── The shape of the table ──────────────────────────────────────────────────────────
-- Grants before anything else, because a missing grant and a missing policy look identical
-- from a browser, and these four decide whether the endpoint exists at all.

select ok(
  not has_table_privilege('anon', 'public.activity', 'SELECT'),
  'anon has no endpoint on the activity feed at all'
);

select ok(
  not has_table_privilege('authenticated', 'public.activity', 'INSERT'),
  'no browser role can write a feed row: a notification cannot be forged'
);

select ok(
  not has_table_privilege('authenticated', 'public.activity', 'UPDATE'),
  'and none can rewrite one'
);

select ok(
  not has_table_privilege('authenticated', 'public.activity', 'DELETE'),
  'and none can remove one'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.activity'::regclass),
  'row level security is enabled on the activity feed'
);

-- ── What you did ────────────────────────────────────────────────────────────────────
-- The fixtures above are the acts: two reports posted. Nothing else has happened yet.

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'posted_report'),
  2,
  'posting a report puts it in your own feed'
);

select ok(
  (select bool_and(not is_inbound) from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'),
  'your own acts are not inbound, so they never count as unread'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and is_inbound),
  0,
  'and nothing has happened to this author yet'
);

-- ── Somebody comments ───────────────────────────────────────────────────────────────

insert into public.comments (id, parent_type, parent_id, author_id, body)
values
  ('44444444-0000-0000-0000-000000000001', 'report', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'Did the elaborator accept it without hints?');

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'content_commented'),
  1,
  'the author of a report is told when somebody comments on it'
);

select ok(
  (select is_inbound from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'content_commented'),
  'and it is inbound, so it counts as unread'
);

select is(
  (select actor_id from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'content_commented'),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'a comment names the person who wrote it: this is public either way'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000002'
      and kind = 'commented'
      and not is_inbound),
  1,
  'and the commenter gets their own log entry for it'
);

-- Commenting on your own report. The own-action row appears; the notification does not.
insert into public.comments (id, parent_type, parent_id, author_id, body)
values
  ('44444444-0000-0000-0000-000000000002', 'report', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'To answer my own question: no, it needed one.');

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'content_commented'),
  1,
  'commenting on your own report does not notify you about yourself'
);

-- A reply. The comment being replied to has an author, and that is who hears about it.
insert into public.comments (id, parent_type, parent_id, author_id, in_reply_to, body)
values
  ('44444444-0000-0000-0000-000000000003', 'report', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001',
   'It did, once the instance was in scope.');

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000002'
      and kind = 'comment_reply'),
  1,
  'a reply tells the author of the comment it answers'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'content_commented'),
  1,
  'and not, a second time, the author of the report the thread is on'
);

-- ── Somebody rates ──────────────────────────────────────────────────────────────────

insert into public.ratings (debate_id, user_id, score)
values ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 8);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'debate_rated'),
  1,
  'the author of a debate is told that somebody rated it'
);

select is(
  (select actor_id from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'debate_rated'),
  null::uuid,
  'and never which somebody: a rating is readable only by its author'
);

-- An explicit "no opinion" is a real row and a real answer, and it is not a rating. It
-- belongs in the rater's own log and in the coverage number, not in the author's feed.
insert into public.ratings (debate_id, user_id, score)
values ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003', null);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'debate_rated'),
  1,
  'declining to take a position does not read as a rating to the debate author'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000003'
      and kind = 'rated_debate'),
  1,
  'but it is in the rater''s own record, because they did answer'
);

-- ── A moderator decides ─────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000002', 'publish') $$,
  'a moderator publishes the pending submission'
);

reset role;

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'report_published'),
  1,
  'and the author is told, which nothing on this site did before'
);

select is(
  (select actor_id from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'report_published'),
  null::uuid,
  'the decision is reported; the moderator who took it is not named'
);

select is(
  (select label from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'report_published'),
  'Still waiting for review',
  'the row carries the title, so the feed can say which submission'
);

-- Hiding a comment. The row moves to the thread, because a link to a comment is a link to
-- the page it is on.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('comment', '44444444-0000-0000-0000-000000000001', 'hide',
                            'Off topic for this report.') $$,
  'a moderator hides a comment'
);

reset role;

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000002'
      and kind = 'content_hidden'
      and comment_id = '44444444-0000-0000-0000-000000000001'),
  1,
  'the comment''s author is told it was hidden'
);

select is(
  (select target_id from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000002'
      and kind = 'content_hidden'),
  '22222222-0000-0000-0000-000000000001'::uuid,
  'and the row points at the thread rather than at a comment with no page of its own'
);

-- ── A flag ──────────────────────────────────────────────────────────────────────────
-- The one place the subject of a decision is the person who asked for it rather than the
-- person it was about.

insert into public.flags (id, subject_type, subject_id, flagger_id, reason, detail)
values
  ('55555555-0000-0000-0000-000000000001', 'report', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'off_topic',
   'This is about the referee process rather than about the tool.');

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000002'
      and kind = 'flagged'),
  1,
  'flagging something puts it in the flagger''s own record'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and target_type = 'flag'),
  0,
  'and the person flagged is told nothing at all: there is no enum value for it'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('flag', '55555555-0000-0000-0000-000000000001',
                            'resolve_flag') $$,
  'a moderator closes the flag'
);

reset role;

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000002'
      and kind = 'flag_resolved'),
  1,
  'closing a flag answers the person who raised it'
);

-- ── Who may read it ─────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

select cmp_ok(
  (select count(*)::int from public.activity),
  '>',
  0,
  'a member can read their own feed'
);

select is(
  (select count(*)::int from public.activity
    where subject_id <> '11111111-0000-0000-0000-000000000002'),
  0,
  'and sees nothing of anybody else''s, moderator or not'
);

select throws_ok(
  $$ insert into public.activity
       (subject_id, kind, is_inbound, target_type, target_id)
     values ('11111111-0000-0000-0000-000000000002', 'report_published', true,
             'report', '22222222-0000-0000-0000-000000000001') $$,
  '42501'::text, null::text,
  'and cannot manufacture one, which is the whole reason a notification can be believed'
);

-- ── The watermark ───────────────────────────────────────────────────────────────────

select lives_ok(
  $$ insert into public.activity_seen (user_id, seen_at)
     values ('11111111-0000-0000-0000-000000000002', now()) $$,
  'a member records when they last looked'
);

select throws_ok(
  $$ insert into public.activity_seen (user_id, seen_at)
     values ('11111111-0000-0000-0000-000000000001', now()) $$,
  '42501'::text, null::text,
  'and cannot mark somebody else''s notifications as read'
);

reset role;

-- ── The functions behind it ─────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every new function. These two are the ones that
-- would matter: one writes any row it is asked to, the other decides who hears about a
-- moderation decision.

-- Asked by name over pg_proc rather than by signature. A signature written out in a test is
-- a second place the argument list lives: 20260818140000 added a parameter to log_activity()
-- and this assertion started erroring on a function that "does not exist", which reads as the
-- function having been deleted rather than as the test being out of date. By name it also
-- covers every overload, which is what the claim actually is.
select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'log_activity'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'the one writer of the feed is not reachable from a browser, in any overload'
);

select ok(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('activity_on_moderation', 'log_moderation', 'backfill_activity')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'and neither is anything that turns a decision into a notification, or rebuilds the feed'
);

-- ── Erasure ─────────────────────────────────────────────────────────────────────────
-- Last, because it destroys a fixture. A feed is a convenience for one person and belongs
-- to them; the record of what was decided is public.moderation_actions and outlives them.

insert into public.comments (id, parent_type, parent_id, author_id, body)
values
  ('44444444-0000-0000-0000-000000000004', 'report', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000004', 'One more thing before I go.');

delete from auth.users where id = '11111111-0000-0000-0000-000000000004';

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000004'),
  0,
  'erasing an account takes its feed with it'
);

select is(
  (select count(*)::int from public.activity
    where kind = 'content_commented'
      and actor_id is null),
  1,
  'and the rows it caused elsewhere lose the name but keep the event'
);

select * from finish();

rollback;
