-- MIGRATION: Lock down self-service profile edits (prevent privilege escalation).
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-23.
--
-- Background: the "Users can update own profile" policy had USING (auth.uid() = id)
-- and NO explicit WITH CHECK, so Postgres used the USING expression as the check too.
-- That let a user update their OWN row freely — including changing their own `role`
-- to 'admin' or granting themselves `is_super_admin` via the API. The app UI never
-- exposed those fields, but the policy itself allowed it.
--
-- This migration recreates the policy with a WITH CHECK that pins `role` and
-- `is_super_admin` to their current stored values, so a self-update can change every
-- other field (name, market, sales_tax, avatar, etc.) but NOT escalate privileges.
--
-- Admins are unaffected: the separate "Admin can update any profile" policy (permissive,
-- OR'd with this one) still lets admins change anyone's role from the Admin panel.
--
-- The subqueries read profiles under its permissive SELECT policies (USING true), so
-- there's no RLS recursion. Idempotent: drops the old policy by name and recreates it.

drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and is_super_admin = (select p.is_super_admin from public.profiles p where p.id = auth.uid())
  );
