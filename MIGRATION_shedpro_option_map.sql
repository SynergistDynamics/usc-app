-- MIGRATION: shedpro_option_map — translate ShedPro configurator option labels to
-- app package ids, so the sync (Edge Function shedpro-project-sync) can turn a
-- ShedPro project's option arrays into projects.selected_packages and the materials
-- engine can build the list. Applied to live (ywboyreznmuaddprkycm) on 2026-06-29.
--
-- A ShedPro project spreads its selected options across several arrays, each item
-- carrying a label + price (see scratchpad trigger_sample / ZAPIER_PROJECTS):
--   components[]          (Type vent|door|windows, by Display)
--   interior_components[] (Type workbench|shelf, by Display)
--   overhang[]            (by Name)            loft[] (by Name; style-based — handled in code)
--   frame                 (by Name; only "Painted…" maps)
--   other_upgrades[]      (by Group; hinge / soffit&ridge / flooring / site-prep)
-- The map is keyed by (category, shedpro_value): category = the component/interior
-- Type, or 'overhang'/'frame', or the other_upgrades Group string. NULL/absent map =
-- option is skipped (e.g. "default/included" values like Galvanized hinge, Light Duty
-- floor, Standard overhang; and the NON-MATERIAL groups Building Permit / Access Fees
-- / Travel Charges have no rows on purpose). Loft is NOT in this table — the function
-- picks Loft Modern vs Loft Traditional from the project's style.

create table if not exists public.shedpro_option_map (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,                 -- vent|door|windows|workbench|shelf|overhang|frame|<other_upgrades Group>
  shedpro_value text not null,                 -- the ShedPro Display/Name to match (case-insensitive in the function)
  package_id    uuid not null references public.packages(id) on delete cascade,
  note          text,
  created_at    timestamptz not null default now(),
  unique (category, shedpro_value)
);

alter table public.shedpro_option_map enable row level security;
drop policy if exists "Admins manage shedpro_option_map" on public.shedpro_option_map;
create policy "Admins manage shedpro_option_map"
  on public.shedpro_option_map for all to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Seed: (category, shedpro_value) -> package by name. INNER JOIN, so a typo'd package
-- name simply won't insert (we verify counts after).
insert into public.shedpro_option_map (category, shedpro_value, package_id)
select s.category, s.shedpro_value, p.id
from (values
  -- vents
  ('vent','Round Vent','Round Gable Vent'),
  -- doors (wood)
  ('door','3'' Single Door','Single Wood Door'),
  ('door','5'' Double Door','Double Wood Door'),
  ('door','6'' Double Door','Double Wood Door'),
  ('door','4'' Sliding Roll Door','4'' Sliding Roll Door'),
  -- doors (prehung)
  ('door','3'' Solid Prehung Single Door','Prehung Single Door w/o Glass'),
  ('door','6'' Solid Prehung Double Door','Prehung Double Door w/o Glass'),
  ('door','3'' Full Glass Prehung Single Door','Prehung Single Door w/ Glass'),
  ('door','3'' Half Glass Prehung Single Door','Prehung Single Door w/ Glass'),
  ('door','6'' Full Glass Prehung Double Door','Prehung Double Door w/ Glass'),
  ('door','6'' Half Glass Prehung Double Door','Prehung Double Door w/ Glass'),
  -- windows (slide)
  ('windows','Small','18x27 Shed Window'),
  ('windows','Medium','24x36 Shed Window'),
  ('windows','Large','30x36 Shed Window'),
  ('windows','Medium Insulated','Medium Insulated Window (approx. 24x36)'),
  ('windows','Large Insulated','Large Insulated Window (approx. 32x36)'),
  -- windows (transom — all sizes/shapes collapse to one Transom Package, per 2b)
  ('windows','6'' Traditional Transom','Transom Package'),
  ('windows','8'' Traditional Transom','Transom Package'),
  ('windows','10'' Traditional Transom','Transom Package'),
  ('windows','12'' Traditional Transom','Transom Package'),
  ('windows','14'' Traditional Transom','Transom Package'),
  ('windows','16'' Traditional Transom','Transom Package'),
  ('windows','18'' Traditional Transom','Transom Package'),
  ('windows','20'' Traditional Transom','Transom Package'),
  ('windows','22'' Traditional Transom','Transom Package'),
  ('windows','24'' Traditional Transom','Transom Package'),
  ('windows','28'' Traditional Transom','Transom Package'),
  ('windows','32'' Traditional Transom','Transom Package'),
  ('windows','Small Horizontal','Transom Package'),
  ('windows','Large Horizontal','Transom Package'),
  ('windows','Large Hoizontal','Transom Package'),   -- configurator spelling (sic)
  ('windows','Large Vertical','Transom Package'),
  -- interior (NOTE: inch mark " — these package/label names use inches, not the foot mark)
  ('workbench','24" Deep Workbench','24" Deep Workbench'),
  ('shelf','12" Single Shelf','12" Single Shelf'),
  ('shelf','12" Double Shelf','12" Double Shelf'),
  ('shelf','12" Triple Shelf','12" Triple Shelf'),
  -- overhang (Standard => skip)
  ('overhang','Large','Large 8" Overhangs'),
  -- frame (Basic Wood Stud Interior => skip)
  ('frame','Painted Wood Stud Interior (Non-visualization)','Painted Wood Stud Interior'),
  -- other_upgrades, keyed by Group (defaults/included => skip; non-material groups have no rows)
  ('Hinge','Stainless Steel','Stainless Steel Hinge'),
  ('Soffit & Ridge Vent Options','Soffit & Ridge Vent','Soffit & Ridge Vent'),
  ('Flooring Options','Heavy Duty (12" Spaced Pressure Treated Joists)','12" O.C. Floor'),
  ('Site Preparation','Concrete Blocking (Good for Minimal Slope & Small Sheds)','Concrete Blocking (2x8x16 patio blocks)'),
  ('Site Preparation','Crushed Stone Base (Good for Larger Sheds, Best Drainage)','Crushed Stone Base w/ 4x4 Perimeter')
) as s(category, shedpro_value, package_name)
join public.packages p on p.name = s.package_name
on conflict (category, shedpro_value) do nothing;
