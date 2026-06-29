# ShedPro → Zapier → Projects (setup guide)

This is the integration that pushes ShedPro **shed projects** (the configured shed jobs, with all
their details — renderings, options, colors, fees) into the app's `projects` table. Like the
contacts integration it runs entirely in Zapier + Supabase — there is **no app code** for it (the
React app just reads the `projects` table that Zapier fills, and renders the ShedPro detail on the
Project Detail page). For the table itself see `CONTEXT.md` → Supabase Tables → `projects`, and the
migrations `MIGRATION_projects.sql` / `MIGRATION_projects_shedpro.sql` /
`MIGRATION_projects_zapier_upsert.sql`.

```
ShedPro (new/updated project)  →  Zapier  →  Supabase Edge Function (shedpro-project-sync)  →  projects table
```

> ## ⚠️ UPDATED APPROACH (2026-06-29): projects sync via an Edge Function, not a plain REST upsert
> Unlike contacts (a flat REST upsert on `email`), a ShedPro **project** carries its selected options
> across several **nested arrays** (`components[]`, `interior_components[]`, `overhang[]`, `loft[]`,
> `frame`, `other_upgrades[]`) — which Zapier's flat field-mapping and a single REST upsert can't
> assemble. So Zapier forwards the **whole project JSON** to a Supabase **Edge Function**
> (`shedpro-project-sync`) that does the mapping and the upsert:
> - flat fields → project columns (style→style_package_id, siding→siding, size→shed_size, colors,
>   Total→sale_price, Model Url→details_url, Billing Email→customer_email, Reference Order Num→
>   project_number, images[]→renderings);
> - the option arrays → `selected_packages {package_id: count}` via the **`shedpro_option_map`** table
>   (so the existing work order + materials list build automatically; loft is resolved from the style);
> - the raw options are kept in `shedpro_options` (audit + to surface any **unmapped** option);
> - **upsert on `shedpro_project_id`** (the top-level ShedPro `Id`); on update it leaves
>   `status`/`sold_at`/`contact_id` to the app; on insert the auto-link trigger attaches the contact by email.
>
> **Function URL:** `https://ywboyreznmuaddprkycm.supabase.co/functions/v1/shedpro-project-sync`
> **Auth:** send the Supabase **secret key `sb_secret_…`** as `Authorization: Bearer <key>` (this project
> uses the new API-key system — NOT the legacy `eyJ…` service_role JWT; see the AUTH GOTCHA in Step 2).
> `?dry_run=1` returns the computed mapping WITHOUT writing or auth (handy for testing).
> See **"Step 2 (Edge Function)"** below. The plain-REST steps that follow are kept for reference /
> the simple-field fallback, but the Edge Function is the live path for projects.

Each project is **upserted on `shedpro_project_id`**, so re-sending the same ShedPro project
**updates** its existing row (status, colors, options, sale price) instead of creating a duplicate.

### Step 2 (Edge Function) — CONFIRMED WORKING SETUP (2026-06-29)
The live Zap is **2 steps: ShedPro trigger → Code by Zapier (Run Javascript)**. (Code, not the
Webhooks "Data" form, because ShedPro's option lists arrive as **comma-joined strings** that the
function splits — see notes below.)

1. **Trigger:** ShedPro → New/Updated Project.
2. **Action:** **Code by Zapier → Run Javascript.**
   - **Input Data** — add these rows (left = name to type, right = the ShedPro trigger field). Line-item
     fields (components/interior/overhang/loft/frame/upgrades/images) come through as one comma-joined
     string each; the function un-joins them.
     ```
     id=Id  reference_order_num=Reference Order Num  description=Building Details Description
     size_width=Building Details Size Width  size_length=Building Details Size Length
     siding_material=Building Details Siding Material  siding_color=Building Details Siding Color
     trim_color=Building Details Trim Color  roof_color=Building Details Roof Color
     roof_material=Building Details Roof Material Display  total=Total  model_url=Building Details Model Url
     billing_email=Billing Email  customer_note=Customer Note  date_created=Date Created  status=Status
     components_type=…Components Type   components_display=…Components Display   components_price=…Components Price
     components_primary_color=…Components Primary Color
     interior_type=…Interior Components Type  interior_display=…Interior Components Display  interior_price=…Interior Components Price
     overhang_name=…Overhang Name  overhang_price=…Overhang Price  loft_name=…Loft Name  loft_price=…Loft Price
     frame_name=…Frame Name  frame_price=…Frame Price
     upgrades_name=…Other Upgrades Name  upgrades_group=…Other Upgrades Group  upgrades_price=…Other Upgrades Price
     images_key=…Images Key  images_value=…Images Value
     service_key = (the Supabase secret key — see auth note)
     ```
   - **Code:**
     ```js
     const res = await fetch(
       'https://ywboyreznmuaddprkycm.supabase.co/functions/v1/shedpro-project-sync',
       { method: 'POST',
         headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + inputData.service_key },
         body: JSON.stringify(inputData) }
     );
     return { status: res.status, body: await res.text() };
     ```
   - Add **`?dry_run=1`** to the URL to preview the mapping without writing (returns `selected_count`
     + `unmapped`, no auth needed). Remove it to write for real.
3. **Test** → expect `{"ok":true,"action":"inserted",...}`. Open the project in the app (Work Order +
   Materials List). Re-sending the same project updates the same row. Then **Publish**.

> **🔑 AUTH GOTCHA (cost us a while):** the function checks the bearer token against the Edge Function's
> `SUPABASE_SERVICE_ROLE_KEY` env. This project is on Supabase's **new API key system**, so that env is
> the **new secret key `sb_secret_…`** — NOT the legacy `service_role` JWT (`eyJ…`). Put the **`sb_secret_…`**
> key in the `service_key` Input Data row (Project Settings → API Keys, the default/new view — *not* the
> "Legacy" tab). Using the `eyJ…` legacy key returns `401 unauthorized`.

> **Why parse comma-joined strings?** ShedPro's Zapier app emits each option list as one bare-comma-joined
> string (even through Code by Zapier — arrays aren't offered). The function splits on a comma **not
> followed by a space** (`/,(?!\s)/`), so join-commas separate items while natural `", "` commas inside a
> value (e.g. "Crushed Stone Base (Good for Larger Sheds, Best Drainage)") stay intact.

---

The legacy field-by-field REST mapping below was the original plan; it's superseded by the Edge Function
(it can't populate `selected_packages` from the option lists). Kept for reference only.

> **Why a separate `shedpro_project_id` and not the order number?** The ShedPro order # (stored as
> `project_number`, e.g. 5826) is **not unique** — the historical export had price *revisions* that
> share a number — so it can't be the dedup key. `shedpro_project_id` is a dedicated key just for the
> Zapier upsert. Map ShedPro's unique project/order **ID** into it (see Step 2). If ShedPro only
> gives you the order number, mapping that works fine too: re-syncs of the same order update the one
> row (you get its latest state).

---

## What you need first

- A **Zapier** account (the ShedPro app + Webhooks action need at least a Starter plan). The same
  account you used for the contacts Zap is fine.
- The Supabase **secret key** (`sb_secret_…`): Supabase Dashboard → Project Settings → **API Keys**
  (the default/new view, NOT the "Legacy" tab) → copy the **secret** key. This is what the Edge Function
  validates against (its `SUPABASE_SERVICE_ROLE_KEY` env is this `sb_secret_…` key on the new key system).
  - ⚠️ Full-access server key — bypasses RLS. Paste it **only into Zapier**. Never commit it,
    never put it in the React app or anywhere public.

Project API URL: `https://ywboyreznmuaddprkycm.supabase.co`

---

## Step 1 — Trigger: ShedPro "New / Updated Project"

1. Create a new Zap. For the **Trigger**, search for and pick the **ShedPro** app.
2. Choose the event that fires when a project/order is created or changed (e.g. "New Project" /
   "New Order" / "Project Updated" — exact name depends on ShedPro's Zapier app).
3. Connect your ShedPro account and **Test trigger** so Zapier pulls a sample project. **Note the
   field names** ShedPro gives you (project id, order #, customer email, style, options, colors,
   rendering URLs, etc.) — you map them in Step 2.

> If ShedPro has both "new" and "updated" events, you can add a second Zap (or use one event that
> fires on both) pointing at the **same** Step-2 action — the upsert handles create and update the
> same way. Keeping projects current as deals progress is the whole point of upserting.

---

## Step 2 — Action: POST to Supabase (upsert)

Add an action step → app **"Webhooks by Zapier"** → event **"POST"**.

| Field | Value |
|---|---|
| **URL** | `https://ywboyreznmuaddprkycm.supabase.co/rest/v1/projects?on_conflict=shedpro_project_id` |
| **Payload Type** | `json` |
| **Data** | the field mapping below |
| **Wrap Request In Array** | **No** |
| **Unflatten** | No |
| **Headers** | the headers below |

### Headers

| Key | Value |
|---|---|
| `apikey` | *(your service_role key)* |
| `Authorization` | `Bearer ` *(your service_role key)* |
| `Content-Type` | `application/json` |
| `Prefer` | `resolution=merge-duplicates,return=minimal` |

`resolution=merge-duplicates` is what turns the POST into an upsert on `shedpro_project_id`.

### Data (map ShedPro fields → projects columns)

**The dedup key + the customer link are the two that matter most:**

| Data key (left) | Value (map from the ShedPro trigger) |
|---|---|
| `shedpro_project_id` | ShedPro's unique project/order **ID** *(**required — this is the dedup key**; blank/`0` is treated as "no id" and inserts a fresh row each time)* |
| `customer_email` | the customer's email *(**drives auto-linking to a contact → the right builder** — see below)* |
| `source` | type the literal `zapier` |

**The rest are detail shown on the Project Detail "ShedPro order details" / work order:**

| Data key (left) | Value (map from the ShedPro trigger) |
|---|---|
| `project_number` | ShedPro order/project # (e.g. 5826) — human-facing, fine if it repeats |
| `name` | a label for the project (e.g. customer name + style, or ShedPro's project title) |
| `builder_email` | ShedPro "User/Builder" (kept for reconciliation) |
| `shed_style` | raw style name (e.g. "Tall Modern") |
| `shed_size` | shed size (e.g. `10x12`) if ShedPro provides it |
| `sale_price` | the **all-in price** (the big headline number, e.g. `15547.19` — digits only, no `$`/commas) |
| `monthly_payment` | the "from $X/mo" financing figure (e.g. `186.59`) |
| `construction_date` | construction date (date) |
| `shedpro_created` | ShedPro "Created" timestamp |
| `siding_type` | siding |
| `overhang_size`, `doors`, `windows`, `transom_package`, `vents`, `roof`, `floor` | configured options |
| `siding_color`, `trim_color`, `door_color`, `roof_color` | colors |
| `site_prep`, `building_permit`, `access`, `additional_features` | extras |
| `rendering_url_1` … `rendering_url_4`, `layout_rendering_url`, `details_url` | renderings & links |
| `work_order_pdf` | raw work-order text/URL if available |
| `notes` | any notes |
| `shedpro_options` | the **itemized options list with prices** — see "Sending the itemized options" below |
| `options_summary` | OR the same list as one block of plain text (simpler fallback — see below) |

**Do not send** `id`, `contact_id`, `user_id`, `status`, `sold_at`, `created_at`, or `updated_at`:
- `id` is auto-generated; `created_at`/`updated_at` default automatically.
- `contact_id` is set **automatically** by matching `customer_email` to a contact (see below) — don't
  set it by hand.
- `user_id` doesn't exist on projects — ownership is **derived from the linked contact**.
- `status` defaults to `draft` on a new row, and (because the upsert only updates the columns you
  send) is **preserved on re-sync** — so the milestone stepper / Edit modal in the app stays in
  control of the pipeline (Quoted → Sold → Scheduled → Completed). Leave it out unless you have a
  reason to map it.

> **Re-sync safety:** the upsert only updates the columns present in the payload. Any column you
> DON'T map is left untouched on an update — so editing a project in the app (status, notes, etc.)
> won't be clobbered by a later ShedPro re-sync, as long as you don't also map that column.

---

## Step 3 — Test

1. Click **Test action** in Zapier. A success response is HTTP **201** (created) or **200**
   (updated) with an empty body (because of `return=minimal`).
2. Open the app at **`/sold-projects`** or a contact's profile (as the admin) — the synced project
   should appear (a fresh one defaults to **Draft**, so check the all-projects route `/projects` or
   the contact's **Projects** list). Open it to see the **ShedPro order details** card populated.
3. Run the test again with the **same** `shedpro_project_id` → it should update the same row, not add
   a second one. A different id → a new row. That confirms the upsert is working.
4. Turn the Zap **on**.

---

## Owner auto-routing (project → contact → builder)

Projects don't have their own owner — **ownership is derived from the linked contact** (a builder
sees a project when they own its contact; admins see all). So routing a project to a builder = making
sure it's linked to the right contact:

1. Map the customer's email into `customer_email` (table above).
2. On insert, a database trigger (`projects_auto_link_contact`) matches that email to an existing
   contact and sets `contact_id` automatically — so the contact's builder sees the project right
   away. The match is case-/whitespace-insensitive (contacts store email lowercased).
3. **No matching contact?** The project lands **unlinked** (admin-only) until you link it by hand on
   the Project Detail page (the Edit modal's Contact picker). Tip: let the **contacts** Zap create the
   customer first (or run both Zaps), so the contact exists when the project arrives.

> Auto-link runs on **insert only** (like the contacts territory trigger), so manually unlinking or
> re-pointing a project's contact in the app is never undone behind you.

## Notes & gotchas

- **Common errors**
  - `401 / "Invalid API key"` → wrong key, or the `Authorization` header isn't `Bearer <key>`.
    Both `apikey` and `Authorization` must carry the **service_role** key.
  - `400 / "no unique or exclusion constraint matching the ON CONFLICT specification"` → the
    `shedpro_project_id` unique index is missing. It's `projects_shedpro_project_id_key` from
    `MIGRATION_projects_zapier_upsert.sql` (applied 2026-06-29).
  - `405` from the agent proxy / form-encoded body → make sure **Payload Type = json**, not form.
- **`shedpro_project_id` is the conflict key.** If a project arrives with no id (or `0`/blank, which
  the DB coerces to NULL), it inserts a NEW row every sync (NULL ids don't conflict) — so a re-synced
  id-less project won't dedup. Always map a real id if ShedPro provides one.
- **Seed vs. live overlap.** The 870 rows seeded on 2026-06-25 have `shedpro_project_id = NULL`. A
  project that was in that seed AND now comes through Zapier will appear as a **new** row (the seed
  row won't match by id). Expected; de-dupe by hand later, or one-time backfill `shedpro_project_id`
  onto the seed rows if you can map them to ShedPro ids.
- **`project_number` can repeat** (price revisions share it) — that's why it's NOT the dedup key. It's
  fine to send; it's just for display/lookup.
- **Status & sold date stay app-managed.** New rows default to `draft`; the pipeline is driven by the
  milestone stepper in the app, and `sold_at` is stamped by the app the first time a project reaches a
  sold status. Don't map `status`/`sold_at` from Zapier unless you deliberately want ShedPro to own
  them (and accept that a re-sync would overwrite an in-app change to those fields).
