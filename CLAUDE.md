# Claude Code Instructions — USC Materials & Pricing Manager

> ⚠️ ALWAYS KEEP THE DOCS UP TO DATE. Whenever you change code, schema, structure, conventions,
> or discover a new gotcha, update the markdown files (`CONTEXT.md`, `CLAUDE.md`, `README.md`) in the
> SAME session — without being asked — so they never drift from reality. Stale docs caused real bugs
> here. Treat a doc update as part of the change, not an optional extra.

## At the start of every session
1. Read `CONTEXT.md` in full before making any changes. It contains the architecture, the
   Supabase schema, critical gotchas, and pricing logic for this app.
2. For any large new feature (dashboard, projects, reviews, integrations), also read
   `ARCHITECTURE.md` — it holds the platform vision, the settled structural decisions
   (single-user tenancy, domains, hosting), and the agreed build sequence.
3. Build from the actual source files in this repo — they are the source of truth.

## When making changes
- This is a React + Vite app deployed to Vercel, backed by Supabase. The admin (Jeremy) is
  not a professional developer — keep explanations clear and avoid unnecessary jargon.
- Respect the conventions and gotchas documented in `CONTEXT.md`, especially:
  - Supabase's REST API caps results at 1000 rows and `.range(0,9999)` does NOT bypass it; large tables
    like `package_quantities` must be fetched by paging in 1000-row chunks (see App.jsx fetchAllPackageQuantities).
  - No IIFEs inside JSX conditionals — use named helper functions.
  - NavBtn/ExtLink stay defined outside AppInner in App.jsx.
  - Mobile responsiveness uses JS `isMobile` state, not CSS attribute selectors.
  - Overrides/upserts need the correct unique constraint; check constraints may need ALTER.
- After code changes, run `npm run build` to confirm the build is clean before finishing.
- If a build looks stale or wrong, clear the cache with `rm -rf dist node_modules/.vite` and rebuild.

## At the end of every session where code changed
1. Run `npm run build` and confirm it passes with no errors.
2. UPDATE the markdown docs so they stay accurate for the next session — do this without being asked:
   - `CONTEXT.md` for any structural change, new feature, new gotcha, or schema change;
   - `README.md` if setup/structure/notes changed;
   - `CLAUDE.md` if a workflow/convention changed.
   If nothing doc-worthy changed, say so explicitly. Never leave the docs describing old behavior.
3. Commit the changes with a clear message describing what changed.
4. **Deployment is automatic via Vercel** (connected to GitHub). Do your work on a feature branch and
   push it; it goes live when the branch is **merged into `main`** (Vercel auto-builds `npm run build`
   and publishes `dist/`). Don't push to `main` without Jeremy's explicit OK. No manual zip uploads are
   needed anymore — only fall back to building a `dist/` zip if Vercel is ever disconnected.

## Database changes
If a change requires a Supabase schema change (new column, new constraint value, new table,
RLS policy), DO NOT assume it's been done. Clearly state the exact SQL Jeremy needs to run in
the Supabase SQL Editor, and confirm it's been run before relying on it.

## Deployment
- Vercel is connected to GitHub for **continuous deployment**: every push to `main` auto-builds
  (`npm run build`) and publishes `dist/`. To ship work: push your feature branch, then merge it into
  `main` (with Jeremy's OK) and Vercel deploys it.
- Build command: `npm run build` (outputs to `dist/`); output directory: `dist`. These are pinned in
  `vercel.json` (which also sets `framework: vite` and the SPA `rewrites` rule).
- Supabase env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are configured in Vercel's
  Project Settings → Environment Variables, so builds always have them.
- SPA routing is handled by the `rewrites` rule in `vercel.json` (serve `index.html` for any path).
  The old Netlify-specific `public/_redirects` was removed in 2026-06 now that Netlify is fully retired.
