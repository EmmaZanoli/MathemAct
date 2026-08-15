-- Citations, and the reports queue behind the report control.
--
-- The rule doing the most work here is that a citation is visible only when **both** of its
-- endpoints are. That is not symmetry for its own sake. The excerpt column holds a verbatim
-- copy of the target's text, so a citation that outlived its target being hidden would
-- republish, on a third page, exactly the passage a moderator had just removed. The
-- assertions below check the copy disappears with the original.
--
-- The second thing worth a test is that citations are immutable at the grant level rather
-- than the policy level. A policy can be loosened by somebody adding a feature; an absent
-- UPDATE grant refuses before any policy is consulted.
--
-- Reports get the treatment CLAUDE.md asks for: they live in `public` because a browser
-- moderation UI will read them, which makes "a reporter can read their own and nobody
-- else's" the assertion that matters most in this file.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(32);

-- ── People ──────────────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'citer@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reader@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'unconfirmed@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'banned@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'moderator@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now()
 where id <> '11111111-0000-0000-0000-000000000003';

update public.profiles set is_banned = true
 where id = '11111111-0000-0000-0000-000000000004';

update public.profiles set role = 'moderator'
 where id = '11111111-0000-0000-0000-000000000005';

select is(
  (select count(*)::int from public.profiles where confirmed_at is not null),
  4,
  'four of the five fixtures have a confirmed account'
);

-- ── Endpoints ───────────────────────────────────────────────────────────────────────

insert into public.practices (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed
) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'published', 'Check a lemma with a proof assistant', 'research', 'proof_checking',
   'Confirm a lemma.', 'Stated it in Lean.', 'worked', 'It closed.', 'Lean accepted it.', true),

  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002',
   'published', 'Search the literature for a counterexample', 'research', 'literature_search',
   'Find prior art.', 'Asked, then checked each.', 'partial', 'Two references invented.',
   'Looked every one up.', true),

  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'pending', 'Still in the queue', 'writing', 'exposition',
   'Draft a note.', 'Asked, rewrote.', 'partial', 'Half usable.', 'Checked by hand.', true),

  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   'hidden', 'Hidden by a moderator', 'research', 'other',
   'Something.', 'Something else.', 'failed', 'It did not.', 'Checked it.', true);

insert into public.propositions (id, author_id, statement, status, activated_at, area)
values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Every AI-generated proof step must be checked by a human before publication.',
   'active', now(), 'research');

insert into public.comments (id, parent_type, parent_id, author_id, body)
values
  ('44444444-0000-0000-0000-000000000001', 'practice', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'Was the hypothesis necessary or convenient?'),
  ('44444444-0000-0000-0000-000000000002', 'proposition', '33333333-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'This is the case I had in mind.'),
  ('44444444-0000-0000-0000-000000000003', 'practice', '22222222-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001', 'Compare the Lean account, which found the gap.');

-- ── Citations ───────────────────────────────────────────────────────────────────────

insert into public.citations
  (id, source_type, source_id, source_comment_id, target_type, target_id, excerpt, context, created_by)
values
  -- A proposition resting on a practice: the case the whole table exists for.
  ('55555555-0000-0000-0000-000000000001', 'proposition', '33333333-0000-0000-0000-000000000001',
   null, 'practice', '22222222-0000-0000-0000-000000000001',
   'It found a missing hypothesis.', 'The account that prompted this claim.',
   '11111111-0000-0000-0000-000000000001'),

  -- A practice referencing another from inside its discussion.
  ('55555555-0000-0000-0000-000000000002', 'practice', '22222222-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000003', 'practice', '22222222-0000-0000-0000-000000000001',
   'Lean accepted the proof.', 'A verification that actually caught something.',
   '11111111-0000-0000-0000-000000000001'),

  -- Pointing at a practice a moderator has hidden.
  ('55555555-0000-0000-0000-000000000003', 'practice', '22222222-0000-0000-0000-000000000001',
   null, 'practice', '22222222-0000-0000-0000-000000000004',
   'Something.', 'Should vanish with its target.',
   '11111111-0000-0000-0000-000000000001');

set local role anon;

select is(
  (select count(*)::int from public.citations),
  2,
  'anon sees citations whose endpoints are both visible'
);

select is_empty(
  $$ select id from public.citations
      where target_id = '22222222-0000-0000-0000-000000000004' $$,
  'and none pointing at a hidden practice, so the stored excerpt cannot outlive the original'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*)::int from public.citations),
  3,
  'a moderator sees all three, because they can see the hidden endpoint'
);

reset role;

-- ── Making one ──────────────────────────────────────────────────────────────────────

set local role anon;

select throws_ok(
  $$ insert into public.citations (source_type, source_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'proposition',
             '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002') $$,
  '42501'::text, null::text,
  'anon cannot create a citation'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ insert into public.citations (source_type, source_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'proposition',
             '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003') $$,
  '42501'::text, null::text,
  'an unconfirmed account cannot create one'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ insert into public.citations (source_type, source_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'proposition',
             '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004') $$,
  '42501'::text, null::text,
  'a banned account cannot create one'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.citations (source_type, source_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'proposition',
             '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001') $$,
  '42501'::text, null::text,
  'a member cannot create a citation under somebody else''s name'
);

-- The target exists and is real; this caller simply cannot see it.
select throws_ok(
  $$ insert into public.citations (source_type, source_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'practice',
             '22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002') $$,
  '42501'::text, null::text,
  'a member cannot cite a target they cannot see'
);

-- Only the CHECK can refuse this one: every clause of the insert policy passes.
select throws_ok(
  $$ insert into public.citations (source_type, source_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'practice',
             '22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002') $$,
  '23514'::text, null::text,
  'a page cannot reference itself'
);

reset role;

-- Attaching a citation to somebody else's comment would put words in their mouth in the
-- "referenced by" block of a third page.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.citations
       (source_type, source_id, source_comment_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000001',
             '44444444-0000-0000-0000-000000000001', 'proposition',
             '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001') $$,
  '42501'::text, null::text,
  'a member cannot hang a citation off somebody else''s comment'
);

-- Their own comment, but on the wrong page. Refused by the endpoint trigger, which runs
-- before row level security and so reports the integrity failure rather than a permission
-- one -- which is the more useful of the two answers here.
select throws_ok(
  $$ insert into public.citations
       (source_type, source_id, source_comment_id, target_type, target_id, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000001',
             '44444444-0000-0000-0000-000000000002', 'proposition',
             '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001') $$,
  '23503'::text, null::text,
  'a source comment must belong to the page doing the citing'
);

reset role;

-- The allowed case.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.citations
  (source_type, source_id, target_type, target_id, excerpt, context, created_by)
values ('practice', '22222222-0000-0000-0000-000000000002', 'practice',
        '22222222-0000-0000-0000-000000000001',
        'Lean accepted the proof.', 'The same passage, cited from the page itself.',
        '11111111-0000-0000-0000-000000000002');

select throws_ok(
  $$ insert into public.citations
       (source_type, source_id, target_type, target_id, excerpt, created_by)
     values ('practice', '22222222-0000-0000-0000-000000000002', 'practice',
             '22222222-0000-0000-0000-000000000001', 'Lean accepted the proof.',
             '11111111-0000-0000-0000-000000000002') $$,
  '23505'::text, null::text,
  'the same page cannot cite the same target twice from the same place'
);

reset role;

select is(
  (select count(*)::int from public.citations
    where source_id = '22222222-0000-0000-0000-000000000002'
      and target_id = '22222222-0000-0000-0000-000000000001'),
  2,
  'but a citation from a comment and one from the page itself are separate acts'
);

select ok(
  not has_table_privilege('authenticated', 'public.citations', 'UPDATE'),
  'a citation is immutable at the grant level, before any policy is consulted'
);

-- ── Removing one ────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

delete from public.citations where id = '55555555-0000-0000-0000-000000000001';

reset role;

select is(
  (select count(*)::int from public.citations
    where id = '55555555-0000-0000-0000-000000000001'),
  1,
  'a member cannot withdraw somebody else''s citation'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';

delete from public.citations where id = '55555555-0000-0000-0000-000000000001';

reset role;

select is(
  (select count(*)::int from public.citations
    where id = '55555555-0000-0000-0000-000000000001'),
  0,
  'the citer may withdraw their own: this is the one hard delete on the site'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000005","role":"authenticated"}';

delete from public.citations where id = '55555555-0000-0000-0000-000000000002';

reset role;

select is(
  (select count(*)::int from public.citations
    where id = '55555555-0000-0000-0000-000000000002'),
  0,
  'and a moderator may remove one whose excerpt should not be there'
);

-- ── Reports ─────────────────────────────────────────────────────────────────────────

select ok(
  not has_table_privilege('anon', 'public.reports', 'SELECT'),
  'anon has no endpoint on reports at all, not merely no rows'
);

set local role anon;

select throws_ok(
  $$ insert into public.reports (subject_type, subject_id, reporter_id, reason)
     values ('comment', '44444444-0000-0000-0000-000000000002',
             '11111111-0000-0000-0000-000000000002', 'abusive') $$,
  '42501'::text, null::text,
  'anonymous reporting is not offered: a volunteer moderator''s first question is who filed it'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.reports (subject_type, subject_id, reporter_id, reason, detail)
values ('comment', '44444444-0000-0000-0000-000000000002',
        '11111111-0000-0000-0000-000000000002', 'inaccurate',
        'The transcript does not show what this claims it shows.');

select throws_ok(
  $$ insert into public.reports (subject_type, subject_id, reporter_id, reason)
     values ('comment', '44444444-0000-0000-0000-000000000002',
             '11111111-0000-0000-0000-000000000002', 'spam') $$,
  '23505'::text, null::text,
  'reporting the same thing twice is refused: it is not a stronger signal'
);

select throws_ok(
  $$ insert into public.reports (subject_type, subject_id, reporter_id, reason, status)
     values ('comment', '44444444-0000-0000-0000-000000000001',
             '11111111-0000-0000-0000-000000000002', 'spam', 'dismissed') $$,
  '42501'::text, null::text,
  'a reporter cannot file something already resolved: status has no INSERT grant'
);

select is(
  (select count(*)::int from public.reports),
  1,
  'a reporter sees their own report'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.reports),
  0,
  'and nobody else does -- including the person who was reported'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*)::int from public.reports),
  1,
  'a moderator sees the queue'
);

reset role;

-- A report that can be retracted after a moderator has read it makes the log incomplete in
-- exactly the cases that matter. No policy's USING clause matches, so this is silent.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

update public.reports set status = 'dismissed', resolved_at = now();

reset role;

select is(
  (select status::text from public.reports limit 1),
  'open'::text,
  'a reporter cannot resolve their own report'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000005","role":"authenticated"}';

update public.reports
   set status = 'actioned',
       resolved_at = now(),
       resolved_by = '11111111-0000-0000-0000-000000000005';

reset role;

select is(
  (select status::text from public.reports limit 1),
  'actioned'::text,
  'a moderator can, and the resolution records a hand as well as a time'
);

select ok(
  not has_table_privilege('authenticated', 'public.reports', 'DELETE'),
  'nothing can delete a report: the queue is a record of what was raised'
);

-- ── The rate limits are actually attached ───────────────────────────────────────────

select has_trigger(
  'public', 'citations', 'citations_daily_limit',
  'citations are rate limited'
);

select has_trigger(
  'public', 'reports', 'reports_daily_limit',
  'and so is the report queue, which has the lowest limit on the site'
);

-- ── Erasure detaches rather than destroys ───────────────────────────────────────────

delete from auth.users where id = '11111111-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.citations
    where id = '55555555-0000-0000-0000-000000000003'),
  1,
  'erasing an account leaves the citations it made, so the graph does not tear'
);

select is(
  (select created_by from public.citations
    where id = '55555555-0000-0000-0000-000000000003'),
  null::uuid,
  'and strips the hand that made them'
);

select * from finish();

rollback;
