# ShedPro → Zapier → Projects (setup guide)

This is the integration that pushes ShedPro **shed projects** (the configured shed jobs, with all
their details — renderings, options, colors, fees) into the app's `projects` table. Like the
contacts integration it runs entirely in Zapier + Supabase — there is **no app code** for it (the
React app just reads the `projects` table that Zapier fills, and renders the ShedPro detail on the
Project Detail page). For the table itself see `CONTEXT.md` → Supabase Tables → `projects`, and the
migrations `MIGRATION_projects.sql` / `MIGRATION_projects_shedpro.sql` /
`MIGRATION_projects_zapier_upsert.sql`.

```
ShedPro (new/updated project)  →  Zapier  →  Supabase REST API  →  projects table
```

Each project is **upserted on `shedpro_project_id`**, so re-sending the same ShedPro project
**updates** its existing row (status, colors, options, sale price) instead of creating a duplicate.
This is the analog of the contacts sync, which upserts on `email` (see `ZAPIER_CONTACTS.md`).

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
- The Supabase **service_role key** (NOT the anon key):
  Supabase Dashboard → Project Settings → **API** → "Project API keys" → **`service_role`** → Reveal/Copy.
  - ⚠️ This key bypasses Row-Level Security. Paste it **only into Zapier**. Never commit it,
    never put it in the React app or anywhere public. (Same key the contacts Zap already uses.)

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
| `sale_price` | the project total / sale price (number) |
| `construction_date` | construction date (date) |
| `shedpro_created` | ShedPro "Created" timestamp |
| `siding_type` | siding |
| `overhang_size`, `doors`, `windows`, `transom_package`, `vents`, `roof`, `floor` | configured options |
| `siding_color`, `trim_color`, `door_color`, `roof_color` | colors |
| `site_prep`, `building_permit`, `access`, `additional_features` | extras |
| `rendering_url_1` … `rendering_url_4`, `layout_rendering_url`, `details_url` | renderings & links |
| `work_order_pdf` | raw work-order text/URL if available |
| `notes` | any notes |

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
