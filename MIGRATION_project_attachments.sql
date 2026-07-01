-- MIGRATION: Project file & image attachments.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-07-01.
-- Additive; safe to re-run (idempotent).
--
-- What it does:
--   1. Creates a PRIVATE storage bucket `project-files` for per-project uploads
--      (permits, contracts, site photos, etc.). Private → objects are served only via
--      short-lived SIGNED URLs, never a public URL.
--   2. Creates `public.project_attachments` — one row per uploaded file, holding the
--      storage path + display metadata (original name, mime type, size, who/when).
--   3. RLS on the table AND on storage.objects for this bucket, both scoped to PROJECT
--      OWNERSHIP: a builder can read/write files for a project whose linked contact they
--      own; admins can for ALL projects (incl. contact-less ones). Same shape as the
--      projects RLS (MIGRATION_projects.sql).
--
-- Path convention (set by the app): `{project_id}/{timestamp}-{safe_filename}`, so the
-- first folder segment is the project id — that's what the storage policies check.
--
-- NOTE: deleting a project cascades and removes its attachment ROWS (FK on delete
-- cascade), but does NOT delete the underlying storage objects — the app removes the
-- object explicitly when a file is deleted from the UI. Orphaned objects from a whole-
-- project delete are harmless (private, unreferenced); revisit with a cleanup job later.

-- 1. Private bucket -----------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

-- 2. Metadata table -----------------------------------------------------------
create table if not exists public.project_attachments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  file_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists project_attachments_project_id_idx
  on public.project_attachments (project_id, created_at desc);

-- 3a. Table RLS — ownership derived from the project's contact ----------------
alter table public.project_attachments enable row level security;

drop policy if exists "Access attachments for owned projects, admins all" on public.project_attachments;
create policy "Access attachments for owned projects, admins all"
  on public.project_attachments for all to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_attachments.project_id
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_attachments.project_id
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );

-- 3b. Storage RLS — same ownership check, keyed off the {project_id}/ folder --
-- The project id is the first path segment (storage.foldername(name))[1]::uuid.
drop policy if exists "Read project files for owned projects" on storage.objects;
create policy "Read project files for owned projects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.projects p
      where p.id = ((storage.foldername(name))[1])::uuid
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );

drop policy if exists "Upload project files for owned projects" on storage.objects;
create policy "Upload project files for owned projects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.projects p
      where p.id = ((storage.foldername(name))[1])::uuid
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );

drop policy if exists "Update project files for owned projects" on storage.objects;
create policy "Update project files for owned projects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.projects p
      where p.id = ((storage.foldername(name))[1])::uuid
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );

drop policy if exists "Delete project files for owned projects" on storage.objects;
create policy "Delete project files for owned projects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.projects p
      where p.id = ((storage.foldername(name))[1])::uuid
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );
