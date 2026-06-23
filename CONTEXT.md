# USC Materials & Pricing Manager — Developer Context

> Read this file at the start of any session before making changes.
> And KEEP IT CURRENT: whenever code, schema, structure, or gotchas change, update this file (and
> `README.md` / `CLAUDE.md` as needed) in the same session so the docs never drift from the app.

## What this app is
A React + Vite web app for **Urban Sheds Collective (USC)** — a network of licensed shed
builders. Admin (Jeremy) manages master data; builders are the end users. Provides pricing
management, materials calculation, configurator pricing, blueprint access, affiliate
resources, and financing info.

## Stack & Deployment
- **Frontend:** React 19 + Vite
- **Backend/Auth/DB:** Supabase (project ID `ywboyreznmuaddprkycm`)
- **Hosting:** Vercel (static). Live app domain: `https://build.urban-sheds.com` (CNAME → `cname.vercel-dns.com`,
  DNS managed in Cloudflare, "DNS only"/grey-cloud so Vercel issues SSL). Migrated off Netlify in 2026-06.
  The old `urban-sheds.co` (Netlify) is being retired; a separate marketing site lives at `urban-sheds.com`.
  Note: `app.urban-sheds.com` is a *different* app (legacy Adalo, still live) — this app uses the `build` subdomain.
- **Build:** `npm run build` → outputs to `dist/`
- **Deploy:** Vercel is connected to GitHub for **continuous deployment** — every push to `main`
  auto-builds (`npm run build`) and publishes `dist/`. Workflow: do work on a feature branch, push it,
  then **merge into `main` to go live** (no more manual zip uploads). The Supabase env vars are set in
  Vercel (Project Settings → Environment Variables), so builds always have them.
  - **SPA routing:** `vercel.json`'s `rewrites` rule serves `index.html` for any path (Vercel auto-detects
    the Vite framework, build command, and `dist` output, but `vercel.json` pins them explicitly). The old
    `public/_redirects` (`/* /index.html 200`) is Netlify-specific; Vercel ignores it. It's kept as a
    harmless fallback during the host migration and can be deleted once Netlify is fully retired.
- **Env:** requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. In Vercel these live in the project's
  Environment Variables; for local dev put them in `.env` (see `.env.example`). `.env` is gitignored — never commit it.

## Source Structure
```
/index.html                  — Vite entry HTML (loads /src/main.jsx)
/package.json, vite.config.js, eslint.config.js
/public/                     — _redirects (SPA routing) + static assets (favicon.svg, etc.)
src/
  App.jsx                    — shell, sidebar nav, data loading, module routing, mobile hamburger
  main.jsx                   — entry point
  lib/supabase.js            — Supabase client, constants (C colors, SHED_SIZES, helpers:
                               applyOverride, packageMaterialCost, getStyleMultiplier, getAddonOptions, …)
  components/
    UI.jsx                   — shared components (Button, Input, Card, Badge, Modal, Select, SectionHeader, banners, etc.)
    Auth.jsx                 — AuthProvider, login, profile loading, access gating
  modules/
    PricingTool.jsx          — "Materials List Generator" (idx 0). Has buildOutput() pricing engine.
    MaterialPriceManager.jsx — Material Prices (idx 1) — local price overrides + sales tax input
    PackageManager.jsx       — Packages (idx 3, admin only) — 4 tabs: Shed Styles, Siding, Fixed, Size-Variable
    AffiliateResources.jsx   — Affiliate Resources (idx 4) — 3 tabs
    AdminPanel.jsx           — Admin (idx 5, admin only) — Users tab; Tech Stack tab (super admin only)
    Blueprints.jsx           — Blueprints (idx 6)
    ConfiguratorPricing.jsx  — Configurator Pricing (idx 8) — 4 tabs (Base/Siding/Fixed/Variable)
    Financing.jsx            — Financing (idx 9)
    ReferralRegistration.jsx — referral form modal, used in AffiliateResources
```
Note: module index 2 (Quantity Tables) and index 7 are unused/removed.

> IMPORTANT: the repo was once committed flattened in the root with `[1]` suffixes
> (un-buildable). It has since been restored to the standard Vite `src/` layout above.
> Keep that layout — the imports depend on it.

## Module Index Map (activeModule in App.jsx)
0=Materials Calculator · 1=Material Prices · 3=Packages (admin) ·
4=Affiliate Resources · 5=Admin (admin) · 6=Blueprints · 8=Configurator Pricing · 9=Financing
(idx 2 = Quantity Tables was removed — quantities now live inside each package.)

## Supabase Tables
- `materials` — master list (price, category, material_group, url, allow_quantity). Groups: base, addon, package_component.
- `material_overrides` — per-user local price/url overrides (user_id + material_id)
- `packages` — packages (size_variable, flat_rate, multiplier, siding_type, allow_quantity, **is_style**).
  - `is_style = true` → a **shed style** package (always size_variable; holds every base material per size).
  - `siding_type` set → siding package; otherwise a regular option package (add-ons live here now).
- `package_materials` — components per package (fixed_quantity for non-size-variable; null for size-variable)
- `package_quantities` — per-size quantities for size-variable packages (incl. styles & add-ons). Large table
  (3000+ rows); App.jsx loads it via **pagination** (see gotcha below), not a single `.range()`.
- `style_multipliers` — **per-builder** multiplier for a style package (user_id + package_id, unique). A builder's
  value overrides the style package's default `multiplier`. Managed on Configurator Pricing → Base Pricing.
- `profiles` — users (id, email, role: admin|builder|blocked, full_name, market, multiplier, sales_tax,
  **is_super_admin**). `is_super_admin` is a flag layered on top of role=admin (NOT a new role value, so
  normal admin access is unaffected); it gates the Admin → Tech Stack tab. Super admins can grant/revoke
  it on other users via a toggle in the Admin → Users tab (granting also promotes the user to admin).
  `profiles.multiplier` is now legacy (seed source for style_multipliers); no longer used directly in pricing.
- `tech_stack` — super-admin-only list of the software this app runs on (name, url, username/signup email,
  sort_order). RLS restricts all access to super admins. Managed in Admin → Tech Stack. The old sidebar
  Supabase/Netlify links were moved here. See `MIGRATION_super_admin_tech_stack.sql`.
- `referrals` — builder referrals (name, email, market, status, referred_by, notes)
- LEGACY (kept as backup, no longer read by the app): `quantities` (old global base/add-on quantities),
  `styles` (old shed styles with markup %). Safe to drop once the migration is verified.

## CRITICAL Supabase / React gotchas
- **1000-row API cap — `.range()` does NOT bypass it.** Supabase's PostgREST `max-rows` (default 1000)
  caps every REST SELECT, and a `.range(0, 9999)` request is still clamped to that cap (this was a wrong
  assumption in earlier notes). `package_quantities` exceeds 1000 rows, so App.jsx loadData fetches it by
  **paging in 1000-row chunks** (`fetchAllPackageQuantities`, ordered by package_id, loop until a short page).
  Use the same pattern for any other table that can grow past 1000 rows.
- **Upserts need a unique constraint** on the conflict columns, not just a PK.
  - package_quantities conflict: `package_id,material_id,shed_size`
  - style_multipliers conflict: `user_id,package_id`
- **Check constraints:** adding new enum-like values requires ALTER. E.g. `packages_siding_type_check` allows `clapboard`, `bAndB`, `t111`. Adding new siding types requires updating that constraint.
- **RLS can silently block writes** (delete/update return no error but affect 0 rows). When a write "succeeds" but data doesn't change, suspect RLS policies. deleteUser in AdminPanel uses `count:'exact'` to detect this and falls back to setting role='blocked'.
- **No IIFEs inside JSX conditionals** — `{cond && (()=>{...})()}` breaks rendering. Use named helper functions instead (see ConfiguratorPricing FixedOptionsTab/VariableOptionsTab).
- **NavBtn/ExtLink must be defined OUTSIDE AppInner** in App.jsx — defining them inside causes infinite re-render crashes.
- **Mobile responsive uses JS `isMobile` state**, NOT CSS attribute selectors. React renders inline styles as kebab-case in the DOM (e.g. `grid-template-columns`), so selectors like `div[style*="gridTemplateColumns"]` never match. Each responsive module tracks `isMobile` via a resize listener.
- **Vite build cache** can serve stale output. If a build seems wrong, `rm -rf dist node_modules/.vite` then rebuild.

## Pricing Logic (package-based model)
Everything priced in the app is now a **package**. There is no longer a general multiplier,
no separate Quantity Tables, and no style markup.

- **Shed styles** are size-variable packages (`is_style=true`) whose components are all the base
  materials, with per-size quantities in `package_quantities`. Base shed price for a size =
  `Σ(componentQty(size) × materialPrice) × styleMultiplier`.
- **Style multiplier is PER-BUILDER:** each builder sets their own multiplier for each style
  (stored in `style_multipliers`, keyed by user_id+package_id). Falls back to the package's
  default `multiplier`. Helper: `getStyleMultiplier(styleMults, pkg)`. Set on Configurator
  Pricing → Base Pricing (admin edits the master default and can preview each builder read-only;
  each builder edits their own).
- **All other packages** (siding, add-ons, fixed, size-variable) use ONE admin-set global
  `multiplier` (same for every builder) — the per-builder multiplier does NOT apply to them.
  Price = `materialCost × multiplier`, unless `flat_rate` is set (then that wins).
- **Add-ons** are now ordinary packages (mostly size-variable, one component each). They appear
  as selectable options in the calculator (countable if `allow_quantity`).
- **Siding:** T1-11 / Clapboard / B&B are backed by `siding_type` packages with their own multiplier.
  No direct-material fallback anymore — if no siding package exists the calculator shows a quote/0.
  Western Red Cedar is quote-only.
- **Sales tax:** per-builder, stored in `profiles.sales_tax`, mirrored to localStorage `usc_sales_tax`.
  Applied to MATERIAL COST ONLY — baked into `mat.price` via `taxMult = 1 + salesTax/100` when matById
  is built, so it flows through before any multiplier math. (PricingTool, ConfiguratorPricing, PackageManager.)
- **Zero-quantity items** are hidden from Materials Calculator output.
- **pkg_component materials** are read-only for builders in Material Prices (admin-only price, shows 🔒 Admin only).

### One-time migration
`MIGRATION_styles_as_packages.sql` (repo root) creates the `is_style` column + `style_multipliers`
table, turns each old `styles` row into a style package seeded from the old base `quantities`, seeds
each builder's per-style multiplier = `builder.multiplier × (1 + markup%)`, and converts add-on
materials into packages. Must be run once in the Supabase SQL Editor. Confirm it ran before relying
on the new tables. (Applied to the live project on 2026-06-19.)

`MIGRATION_reseed_style_quantities.sql` (repo root) is an **idempotent** helper that re-fills every
style package's base components + per-size quantities from the legacy `quantities` table. Safe to run
anytime a style grid looks empty/partial.

## Conventions
- Colors: `C` object in supabase.js — sage #7A9B76, sand #B8986A, charcoal #1A1510, linen #FFFDF9
- Fonts: Cormorant Garamond (headings), DM Sans (body/UI)
- Tables that can overflow use `className="usc-table-scroll"` for horizontal scroll on mobile (class defined in App.jsx globalStyles).
- Builder-facing labels: "Local Price" (not "Your Price"), "Local Supplier" (not "Supplier").

## Access / Invitation Flow
1. Admin adds invite in AdminPanel (email).
2. If a blocked profile already exists for that email → upgraded to builder immediately.
3. Fresh sign-in → Auth.jsx checks invitations table on profile creation → role=builder if invited, else blocked.
4. Blocked users see a blocked screen.
5. Admin can delete users (removes profile row; auth account remains in Supabase dashboard).

## Custom Email
Supabase Auth uses custom SMTP via Resend — magic links come from info@urban-sheds.com as "Urban Sheds Collective".
