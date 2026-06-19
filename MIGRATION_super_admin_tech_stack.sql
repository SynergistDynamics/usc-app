-- ============================================================================
-- MIGRATION: super-admin flag + tech_stack table
-- Run once in the Supabase SQL Editor. Safe to re-run (guards included).
-- ============================================================================

-- 1) Super-admin flag on profiles (separate from role, so admin access is unaffected)
alter table profiles add column if not exists is_super_admin boolean not null default false;

-- 2) Grant super admin to the owner account
update profiles set is_super_admin = true
where lower(email) = 'admin@synergistdynamics.studio';

-- 3) Tech stack table — the software this app runs on + the signup account
create table if not exists tech_stack (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text,
  username    text,                       -- username / email used to sign up
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 4) RLS — only super admins can read or write tech_stack
alter table tech_stack enable row level security;
drop policy if exists tech_stack_super_admin on tech_stack;
create policy tech_stack_super_admin on tech_stack for all
  using      ( exists (select 1 from profiles p where p.id = auth.uid() and p.is_super_admin = true) )
  with check ( exists (select 1 from profiles p where p.id = auth.uid() and p.is_super_admin = true) );

-- 5) Seed the existing Supabase + Netlify links (username left blank — fill in via the UI)
insert into tech_stack (name, url, username, sort_order)
select v.name, v.url, v.username, v.sort_order
from (values
  ('Supabase', 'https://supabase.com/dashboard/project/ywboyreznmuaddprkycm',      null::text, 1),
  ('Netlify',  'https://app.netlify.com/projects/delightful-souffle-129a04/overview', null::text, 2)
) as v(name, url, username, sort_order)
where not exists (select 1 from tech_stack t where t.name = v.name);
