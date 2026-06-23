-- MIGRATION (hotfix): restore a SELECT policy on the avatars bucket.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-23.
--
-- Regression: MIGRATION_profile_fields_and_avatars.sql (as first shipped) dropped the
-- public-read SELECT policy on storage.objects to stop bucket-wide listing. But that left
-- storage.objects with NO select policy at all, and supabase-js reads the object back
-- after uploading (INSERT ... RETURNING) — with no passing SELECT policy that read-back is
-- denied, so EVERY avatar upload failed with "new row violates row-level security policy".
--
-- Fix: add a SELECT policy scoped to the user's OWN {user_id}/ folder. This makes the
-- upload read-back succeed while still avoiding bucket-wide listing (a user can only list
-- their own folder). Public avatar display continues to work via the public object URL,
-- which does not depend on this policy.

drop policy if exists "Users can read their own avatars" on storage.objects;
create policy "Users can read their own avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
