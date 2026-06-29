-- MIGRATION: make projects upsertable from ShedPro via Zapier + auto-link each
-- incoming project to its customer contact by email.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-29.
--
-- Why: contacts already flow ShedPro -> Zapier -> Supabase REST (see
-- ZAPIER_CONTACTS.md). This does the same for PROJECTS (shed jobs): Zapier POSTs
-- each ShedPro project to /rest/v1/projects?on_conflict=shedpro_project_id with
-- Prefer: resolution=merge-duplicates, so a re-sync UPDATES the same row (status
-- -> sold, color/option changes) instead of duplicating. The projects table
-- already carries every raw ShedPro column (renderings, options, colors) from the
-- 2026-06-25 CSV seed (MIGRATION_projects_shedpro.sql); this only adds the bits the
-- LIVE feed needs: a safe dedup key + auto-routing to the right builder. No app
-- code changes — the React app just reads the projects table Zapier fills.
--
-- ── Why a NEW column instead of reusing project_number ──────────────────────────
-- project_number (the ShedPro order #, e.g. 5826) is NOT unique: the CSV export
-- contained price REVISIONS that share a number (755 distinct numbers across 870
-- seed rows), so a UNIQUE index on it is impossible and it can't be an upsert
-- arbiter. So the dedup key is a dedicated `shedpro_project_id`. All 870 seed rows
-- get NULL there; Postgres treats NULLs as DISTINCT in a unique index, so the seed
-- never collides and the index can still arbitrate the live upsert. project_number
-- stays as the human-facing order # (still a plain, non-unique index).

-- 1) Dedup key for the Zapier upsert ────────────────────────────────────────────
alter table public.projects add column if not exists shedpro_project_id text;

-- Normalize placeholder ids to NULL so they don't collapse onto one row. ShedPro
-- can send '0'/blank for a project with no real id yet; the unique index treats
-- equal NON-null values as the same row, so without this every '0' would overwrite
-- the same project (Zapier still gets HTTP 200 — a silent loss). This is the exact
-- bug contacts hit (see MIGRATION_contacts_normalize_shedpro_id.sql). BEFORE
-- triggers run before ON CONFLICT arbitration, so a placeholder inserts a FRESH row.
create or replace function public.projects_normalize_shedpro_project_id()
returns trigger
language plpgsql
as $$
begin
  if new.shedpro_project_id is not null
     and (btrim(new.shedpro_project_id) = '' or btrim(new.shedpro_project_id) = '0') then
    new.shedpro_project_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_normalize_shedpro_project_id_biu on public.projects;
create trigger projects_normalize_shedpro_project_id_biu
  before insert or update on public.projects
  for each row execute function public.projects_normalize_shedpro_project_id();

-- Plain (non-partial) unique index = the on_conflict=shedpro_project_id arbiter for
-- the Zapier upsert. NULLs are distinct, so the 870 seed rows (all NULL here) and
-- any id-less live project never collide.
create unique index if not exists projects_shedpro_project_id_key
  on public.projects (shedpro_project_id);

-- 2) Auto-link an incoming ShedPro project to its customer contact by email ──────
-- A Zapier-inserted project arrives with contact_id NULL (admin-only) but carries
-- customer_email. Ownership is DERIVED from the linked contact (RLS), so without a
-- link every synced project sits admin-only forever. This BEFORE INSERT trigger
-- matches the project's customer email to an existing contact and sets contact_id,
-- so the contact's builder sees the project immediately. No matching contact -> it
-- stays admin-only until linked by hand. Mirrors contacts_auto_assign (territory ->
-- builder) and how the 870 seed rows were linked (801/870 matched by email).
--
-- contacts.email is stored lowercased/trimmed (contacts_normalize_email), so we
-- match on the same canonical form. email is globally UNIQUE in contacts, so at
-- most one row matches. Guarded by `contact_id is null`, so it never clobbers a
-- link Zapier already set. INSERT-only (like contacts_auto_assign) so manual edits
-- in the app — e.g. unlinking a contact — are never re-linked behind the user.
create or replace function public.projects_auto_link_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.contact_id is null and new.customer_email is not null then
    select c.id into new.contact_id
    from public.contacts c
    where c.email = nullif(lower(btrim(new.customer_email)), '')
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_auto_link_contact_bi on public.projects;
create trigger projects_auto_link_contact_bi
  before insert on public.projects
  for each row execute function public.projects_auto_link_contact();
