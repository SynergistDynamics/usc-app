-- Post-sale CHANGE ORDERS on a project.
-- Adds a jsonb array column holding line items added in-app AFTER the shed is sold
-- (change orders). Each element is { label, detail, price, created_at, created_by
-- (uuid), created_by_name }. These render in the work order's "Change Orders" section
-- with their create date + the user who added them. NOT NULL DEFAULT '[]' so the app
-- can always send/read an array (same pattern as selected_packages / shedpro_options).
-- RLS is unchanged — the column is part of the projects row, already covered by the
-- "Builders manage own projects, admins all" policy.
-- Applied to the live project 2026-06-30 via MCP.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS change_orders jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.projects.change_orders IS
  'Post-sale change-order line items added in-app. jsonb array of {label, detail, price, created_at, created_by (uuid), created_by_name}. Shown in the work order Change Orders section.';
