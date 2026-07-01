-- MIGRATION: FIX the project-files storage RLS policies.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-07-01 (via MCP).
--
-- BUG: the 4 storage.objects policies from MIGRATION_project_attachments.sql wrote the
-- object-name check as `((storage.foldername(name))[1])::uuid` INSIDE a
-- `select 1 from public.projects p ...` subquery. Because `projects` also has a `name`
-- column, the unqualified `name` bound to **projects.name** (the project title, e.g.
-- "4x8 Tall Modern #5860") instead of the storage object's name. foldername() on the
-- title never yields the project id, so the EXISTS was always false and EVERY
-- upload/read/update/delete was RLS-rejected — the client saw HTTP 400 "new row violates
-- row-level security policy" and no file ever landed. (The avatars policy is immune: its
-- subquery has no other `name` column in scope.)
--
-- FIX: qualify the object's name as `objects.name` so it binds to the storage.objects row.
-- The 4 recreated policies below are identical to the originals except for that
-- qualification. This is the source of truth (the main migration file was also updated).

drop policy if exists "Read project files for owned projects" on storage.objects;
create policy "Read project files for owned projects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.projects p
      where p.id = ((storage.foldername(objects.name))[1])::uuid
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
      where p.id = ((storage.foldername(objects.name))[1])::uuid
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
      where p.id = ((storage.foldername(objects.name))[1])::uuid
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
      where p.id = ((storage.foldername(objects.name))[1])::uuid
        and (
          exists (select 1 from public.contacts c where c.id = p.contact_id and c.user_id = auth.uid())
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );
