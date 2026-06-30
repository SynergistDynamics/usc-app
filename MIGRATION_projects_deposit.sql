-- Shed DEPOSIT (down payment) on a project.
-- Adds a numeric column holding the deposit amount that comes in from ShedPro (forwarded
-- by Zapier and mapped by the shedpro-project-sync Edge Function, v10). Shown above the
-- sale price in the work order's Pricing section, and editable on the Edit modal's Details
-- tab. NULL when there's no deposit. RLS is unchanged (part of the projects row).
-- Applied to the live project 2026-06-30 via MCP.
--
-- ZAPIER: for the deposit to sync, add an Input Data row to the "Code by Zapier" step:
--   deposit=<the ShedPro Deposit field>
-- (the Edge Function also accepts deposit_amount / deposit_total / down_payment).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deposit numeric;

COMMENT ON COLUMN public.projects.deposit IS
  'Shed deposit amount (down payment) from ShedPro. Shown above the sale price on the work order.';
