# Claude Code Instructions — USC Materials & Pricing Manager

> ⚠️ ALWAYS KEEP THE DOCS UP TO DATE. Whenever you change code, schema, structure, conventions,
> or discover a new gotcha, update the markdown files (`CONTEXT.md`, `CLAUDE.md`, `README.md`) in the
> SAME session — without being asked — so they never drift from reality. Stale docs caused real bugs
> here. Treat a doc update as part of the change, not an optional extra.

## At the start of every session
1. Read `CONTEXT.md` in full before making any changes. It contains the architecture, the
   Supabase schema, critical gotchas, and pricing logic for this app.
2. Build from the actual source files in this repo — they are the source of truth.

## When making changes
- This is a React + Vite app deployed to Netlify, backed by Supabase. The admin (Jeremy) is
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
4. Since deployment is currently manual: build and create a downloadable zip of the `dist/`
   folder contents (with `_redirects` included) so it can be uploaded to Netlify. Remind
   Jeremy to deploy it.

## Database changes
If a change requires a Supabase schema change (new column, new constraint value, new table,
RLS policy), DO NOT assume it's been done. Clearly state the exact SQL Jeremy needs to run in
the Supabase SQL Editor, and confirm it's been run before relying on it.

## Deployment
- Build command: `npm run build` (outputs to `dist/`)
- `public/_redirects` (`/* /index.html 200`) must end up in `dist/` for SPA routing.
- Netlify auto-deploy is not yet connected; deployment is manual via zip upload for now.
