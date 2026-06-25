-- MIGRATION: Map seeded projects' raw ShedPro siding_type → the calculator `siding`
-- value, so the project page's materials list can resolve siding.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-25.
--
-- The calculator's `siding` enum is one of: 'T1-11' | 'Clapboard' | 'B&B' |
-- 'Western Red Cedar' | 'None'. buildOutput maps those to the siding packages
-- (t111 / clapboard / bAndB; Western Red Cedar is quote-only). The seed stored the
-- raw ShedPro text in `siding_type`; this fills `siding` from it.
--
-- Mapping (grounded in the app's siding package names — "Lap Siding"=clapboard,
-- "T1-11 Smartside Siding"=t111, "B + B - LP Smartside Siding"=bAndB):
--   LP Lap / LP Lap 7 / LP Lap Siding          → Clapboard   (the "Lap Siding" package)
--   LP Smart / LP Smart T1-11 / LP T1-11 Smart → T1-11       (LP SmartSide panel)
--   Board & Batten (16)                        → B&B
--   Western Red Cedar                          → Western Red Cedar (quote-only)
--   (blank/null)                               → left unset
-- NOTE: plain "LP Smart" → T1-11 is a judgment call (LP SmartSide, non-lap = the
-- T1-11 Smartside panel). Re-map later if a builder intends otherwise.

update public.projects
set siding = case
  when siding_type ilike 'Western Red Cedar%' then 'Western Red Cedar'
  when siding_type ilike 'Board%Batten%'      then 'B&B'
  when siding_type ilike 'LP Lap%'            then 'Clapboard'
  when siding_type ilike '%Smart%' or siding_type ilike '%T1-11%' then 'T1-11'
  else siding
end
where source = 'shedpro'
  and siding is null
  and siding_type is not null
  and trim(siding_type) <> '';
