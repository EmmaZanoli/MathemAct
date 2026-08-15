-- The staleness view, and the trap underneath it.
--
-- A view has no row level security of its own. Without `security_invoker = on` it runs
-- with its creator's privileges and returns every practice it can see -- pending, hidden,
-- deleted -- to anonymous callers, while the policies on the underlying tables sit there
-- being perfectly correct and never being consulted. The first assertion in this file is
-- the one that would catch that, and it is why the file exists at all.
--
-- The rest is the tombstone rule. It lives in SQL because the same answer has to appear in
-- a listing, on a practice page, in the nightly JSON export, and in whatever a researcher
-- runs against the dumped corpus; four implementations would be four definitions of
-- "verified".

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(15);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('55555555-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'poster@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('55555555-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'checker@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now();

-- Five published practices, one per tombstone state plus a second stale route, and one
-- pending practice that no anonymous caller may learn anything about.
insert into public.practices (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed
)
select
  ('66666666-0000-0000-0000-00000000000' || n)::uuid,
  '55555555-0000-0000-0000-000000000001',
  case when n = 6 then 'pending' else 'published' end::public.content_status,
  'Practice ' || n, 'research', 'other', 'a', 'b', 'worked', 'c',
  'Checked it.', true
from generate_series(1, 6) as g(n);

insert into public.practice_tools (practice_id, tool_name, tool_version, used_on) values
  -- Recent, never confirmed.
  ('66666666-0000-0000-0000-000000000001', 'GPT-5', '2026-05', current_date - 20),
  -- Recent, confirmed working.
  ('66666666-0000-0000-0000-000000000002', 'GPT-5', '2026-05', current_date - 20),
  -- Recent, reported broken.
  ('66666666-0000-0000-0000-000000000003', 'GPT-5', '2026-05', current_date - 20),
  -- Old and never confirmed. Two tools, to check the view takes the newer of them.
  ('66666666-0000-0000-0000-000000000004', 'GPT-4', '2024-11', current_date - 900),
  ('66666666-0000-0000-0000-000000000004', 'Lean', '4.2.0', current_date - 800),
  -- Recent tool, but the last confirmation is two years old.
  ('66666666-0000-0000-0000-000000000005', 'GPT-5', '2026-05', current_date - 20),
  ('66666666-0000-0000-0000-000000000006', 'GPT-5', '2026-05', current_date - 20);

insert into public.practice_confirmations (practice_id, user_id, verdict, created_at) values
  ('66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002',
   'still_works', now() - interval '2 days'),
  ('66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000002',
   'no_longer_works', now() - interval '1 day'),
  ('66666666-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000002',
   'still_works', now() - interval '2 years');

-- An older verdict on the same practice, to prove the view takes the most recent rather
-- than an arbitrary one.
insert into public.practice_confirmations (practice_id, user_id, verdict, created_at) values
  ('66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001',
   'still_works', now() - interval '30 days');

-- ── The trap ────────────────────────────────────────────────────────────────────────

select ok(
  coalesce(
    (select o.option_value
       from pg_options_to_table(
              (select c.reloptions from pg_class c
                where c.oid = 'public.practice_staleness'::regclass)) o
      where o.option_name = 'security_invoker'),
    'false') = 'true',
  'the staleness view is security_invoker'
);

set local role anon;

select is_empty(
  $$ select practice_id from public.practice_staleness
      where practice_id = '66666666-0000-0000-0000-000000000006' $$,
  'an anonymous client sees no pending practice through the staleness view'
);

select is(
  (select count(*)::int from public.practice_staleness),
  5,
  'and sees exactly the five published ones'
);

-- ── The tombstone rule ──────────────────────────────────────────────────────────────

select is(
  (select tombstone_status from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000001'),
  'unverified'::text,
  'recent, and nobody has confirmed it either way: unverified'
);

select is(
  (select tombstone_status from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000002'),
  'verified'::text,
  'recently confirmed still working: verified, and the square is filled'
);

select is(
  (select is_verified from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000002'),
  true,
  'is_verified agrees with the status, so nothing has to re-derive it'
);

select is(
  (select tombstone_status from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000003'),
  'broken'::text,
  'a report that it no longer works outranks an older report that it did'
);

select is(
  (select is_verified from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000003'),
  false,
  'and leaves the square open'
);

select is(
  (select tombstone_status from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000004'),
  'stale'::text,
  'never confirmed and written against a tool used over a year ago: stale'
);

select is(
  (select tombstone_status from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000005'),
  'stale'::text,
  'confirmed working, but two years ago: also stale, and honestly so'
);

-- ── The inputs the view reports ─────────────────────────────────────────────────────

select is(
  (select latest_tool_use from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000004'),
  (current_date - 800),
  'latest_tool_use is the most recent across every tool on the practice'
);

select is(
  (select confirmation_count from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000003'),
  2::bigint,
  'confirmation_count counts everyone who checked, not only the latest'
);

-- Zero rather than null. The lateral returns no row for a practice nobody has confirmed,
-- and an uncoalesced left join would put a null here and a null in is_verified -- which
-- renders as an open square in the interface and as unclassifiable in the export.
select is(
  (select confirmation_count from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000001'),
  0::bigint,
  'a practice nobody has confirmed reports zero confirmations, not null'
);

select is(
  (select is_verified from public.practice_staleness
    where practice_id = '66666666-0000-0000-0000-000000000001'),
  false,
  'and is unambiguously not verified, rather than unknown'
);

reset role;

-- ── An author sees their own pending work ───────────────────────────────────────────
-- The same invoker rule that hides a pending practice from anon shows it to its author,
-- because it is the practices policies doing the work rather than anything in the view.

set local role authenticated;
set local request.jwt.claims to '{"sub":"55555555-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.practice_staleness),
  6,
  'the author sees their own pending practice in the view, and nobody else does'
);

reset role;

select * from finish();

rollback;
