-- ============================================================================
-- MIGRATION: Shed styles & add-ons become packages
-- Run this ONCE in the Supabase SQL Editor (Project → SQL Editor → New query).
-- It is NOT idempotent — running it twice creates duplicate packages.
--
-- What it does:
--   1. Adds packages.is_style and creates the style_multipliers table (+RLS).
--   2. Creates one size-variable "shed style" package per row in `styles`,
--      copies the current base-material quantities into each, and bakes the old
--      default 2.5x general multiplier x the style markup into the package default.
--   3. Seeds each existing builder's personal per-style multiplier
--      = that builder's multiplier x (1 + style markup %), so prices match today.
--   4. Converts each add-on material into its own size-variable package.
--
-- The old `quantities` and `styles` tables are left untouched (safe to keep as a
-- backup; you can drop them later once you've confirmed everything looks right).
-- ============================================================================

-- ── 1. SCHEMA ───────────────────────────────────────────────────────────────
alter table packages add column if not exists is_style boolean not null default false;

create table if not exists style_multipliers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id)  on delete cascade,
  package_id  uuid not null references packages(id)  on delete cascade,
  multiplier  numeric not null default 2.5,
  updated_at  timestamptz not null default now(),
  unique (user_id, package_id)
);

alter table style_multipliers enable row level security;

-- Users manage their own rows; admins manage everyone's.
drop policy if exists style_mult_select on style_multipliers;
drop policy if exists style_mult_insert on style_multipliers;
drop policy if exists style_mult_update on style_multipliers;
drop policy if exists style_mult_delete on style_multipliers;

create policy style_mult_select on style_multipliers for select
  using ( auth.uid() = user_id or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );
create policy style_mult_insert on style_multipliers for insert
  with check ( auth.uid() = user_id or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );
create policy style_mult_update on style_multipliers for update
  using ( auth.uid() = user_id or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );
create policy style_mult_delete on style_multipliers for delete
  using ( auth.uid() = user_id or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );

-- ── 2. DATA MIGRATION ───────────────────────────────────────────────────────
begin;

create temp table _style_map (style_id uuid, package_id uuid, markup numeric) on commit drop;

-- 2a. Create one style package per existing style, with base components + quantities
do $$
declare s record; pid uuid; ord int;
begin
  select coalesce(max(sort_order), 0) into ord from packages;
  for s in select * from styles order by sort_order loop
    ord := ord + 1;
    insert into packages (name, description, multiplier, size_variable, is_style,
                          siding_type, allow_quantity, flat_rate, sort_order, updated_at)
    values (s.name, 'Shed style (migrated)',
            round(2.5 * (1 + coalesce(s.markup,0)/100.0), 4),
            true, true, null, false, null, ord, now())
    returning id into pid;

    insert into _style_map values (s.id, pid, coalesce(s.markup,0));

    -- base materials (everything in group 'base' except t111, which is siding)
    insert into package_materials (package_id, material_id, fixed_quantity)
    select pid, m.id, null
    from materials m
    where m.material_group = 'base' and m.id <> 't111';

    -- per-size quantities copied from the global quantities table
    insert into package_quantities (package_id, material_id, shed_size, quantity, updated_at)
    select pid, q.material_id, q.shed_size, q.quantity, now()
    from quantities q
    join materials m on m.id = q.material_id
    where m.material_group = 'base' and m.id <> 't111';
  end loop;
end $$;

-- 2b. Seed each builder's personal per-style multiplier so prices match today
--     (builder.multiplier x (1 + style markup %))
insert into style_multipliers (user_id, package_id, multiplier, updated_at)
select p.id, sm.package_id,
       round(coalesce(p.multiplier, 2.5) * (1 + sm.markup/100.0), 4),
       now()
from profiles p
cross join _style_map sm
where p.role in ('admin', 'builder')
on conflict (user_id, package_id) do nothing;

-- 2c. Convert add-on materials into size-variable packages
--     (siding materials clapboard/bAndB are excluded — siding stays its own packages)
do $$
declare a record; pid uuid; ord int;
begin
  select coalesce(max(sort_order), 0) into ord from packages;
  for a in select * from materials
           where material_group = 'addon' and id not in ('clapboard','bAndB')
           order by sort_order loop
    ord := ord + 1;
    insert into packages (name, description, multiplier, size_variable, is_style,
                          siding_type, allow_quantity, flat_rate, sort_order, updated_at)
    values (a.name, 'Add-on (migrated)', 2.5, true, false, null,
            coalesce(a.allow_quantity, false), null, ord, now())
    returning id into pid;

    insert into package_materials (package_id, material_id, fixed_quantity)
    values (pid, a.id, null);

    insert into package_quantities (package_id, material_id, shed_size, quantity, updated_at)
    select pid, q.material_id, q.shed_size, q.quantity, now()
    from quantities q
    where q.material_id = a.id;
  end loop;
end $$;

commit;

-- Done. Reload the app — "Shed Styles" should appear under Packages, and the
-- Configurator Pricing grid should show the same numbers it did before.
