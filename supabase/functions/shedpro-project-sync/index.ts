// supabase/functions/shedpro-project-sync
// Receives a ShedPro project (forwarded by Zapier) and upserts it into public.projects,
// translating the configurator selections into the app spec + selected_packages. See ZAPIER_PROJECTS.md.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const SIDING: Record<string, string> = {
  "lp lap": "Clapboard", "lp smart": "T1-11", "t1-11": "T1-11", "t1 11": "T1-11",
  "board & batten": "B&B", "board and batten": "B&B", "b&b": "B&B", "western red cedar": "Western Red Cedar",
};
const STATUS: Record<string, string> = { "quote-request": "quoted", "quote": "quoted", "quote-requested": "quoted" };

const S = (v: unknown) => (v == null ? "" : String(v)).trim();
const L = (v: unknown) => S(v).toLowerCase();
const num = (v: unknown) => { const n = parseFloat(S(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
function asArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const vals = Object.values(v as Record<string, unknown>);
    if (vals.length && vals.every((x) => x && typeof x === "object")) return vals as any[];
    return [v];
  }
  return [];
}
function getPath(obj: any, path: string) { return path.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj); }
function pick(obj: any, ...paths: string[]) {
  for (const p of paths) { const v = getPath(obj, p); if (v !== undefined && v !== null && v !== "") return v; }
  return undefined;
}
const splitArr = (v: unknown): string[] =>
  v == null || v === "" ? [] : (Array.isArray(v) ? v.map(S) : String(v).split(/,(?!\s)/).map((x) => x.trim()));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  if (!dryRun) {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const secret = S(req.headers.get("x-sync-secret"));
    if (bearer !== SERVICE_KEY && secret !== SERVICE_KEY) return json({ error: "unauthorized" }, 401);
  }
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  console.log("shedpro-sync raw body:", JSON.stringify(body).slice(0, 6000));

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const bd = body.building_details || body.buildingDetails || body;
  const billing = body.billing || {};

  const flatArr = (prefix: string, keys: string[]) => {
    const cols = keys.map((k) => splitArr((body as any)[`${prefix}_${k}`]));
    const n = Math.max(0, ...cols.map((c) => c.length));
    const out: any[] = [];
    for (let i = 0; i < n; i++) { const o: any = {}; keys.forEach((k, j) => (o[k] = cols[j][i])); out.push(o); }
    return out;
  };
  const setIfEmpty = (key: string, prefix: string, keys: string[]) => {
    if (!asArray(getPath(bd, key)).length) { const a = flatArr(prefix, keys); if (a.length) (bd as any)[key] = a; }
  };
  setIfEmpty("components", "components", ["type", "display", "price", "side", "primary_color"]);
  setIfEmpty("interior_components", "interior", ["type", "display", "price"]);
  setIfEmpty("overhang", "overhang", ["name", "price"]);
  setIfEmpty("loft", "loft", ["name", "price"]);
  setIfEmpty("other_upgrades", "upgrades", ["name", "group", "price"]);
  setIfEmpty("images", "images", ["key", "value"]);
  if (!getPath(bd, "frame")) { const a = flatArr("frame", ["name", "price"]); if (a.length) (bd as any).frame = a; }
  if (!billing.email && body.billing_email) billing.email = body.billing_email;
  if (!billing.first_name && body.billing_first_name) billing.first_name = body.billing_first_name;
  if (!billing.last_name && body.billing_last_name) billing.last_name = body.billing_last_name;

  const description = S(pick(bd, "description"));
  const width = pick(bd, "size.width", "size_width");
  const length = pick(bd, "size.length", "size_length");
  const shedSize = width && length ? `${S(width)}x${S(length)}` : null;
  const sidingRaw = S(pick(bd, "siding.material", "siding_material"));
  const siding = SIDING[L(sidingRaw)] ?? (sidingRaw || null);
  const sidingColor = S(pick(bd, "siding.color", "base_color", "siding_color")) || null;
  const trimColor = S(pick(bd, "trim.color", "trim_color")) || null;
  const roofColor = S(pick(bd, "roof.color", "roof_color")) || null;
  const roof = S(pick(bd, "roof.material_display", "roof_material_display", "roof_material", "roof.material")) || null;
  const salePrice = num(pick(body, "total", "subtotal")) ?? num(pick(bd, "price"));
  // Shed deposit / down payment from ShedPro (shown above the sale price on the work
  // order). Tolerant of several key names — add a `deposit=<ShedPro Deposit>` Input Data
  // row in the Zap so this field is forwarded (see ZAPIER_PROJECTS.md).
  const deposit = num(pick(body, "deposit", "deposit_amount", "deposit_total", "down_payment")) ?? num(pick(bd, "deposit", "deposit_amount"));
  const detailsUrl = S(pick(bd, "model_url")) || null;
  const projectNumber = S(pick(body, "reference_order_num", "reference_order_number")) || null;
  const dedupId = S(pick(body, "_id", "id", "Id", "shedpro_project_id")) || null;
  const customerEmail = S(pick(billing, "email")) || null;
  const billingName = [S(pick(billing, "first_name")), S(pick(billing, "last_name"))].filter(Boolean).join(" ");
  const notes = S(pick(body, "customer_note", "details_note")) || null;
  const shedproCreated = S(pick(body, "date_created")) || null;
  const statusRaw = L(pick(body, "status"));

  const [{ data: styleRows }, { data: specialRows }, { data: mapRows }] = await Promise.all([
    supa.from("packages").select("id,name").eq("is_style", true),
    supa.from("packages").select("id,name").in("name", ["Loft Modern", "Loft Traditional", "Paint"]),
    supa.from("shedpro_option_map").select("category,shedpro_value,package_id"),
  ]);
  const stylePkg = (styleRows || []).find((p) => L(p.name) === L(description));
  const stylePackageId = stylePkg?.id || null;

  const M = new Map<string, string>();
  for (const r of mapRows || []) M.set(`${L(r.category)} ${L(r.shedpro_value)}`, r.package_id);

  const selected: Record<string, number> = {};
  const unmapped: string[] = [];
  const rawOptions: any[] = [];
  const addPkg = (pid: string | undefined, qty: number) => { if (!pid) return; selected[pid] = (selected[pid] || 0) + (qty || 1); };
  const addByMap = (category: string, value: string, qty: number) => {
    const pid = M.get(`${L(category)} ${L(value)}`);
    if (!pid) { if (value) unmapped.push(`${category} / ${value}`); return; }
    addPkg(pid, qty);
  };

  for (const c of asArray(pick(bd, "components"))) {
    const type = S(pick(c, "type")), display = S(pick(c, "display"));
    rawOptions.push({ group: type, label: display, price: S(pick(c, "price")), side: S(pick(c, "side")) });
    addByMap(type, display, 1);
  }
  for (const c of asArray(pick(bd, "interior_components"))) {
    const type = S(pick(c, "type")), display = S(pick(c, "display"));
    rawOptions.push({ group: type, label: display, price: S(pick(c, "price")), side: S(pick(c, "side")) });
    addByMap(type, display, 1);
  }
  for (const o of asArray(pick(bd, "overhang"))) {
    const name = S(pick(o, "name"));
    rawOptions.push({ group: "Roof Overhang", label: name, price: S(pick(o, "price")) });
    addByMap("overhang", name, num(pick(o, "quantity")) || 1);
  }
  for (const f of asArray(pick(bd, "frame"))) {
    const name = S(pick(f, "name"));
    if (!name) continue;
    rawOptions.push({ group: "Frame", label: name, price: S(pick(f, "price")) });
    if (/painted/i.test(name)) addByMap("frame", name, 1);
  }
  for (const u of asArray(pick(bd, "other_upgrades"))) {
    const group = S(pick(u, "group")), name = S(pick(u, "name"));
    rawOptions.push({ group, label: name, price: S(pick(u, "price")) });
    addByMap(group, name, num(pick(u, "quantity")) || 1);
  }
  const loftArr = asArray(pick(bd, "loft"));
  if (loftArr.length) {
    const loftName = /modern/i.test(description) ? "Loft Modern" : "Loft Traditional";
    const loftPid = (specialRows || []).find((p) => p.name === loftName)?.id;
    for (const o of loftArr) {
      rawOptions.push({ group: "Loft", label: S(pick(o, "name")), price: S(pick(o, "price")) });
      addPkg(loftPid, num(pick(o, "quantity")) || 1);
    }
  }

  const sidingColorPrice = S(pick(bd, "siding.color_price", "siding_color_price"));
  if (sidingColor && L(siding) !== "western red cedar") {
    const paintPid = (specialRows || []).find((p) => p.name === "Paint")?.id;
    rawOptions.push({ group: "Siding Color (Paint)", label: sidingColor, price: sidingColorPrice });
    addPkg(paintPid, 1);
  }

  let doorColor: string | null = null;
  for (const c of asArray(pick(bd, "components"))) {
    if (L(pick(c, "type")) === "door") {
      doorColor = S(pick(c, "primary_color")) || S(getPath(asArray(pick(c, "colors"))[0], "display")) || null;
      break;
    }
  }

  // ---- renderings (images[] key -> value url) ----
  // ShedPro sends six views: perspective, front, left, right, back, 2d floor plan.
  // Perspective (the angled hero shot) gets its OWN column -- it is what the card lists
  // show. Previously "front" overwrote slot 1 and perspective was dropped entirely.
  const imgByKey: Record<string, string> = {};
  for (const im of asArray(pick(bd, "images"))) imgByKey[L(pick(im, "key"))] = S(pick(im, "value"));
  const renderings = {
    perspective_rendering_url: imgByKey["perspective"] || null,
    rendering_url_1: imgByKey["front"] || null,
    rendering_url_2: imgByKey["left"] || null,
    rendering_url_3: imgByKey["right"] || null,
    rendering_url_4: imgByKey["back"] || null,
    layout_rendering_url: imgByKey["2d floor plan"] || imgByKey["floor plan"] || null,
  };

  const baseName = (shedSize && description) ? `${shedSize} ${description}`
    : (description || shedSize || billingName || "");
  const name = baseName
    ? (projectNumber ? `${baseName} #${projectNumber}` : baseName)
    : (projectNumber ? `Design #${projectNumber}` : "ShedPro project");

  const payload: Record<string, unknown> = {
    source: "zapier", shedpro_project_id: dedupId, project_number: projectNumber, name,
    shed_style: description || null, style_package_id: stylePackageId, siding, shed_size: shedSize,
    customer_email: customerEmail, sale_price: salePrice, deposit, notes, shedpro_created: shedproCreated,
    siding_color: sidingColor, trim_color: trimColor, roof_color: roofColor, door_color: doorColor,
    roof, details_url: detailsUrl, selected_packages: selected, shedpro_options: rawOptions, ...renderings,
  };
  const appStatus = STATUS[statusRaw] || "quoted";

  if (dryRun) {
    return json({ dry_run: true, resolved: { style_package_id: stylePackageId, siding, shed_size: shedSize, sale_price: salePrice },
      selected_packages: selected, selected_count: Object.values(selected).reduce((a, b) => a + b, 0), unmapped, insert_status: appStatus, payload });
  }

  let existingId: string | null = null;
  if (dedupId) {
    const { data: ex } = await supa.from("projects").select("id").eq("shedpro_project_id", dedupId).maybeSingle();
    existingId = ex?.id || null;
  }
  let result;
  if (existingId) {
    // On UPDATE, don't clobber fields the app/Stripe own after a deposit is paid: `deposit`
    // (the amount Stripe actually collected), `stripe_session_id`, `deposit_paid_at`. A later
    // ShedPro re-sync would otherwise overwrite the paid deposit with ShedPro's quote figure.
    // (status/sold_at/contact_id are already left out of `payload` for the same reason.)
    const { deposit: _d, ...updatePayload } = payload as Record<string, unknown>;
    result = await supa.from("projects").update(updatePayload).eq("id", existingId).select("id").single();
  } else {
    result = await supa.from("projects").insert({ ...payload, status: appStatus }).select("id").single();
  }
  if (result.error) { console.error("shedpro-sync write error:", result.error); return json({ error: result.error.message }, 500); }
  return json({ ok: true, project_id: result.data.id, action: existingId ? "updated" : "inserted", selected_packages: selected, unmapped });
});
