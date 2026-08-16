-- Who may read and write a resource, and what the URL deduplication does.
--
-- The same two-direction discipline as 008_practice_rls.test.sql: every allowed case
-- is verified, and every forbidden case is verified too. The negative assertions are the
-- ones that would fail the day a policy is loosened.
--
-- Two behaviours that look like bugs and are not:
--
--   An author self-publishing succeeds and changes nothing. The guard reverts status
--   before RLS evaluates the new row, so the WITH CHECK passes on a still-pending row.
--
--   An author editing their own published resource raises 42501. The guard reverts the
--   text but leaves deleted_at null, and no policy's WITH CHECK accepts that row.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(35);

-- ── People ──────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('33331111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'res_submitter@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33331111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'res_bystander@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33331111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'res_unconfirmed@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33331111-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'res_banned@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33331111-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'res_moderator@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now()
 where id <> '33331111-0000-0000-0000-000000000003';

update public.profiles set is_banned = true
 where id = '33331111-0000-0000-0000-000000000004';

update public.profiles set role = 'moderator'
 where id = '33331111-0000-0000-0000-000000000005';

select is(
  (select count(*)::int from public.profiles where confirmed_at is not null),
  4,
  'four of the five fixtures have a confirmed account'
);

-- ── Resources ───────────────────────────────────────────────────────────────────────────

insert into public.resources (
  id, submitter_id, status, title, url, url_normalised, category, description, relevance, deleted_at, deleted_by
) values
  -- Published resource, submitter 1
  ('44440000-0000-0000-0000-000000000001', '33331111-0000-0000-0000-000000000001',
   'published', 'Lean 4 documentation', 'https://leanprover.github.io/lean4/doc/',
   private.normalise_url('https://leanprover.github.io/lean4/doc/'),
   'formalisation', 'Official Lean 4 reference.', 'Lean 4 is the proof assistant most used for formalising mathematics in our community.', null, null),

  -- Pending resource, submitter 1
  ('44440000-0000-0000-0000-000000000002', '33331111-0000-0000-0000-000000000001',
   'pending', 'Draft resource', 'https://example.com/draft',
   private.normalise_url('https://example.com/draft'),
   'reading', 'A draft.', 'Interesting for reasons.', null, null),

  -- Hidden resource, submitter 1
  ('44440000-0000-0000-0000-000000000003', '33331111-0000-0000-0000-000000000001',
   'hidden', 'Hidden resource', 'https://example.com/hidden',
   private.normalise_url('https://example.com/hidden'),
   'community', 'Hidden.', 'Relevant but hidden.', null, null),

  -- Soft-deleted resource, submitter 1
  ('44440000-0000-0000-0000-000000000004', '33331111-0000-0000-0000-000000000001',
   'published', 'Deleted resource', 'https://example.com/deleted',
   private.normalise_url('https://example.com/deleted'),
   'research_tool', 'Deleted.', 'This was deleted.', now(), '33331111-0000-0000-0000-000000000001'),

  -- Published resource, submitter 2
  ('44440000-0000-0000-0000-000000000005', '33331111-0000-0000-0000-000000000002',
   'published', 'ChatGPT for mathematics', 'https://chat.openai.com/',
   private.normalise_url('https://chat.openai.com/'),
   'research_tool', 'OpenAI ChatGPT interface.', 'Widely used in the community.', null, null);

-- ── Reading ─────────────────────────────────────────────────────────────────────────────

set local role anon;

select is(
  (select count(*)::int from public.resources),
  2,
  'anon sees only published, undeleted resources'
);

select is_empty(
  $$ select id from public.resources where status <> 'published' $$,
  'anon sees nothing pending or hidden'
);

select is_empty(
  $$ select id from public.resources where deleted_at is not null $$,
  'anon sees nothing soft-deleted'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.resources),
  2,
  'another member sees the published corpus and no more'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.resources),
  5,
  'a submitter sees their own work in every state, plus the published corpus'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*)::int from public.resources),
  5,
  'a moderator sees everything, including deleted rows'
);

reset role;

-- ── Writing: who may post at all ────────────────────────────────────────────────────────

set local role anon;

select throws_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000001', 'From nowhere', 'https://example.com/anon',
             'reading', 'A description.', 'Some relevance.') $$,
  '42501'::text, null::text,
  'anon cannot post a resource'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000003', 'Unconfirmed', 'https://example.com/unconfirmed',
             'reading', 'A description.', 'Some relevance.') $$,
  '42501'::text, null::text,
  'an unconfirmed account cannot post'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000004', 'Banned', 'https://example.com/banned',
             'reading', 'A description.', 'Some relevance.') $$,
  '42501'::text, null::text,
  'a banned account cannot post'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000001', 'Under a false name', 'https://example.com/false-name',
             'reading', 'A description.', 'Some relevance.') $$,
  '42501'::text, null::text,
  'a member cannot post under somebody else''s name'
);

-- The allowed case.
insert into public.resources
  (submitter_id, title, url, category, description, relevance)
values ('33331111-0000-0000-0000-000000000002',
        'A perfectly ordinary submission', 'https://example.com/ordinary',
        'educational', 'An educational resource.', 'Useful for mathematicians learning AI tools.');

reset role;

select is(
  (select status::text from public.resources where title = 'A perfectly ordinary submission'),
  'pending'::text,
  'a confirmed member may post, and what they post starts pending'
);

select is(
  (select url_normalised from public.resources where title = 'A perfectly ordinary submission'),
  'example.com/ordinary',
  'url_normalised is computed on insert (scheme stripped, lowercase)'
);

-- ── Writing: editing your own ────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

update public.resources
   set title = 'Lean 4 documentation, revised'
 where id = '44440000-0000-0000-0000-000000000002';

reset role;

select is(
  (select title from public.resources where id = '44440000-0000-0000-0000-000000000002'),
  'Lean 4 documentation, revised'::text,
  'a submitter may edit their own pending resource'
);

-- Self-publishing: guard reverts status, WITH CHECK passes on still-pending row.
set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

update public.resources set status = 'published'
 where id = '44440000-0000-0000-0000-000000000002';

reset role;

select is(
  (select status::text from public.resources where id = '44440000-0000-0000-0000-000000000002'),
  'pending'::text,
  'a submitter cannot publish their own resource; the guard reverts status silently'
);

-- Editing a published resource.
set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ update public.resources set title = 'Rewriting history'
      where id = '44440000-0000-0000-0000-000000000001' $$,
  '42501'::text, null::text,
  'a submitter cannot edit their own resource once it is published'
);

reset role;

-- ── Soft deletion ────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

update public.resources
   set deleted_at = now(), deleted_by = '33331111-0000-0000-0000-000000000001'
 where id = '44440000-0000-0000-0000-000000000001';

reset role;

select isnt(
  (select deleted_at from public.resources where id = '44440000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'a submitter may soft-delete their own published resource'
);

-- Restoring: silent no-op (no policy accepts a deleted row for its owner).
set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

update public.resources set deleted_at = null, deleted_by = null
 where id = '44440000-0000-0000-0000-000000000001';

reset role;

select isnt(
  (select deleted_at from public.resources where id = '44440000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'a submitter cannot restore a resource they deleted (silent no-op)'
);

-- ── Moderation ───────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000005","role":"authenticated"}';

select lives_ok(
  $$ select public.moderate(
       'resource',
       (select id from public.resources where title = 'A perfectly ordinary submission'),
       'publish') $$,
  'a moderator may publish a pending resource through the audited path'
);

reset role;

select is(
  (select status::text from public.resources where title = 'A perfectly ordinary submission'),
  'published'::text,
  'and it is published'
);

-- Direct moderator update changes nothing.
set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000005","role":"authenticated"}';

update public.resources set status = 'hidden'
 where title = 'A perfectly ordinary submission';

reset role;

select is(
  (select status::text from public.resources where title = 'A perfectly ordinary submission'),
  'published'::text,
  'a direct moderator update changes nothing: the audit log cannot be stepped around'
);

-- ── No hard delete ───────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ delete from public.resources where id = '44440000-0000-0000-0000-000000000002' $$,
  '42501'::text, null::text,
  'a submitter cannot hard-delete their own resource'
);

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.resources', 'DELETE'),
  'the absent DELETE grant is the reason, not an absent policy'
);

-- ── URL deduplication ────────────────────────────────────────────────────────────────────

-- Submitting the same URL as an existing published resource fails.
set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000002',
             'ChatGPT again', 'https://chat.openai.com/',
             'research_tool', 'OpenAI.', 'Useful.') $$,
  '23505'::text, null::text,
  'the same URL cannot be submitted twice among non-deleted resources'
);

-- UTM variants are also deduplicated: the normalised URL strips tracking params.
select throws_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000002',
             'ChatGPT with UTM', 'https://chat.openai.com/?utm_source=newsletter',
             'research_tool', 'OpenAI.', 'Useful.') $$,
  '23505'::text, null::text,
  'a UTM-decorated URL of a submitted resource is also rejected'
);

reset role;

-- A deleted resource's URL can be resubmitted.
-- (resource 44440000-0000-0000-0000-000000000004 is already soft-deleted above).
set local role authenticated;
set local request.jwt.claims to '{"sub":"33331111-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ insert into public.resources
       (submitter_id, title, url, category, description, relevance)
     values ('33331111-0000-0000-0000-000000000002',
             'Deleted URL resubmitted', 'https://example.com/deleted',
             'reading', 'Resubmitted.', 'The original was deleted.') $$,
  'a URL belonging only to a deleted resource may be resubmitted'
);

reset role;

-- ── Erasure detaches ─────────────────────────────────────────────────────────────────────

delete from auth.users where id = '33331111-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.resources where id = '44440000-0000-0000-0000-000000000005'),
  1,
  'erasing an account leaves the resources it submitted in place'
);

select is(
  (select submitter_id from public.resources where id = '44440000-0000-0000-0000-000000000005'),
  null::uuid,
  'and strips the attribution from them'
);

select * from finish();

rollback;
