-- MIGRATION: Contacts (first step of the ShedPro integration).
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-25.
--
-- Background: the platform is growing toward project management + ShedPro integration
-- (see ARCHITECTURE.md step 5). The first piece is a Contacts page where each builder
-- keeps their customers/leads. Contacts are created manually in the app today; ShedPro
-- leads will be pushed in LATER via Zapier (Zapier writes to Supabase's REST API), which
-- is why this table carries a `source` and a `shedpro_id` for de-duped upserts.
--
-- Tenancy: single-user-per-builder (ARCHITECTURE.md §2). A contact is OWNED by one
-- builder via `user_id`. RLS scopes it: a builder reads/writes only their own contacts;
-- admins read/write everyone's (same shape as the referrals policy). Restricted to the
-- `authenticated` role so the public anon key gets nothing.

-- 1. Table --------------------------------------------------------------------
create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  -- owner = the builder this contact belongs to. References profiles(id) (which is
  -- auth.users(id)) so PostgREST can embed the owner for the admin view. Defaults to the
  -- inserting user so a manual "Add contact" auto-assigns to the current builder.
  user_id      uuid references public.profiles(id) on delete set null default auth.uid(),
  full_name    text,
  email        text,
  phone        text,
  company_name text,
  address      text,
  city         text,
  state        text,
  zip          text,
  market       text,
  status       text not null default 'lead',     -- lead | quoted | customer | closed | lost
  source       text not null default 'manual',   -- manual | shedpro | zapier | ...
  shedpro_id   text,                              -- external id from ShedPro, for Zapier upserts/dedup
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists contacts_user_id_idx on public.contacts(user_id);
-- Partial unique index lets a future Zapier integration upsert on conflict(shedpro_id)
-- without colliding on the many manual rows that have no shedpro_id.
create unique index if not exists contacts_shedpro_id_key
  on public.contacts(shedpro_id) where shedpro_id is not null;

-- 2. Keep updated_at fresh ----------------------------------------------------
create or replace function public.set_contacts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_contacts_updated_at();

-- 3. RLS — builders manage their own, admins manage all -----------------------
alter table public.contacts enable row level security;

drop policy if exists "Builders manage own contacts, admins all" on public.contacts;
create policy "Builders manage own contacts, admins all"
  on public.contacts for all to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
