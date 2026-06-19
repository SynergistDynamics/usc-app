# USC Materials & Pricing Manager

A React + Vite web app for Urban Sheds Collective — a network of licensed shed builders.
Provides pricing management, materials calculation, configurator pricing, blueprint access,
affiliate resources, and financing info.

## Stack
- **Frontend:** React 19 + Vite
- **Backend/Auth/DB:** Supabase
- **Hosting:** Netlify (static)

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

The production build is output to `dist/`. For Netlify, the `public/_redirects` file
(`/* /index.html 200`) handles SPA routing and is copied into `dist/` automatically.

To deploy: drag the contents of `dist/` to Netlify, or connect the repo for automatic
deploys (build command `npm run build`, publish directory `dist`).

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
- Supabase queries on `package_quantities` use `.range(0, 9999)` to bypass the default 1000-row limit.
- Style multipliers are per-builder (`style_multipliers` table); other package multipliers are admin-set
  and global. Per-builder sales tax and price overrides are stored on `profiles` / `material_overrides`.
- The app is fully mobile-responsive with a hamburger menu and horizontally-scrollable tables.
- See `CONTEXT.md` for full architecture and `MIGRATION_styles_as_packages.sql` for the one-time DB migration.
