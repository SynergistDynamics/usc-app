-- ============================================================================
-- RE-SEED shed-style packages from the legacy `quantities` table.
-- Run in Supabase SQL Editor. SAFE TO RUN MULTIPLE TIMES (idempotent):
--   - components are only added if missing
--   - quantities are upserted (insert-or-update), never duplicated
-- Use this if a style's quantity grid is empty or only partially filled.
-- ============================================================================
begin;

-- 1) Ensure every shed-style package has ALL base materials as components
insert into package_materials (package_id, material_id, fixed_quantity)
select sp.id, m.id, null
from packages sp
cross join materials m
where sp.is_style = true
  and m.material_group = 'base'
  and m.id <> 't111'                       -- t111 is siding, not a base component
  and not exists (
    select 1 from package_materials pm
    where pm.package_id = sp.id and pm.material_id = m.id
  );

-- 2) Copy every base-material per-size quantity into every shed-style package
insert into package_quantities (package_id, material_id, shed_size, quantity, updated_at)
select sp.id, q.material_id, q.shed_size, q.quantity, now()
from packages sp
join materials m on m.material_group = 'base' and m.id <> 't111'
join quantities q on q.material_id = m.id
where sp.is_style = true
on conflict (package_id, material_id, shed_size)
do update set quantity = excluded.quantity, updated_at = now();

commit;

-- ── Optional diagnostic — run separately to see what each style now holds ──
-- select p.name,
--        count(distinct pm.material_id)                  as components,
--        count(distinct (pq.material_id, pq.shed_size))  as qty_cells
-- from packages p
-- left join package_materials   pm on pm.package_id = p.id
-- left join package_quantities  pq on pq.package_id = p.id
-- where p.is_style
-- group by p.name
-- order by p.name;
--
-- select count(*) as legacy_quantity_rows from quantities;
