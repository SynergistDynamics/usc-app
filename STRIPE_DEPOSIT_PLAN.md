# Plan — Stripe deposit → mark shed sold + notify builder

> **Status: PLAN ONLY (for review).** No code written yet. This describes how to build the
> "customer paid their deposit" half of the Stripe flow. Review/approve before we build, then this
> doc gets folded into `CONTEXT.md` / a `STRIPE_DEPOSIT.md` setup guide like the other integrations.

## What we're building

You already have the **first half**: a ShedPro design comes in → a Zap creates a Stripe Checkout
Session link for **25% of the shed total** and emails the customer so they can pay a deposit.

This plan is the **second half**: when the customer actually **pays** that deposit through Stripe,
the app should automatically —

1. **Mark the shed sold** (`projects.status = 'sold'`, stamp `sold_at`),
2. **Record the deposit amount** (`projects.deposit` = the amount Stripe actually collected), and
3. **Email the builder** that a deposit was received and the shed is sold.

## Why this is a small build (most of it already exists)

- The `projects` table already has `deposit`, `status` (with a `sold` value + the milestone
  pipeline), and `sold_at`. **No new core fields are needed** to mark a shed sold or store the deposit.
- The design is **already in the app before payment** — `shedpro-project-sync` writes each ShedPro
  design into `projects` as it comes in. So when the deposit is paid, the row to update almost always
  already exists.
- You already send email through **Resend** (`info@urban-sheds.com`) and already have a working
  **Edge Function** pattern (`shedpro-project-sync`) and Zapier patterns to copy.

## The one real problem: matching the payment back to the right shed

Stripe's "payment completed" event has no idea about your `projects` table. We solve this by
**tagging the Checkout Session with the project's identity when it's created**, so Stripe hands that
identity back to us at payment time.

**Change to the EXISTING Zap** (the one that creates the Checkout Session link) — set, on the Stripe
"Create Checkout Session" action:

- `client_reference_id` = the ShedPro **Id** (this is `projects.shedpro_project_id` — our dedup key),
- `metadata[project_number]` = ShedPro Reference Order Num,
- `metadata[customer_email]` = Billing Email.

All three are already available on the ShedPro trigger at the moment the session is created. That's
the only change to your current flow.

> `client_reference_id` is a dedicated Stripe field meant exactly for "your own id for this checkout,"
> so it's the primary match key; the metadata fields are fallbacks.

## The new piece — a Stripe webhook handler

When the deposit is paid, Stripe fires a **`checkout.session.completed`** event. We handle it in a new
Supabase **Edge Function** (`stripe-deposit-paid`), mirroring `shedpro-project-sync`:

1. **Verify the event is really from Stripe** — check the `stripe-signature` header against the
   webhook **signing secret**. (This is why an Edge Function beats a plain Zap for the *money* event:
   a forged "paid" event can't mark sheds sold or invent deposits.)
2. **Ignore everything except** `checkout.session.completed` with `payment_status = 'paid'` (return
   `200` so Stripe stops retrying).
3. **Find the project**: by `client_reference_id` → `shedpro_project_id`; fallback `project_number`;
   fallback most-recent unsold project for `customer_email`.
4. **Idempotency**: if this Stripe session was already processed, stop (Stripe can deliver an event
   more than once). Tracked via a new `stripe_session_id` column.
5. **Update the project**: `status = 'sold'`, `sold_at = now()` (only if not already set),
   `deposit = amount Stripe collected` (read `amount_total` from the event — do **not** recompute 25%),
   `deposit_paid_at = now()`, `stripe_session_id = <id>`.
6. **Email the builder** via Resend: "Deposit received — {shed name} #{order#} is now sold,"
   with the amount and a link to the project. CC the admin. If the project has no linked builder
   (contact not yet matched), email the admin only.
7. **No match at all** → email the admin "a deposit was paid but no matching project was found"
   (so a payment is never silently lost) and return `200`.

Builder lookup: `projects.contact_id` → `contacts.user_id` → `profiles.email` (the same ownership
chain the app already uses). Admin fallback when there's no contact/owner.

## Schema change (one small migration)

Add to `projects` (all nullable, additive — nothing breaks):

```sql
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS deposit_paid_at  timestamptz;

-- idempotency: each Stripe session processed at most once
CREATE UNIQUE INDEX IF NOT EXISTS projects_stripe_session_id_key
  ON public.projects (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
```

`deposit`, `status`, and `sold_at` already exist, so that's the whole migration. (Jeremy runs this in
the Supabase SQL Editor before the function goes live — same as every other migration.)

## ⚠️ Gotcha to fix at the same time: ShedPro re-sync must not clobber the paid deposit

`shedpro-project-sync` currently writes `deposit` (from ShedPro) on **every** update. After a real
deposit is paid, a later ShedPro re-sync of the same design would **overwrite the paid amount** with
ShedPro's figure (often 0 or the quoted amount). It already omits `status`/`sold_at`/`contact_id` on
update for the same reason — we'll **add `deposit`, `stripe_session_id`, and `deposit_paid_at` to that
"don't touch on update" list** so a re-sync can't undo a real payment. (One small edit to the existing
Edge Function, included in this build.)

## Secrets / config Jeremy sets (stated up front, like the service-key gotcha)

- **Supabase Edge Function env:**
  - `STRIPE_WEBHOOK_SECRET` = the `whsec_…` signing secret from the Stripe webhook endpoint.
  - `RESEND_API_KEY` = a Resend API key (to send the builder email). *(Or we skip Resend and send the
    notification from a Zapier email step instead — see "Open choice" below.)*
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`) — already used by the other function.
  - (We do **not** need the Stripe secret key `sk_…` — the event carries the amount, and signature
    verification only needs the webhook secret.)
- **Stripe Dashboard → Developers → Webhooks → Add endpoint:**
  - URL = `https://ywboyreznmuaddprkycm.supabase.co/functions/v1/stripe-deposit-paid`
  - Event = `checkout.session.completed`
  - Copy its signing secret → that's `STRIPE_WEBHOOK_SECRET`.

## Edge cases handled

- **Event delivered twice** → idempotent via `stripe_session_id` unique index.
- **Design paid before it synced into the app** → admin gets a "no matching project" email; nothing lost.
- **Customer has several quote revisions on one email** → match `project_number` first, else the most
  recent unsold one.
- **Project not yet linked to a builder** → notify admin (the app already auto-links by email when the
  contact exists, so this is rare).
- **Partial/abandoned checkout** → ignored (only `payment_status = 'paid'` is acted on).

## Build steps (once approved)

1. Migration above (Jeremy runs it; confirm before relying on it).
2. New Edge Function `stripe-deposit-paid` (verify signature → find project → mark sold + record
   deposit → email builder). `verify_jwt = false`.
3. Edit `shedpro-project-sync` so the update path no longer overwrites `deposit` /
   `stripe_session_id` / `deposit_paid_at`.
4. Add the Stripe webhook endpoint + env secrets (Jeremy, in Stripe + Supabase).
5. Update the existing "create Checkout Session" Zap to set `client_reference_id` + metadata.
6. Test with Stripe's test-mode checkout; verify the project flips to **sold**, the deposit shows on
   the work order, and the builder email arrives.
7. Update docs (`CONTEXT.md`, a `STRIPE_DEPOSIT.md` setup guide) — per the repo's keep-docs-current rule.

## Open choice for Jeremy

**Where the builder email is sent from:**
- **From the Edge Function via Resend** (recommended) — one self-contained handler, signature-verified,
  consistent. Needs a `RESEND_API_KEY`.
- **From a Zapier email/Gmail step** — if you'd rather keep email in Zapier. Then the Edge Function just
  updates the project and a separate Zap (Stripe "Checkout Session Completed" trigger) sends the email.
  Slightly more moving parts but no Resend key needed.
</content>
</invoke>
