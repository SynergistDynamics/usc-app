-- ============================================================================
-- MIGRATION: "Builder Pro" role — can create/edit packages
-- Run once in the Supabase SQL Editor. Safe to re-run (drops + recreates).
--
-- A Builder Pro is a builder who can ALSO manage package master data
-- (packages, package_materials, package_quantities) — otherwise identical to a
-- builder (own data only, no Admin panel). It is just a new value of
-- profiles.role ('builder_pro'); there is NO check constraint on profiles.role,
-- so no ALTER of the column is needed.
--
-- The packages tables' write policies were hard-coded to role = 'admin'. This
-- migration widens them to role IN ('admin','builder_pro') so a Builder Pro's
-- writes actually succeed (the frontend gating in ConfiguratorPricing/App is
-- UX only — Supabase RLS is the real boundary).
-- ============================================================================

-- Helper predicate used below: current user is an admin OR a builder_pro.
--   exists (select 1 from profiles p
--           where p.id = auth.uid() and p.role in ('admin','builder_pro'))

-- 1) packages — split INSERT / UPDATE / DELETE policies
drop policy if exists "Admin can insert packages" on packages;
create policy "Admins and builder pros can insert packages" on packages
  for insert
  with check ( exists (select 1 from profiles p
                       where p.id = auth.uid() and p.role in ('admin','builder_pro')) );

drop policy if exists "Admin can update packages" on packages;
create policy "Admins and builder pros can update packages" on packages
  for update
  using ( exists (select 1 from profiles p
                  where p.id = auth.uid() and p.role in ('admin','builder_pro')) );

drop policy if exists "Admin can delete packages" on packages;
create policy "Admins and builder pros can delete packages" on packages
  for delete
  using ( exists (select 1 from profiles p
                  where p.id = auth.uid() and p.role in ('admin','builder_pro')) );

-- 2) package_materials — single ALL policy
drop policy if exists "Admin can manage package_materials" on package_materials;
create policy "Admins and builder pros can manage package_materials" on package_materials
  for all
  using      ( exists (select 1 from profiles p
                       where p.id = auth.uid() and p.role in ('admin','builder_pro')) )
  with check ( exists (select 1 from profiles p
                       where p.id = auth.uid() and p.role in ('admin','builder_pro')) );

-- 3) package_quantities — single ALL policy
drop policy if exists "Admin can manage package_quantities" on package_quantities;
create policy "Admins and builder pros can manage package_quantities" on package_quantities
  for all
  using      ( exists (select 1 from profiles p
                       where p.id = auth.uid() and p.role in ('admin','builder_pro')) )
  with check ( exists (select 1 from profiles p
                       where p.id = auth.uid() and p.role in ('admin','builder_pro')) );

-- NOTE: the SELECT (read) policies on these three tables already allow any
-- authenticated user, so they are unchanged. Admin access is unchanged too —
-- 'admin' is still in every predicate.
