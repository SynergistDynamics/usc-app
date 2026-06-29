-- MIGRATION: add the ShedPro configurator options that had no matching app package,
-- so every configurator option maps to a package and a synced project can generate a
-- materials list. Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-29.
--
-- Decision (Jeremy, 2026-06-29): create these as PRICE-ONLY packages now (flat_rate,
-- NO components yet) so they sync + show immediately; the real bill of materials is
-- backfilled later (option "1b"). Sizes are NOT split into separate packages — one
-- package per option type (option "2b"); the configurator's size/length granularity
-- (e.g. transom sizes, shelf length, door size) is collapsed onto the single package.
--
-- These are regular OPTION packages: is_style=false, siding_type=null, no
-- package_materials / package_quantities rows (so they add nothing to the materials
-- list yet) and flat_rate=0 as a PLACEHOLDER price. Set the real price (and add the
-- bill of materials) in the app: Configurator Pricing → Packages tab.
--
-- Names match the ShedPro configurator labels so the ShedPro→package mapping is a
-- straight name match. allow_quantity=true for items a design can have several of
-- (doors, shelves, workbenches); false for whole-shed upgrades (interior finish,
-- soffit/ridge vent, hinge upgrade).

insert into public.packages (name, flat_rate, allow_quantity, description)
select v.name, 0, v.allow_quantity,
       'ShedPro configurator option — added 2026-06-29 as price-only (set price + add materials in Packages).'
from (values
  ('4'' Sliding Roll Door',        true),
  ('Painted Wood Stud Interior',   false),
  ('12" Single Shelf',             true),
  ('12" Double Shelf',             true),
  ('12" Triple Shelf',             true),
  ('24" Deep Workbench',           true),
  ('Soffit & Ridge Vent',          false),
  ('Stainless Steel Hinge',        false)
) as v(name, allow_quantity)
where not exists (
  select 1 from public.packages p where p.name = v.name
);
