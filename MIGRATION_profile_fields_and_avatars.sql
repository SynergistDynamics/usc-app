-- MIGRATION: Builder profile page — richer profile fields + avatar storage.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-23.
-- All changes are additive and nullable, so re-running is safe (idempotent).
--
-- What it does:
--   1. Adds profile columns: avatar_url, phone, company_name, website, bio.
--      (full_name + market already existed on profiles.)
--   2. Creates a PUBLIC storage bucket `avatars` for profile photos.
--   3. Storage RLS: each user can only upload/update/delete files inside their own
--      {user_id}/ folder. Reads need NO policy — a public bucket serves objects via its
--      public URL directly (a broad SELECT policy would only add file-LISTING, which we
--      don't want, so it's intentionally omitted; see the avatars advisor note).
--
-- Note: builders editing their own profile rely on the EXISTING profiles policy
--   "Users can update own profile" (USING auth.uid() = id). The Profile UI only
--   exposes safe fields (never role), but that policy technically lets a user edit
--   their own role — pre-existing, out of scope here. Tighten later if needed.

-- 1. Profile columns ----------------------------------------------------------
alter table public.profiles add column if not exists avatar_url   text;
alter table public.profiles add column if not exists phone        text;
alter table public.profiles add column if not exists company_name text;
alter table public.profiles add column if not exists website      text;
alter table public.profiles add column if not exists bio          text;

-- 2. Public avatars bucket ----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3. Storage RLS --------------------------------------------------------------
-- NOTE: no SELECT policy on purpose. avatars is a PUBLIC bucket, so its objects are
-- readable via the public URL with no policy. Adding a broad SELECT policy would only
-- grant file-LISTING of the whole bucket (flagged by the storage advisor), so we omit it.
drop policy if exists "Avatar images are publicly readable" on storage.objects;

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
