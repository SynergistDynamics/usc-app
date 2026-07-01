# Stripe deposit → mark shed sold + notify builder (setup guide)

When a ShedPro design comes in, a Zap already creates a **Stripe Checkout Session** link for 25% of
the shed total and emails the customer so they can pay a deposit. This integration handles the
**other end**: when the customer actually **pays**, the app marks the shed **sold**, records the
**deposit amount** Stripe collected, and **emails the builder**.

```
Customer pays Stripe deposit  →  Stripe webhook (checkout.session.completed)
                              →  Edge Function `stripe-deposit-paid`
                              →  projects: status=sold, deposit=amount, sold_at, deposit_paid_at
                              →  email the builder (CC admin) via Resend
```

No app (React) code — the function writes straight to `projects`; the app just reads it.

---

## How the payment is matched to the right shed

Stripe's event doesn't know your `projects` table. The Checkout Session is **tagged with the
project's identity when it's created**, and Stripe hands that back at payment time. The function
matches (in order): `client_reference_id` → `projects.shedpro_project_id`, then
`metadata.project_number` → `projects.project_number`, then `metadata.customer_email` /
`customer_details.email` → the most-recent unsold project for that email. No match → the admin is
emailed so a payment is never silently lost.

---

## Step 1 — Migration (Jeremy runs once)

Run `MIGRATION_projects_stripe_deposit.sql` in the Supabase SQL Editor. It adds
`projects.stripe_session_id` (also the idempotency key — each Stripe session processed at most once)
and `projects.deposit_paid_at`. The amount lands in the existing `projects.deposit`; the sale uses the
existing `status`/`sold_at`. Confirm it ran before going live.

## Step 2 — Deploy the Edge Function

Deploy `supabase/functions/stripe-deposit-paid` (`verify_jwt = false` — it's a Stripe webhook; the
real check is the Stripe signature on every request). URL:

```
https://ywboyreznmuaddprkycm.supabase.co/functions/v1/stripe-deposit-paid
```

`?dry_run=1` returns the computed match **without** verifying the signature or writing — handy for
testing the matching against a sample event body.

## Step 3 — Edge Function secrets (Supabase → Project Settings → Edge Functions → Secrets)

| Secret | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` signing secret from the Stripe webhook endpoint (Step 5) |
| `RESEND_API_KEY` | a Resend API key (sends the builder email). Without it the function still marks the shed sold — it just skips the email and logs a warning. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | already present (the `sb_secret_…` key, same as `shedpro-project-sync`) |
| `MAIL_FROM` *(optional)* | defaults to `Urban Sheds Collective <info@urban-sheds.com>` |
| `APP_URL` *(optional)* | defaults to `https://build.urban-sheds.com` (used for the project link in the email) |
| `ADMIN_NOTIFY_EMAIL` *(optional)* | comma-separated admin recipient(s) for the CC + the "no match" alert. If unset, the function emails all `profiles` where `role='admin'` or `is_super_admin`. |

We do **not** need the Stripe secret key (`sk_…`) — the event carries the amount, and signature
verification only needs the webhook secret.

## Step 4 — Tag the Checkout Session (change to the EXISTING deposit Zap)

On the **"Create Checkout Session"** Stripe action in the Zap that makes the deposit link, set:

| Field | Value (from the ShedPro trigger) |
|---|---|
| `Client Reference ID` | ShedPro **Id** (the same value that becomes `projects.shedpro_project_id`) |
| `Metadata` → `project_number` | ShedPro **Reference Order Num** |
| `Metadata` → `customer_email` | **Billing Email** |

All three are available on the trigger when the session is created. `client_reference_id` is the
primary match key; the metadata are fallbacks.

> If the deposit link is created some other way (a Payment Link, or code), just make sure the
> resulting Checkout Session carries `client_reference_id = <ShedPro Id>` (and ideally the metadata).

## Step 5 — Register the Stripe webhook

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **Endpoint URL:** `https://ywboyreznmuaddprkycm.supabase.co/functions/v1/stripe-deposit-paid`
- **Events:** `checkout.session.completed`
- After creating it, click **Reveal** on the signing secret → paste that `whsec_…` into
  `STRIPE_WEBHOOK_SECRET` (Step 3).

Do this in **both** Stripe test mode and live mode (each has its own endpoint + signing secret) if you
want to test with test-mode checkouts first.

## Step 6 — Test end-to-end

1. In **test mode**, complete a Checkout for a session tagged with a real project's ShedPro Id (use
   Stripe's test card `4242 4242 4242 4242`).
2. Stripe → Webhooks → your endpoint should show a **200**. Supabase → Edge Function logs show
   `matched:true, marked_sold:true`.
3. Open the project in the app: the milestone stepper shows **Sold**, and the **Deposit (paid)** line
   on the work order shows the amount.
4. The builder (and CC'd admin) receive the "Deposit received" email.
5. Re-send the same event from Stripe → the function returns `already_processed:true` and does nothing
   (idempotency).

---

## Notes & gotchas

- **Signature is the auth.** A request with a bad/missing `stripe-signature` gets `400`. The function
  also rejects events whose timestamp is more than 5 minutes off (replay guard).
- **Idempotency.** Stripe can deliver an event more than once. The first time records
  `stripe_session_id`; repeats short-circuit (and the unique index backstops a concurrent double).
- **ShedPro re-sync won't wipe the paid deposit.** `shedpro-project-sync` was updated to **omit
  `deposit`** (along with the status/sold_at/contact_id it already omits) on an UPDATE, so a later
  ShedPro re-sync of the same design can't overwrite the amount Stripe collected.
- **Only paid checkouts act.** The function ignores any `checkout.session.completed` whose
  `payment_status` isn't `paid`, and ignores every other event type (returns `200` so Stripe stops
  retrying).
- **No builder linked yet?** If the project isn't linked to a contact/owner (rare — the app
  auto-links by email), the "Deposit received" email goes to the admin instead.
- **Amount source.** The deposit stored is `amount_total` from the event (÷100 for cents) — what
  Stripe actually collected — not a recomputed 25%.
