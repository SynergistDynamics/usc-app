-- MIGRATION: Rename projects.shedpro_order_id → project_number, and map the raw
-- ShedPro shed_style text onto the existing shed-style packages (style_package_id).
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-25.
--
-- Why:
--   • The ShedPro "Shed Style" export field combines the style + the order/project
--     number (e.g. "Tall Modern #5826"). The seed already split these into shed_style
--     ("Tall Modern") and the order number; this renames that number column to the
--     clearer project_number.
--   • The seeded rows had style_package_id = NULL. This backfills it by mapping the
--     raw style text to the real shed-style packages. NOTE the vocabulary difference:
--     ShedPro says "Tall", the app's style packages say "High Wall".
--       Tall Modern       → High Wall Modern
--       Tall Traditional  → High Wall Traditional
--       Modern            → Modern
--       Traditional       → Traditional
--     Linking style_package_id lets the project page generate a materials list.

-- 1. Rename the order/project number column + its index ------------------------
alter table public.projects rename column shedpro_order_id to project_number;
alter index if exists projects_shedpro_order_id_idx rename to projects_project_number_idx;

-- 2. Map raw shed_style text → style_package_id (existing style packages) -------
update public.projects p
set style_package_id = pk.id
from public.packages pk
where pk.is_style = true
  and p.shed_style is not null
  and p.style_package_id is null
  and pk.name = (case p.shed_style
                   when 'Tall Modern'      then 'High Wall Modern'
                   when 'Tall Traditional' then 'High Wall Traditional'
                   when 'Modern'           then 'Modern'
                   when 'Traditional'      then 'Traditional'
                   else p.shed_style
                 end);
