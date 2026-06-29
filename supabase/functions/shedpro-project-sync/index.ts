// supabase/functions/shedpro-project-sync
//
// Receives a ShedPro project (forwarded by Zapier) and upserts it into public.projects,
// translating ShedPro's configurator selections into the app's spec + selected_packages
// so the existing work order and materials engine build automatically.
//
// ShedPro spreads selected options across several arrays (see ZAPIER_PROJECTS.md):
//   building_details.components[]          (type vent|door|windows, by display)
//   building_details.interior_components[] (type workbench|shelf, by display)
//   building_details.overhang[] / loft[]   (by name; loft -> Loft Modern/Traditional by style)
//   building_details.frame                 (by name; only "Painted…" maps)
//   building_details.other_upgrades[]      (by group; hinge/soffit&ridge/flooring/site-prep;
//                                           Building Permit/Access Fees/Travel Charges = non-material -> skipped)
// Each is translated to a package_id via the public.shedpro_option_map table, counting dupes,
// and accumulated into selected_packages {package_id: count}.
//
// AUTH: deployed with verify_jwt=false; the function requires the Supabase service_role key
// in `Authorization: Bearer …` (or `x-sync-secret`) — the same key Zapier already uses for the
// REST upserts. `?dry_run=1` computes + returns the mapping WITHOUT writing and WITHOUT auth
// (no DB writes, no secrets in the response) — for testing.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// ShedPro "Siding Material" -> app projects.siding value
const SIDING: Record<string, string> = {
  "lp lap": "Clapboard",
  "lp smart": "T1-11",
  "t1-11": "T1-11",
  "t1 11": "T1-11",
  "board & batten": "B&B",
  "board and batten": "B&B",
  "b&b": "B&B",
  "western red cedar": "Western Red Cedar",
};
// ShedPro status -> app project status (applied on INSERT only)
const STATUS: Record<string, string> = {
  "quote-request": "quoted",
  "quote": "quoted",
  "quote-requested": "quoted",
};

const S = (v: unknown) => (v == null ? "" : String(v)).trim();
const L = (v: unknown) => S(v).toLowerCase();
const num = (v: unknown) => {
  const n = parseFloat(S(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
function asArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const vals = Object.values(v as Record<string, unknown>);
    if (vals.length && vals.every((x) => x && typeof x === "object")) return vals as any[];
    return [v];
  }
  return [];
}
function getPath(obj: any, path: string) {
  return path.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);
}
function pick(obj: any, ...paths: string[]) {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
const toArr = (v: unknown): any[] => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);
// Zapier joins line items with a BARE comma; natural commas inside a value are
// comma+space. So split on a comma NOT followed by whitespace to recover the items
// (handles names like "Crushed Stone Base (Good for Larger Sheds, Best Drainage)").
const splitArr = (v: unknown): string[] =>
  v == null || v === "" ? [] : (Array.isArray(v) ? v.map(S) : String(v).split(/,(?!\s)/).map((x) => x.trim()));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";

  // Auth (skipped for dry_run, which never writes)
  if (!dryRun) {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const secret = S(req.headers.get("x-sync-secret"));
    if (bearer !== SERVICE_KEY && secret !== SERVICE_KEY) return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  // Ground-truth the wire shape on the first real calls.
  console.log("shedpro-sync raw body:", JSON.stringify(body).slice(0, 6000));

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const bd = body.building_details || body.buildingDetails || body;
  const billing = body.billing || {};

  // Zapier's "Data form" (Webhooks POST) sends each line-item column as its own parallel array,
  // e.g. components_type:[...], components_display:[...], components_price:[...]. If the nested
  // option arrays aren't present, rebuild them (index-aligned) from those flat parallel arrays so
  // the rest of the function works the same for the nested-JSON shape and the Data-form shape.
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
  // billing fallbacks (flat keys at top level)
  if (!billing.email && body.billing_email) billing.email = body.billing_email;
  if (!billing.first_name && body.billing_first_name) billing.first_name = body.billing_first_name;
  if (!billing.last_name && body.billing_last_name) billing.last_name = body.billing_last_name;

  // ---- flat fields ----
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
  const detailsUrl = S(pick(bd, "model_url", "model_url")) || null;
  const projectNumber = S(pick(body, "reference_order_num", "reference_order_number")) || null;
  const dedupId = S(pick(body, "_id", "id", "Id", "shedpro_project_id")) || null;
  const customerEmail = S(pick(billing, "email")) || null;
  const billingName = [S(pick(billing, "first_name")), S(pick(billing, "last_name"))].filter(Boolean).join(" ");
  const notes = S(pick(body, "customer_note", "details_note")) || null;
  const shedproCreated = S(pick(body, "date_created")) || null;
  const statusRaw = L(pick(body, "status"));

  // ---- style package + loft packages ----
  const [{ data: styleRows }, { data: specialRows }, { data: mapRows }] = await Promise.all([
    supa.from("packages").select("id,name").eq("is_style", true),
    supa.from("packages").select("id,name").in("name", ["Loft Modern", "Loft Traditional", "Paint"]),
    supa.from("shedpro_option_map").select("category,shedpro_value,package_id"),
  ]);
  const stylePkg = (styleRows || []).find((p) => L(p.name) === L(description));
  const stylePackageId = stylePkg?.id || null;

  const M = new Map<string, string>();
  for (const r of mapRows || []) M.set(`${L(r.category)} ${L(r.shedpro_value)}`, r.package_id);

  // ---- translate option arrays -> selected_packages ----
  const selected: Record<string, number> = {};
  const unmapped: string[] = [];
  const rawOptions: any[] = []; // audit trail stored in projects.shedpro_options
  const addPkg = (pid: string | undefined, qty: number) => {
    if (!pid) return;
    selected[pid] = (selected[pid] || 0) + (qty || 1);
  };
  const addByMap = (category: string, value: string, qty: number) => {
    const pid = M.get(`${L(category)} ${L(value)}`);
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
    addByMap(group, name, num(pick(u, "quantity")) || 1); // non-material groups have no map rows -> skipped
  }
  // loft is style-dependent (not in the map table)
  const loftArr = asArray(pick(bd, "loft"));
  if (loftArr.length) {
    const loftName = /modern/i.test(description) ? "Loft Modern" : "Loft Traditional";
    const loftPid = (specialRows || []).find((p) => p.name === loftName)?.id;
    for (const o of loftArr) {
      rawOptions.push({ group: "Loft", label: S(pick(o, "name")), price: S(pick(o, "price")) });
      addPkg(loftPid, num(pick(o, "quantity")) || 1);
    }
  }

  // Siding color = the app's "Paint" package (always present on a painted shed; the configurator's
  // "Siding Color" line carries the paint charge). Western Red Cedar is natural/quote-only -> skip.
  const sidingColorPrice = S(pick(bd, "siding.color_price", "siding_color_price"));
  if (sidingColor && L(siding) !== "western red cedar") {
    const paintPid = (specialRows || []).find((p) => p.name === "Paint")?.id;
    rawOptions.push({ group: "Siding Color (Paint)", label: sidingColor, price: sidingColorPrice });
    addPkg(paintPid, 1);
  }

  // ---- door color (from the door component) ----
  let doorColor: string | null = null;
  for (const c of asArray(pick(bd, "components"))) {
    if (L(pick(c, "type")) === "door") {
      doorColor = S(pick(c, "primary_color")) || S(getPath(asArray(pick(c, "colors"))[0], "display")) || null;
      break;
    }
  }

  // ---- renderings (images[] key -> value url) ----
  const imgByKey: Record<string, string> = {};
  for (const im of asArray(pick(bd, "images"))) imgByKey[L(pick(im, "key"))] = S(pick(im, "value"));
  const renderings = {
    rendering_url_1: imgByKey["front"] || imgByKey["perspective"] || null,
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

  // Fields safe to (re)write on every sync. status/sold_at/contact_id are deliberately omitted
  // so the app stays in control of the pipeline + linking on UPDATES.
  const payload: Record<string, unknown> = {
    source: "zapier",
    shedpro_project_id: dedupId,
    project_number: projectNumber,
    name,
    shed_style: description || null,
    style_package_id: stylePackageId,
    siding,
    shed_size: shedSize,
    customer_email: customerEmail,
    sale_price: salePrice,
    notes,
    shedpro_created: shedproCreated,
    siding_color: sidingColor,
    trim_color: trimColor,
    roof_color: roofColor,
    door_color: doorColor,
    roof,
    details_url: detailsUrl,
    selected_packages: selected,
    shedpro_options: rawOptions,
    ...renderings,
  };

  const appStatus = STATUS[statusRaw] || "quoted";

  if (dryRun) {
    return json({
      dry_run: true,
      resolved: { style_package_id: stylePackageId, siding, shed_size: shedSize, sale_price: salePrice },
      selected_packages: selected,
      selected_count: Object.values(selected).reduce((a, b) => a + b, 0),
      unmapped,
      insert_status: appStatus,
      payload,
    });
  }

  // ---- upsert (find existing by dedup id; preserve app-managed fields on update) ----
  let existingId: string | null = null;
  if (dedupId) {
    const { data: ex } = await supa.from("projects").select("id").eq("shedpro_project_id", dedupId).maybeSingle();
    existingId = ex?.id || null;
  }

  let result;
  if (existingId) {
    result = await supa.from("projects").update(payload).eq("id", existingId).select("id").single();
  } else {
    result = await supa.from("projects").insert({ ...payload, status: appStatus }).select("id").single();
  }
  if (result.error) {
    console.error("shedpro-sync write error:", result.error);
    return json({ error: result.error.message }, 500);
  }
  return json({ ok: true, project_id: result.data.id, action: existingId ? "updated" : "inserted", selected_packages: selected, unmapped });
});
