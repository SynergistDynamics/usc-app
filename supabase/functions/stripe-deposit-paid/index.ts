// supabase/functions/stripe-deposit-paid
// Stripe webhook: fires when a customer PAYS their shed deposit through a Stripe Checkout
// Session. It verifies the Stripe signature, finds the matching project, marks it SOLD,
// records the deposit amount that was actually collected, and emails the builder (CC admin).
// See STRIPE_DEPOSIT.md for the full setup + the Zap change that tags the session with the
// project id.
//
// AUTH: this is a Stripe webhook (verify_jwt=false). The real check is the Stripe SIGNATURE
// on every request (STRIPE_WEBHOOK_SECRET) — a forged "paid" event can't mark sheds sold.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Urban Sheds Collective <info@urban-sheds.com>";
const APP_URL = Deno.env.get("APP_URL") || "https://build.urban-sheds.com";
// Optional explicit admin recipient(s); falls back to admins in `profiles`.
const ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") || "";

const S = (v: unknown) => (v == null ? "" : String(v)).trim();
const L = (v: unknown) => S(v).toLowerCase();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ---- Stripe signature verification (Web Crypto, no SDK) ----
// Header: `t=<unix>,v1=<hex sig>[,v1=<hex sig>...]`; signed payload = `${t}.${rawBody}`.
const enc = new TextEncoder();
function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }),
  ) as Record<string, string>;
  const t = parts["t"];
  const v1 = sigHeader.split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  if (!t || !v1.length) return false;
  // Replay guard: reject events whose timestamp is too far from now.
  const ts = parseInt(t, 10);
  if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
  return v1.some((sig) => timingSafeEqual(sig, mac));
}

async function sendEmail(to: string[], subject: string, html: string, cc: string[] = []) {
  const recipients = Array.from(new Set(to.map(L).filter(Boolean)));
  if (!recipients.length) return { skipped: "no recipients" };
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY not set — skipping email to", recipients); return { skipped: "no RESEND_API_KEY" }; }
  const ccList = Array.from(new Set(cc.map(L).filter(Boolean))).filter((e) => !recipients.includes(e));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: recipients, ...(ccList.length ? { cc: ccList } : {}), subject, html }),
  });
  const txt = await res.text();
  if (!res.ok) console.error("Resend error", res.status, txt);
  return { status: res.status, body: txt.slice(0, 500) };
}

const money = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";

  const raw = await req.text();
  if (!dryRun) {
    const ok = await verifyStripeSignature(raw, S(req.headers.get("stripe-signature")), STRIPE_WEBHOOK_SECRET);
    if (!ok) return json({ error: "invalid signature" }, 400);
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }

  // Only act on a completed, PAID checkout. Everything else is acknowledged (200) so Stripe stops retrying.
  if (event?.type !== "checkout.session.completed") return json({ ignored: event?.type || "unknown" });
  const session = event?.data?.object || {};
  if (L(session.payment_status) && L(session.payment_status) !== "paid") return json({ ignored: "unpaid", payment_status: session.payment_status });

  const sessionId = S(session.id) || null;
  const shedproProjectId = S(session.client_reference_id) || S(session.metadata?.shedpro_project_id) || null;
  const projectNumber = S(session.metadata?.project_number) || null;
  const customerEmail = L(session.metadata?.customer_email) || L(session.customer_details?.email) || L(session.customer_email) || null;
  // amount_total is in the currency's minor unit (cents for USD).
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const depositAmount = amountTotal != null ? Math.round(amountTotal) / 100 : null;

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- find the project: shedpro id → order number → most-recent unsold by email ----
  const cols = "id,contact_id,status,sold_at,deposit,stripe_session_id,name,project_number,shedpro_project_id,customer_email,sale_price";
  async function findProject() {
    if (shedproProjectId) {
      const { data } = await supa.from("projects").select(cols).eq("shedpro_project_id", shedproProjectId).maybeSingle();
      if (data) return { project: data, matchedBy: "shedpro_project_id" };
    }
    if (projectNumber) {
      const { data } = await supa.from("projects").select(cols).eq("project_number", projectNumber)
        .order("created_at", { ascending: false }).limit(1);
      if (data && data[0]) return { project: data[0], matchedBy: "project_number" };
    }
    if (customerEmail) {
      // Prefer a not-yet-sold project for this customer; newest first.
      const { data } = await supa.from("projects").select(cols).eq("customer_email", customerEmail)
        .not("status", "in", "(sold,scheduled,completed)").order("created_at", { ascending: false }).limit(1);
      if (data && data[0]) return { project: data[0], matchedBy: "customer_email" };
      const { data: anyProj } = await supa.from("projects").select(cols).eq("customer_email", customerEmail)
        .order("created_at", { ascending: false }).limit(1);
      if (anyProj && anyProj[0]) return { project: anyProj[0], matchedBy: "customer_email(any)" };
    }
    return { project: null, matchedBy: null as string | null };
  }

  const { project, matchedBy } = await findProject();

  // Admin recipients (fallback notifications).
  async function adminEmails(): Promise<string[]> {
    if (ADMIN_NOTIFY_EMAIL) return ADMIN_NOTIFY_EMAIL.split(",").map(S).filter(Boolean);
    const { data } = await supa.from("profiles").select("email,role,is_super_admin");
    return (data || []).filter((p: any) => p.role === "admin" || p.is_super_admin).map((p: any) => S(p.email)).filter(Boolean);
  }

  if (dryRun) {
    return json({ dry_run: true, matchedBy, sessionId, shedproProjectId, projectNumber, customerEmail, depositAmount,
      project: project ? { id: project.id, name: project.name, status: project.status } : null });
  }

  // ---- no match: alert admin, don't lose the payment ----
  if (!project) {
    const admins = await adminEmails();
    await sendEmail(admins, "⚠️ Stripe deposit paid — no matching project",
      `<p>A Stripe deposit of <b>${money(depositAmount)}</b> was paid, but no matching project was found.</p>
       <ul><li>Customer email: ${customerEmail || "—"}</li><li>Order #: ${projectNumber || "—"}</li>
       <li>ShedPro id: ${shedproProjectId || "—"}</li><li>Stripe session: ${sessionId || "—"}</li></ul>
       <p>Find the design in the app and mark it sold manually.</p>`);
    console.warn("stripe-deposit-paid: no matching project", { sessionId, shedproProjectId, projectNumber, customerEmail });
    return json({ ok: true, matched: false, notified_admins: admins.length });
  }

  // ---- idempotency: this session already recorded on this project ----
  if (sessionId && S(project.stripe_session_id) === sessionId) {
    return json({ ok: true, already_processed: true, project_id: project.id });
  }

  // ---- mark sold + record deposit ----
  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: "sold",
    sold_at: project.sold_at || nowIso,           // don't overwrite an existing sold date
    deposit_paid_at: nowIso,
    stripe_session_id: sessionId,
  };
  if (depositAmount != null) update.deposit = depositAmount;   // the amount Stripe actually collected

  const { error: upErr } = await supa.from("projects").update(update).eq("id", project.id);
  if (upErr) {
    // Unique-violation on stripe_session_id = a concurrent duplicate delivery; treat as done.
    if (S(upErr.code) === "23505") return json({ ok: true, already_processed: true, project_id: project.id });
    console.error("stripe-deposit-paid update error:", upErr);
    return json({ error: upErr.message }, 500);
  }

  // ---- builder lookup (project → contact → owner profile) ----
  let builderEmail = "", builderName = "";
  if (project.contact_id) {
    const { data: contact } = await supa.from("contacts").select("user_id").eq("id", project.contact_id).maybeSingle();
    if (contact?.user_id) {
      const { data: prof } = await supa.from("profiles").select("email,full_name").eq("id", contact.user_id).maybeSingle();
      builderEmail = S(prof?.email); builderName = S(prof?.full_name);
    }
  }
  const admins = await adminEmails();

  const projectUrl = `${APP_URL}/projects/${project.id}`;
  const label = S(project.name) || (project.project_number ? `#${project.project_number}` : "your shed");
  const html =
    `<p>Good news — a deposit was just paid and the shed is now marked <b>SOLD</b>.</p>
     <table cellpadding="4" style="border-collapse:collapse">
       <tr><td><b>Project</b></td><td>${label}</td></tr>
       <tr><td><b>Deposit paid</b></td><td>${money(depositAmount)}</td></tr>
       ${project.sale_price != null ? `<tr><td><b>Sale price</b></td><td>${money(Number(project.sale_price))}</td></tr>` : ""}
       ${customerEmail ? `<tr><td><b>Customer</b></td><td>${customerEmail}</td></tr>` : ""}
     </table>
     <p><a href="${projectUrl}">Open the project in the app →</a></p>`;

  const to = builderEmail ? [builderEmail] : admins;      // no builder linked yet → admin gets it
  const cc = builderEmail ? admins : [];
  const subject = `Deposit received — ${label} is sold`;
  const mail = await sendEmail(to, subject, html, cc);

  return json({ ok: true, matched: true, matchedBy, project_id: project.id, marked_sold: true,
    deposit: depositAmount, builder_emailed: !!builderEmail, mail });
});
