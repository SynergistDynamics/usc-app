# ShedPro → Zapier → Contacts (setup guide)

This is the live integration that pushes ShedPro customers/leads into the app's `contacts`
table. It runs entirely in Zapier + Supabase — there is **no app code** for it (the React app
just reads the `contacts` table that Zapier fills). For the table itself see `CONTEXT.md`
→ Supabase Tables → `contacts`, and `MIGRATION_contacts.sql`.

```
ShedPro (new/updated customer)  →  Zapier  →  Supabase REST API  →  contacts table
```

Each lead is **upserted on `email`**, so re-sending the same ShedPro customer updates
their existing row instead of creating a duplicate. (Dedup moved from `shedpro_id` → `email`
on 2026-06-29: every ShedPro contact has an email, but `shedpro_id` was sent for very few
leads and sometimes arrived as the junk value `'0'`, which made leads overwrite each other
or vanish. Email is normalized to lowercase/trimmed in the DB so the match is case-insensitive.)

---

## What you need first

- A **Zapier** account (the ShedPro app + Webhooks action need at least a Starter plan).
- The Supabase **service_role key** (NOT the anon key):
  Supabase Dashboard → Project Settings → **API** → "Project API keys" → **`service_role`** → Reveal/Copy.
  - ⚠️ This key bypasses Row-Level Security. Paste it **only into Zapier**. Never commit it,
    never put it in the React app or anywhere public.

Project API URL: `https://ywboyreznmuaddprkycm.supabase.co`

---

## Step 1 — Trigger: ShedPro "New Customer"

1. Create a new Zap. For the **Trigger**, search for and pick the **ShedPro** app.
2. Choose the event that fires when a customer/lead is created (e.g. "New Customer" /
   "New Lead" — exact name depends on ShedPro's Zapier app).
3. Connect your ShedPro account and **Test trigger** so Zapier pulls a sample record. Note the
   field names ShedPro gives you (name, email, phone, address, etc.) — you'll map them in Step 2.

> If ShedPro also has an "updated customer" event, you can add a second Zap (or a filter) using
> the same Step-2 action — the upsert handles both create and update.

---

## Step 2 — Action: POST to Supabase (upsert)

Add an action step → app **"Webhooks by Zapier"** → event **"POST"**.

| Field | Value |
|---|---|
| **URL** | `https://ywboyreznmuaddprkycm.supabase.co/rest/v1/contacts?on_conflict=email` |
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

`resolution=merge-duplicates` is what turns the POST into an upsert on `email`.

### Data (map ShedPro fields → contacts columns)

| Data key (left) | Value (map from the ShedPro trigger) |
|---|---|
| `email` | email *(**required — this is the dedup key**; normalized to lowercase in the DB)* |
| `full_name` | customer name |
| `shedpro_id` | ShedPro's customer/lead id *(optional now — stored for reference, no longer the dedup key)* |
| `phone` | phone |
| `address` | street address |
| `city` | city |
| `state` | state |
| `zip` | zip / postal code |
| `shedpro_territory` | ShedPro's **territory** field (drives auto-assignment to a builder — see below) |
| `source` | type the literal `shedpro` |

**Do not send** `id`, `user_id`, `status`, `created_at`, or `updated_at`:
- `id` is auto-generated; `created_at`/`updated_at` default automatically.
- `status` defaults to `lead`.
- `user_id` is left out on purpose → the lead arrives **unassigned** (admin-only) until
  someone assigns it to a builder. (See "Assigning an owner" below to change this.)

---

## Step 3 — Test

1. Click **Test action** in Zapier. A success response is HTTP **201** (created) or **200**
   (updated) with an empty body (because of `return=minimal`).
2. Open the app at **`/contacts`** (as the admin) — the test lead should appear at the top
   (the list is sorted newest-first). It'll show a small **`shedpro`** source tag.
3. Run the test again with the **same** email (any case) → it should update the same row, not add a
   second one. Different email → a new row. That confirms the upsert is working.
4. Turn the Zap **on**.

---

## Owner auto-routing (territory → builder)

New leads are auto-assigned to a builder based on their **territory**:

1. Map ShedPro's territory field into the `shedpro_territory` data field (table above).
2. In the app: **Contacts → ⚙ Lead routing** (admin only) maps each territory value to a builder.
   Any territory that's arrived but isn't mapped yet shows up there under "Needs mapping".
3. A database trigger assigns the owner automatically when the lead is inserted. If a territory
   isn't mapped (or `shedpro_territory` is blank), the lead lands **unassigned** for an admin to
   route by hand (the Contacts list and each contact's page both have an "assign to builder" control).

You can also map a territory **before** any lead arrives via the "Add a mapping" box in that modal —
just type the exact territory value ShedPro will send.

> The historical 686 seeded contacts were assigned once by **state** (they predate territory data).
> Territory routing applies to leads arriving from ShedPro going forward.

## Notes & gotchas

- **Common errors**
  - `401 / "Invalid API key"` → wrong key, or the `Authorization` header isn't `Bearer <key>`.
    Both `apikey` and `Authorization` must carry the **service_role** key.
  - `400 / "no unique or exclusion constraint matching the ON CONFLICT specification"` → the
    `email` unique index is missing. It must be the plain unique index `contacts_email_key` from
    `MIGRATION_contacts_dedup_by_email.sql` (applied 2026-06-29). (The old `shedpro_id` unique
    index from `MIGRATION_contacts_shedpro_upsert_index.sql` was downgraded to a plain index then.)
  - `405` from the agent proxy / form-encoded body → make sure **Payload Type = json**, not
    form. The body must be JSON.
- **`email` is required for dedup (the conflict key).** If a lead arrives with no email, it inserts a
  new row every sync (NULL emails don't conflict). Email is stored lowercased/trimmed (DB trigger), so
  matching is case-insensitive.
- **Email uniqueness is GLOBAL.** The unique index covers ALL contacts (manual + every builder). If the
  same email ever arrives for two builders, the second sync MERGES onto the first row (and the
  auto-assign trigger could move ownership). None existed at switch time; "one person = one contact" is
  usually what you want.
- **Email is mutable.** If a customer changes their email in ShedPro, a re-sync inserts a NEW row rather
  than updating the old one (the old email no longer matches). De-dup by hand if it happens.
- **Why not `shedpro_id`?** It used to be the dedup key, but ShedPro sends a real id for very few leads
  and sometimes the junk value `'0'` — every `'0'` collapsed onto one row and silently OVERWROTE it
  (Zapier reported HTTP 200 but no new contact appeared — that's how a lead could "run in Zapier" yet be
  missing). `shedpro_id` is still stored; the `contacts_normalize_shedpro_id` trigger still coerces
  blank/`'0'` → NULL. See `MIGRATION_contacts_normalize_shedpro_id.sql` and
  `MIGRATION_contacts_dedup_by_email.sql`.
- **Seed vs. live overlap.** The 686 rows seeded on 2026-06-25 have `shedpro_id = NULL`. A
  customer who was in that seed AND comes through Zapier will appear twice (the seed row won't
  match by shedpro_id). That's expected; clean up later if needed, or one-time backfill
  shedpro_id onto the seed rows.
- **Assigning an owner.** To route a lead to a specific builder instead of leaving it
  admin-only, add `user_id` to the Data with that builder's `profiles.id` (a UUID). Routing by
  market/zip would be a later enhancement (e.g. a Zapier Lookup table or a Supabase Edge
  Function); not built yet.
