# USC Materials & Pricing Manager — Developer Context

> Read this file at the start of any session before making changes.
> And KEEP IT CURRENT: whenever code, schema, structure, or gotchas change, update this file (and
> `README.md` / `CLAUDE.md` as needed) in the same session so the docs never drift from the app.
>
> This file = the app **as it is today**. For where the app is **going** (the USC platform vision,
> settled structural decisions, and the build sequence), see `ARCHITECTURE.md`.

## What this app is
A React + Vite web app for **Urban Sheds Collective (USC)** — a network of licensed shed
builders. Admin (Jeremy) manages master data; builders are the end users. Provides pricing
management, materials calculation, configurator pricing, blueprint access, affiliate
resources, and financing info.

## Stack & Deployment
- **Frontend:** React 19 + Vite, **React Router 7** for client-side routing (real URLs)
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
  - **SPA routing:** the app now uses **React Router** (see "Routing" below), so direct links like
    `build.urban-sheds.com/admin` work. `vercel.json`'s `rewrites` rule serves `index.html` for any path
    (Vercel auto-detects the Vite framework, build command, and `dist` output, but `vercel.json` pins them
    explicitly) — this is what makes deep links / refresh resolve to the SPA. The old `public/_redirects`
    (`/* /index.html 200`) is Netlify-specific; Vercel ignores it. It's kept as a harmless fallback during
    the host migration and can be deleted once Netlify is fully retired.
- **Env:** requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. In Vercel these live in the project's
  Environment Variables; for local dev put them in `.env` (see `.env.example`). `.env` is gitignored — never commit it.

## Source Structure
```
/index.html                  — Vite entry HTML (loads /src/main.jsx)
/package.json, vite.config.js, eslint.config.js
/public/                     — _redirects (SPA routing) + static assets (favicon.svg, etc.)
src/
  App.jsx                    — shell, sidebar nav (NavLink), data loading, <Routes> definitions, mobile hamburger
  main.jsx                   — entry point; wraps <App/> in <BrowserRouter>
  lib/supabase.js            — Supabase client, constants (C colors, SHED_SIZES, helpers:
                               applyOverride, packageMaterialCost, getStyleMultiplier, getAddonOptions, …)
  components/
    UI.jsx                   — shared components (Button, Input, Card, Badge, Modal, Select, SectionHeader, banners, etc.)
    Auth.jsx                 — AuthProvider, login, profile loading, access gating
  modules/
    Contacts.jsx             — Contacts list (/contacts) — each builder's customers/leads; admins see all.
                               Loads its OWN data via lib/contacts.js (per-route loading, ARCHITECTURE §3.3),
                               NOT through App.jsx loadData. Search + "Add contact" modal. First step of the
                               ShedPro integration (leads will sync in via Zapier later).
    ContactProfile.jsx       — A single contact's profile page (/contacts/:id) — editable contact info,
                               status, address, notes; delete. RLS scopes who can load/edit it.
    Dashboard.jsx            — Builder Dashboard (/dashboard, landing page). Role-gated:
                               • Builders → welcome + quick links to the tools + "Coming Soon" cards
                                 (they only ever see their own data).
                               • Admins → a **tabbed** view: a "Business Overview" tab plus one tab per
                                 person in the collective (all `profiles` EXCEPT blocked users and the
                                 admin's own row — same set as Admin → Users), so the admin can switch
                                 tabs to check on each one. Most metrics are placeholders until
                                 ShedPro/projects connect; real profile fields (name, market, email, joined,
                                 sales_tax) are shown. Builder access to other builders' data is blocked by
                                 RLS — non-admins never run the profiles query. The tab strip uses inline
                                 overflowX:auto + overflowY:hidden and flexShrink:0 tabs (NOT the
                                 usc-table-scroll class, which forces a stray vertical scrollbar via the
                                 overflow-x:auto → overflow-y:auto CSS rule). (ARCHITECTURE.md step 2.)
    PricingTool.jsx          — "Materials List Generator" (idx 0). Has buildOutput() pricing engine.
    MaterialPriceManager.jsx — Material Prices (idx 1) — local price overrides + sales tax input
    PackageManager.jsx       — Packages (idx 3, admin only) — 4 tabs: Shed Styles, Siding, Fixed, Size-Variable
    AffiliateResources.jsx   — Affiliate Resources (idx 4) — 3 tabs
    AdminPanel.jsx           — Admin (idx 5, admin only) — Users tab; Tech Stack tab (super admin only)
    Blueprints.jsx           — Blueprints (idx 6)
    ConfiguratorPricing.jsx  — Configurator Pricing (idx 8) — 4 tabs (Base/Siding/Fixed/Variable)
    Financing.jsx            — Financing (idx 9)
  lib/contacts.js            — Contacts data/service layer (fetch w/ 1000-row paging, get, create, update,
                               delete) + CONTACT_STATUSES / STATUS_LABELS / STATUS_COLORS constants.
  modules/ (cont.)
    Profile.jsx              — My Profile (/profile, all users) — each user edits their OWN profile
                               (name, business, phone, market, website, bio) + uploads a profile photo
                               to the `avatars` storage bucket. Email/role are read-only. Uses
                               useAuth().reloadProfile() to refresh the session after a save.
    ReferralRegistration.jsx — referral form modal, used in AffiliateResources
```
Note: the old in-memory module index (`activeModule` 0–9) has been replaced by **URL routes** (see Route Map
below). The retired Quantity Tables module no longer has a route at all.

> IMPORTANT: the repo was once committed flattened in the root with `[1]` suffixes
> (un-buildable). It has since been restored to the standard Vite `src/` layout above.
> Keep that layout — the imports depend on it.

## Routing (React Router 7)
Navigation is **URL-based** (real, bookmarkable URLs), defined in `App.jsx`'s `<Routes>`. Sidebar
items are `NavLink`s; the active highlight comes from the current URL (`isActive`), not a number.
A `ROUTES` constant in `App.jsx` is the single source of truth for paths.

Route Map:
| Path | Module | Access |
|---|---|---|
| `/` | redirects → `/dashboard` | all |
| `/dashboard` | Builder Dashboard | all |
| `/contacts` | Contacts list | all (own only; admin sees all) |
| `/contacts/:id` | Contact profile | all (own only; admin sees all) |
| `/calculator` | Materials Calculator (PricingTool) | all |
| `/material-prices` | Material Prices | all |
| `/packages` | Packages (PackageManager) | admin |
| `/affiliate` | Affiliate Resources | all |
| `/admin` | Admin Panel | admin |
| `/blueprints` | Blueprints | all |
| `/configurator-pricing` | Configurator Pricing | all |
| `/financing` | Financing | all |
| `/profile` | My Profile | all |
| `*` | redirects → `/dashboard` | all |

Notes:
- **Admin-only routes** render `<Navigate to="/calculator" replace />` when `profile.role !== 'admin'`
  (defense-in-depth on top of the sidebar hiding those links). The real security boundary is still
  Supabase RLS — route guards are UX, not authorization.
- **Calculator Settings** (sidebar submenu holding Material Prices + Packages) auto-expands when the
  current path is one of `SETTINGS_PATHS`.
- `main.jsx` wraps the app in `<BrowserRouter>`. The Vercel `rewrites` rule (above) is what lets deep
  links and refreshes resolve to the SPA.
- **Data loading is mostly all-at-once** in `App.jsx`'s `loadData` and passed to route elements as props
  (the original pricing/packages modules). **Contacts is the first module to load its own data per-route**
  (via `lib/contacts.js`, ARCHITECTURE.md §3.3) instead of through `loadData` — the model for new sections.

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
  **is_super_admin**, plus profile-page fields: **avatar_url, phone, company_name, website, bio**).
  The profile-page fields are edited by each user on `/profile` (My Profile); the RLS policy
  "Users can update own profile" (`USING auth.uid() = id`) scopes those writes. Its **WITH CHECK pins
  `role` and `is_super_admin` to their current values**, so a self-update can change any other field
  but CANNOT escalate privileges (see `MIGRATION_lock_profile_role.sql`). Admins still change roles via
  the separate "Admin can update any profile" policy. `is_super_admin` is a flag layered on top of role=admin (NOT a new role value, so
  normal admin access is unaffected); it gates the Admin → Tech Stack tab. Super admins can grant/revoke
  it on other users via a toggle in the Admin → Users tab (granting also promotes the user to admin).
  `profiles.multiplier` is now legacy (seed source for style_multipliers); no longer used directly in pricing.
- `tech_stack` — super-admin-only list of the software this app runs on (name, url, username/signup email,
  sort_order). RLS restricts all access to super admins. Managed in Admin → Tech Stack. The old sidebar
  Supabase/Netlify links were moved here. See `MIGRATION_super_admin_tech_stack.sql`.
- `referrals` — builder referrals (name, email, market, status, referred_by, notes). **RLS enabled**:
  a builder reads/writes only their own rows (`referred_by = auth.uid()`); admins see all (see
  `MIGRATION_referrals_rls.sql`). Because that hides other builders' rows, the duplicate-email check in
  ReferralRegistration uses the **`referral_email_taken(email)` SECURITY DEFINER function** — it reports
  whether an email is already registered (and when/by whom) without exposing the other builder's row.
- `contacts` — per-builder customers/leads (first step of the ShedPro integration). Columns: user_id
  (owner → profiles.id, defaults to auth.uid()), full_name, email, phone, company_name, address, city,
  state, zip, market, status (lead|quoted|customer|closed|lost), source (manual|shedpro|zapier|…),
  **shedpro_id** (external id for later Zapier upserts/dedup — partial-unique index where not null),
  notes, created_at, updated_at (auto via `contacts_set_updated_at` trigger). **RLS enabled**: one ALL
  policy "Builders manage own contacts, admins all" — a builder reads/writes only rows where
  `user_id = auth.uid()`, admins read/write all (same shape as referrals). Restricted to `authenticated`.
  See `MIGRATION_contacts.sql` (applied 2026-06-25). ShedPro leads will be pushed in LATER via **Zapier**
  (Zapier → Supabase REST API), upserting on `shedpro_id`; there is no live API integration yet.
- LEGACY (kept as backup, no longer read by the app): `quantities` (old global base/add-on quantities),
  `styles` (old shed styles with markup %). Safe to drop once the migration is verified.

## Storage Buckets
- `avatars` — **public** bucket for profile photos (My Profile page). Files are stored under a
  `{user_id}/` folder. RLS: a user can read/upload/update/delete only inside their own `{user_id}/`
  folder (`(storage.foldername(name))[1] = auth.uid()`). **The SELECT (read) policy is required**, even
  though display uses the public object URL — supabase-js reads the object back after upload
  (`INSERT ... RETURNING`), so with no SELECT policy every upload fails with "new row violates
  row-level security policy" (see `MIGRATION_fix_avatars_select_policy.sql`). It's scoped to the user's
  own folder so it doesn't allow bucket-wide listing. The path is `{user_id}/{timestamp}.{ext}` and the
  resulting public URL is saved to `profiles.avatar_url`. See `MIGRATION_profile_fields_and_avatars.sql`
  (applied 2026-06-23).

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
