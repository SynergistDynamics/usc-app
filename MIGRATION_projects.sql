-- MIGRATION: Projects (ARCHITECTURE.md step 3 — project management).
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-25.
--
-- A PROJECT is a shed job for a contact. Every project belongs to exactly one
-- contact (contact_id); a contact can have many projects (one-to-many). A project
-- carries ALL the inputs of the Materials Calculator (shed size, style package,
-- siding, selected option packages + per-package price overrides) so a full
-- materials list can be generated from the saved project later (and is previewed
-- live on the project page today).
--
-- Tenancy / RLS: projects are NOT owned directly. Ownership is DERIVED from the
-- parent contact — a builder sees/edits projects whose contact they own; admins
-- see/edit all. This means reassigning a contact to another builder automatically
-- moves its projects too, with no redundant owner column to keep in sync. Same
-- admin-sees-all shape as contacts (MIGRATION_contacts.sql). Restricted to the
-- `authenticated` role so the public anon key gets nothing.

-- 1. Table --------------------------------------------------------------------
create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  -- parent contact. Deleting a contact deletes its projects.
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  name              text,
  status            text not null default 'draft',  -- draft | quoted | sold | completed | cancelled

  -- ── Materials-calculator inputs (mirror PricingTool's cfg) ──────────────────
  shed_size         text,                                -- e.g. '10x12'
  style_package_id  uuid references public.packages(id) on delete set null,  -- the shed style package
  siding            text,                                -- 'T1-11' | 'Clapboard' | 'B&B' | 'Western Red Cedar' | 'None'
  selected_packages jsonb not null default '{}'::jsonb,  -- { package_id: count } — option packages & add-ons
  package_overrides jsonb not null default '{}'::jsonb,  -- { package_id: unit_price_override }

  -- ── Sale tracking ───────────────────────────────────────────────────────────
  sale_price        numeric,        -- agreed customer price (set when sold)
  sold_at           timestamptz,    -- stamped when status first becomes a sold status

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists projects_contact_id_idx on public.projects(contact_id);
create index if not exists projects_status_idx     on public.projects(status);

-- 2. Keep updated_at fresh ----------------------------------------------------
create or replace function public.set_projects_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_projects_updated_at();

-- 3. RLS — ownership derived from the parent contact --------------------------
alter table public.projects enable row level security;

drop policy if exists "Builders manage own projects, admins all" on public.projects;
create policy "Builders manage own projects, admins all"
  on public.projects for all to authenticated
  using (
    exists (
      select 1 from public.contacts c
      where c.id = projects.contact_id
        and (
          c.user_id = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  )
  with check (
    exists (
      select 1 from public.contacts c
      where c.id = projects.contact_id
        and (
          c.user_id = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );
