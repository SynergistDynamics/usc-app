-- MIGRATION: normalize placeholder ShedPro ids so they don't collide on the upsert key.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-29.
--
-- Background: the Zapier integration writes ShedPro leads to the Supabase REST API with
--   POST /rest/v1/contacts?on_conflict=shedpro_id   (Prefer: resolution=merge-duplicates)
-- which PostgREST turns into `INSERT ... ON CONFLICT (shedpro_id) DO UPDATE`. The dedup
-- key is shedpro_id (plain unique index, see MIGRATION_contacts_shedpro_upsert_index.sql).
--
-- The bug this fixes: ShedPro can send a placeholder id of '0' (or blank) for a lead that
-- has no real customer id yet. Because the unique index treats equal NON-null values as the
-- SAME row, EVERY such lead lands on the one row whose shedpro_id='0' and OVERWRITES it
-- instead of inserting a new contact. Zapier still gets HTTP 200 (an update) and reports
-- success, so the missing lead is silent. (This is exactly how "Yonatan Hopp" went missing:
-- the only shedpro_id='0' row was Shawn Groves, which kept getting overwritten.)
-- Postgres treats NULLs as DISTINCT in a unique index, so NULL ids never collide.
--
-- Fix: a BEFORE INSERT/UPDATE trigger coerces blank/whitespace/'0' to NULL. BEFORE triggers
-- run before ON CONFLICT arbitration, so a placeholder id inserts a FRESH row instead of
-- merging onto the existing shedpro_id='0' row. Real ids (e.g. '10491') are untouched and
-- still dedup normally.
--
-- Tradeoff (already noted in ZAPIER_CONTACTS.md): an id-less lead won't dedup on re-sync —
-- re-syncing the same id-less customer inserts another row. That's preferable to silently
-- overwriting an unrelated contact; de-dup such rows by hand if needed.

create or replace function public.contacts_normalize_shedpro_id()
returns trigger
language plpgsql
as $$
begin
  if new.shedpro_id is not null
     and (btrim(new.shedpro_id) = '' or btrim(new.shedpro_id) = '0') then
    new.shedpro_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_normalize_shedpro_id_biu on public.contacts;
create trigger contacts_normalize_shedpro_id_biu
  before insert or update on public.contacts
  for each row execute function public.contacts_normalize_shedpro_id();

-- One-time cleanup of the sentinel row(s) that were acting as a collision magnet.
update public.contacts
set shedpro_id = null
where btrim(coalesce(shedpro_id, '')) in ('', '0');
