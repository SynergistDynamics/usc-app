-- MIGRATION: Revoke direct EXECUTE on the handle_new_user() trigger function.
-- Applied to the live project (ywboyreznmuaddprkycm) on 2026-06-23.
--
-- handle_new_user() is a SECURITY DEFINER trigger function on auth.users that creates the
-- profiles row when a user signs up. It had EXECUTE granted to public/anon/authenticated,
-- which also exposed it as a callable RPC (/rest/v1/rpc/handle_new_user) — flagged by the
-- Supabase security advisor (linter 0028/0029).
--
-- Trigger functions fire under the table's context regardless of EXECUTE grants, so
-- revoking direct-call rights does NOT affect signup — it only removes the exposed RPC.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
