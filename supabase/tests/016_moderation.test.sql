-- Moderation: the audited path, the log behind it, and the four things it refuses.
--
-- The assertion this file exists for is the one that is easiest to lose later: **there is
-- no unaudited way to moderate.** Two halves have to hold at once — public.moderate()
-- works, and the direct UPDATE that used to do the same job no longer does. A test of only
-- the first half would still pass on the day somebody re-adds a moderator policy "so the
-- queue can be fixed quickly", which is exactly how audit logs stop being complete.
--
-- The rest of the file is about what a moderator may not do: approve their own work, ban
-- somebody with standing, ban themselves, erase an account that never asked, or edit the
-- record afterwards. Each of those is a sentence in docs/moderation.md, and a promise in a
-- document that nothing enforces is a promise about intentions.
--
-- The last two sections destroy fixtures — an erasure really does delete the account — so
-- they come last and nothing after them may depend on those rows.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(63);

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
   'authenticated', 'authenticated', 'admin@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leaver@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now();

update public.profiles set role = 'moderator' where id = '11111111-0000-0000-0000-000000000003';
update public.profiles set role = 'admin'     where id = '11111111-0000-0000-0000-000000000004';

-- ── Things to decide about ──────────────────────────────────────────────────────────

insert into public.reports (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed
) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'pending', 'Waiting for review', 'research', 'proof_checking',
   'Confirm a lemma.', 'Stated it in Lean.', 'worked', 'It closed.', 'Lean accepted it.', true),

  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'published', 'Already in the corpus', 'research', 'literature_search',
   'Find prior art.', 'Asked, then checked each.', 'partial', 'Two references invented.',
   'Looked every one up.', true),

  -- The moderator's own. This is the row the no-self-approval rule is about.
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003',
   'pending', 'Submitted by the moderator', 'writing', 'exposition',
   'Draft a note.', 'Asked, rewrote.', 'partial', 'Half usable.', 'Checked by hand.', true),

  -- Published by the account that will later be erased.
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000005',
   'published', 'By somebody who later left', 'learning', 'computation',
   'Generate examples.', 'Asked for twenty.', 'worked', 'Sixteen were right.',
   'Checked all twenty by hand.', true),

  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002',
   'pending', 'Needs work before it can go in', 'research', 'proof_drafting',
   'Prove a bound.', 'Asked for a sketch.', 'partial', 'The sketch had a gap.',
   'Checked the induction step by hand.', true);

insert into public.debates (id, author_id, statement, status, activated_at, area)
values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
   'AI-assisted literature search should be disclosed in papers.', 'proposed', null, 'writing'),

  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003',
   'A proof assistant should check every AI-drafted lemma before submission.',
   'proposed', null, 'research'),

  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'Referees should be told when a paper used a model for exposition.', 'active', now(), 'writing');

insert into public.comments (id, parent_type, parent_id, author_id, body)
values
  ('44444444-0000-0000-0000-000000000001', 'report', '22222222-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000002', 'Was the hypothesis necessary or convenient?'),
  ('44444444-0000-0000-0000-000000000002', 'report', '22222222-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000003', 'A remark from the moderator, in their own name.');

insert into public.flags (id, subject_type, subject_id, flagger_id, reason, detail)
values
  ('66666666-0000-0000-0000-000000000001', 'comment', '44444444-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'off_topic',
   'This is about the referee process rather than about the tool.');

insert into public.deletion_requests (id, user_id, note)
values
  ('77777777-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000005',
   'Please detach my reports rather than deleting them.');

-- ── The shape of the log ────────────────────────────────────────────────────────────
-- Grants first, because a missing grant and a missing policy are indistinguishable from a
-- client and these four decide whether the endpoint exists at all.

select ok(
  not has_table_privilege('anon', 'public.moderation_actions', 'SELECT'),
  'anon has no endpoint on the moderation log at all'
);

select ok(
  not has_table_privilege('authenticated', 'public.moderation_actions', 'INSERT'),
  'no browser role can write an audit row: rows come only from public.moderate()'
);

select ok(
  not has_table_privilege('authenticated', 'public.moderation_actions', 'UPDATE'),
  'and none can rewrite one'
);

select ok(
  not has_table_privilege('authenticated', 'public.moderation_actions', 'DELETE'),
  'and none can remove one'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.moderation_actions'::regclass),
  'row level security is enabled on the moderation log'
);

-- ── Who may act ─────────────────────────────────────────────────────────────────────

set local role anon;

select throws_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000001', 'publish') $$,
  '42501'::text, null::text,
  'an anonymous caller cannot reach public.moderate() at all'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000001', 'publish') $$,
  '42501'::text, null::text,
  'an ordinary member cannot publish, including their own submission'
);

reset role;

-- A banned moderator is not a moderator. The same clause appears in every policy on this
-- site; here it has to be inside the function, because a DEFINER function is not subject to
-- the policies that would otherwise carry it.
update public.profiles set is_banned = true where id = '11111111-0000-0000-0000-000000000003';

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000001', 'publish') $$,
  '42501'::text, null::text,
  'a banned moderator cannot moderate'
);

reset role;

update public.profiles set is_banned = false where id = '11111111-0000-0000-0000-000000000003';

-- ── The reason ──────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000002', 'hide') $$,
  '23514'::text, null::text,
  'hiding without a reason is refused before anything is hidden'
);

select throws_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000002', 'hide', '   ') $$,
  '23514'::text, null::text,
  'and a reason of whitespace is not a reason'
);

reset role;

select is(
  (select status::text from public.reports where id = '22222222-0000-0000-0000-000000000002'),
  'published'::text,
  'the report is untouched by the refused hide'
);

-- ── Publishing ──────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000001', 'publish') $$,
  'a moderator publishes a pending report'
);

reset role;

select is(
  (select status::text from public.reports where id = '22222222-0000-0000-0000-000000000001'),
  'published'::text,
  'and the report is published'
);

select is(
  (select count(*)::int from public.moderation_actions),
  1,
  'one action, one audit row'
);

select is(
  (select actor_id from public.moderation_actions),
  '11111111-0000-0000-0000-000000000003'::uuid,
  'the row records the hand'
);

select is(
  (select target_id from public.moderation_actions),
  '22222222-0000-0000-0000-000000000001'::uuid,
  'and what it was applied to'
);

-- ── Requesting changes ──────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000005',
                            'request_changes',
                            'The verification section describes what the model said rather than what you checked.') $$,
  'a moderator sends a submission back with a note'
);

reset role;

select is(
  (select status::text from public.reports where id = '22222222-0000-0000-0000-000000000005'),
  'pending'::text,
  'sending it back leaves it pending rather than rejecting it'
);

select is(
  (select moderation_note from public.reports where id = '22222222-0000-0000-0000-000000000005'),
  'The verification section describes what the model said rather than what you checked.'::text,
  'and the note is on the row, where its author can read it'
);

-- The author reads their own note through reports_select_own, and cannot clear it: there
-- is no column grant, which is the failure a browser sees first.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}';

select isnt(
  (select moderation_note from public.reports where id = '22222222-0000-0000-0000-000000000005'),
  null::text,
  'the author can read the change request on their own submission'
);

select throws_ok(
  $$ update public.reports set moderation_note = null
      where id = '22222222-0000-0000-0000-000000000005' $$,
  '42501'::text, null::text,
  'and cannot clear it: the note is not theirs to remove'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000005', 'publish') $$,
  'the same submission is published later'
);

reset role;

select is(
  (select moderation_note from public.reports where id = '22222222-0000-0000-0000-000000000005'),
  null::text,
  'and publishing clears the change request, which no longer describes anything'
);

-- ── Hiding, which is the path nothing ships without ─────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000002', 'hide',
                            'Contains a referee report that is not the author''s to reproduce.') $$,
  'a moderator hides a published report: the hide path works'
);

reset role;

select is(
  (select status::text from public.reports where id = '22222222-0000-0000-0000-000000000002'),
  'hidden'::text,
  'and it is hidden'
);

-- ── The window is bricked up ────────────────────────────────────────────────────────
-- The half of this file that matters most. No policy admits a moderator's UPDATE on
-- somebody else's row any more, so the statement below matches nothing: it succeeds,
-- silently, having changed not one row. That is the correct shape — an error here would be
-- indistinguishable from a bug, and the queue is the only route in either way.

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

update public.reports set status = 'hidden'
 where id = '22222222-0000-0000-0000-000000000004';

update public.comments set status = 'hidden'
 where id = '44444444-0000-0000-0000-000000000001';

update public.debates set status = 'hidden'
 where id = '33333333-0000-0000-0000-000000000001';

reset role;

select is(
  (select status::text from public.reports where id = '22222222-0000-0000-0000-000000000004'),
  'published'::text,
  'a moderator can no longer hide a report by direct update: the log cannot be stepped around'
);

select is(
  (select status::text from public.comments where id = '44444444-0000-0000-0000-000000000001'),
  'published'::text,
  'nor a comment'
);

select is(
  (select status::text from public.debates where id = '33333333-0000-0000-0000-000000000001'),
  'proposed'::text,
  'nor a debate'
);

select ok(
  not has_table_privilege('authenticated', 'public.flags', 'UPDATE'),
  'and a flag cannot be resolved by direct update: the grant is gone, not just the policy'
);

-- ── No self-approval ────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.moderate('report', '22222222-0000-0000-0000-000000000003', 'publish') $$,
  '42501'::text, null::text,
  'a moderator cannot publish their own submission'
);

select throws_ok(
  $$ select public.moderate('debate', '33333333-0000-0000-0000-000000000002', 'promote') $$,
  '42501'::text, null::text,
  'nor promote their own debate'
);

select throws_ok(
  $$ select public.moderate('comment', '44444444-0000-0000-0000-000000000002', 'hide',
                            'Second thoughts.') $$,
  '42501'::text, null::text,
  'nor moderate their own comment -- deleting it as its author is a different act'
);

reset role;

select is(
  (select status::text from public.reports where id = '22222222-0000-0000-0000-000000000003'),
  'pending'::text,
  'the moderator''s own submission waits like everybody else''s'
);

-- ── Debates ─────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('debate', '33333333-0000-0000-0000-000000000001', 'promote') $$,
  'a moderator promotes a proposed claim'
);

select lives_ok(
  $$ select public.moderate('debate', '33333333-0000-0000-0000-000000000003', 'hide',
                            'Two claims in one sentence; ratings on it would mean nothing.') $$,
  'and hides an active one'
);

reset role;

select is(
  (select status::text from public.debates where id = '33333333-0000-0000-0000-000000000001'),
  'active'::text,
  'the promoted claim is active'
);

select is(
  (select activated_at is not null from public.debates
    where id = '33333333-0000-0000-0000-000000000001'),
  true,
  'with the date that says when it joined the record'
);

select is(
  (select activated_at from public.debates where id = '33333333-0000-0000-0000-000000000003'),
  null::timestamptz,
  'and hiding an active claim drops its activation date, which the CHECK requires'
);

-- ── Comments ────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('comment', '44444444-0000-0000-0000-000000000001', 'hide',
                            'Names a pseudonymous contributor.') $$,
  'a moderator hides a comment'
);

reset role;

select is(
  (select author_id from public.comments where id = '44444444-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'and hiding keeps the text and the name, unlike deleting'
);

-- ── Flags ───────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('flag', '66666666-0000-0000-0000-000000000001', 'resolve_flag',
                            'Comment hidden.') $$,
  'a moderator closes a flag'
);

select throws_ok(
  $$ select public.moderate('flag', '66666666-0000-0000-0000-000000000001', 'dismiss_flag') $$,
  '23514'::text, null::text,
  'and cannot close it twice'
);

reset role;

select is(
  (select resolved_by from public.flags where id = '66666666-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000003'::uuid,
  'the resolution records a hand as well as a time'
);

-- ── Banning ─────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('account', '11111111-0000-0000-0000-000000000002', 'ban',
                            'Repeated attempts to identify a pseudonymous contributor.') $$,
  'a moderator bans a member'
);

select throws_ok(
  $$ select public.moderate('account', '11111111-0000-0000-0000-000000000004', 'ban',
                            'Disagreed with me.') $$,
  '42501'::text, null::text,
  'but not an account with moderation standing: one compromised session cannot disable the others'
);

select throws_ok(
  $$ select public.moderate('account', '11111111-0000-0000-0000-000000000003', 'ban',
                            'Testing.') $$,
  '42501'::text, null::text,
  'and not itself'
);

reset role;

select is(
  (select is_banned from public.profiles where id = '11111111-0000-0000-0000-000000000002'),
  true,
  'the ban took effect through the function, where no column grant would have allowed it'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('account', '11111111-0000-0000-0000-000000000002', 'unban') $$,
  'and a ban can be lifted, which is why it needs no reason'
);

reset role;

select is(
  (select is_banned from public.profiles where id = '11111111-0000-0000-0000-000000000002'),
  false,
  'the account is readmitted'
);

-- ── Who reads the log ───────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.moderation_actions),
  0,
  'a member sees no moderation actions, including those taken against them'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000004","role":"authenticated"}';

select cmp_ok(
  (select count(*)::int from public.moderation_actions),
  '>',
  8,
  'an admin sees the whole log'
);

reset role;

-- ── Append-only, for everyone ───────────────────────────────────────────────────────
-- Not `set local role`: this runs as the migration role, which owns the table. The trigger
-- refuses it anyway, and that is the point — absent grants stop a browser and stop nothing
-- else.

select throws_ok(
  $$ update public.moderation_actions set reason = 'Something more defensible.' $$,
  '0A000'::text, null::text,
  'the log cannot be edited, not even by the role that owns it'
);

select throws_ok(
  $$ delete from public.moderation_actions $$,
  '0A000'::text, null::text,
  'nor pruned'
);

-- ── Erasure ─────────────────────────────────────────────────────────────────────────
-- Everything below destroys fixtures.

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.moderate('account', '77777777-0000-0000-0000-000000000001', 'erase_account') $$,
  '42501'::text, null::text,
  'a moderator cannot erase an account: a ban is reversible and this is not'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ select public.moderate('account', '77777777-0000-0000-0000-000000000009', 'erase_account') $$,
  '23503'::text, null::text,
  'and an admin can only erase an account that asked: the request is the only way in'
);

select lives_ok(
  $$ select public.moderate('account', '77777777-0000-0000-0000-000000000001', 'erase_account') $$,
  'an admin processes a standing erasure request'
);

reset role;

select is(
  (select count(*)::int from auth.users where id = '11111111-0000-0000-0000-000000000005'),
  0,
  'the account is gone'
);

select is(
  (select count(*)::int from public.deletion_requests
    where id = '77777777-0000-0000-0000-000000000001'),
  0,
  'and so is the request, which would otherwise record that this person asked to be forgotten'
);

select is(
  (select author_id from public.reports where id = '22222222-0000-0000-0000-000000000004'),
  null::uuid,
  'their published report stays in the corpus without a name on it'
);

select is(
  (select count(*)::int from public.moderation_actions
    where action = 'erase_account' and target_id is null),
  1,
  'the log records that an erasure happened and deliberately not whose'
);

-- ── The one exception to append-only ────────────────────────────────────────────────
-- A moderator erasing their own account has to work, and the foreign key does it by nulling
-- actor_id — which reaches the log as an UPDATE. Without the narrow exception in
-- private.refuse_moderation_edit(), the log of a moderator's decisions would make that
-- moderator undeletable.

insert into public.deletion_requests (id, user_id)
values ('77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-0000-0000-000000000004","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate('account', '77777777-0000-0000-0000-000000000002', 'erase_account') $$,
  'a moderator with decisions behind them can still leave'
);

reset role;

select is(
  (select count(*)::int from public.moderation_actions
    where actor_id = '11111111-0000-0000-0000-000000000003'),
  0,
  'their name comes off every decision'
);

select cmp_ok(
  (select count(*)::int from public.moderation_actions),
  '>',
  8,
  'and the decisions themselves stand'
);

select * from finish();

rollback;
