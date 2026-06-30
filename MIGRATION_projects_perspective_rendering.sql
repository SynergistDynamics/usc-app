-- MIGRATION: add projects.perspective_rendering_url
--
-- ShedPro sends SIX rendering views per project: perspective, front, left, right,
-- back, and a 2D floor plan (layout). The app only had 5 URL columns
-- (rendering_url_1..4 + layout_rendering_url), and the sync Edge Function let the
-- "front" image win rendering_url_1 with "perspective" only as a fallback — so when
-- both were present (the normal case) the PERSPECTIVE image was dropped entirely.
--
-- This adds a dedicated column for the perspective (angled hero) view. The card
-- lists show this image first; the work order shows all six. rendering_url_1..4 stay
-- front/left/right/back and layout_rendering_url stays the 2D floor plan.
--
-- Applied to the live project 2026-06-30 (via MCP). The Edge Function was redeployed
-- the same day to populate it (imgByKey["perspective"]).
alter table public.projects add column if not exists perspective_rendering_url text;

-- Backfill existing ShedPro-synced rows. All six views live in the same order folder
-- with deterministic names (image_front.png / image_left.png / … / image_2d_floor_plan.png),
-- so the perspective view is image_perspective.png in the same folder — derive it from
-- the stored front URL. (Reversible: set the column back to NULL to undo.)
update public.projects
set perspective_rendering_url = replace(rendering_url_1, '/image_front.png', '/image_perspective.png')
where perspective_rendering_url is null
  and rendering_url_1 like '%/image_front.png';
