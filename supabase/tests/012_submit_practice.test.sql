-- public.submit_practice() — the one entry point the submission form uses.
--
-- The property under test is not "it inserts rows". It is that wrapping three inserts in a
-- function bought a transaction and nothing else: every policy, grant, constraint and
-- trigger that guards the tables directly must still guard them through here. A function
-- that quietly relaxed one of them would look identical to this one from the outside, and
-- would be the largest hole in the schema.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('99999999-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'submitter@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('99999999-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notyet@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('99999999-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'excluded@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now()
 where id <> '99999999-0000-0000-0000-000000000002';

update public.profiles set is_banned = true
 where id = '99999999-0000-0000-0000-000000000003';

-- ── Who may call it ─────────────────────────────────────────────────────────────────

select ok(
  not has_function_privilege('anon', 'public.submit_practice(text, public.practice_area, '
    'public.practice_task_type, jsonb, text, text, public.practice_outcome, text, text, '
    'boolean, text, text, text, integer, boolean, boolean, smallint, text[])', 'EXECUTE'),
  'anon cannot execute submit_practice'
);

select ok(
  has_function_privilege('authenticated', 'public.submit_practice(text, public.practice_area, '
    'public.practice_task_type, jsonb, text, text, public.practice_outcome, text, text, '
    'boolean, text, text, text, integer, boolean, boolean, smallint, text[])', 'EXECUTE'),
  'authenticated can'
);

-- SECURITY INVOKER is the whole safety argument. As DEFINER this function would run as its
-- owner and bypass every policy underneath it while looking exactly the same.
select is(
  (select p.prosecdef
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_practice'),
  false,
  'submit_practice is SECURITY INVOKER, so the policies underneath it still apply'
);

-- ── The happy path ──────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.submit_practice(
       'Check a lemma with a proof assistant',
       'research', 'proof_checking',
       '[{"name":"Lean","version":"4.9.0","used_on":"2026-08-01"},
         {"name":"GPT-5","version":"2026-05","used_on":"2026-08-02"}]'::jsonb,
       'Confirm a lemma I could not see a gap in.',
       'Stated it in Lean and closed the goals one at a time.',
       'partial', 'It found a missing hypothesis I had assumed.',
       'Lean accepted the final proof, and I re-derived the counterexample by hand.',
       true,
       'user: is this lemma true as stated?',
       'https://example.org/transcript',
       'I would state the hypotheses first next time.',
       95, true, true, 8,
       array['math.NT', 'math.LO']
     ) $$,
  'a confirmed member can submit a practice, its tools and its tags in one call'
);

reset role;

select is(
  (select count(*)::int from public.practices),
  1,
  'the practice is there'
);

select is(
  (select status::text from public.practices limit 1),
  'pending'::text,
  'and it is pending: the function is not a way to self-publish'
);

select is(
  (select author_id from public.practices limit 1),
  '99999999-0000-0000-0000-000000000001'::uuid,
  'the author is the caller, taken from auth.uid() rather than from a parameter'
);

select is(
  (select count(*)::int from public.practice_tools),
  2,
  'both tools are recorded'
);

select is(
  (select count(*)::int from public.practice_tags),
  2,
  'and both tags, matched by code so the client never handles a uuid'
);

-- ── What it must still refuse ───────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.submit_practice(
       'From an unconfirmed account', 'research', 'other',
       '[{"name":"Lean","version":"4.9.0","used_on":"2026-08-01"}]'::jsonb,
       'a', 'b', 'worked', 'c', 'd', true) $$,
  '42501'::text, null::text,
  'an unconfirmed account is still refused, by the policy rather than by the function'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.submit_practice(
       'From a banned account', 'research', 'other',
       '[{"name":"Lean","version":"4.9.0","used_on":"2026-08-01"}]'::jsonb,
       'a', 'b', 'worked', 'c', 'd', true) $$,
  '42501'::text, null::text,
  'and so is a banned one'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.submit_practice(
       'No tools', 'research', 'other', '[]'::jsonb,
       'a', 'b', 'worked', 'c', 'd', true) $$,
  '23514'::text, null::text,
  'a submission recording no tool is refused with a sentence, not a constraint name'
);

select throws_ok(
  $$ select public.submit_practice(
       'No verification', 'research', 'other',
       '[{"name":"Lean","version":"4.9.0","used_on":"2026-08-01"}]'::jsonb,
       'a', 'b', 'worked', 'c', '   ', true) $$,
  '23514'::text, null::text,
  'the verification field is still required through this path'
);

select throws_ok(
  $$ select public.submit_practice(
       'Unconfirmed material', 'research', 'other',
       '[{"name":"Lean","version":"4.9.0","used_on":"2026-08-01"}]'::jsonb,
       'a', 'b', 'worked', 'c', 'd', false) $$,
  '23514'::text, null::text,
  'and so is the third-party material confirmation'
);

reset role;

-- ── All or nothing ──────────────────────────────────────────────────────────────────
-- The reason this is a function rather than three requests. A tool row that fails must
-- take the practice with it, or the corpus accumulates accounts with no date of use --
-- which the staleness view would render as permanently current.

set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.submit_practice(
       'A tool used tomorrow', 'research', 'other',
       ('[{"name":"Lean","version":"4.9.0","used_on":"'
         || to_char(current_date + 1, 'YYYY-MM-DD') || '"}]')::jsonb,
       'a', 'b', 'worked', 'c', 'd', true) $$,
  '23514'::text, null::text,
  'a bad tool row fails the whole submission'
);

reset role;

select is(
  (select count(*)::int from public.practices),
  1,
  'and leaves no half-written practice behind'
);

select * from finish();

rollback;
