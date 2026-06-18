# USC Materials & Pricing Manager — Developer Context

> Read this file at the start of any session before making changes.

## What this app is
A React + Vite web app for **Urban Sheds Collective (USC)** — a network of licensed shed
builders. Admin (Jeremy) manages master data; builders are the end users. Provides pricing
management, materials calculation, configurator pricing, blueprint access, affiliate
resources, and financing info.

## Stack & Deployment
- **Frontend:** React 19 + Vite
- **Backend/Auth/DB:** Supabase (project ID `ywboyreznmuaddprkycm`)
- **Hosting:** Netlify (static) at https://urban-sheds.co
- **Build:** `npm run build` → outputs to `dist/`
- **Deploy:** drag `dist/` contents to Netlify, OR connect repo for auto-deploy.
  The `public/_redirects` file (`/* /index.html 200`) handles SPA routing and must end up in `dist/`.
- **Env:** requires `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`).
  `.env` is gitignored — recreate it locally/in the environment, never commit it.

## Source Structure
```
src/
  App.jsx                    — shell, sidebar nav, data loading, module routing, mobile hamburger
  main.jsx                   — entry point
  lib/supabase.js            — Supabase client, constants (C colors, SHED_SIZES, helpers like applyOverride, buildQtyMap, getMaterialIdsByGroup, getAddonOptions)
  components/
    UI.jsx                   — shared components (Button, Input, Card, Badge, Modal, Select, SectionHeader, banners, etc.)
    Auth.jsx                 — AuthProvider, login, profile loading, access gating
  modules/
    PricingTool.jsx          — "Materials List Generator" (idx 0). Has buildOutput() pricing engine.
    MaterialPriceManager.jsx — Material Prices (idx 1) — local price overrides + sales tax input
    QuantityTableEditor.jsx  — Quantity Tables (idx 2) — per-cell debounced autosave
    PackageManager.jsx       — Packages (idx 3, admin only) — 3 tabs
    AffiliateResources.jsx   — Affiliate Resources (idx 4) — 3 tabs
    AdminPanel.jsx           — Admin (idx 5, admin only) — user management
    Blueprints.jsx           — Blueprints (idx 6)
    ConfiguratorPricing.jsx  — Configurator Pricing (idx 8) — 4 tabs
    Financing.jsx            — Financing (idx 9)
    StylesManager.jsx        — used inside ConfiguratorPricing
    ReferralRegistration.jsx — referral form modal, used in AffiliateResources
```
Note: module index 7 is unused.

## Module Index Map (activeModule in App.jsx)
0=Materials Calculator · 1=Material Prices · 2=Quantity Tables · 3=Packages (admin) ·
4=Affiliate Resources · 5=Admin (admin) · 6=Blueprints · 8=Configurator Pricing · 9=Financing

## Supabase Tables
- `materials` — master list (price, category, material_group, url). Groups: base, addon, package_component.
- `material_overrides` — per-user local price/url overrides (user_id + material_id)
- `quantities` — global qty per material_id + shed_size (admin-managed, ~1200+ rows)
- `packages` — packages (size_variable, flat_rate, multiplier, siding_type, allow_quantity)
- `package_materials` — components per package (fixed_quantity for non-size-variable)
- `package_quantities` — per-size quantities for size-variable packages
- `profiles` — users (id, email, role: admin|builder|blocked, full_name, market, multiplier, sales_tax)
- `referrals` — builder referrals (name, email, market, status, referred_by, notes)
- `styles` — shed styles with markup % (Configurator Pricing)

## CRITICAL Supabase / React gotchas
- **1000-row limit:** Supabase silently caps SELECTs at 1000 rows. ALL `quantities` fetches MUST use `.range(0, 9999)`. (App.jsx loadData + anywhere quantities are refetched.)
- **Upserts need a unique constraint** on the conflict columns, not just a PK.
  - quantities upsert conflict: `material_id,shed_size`
  - package_quantities conflict: `package_id,material_id,shed_size`
- **Check constraints:** adding new enum-like values requires ALTER. E.g. `packages_siding_type_check` allows `clapboard`, `bAndB`, `t111`. Adding new siding types requires updating that constraint.
- **RLS can silently block writes** (delete/update return no error but affect 0 rows). When a write "succeeds" but data doesn't change, suspect RLS policies. deleteUser in AdminPanel uses `count:'exact'` to detect this and falls back to setting role='blocked'.
- **No IIFEs inside JSX conditionals** — `{cond && (()=>{...})()}` breaks rendering. Use named helper functions instead (see ConfiguratorPricing FixedOptionsTab/VariableOptionsTab).
- **NavBtn/ExtLink must be defined OUTSIDE AppInner** in App.jsx — defining them inside causes infinite re-render crashes.
- **Mobile responsive uses JS `isMobile` state**, NOT CSS attribute selectors. React renders inline styles as kebab-case in the DOM (e.g. `grid-template-columns`), so selectors like `div[style*="gridTemplateColumns"]` never match. Each responsive module tracks `isMobile` via a resize listener.
- **Vite build cache** can serve stale output. If a build seems wrong, `rm -rf dist node_modules/.vite` then rebuild.

## Pricing Logic
- **Multiplier:** per-builder labor & profit multiplier. Stored in `profiles.multiplier` and mirrored to localStorage `usc_multiplier`. Set on Configurator Pricing (Base Pricing tab). Applied to base materials + siding + addons (NOT to packages, which have their own multiplier).
- **Sales tax:** per-builder, stored in `profiles.sales_tax`, mirrored to localStorage `usc_sales_tax`. Set on Material Prices page. Applied to MATERIAL COST ONLY — baked into `mat.price` via `taxMult = 1 + salesTax/100` when matById is built, so it flows through before any multiplier math. Applied in PricingTool (buildOutput), ConfiguratorPricing, PackageManager.
- Both multiplier and sales_tax sync to localStorage on profile load in Auth.jsx, so all pages have them immediately.
- **Style markup:** each style in `styles` table has a markup %, applied to base material cost before the general multiplier (Configurator Pricing).
- **Siding:** T1-11, Clapboard, B&B can each be backed by a package (siding_type field) with its own multiplier; falls back to direct material if no package exists. Western Red Cedar is quote-only.
- **Zero-quantity items** are hidden from Materials Calculator output (both Pricing and Materials List).
- **pkg_component materials** are read-only for builders in Material Prices (admin-only price, shows 🔒 Admin only).

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
