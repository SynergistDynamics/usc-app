-- Stripe deposit payment tracking on a project.
-- Adds the columns the `stripe-deposit-paid` Edge Function needs to record that a customer
-- paid their deposit through a Stripe Checkout Session:
--   • stripe_session_id — the Stripe Checkout Session id that paid the deposit. Also the
--     IDEMPOTENCY key: Stripe can deliver the same webhook event more than once, and the
--     unique index below makes re-processing a no-op (each session recorded at most once).
--   • deposit_paid_at   — when the deposit was actually paid (distinct from `shedpro_created`
--     or the quote deposit; NULL until a real Stripe payment lands).
-- The amount itself is stored in the existing `projects.deposit` column, and the sale is
-- marked with the existing `status`/`sold_at` columns — so no other schema change is needed.
-- RLS is unchanged (these are plain columns on the projects row; the Edge Function writes
-- with the service_role key, bypassing RLS like the other syncs).
--
-- Run once in the Supabase SQL Editor. See STRIPE_DEPOSIT.md for the full setup.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS deposit_paid_at   timestamptz;

-- Each Stripe Checkout Session is processed at most once (partial index: many NULLs allowed).
CREATE UNIQUE INDEX IF NOT EXISTS projects_stripe_session_id_key
  ON public.projects (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

COMMENT ON COLUMN public.projects.stripe_session_id IS
  'Stripe Checkout Session id that paid the deposit (also the idempotency key for the stripe-deposit-paid Edge Function).';
COMMENT ON COLUMN public.projects.deposit_paid_at IS
  'When the deposit was paid via Stripe (set by the stripe-deposit-paid Edge Function).';
