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
  DNS managed in Cloudflare, "DNS only"/grey-cloud so Vercel issues SSL). Migrated off Netlify in 2026-06;
  Netlify is now fully retired (host disconnected). A separate marketing site lives at `urban-sheds.com`.
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
    (`/* /index.html 200`) was Netlify-specific and has been removed now that Netlify is fully retired.
  - **Public marketing & payment pages:** several standalone pages live as plain static HTML in
    `public/` and are served publicly, with NO login. Three are builder-recruitment marketing pages —
    `/assessment` (a JS-driven self-assessment quiz), `/licensing`, and `/affiliate-program` — first
    migrated off Netlify in 2026-06. Two are Stripe **payment** pages — `/onboarding-fee` ($499 one-time
    setup) and `/activate-license` ($1,495/mo license activation); each has a live Stripe Payment Link as
    its CTA and no backend. Because Vercel serves real files in `public/` BEFORE applying the SPA
    `rewrites` rule, all of these bypass React and the auth gate entirely — no route changes needed. Each
    is a single self-contained file (inline CSS/JS, Google Fonts via CDN). GOTCHA: a public page's folder
    name must NOT collide with a React route in `ROUTES` (App.jsx) — that's why the affiliate page is at
    `/affiliate-program`, since `/affiliate` is the in-app Affiliate Resources page. The share/copy links
    in `AffiliateResources.jsx` point at the `build.urban-sheds.com/...` marketing URLs; the two payment
    pages are surfaced (open + copy-link) in the super-admin **Admin → Builder Onboarding** tab
    (`ONBOARDING_PAGES` in `AdminPanel.jsx` — keep its `path` values in sync with the `public/` folders).
- **Env:** requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. In Vercel these live in the project's
  Environment Variables; for local dev put them in `.env` (see `.env.example`). `.env` is gitignored — never commit it.

## Source Structure
```
/index.html                  — Vite entry HTML (loads /src/main.jsx)
/package.json, vite.config.js, eslint.config.js
/public/                     — static assets (favicon.svg, hero.png, icons.svg, etc.)
/public/assessment/          — PUBLIC pages (see "Public marketing & payment pages" below):
/public/licensing/             self-contained static HTML served as-is, no login. Vite copies
/public/affiliate-program/     public/ to dist/ root; Vercel serves real files before the SPA
/public/onboarding-fee/        rewrite. The last two are Stripe payment pages linked from the
/public/activate-license/      super-admin "Builder Onboarding" tab in Admin.
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
                               NOT through App.jsx loadData. Sorted most-recently-added first (created_at desc
                               in fetchContacts). Desktop columns: Name, Email, Phone, State, Created (created_at),
                               Status (+ Owner for admins) — Company was removed 2026-06-29. Search matches name/
                               email/phone/market/state. The "Add contact" modal has a State field (no Company).
                               Admins also get an inline owner-assign dropdown per row and a "Lead routing" button.
    ContactProfile.jsx       — A single contact's profile page (/contacts/:id). UX overhaul 2026-06-29 — a
                               **compact card**: name-colored avatar, name, a tap-to-change **StatusPicker** (badge
                               dropdown → updateContact), and a one-line **summary strip** (project count · sold
                               count + total · last-active date). **Quick-action buttons** (📞 Call / 💬 Text / ✉️
                               Email / 🧭 Directions) render inline on desktop and as a **fixed bottom sticky bar on
                               mobile** (`isMobile` state) — native `tel:`/`sms:`/`mailto:`/Google-Maps links. Detail
                               rows are tappable links with **copy buttons on desktop** (CopyBtn → clipboard); missing
                               phone/email/address show a **"+ Add …" prompt** that opens the edit popup. Editing is a
                               **popup** (EditContactModal — all fields; Delete in its footer). Footer shows Added +
                               Updated dates and the admin "Builder" assign dropdown (builders see owner read-only).
                               Loads contact (lib/contacts) AND its projects (lib/projects) at the parent. The
                               **Projects** section ("+ New project") is **grouped**: a **"Sold (n)" header with the
                               summed sold total** pinned on top, then a **"Quotes & Drafts (n)"** group — each
                               newest-first. Each project renders as a **compact horizontal card (`ProjectRow`)
                               matching the Sold Projects list** (same professional design pass): flat-panel shed
                               thumbnail (bottom-aligned `contain`; `<ShedIcon>` line-icon when none) on the left, then
                               two anchors — **project name** (the contact is already known here) on the left and
                               **sale price** (bold, `fmtMoneyShort`, tabular) on the right — spec below, then a muted
                               `Status · date` line (status word tinted by `PROJECT_STATUS_EDGE`), a **thin
                               status-colored left edge** (replaces the old heavy sage accent), and a `›` chevron. RLS
                               scopes who can load/edit.
                               **Mobile pass (2026-06-29):** the quick-action bar is a fixed bottom sticky bar with
                               stacked icon+label buttons and iOS safe-area padding (`env(safe-area-inset-bottom)`);
                               the StatusPicker opens as a **bottom sheet** on mobile (dropdown on desktop); detail
                               rows are calm, **full-row-tappable** (≥46px, value in charcoal not loud links — the
                               action bar owns the loud actions); project rows are the compact image-led cards
                               described above (2026-06-29) on both mobile and desktop; Card padding + the quiet
                               icon-only ✎ Edit button tighten on mobile (`isMobile`).
    Projects.jsx             — Projects list (/projects) and Sold Projects list (/sold-projects, `soldOnly`
                               prop). NOTE: the all-projects "/projects" view is no longer linked from the
                               sidebar nav (only "Sold Projects" is) — the route still exists and resolves, but
                               the everyday way to reach a contact's projects is via their contact profile.
                               A project is a shed job tied to a contact; admins see all, builders see
                               only projects whose contact they own (RLS). Loads its own data via lib/projects.js.
                               "+ New project" opens a contact picker. Sold view filters to sold/completed, is
                               sorted most-recently-sold first, and shows a total-sold sum. **The Sold Projects
                               list renders as a responsive grid of compact horizontal cards (`ProjectCard`), NOT a
                               table** (UX redesign 2026-06-29, built mobile-first; **professional design pass same
                               day**): one column on mobile, `repeat(auto-fill, minmax(420px,1fr))` on wider screens.
                               Each card has a **small shed thumbnail on the left** (first available of
                               `rendering_url_1..4`, `object-fit:contain` + bottom-aligned on a flat `#F4F1EA` panel so
                               renderings share a "ground line" and aren't cropped; a `<ShedIcon>` line-icon, NOT an
                               emoji, when none) and details on the right built around **two anchors**: the **contact
                               name** (left) and the **sale price** (right, bold, `fmtMoneyShort` — no cents, tabular
                               figures). Below: spec (`size style` + a dimmed `#project_number`), then a single muted
                               meta line `Status · date · City, ST` (`fmtShortDate`, status word tinted by
                               `PROJECT_STATUS_EDGE`; ellipsizes so cards stay equal height), and (admins) the builder
                               in the tertiary tone. A **thin status-colored left edge** (`PROJECT_STATUS_EDGE`) encodes
                               the stage ambiently (no shouty corner badge); a `›` chevron hints it's tappable. Palette
                               is disciplined to charcoal + one secondary gray (`#8C8478`) + one tertiary (`#B3AC9F`) +
                               one sage accent (the price). The whole card navigates to the project. The all-projects
                               `/projects` view (route-only) keeps the plain table. The Sold
                               Projects view has an **Open/Closed tab strip**
                               (shown to everyone): **Open** = status `sold` (won, job in progress), **Closed** =
                               status `completed` (job finished); tab counts + the total-sold sum reflect the active
                               tab. It ALSO shows an **admin-only builder tab strip** below it (All + one tab per
                               builder who owns a sold project + Unassigned) that filters the list by builder; the
                               two tab strips compose (builder filter is applied first, then Open/Closed). (Builders
                               only see their own projects via RLS, so the builder tabs are an admin convenience.)
    ProjectDetail.jsx        — A single project's page (/projects/:id), presented as a printable WORK ORDER.
                               Above the tabs sits an **editable milestone stepper** (StatusMilestones): the four
                               pipeline stages **Quoted → Sold → Scheduled → Completed** as clickable circles —
                               one click sets the project's status (reached stages fill sage, current one is ringed),
                               saving inline via updateProject (RLS-scoped; stamps sold_at the first time it reaches a
                               sold status). draft/cancelled live OFF this track (set via the Edit modal's Status
                               dropdown): a draft shows nothing reached yet, a cancelled project shows a red flag with
                               steps dimmed (clicking one reactivates it to that stage). Below the stepper are TWO TABS:
                               • "Work Order" — a formatted, printable work-order document (rendered inside
                                 #work-order-print) showing every relevant detail: customer (name/company/full
                                 mailing address/phone/email, from the embedded contact), builder, shed spec
                                 (size/style/siding/multiplier), selected option packages, ShedPro finishes &
                                 colors, the **ShedPro itemized options & pricing** list (shedpro_options →
                                 "Options & Pricing" table, or the options_summary text fallback, or — when a project
                                 has NEITHER, e.g. one created by hand — an **app-priced fallback**: the selected
                                 option packages priced by buildOutput's pkgGroups[].customerPkgPrice. When that
                                 app-priced fallback is what's showing, the plain "Options & Add-ons" pills are hidden
                                 so the same options don't appear twice), renderings,
                                 pricing (material/labor/calc + sale price + "from $X/mo" financing) and notes. A
                                 "🖨 Print work order" button prints it. **Printing now uses a hidden IFRAME** (copies
                                 the #work-order-print innerHTML into the iframe and calls iframe.print()) instead of
                                 window.open — popups are blocked / print unreliably on mobile Safari, the iframe avoids
                                 both. The page only DISPLAYS the saved project — all editing is in a modal (see below).
                               • "Materials List" — READ-ONLY. Shows the live materials list generated from the
                                 spec via PricingTool's exported MaterialsListTab + buildOutput (one engine). No
                                 config controls here (an "Edit the spec" link opens the edit modal).
                               EDITING — an "✎ Edit project" button (header + footer) opens **EditProjectModal**:
                               a **Contact** picker (link/change/unlink the project's contact — ContactPicker
                               loads contacts lazily on first expand, RLS-scoped), name, status, sale price,
                               notes, the shed spec (PricingTool's ConfigPanel: size, style, siding, option
                               packages — passed `allowOverrides={false}` here so the per-option "Override price"
                               inputs are HIDDEN in the project edit popup; they still show in the Materials
                               Calculator, which renders ConfigPanel with the default `allowOverrides`. Any
                               package_overrides already saved on a project are preserved, just not editable here),
                               and — for **admins** — an "Assigned builder" dropdown. The
                               modal edits a draft and only persists on Save (Cancel discards); "Use calc"
                               reflects the draft spec's live price. The Contact picker is how you link a
                               **contact-less project** (sets projects.contact_id); switching the contact makes
                               the builder follow the new contact's owner, so the "Assigned builder" dropdown only
                               shows when the contact is UNCHANGED. The assigned-builder control reassigns the
                               project's CONTACT owner (contacts.user_id via assignContact) — ownership is derived
                               from the contact, so it changes the builder for ALL of that contact's projects (the
                               modal flags this). Builders (non-admin) don't see the builder control. Delete lives
                               in the footer.
                               **Mobile pass (2026-06-29):** on phones the Work Order tab swaps the shrunken paper doc
                               for an **app-style reading view** (`MobileWorkOrder`) — design-led, NOT the print sheet
                               scaled down. It (a) **leads with the renderings** (`WoGallery`: one large `contain`
                               image, or a scroll-snap carousel that lets the next one peek; `<ShedIcon>` when none),
                               (b) puts a **price headline card** up top (sale price big in sage + "from $X/mo" +
                               calc price), (c) makes the **Customer block tappable** (`CustomerActions`: native
                               📞 Call / 💬 Text / ✉️ Email / 🧭 Map links — same pattern as ContactProfile), (d) uses
                               **lighter section headers** (`MoSection`: small sage label + hairline rule, not the
                               print doc's solid sage bars) and **stacked rows** for the options/pricing tables (no
                               2-col table to overflow), and (e) a clean 2×2 spec grid. The **printable paper doc
                               (`WorkOrderDoc`) is unchanged** — on mobile it's rendered hidden (offscreen, still
                               `#work-order-print`) so Print/Save works from either tab. Page chrome also went
                               mobile-first: the **milestone stepper** circles are 40px (≥ touch target) and the 4
                               stages fit without horizontal scroll; the **two tabs split width evenly**; a **fixed
                               bottom sticky action bar** (🖨 Print/Save · ✎ Edit, iOS safe-area padding, matches
                               ContactProfile) owns the primary actions, so the header Edit button is desktop-only and
                               the footer's Delete becomes a quiet, separated text button (page gets bottom padding so
                               the bar never covers content). All gated by the `isMobile` resize-listener state.
                               Needs the global material/package data, passed as props like the calculator.
    LeadRoutingModal.jsx     — Admin-only modal (from Contacts) to map ShedPro territory → builder; lists
                               unmapped territories seen on contacts, edits/removes mappings, adds new ones.
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
                               **Exports** buildOutput, ConfigPanel, MaterialsListTab so ProjectDetail can
                               render the same shed spec + materials list from a saved project.
    MaterialPriceManager.jsx — Material Prices — local price overrides + sales tax input. No longer in the
                               sidebar; rendered as the "Material Prices" tab inside Configurator Pricing
                               (route /material-prices still resolves for direct links).
    PackageManager.jsx       — Packages (admin + builder pro) — 4 tabs: Shed Styles, Siding, Fixed,
                               Size-Variable. No longer in the sidebar; rendered as the "Packages" tab inside
                               Configurator Pricing (route /packages still resolves for direct links).
                               Access = canManagePackages(profile) (admin OR builder_pro), not just admin.
    AffiliateResources.jsx   — Affiliate Resources (idx 4) — 3 tabs
    AdminPanel.jsx           — Admin (idx 5, admin only) — Users tab (role dropdown: Builder / Builder Pro /
                               Admin, plus an "Access Levels" reference card describing each role); Builder
                               Onboarding + Tech Stack tabs (super admin only)
    Blueprints.jsx           — Blueprints (idx 6)
    ConfiguratorPricing.jsx  — Configurator Pricing — 4 pricing tabs (Base/Siding/Fixed/Variable) PLUS the
                               "Material Prices" tab (everyone) and "Packages" tab (admin only), which embed
                               MaterialPriceManager / PackageManager. The builder selector + Export CSV button
                               only show on the four pricing tabs. Needs setOverrides passed from App.jsx so the
                               embedded Material Prices tab can update the shared overrides state.
    Financing.jsx            — Financing (idx 9)
  lib/contacts.js            — Contacts data/service layer (fetch w/ 1000-row paging, get, create, update,
                               delete) + CONTACT_STATUSES / STATUS_LABELS / STATUS_COLORS constants.
  lib/projects.js            — Projects data/service layer (fetchProjects w/ 1000-row paging + soldOnly filter;
                               soldOnly sorts most-recently-sold first — sold_at desc, unknown sold dates last, then
                               created_at desc — while the all-projects view sorts created_at desc;
                               fetchProjectsForContact, get, create, update, delete) + PROJECT_STATUSES /
                               LABELS / COLORS, SOLD_STATUSES, isSoldStatus. Embeds the parent contact — incl.
                               full contact details (phone, address, city, state, zip) so ProjectDetail can
                               render a complete work order — plus its owner profile, and the style package name.
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
| `/contacts/:id` | Contact profile (+ its projects) | all (own only; admin sees all) |
| `/projects` | Projects list (route only — not in sidebar nav) | all (contacts they own; admin sees all) |
| `/sold-projects` | Sold Projects list | all (contacts they own; admin sees all) |
| `/projects/:id` | Project detail (shed spec + materials list) | all (contacts they own; admin sees all) |
| `/calculator` | Materials Calculator (PricingTool) | all |
| `/material-prices` | Material Prices (route only — now a tab in Configurator Pricing) | all |
| `/packages` | Packages (PackageManager) (route only — now a tab in Configurator Pricing) | admin + builder pro |
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
- **The `/packages` route + the Configurator Pricing → Packages tab** are gated by
  `canManagePackages(profile)` (admin OR `builder_pro`), defined in `lib/supabase.js` — NOT plain
  `isAdmin`. A **Builder Pro** is otherwise identical to a builder (own data only, no Admin panel); the
  only extra power is creating/editing packages. The matching DB changes live in
  `MIGRATION_builder_pro_packages.sql` — it (a) widens the `profiles_role_check` constraint to allow the
  `builder_pro` value, and (b) widens the packages/package_materials/package_quantities write policies to
  `role in ('admin','builder_pro')`; **applied to the live project 2026-06-29**. Without (a) the Admin role
  dropdown can't save `builder_pro`; without (b) a builder_pro's package writes silently fail.
- **Material Prices + Packages** used to live in a collapsible "Calculator Settings" sidebar submenu.
  That submenu is gone — both are now tabs inside the Configurator Pricing page. Their routes
  (`/material-prices`, `/packages`) still resolve so old direct links keep working.
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
  - **ShedPro configurator alignment (2026-06-29):** the option packages are kept in 1:1 correspondence
    with the ShedPro configurator's option menu so a synced ShedPro project can populate
    `projects.selected_packages` and generate a materials list. Six option types had no package and were
    added by `MIGRATION_shedpro_missing_packages.sql` — **4' Sliding Roll Door, Painted Wood Stud Interior,
    12" Single/Double/Triple Shelf, 24" Deep Workbench, Soffit & Ridge Vent, Stainless Steel Hinge** (8 rows).
    Per Jeremy's call (option "1b"/"2b") these are **price-only placeholders** (`flat_rate=0`, NO
    package_materials/quantities yet) and **one package per type** (configurator size/length granularity —
    transom sizes, door sizes, shelf length — is collapsed onto the single package, NOT split). **TODO:** set
    real prices + add the bill of materials in Configurator Pricing → Packages so the list is accurate (until
    then those items add $0 and no materials). Names match the configurator labels so the ShedPro→package
    mapping is a name match. NOTE: the **"Paint"** package = the configurator's **Siding Color** charge (its
    per-shed paint cost); the Edge Function adds Paint to selected_packages whenever a siding color is set
    (skipped for Western Red Cedar, which is natural/quote-only). It's NOT in shedpro_option_map (siding color
    is a flat field, not an option array) — handled in code, same as loft.
- `package_materials` — components per package (fixed_quantity for non-size-variable; null for size-variable)
- `package_quantities` — per-size quantities for size-variable packages (incl. styles & add-ons). Large table
  (3000+ rows); App.jsx loads it via **pagination** (see gotcha below), not a single `.range()`.
- `style_multipliers` — **per-builder** multiplier for a style package (user_id + package_id, unique). A builder's
  value overrides the style package's default `multiplier`. Managed on Configurator Pricing → Base Pricing.
- `profiles` — users (id, email, role: admin|builder_pro|builder|blocked, full_name, market, multiplier, sales_tax,
  **is_super_admin**, plus profile-page fields: **avatar_url, phone, company_name, website, bio**).
  The profile-page fields are edited by each user on `/profile` (My Profile); the RLS policy
  "Users can update own profile" (`USING auth.uid() = id`) scopes those writes. Its **WITH CHECK pins
  `role` and `is_super_admin` to their current values**, so a self-update can change any other field
  but CANNOT escalate privileges (see `MIGRATION_lock_profile_role.sql`). Admins still change roles via
  the separate "Admin can update any profile" policy. **`role='builder_pro'`** is a builder who can ALSO
  create/edit packages (gated by `canManagePackages` in lib/supabase.js + the widened packages RLS in
  `MIGRATION_builder_pro_packages.sql`); otherwise identical to `builder`. **`profiles.role` HAS a check
  constraint (`profiles_role_check`)** — it was widened to include `builder_pro` in that same migration;
  without that the Admin role dropdown errors with "violates check constraint profiles_role_check". Role
  labels + per-role descriptions live
  in `ROLE_LABELS` / `ROLE_DESCRIPTIONS` (lib/supabase.js), surfaced in the Admin → Users "Access Levels"
  card and the role dropdown (`ASSIGNABLE_ROLES`). `is_super_admin` is a flag layered on top of role=admin (NOT a new role value, so
  normal admin access is unaffected); it gates the Admin → Tech Stack tab. Super admins can grant/revoke
  it on other users via a toggle in the Admin → Users tab (granting also promotes the user to admin).
  `profiles.multiplier` is now legacy (seed source for style_multipliers); no longer used directly in pricing.
- `tech_stack` — super-admin-only list of the software this app runs on (name, url, username/signup email,
  sort_order). RLS restricts all access to super admins. Managed in Admin → Tech Stack. The old sidebar
  Supabase link was moved here (the Netlify row was removed in 2026-06 when Netlify was retired; Vercel
  is the current host). See `MIGRATION_super_admin_tech_stack.sql`.
- `referrals` — builder referrals (name, email, market, status, referred_by, notes). **RLS enabled**:
  a builder reads/writes only their own rows (`referred_by = auth.uid()`); admins see all (see
  `MIGRATION_referrals_rls.sql`). Because that hides other builders' rows, the duplicate-email check in
  ReferralRegistration uses the **`referral_email_taken(email)` SECURITY DEFINER function** — it reports
  whether an email is already registered (and when/by whom) without exposing the other builder's row.
- `contacts` — per-builder customers/leads (first step of the ShedPro integration). Columns: user_id
  (owner → profiles.id, defaults to auth.uid()), full_name, email, phone, company_name, address, city,
  state, zip, market, status (lead|quoted|customer|closed|lost), source (manual|shedpro|zapier|…),
  **shedpro_id** (external id for Zapier upserts/dedup — plain UNIQUE index so PostgREST can use it as an
  `on_conflict` arbiter; NULLs allowed and distinct — see MIGRATION_contacts_shedpro_upsert_index.sql.
  **GOTCHA (fixed 2026-06-29):** a placeholder id like `'0'`/blank is NOT distinct, so every lead carrying
  it collapsed onto the one `shedpro_id='0'` row and silently OVERWROTE it instead of inserting (Zapier
  still got HTTP 200). The `contacts_normalize_shedpro_id` BEFORE INSERT/UPDATE trigger now coerces
  blank/whitespace/`'0'` → NULL so placeholder-id leads insert fresh rows; real ids still dedup. See
  `MIGRATION_contacts_normalize_shedpro_id.sql`),
  **shedpro_territory** (ShedPro territory tag, set by Zapier; drives owner auto-routing),
  notes, created_at, updated_at (auto via `contacts_set_updated_at` trigger). **RLS enabled**: one ALL
  policy "Builders manage own contacts, admins all" — a builder reads/writes only rows where
  `user_id = auth.uid()`, admins read/write all (same shape as referrals). Restricted to `authenticated`.
  See `MIGRATION_contacts.sql` (applied 2026-06-25). **ShedPro → Zapier → Supabase REST** integration:
  Zapier (ShedPro native "New Customer" trigger) POSTs to `/rest/v1/contacts?on_conflict=email` with
  the service_role key + `Prefer: resolution=merge-duplicates`, upserting on **`email`**. Setup steps live
  in `ZAPIER_CONTACTS.md`. The write bypasses RLS (service_role), so incoming leads land with `user_id` null
  (admin-only) unless Zapier sets an owner.
  - **Dedup key = email (changed 2026-06-29).** Originally the upsert deduped on `shedpro_id`, but ShedPro
    sends a real id for very few leads (and sometimes the junk value `'0'`), so leads silently overwrote each
    other / never appeared. Since every ShedPro contact has an email, dedup moved to `email`:
    `contacts_email_key` UNIQUE index + a `contacts_normalize_email` BEFORE INSERT/UPDATE trigger that
    lowercases/trims email (blank → NULL) so the key is case-insensitive and email-less rows stay distinct.
    `shedpro_id` is still stored (now a plain `contacts_shedpro_id_idx` index, no longer UNIQUE) and its
    `'0'`/blank normalizer trigger remains. Caveats: email uniqueness is GLOBAL (same email for two builders
    merges onto one row — none existed at switch); a customer changing their email re-syncs as a new row.
    See `MIGRATION_contacts_dedup_by_email.sql`.
  **Seeded 2026-06-25** with 698 rows from a ShedPro customer export (`source='shedpro'`, `shedpro_id` null,
  `user_id` null = admin-only until assigned to builders; ZIP leading zeros recovered; status defaulted to
  `lead`). 12 test/internal rows (mail-tester.com, seadev.us/shedpro.co staff, "test"/"Test Name", city="Test")
  were then deleted, leaving **686** real contacts. A few junk-but-real-looking rows (e.g. "E R", "D U",
  "T Woods" with placeholder addresses) were intentionally kept. **Owner routing (2026-06-25):** the 686
  seed rows were assigned to builders by **state** (one-time backfill: GA→Aaron, MA→Paul, TX→Jeremy,
  PA→Jordan, CT→Noah, OH→Dennis; 113 in other states left unassigned). Going forward, owners are set by
  territory (see `territory_routing` + trigger below) or manually in the UI.
- `projects` — shed jobs (ARCHITECTURE.md step 3). Columns: contact_id (→ contacts, **NULLABLE, ON DELETE SET
  NULL** — a contact can have many projects; a ShedPro order may arrive before its customer is a known contact,
  so a null-contact project is admin-only until linked), name, status (draft|quoted|sold|scheduled|completed|cancelled
  — **no DB check constraint**, so new status values need no migration; the four-stage pipeline Quoted→Sold→Scheduled
  →Completed is the editable milestone stepper on ProjectDetail. SOLD_STATUSES = sold|scheduled|completed drives the
  Sold Projects page, which splits Open = sold|scheduled vs Closed = completed),
  **shedpro_project_id** (external id — the dedup key for the Zapier project upsert; plain UNIQUE index
  `projects_shedpro_project_id_key` so PostgREST can use it as an `on_conflict` arbiter; NULLs allowed
  and distinct; a `projects_normalize_shedpro_project_id` BEFORE INSERT/UPDATE trigger coerces
  blank/`'0'` → NULL like contacts do — see MIGRATION_projects_zapier_upsert.sql),
  plus the **Materials Calculator inputs** so a materials list can be generated: shed_size, style_package_id (→
  packages, ON DELETE SET NULL), siding, selected_packages (jsonb `{package_id: count}`), package_overrides
  (jsonb `{package_id: unit_price_override}`); sale_price, sold_at (stamped the first time status becomes
  sold/completed by the app), notes, created_at, updated_at (auto via `projects_set_updated_at` trigger).
  **Raw ShedPro columns** (seeded from a CSV export 2026-06-25; LIVE feed via Zapier since 2026-06-29 — see
  the ShedPro → Zapier integration note at the end of this bullet): source
  (manual|shedpro|zapier), project_number (the ShedPro order/project #, e.g. 5826 — **NOT unique**: the export has price
  REVISIONS sharing a number; was `shedpro_order_id`, renamed in MIGRATION_projects_style_mapping.sql), shed_style
  (raw style name, e.g. "Tall Modern" — mapped to a style_package_id where ShedPro "Tall" = the app's "High Wall"),
  customer_email (links a project to a contact by
  email), builder_email (raw ShedPro "User/Builder", kept for later reconciliation), construction_date,
  shedpro_created, rendering_url_1..4 + layout_rendering_url + details_url, work_order_pdf (raw text blob),
  siding_type, overhang_size, doors, windows, transom_package, vents, roof, floor, siding_color, trim_color,
  door_color, roof_color, site_prep, building_permit, access, additional_features.
  **Itemized options + pricing (added 2026-06-29, MIGRATION_projects_shedpro_lineitems.sql):** the ShedPro
  quote's open-ended "What's included" list (Frame, vents, doors + sub-details, transom, workbench, shelf,
  hinge, loft, overhang, foundation, permit, access, travel time, …) — each with its quoted price — is stored
  as **`shedpro_options`** (jsonb array of `{label, detail, price}`; `price` kept as the raw text ShedPro shows,
  e.g. `"$550.00"`/`"Included"`/`"0"`, so the work order prints exactly what was quoted). A fixed column per
  option can't keep up with ShedPro's list, hence jsonb (same pattern as selected_packages/package_overrides).
  **`options_summary`** (text) is a plain-text fallback for the same list (shown only when shedpro_options is
  empty); **`monthly_payment`** (numeric) is the quote's "from $X/mo" financing figure. The ShedPro all-in
  price still maps to `sale_price`. ProjectDetail's work order renders these in an **"Options & Pricing"**
  section (priced table from shedpro_options, or the text fallback) + a "or from $X/mo" line under Sale price;
  the renderer (`normalizeShedproOptions`) is tolerant of how Zapier delivers the array (objects with
  label/name/option + price/amount/cost key variants, plain strings, or a JSON string).
  **RLS enabled**: one ALL policy "Builders manage own projects, admins all" — **admins see ALL projects**
  (incl. contact-less ones); a builder reads/writes a project when they own its linked contact
  (`projects.contact_id` → `contacts.user_id = auth.uid()`). Restricted to `authenticated`. The app reads
  projects via `lib/projects.js` (1000-row paging; embeds contact+owner and style package name). The Sold
  Projects page filters status ∈ {sold, scheduled, completed}; ProjectDetail shows a read-only "ShedPro order details"
  card (renderings + configured options/colors). See `MIGRATION_projects.sql` + `MIGRATION_projects_shedpro.sql`
  + `MIGRATION_projects_style_mapping.sql` + `MIGRATION_projects_siding_mapping.sql` (all applied 2026-06-25). **Seeded 2026-06-25** with **870 rows** from a
  ShedPro "Shed Projects" export (`source='shedpro'`; 37 with a Date Sold → status `sold`, the other 833 →
  `quoted`; all 870 rows kept incl. ~114 price-revision rows sharing a project #; linked to contacts by customer
  email — 801/870 matched, the 69 unmatched left contact-less/admin-only; rendering URLs reconstructed from a
  shared CloudFront prefix). The raw `shed_style` text was then **mapped to style_package_id** (Tall Modern→High
  Wall Modern, Tall Traditional→High Wall Traditional, Modern→Modern, Traditional→Traditional) so projects link to
  real style packages. The raw `siding_type` was likewise **mapped to the calculator `siding` value** (LP Lap*→
  Clapboard, LP Smart*/`*T1-11*`→T1-11, Board & Batten→B&B, Western Red Cedar→Western Red Cedar; blanks left
  unset) so the materials list resolves siding too. A few test/internal rows (seadev/shedpro.co/mail-tester) came
  along in the export and are harmless admin-only noise.
  - **ShedPro → Zapier → Supabase REST integration (LIVE 2026-06-29).** Same shape as contacts: Zapier
    POSTs each ShedPro project to `/rest/v1/projects?on_conflict=shedpro_project_id` with the
    service_role key + `Prefer: resolution=merge-duplicates`, **upserting on `shedpro_project_id`** (a
    re-sync UPDATES the same row instead of duplicating). `project_number` (the order #) can't be the
    dedup key — it repeats across price revisions (755 distinct across 870 seed rows) — so a dedicated
    `shedpro_project_id` was added; all seed rows have it NULL (distinct), so seed rows never collide and
    the index can still arbitrate the live upsert. The write bypasses RLS (service_role), so a project
    arrives with `contact_id` NULL; a **`projects_auto_link_contact` BEFORE INSERT trigger** (SECURITY
    DEFINER) sets `contact_id` by matching `customer_email` to a contact (case/whitespace-insensitive;
    contacts.email is normalized lowercased) — so the contact's builder sees it immediately (ownership is
    derived from the contact). No match → contact-less/admin-only until linked. INSERT-only so manual
    unlinks in the app aren't undone. **status is NOT sent by Zapier** (defaults `draft` on insert,
    preserved on update since merge-duplicates only sets sent columns) — the milestone stepper stays in
    control. No app code — the React app just reads the table Zapier fills. Setup steps + field mapping
    live in `ZAPIER_PROJECTS.md`. See `MIGRATION_projects_zapier_upsert.sql` (applied 2026-06-29).
- `territory_routing` — admin-managed map of ShedPro **territory → builder** (`territory` PK, `user_id` →
  profiles). A `BEFORE INSERT` trigger `contacts_auto_assign` (SECURITY DEFINER) sets a new contact's
  `user_id` from this map when `user_id` is null and `shedpro_territory` is set — so Zapier-inserted leads
  auto-assign to the right builder. Managed in the Contacts page → **Lead routing** modal (admins only),
  which also assigns existing unassigned leads when a mapping is added. RLS: admins only. See
  `MIGRATION_contacts_territory_routing.sql` (applied 2026-06-25).
- `shedpro_option_map` — translation table for the ShedPro projects sync: **(category, shedpro_value) →
  package_id** (unique on category+shedpro_value). `category` = the component/interior Type (`vent`/`door`/
  `windows`/`workbench`/`shelf`), or `overhang`/`frame`, or an `other_upgrades` **Group** string (`Hinge`,
  `Flooring Options`, `Site Preparation`, `Soffit & Ridge Vent Options`). The Edge Function (below) looks up
  each selected option here (case-insensitive) to build `projects.selected_packages`. Absent rows = skipped —
  that's how "default/included" values (Galvanized hinge, Light Duty floor, Standard overhang, Basic interior)
  and the **non-material** groups (Building Permit, Access Fees, Travel Charges) are intentionally ignored.
  Loft is NOT here (the function picks Loft Modern vs Loft Traditional from the project's style). RLS: admins
  manage; the Edge Function uses service_role. Seeded 2026-06-29 (43 rows) — see `MIGRATION_shedpro_option_map.sql`.
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

## Edge Functions
- `shedpro-project-sync` (`supabase/functions/shedpro-project-sync/index.ts`, deployed 2026-06-29,
  `verify_jwt=false`) — the ShedPro **projects** sync. Zapier forwards the whole ShedPro project JSON here;
  the function maps the flat fields (style→style_package_id, siding→siding, size→shed_size, colors, Total→
  sale_price, Model Url→details_url, Billing Email→customer_email, Reference Order Num→project_number,
  images[]→rendering_url_*) and walks the option arrays (`components[]`, `interior_components[]`, `overhang[]`,
  `loft[]`, `frame`, `other_upgrades[]`) through `shedpro_option_map` into `selected_packages {package_id:count}`
  (loft resolved by style; the **"Paint"** package added whenever a siding color is set — Paint = the siding-color
  charge — skipped for Western Red Cedar), stores the raw options in `shedpro_options`, and **upserts on `shedpro_project_id`**
  (top-level ShedPro `Id`). On UPDATE it deliberately omits `status`/`sold_at`/`contact_id` so the app keeps
  control of the pipeline + contact linking; on INSERT it sets status from ShedPro (quote-request→quoted) and
  the `projects_auto_link_contact` BEFORE INSERT trigger links the contact by email. **Why an Edge Function
  (not the plain REST upsert used for contacts):** a project's options arrive across several NESTED arrays,
  which Zapier's flat field-mapping / a single REST upsert can't assemble. The Zap is **ShedPro trigger → Code
  by Zapier** (Run Javascript) that POSTs the trigger fields to the function; ShedPro emits each option list as
  a **bare-comma-joined string**, which the function splits on `/,(?!\s)/` (comma not followed by space) so
  natural `", "` commas inside a value survive. **AUTH:** the function checks the bearer against its
  `SUPABASE_SERVICE_ROLE_KEY` env — on this project's **new API-key system that env is the secret key
  `sb_secret_…`, NOT the legacy `service_role` JWT (`eyJ…`)** (using the legacy key → 401). `?dry_run=1` returns
  the computed mapping WITHOUT writing or auth (for testing). **LIVE & verified 2026-06-29** end-to-end:
  ShedPro project #5864 (Id 6a42…) synced → 14 packages, auto-linked to its contact + builder by email.
  Setup: `ZAPIER_PROJECTS.md`.

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
- **NEVER put `className="usc-table-scroll"` on a TAB STRIP.** That class sets `overflow-x:auto` AND
  `overflow-y:auto`, so a 2px-bottom-border tab row overflows vertically by a hair and renders a stray
  little vertical scrollbar. `usc-table-scroll` is for *wide data tables only*. For a horizontally
  scrolling tab strip use **inline `overflowX:'auto'` + `overflowY:'hidden'`** (plus `flexShrink:0` tabs).
  This bit the Dashboard, then the Project Detail / Sold Projects / Configurator / Packages / Affiliate
  tab strips — all five were converted to the inline pattern (2026-06-25). If you add a new tabbed view,
  copy that inline pattern, not the class.
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
  **Do NOT use it for tab strips** — it adds `overflow-y:auto` and yields a stray vertical scrollbar; tab strips use inline `overflowX:'auto'` + `overflowY:'hidden'` (see the gotcha above).
- Builder-facing labels: "Local Price" (not "Your Price"), "Local Supplier" (not "Supplier").

## Access / Invitation Flow
1. Admin adds invite in AdminPanel (email).
2. If a blocked profile already exists for that email → upgraded to builder immediately.
3. Fresh sign-in → Auth.jsx checks invitations table on profile creation → role=builder if invited, else blocked.
4. Blocked users see a blocked screen.
5. Admin can delete users (removes profile row; auth account remains in Supabase dashboard).

## Custom Email
Supabase Auth uses custom SMTP via Resend — magic links come from info@urban-sheds.com as "Urban Sheds Collective".
