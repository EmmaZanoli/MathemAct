-- Reconstructing the activity feed from history, and doing it exactly once.
--
-- The backfill exists because triggers observe statements and nothing was watching before
-- 20260818120100. Everything that matters about it is in two properties:
--
--   **It uses the real dates.** A feed stamped with the date of the migration would be a
--   lie in the one column people read as history. Every source table carries created_at and
--   public.moderation_actions is a complete dated log, so the reconstruction is exact.
--
--   **It cannot write a row twice.** It has to be safe over rows the triggers already saw,
--   because the migration lands after the triggers have been live for a while, and safe to
--   run again by hand. The guard is the timestamp: a trigger fires in the same transaction
--   as the row that fired it, so the activity row's now() and the source row's created_at
--   are the same value, not merely close. That is what separates the pairs that would
--   otherwise collide — two people rating one debate, several comments on one report.
--
-- The setup below turns the triggers off, writes history underneath them, and turns them
-- back on. That is what the production database looked like on the morning this ran.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path to extensions, public, pg_catalog;

select plan(11);

-- ── People ──────────────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'author@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reader@example.org', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11111111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'moderator@example.org', '{}'::jsonb, '{}'::jsonb, now(), now());

update auth.users set email_confirmed_at = now();
update public.profiles set role = 'moderator' where id = '11111111-0000-0000-0000-000000000003';

-- ── History, written with nothing watching ──────────────────────────────────────────

alter table public.reports            disable trigger reports_activity_insert;
alter table public.comments           disable trigger comments_activity_insert;
alter table public.moderation_actions disable trigger moderation_actions_activity_insert;

insert into public.reports (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed, created_at
) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'published', 'Checking a lemma in Lean', 'research', 'proof_checking',
   'Confirm a lemma.', 'Stated it in Lean.', 'worked', 'It closed.', 'Lean accepted it.',
   true, '2026-07-01T10:00:00Z');

insert into public.comments (id, parent_type, parent_id, author_id, body, created_at)
values
  ('44444444-0000-0000-0000-000000000001', 'report', '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'Did the elaborator accept it without hints?',
   '2026-07-02T09:30:00Z');

insert into public.moderation_actions (actor_id, action, target_type, target_id, created_at)
values
  ('11111111-0000-0000-0000-000000000003', 'publish', 'report',
   '22222222-0000-0000-0000-000000000001', '2026-07-01T16:00:00Z');

alter table public.reports            enable trigger reports_activity_insert;
alter table public.comments           enable trigger comments_activity_insert;
alter table public.moderation_actions enable trigger moderation_actions_activity_insert;

select is(
  (select count(*)::int from public.activity),
  0,
  'nothing was recorded while the triggers were off, which is how the feed came to be empty'
);

-- ── The reconstruction ──────────────────────────────────────────────────────────────

select cmp_ok(
  private.backfill_activity(),
  '>',
  0,
  'the backfill writes rows'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'posted_report'),
  1,
  'a report posted before the feature exists is in its author''s feed afterwards'
);

select is(
  (select created_at from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'posted_report'),
  '2026-07-01T10:00:00Z'::timestamptz,
  'dated when it happened, not when the backfill ran'
);

select is(
  (select actor_id from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'content_commented'),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'somebody else''s comment is reconstructed with their name on it'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'report_published'),
  1,
  'and the decision to publish it, which only the audit log remembered'
);

select is(
  (select actor_id from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'report_published'),
  null::uuid,
  'still without naming the moderator: the backfill goes through the same routing'
);

-- ── Twice ───────────────────────────────────────────────────────────────────────────

select is(
  private.backfill_activity(),
  0,
  'running it again writes nothing'
);

select is(
  (select count(*)::int from public.activity
    where subject_id = '11111111-0000-0000-0000-000000000001'
      and kind = 'posted_report'),
  1,
  'and leaves one row where there was one row'
);

-- ── Over something the triggers already saw ─────────────────────────────────────────
-- The case this has to survive in production: the migration lands after the triggers have
-- been live, so most of what it walks is already there.

insert into public.reports (
  id, author_id, status, title, area, task_type, aim, method, outcome, outcome_notes,
  verification, third_party_material_confirmed
) values
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'pending', 'Posted while the triggers were live', 'writing', 'exposition',
   'Draft a note.', 'Asked, then rewrote.', 'partial', 'Half usable.', 'Checked by hand.',
   true);

select is(
  private.backfill_activity(),
  0,
  'a report the triggers already saw is not reconstructed on top of itself'
);

select is(
  (select count(*)::int from public.activity
    where target_id = '22222222-0000-0000-0000-000000000002'
      and kind = 'posted_report'),
  1,
  'and its feed row is still a single row'
);

select * from finish();

rollback;
