-- MIGRATION: Enable Row-Level Security on the referrals table.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-23.
--
-- Background: referrals was the ONE table with RLS disabled, so the public anon key
-- (shipped in the browser bundle) gave anyone — even unauthenticated — full read/write
-- access to every referral: prospect names, emails, phones, markets, notes. They could
-- also reassign `referred_by` to steal commission attribution, or delete the whole table.
-- The app's per-builder filtering was client-side only (a UI convenience, not security).
--
-- Fix:
--   1. Enable RLS. One permissive policy: a builder reads/writes only rows where
--      referred_by = auth.uid(); admins get full access (same pattern as profiles).
--      Restricted to the `authenticated` role, so anon gets nothing.
--   2. The referral registration flow needs to detect when an email was already
--      registered by ANOTHER builder (commission protection) — which strict RLS now
--      hides. referral_email_taken() is a SECURITY DEFINER function that performs that
--      cross-builder check server-side and returns ONLY minimal info (when + who),
--      never the other builder's full row. Execute granted to authenticated only.

-- 1. RLS + per-builder policy -------------------------------------------------
alter table public.referrals enable row level security;

drop policy if exists "Builders manage own referrals, admins all" on public.referrals;
create policy "Builders manage own referrals, admins all"
  on public.referrals for all to authenticated
  using (
    referred_by = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    referred_by = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- 2. Cross-builder dedup helper ----------------------------------------------
create or replace function public.referral_email_taken(p_email text)
returns table (created_at timestamptz, builder_name text)
language sql
security definer
set search_path = public
as $$
  select r.created_at, coalesce(p.full_name, p.email) as builder_name
  from public.referrals r
  left join public.profiles p on p.id = r.referred_by
  where lower(r.email) = lower(trim(p_email))
  order by r.created_at asc
  limit 1;
$$;

revoke all on function public.referral_email_taken(text) from public, anon;
grant execute on function public.referral_email_taken(text) to authenticated;
