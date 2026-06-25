-- MIGRATION: Expand projects for ShedPro data + seed from the ShedPro export.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-25.
--
-- Why: projects now carry the full ShedPro order record (renderings, configured
-- options, colors, fees) — today seeded from a CSV export, in future fed straight
-- from ShedPro via Zapier (same path as contacts). So this adds the raw ShedPro
-- columns and relaxes the contact link.
--
-- Key changes vs MIGRATION_projects.sql:
--   • contact_id is now NULLABLE and ON DELETE SET NULL (was NOT NULL / CASCADE).
--     A ShedPro order can arrive before its customer is a known contact; such a
--     project is admin-only until linked (mirrors contacts' "unassigned = admin
--     only"). Deleting a contact no longer destroys its sale history.
--   • RLS rewritten so admins always see ALL projects (incl. contact-less ones),
--     and a builder sees a project when they own its linked contact.
--   • shedpro_order_id is a PLAIN (non-unique) index — the export contains price
--     REVISIONS of the same order (multiple rows share an order #), so it can't be
--     a unique upsert arbiter.

-- 1. Relax the contact link -------------------------------------------------
alter table public.projects alter column contact_id drop not null;
alter table public.projects drop constraint if exists projects_contact_id_fkey;
alter table public.projects
  add constraint projects_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete set null;

-- 2. Raw ShedPro columns ----------------------------------------------------
alter table public.projects add column if not exists source           text not null default 'manual'; -- manual | shedpro | zapier
alter table public.projects add column if not exists shedpro_order_id text;   -- the ShedPro order # (e.g. 5826); NOT unique (revisions share it)
alter table public.projects add column if not exists shed_style       text;   -- raw style name, e.g. "Tall Modern"
alter table public.projects add column if not exists customer_email   text;   -- ShedPro customer (links to a contact by email)
alter table public.projects add column if not exists builder_email    text;   -- ShedPro "User/Builder" (raw; kept for later reconciliation)
alter table public.projects add column if not exists construction_date date;
alter table public.projects add column if not exists shedpro_created  timestamptz; -- ShedPro "Created" timestamp

-- renderings & docs
alter table public.projects add column if not exists rendering_url_1     text;
alter table public.projects add column if not exists rendering_url_2     text;
alter table public.projects add column if not exists rendering_url_3     text;
alter table public.projects add column if not exists rendering_url_4     text;
alter table public.projects add column if not exists layout_rendering_url text;
alter table public.projects add column if not exists details_url         text;
alter table public.projects add column if not exists work_order_pdf      text; -- raw ShedPro work-order doc blob (kept as text; source isn't valid JSON)

-- configured spec / options (raw ShedPro values)
alter table public.projects add column if not exists siding_type        text;
alter table public.projects add column if not exists overhang_size      text;
alter table public.projects add column if not exists doors              text;
alter table public.projects add column if not exists windows            text;
alter table public.projects add column if not exists transom_package    text;
alter table public.projects add column if not exists vents              text;
alter table public.projects add column if not exists roof               text;
alter table public.projects add column if not exists floor              text;
alter table public.projects add column if not exists siding_color       text;
alter table public.projects add column if not exists trim_color         text;
alter table public.projects add column if not exists door_color         text;
alter table public.projects add column if not exists roof_color         text;
alter table public.projects add column if not exists site_prep          text;
alter table public.projects add column if not exists building_permit    text;
alter table public.projects add column if not exists access             text;
alter table public.projects add column if not exists additional_features text;

create index if not exists projects_shedpro_order_id_idx on public.projects(shedpro_order_id);
create index if not exists projects_customer_email_idx    on public.projects(lower(customer_email));

-- 3. RLS — admins see all; builders see projects whose linked contact they own
alter table public.projects enable row level security;

drop policy if exists "Builders manage own projects, admins all" on public.projects;
create policy "Builders manage own projects, admins all"
  on public.projects for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      contact_id is not null
      and exists (select 1 from public.contacts c where c.id = projects.contact_id and c.user_id = auth.uid())
    )
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      contact_id is not null
      and exists (select 1 from public.contacts c where c.id = projects.contact_id and c.user_id = auth.uid())
    )
  );
