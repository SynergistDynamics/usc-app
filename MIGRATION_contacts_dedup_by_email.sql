-- MIGRATION: switch ShedPro contact de-duplication from shedpro_id to email.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-29.
--
-- Why: every ShedPro contact has an email, but shedpro_id is sent for very few leads and
-- sometimes arrives as the junk value '0' (see MIGRATION_contacts_normalize_shedpro_id.sql
-- for the bug that caused — a placeholder id collapsed many leads onto one row). Email has
-- ~100% coverage and is the far more reliable dedup key, so the Zapier upsert now conflicts
-- on email instead of shedpro_id.
--
-- IMPORTANT — Zapier side (not in this file): change the action URL from
--   .../rest/v1/contacts?on_conflict=shedpro_id
-- to
--   .../rest/v1/contacts?on_conflict=email
-- (keep Prefer: resolution=merge-duplicates). `email` must be mapped (it's now the dedup key).
-- shedpro_id is still STORED (handy for reference), it's just no longer the conflict key.
--
-- Caveats (acceptable for this single-pipeline use):
--   * email is global/unique across ALL contacts (incl. manual + every builder). If the same
--     email ever arrives for two builders, the second sync MERGES onto the first row (and the
--     auto-assign trigger could move ownership). There were zero cross-owner email collisions
--     at switch time; "one person = one contact" is generally desired.
--   * email is mutable: if a customer's email changes in ShedPro, a re-sync inserts a new row
--     instead of updating the old one.

-- ── One-time data prep (run before creating the unique index) ──────────────────────────
-- (a) De-dupe pre-existing duplicate-email rows. At switch time there were exactly 4 pairs,
--     all same-person/same-owner, where the OLDER row held all the projects and the NEWER
--     row had none — so the newer, project-less rows were deleted:
--   delete from contacts where id in (
--     'c05eb8ff-f18c-42e1-9180-ca63e7fa7122',  -- Chris Sault (dup)
--     '18afb268-ac12-419c-8aa1-051bffd83a8d',  -- David Galilei (dup)
--     'ae8964a6-e0cc-4adf-9e81-f8d7c649d7b2',  -- Isaac Martell (dup)
--     'bb8cbb08-d572-4243-9e94-a1a542fb2573'   -- Jordan Shorthouse (dup)
--   );
-- (b) Normalize existing emails to the canonical form the trigger below enforces:
--   update contacts set email = nullif(lower(btrim(email)), '')
--   where email is distinct from nullif(lower(btrim(email)), '');

-- ── Schema ──────────────────────────────────────────────────────────────────────────────
-- 1) Normalize email on write (lowercase + trim; blank -> NULL) so the unique key is
--    case/whitespace-insensitive. BEFORE triggers run before ON CONFLICT arbitration, so an
--    incoming 'John@X.com ' upserts onto the stored 'john@x.com' row. NULL emails are
--    distinct in a unique index, so an email-less contact never collides.
create or replace function public.contacts_normalize_email()
returns trigger
language plpgsql
as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  return new;
end;
$$;

drop trigger if exists contacts_normalize_email_biu on public.contacts;
create trigger contacts_normalize_email_biu
  before insert or update on public.contacts
  for each row execute function public.contacts_normalize_email();

-- 2) Unique index on email = the new on_conflict arbiter for the Zapier upsert. Plain
--    (non-partial) so PostgREST can use it as an ON CONFLICT target.
create unique index if not exists contacts_email_key on public.contacts (email);

-- 3) shedpro_id is no longer the dedup key: drop its UNIQUE index (a stray real-id match
--    would otherwise raise a unique violation the on_conflict=email upsert can't resolve)
--    and replace it with a plain index for lookups.
drop index if exists public.contacts_shedpro_id_key;
create index if not exists contacts_shedpro_id_idx on public.contacts (shedpro_id);
