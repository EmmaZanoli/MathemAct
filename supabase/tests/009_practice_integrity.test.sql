-- The constraints that make a practice a report rather than a paragraph.
--
-- These are the rules the submission form will also enforce, and the reason they are here
-- as well is that PostgREST is a public endpoint: a rule that exists only in TypeScript
-- applies to people using our form, which is not the population it needs to bound. The
-- database is the truth and the form is the convenience.
--
-- The child tables' policies are asserted here too, because they say something the parent's
-- do not: a tool row is visible exactly when its practice is, and that rule is expressed
-- once by deferring to public.practices rather than restated in each table where it could
-- drift.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(21);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'writer@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33333333-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reader@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now();

-- A published practice and a pending one, both by the writer.
insert into public.practices (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed
) values
  ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
   'published', 'A published practice', 'research', 'computation',
   'Compute something.', 'Computed it.', 'worked', 'It computed.',
   'Reproduced the computation in Sage.', true),
  ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001',
   'pending', 'A pending practice', 'research', 'computation',
   'Compute something else.', 'Computed that too.', 'worked', 'It computed.',
   'Reproduced it by hand.', true);

insert into public.practice_tools (practice_id, tool_name, tool_version, used_on) values
  ('44444444-0000-0000-0000-000000000001', 'GPT-5', '2026-05', current_date - 30),
  ('44444444-0000-0000-0000-000000000002', 'Lean', '4.9.0', current_date - 5);

-- ── The field that makes the corpus serious ─────────────────────────────────────────

select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed)
     values ('33333333-0000-0000-0000-000000000001', 'No verification', 'research', 'other',
             'a', 'b', 'worked', 'c', '   ', true) $$,
  '23514'::text, null::text,
  'a verification section of whitespace is refused: NOT NULL alone would let it through'
);

select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed)
     values ('33333333-0000-0000-0000-000000000001', '   ', 'research', 'other',
             'a', 'b', 'worked', 'c', 'd', true) $$,
  '23514'::text, null::text,
  'and so is a title of whitespace'
);

select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed)
     values ('33333333-0000-0000-0000-000000000001', 'Unconfirmed material', 'research',
             'other', 'a', 'b', 'worked', 'c', 'd', false) $$,
  '23514'::text, null::text,
  'the third-party material confirmation must be true, not merely answered'
);

select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed)
     values ('33333333-0000-0000-0000-000000000001', 'Too long', 'research', 'other',
             repeat('x', 601), 'b', 'worked', 'c', 'd', true) $$,
  '23514'::text, null::text,
  'an aim past the hard cap is refused'
);

select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed, author_confidence)
     values ('33333333-0000-0000-0000-000000000001', 'Confident', 'research', 'other',
             'a', 'b', 'worked', 'c', 'd', true, 11) $$,
  '23514'::text, null::text,
  'confidence is on the site''s 0 to 10 scale and nothing outside it'
);

-- Disclosure only means something relative to a publication. Without this the corpus fills
-- with "not published, disclosed: no", which reads as a failure to disclose and is
-- actually a question that did not apply.
select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed, was_published, was_disclosed)
     values ('33333333-0000-0000-0000-000000000001', 'Undisclosed', 'research', 'other',
             'a', 'b', 'worked', 'c', 'd', true, false, false) $$,
  '23514'::text, null::text,
  'disclosure cannot be answered about a paper that was never published'
);

select throws_ok(
  $$ insert into public.practices
       (author_id, title, area, task_type, aim, method, outcome, outcome_notes,
        verification, third_party_material_confirmed, transcript_url)
     values ('33333333-0000-0000-0000-000000000001', 'Bad link', 'research', 'other',
             'a', 'b', 'worked', 'c', 'd', true, 'javascript:alert(1)') $$,
  '23514'::text, null::text,
  'a transcript link that is not http or https is refused'
);

select throws_ok(
  $$ update public.practices set deleted_at = now()
      where id = '44444444-0000-0000-0000-000000000001' $$,
  '23514'::text, null::text,
  'half a soft-delete is refused: a deletion has a time and a hand'
);

-- ── At least one tool ───────────────────────────────────────────────────────────────
-- The check is deferred, so it fires at commit or when constraints are made immediate.
-- This whole file is one transaction that ends in a rollback, so it has to be forced.
--
-- Each block puts the mode back explicitly afterwards. SET CONSTRAINTS lasts for the rest
-- of the transaction, and relying on ROLLBACK TO SAVEPOINT to undo it is relying on a
-- subtlety: the mode survived the rollback here, so the *next* delete fired its check
-- immediately and took the script down five assertions early. Two words of SQL beat
-- knowing which way that goes.

savepoint no_tools;

insert into public.practices
  (id, author_id, title, area, task_type, aim, method, outcome, outcome_notes,
   verification, third_party_material_confirmed)
values ('44444444-0000-0000-0000-000000000009', '33333333-0000-0000-0000-000000000001',
        'A practice with no tools', 'research', 'other', 'a', 'b', 'worked', 'c', 'd', true);

select throws_ok(
  'set constraints all immediate',
  '23514'::text, null::text,
  'a practice recording no tool at all is refused when the deferred check runs'
);

rollback to savepoint no_tools;
set constraints all deferred;

savepoint with_tools;

insert into public.practices
  (id, author_id, title, area, task_type, aim, method, outcome, outcome_notes,
   verification, third_party_material_confirmed)
values ('44444444-0000-0000-0000-00000000000a', '33333333-0000-0000-0000-000000000001',
        'A practice with a tool', 'research', 'other', 'a', 'b', 'worked', 'c', 'd', true);

insert into public.practice_tools (practice_id, tool_name, tool_version, used_on)
values ('44444444-0000-0000-0000-00000000000a', 'Claude', 'Opus 5', current_date);

select lives_ok(
  'set constraints all immediate',
  'the same practice passes once it records one'
);

rollback to savepoint with_tools;
set constraints all deferred;

-- Removing the last tool from a practice that still exists is the other half of the rule.
savepoint last_tool;

delete from public.practice_tools
 where practice_id = '44444444-0000-0000-0000-000000000002';

select throws_ok(
  'set constraints all immediate',
  '23514'::text, null::text,
  'removing the last tool from a practice is refused too'
);

rollback to savepoint last_tool;
set constraints all deferred;

select throws_ok(
  $$ insert into public.practice_tools (practice_id, tool_name, tool_version, used_on)
     values ('44444444-0000-0000-0000-000000000001', 'Tomorrow''s model', '1', current_date + 1) $$,
  '23514'::text, null::text,
  'a tool cannot have been used in the future, which would pin it to the top of every listing'
);

-- ── The tag vocabulary ──────────────────────────────────────────────────────────────

select is(
  (select count(*)::int from public.tags where scheme = 'arxiv'),
  32,
  'all 32 arXiv mathematics subject classes are seeded'
);

select is(
  (select label from public.tags where scheme = 'arxiv' and code = 'math.NT'),
  'Number Theory'::text,
  'with arXiv''s own names'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.tags (scheme, code, label) values ('topic', 'invented', 'Invented') $$,
  '42501'::text, null::text,
  'the tag vocabulary is curated: no browser role can add to it'
);

reset role;

-- ── Child tables follow their parent ────────────────────────────────────────────────

set local role anon;

select is(
  (select count(*)::int from public.practice_tools),
  1,
  'anon sees the tools of published practices and not of pending ones'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.practice_tools),
  2,
  'their author sees both, because they can see both practices'
);

-- Editing a draft means adding and removing tools; editing a published practice does not.
insert into public.practice_tools (practice_id, tool_name, tool_version, used_on)
values ('44444444-0000-0000-0000-000000000002', 'Sage', '10.3', current_date - 2);

select is(
  (select count(*)::int from public.practice_tools
    where practice_id = '44444444-0000-0000-0000-000000000002'),
  2,
  'an author may add a tool to their own pending practice'
);

select throws_ok(
  $$ insert into public.practice_tools (practice_id, tool_name, tool_version, used_on)
     values ('44444444-0000-0000-0000-000000000001', 'Smuggled', '1', current_date) $$,
  '42501'::text, null::text,
  'but not to one that is already published'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.practice_tags (practice_id, tag_id)
     select '44444444-0000-0000-0000-000000000002', id
       from public.tags where code = 'math.NT' $$,
  '42501'::text, null::text,
  'a member cannot tag somebody else''s practice'
);

reset role;

-- A retired tag stays resolvable on the practices that carry it and cannot be added to new
-- work. That is the whole reason it is retired rather than deleted.
update public.tags set is_active = false where code = 'math.GM';

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.practice_tags (practice_id, tag_id)
     select '44444444-0000-0000-0000-000000000002', id
       from public.tags where code = 'math.GM' $$,
  '42501'::text, null::text,
  'a retired tag cannot be added to new work'
);

reset role;

select * from finish();

rollback;
