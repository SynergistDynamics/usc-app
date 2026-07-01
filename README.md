# USC Builder Portal

A React + Vite web app for Urban Sheds Collective — a network of licensed shed builders.
The central portal each builder runs their business from: customers/leads (CRM), projects &
printable work orders, pricing management, materials calculation, configurator pricing,
blueprint access, affiliate resources, and financing info.

> Formerly the "USC Materials & Pricing Manager" — renamed in 2026-07 now that it's a full
> builder portal, not just a pricing tool. (The repo/folder stays `usc-app`.)

## Stack
- **Frontend:** React 19 + Vite, React Router 7 (real URLs for each section)
- **Backend/Auth/DB:** Supabase
- **Hosting:** Vercel (static)

## Local Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the project root (copy from `.env.example`):
   ```
   VITE_SUPABASE_URL=your-supabase-project-url
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

3. Run the dev server:
   ```bash
   npm run dev
   ```

## Build & Deploy

```bash
npm run build
```

The production build is output to `dist/`. SPA routing (serving `index.html` for any path) is
handled by `vercel.json`'s `rewrites` rule. (The app was previously hosted on Netlify; that host
was fully retired in 2026-06 and the Netlify-only `public/_redirects` file has been removed.)

**Deployment is automatic.** Vercel is connected to this GitHub repo: every push to `main`
auto-builds (`npm run build`) and publishes `dist/`. Day-to-day flow: work on a feature branch,
push it, then merge into `main` to go live. The Supabase env vars are set in Vercel's project
Environment Variables, so cloud builds always have them (no `.env` needed for Vercel).

## Project Structure

```
src/
  App.jsx                    — shell, sidebar nav, data loading, module routing
  main.jsx                   — entry point
  lib/supabase.js            — Supabase client, constants, helpers
  components/
    UI.jsx                   — shared UI components
    Auth.jsx                 — auth provider, login, gating
  modules/
    Contacts.jsx / ContactProfile.jsx — Customers/leads list + profile (with the contact's projects)
    Projects.jsx / ProjectDetail.jsx  — Projects + Sold Projects lists; per-project shed spec & materials list
    PricingTool.jsx          — Materials List Generator
    MaterialPriceManager.jsx — Material Prices (with local price overrides + sales tax)
    PackageManager.jsx       — Packages (admin) — Shed Styles, Siding, Fixed, Size-Variable tabs
    ConfiguratorPricing.jsx  — Configurator Pricing (4 tabs)
    AffiliateResources.jsx   — Affiliate Resources (3 tabs)
    AdminPanel.jsx           — Admin (user management)
    Blueprints.jsx           — Blueprint links
    Financing.jsx            — Financing options
    ReferralRegistration.jsx — Referral form (used in AffiliateResources)
```

## Notes
- Shed styles, siding, add-ons and other options are all modelled as **packages**. Shed styles are
  size-variable packages (`packages.is_style`) whose per-size quantities live in `package_quantities`.
- Supabase caps every REST SELECT at 1000 rows (`.range()` does NOT bypass it), so `package_quantities`
  (3000+ rows) is fetched by paging in 1000-row chunks (see `fetchAllPackageQuantities` in App.jsx).
- Style multipliers are per-builder (`style_multipliers` table); other package multipliers are admin-set
  and global. Per-builder sales tax and price overrides are stored on `profiles` / `material_overrides`.
- The app is fully mobile-responsive with a hamburger menu and horizontally-scrollable tables.
- See `CONTEXT.md` for full architecture and `MIGRATION_styles_as_packages.sql` for the one-time DB migration.
