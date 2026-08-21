-- The free-text half of the `other` category, added by 20260821100000.
--
-- `category_other` is required exactly when the category is `other` and refused otherwise --
-- the same both-directions CHECK as `reports.area_other`, and for the same reason: an
-- unqualified `other` is a row that has opted out of the axis, and a label on a row that is
-- not `other` is a field nothing will ever display and somebody will eventually read as data.

alter table public.network_entries
  add column category_other text;

alter table public.network_entries
  add constraint network_entries_category_other_iff_other check (
    case
      when category = 'other' then length(btrim(coalesce(category_other, ''))) between 1 and 80
      else category_other is null
    end
  );

-- INSERT and UPDATE on this table are granted **per column**, so a new column arrives with no
-- privilege at all and the grant has to be issued in the same migration that adds it. Skipping
-- this does not look like a missing grant: the column is there, the CHECK is there, the policy
-- matches, and every submission dies with `permission denied for table network_entries`. That
-- is exactly how schema version 2 broke the report form twice. Check the grants first.
grant insert (category_other) on public.network_entries to authenticated;
grant update (category_other) on public.network_entries to authenticated;

-- Reissued to add `category_other` to the freeze list. A content column the guard forgets is a
-- column that can be rewritten after publication, silently. Signature unchanged, so
-- `create or replace` is safe here; the body is the one from 20260817130000_rename_vocabulary,
-- which is the latest migration to touch this function -- read that one, not the one that
-- created it, or the overload trap in CLAUDE.md is waiting.
create or replace function private.protect_network_columns()
returns trigger
language plpgsql
security invoker        -- must remain INVOKER: current_user check decides who is trusted
set search_path = ''
as $$
declare
  v_is_trusted boolean;
begin
  new.updated_at := now();

  v_is_trusted :=
       current_user = 'service_role'
    or pg_has_role(
         current_user,
         (select c.relowner
            from pg_catalog.pg_class c
           where c.oid = 'public.network_entries'::pg_catalog.regclass),
         'USAGE');

  if v_is_trusted then
    return new;
  end if;

  -- Immutable for everyone.
  new.id           := old.id;
  new.submitter_id := old.submitter_id;
  new.created_at   := old.created_at;

  -- Status, link check, and moderation columns are for moderators and the link-check
  -- script respectively. No browser caller may write them.
  new.status             := old.status;
  new.link_status        := old.link_status;
  new.link_checked_at    := old.link_checked_at;
  new.moderation_note    := old.moderation_note;
  new.moderation_note_at := old.moderation_note_at;
  new.moderation_note_by := old.moderation_note_by;

  -- Restoring a deleted entry is a moderation action.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
  end if;

  -- Once past pending, the content is fixed.
  if old.status <> 'pending' then
    new.title          := old.title;
    new.url            := old.url;
    new.url_normalised := old.url_normalised;
    new.category       := old.category;
    new.category_other := old.category_other;
    new.description    := old.description;
    new.relevance      := old.relevance;
  end if;

  return new;
end;
$$;
