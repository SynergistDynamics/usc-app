-- MIGRATION: make contacts.shedpro_id upsert-able from Zapier.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-25.
--
-- Background: the Zapier integration writes ShedPro leads to the Supabase REST API with
--   POST /rest/v1/contacts?on_conflict=shedpro_id   (Prefer: resolution=merge-duplicates)
-- so the same ShedPro customer updates their row instead of duplicating. PostgREST turns
-- that into `INSERT ... ON CONFLICT (shedpro_id) DO UPDATE`, and Postgres can only use an
-- index as the ON CONFLICT arbiter if it is NON-partial. The original index from
-- MIGRATION_contacts.sql was partial (`WHERE shedpro_id IS NOT NULL`), which would make
-- the upsert fail with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". A plain unique index still allows the 686 seeded rows that have a NULL
-- shedpro_id (Postgres treats NULLs as distinct in a unique index), so nothing else breaks.

drop index if exists public.contacts_shedpro_id_key;
create unique index contacts_shedpro_id_key on public.contacts (shedpro_id);
