# Architecture & Roadmap — Urban Sheds Collective Platform

> **Purpose of this file.** `CONTEXT.md` describes the app *as it is today* (schema, gotchas,
> pricing logic). This file describes *where it's going* and the **structural decisions** that
> guide how we get there. Read it before starting any large new feature so we build on the
> agreed foundation instead of re-deciding. Keep it current: when a decision here changes or a
> roadmap item ships, update this file in the same session (same rule as the other docs).

> Audience note: the admin (Jeremy) is not a professional developer. Keep this readable —
> explain the "why," not just the "what."

---

## 1. The vision

The app started as the **USC Materials & Pricing Manager** (an internal pricing tool) and is now the
**USC Builder Portal** (renamed 2026-07, §5). The long-term
goal is for it to become the **central platform for Urban Sheds Collective LLC** — a network of
solo shed builders. Planned capabilities, to be built **piece by piece**:

- A **dashboard** for each builder.
- Integration with the **ShedPro Configurator**.
- **Project lists & project management** per builder.
- **Customer reviews** that sync to each builder's public profile.

The pricing/materials tools that exist today remain part of the platform — they become one
section of a larger builder experience.

---

## 2. Decisions already made (the foundation)

These are settled. Don't re-litigate them without a deliberate reason — later work assumes them.

| Decision | Choice | Why |
|---|---|---|
| **Tenancy model** | **Single user per builder** | The business is built around *solo craftsmen* building on-site. One login = one builder. No builder-org / team layer. This keeps data ownership simple: per-builder data is keyed by `user_id` (as it already is for overrides, multipliers, sales tax). |
| **Domain strategy** | **One root domain: `urban-sheds.com`** | Retire the confusing `.com` vs `.co` split. The marketing site lives at the root; the app lives on a subdomain. |
| **App URL** | **`build.urban-sheds.com`** (live, on Vercel) | `app.urban-sheds.com` was already taken by a legacy Adalo app (still live, to be retired later), so the app uses the `build` subdomain. |
| **Old domain** | **`urban-sheds.co` → forwards to `build.urban-sheds.com`** (GoDaddy 301) | Preserves old links; the `.co` domain will eventually be dropped. |
| **App hosting** | **Vercel** (was Netlify) | Consolidate website + app on one host/workflow. Vite static build; auto-deploy on merge to `main`. See `CONTEXT.md` → Stack & Deployment. |
| **Marketing website** | **Move off Wix → code-based host (planned)**, leaning **Next.js on Vercel** | So Claude can build/maintain it like the app, and so public SEO pages (builder profiles/reviews) can be server-rendered for search. Not built yet. |
| **Repo structure** | **Two separate repos** (app + website), not a monorepo | Independent deploys; a change to one can't break the other. Revisit (consolidate) only if public builder profiles need to share code with the app. |

---

## 3. Structural principles for the build-out

As features get added, follow these so the app scales cleanly. Each is here because skipping it
gets expensive to fix later.

### 3.1 Routing — React Router [DONE]
The old **in-memory module index** (`activeModule` 0–9 in `App.jsx` with a switch) has been replaced
by **React Router 7**. The app now has real, bookmarkable URLs; refresh keeps your place and the
browser Back button works within the app. See `CONTEXT.md` → "Routing" for the full Route Map.

- **What changed:** `main.jsx` wraps the app in `<BrowserRouter>`; `App.jsx` defines `<Routes>` and a
  `ROUTES` path constant; sidebar buttons are now `NavLink`s (active state from the URL). The
  individual modules did **not** change — they're reached by URL instead of by number and still get
  their data as props.
- **Admin-only routes** redirect non-admins to `/calculator` (UX guard; RLS is the real boundary).
- **SPA fallback** is configured for Vercel (`vercel.json` `rewrites` → `index.html`), so direct links
  like `build.urban-sheds.com/admin` resolve.
- **Still to do (later step):** per-route data loading (§3.3) — `loadData` currently still fetches
  everything up front.

### 3.2 Authorization / RLS is a first-class part of every feature
Supabase Row-Level Security **is** the security model. As customer data and reviews arrive, a
builder must never see another builder's data. `CONTEXT.md` already flags "RLS can silently block
writes" as a top gotcha.

- **For every new table, define its RLS policy explicitly** as part of the feature: who can
  read, who can write, scoped to which `user_id`. Treat "what's the RLS policy?" like we already
  treat "what SQL does Jeremy run?"
- Public-facing data (e.g. published builder profiles, approved reviews) needs a deliberate
  "anyone can read the published rows" policy — separate from the builder's private edit access.

### 3.3 Data loading won't stay all-at-once
`App.jsx`'s `loadData` currently fetches everything on startup (materials, packages, quantities).
That's fine today but won't scale once projects/customers/reviews exist.

- **Load per-section/per-route**, not all up front. When React Router lands, fetch a section's
  data when its route opens.
- Remember the **1000-row cap** (`CONTEXT.md`): any table that can grow past 1000 rows must be
  paged in 1000-row chunks (see `fetchAllPackageQuantities`). Projects/reviews will hit this.
- Consider a small data/service layer (`lib/projects.js`, `lib/reviews.js`) instead of calling
  Supabase directly from components — gives one place to handle paging, caching, and errors.

### 3.4 Integrations live in Edge Functions, never the browser
ShedPro and any review-platform sync are **external integrations** with their own API keys.

- Put integration logic in **Supabase Edge Functions** (server-side), not in React. Never ship a
  third-party secret key to the browser. (The Supabase *anon* key is the only key that belongs
  client-side — it's public and protected by RLS.)
- Keep each integration behind one module/function so its quirks (auth, rate limits, retries)
  are isolated.

### 3.5 Public vs. private split (important for SEO later)
The roadmap has two kinds of pages that want different homes:
- **Private app pages** (dashboards, pricing, project management) → `build.urban-sheds.com`,
  behind login. SEO irrelevant.
- **Public, SEO-valuable pages** (builder profiles, customer reviews) → ideally served from the
  **marketing domain** `urban-sheds.com` so search reputation concentrates there. This is a
  reason the website may use Next.js. Decide the exact split when we build profiles.

### 3.6 Migrations stay version-controlled
Schema changes already live as `MIGRATION_*.sql` files in the repo root. Keep doing this — every
schema change is a numbered/dated SQL file committed alongside the code, and Jeremy runs it in the
Supabase SQL Editor. State clearly when a migration must be run and confirm it ran before relying
on it (see `CLAUDE.md` → Database changes).

---

## 4. Build sequence (piece by piece)

Each step unblocks the next; build in this order.

0. **[DONE] Hosting foundation** — app on Vercel at `build.urban-sheds.com`, `.co` forwarding,
   auth Site URL fixed. (2026-06)
1. **[DONE] React Router** — real URLs replacing the module-index switch (React Router 7). *Prerequisite
   for everything below.* (2026-06)
2. **[DONE — basic shell] Builder dashboard** — the landing page each builder sees after login
   (`/dashboard`, now the app's home route). Role-gated: builders get a welcome + quick links + a
   "Coming Soon" section; admins get a **tabbed** view (a "Business Overview" tab plus one tab per
   builder) so they can see how each builder is doing. Performance metrics are placeholders until
   ShedPro/projects are connected; profile data we already have is shown for real. Builders only ever
   see their own data — the per-builder profiles query runs for admins only and is backstopped by RLS.
   (`src/modules/Dashboard.jsx`, 2026-06)
3. **[STARTED] Projects / project management** — core operational data. A `projects` table + Projects
   list (`/projects`), Sold Projects list (`/sold-projects`), and per-project page (`/projects/:id`).
   Every project belongs to one contact (a contact can have many); ownership/RLS is **derived from the
   parent contact** (admins see all, builders see projects whose contact they own). Each project carries
   the full Materials Calculator spec (size, style, siding, option packages, overrides) so a materials
   list generates from it — the project page reuses PricingTool's engine to render it live.
   (`src/modules/Projects.jsx`, `ProjectDetail.jsx`, `lib/projects.js`, `MIGRATION_projects.sql`, 2026-06-25.)
   **Expanded for ShedPro (2026-06-25):** `projects` now carries the full ShedPro order record (renderings,
   configured options, colors, fees) and was **seeded with 870 rows from a ShedPro export**; `contact_id` is
   now nullable (link by customer email; contact-less = admin-only) and RLS updated so admins always see all.
   This is the same shape the Zapier feed uses (`MIGRATION_projects_shedpro.sql`).
   **ShedPro → Zapier → projects feed is now LIVE (2026-06-29):** Zapier upserts each ShedPro project to
   the Supabase REST API on `shedpro_project_id` (the order # repeats across price revisions, so a dedicated
   dedup key was added), and a `projects_auto_link_contact` trigger attaches each incoming project to its
   customer contact by email so the right builder sees it — the project analog of the contacts sync. No app
   code (the app just reads the table). See `ZAPIER_PROJECTS.md` + `MIGRATION_projects_zapier_upsert.sql`.
   Next here: generate/export saved materials lists in bulk; map raw ShedPro siding/style strings onto the
   calculator's packages so the materials list auto-fills; use the project owner's sales-tax for the preview
   (today it uses the viewer's, same as the calculator).
4. **Customer reviews + public builder profiles** — depends on (3) and on the public/private
   split (§3.5). Public read RLS; likely surfaced on the marketing domain for SEO.
5. **ShedPro Configurator integration** — external dependency; do once the internal data model is
   stable so we know what we're mapping to.
   - **[STARTED] Contacts** — a `contacts` table + Contacts list (`/contacts`) and per-contact profile
     (`/contacts/:id`), per-builder with admin-sees-all RLS (`src/modules/Contacts.jsx`,
     `ContactProfile.jsx`, `lib/contacts.js`, `MIGRATION_contacts.sql`, 2026-06-25). Contacts are entered
     manually today; the table carries `source` + a unique `shedpro_id` so ShedPro leads can be upserted
     in later.
   - **Sync mechanism: Zapier** (decided 2026-06; LIVE). ShedPro → Zapier → Supabase REST API
     inserts/upserts records directly — no custom Edge Function. **Contacts** upsert on `email`
     (`ZAPIER_CONTACTS.md`) and **projects** upsert on `shedpro_project_id` (`ZAPIER_PROJECTS.md`), both
     auto-routed to the right builder by DB triggers. This sidesteps shipping a ShedPro secret to the
     browser (§3.4) without us hosting the integration. A dedicated Edge Function can still replace Zapier
     later if we outgrow it.

Parallel track (independent of the app): **rebuild the marketing site** off Wix onto Vercel.

---

## 5. Naming note
The product is named the **USC Builder Portal** (renamed 2026-07 from "USC Materials & Pricing
Manager" now that it's a full builder portal — CRM, projects/work orders, dashboards — not just a
pricing tool). It's **builder-facing** and deliberately keeps the Urban Sheds / USC brand in it.
- Where it shows: the browser tab title (`index.html` → "USC Builder Portal") and the login/reset/
  update-password screens (`Auth.jsx`), where "Builder Portal" is the tagline under the "Urban Sheds
  Collective" wordmark.
- The **repo/folder stays `usc-app`** and the app domain stays `build.urban-sheds.com` — the rename is
  cosmetic/product-framing, no infra change.

---

## 6. Open questions (decide when the relevant step arrives)
- **Website framework:** Next.js on Vercel (best for SEO/public profiles) vs. Vite on Netlify
  (identical to the app). Leaning Next.js; confirm when the website rebuild starts.
- **Public profile URLs:** served from `urban-sheds.com/builder/:slug` (SEO, may need the website
  and app to share data) vs. from the app domain. Decide when building reviews/profiles.
- **ShedPro:** what data flows which direction (pricing out? configurations in?) — scope when we
  reach step 5.
