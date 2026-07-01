# Stripe deposit → mark shed sold + notify builder (setup guide)

> **STATUS: LIVE & verified 2026-07-01.** End-to-end test: a real deposit on project #5888 flipped it
> to **sold**, recorded the deposit, stamped `sold_at`/`deposit_paid_at`/`stripe_session_id`, and
> emailed the builder. The steps below reflect how it's actually wired.

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

> **⚠️ This is a Stripe CONNECT setup.** The deposit is a **direct charge on the builder's connected
> account** (the builder is the merchant of record) with an `application_fee_amount` going to the USC
> platform account. Because the charge lives on the connected account, the `checkout.session.completed`
> event fires **on the connected account** — so the webhook endpoint MUST be a **Connected accounts**
> destination (a "Your account" endpoint would never see it). Signature verification, matching, and the
> function are otherwise identical; the event just carries an extra top-level `account` (`acct_…`) the
> function ignores (it matches projects against our own DB).

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

The live deposit Zap ("ShedPro to Proposal Email") creates the session with a **`POST` to
`https://api.stripe.com/v1/checkout/sessions`** via **Webhooks by Zapier** (Payload Type = **Form**),
with a `Stripe-Account: acct_…` header (that's what makes it a direct charge on the builder's connected
account) and `payment_intent_data[application_fee_amount]` = the USC fee. Add these **session-level**
rows to that step's **Data** list (Stripe form syntax):

| Data key (left) | Value (from the ShedPro trigger) |
|---|---|
| `client_reference_id` | ShedPro **Id** (the unique record id — the same field the projects-sync Zap maps to `id`; becomes `projects.shedpro_project_id`) |
| `metadata[type]` | the literal `shed_deposit` |
| `metadata[project_number]` | ShedPro **Reference Order Num** |
| `metadata[customer_email]` | **Billing Email** |

> **CRITICAL — session level, not payment_intent_data.** The webhook receives the **Checkout Session**,
> so the tags must be top-level `client_reference_id` / `metadata[...]`. The Zap's pre-existing
> `payment_intent_data[metadata][...]` rows land on the *PaymentIntent* and are **NOT** visible to the
> function — don't put our tags there.

`client_reference_id` is the primary match key; the metadata are fallbacks. **`type=shed_deposit`
is what marks the checkout as a shed deposit** — the function IGNORES any `checkout.session.completed`
that has none of these tags, so your other Stripe payments (see below) are never touched. Setting at
least `client_reference_id` OR `metadata[type]=shed_deposit` is required for the function to act.

## Step 5 — Register the Stripe webhook (Connected accounts destination)

Stripe Dashboard → **Developers → Webhooks** (a.k.a. **Event destinations**) → **Add endpoint /
destination**:

- **Events from:** **Connected accounts** ← REQUIRED (the deposit event fires on the builder's account,
  not the platform — see the Connect note at the top).
- **Endpoint URL:** `https://ywboyreznmuaddprkycm.supabase.co/functions/v1/stripe-deposit-paid`
- **Events:** `checkout.session.completed` (search under "All events").
- After creating it, **Reveal** the signing secret → paste that `whsec_…` into `STRIPE_WEBHOOK_SECRET`
  (Step 3).

The live endpoint is named **`urban_supabase`** (destination id `we_…`). Note: because it's a
Connected-accounts destination, Stripe's dashboard **"Send test event"** may not route to it — do the
real end-to-end test below instead.

## Step 6 — Test end-to-end (how it was verified)

1. Create a ShedPro design with a **tiny total** so the 25% deposit is a couple dollars; let the Zap
   email the checkout link; pay it with a real card (it's a live connected-account charge).
2. The endpoint's **Event deliveries** shows a **200**; Supabase → Edge Function logs show
   `matched:true, marked_sold:true`.
3. Open the project in the app: the milestone stepper shows **Sold**, and the **Deposit (paid)** line
   on the work order shows the amount.
4. The builder (and CC'd admin) receive the "Deposit received" email.
5. **Refund** the test payment on the **connected account**. Re-delivering the same event returns
   `already_processed:true` (idempotency) — it won't re-mark or double-count.

> Verified 2026-07-01 with a $1 deposit on project #5888 (all five checks passed).

---

## Only shed deposits are acted on (other Stripe payments are safe)

The webhook subscribes to `checkout.session.completed` only, and the function then **gates on a shed-
deposit tag** (`client_reference_id` / `metadata.project_number` / `metadata.type='shed_deposit'`). So:

- **Subscription renewals** (recurring $1,495/mo license charges) fire `invoice.paid`, not
  `checkout.session.completed` — they never reach the function.
- **One-time Payment Links** (the $499 onboarding fee, the $1,495 license activation) and
  **subscription signups** DO fire `checkout.session.completed`, but they carry none of the shed-deposit
  tags, so the function returns `{"ignored":"not a shed deposit"}` — **no email, no project change.**
- A bare customer email is deliberately NOT treated as a marker (that would risk a license payer who
  shares an email with a shed customer wrongly marking that shed sold).

This is why the Zap MUST set `client_reference_id` (and ideally `metadata.type=shed_deposit`) — it's
both the match key and the "this is a real shed deposit" signal.

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
