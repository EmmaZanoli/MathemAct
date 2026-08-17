-- Debates, ratings, and the aggregate.
--
-- Two properties carry the rest of this file. A rating row is readable only by the person
-- who wrote it, and a NULL score is a real answer rather than an absence. Everything about
-- the aggregate follows from the second: coverage exists because declining is recordable,
-- and the median means something because the people who declined are not in it.
--
-- And one negative that is asserted rather than assumed: nothing anywhere returns a mean.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(28);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('bbbb0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'proposer@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('bbbb0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rater@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('bbbb0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nosy@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('bbbb0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'unconfirmed-p@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now()
 where id <> 'bbbb0000-0000-0000-0000-000000000004';

insert into public.debates (id, author_id, statement, area, status, activated_at)
values
  ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001',
   'AI-assisted literature search should be disclosed in papers.', 'writing', 'active', now()),
  ('cccc0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001',
   'Formalising a statement before proving it is worth the time it costs.', 'research',
   'proposed', null),
  ('cccc0000-0000-0000-0000-000000000003', 'bbbb0000-0000-0000-0000-000000000001',
   'This debate has been moderated away and nobody should see it.', 'other', 'hidden', null);

-- ── The scale ───────────────────────────────────────────────────────────────────────

select throws_ok(
  $$ insert into public.ratings (debate_id, user_id, score)
     values ('cccc0000-0000-0000-0000-000000000001',
             'bbbb0000-0000-0000-0000-000000000002', 11) $$,
  '23514'::text, null::text,
  'a score above 10 is refused'
);

select throws_ok(
  $$ insert into public.ratings (debate_id, user_id, score)
     values ('cccc0000-0000-0000-0000-000000000001',
             'bbbb0000-0000-0000-0000-000000000002', -1) $$,
  '23514'::text, null::text,
  'and below 0'
);

-- The single most important row shape on this table: declining is an answer.
insert into public.ratings (debate_id, user_id, score)
values ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000002', null);

select is(
  (select count(*)::int from public.ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  1,
  'a NULL score is a real row: "no opinion" is recorded, not absent'
);

select throws_ok(
  $$ insert into public.ratings (debate_id, user_id, score)
     values ('cccc0000-0000-0000-0000-000000000001',
             'bbbb0000-0000-0000-0000-000000000002', 7) $$,
  '23505'::text, null::text,
  'one rating per person per debate'
);

-- Changing your mind is an update, and it keeps only the current value.
update public.ratings set score = 7
 where debate_id = 'cccc0000-0000-0000-0000-000000000001'
   and user_id = 'bbbb0000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  1,
  'editing a rating leaves one row, not a history'
);

-- ── Nobody reads anybody else's rating ──────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbb0000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select score from public.ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  7::smallint,
  'a member reads their own rating'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbb0000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.ratings),
  0,
  'and cannot read anybody else''s, which is the rule the aggregate is built around'
);

select is_empty(
  $$ select user_id, score from public.ratings
      where user_id = 'bbbb0000-0000-0000-0000-000000000002' $$,
  'naming the person does not help'
);

reset role;

set local role anon;
select throws_ok(
  $$ select count(*) from public.ratings $$,
  '42501'::text, null::text,
  'anon has no access to ratings at all'
);
reset role;

-- ── Who may rate ────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbb0000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ insert into public.ratings (debate_id, user_id, score)
     values ('cccc0000-0000-0000-0000-000000000001',
             'bbbb0000-0000-0000-0000-000000000004', 5) $$,
  '42501'::text, null::text,
  'an unconfirmed account cannot rate'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbb0000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ insert into public.ratings (debate_id, user_id, score)
     values ('cccc0000-0000-0000-0000-000000000001',
             'bbbb0000-0000-0000-0000-000000000002', 5) $$,
  '42501'::text, null::text,
  'and nobody can rate on somebody else''s behalf'
);

select throws_ok(
  $$ insert into public.ratings (debate_id, user_id, score)
     values ('cccc0000-0000-0000-0000-000000000003',
             'bbbb0000-0000-0000-0000-000000000003', 5) $$,
  '42501'::text, null::text,
  'a hidden debate stops accepting ratings'
);

reset role;

-- ── Debates ─────────────────────────────────────────────────────────────────────────

set local role anon;

select is(
  (select count(*)::int from public.debates),
  2,
  'anon sees proposed and active debates, and not hidden ones'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbb0000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ insert into public.debates (author_id, statement, area, status)
     values ('bbbb0000-0000-0000-0000-000000000003',
             'This one arrives already part of the record.', 'other', 'active') $$,
  '42501'::text, null::text,
  'nobody can propose something already active: status has no INSERT grant'
);

insert into public.debates (author_id, statement, area)
values ('bbbb0000-0000-0000-0000-000000000003',
        'Referee reports should say whether a tool was used.', 'research');

reset role;

select is(
  (select status::text from public.debates
    where statement = 'Referee reports should say whether a tool was used.'),
  'proposed'::text,
  'a confirmed member may propose, and it starts proposed'
);

select throws_ok(
  $$ insert into public.debates (author_id, statement, area)
     values ('bbbb0000-0000-0000-0000-000000000001', 'Maybe?', 'other') $$,
  '23514'::text, null::text,
  'a statement too short to be a claim is refused'
);

select throws_ok(
  $$ insert into public.debates (author_id, statement, area)
     values ('bbbb0000-0000-0000-0000-000000000001', repeat('x', 201), 'other') $$,
  '23514'::text, null::text,
  'and one longer than a sentence: two claims sharing a rating mean nothing'
);

-- ── Promotion ───────────────────────────────────────────────────────────────────────
-- The threshold counts answers, including declines. What promotion records is that the
-- question turned out to be worth asking.

update private.settings set value = '3'
 where key = 'debate_activation_ratings';

insert into public.ratings (debate_id, user_id, score) values
  ('cccc0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001', 9),
  ('cccc0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000002', null);

select is(
  (select status::text from public.debates
    where id = 'cccc0000-0000-0000-0000-000000000002'),
  'proposed'::text,
  'below the threshold, a debate stays proposed'
);

insert into public.ratings (debate_id, user_id, score)
values ('cccc0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000003', 2);

select is(
  (select status::text from public.debates
    where id = 'cccc0000-0000-0000-0000-000000000002'),
  'active'::text,
  'reaching it promotes, counting the person who declined to answer'
);

select isnt(
  (select activated_at from public.debates
    where id = 'cccc0000-0000-0000-0000-000000000002'),
  null::timestamptz,
  'and records when, because the constraint ties the two together'
);

-- ── The aggregate ───────────────────────────────────────────────────────────────────
-- Six raters on the active debate: scores 7, 2, 8, 8, and two who declined.

insert into public.ratings (debate_id, user_id, score) values
  ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000003', 2),
  ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', 8),
  ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000004', null);

set local role anon;

select is(
  (select histogram from public.debate_ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  array[0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0],
  'the histogram counts each of the eleven values, and anon may read it'
);

select is(
  (select median from public.debate_ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  7::smallint,
  'the median is a value somebody actually chose, not an interpolation between two'
);

select is(
  (select total_raters from public.debate_ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  4,
  'everyone who answered is counted, including those who declined'
);

select is(
  (select no_opinion_count from public.debate_ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  1,
  'declining is its own number rather than a gap'
);

select is(
  (select coverage from public.debate_ratings
    where debate_id = 'cccc0000-0000-0000-0000-000000000001'),
  0.750::numeric,
  'and coverage is the ratio of opinions to raters'
);

select is_empty(
  $$ select debate_id from public.debate_ratings
      where debate_id = 'cccc0000-0000-0000-0000-000000000003' $$,
  'a hidden debate has no readable aggregate'
);

reset role;

-- ── No mean, anywhere ───────────────────────────────────────────────────────────────
-- Asserted against the catalogue rather than against a list of objects, so it covers
-- whatever is added next. The mean of an 11-point bipolar scale is misleading exactly when
-- the distribution is bimodal, and bimodal is what to expect on the contested ones.

select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and pg_get_functiondef(p.oid) ~* '\mavg\s*\(' $$,
  'no function in the exposed schema computes an average'
);

select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'v'
        and pg_get_viewdef(c.oid) ~* '\mavg\s*\(' $$,
  'and no view does either'
);

select * from finish();

rollback;
