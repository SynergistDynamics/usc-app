-- MIGRATION: capture the full ShedPro quote line-items (options + their prices) on
-- projects, so the in-app work order can show everything the ShedPro quote email
-- shows (see the "What's included" itemized list on a ShedPro Design quote).
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-29.
--
-- Why: the projects table already has scalar columns for the STRUCTURE/finishes
-- (siding, colors, roof, doors, windows, vents, …) but those carry no PRICE and the
-- options list is open-ended (Frame, Workbench, Shelf, Hinge, Loft, Foundation,
-- Travel Time, Overhang, … and ShedPro can add more). A fixed column per option
-- can't keep up, so the priced, variable-length list is stored as JSONB — the same
-- pattern projects already use for selected_packages / package_overrides.
--
-- Three additions:
--   • shedpro_options  jsonb  — the itemized options list WITH prices. An array of
--       {label, detail, price} objects, e.g.
--         [{"label":"One 5' Double Door","detail":"Rustic Red","price":"$550.00"},
--          {"label":"Roof Overhang: Large","price":"$740.34"},
--          {"label":"Homeowner to Pull Permit (If Required)","price":"Included"}]
--       price is kept as the raw text ShedPro shows ("$550.00" / "Included" / "0")
--       so the work order prints exactly what the customer was quoted. The app's
--       renderer is tolerant (accepts plain strings, or {name}/{amount}/{cost}
--       key variants, or a JSON string it parses) so Zapier mapping is forgiving.
--   • options_summary  text   — a plain-text fallback for the same list, for when
--       the structured array is awkward to assemble in Zapier; the work order shows
--       it only if shedpro_options is empty.
--   • monthly_payment  numeric — the "from $X/mo" financing figure on the quote.
--
-- The ShedPro all-in price still maps to projects.sale_price (already shown as the
-- work order's headline "Sale price"). No RLS change — these are just more columns
-- on a table whose policy already covers admins-all / builder-owns-the-contact.

alter table public.projects add column if not exists shedpro_options jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists options_summary text;
alter table public.projects add column if not exists monthly_payment numeric;
