// src/modules/ProjectDetail.jsx
// A single project's page (/projects/:id), presented as a printable WORK ORDER.
//
// Two tabs:
//   • Work Order   — a formatted, printable work-order document with all the
//                    relevant project details (customer, builder, shed spec,
//                    finishes, options, renderings, pricing, notes). Has an
//                    "Edit project" button (opens a modal) and a "Print work
//                    order" button.
//   • Materials List — a READ-ONLY live materials list generated from the spec by
//                    the SAME engine as the Materials Calculator (PricingTool's
//                    MaterialsListTab + buildOutput — one source of truth).
//
// ALL editing happens in the Edit project modal (EditProjectModal): project
// fields (name, status, sale price, notes), the shed spec (size/style/siding/
// options via PricingTool's ConfigPanel), and — for admins — the assigned builder
// (which reassigns the project's CONTACT owner, since project ownership is derived
// from the contact). The page itself just displays the saved project.
//
// Loads its own row via lib/projects.js; RLS guarantees a builder can only open/edit
// a project whose contact they own (admins can open any). The global material/package
// data is passed in as props (same as the calculator) since the spec references them.
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  SHED_SIZES, C, fmt, getStyleMultiplier,
} from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { buildOutput, ConfigPanel, MaterialsListTab } from './PricingTool';
import {
  getProject, updateProject, deleteProject, fetchBuilderPricingContext,
  PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_MILESTONES, isSoldStatus,
} from '../lib/projects';

// Urban Sheds Collective licensing fee, taken as a share of the configurator sale
// price. Shown as its own line in the work order pricing breakdown.
const USC_LICENSE_FEE_RATE = 0.10; // 10%
import { assignContact, fetchAssignableBuilders, fetchContacts } from '../lib/contacts';
import {
  Card, Button, Badge, Input, Select, FormField, Label, Modal,
  ErrorBanner, SuccessBanner, WarningBanner, Spinner, ShedIcon,
} from '../components/UI';

const STATUS_OPTIONS = PROJECT_STATUSES.map(s => ({ value: s, label: PROJECT_STATUS_LABELS[s] }));
const TABS = [['work-order', 'Work Order'], ['materials', 'Materials List']];

// Editable ShedPro-sourced fields on a project (all `text` columns). These appear
// on the work order; the Edit modal lets you change them by hand. [column, label].
//
// Cosmetic COLOR_FIELDS don't affect price and are edited in the lower work-order
// section. The other ShedPro option/finish columns (siding_type, overhang, doors,
// windows, vents, roof, floor, transom, site_prep, building_permit, access) are NOT
// edited in the modal — they're driven by the option checkboxes in the spec above —
// so they're left out of the editable set and preserved as-is on save. The lone
// exception is `additional_features`, kept as a free-text field for custom add-ons.
const COLOR_FIELDS = [
  ['siding_color', 'Siding color'], ['trim_color', 'Trim color'],
  ['door_color', 'Door color'],     ['roof_color', 'Roof color'],
];
const RENDER_FIELDS = [
  ['perspective_rendering_url', 'Perspective URL (shown on cards)'],
  ['rendering_url_1', 'Front URL'], ['rendering_url_2', 'Left URL'],
  ['rendering_url_3', 'Right URL'], ['rendering_url_4', 'Back URL'],
  ['layout_rendering_url', 'Layout / floor plan URL'],
];
// Plain text columns edited in the modal. additional_features is the one free-text
// option kept here. (construction_date is edited inline on the work order page,
// monthly_payment isn't edited in-app, and options_summary / shedpro_options come from
// ShedPro and aren't edited here — all left out of the modal.)
const DETAIL_TEXT_KEYS = [...COLOR_FIELDS, ...RENDER_FIELDS].map(([k]) => k)
  .concat(['additional_features', 'project_number']);

// ShedPro's itemized options-with-prices (the "What's included" list on a ShedPro
// quote), stored in projects.shedpro_options. Tolerant of however Zapier delivers
// them: an array of objects ({label/name/option/title, detail/sub/color/note,
// price/amount/cost/value}), an array of plain strings, or a JSON string we parse.
// Returns a clean [{label, detail, price}] with blank items dropped.
function normalizeShedproOptions(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    const s = arr.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(it => {
    if (it == null) return null;
    if (typeof it === 'string') {
      const label = it.trim();
      return label ? { label, detail: '', price: '' } : null;
    }
    if (typeof it === 'object') {
      const label  = (it.label ?? it.name ?? it.option ?? it.title ?? '').toString().trim();
      const detail = (it.detail ?? it.sub ?? it.color ?? it.note ?? '').toString().trim();
      const priceRaw = it.price ?? it.amount ?? it.cost ?? it.value ?? '';
      const price = priceRaw == null ? '' : priceRaw.toString().trim();
      if (!label && !price) return null;
      return { label: label || '—', detail, price };
    }
    return null;
  }).filter(Boolean);
}

// Post-sale CHANGE ORDERS (projects.change_orders jsonb). Each entry is a line item
// added in-app after the sale, stamped with when it was added + who added it. Returns
// a clean [{label, detail, price, created_at, created_by, created_by_name}].
function normalizeChangeOrders(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    const s = arr.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(it => {
    if (!it || typeof it !== 'object') return null;
    const label  = String(it.label ?? '').trim();
    const detail = String(it.detail ?? '').trim();
    const price  = it.price == null ? '' : String(it.price).trim();
    if (!label && !price) return null;
    return {
      label, detail, price,
      created_at: it.created_at || null,
      created_by: it.created_by || null,
      created_by_name: String(it.created_by_name ?? '').trim(),
    };
  }).filter(Boolean);
}

// Parse a price string (e.g. "$550.00", "550", "Included") to a number; non-numeric → 0.
function parsePriceNum(p) {
  const n = parseFloat(String(p ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Display a change-order price: a numeric value (typed as "550" or "$550") prints as
// currency; free text (e.g. "Included") prints as-is; blank → "—".
function fmtCoPrice(p) {
  const s = String(p ?? '').trim();
  if (!s) return '—';
  if (/^[$\s]*-?[\d,]+(\.\d+)?\s*$/.test(s)) return fmt(parsePriceNum(s));
  return s;
}

// Format a change order's create date for display (falls back to the raw string).
function fmtCoDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
}

// project row → calculator cfg shape (see PricingTool).
function toCfg(project, stylePkgs) {
  return {
    size:        project.shed_size || SHED_SIZES[0],
    stylePkgId:  project.style_package_id || stylePkgs[0]?.id || '',
    siding:      project.siding || 'T1-11',
    selectedPkgs: project.selected_packages || {},
    pkgOverrides: project.package_overrides || {},
  };
}

// A project's name is BUILT from its shed data — size + style description + order #
// (e.g. "4x8 Tall Modern #5860") — not typed by hand, so it stays in sync with the
// spec. The style description prefers the raw ShedPro `shed_style` text, falling back
// to the style package name for hand-made projects. Used for the page title and saved
// to projects.name so lists/search stay consistent.
function composeProjectName({ size, style, number }) {
  const spec = [size, style].map(v => (v == null ? '' : String(v).trim())).filter(Boolean).join(' ');
  const num  = String(number ?? '').trim();
  return (num ? `${spec} #${num}` : spec).trim();
}

// The siding-color charge is the "Paint" package (per-shed paint cost). It's already a
// selected package, so it's in the app's total price; on the work order it shows as a
// priced line in the Options & Pricing list, NOT paired with the color up in Finishes.
const isPaintPkg = name => /paint/i.test(name || '');
const isBlankPrice = p => {
  const s = String(p ?? '').trim();
  return s === '' || s === '—' || s === '-' || s === '0' || s === '$0' || s === '$0.00';
};
// A ShedPro quote often lists the siding color (e.g. "Techno Gray") with no price. Fill
// that line's price from the app's Paint package so the siding-color cost shows alongside
// the other line items. Matches the line whose label is the siding color (or mentions
// paint/siding color); only fills when the quoted price is blank, leaving real ShedPro
// prices untouched.
function withSidingColorPrice(shedproOptions, project, paintPrice) {
  if (!paintPrice || !Array.isArray(shedproOptions) || shedproOptions.length === 0) return shedproOptions;
  const color = (project?.siding_color || '').trim().toLowerCase();
  let filled = false;
  return shedproOptions.map(o => {
    if (filled) return o;
    const lbl = (o.label || '').trim().toLowerCase();
    const isColorLine = (color && lbl === color) || /paint|siding\s*color/.test(lbl);
    if (isColorLine && isBlankPrice(o.price)) { filled = true; return { ...o, price: paintPrice }; }
    return o;
  });
}

export default function ProjectDetail({ materials, overrides, packages, pkgMaterials, pkgQuantities, styleMults }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const stylePkgs = useMemo(() => (packages || []).filter(p => p.is_style), [packages]);
  const salesTax = localStorage.getItem('usc_sales_tax') || '0';

  const [project,  setProject]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState('work-order');
  const [showEdit, setShowEdit] = useState(false);
  const [builders, setBuilders] = useState([]);
  const [statusSaving, setStatusSaving] = useState(null); // the status currently being saved (or null)
  const [builderCtx, setBuilderCtx] = useState(null); // the project owner's pricing context (when not the viewer)

  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Builders the admin can assign this project to (everyone except blocked users).
  useEffect(() => {
    if (!isAdmin) return;
    fetchAssignableBuilders().then(({ data }) => setBuilders(data || []));
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setNotFound(false); setError('');
      const { data, error: e } = await getProject(id);
      if (cancelled) return;
      setLoading(false);
      if (e) { setError(e.message); return; }
      if (!data) { setNotFound(true); return; }
      setProject(data);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Price this project AS ITS BUILDER. Load the project owner's pricing context
  // (their local material prices, per-style multipliers, sales tax) so the material
  // cost + app-calculated price reflect that builder — not whoever is viewing. A
  // builder only ever opens their own projects, so the viewer context already IS
  // theirs and we skip the fetch; an admin reviewing a builder's project loads it.
  const ownerId = project?.contact?.user_id || null;
  useEffect(() => {
    if (!ownerId || ownerId === profile?.id) return;
    let cancelled = false;
    fetchBuilderPricingContext(ownerId).then(ctx => {
      if (!cancelled && ctx && !ctx.error) setBuilderCtx({ ownerId, ...ctx });
    });
    return () => { cancelled = true; };
  }, [ownerId, profile?.id]);

  // Effective pricing context: the project builder's when loaded for THIS owner,
  // else the viewer's props (also correct when the viewer IS the owner). Tagging the
  // loaded context with its ownerId lets us ignore a stale load after switching.
  const builderPricing = (builderCtx && builderCtx.ownerId === ownerId && ownerId !== profile?.id) ? builderCtx : null;
  const priceOverrides  = builderPricing?.overrides  ?? overrides;
  const priceStyleMults = builderPricing?.styleMults ?? styleMults;
  const priceSalesTax   = builderPricing?.salesTax   ?? salesTax;

  // ── Display values derived from the saved project ──
  const cfg = useMemo(() => (project ? toCfg(project, stylePkgs) : null), [project, stylePkgs]);
  const name      = project?.name?.trim() || '';
  const status    = project?.status || 'draft';
  const salePrice = project?.sale_price;
  const notes     = project?.notes || '';

  // Live materials list from the saved config — same engine as the calculator,
  // priced with the project builder's context (priceOverrides/Mults/SalesTax).
  const out = useMemo(() => {
    if (!cfg) return { hasQty: false };
    return buildOutput({
      ...cfg, styleMults: priceStyleMults, salesTax: priceSalesTax, materials, overrides: priceOverrides, packages, pkgMaterials, pkgQuantities,
    });
  }, [cfg, priceStyleMults, priceSalesTax, materials, priceOverrides, packages, pkgMaterials, pkgQuantities]);

  const stylePkg   = stylePkgs.find(p => p.id === cfg?.stylePkgId);
  const styleLabel = stylePkg?.name || '—';
  const styleMult  = out.styleMult ?? getStyleMultiplier(priceStyleMults, stylePkg);

  // Advance/set the project status straight from the milestone stepper. Stamps
  // sold_at the first time the project reaches a sold status (same rule as the
  // Edit modal). RLS lets a builder update their own project / admins any.
  async function changeStatus(next) {
    if (!project || next === project.status || statusSaving) return;
    setStatusSaving(next); setError(''); setSuccess('');
    const payload = { status: next };
    if (isSoldStatus(next) && !project.sold_at) payload.sold_at = new Date().toISOString();
    const { data, error: e } = await updateProject(id, payload);
    setStatusSaving(null);
    if (e) { setError(e.message); return; }
    setProject(data);
    setSuccess(`Status set to ${PROJECT_STATUS_LABELS[next] || next}.`);
  }

  async function doDelete() {
    setDeleting(true); setError('');
    const { error: e } = await deleteProject(id);
    setDeleting(false);
    if (e) { setError(e.message); setConfirmDelete(false); return; }
    navigate('/sold-projects');
  }

  if (loading) return <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spinner size={32} /></div>;

  if (notFound) {
    return (
      <div style={{ maxWidth:760 }}>
        <BackLink />
        <Card style={{ marginTop:16 }}>
          <div style={{ textAlign:'center', padding:'24px 12px', fontFamily:'DM Sans', color:'#888', fontSize:14 }}>
            This project doesn't exist or isn't available to you.
          </div>
        </Card>
      </div>
    );
  }

  const contact = project?.contact;
  const contactName = contact?.full_name || contact?.company_name || contact?.email || 'a contact';
  const ownerName = contact?.owner?.full_name || contact?.owner?.email || null;
  // Name is built from the shed data (size + style + order #), not the stored text.
  const styleDesc = project?.shed_style?.trim() || (styleLabel !== '—' ? styleLabel : '');
  const title = composeProjectName({ size: cfg?.size, style: styleDesc, number: project?.project_number })
    || name || 'Untitled project';

  // Selected option packages (name + count) for the work order, in package order.
  const selectedOptions = (packages || [])
    .filter(p => !p.siding_type && !p.is_style && (cfg?.selectedPkgs?.[p.id] || 0) > 0)
    .map(p => ({ name: p.name, count: cfg.selectedPkgs[p.id] }));

  // The app's Paint (siding-color charge) price from the pricing engine, used to fill
  // in the siding-color line item's price when the ShedPro quote left it blank.
  const paintGroup = (out?.pkgGroups || []).find(g => g.pkg && isPaintPkg(g.pkg.name));
  const paintPrice = paintGroup ? fmt(paintGroup.customerPkgPrice || 0) : null;

  // ShedPro's itemized options-with-prices (from the quote), the plain-text fallback,
  // and the financing figure — all straight from the synced project. The siding-color
  // line gets its price filled from the app's Paint package when ShedPro left it blank.
  const shedproOptions = withSidingColorPrice(normalizeShedproOptions(project?.shedpro_options), project, paintPrice);
  const optionsSummary = project?.options_summary?.trim() || '';
  const monthlyPayment = project?.monthly_payment;

  // Post-sale change orders added in-app (label/detail/price + when/who added them).
  const changeOrders = normalizeChangeOrders(project?.change_orders);

  // Priced option line items from the app's OWN pricing engine — the fallback for
  // the "Options & Pricing" section when a project has no ShedPro itemized quote
  // (e.g. a project created by hand). Each selected option package shows with its
  // calculated customer price (incl. any per-package override) — including Paint (the
  // siding-color charge). Siding package + style excluded.
  const optionPriceLines = (out?.pkgGroups || [])
    .filter(g => !g.isSidingPkg && g.pkg && !g.pkg.is_style)
    .map(g => ({
      label: (g.pkgCount || 1) > 1 ? `${g.pkg.name} (×${g.pkgCount})` : g.pkg.name,
      price: fmt(g.customerPkgPrice || 0),
    }));

  // ── Pricing breakdown shown at the bottom of the work order ──
  // Material cost is the builder's (priced via their context above). The configurator
  // SALE price is split into Material + USC licensing fee (10% of sale) + Labor/
  // overhead/profit (the remainder). The "App calculated price" is the app's own
  // independent number (out.customerPrice) kept alongside so the two can be compared.
  const salePriceNum = salePrice != null && String(salePrice).trim() !== '' ? parseFloat(salePrice) : null;
  const materialCost = out?.hasQty ? out.totalMat : null;
  // The Material + licensing fee + labor breakdown only resolves when we have BOTH a
  // builder material cost AND a configurator sale price to split.
  const hasBreakdown = salePriceNum != null && materialCost != null;
  const licenseFee   = hasBreakdown ? salePriceNum * USC_LICENSE_FEE_RATE : null;
  const laborProfit  = hasBreakdown ? salePriceNum - materialCost - licenseFee : null;
  const appCalcPrice = out?.hasQty ? out.customerPrice : null;

  // Change-order subtotal + the FINAL total (sale price + change orders). When there are
  // change orders, the work order keeps the sale price visible as a line and shows the
  // final total as the big number; with no change orders the sale price IS the big number.
  const changeOrdersTotal = changeOrders.reduce((s, co) => s + parsePriceNum(co.price), 0);
  const hasChangeOrders = changeOrders.length > 0;
  const finalTotal = (salePriceNum != null || hasChangeOrders)
    ? (salePriceNum || 0) + changeOrdersTotal
    : null;

  const pricing = {
    materialCost, licenseFee, laborProfit, appCalcPrice, salePriceNum,
    licenseRatePct: Math.round(USC_LICENSE_FEE_RATE * 100),
    changeOrdersTotal, hasChangeOrders, finalTotal,
  };

  // Shared props for both work-order renderings (the paper doc + the mobile view).
  const woProps = {
    project, contact, title, status, salePrice, notes, cfg, size: cfg?.size,
    styleLabel, styleMult, out, selectedOptions, shedproOptions, optionsSummary,
    optionPriceLines, monthlyPayment, pricing, changeOrders,
  };

  return (
    <div style={{ paddingBottom: isMobile ? 92 : 0 }}>
      <BackLink />

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Header */}
      <Card style={{ marginTop:16, marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div style={{ minWidth:200 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:600, color:C.charcoal, lineHeight:1.1 }}>{title}</div>
            <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              {project?.sold_at && (
                <Badge color="sage">Sold {new Date(project.sold_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}</Badge>
              )}
              <span style={{ fontFamily:'DM Sans', fontSize: isMobile ? 13.5 : 12.5, color:'#8C8478' }}>
                for <Link to={`/contacts/${contact?.id}`} style={{ color:C.sage, textDecoration:'none', fontWeight:600 }}>{contactName}</Link>
              </span>
              {isAdmin && (
                <span style={{ fontFamily:'DM Sans', fontSize: isMobile ? 13.5 : 12.5, color:'#8C8478' }}>
                  · builder: <strong style={{ color:C.inkLight, fontWeight:600 }}>{ownerName || 'Unassigned'}</strong>
                </span>
              )}
            </div>
          </div>
          {!isMobile && <Button onClick={() => setShowEdit(true)}>✎ Edit project</Button>}
        </div>
      </Card>

      {/* Milestone stepper — click a stage to move the project along its pipeline. */}
      <StatusMilestones
        status={status}
        saving={statusSaving}
        onPick={changeStatus}
        isMobile={isMobile}
      />

      {/* Construction date — builders set/update the install date inline here. */}
      <ConstructionDateCard project={project} onSaved={setProject} isMobile={isMobile} />

      {/* Tabs — two tabs, so on mobile they split the width evenly (no scrolling). */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:`2px solid ${C.linenDarker}`, flexWrap:'nowrap', overflowY:'hidden' }}>
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{ fontFamily:'DM Sans', fontSize: isMobile ? 13.5 : 13, fontWeight:600, padding: isMobile ? '13px 16px' : '10px 22px', border:'none', cursor:'pointer', background:'transparent', color: activeTab===key ? C.sage : '#8C8478', borderBottom: activeTab===key ? `2px solid ${C.sage}` : '2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flex: isMobile ? '1 1 0' : '0 0 auto', textAlign:'center' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Work Order tab ── */}
      {/* Mobile gets an app-style reading view; desktop gets the printable paper doc.
          The paper doc is ALSO the print/share source — on mobile it's rendered
          hidden at the bottom of the page (so #work-order-print always exists). */}
      {activeTab === 'work-order' && (
        isMobile ? (
          <MobileWorkOrder {...woProps} />
        ) : (
          <>
            <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:14 }}>
              <Button variant="secondary" onClick={printWorkOrder}>🖨 Print work order</Button>
            </div>
            <WorkOrderDoc {...woProps} isMobile={false} />
          </>
        )
      )}

      {/* ── Materials List tab (read-only) ── */}
      {/* The list is generated from the spec; edit the spec via "Edit project". */}
      {activeTab === 'materials' && cfg && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:12 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand }}>
              Materials list
            </div>
            <button onClick={() => setShowEdit(true)}
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontFamily:'DM Sans', fontSize:12, color:C.sage, fontWeight:600 }}>
              ✎ Edit the spec →
            </button>
          </div>
          <div style={{ minWidth:0 }}>
            {!stylePkgs.length ? (
              <WarningBanner>No shed styles configured yet. Add them under Packages → Shed Styles.</WarningBanner>
            ) : !out.hasQty ? (
              <WarningBanner>No quantities on file for {styleLabel} at size {cfg.size}. Add them under Packages → Shed Styles.</WarningBanner>
            ) : (
              <MaterialsListTab out={out} cfg={cfg} size={cfg.size} style={styleLabel} multiplier={styleMult} isMobile={isMobile} />
            )}
          </div>
        </div>
      )}

      {/* Footer actions. On desktop: date + Delete/Edit. On mobile the primary
          actions live in the sticky bar, so the footer just shows the date and a
          quiet, deliberately separated Delete. */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:24, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#8C8478' }}>
          {project?.created_at ? `Created ${new Date(project.created_at).toLocaleDateString()}` : ''}
          {project?.sold_at ? ` · Sold ${new Date(project.sold_at).toLocaleDateString()}` : ''}
        </span>
        {!isMobile && (
          <div style={{ display:'flex', gap:10 }}>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
            <Button onClick={() => setShowEdit(true)}>✎ Edit project</Button>
          </div>
        )}
      </div>
      {isMobile && (
        <div style={{ marginTop:14, textAlign:'center' }}>
          <button onClick={() => setConfirmDelete(true)}
            style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'DM Sans', fontSize:13, color:C.error, fontWeight:600, padding:'8px 16px' }}>
            Delete project
          </button>
        </div>
      )}

      {/* Mobile sticky action bar — primary page actions, always reachable.
          (Matches the ContactProfile bottom bar: safe-area padding, even widths.) */}
      {isMobile && (
        <div style={{
          position:'fixed', left:0, right:0, bottom:0, zIndex:50, background:'#fff',
          borderTop:`1px solid ${C.linenDarker}`, boxShadow:'0 -2px 12px rgba(0,0,0,0.07)',
          display:'flex', gap:10, padding:'10px 12px', paddingBottom:'calc(10px + env(safe-area-inset-bottom))',
        }}>
          <Button variant="secondary" onClick={printWorkOrder} style={{ flex:'1 1 0', justifyContent:'center', minHeight:46 }}>🖨 Print / Save</Button>
          <Button onClick={() => setShowEdit(true)} style={{ flex:'1 1 0', justifyContent:'center', minHeight:46 }}>✎ Edit</Button>
        </div>
      )}

      {/* Hidden print/share source on mobile so Print works from either tab. */}
      {isMobile && (
        <div aria-hidden style={{ position:'absolute', width:1, height:1, overflow:'hidden', clip:'rect(0 0 0 0)', whiteSpace:'nowrap' }}>
          <WorkOrderDoc {...woProps} isMobile={false} />
        </div>
      )}

      {showEdit && (
        <EditProjectModal
          project={project}
          isAdmin={isAdmin}
          builders={builders}
          stylePkgs={stylePkgs}
          materials={materials}
          overrides={priceOverrides}
          packages={packages}
          pkgMaterials={pkgMaterials}
          pkgQuantities={pkgQuantities}
          styleMults={priceStyleMults}
          salesTax={priceSalesTax}
          isMobile={isMobile}
          onClose={() => setShowEdit(false)}
          onSaved={(data) => { setProject(data); setShowEdit(false); setSuccess('Project saved.'); }}
        />
      )}

      {confirmDelete && (
        <Modal title="Delete project?" onClose={() => setConfirmDelete(false)} width={420}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:C.charcoal, marginTop:0 }}>
            Permanently delete <strong>{title}</strong>? This can't be undone.
          </p>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} loading={deleting}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/sold-projects" style={{ fontFamily:'DM Sans', fontSize:13, color:C.sage, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}>
      ← All sold projects
    </Link>
  );
}

// ── Status milestones ─────────────────────────────────────────────────────────
// A clickable stepper (Quoted → Sold → Scheduled → Completed) that sits above the
// work order so the project's stage is obvious and one click moves it along. The
// status can also be draft or cancelled (off this linear track) — set those in the
// Edit modal; here a draft shows nothing reached yet and a cancelled project shows
// a flag with the steps dimmed (clicking one reactivates the project to that stage).
function StatusMilestones({ status, saving, onPick, isMobile }) {
  const steps = PROJECT_MILESTONES;
  const last = steps.length - 1;
  const activeIdx = steps.indexOf(status); // -1 for draft / cancelled
  const cancelled = status === 'cancelled';
  const circle = isMobile ? 40 : 34;
  const lineTop = circle / 2 - 1;

  return (
    <Card style={{ marginBottom:20, padding: isMobile ? '16px 12px' : '18px 20px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand }}>
          Project status
        </div>
        {cancelled && (
          <Badge color="red">Cancelled</Badge>
        )}
        {status === 'draft' && (
          <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#aaa' }}>Not yet quoted</span>
        )}
      </div>

      <div style={{ display:'flex', alignItems:'flex-start', overflow:'visible' }}>
        {steps.map((s, i) => {
          const reached = !cancelled && i <= activeIdx;
          const isCurrent = !cancelled && i === activeIdx;
          const isSaving = saving === s;
          const leftReached  = !cancelled && i <= activeIdx;
          const rightReached = !cancelled && (i + 1) <= activeIdx;
          return (
            <div key={s} style={{ flex:1, minWidth:0, position:'relative', textAlign:'center' }}>
              {/* connector lines behind the circle */}
              {i > 0 && (
                <div style={{ position:'absolute', top:lineTop, left:0, width:'50%', height:2, background: leftReached ? C.sage : C.linenDarker }} />
              )}
              {i < last && (
                <div style={{ position:'absolute', top:lineTop, left:'50%', width:'50%', height:2, background: rightReached ? C.sage : C.linenDarker }} />
              )}
              {/* circle button */}
              <button
                onClick={() => onPick(s)}
                disabled={!!saving}
                title={`Set status to ${PROJECT_STATUS_LABELS[s]}`}
                style={{
                  position:'relative', zIndex:1, width:circle, height:circle, borderRadius:'50%',
                  display:'inline-flex', alignItems:'center', justifyContent:'center',
                  border: reached ? `2px solid ${C.sage}` : `2px solid ${C.linenDarker}`,
                  background: reached ? C.sage : '#FFFDF9',
                  color: reached ? '#fff' : '#bbb',
                  boxShadow: isCurrent ? `0 0 0 4px ${C.linen}` : 'none',
                  cursor: saving ? 'default' : 'pointer',
                  fontFamily:'DM Sans', fontSize:13, fontWeight:700,
                  transition:'all 0.15s',
                }}
              >
                {isSaving ? <Spinner size={14} /> : (i < activeIdx && !cancelled ? '✓' : i + 1)}
              </button>
              {/* label */}
              <div style={{
                marginTop:7, fontFamily:'DM Sans', fontSize: isMobile ? 11.5 : 12.5,
                fontWeight: isCurrent ? 700 : 600,
                color: isCurrent ? C.charcoal : (reached ? C.sageDark : '#aaa'),
                whiteSpace:'nowrap',
              }}>
                {PROJECT_STATUS_LABELS[s]}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Construction date ─────────────────────────────────────────────────────────
// Inline date editor on the work order page so builders can add/update the install
// date without opening the Edit modal. Saves on change via updateProject (RLS lets a
// builder edit their own project / admins any) and hands the fresh row back.
function ConstructionDateCard({ project, onSaved, isMobile }) {
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const value = project?.construction_date || '';

  async function change(v) {
    setSaving(true); setSaved(false);
    const { data, error } = await updateProject(project.id, { construction_date: v || null });
    setSaving(false);
    if (error) return;
    onSaved(data);
    setSaved(true);
  }

  return (
    <Card style={{ marginBottom:20, padding: isMobile ? '14px 14px' : '14px 20px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
        <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand }}>
          Construction date
        </div>
        <div style={{ flex:'0 1 200px', minWidth:160 }}>
          <Input type="date" value={value} onChange={change} />
        </div>
        {saving
          ? <Spinner size={14} />
          : saved
            ? <span style={{ fontFamily:'DM Sans', fontSize:12, color:C.sage, fontWeight:600 }}>Saved ✓</span>
            : value
              ? <button onClick={() => change('')} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'DM Sans', fontSize:12, color:'#999', textDecoration:'underline' }}>Clear</button>
              : <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#aaa' }}>Not scheduled yet</span>}
      </div>
    </Card>
  );
}

// ── Edit project modal ────────────────────────────────────────────────────────
// Edits a draft copy of the project fields + shed spec, and (for admins) the
// assigned builder. On Save it persists everything and hands the fresh row back.
//
// "Assigned builder" reassigns the project's CONTACT owner (contacts.user_id) —
// project ownership is derived from the contact, so this changes the builder for
// ALL of that contact's projects, not just this one (flagged in the UI).
function EditProjectModal({ project, isAdmin, builders, stylePkgs, materials, overrides, packages, pkgMaterials, pkgQuantities, styleMults, salesTax, isMobile, onClose, onSaved }) {
  const { profile } = useAuth();
  const [status,    setStatus]    = useState(project.status || 'draft');
  const [salePrice, setSalePrice] = useState(project.sale_price != null ? String(project.sale_price) : '');
  const [cfg,       setCfg]       = useState(toCfg(project, stylePkgs));
  const origOwner = project.contact?.user_id || '';
  const [builderId, setBuilderId] = useState(origOwner);
  // Linked contact. A project can start contact-less (admin-only); pick one here to link it.
  const origContactId = project.contact?.id || '';
  const [contactId, setContactId] = useState(origContactId);
  const [contactLabel, setContactLabel] = useState(
    project.contact ? (project.contact.full_name || project.contact.company_name || project.contact.email || 'Unnamed contact') : ''
  );
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  // ── ShedPro / work-order detail fields (colors, renderings, finishes, etc.) ──
  // One object holds every editable text field.
  const [details, setDetails] = useState(() => {
    const d = {};
    DETAIL_TEXT_KEYS.forEach(k => { d[k] = project[k] ?? ''; });
    return d;
  });
  const setDetail = (k, v) => setDetails(p => ({ ...p, [k]: v }));

  // Post-sale CHANGE ORDERS (projects.change_orders jsonb). Adding a row stamps it with
  // today's date + the current user; editing an existing row keeps its original stamp.
  const [changeOrders, setChangeOrders] = useState(() => normalizeChangeOrders(project.change_orders));
  const setCO    = (i, k, v) => setChangeOrders(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const addCO    = () => setChangeOrders(rows => [...rows, {
    label:'', detail:'', price:'',
    created_at: new Date().toISOString(),
    created_by: profile?.id || null,
    created_by_name: profile?.full_name || profile?.email || '',
  }]);
  const removeCO = (i) => setChangeOrders(rows => rows.filter((_, idx) => idx !== i));

  // The modal body is split into tabs (Details · Specification · Appearance · Change
  // orders) — all fields stay in state regardless of the active tab, so switching never
  // loses input and Save (in the footer) persists everything from any tab.
  const [tab, setTab] = useState('details');

  // The name is BUILT from the draft shed data (size + style + order #), not typed —
  // so it updates live as you change the spec and is what gets saved to projects.name.
  const derivedName = useMemo(() => {
    const stylePkg  = stylePkgs.find(p => p.id === cfg.stylePkgId);
    const styleDesc = project.shed_style?.trim() || stylePkg?.name || '';
    return composeProjectName({ size: cfg.size, style: styleDesc, number: details.project_number });
  }, [cfg.stylePkgId, cfg.size, details.project_number, project.shed_style, stylePkgs]);

  // The "Assigned builder" control only applies when keeping the SAME contact — if
  // you're switching the linked contact, the builder follows the new contact's owner.
  const canAssign = isAdmin && !!contactId && contactId === origContactId;
  const contactChanged = contactId !== origContactId;

  // Dirty tracking so we can confirm before discarding edits. The first render's
  // snapshot is the baseline; any change to an editable field makes the modal dirty.
  const baselineRef = useRef(null);
  const snapshot = JSON.stringify({ status, salePrice, contactId, builderId, cfg, details, changeOrders });
  if (baselineRef.current === null) baselineRef.current = snapshot;
  const dirty = baselineRef.current !== snapshot;
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Route every close path (Cancel, ×, Esc, backdrop) through here so unsaved edits
  // prompt a confirm instead of vanishing.
  const requestClose = () => { if (dirty && !saving) setConfirmingClose(true); else onClose(); };

  async function save() {
    setSaving(true); setErr('');

    // Reassign the contact owner FIRST so updateProject's SELECT re-embeds the
    // fresh owner in the returned row. (Only when the contact is unchanged.)
    if (canAssign && builderId !== origOwner) {
      const { error: ae } = await assignContact(contactId, builderId || null);
      if (ae) { setErr(ae.message); setSaving(false); return; }
    }

    const willBeSold = isSoldStatus(status);
    const textOrNull = v => (v == null || String(v).trim() === '') ? null : String(v).trim();
    // change_orders is jsonb NOT NULL DEFAULT '[]' — always send an array, drop blank
    // rows, and keep/stamp each row's created_at + who added it.
    const cleanChangeOrders = changeOrders
      .map(r => ({
        label:(r.label||'').trim(), detail:(r.detail||'').trim(), price:(r.price||'').trim(),
        created_at: r.created_at || new Date().toISOString(),
        created_by: r.created_by || profile?.id || null,
        created_by_name: r.created_by_name || profile?.full_name || profile?.email || '',
      }))
      .filter(r => r.label || r.price);

    const payload = {
      contact_id: contactId || null,
      name: derivedName || null,
      status,
      sale_price: salePrice.trim() === '' ? null : parsePriceNum(salePrice),
      shed_size: cfg.size || null,
      style_package_id: cfg.stylePkgId || null,
      siding: cfg.siding || null,
      selected_packages: cfg.selectedPkgs || {},
      package_overrides: cfg.pkgOverrides || {},
      // ShedPro / work-order detail fields (colors, renderings, finishes, …)
      ...Object.fromEntries(DETAIL_TEXT_KEYS.map(k => [k, textOrNull(details[k])])),
      change_orders: cleanChangeOrders,
    };
    if (willBeSold && !project.sold_at) payload.sold_at = new Date().toISOString();

    const { data, error } = await updateProject(project.id, payload);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved(data);
  }

  const footer = confirmingClose ? (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
      <span style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.charcoal }}>Discard unsaved changes?</span>
      <div style={{ display:'flex', gap:10 }}>
        <Button variant="ghost" onClick={() => setConfirmingClose(false)}>Keep editing</Button>
        <Button variant="danger" onClick={onClose}>Discard</Button>
      </div>
    </div>
  ) : (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
      <span style={{ fontFamily:'DM Sans', fontSize:12.5, color:C.error, flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis' }}>{err || ''}</span>
      <div style={{ display:'flex', gap:10, flexShrink:0 }}>
        <Button variant="ghost" onClick={requestClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>Save project</Button>
      </div>
    </div>
  );

  const TABS = [
    { id:'details',    label:'Details' },
    { id:'spec',       label:'Specification' },
    { id:'appearance', label:'Appearance' },
    { id:'changes',    label:`Change orders${changeOrders.length ? ` (${changeOrders.length})` : ''}` },
  ];
  const tabStrip = (
    <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${C.linenDarker}`, overflowX:'auto', overflowY:'hidden', padding:'0 28px' }}>
      {TABS.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{ flexShrink:0, fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding:'11px 14px', border:'none', background:'transparent', cursor:'pointer', color: active ? C.sage : '#8C8478', borderBottom: active ? `2px solid ${C.sage}` : '2px solid transparent', marginBottom:-1, whiteSpace:'nowrap' }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const coSubtotal = changeOrders.reduce((s, r) => s + parsePriceNum(r.price), 0);

  return (
    <Modal title="Edit project" onClose={requestClose} width={640} footer={footer} subheader={tabStrip}>
      {/* ── Details ── */}
      {tab === 'details' && (
        <div>
          <FormField label="Contact" style={{ marginBottom:16 }}>
            <ContactPicker
              value={contactId}
              label={contactLabel}
              onPick={(id, lbl) => { setContactId(id); setContactLabel(lbl); }}
            />
            {contactChanged && (
              <div style={{ fontFamily:'DM Sans', fontSize:11.5, color:C.sand, marginTop:6 }}>
                {contactId
                  ? 'This project will be linked to the selected contact (the builder follows that contact’s owner).'
                  : 'This project will be unlinked from its contact (admin-only until linked again).'}
              </div>
            )}
          </FormField>

          {/* Name is auto-built from the shed data — shown here as a read-only heading. */}
          <div style={{ marginBottom:16 }}>
            <Label>Project name</Label>
            <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
              <span style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color: derivedName ? C.charcoal : '#aaa', lineHeight:1.2 }}>
                {derivedName || 'Set the size, style and order #'}
              </span>
              <span style={{ fontFamily:'DM Sans', fontSize:11, color:C.sand }}>auto-generated from the spec</span>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
            <FormField label="Status" style={{ marginBottom:0 }}>
              <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            </FormField>
            <FormField label="Sale price" style={{ marginBottom:0 }}>
              <MoneyInput value={salePrice} onChange={setSalePrice} />
            </FormField>
            <FormField label="Work order #" style={{ marginBottom:0 }}>
              <Input value={details.project_number} onChange={v => setDetail('project_number', v)} placeholder="e.g. 5860" />
            </FormField>
            {canAssign && (
              <FormField label="Assigned builder" style={{ marginBottom:0 }}>
                <Select
                  value={builderId}
                  onChange={setBuilderId}
                  options={[
                    { value:'', label:'— Unassigned —' },
                    ...builders.map(b => ({ value:b.id, label:b.full_name || b.email })),
                  ]}
                />
              </FormField>
            )}
          </div>

          {canAssign && builderId !== origOwner && (
            <div style={{ fontFamily:'DM Sans', fontSize:11.5, color:C.sand, marginTop:8 }}>
              Heads up: the builder is set on the contact, so this reassigns every project for {project.contact?.full_name || project.contact?.company_name || 'this contact'}.
            </div>
          )}
        </div>
      )}

      {/* ── Specification ── */}
      {tab === 'spec' && (
        <div>
          <p style={{ fontFamily:'DM Sans', fontSize:12.5, color:'#777', margin:'0 0 14px' }}>
            Size, style, siding and options. Drives the work order and the materials list.
            Enter the <strong>ShedPro price</strong> in the $ field next to each option you select — it
            shows in the work order’s Options &amp; Pricing list and rolls into the app total.
          </p>
          <div style={{ maxWidth: isMobile ? '100%' : 380 }}>
            <ConfigPanel cfg={cfg} setCfg={setCfg} packages={packages} editPrices />
          </div>
          {/* Other options are set by the checkboxes above; this is the one free-text add. */}
          <div style={{ marginTop:20 }}>
            <FormField label="Additional features" style={{ marginBottom:0 }}>
              <Input value={details.additional_features} onChange={v => setDetail('additional_features', v)} placeholder="Any custom features not covered by the options above" />
            </FormField>
          </div>
        </div>
      )}

      {/* ── Appearance ── */}
      {tab === 'appearance' && (
        <div>
          <p style={{ fontFamily:'DM Sans', fontSize:12.5, color:'#777', margin:'0 0 16px' }}>
            Optional — the renderings and colors shown on the work order. None of this affects the price.
          </p>
          <EditSubLabel>Renderings &amp; images</EditSubLabel>
          <p style={editHint}>Image URLs shown on the work order, in order.</p>
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:22 }}>
            {RENDER_FIELDS.map(([k, label]) => (
              <FormField key={k} label={label} style={{ marginBottom:0 }}>
                <Input value={details[k]} onChange={v => setDetail(k, v)} placeholder="https://…" />
              </FormField>
            ))}
          </div>

          <EditSubLabel>Colors</EditSubLabel>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:14 }}>
            {COLOR_FIELDS.map(([k, label]) => (
              <FormField key={k} label={label} style={{ marginBottom:0 }}>
                <Input value={details[k]} onChange={v => setDetail(k, v)} />
              </FormField>
            ))}
          </div>
        </div>
      )}

      {/* ── Change orders ── */}
      {tab === 'changes' && (
        <div>
          <p style={{ fontFamily:'DM Sans', fontSize:12.5, color:'#777', margin:'0 0 16px' }}>
            Line items for any change after the shed is sold. Each is stamped with today’s date and your name, shows in the work order’s Change Orders section, and adds to the final total.
          </p>

          {changeOrders.length === 0 ? (
            <div style={{ border:`1px dashed ${C.linenDarker}`, borderRadius:6, padding:'18px 16px', textAlign:'center', fontFamily:'DM Sans', fontSize:13, color:'#999', marginBottom:14 }}>
              No change orders yet.
            </div>
          ) : (
            <>
              {/* Column headers (desktop) */}
              {!isMobile && (
                <div style={{ display:'flex', gap:8, padding:'0 0 6px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:C.sand }}>
                  <div style={{ flex:'2 1 150px' }}>Item</div>
                  <div style={{ flex:'2 1 150px' }}>Detail</div>
                  <div style={{ flex:'1 1 100px' }}>Price</div>
                  <div style={{ width:30, flexShrink:0 }} />
                </div>
              )}
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {changeOrders.map((r, i) => (
                  <div key={i} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                      <div style={{ flex:'2 1 150px', minWidth:0 }}><Input value={r.label} onChange={v => setCO(i, 'label', v)} placeholder="Change order item" /></div>
                      <div style={{ flex:'2 1 150px', minWidth:0 }}><Input value={r.detail} onChange={v => setCO(i, 'detail', v)} placeholder="Detail (optional)" /></div>
                      <div style={{ flex:'1 1 100px', minWidth:0 }}><MoneyInput value={r.price} onChange={v => setCO(i, 'price', v)} align="right" /></div>
                      <button type="button" onClick={() => removeCO(i)} title="Remove change order"
                        style={{ flexShrink:0, width:30, height:30, borderRadius:4, border:`1px solid ${C.linenDarker}`, background:C.linen, color:C.error, cursor:'pointer', fontSize:16, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
                    </div>
                    {(r.created_at || r.created_by_name) && (
                      <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#999', paddingLeft:2 }}>
                        Added {fmtCoDate(r.created_at)}{r.created_by_name ? ` by ${r.created_by_name}` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Running subtotal — mirrors the work order's Final-total math. */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:14, paddingTop:12, borderTop:`1px solid ${C.linenDarker}` }}>
                <span style={{ fontFamily:'DM Sans', fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:C.sand }}>Change orders subtotal</span>
                <span style={{ fontFamily:'DM Sans', fontSize:15, fontWeight:700, color:C.charcoal, fontVariantNumeric:'tabular-nums' }}>{fmt(coSubtotal)}</span>
              </div>
            </>
          )}

          <div style={{ marginTop:14 }}>
            <Button variant="ghost" size="sm" onClick={addCO}>+ Add line item</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// $-prefixed money input used in the edit modal (sale price + change-order prices).
function MoneyInput({ value, onChange, placeholder = '0.00', align = 'left' }) {
  return (
    <div style={{ display:'flex', alignItems:'stretch', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, background:'#FFFDF9', overflow:'hidden' }}>
      <span style={{ display:'flex', alignItems:'center', padding:'0 9px', background:C.linen, color:'#8C8478', fontFamily:'DM Sans', fontSize:13, fontWeight:600 }}>$</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        style={{ border:'none', outline:'none', background:'transparent', padding:'9px 10px', fontFamily:'DM Sans', fontSize:14, color:C.charcoal, width:'100%', minWidth:0, textAlign:align }}
      />
    </div>
  );
}

// Small uppercase section label used inside the Edit project modal.
function EditSubLabel({ children }) {
  return (
    <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, marginBottom:6 }}>
      {children}
    </div>
  );
}
const editHint = { fontFamily:'DM Sans', fontSize:12, color:'#999', margin:'0 0 14px' };

// Inline contact picker for the edit modal: shows the linked contact (if any) and,
// when expanded, a searchable list to pick a different one. Contacts load on first
// expand (not when the modal opens) since there can be hundreds. RLS scopes the list
// (a builder sees only their own contacts; admins see all).
function ContactPicker({ value, label, onPick }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  async function ensureLoaded() {
    if (contacts) return;
    setLoading(true);
    const { data } = await fetchContacts();
    setLoading(false);
    setContacts(data || []);
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) ensureLoaded();
  }

  const filtered = useMemo(() => {
    const list = contacts || [];
    const q = search.trim().toLowerCase();
    const f = q
      ? list.filter(c => [c.full_name, c.company_name, c.email].filter(Boolean).some(v => v.toLowerCase().includes(q)))
      : list;
    return f.slice(0, 50); // keep the picker light even with hundreds of contacts
  }, [contacts, search]);

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'DM Sans', fontSize:14, color: value ? C.charcoal : '#999', fontWeight: value ? 600 : 400 }}>
          {label || 'No contact linked'}
        </span>
        <Button variant="ghost" size="sm" onClick={toggle}>
          {open ? 'Close' : (value ? 'Change' : 'Link a contact')}
        </Button>
      </div>

      {open && (
        <div style={{ marginTop:10 }}>
          <Input value={search} onChange={setSearch} placeholder="Search contacts by name, company, email…" />
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:16 }}><Spinner size={20} /></div>
          ) : (
            <div style={{ marginTop:8, maxHeight:220, overflowY:'auto', border:`1px solid ${C.linenDarker}`, borderRadius:4 }}>
              {filtered.length === 0 ? (
                <div style={{ padding:'14px', fontFamily:'DM Sans', fontSize:13, color:'#888', textAlign:'center' }}>
                  {(contacts || []).length === 0 ? 'No contacts found.' : 'No contacts match.'}
                </div>
              ) : filtered.map(c => {
                const lbl = c.full_name || c.company_name || c.email || 'Unnamed contact';
                const selected = c.id === value;
                return (
                  <div
                    key={c.id}
                    onClick={() => { onPick(c.id, lbl); setOpen(false); }}
                    style={{
                      padding:'9px 12px', cursor:'pointer', fontFamily:'DM Sans', fontSize:13,
                      borderBottom:`1px solid ${C.linen}`,
                      background: selected ? C.sage : 'transparent',
                      color: selected ? '#fff' : C.charcoal,
                    }}
                  >
                    <div style={{ fontWeight:600 }}>{lbl}</div>
                    {(c.email || c.market) && (
                      <div style={{ fontSize:11, color: selected ? 'rgba(255,255,255,0.8)' : '#999', marginTop:1 }}>
                        {[c.email, c.market].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Print (or "Save as PDF") the work-order document. Copies the rendered
// #work-order-print HTML into a hidden iframe and prints that. An iframe is used
// instead of window.open() because mobile browsers (iOS Safari especially) block
// popups and print new windows unreliably; a same-document iframe avoids both.
function printWorkOrder() {
  const el = document.getElementById('work-order-print');
  if (!el) return;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>USC Work Order</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'DM Sans', sans-serif; padding: 32px; color: #3C3C3C; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @media print { body { padding: 20px; } }
          img { max-width: 100%; }
        </style>
      </head>
      <body>${el.innerHTML}</body>
    </html>
  `;

  const prev = document.getElementById('wo-print-frame');
  if (prev) prev.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'wo-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
  document.body.appendChild(iframe);

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    const win = iframe.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  // Give the (possibly remote) renderings + web fonts a moment to load so they
  // appear in the printout, then trigger the print dialog once.
  iframe.onload = () => setTimeout(fire, 400);
  setTimeout(fire, 1200); // fallback if onload doesn't fire
}

// ── Work order document (printable) ───────────────────────────────────────────
// A formatted work order with every relevant project detail. Rendered on screen
// inside #work-order-print and copied verbatim into the print window.
function WorkOrderDoc({ project, contact, title, status, salePrice, notes, cfg, size, styleLabel, styleMult, selectedOptions, shedproOptions = [], optionsSummary = '', optionPriceLines = [], monthlyPayment, pricing = {}, changeOrders = [], isMobile }) {
  // Show the at-a-glance pills only when the priced fallback ISN'T standing in for
  // them — otherwise the same options would appear twice (pills + priced lines).
  const usingPricedFallback = shedproOptions.length === 0 && !optionsSummary && optionPriceLines.length > 0;
  const dateStr = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const woNumber = project?.project_number ? `#${project.project_number}` : `#${String(project?.id || '').slice(0, 8).toUpperCase()}`;

  const customerName  = contact?.full_name || contact?.company_name || contact?.email || '—';
  const cityStateZip  = [contact?.city, contact?.state].filter(Boolean).join(', ') + (contact?.zip ? ` ${contact.zip}` : '');
  const builderName   = project?.contact?.owner?.full_name || project?.contact?.owner?.company_name || project?.builder_email || '—';
  const builderEmail  = project?.contact?.owner?.email || project?.builder_email || '';

  const renders = [
    project?.perspective_rendering_url,
    project?.rendering_url_1, project?.rendering_url_2, project?.rendering_url_3,
    project?.rendering_url_4, project?.layout_rendering_url,
  ].filter(Boolean);

  // Finishes & configured options that came from ShedPro (only the ones present).
  const finishes = [
    ['Siding type', project?.siding_type],
    ['Overhang', project?.overhang_size],
    ['Siding color', project?.siding_color],
    ['Trim color', project?.trim_color],
    ['Door color', project?.door_color],
    ['Roof color', project?.roof_color],
    ['Doors', project?.doors],
    ['Windows', project?.windows],
    ['Vents', project?.vents],
    ['Roof', project?.roof],
    ['Floor', project?.floor],
    ['Transom', project?.transom_package],
    ['Site prep', project?.site_prep],
    ['Building permit', project?.building_permit],
    ['Access', project?.access],
    ['Additional features', project?.additional_features],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  const salePriceNum = salePrice != null && String(salePrice).trim() !== '' ? parseFloat(salePrice) : null;

  return (
    <div id="work-order-print" style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding: isMobile ? 18 : 32 }}>
      {/* Letterhead */}
      <div style={{ borderBottom:`2px solid ${C.charcoal}`, paddingBottom:14, marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:16, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:700, color:C.charcoal }}>Urban Sheds Collective</div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, letterSpacing:'0.05em' }}>Give homeowners something worth having.</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:700, letterSpacing:'0.04em', color:C.charcoal }}>WORK ORDER</div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#777', marginTop:2 }}>{woNumber} · {dateStr}</div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#777', marginTop:2 }}>Status: {PROJECT_STATUS_LABELS[status] || status}</div>
        </div>
      </div>

      {/* Project title */}
      <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:600, color:C.charcoal, marginBottom:16 }}>{title}</div>

      {/* Customer / Builder */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:18 }}>
        <WoBlock label="Customer">
          <WoLine strong>{customerName}</WoLine>
          {contact?.company_name && contact.company_name !== customerName && <WoLine>{contact.company_name}</WoLine>}
          {contact?.address && <WoLine>{contact.address}</WoLine>}
          {cityStateZip.trim() && <WoLine>{cityStateZip}</WoLine>}
          {contact?.phone && <WoLine>{contact.phone}</WoLine>}
          {contact?.email && <WoLine>{contact.email}</WoLine>}
        </WoBlock>
        <WoBlock label="Builder">
          <WoLine strong>{builderName}</WoLine>
          {builderEmail && <WoLine>{builderEmail}</WoLine>}
          {project?.construction_date && <WoLine>Construction date: {project.construction_date}</WoLine>}
        </WoBlock>
      </div>

      {/* Shed specifications */}
      <WoSection title="Shed Specifications" />
      <div style={{ display:'flex', gap:24, flexWrap:'wrap', background:C.linen, borderRadius:4, padding:'12px 16px', marginBottom:16 }}>
        {[['Size', size], ['Style', styleLabel], ['Siding', cfg?.siding], ['Multiplier', styleMult != null ? `${styleMult}×` : '—']].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand }}>{k}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.charcoal }}>{v || '—'}</div>
          </div>
        ))}
      </div>

      {/* Selected option packages */}
      {selectedOptions.length > 0 && !usingPricedFallback && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:C.sand, marginBottom:6 }}>Options & Add-ons</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 10px' }}>
            {selectedOptions.map(o => (
              <span key={o.name} style={{ fontFamily:'DM Sans', fontSize:12, color:C.charcoal, background:C.linen, border:`1px solid ${C.linenDarker}`, borderRadius:3, padding:'3px 9px' }}>
                {o.name}{o.count > 1 ? ` ×${o.count}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Finishes & configured details */}
      {finishes.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Finishes & Configuration" />
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap:'12px 20px' }}>
            {finishes.map(([label, value]) => (
              <div key={label}>
                <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:C.sand }}>{label}</div>
                <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, marginTop:2, wordBreak:'break-word' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ShedPro itemized options & pricing (the "What's included" list on the quote).
          Prefer the structured shedpro_options array; fall back to the plain-text
          options_summary if that's all that synced. */}
      {shedproOptions.length > 0 ? (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Options & Pricing" />
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              {shedproOptions.map((o, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                  <td style={{ ...woTd, paddingRight:12 }}>
                    {o.label}
                    {o.detail && (
                      <span style={{ color:'#888' }}> — {o.detail}</span>
                    )}
                  </td>
                  <td style={{ ...woTd, textAlign:'right', whiteSpace:'nowrap', fontWeight:600 }}>
                    {o.price ? o.price : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : optionsSummary ? (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Options & Pricing" />
          <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, whiteSpace:'pre-wrap', lineHeight:1.6 }}>{optionsSummary}</div>
        </div>
      ) : optionPriceLines.length > 0 ? (
        // No ShedPro quote — price the selected option packages with the app's engine.
        <div style={{ marginBottom:16 }}>
          <WoSection title="Options & Pricing" />
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              {optionPriceLines.map((o, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                  <td style={{ ...woTd, paddingRight:12 }}>{o.label}</td>
                  <td style={{ ...woTd, textAlign:'right', whiteSpace:'nowrap', fontWeight:600 }}>{o.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Renderings */}
      {renders.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Renderings" />
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {renders.map((url, i) => (
              <img key={i} src={url} alt="" loading="lazy"
                style={{ width: isMobile ? 110 : 150, height: isMobile ? 82 : 112, objectFit:'cover', borderRadius:4, border:`1px solid ${C.linenDarker}`, background:C.linen }} />
            ))}
          </div>
        </div>
      )}

      {/* Change orders — line items added in-app after the sale */}
      {changeOrders.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Change Orders" />
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              {changeOrders.map((co, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                  <td style={{ ...woTd, paddingRight:12 }}>
                    {co.label}{co.detail && <span style={{ color:'#888' }}> — {co.detail}</span>}
                    {(co.created_at || co.created_by_name) && (
                      <div style={{ fontFamily:'DM Sans', fontSize:10.5, color:'#aaa', marginTop:1 }}>
                        Added {fmtCoDate(co.created_at)}{co.created_by_name ? ` by ${co.created_by_name}` : ''}
                      </div>
                    )}
                  </td>
                  <td style={{ ...woTd, textAlign:'right', whiteSpace:'nowrap', fontWeight:600 }}>{fmtCoPrice(co.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pricing */}
      <WoSection title="Pricing" />
      <table style={{ width:'100%', borderCollapse:'collapse', marginBottom: notes && notes.trim() ? 16 : 0 }}>
        <tbody>
          {pricing.materialCost != null && (
            <tr><td style={woTd}>Material cost <span style={{ color:'#aaa', fontSize:11 }}>(builder’s local prices)</span></td><td style={{ ...woTd, textAlign:'right', color:'#888' }}>{fmt(pricing.materialCost)}</td></tr>
          )}
          {pricing.licenseFee != null && (
            <tr><td style={woTd}>Urban Sheds licensing fee ({pricing.licenseRatePct}%)</td><td style={{ ...woTd, textAlign:'right' }}>{fmt(pricing.licenseFee)}</td></tr>
          )}
          {pricing.laborProfit != null && (
            <tr><td style={woTd}>Labor, overhead &amp; profit</td><td style={{ ...woTd, textAlign:'right' }}>{fmt(pricing.laborProfit)}</td></tr>
          )}
          {pricing.appCalcPrice != null && (
            <tr style={{ borderTop:`1px solid ${C.linen}` }}>
              <td style={{ ...woTd, fontWeight:600 }}>App calculated price</td>
              <td style={{ ...woTd, textAlign:'right', fontWeight:600 }}>{fmt(pricing.appCalcPrice)}</td>
            </tr>
          )}
          {pricing.hasChangeOrders ? (
            <>
              {/* Sale price stays visible as a line; change orders add on; final total leads. */}
              <tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
                <td style={{ ...woTd, paddingTop:8 }}>
                  Sale price <span style={{ color:'#999', fontSize:11 }}>· configurator</span>
                </td>
                <td style={{ ...woTd, paddingTop:8, textAlign:'right' }}>{salePriceNum != null ? fmt(salePriceNum) : '—'}</td>
              </tr>
              <tr>
                <td style={woTd}>Change orders</td>
                <td style={{ ...woTd, textAlign:'right' }}>+{fmt(pricing.changeOrdersTotal)}</td>
              </tr>
              <tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
                <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:20, color:C.charcoal }}>
                  Final total <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:400, color:'#999' }}>· incl. change orders</span>
                </td>
                <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, color:C.sage, textAlign:'right' }}>
                  {fmt(pricing.finalTotal)}
                </td>
              </tr>
            </>
          ) : (
            <tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
              <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:20, color:C.charcoal }}>
                Sale price <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:400, color:'#999' }}>· configurator</span>
              </td>
              <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, color:C.sage, textAlign:'right' }}>
                {salePriceNum != null ? fmt(salePriceNum) : '—'}
              </td>
            </tr>
          )}
          {monthlyPayment != null && String(monthlyPayment).trim() !== '' && (
            <tr>
              <td />
              <td style={{ padding:'2px 0 0', fontFamily:'DM Sans', fontSize:12, color:'#888', textAlign:'right' }}>
                or from {fmt(parseFloat(monthlyPayment))}/mo with financing
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Notes */}
      {notes && notes.trim() && (
        <div>
          <WoSection title="Notes" />
          <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{notes}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop:22, paddingTop:12, borderTop:`1px solid ${C.linenDarker}`, fontFamily:'DM Sans', fontSize:10, color:'#aaa', textAlign:'center' }}>
        Urban Sheds Collective · build.urban-sheds.com · Work order {woNumber}
      </div>
    </div>
  );
}

function WoSection({ title }) {
  return (
    <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#fff', background:C.sage, padding:'5px 10px', borderRadius:'3px 3px 0 0', marginBottom:10 }}>
      {title}
    </div>
  );
}

function WoBlock({ label, children }) {
  return (
    <div style={{ border:`1px solid ${C.linenDarker}`, borderRadius:4, padding:'12px 14px', background:'#fff' }}>
      <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand, marginBottom:6 }}>{label}</div>
      {children}
    </div>
  );
}

function WoLine({ children, strong }) {
  return (
    <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, fontWeight: strong ? 600 : 400, marginBottom:2, wordBreak:'break-word' }}>
      {children}
    </div>
  );
}

const woTd = { padding:'5px 0', fontFamily:'DM Sans', fontSize:13, color:C.charcoal };

// ── Mobile work-order reading view ────────────────────────────────────────────
// An app-style presentation of the same project, built for a phone instead of a
// shrunken sheet of paper. It leads with the rendering, puts the price up top,
// makes the customer's phone/email/address tappable, and stacks the tables. The
// printable paper doc (WorkOrderDoc) is unchanged — it's still what gets printed
// or saved to PDF from the sticky "Print / Save" button.
function MobileWorkOrder({ project, contact, status, salePrice, notes, cfg, size, styleLabel, styleMult, out, selectedOptions, shedproOptions = [], optionsSummary = '', optionPriceLines = [], monthlyPayment, pricing = {}, changeOrders = [] }) {
  // Hide the pills when the priced fallback covers the same options (see WorkOrderDoc).
  const usingPricedFallback = shedproOptions.length === 0 && !optionsSummary && optionPriceLines.length > 0;
  const woNumber = project?.project_number ? `#${project.project_number}` : `#${String(project?.id || '').slice(0, 8).toUpperCase()}`;

  const customerName = contact?.full_name || contact?.company_name || contact?.email || '—';
  const cityStateZip = [contact?.city, contact?.state].filter(Boolean).join(', ') + (contact?.zip ? ` ${contact.zip}` : '');
  const builderName  = project?.contact?.owner?.full_name || project?.contact?.owner?.company_name || project?.builder_email || '—';
  const builderEmail = project?.contact?.owner?.email || project?.builder_email || '';

  const renders = [
    project?.perspective_rendering_url,
    project?.rendering_url_1, project?.rendering_url_2, project?.rendering_url_3,
    project?.rendering_url_4, project?.layout_rendering_url,
  ].filter(Boolean);

  const finishes = [
    ['Siding type', project?.siding_type],
    ['Overhang', project?.overhang_size],
    ['Siding color', project?.siding_color],
    ['Trim color', project?.trim_color],
    ['Door color', project?.door_color],
    ['Roof color', project?.roof_color],
    ['Doors', project?.doors],
    ['Windows', project?.windows],
    ['Vents', project?.vents],
    ['Roof', project?.roof],
    ['Floor', project?.floor],
    ['Transom', project?.transom_package],
    ['Site prep', project?.site_prep],
    ['Building permit', project?.building_permit],
    ['Access', project?.access],
    ['Additional features', project?.additional_features],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  const salePriceNum = salePrice != null && String(salePrice).trim() !== '' ? parseFloat(salePrice) : null;
  const monthly = monthlyPayment != null && String(monthlyPayment).trim() !== '' ? parseFloat(monthlyPayment) : null;
  const specs = [['Size', size], ['Style', styleLabel], ['Siding', cfg?.siding], ['Multiplier', styleMult != null ? `${styleMult}×` : '—']];

  return (
    <div>
      {/* Hero — lead with the shed */}
      <WoGallery images={renders} />

      {/* Price headline — leads with the final total (incl. change orders) when there
          are any, keeping the configurator sale price visible just below. */}
      <div style={{ background:C.paper, border:`1px solid ${C.linenDarker}`, borderRadius:12, padding:'15px 16px', marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10 }}>
          <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sageDark }}>
            {pricing.hasChangeOrders ? 'Final total' : 'Sale price'}
          </span>
          <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#8C8478' }}>{woNumber} · {PROJECT_STATUS_LABELS[status] || status}</span>
        </div>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:38, fontWeight:700, color:C.sage, lineHeight:1.05, marginTop:1 }}>
          {pricing.hasChangeOrders
            ? fmt(pricing.finalTotal)
            : (salePriceNum != null ? fmt(salePriceNum) : '—')}
        </div>
        {pricing.hasChangeOrders && (
          <div style={{ fontFamily:'DM Sans', fontSize:12.5, color:C.inkLight, marginTop:2 }}>
            Sale price {salePriceNum != null ? fmt(salePriceNum) : '—'} + change orders {fmt(pricing.changeOrdersTotal)}
          </div>
        )}
        {monthly != null && (
          <div style={{ fontFamily:'DM Sans', fontSize:12.5, color:C.inkLight, marginTop:2 }}>or from {fmt(monthly)}/mo with financing</div>
        )}
        {out?.hasQty && (
          <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#8C8478', marginTop:6 }}>App calculated price {fmt(out.customerPrice)}</div>
        )}
      </div>

      {/* Specifications — clean 2×2 grid */}
      <MoSection title="Specifications">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 12px' }}>
          {specs.map(([k, v]) => (
            <div key={k} style={{ background:C.linen, borderRadius:8, padding:'10px 12px' }}>
              <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:C.sand }}>{k}</div>
              <div style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:C.charcoal, marginTop:2 }}>{v || '—'}</div>
            </div>
          ))}
        </div>
      </MoSection>

      {/* Customer — tappable on a phone */}
      <MoSection title="Customer">
        <div style={{ fontFamily:'DM Sans', fontSize:15, fontWeight:600, color:C.charcoal }}>{customerName}</div>
        {contact?.company_name && contact.company_name !== customerName && <div style={woMobLine}>{contact.company_name}</div>}
        {contact?.address && <div style={woMobLine}>{contact.address}</div>}
        {cityStateZip.trim() && <div style={woMobLine}>{cityStateZip}</div>}
        {contact?.phone && <div style={woMobLine}>{contact.phone}</div>}
        {contact?.email && <div style={{ ...woMobLine, wordBreak:'break-word' }}>{contact.email}</div>}
        <CustomerActions contact={contact} />
      </MoSection>

      {/* Builder */}
      <MoSection title="Builder">
        <div style={{ fontFamily:'DM Sans', fontSize:14.5, fontWeight:600, color:C.charcoal }}>{builderName}</div>
        {builderEmail && <div style={{ ...woMobLine, wordBreak:'break-word' }}>{builderEmail}</div>}
        {project?.construction_date && <div style={woMobLine}>Construction date: {project.construction_date}</div>}
      </MoSection>

      {/* Options & add-ons */}
      {selectedOptions.length > 0 && !usingPricedFallback && (
        <MoSection title="Options & Add-ons">
          <div style={{ display:'flex', flexWrap:'wrap', gap:'7px 8px' }}>
            {selectedOptions.map(o => (
              <span key={o.name} style={{ fontFamily:'DM Sans', fontSize:12.5, color:C.charcoal, background:C.linen, border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'5px 10px' }}>
                {o.name}{o.count > 1 ? ` ×${o.count}` : ''}
              </span>
            ))}
          </div>
        </MoSection>
      )}

      {/* Finishes & configuration */}
      {finishes.length > 0 && (
        <MoSection title="Finishes & Configuration">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 16px' }}>
            {finishes.map(([label, value]) => (
              <div key={label}>
                <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:C.sand }}>{label}</div>
                <div style={{ fontFamily:'DM Sans', fontSize:13.5, color:C.charcoal, marginTop:2, wordBreak:'break-word' }}>{value}</div>
              </div>
            ))}
          </div>
        </MoSection>
      )}

      {/* Options & pricing — stacked rows (no two-column table to overflow) */}
      {shedproOptions.length > 0 ? (
        <MoSection title="Options & Pricing">
          {shedproOptions.map((o, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom:`1px solid ${C.linen}` }}>
              <span style={{ fontFamily:'DM Sans', fontSize:13.5, color:C.charcoal }}>
                {o.label}{o.detail && <span style={{ color:'#8C8478' }}> — {o.detail}</span>}
              </span>
              <span style={{ fontFamily:'DM Sans', fontSize:13.5, fontWeight:600, color:C.charcoal, whiteSpace:'nowrap' }}>{o.price || '—'}</span>
            </div>
          ))}
        </MoSection>
      ) : optionsSummary ? (
        <MoSection title="Options & Pricing">
          <div style={{ fontFamily:'DM Sans', fontSize:13.5, color:C.charcoal, whiteSpace:'pre-wrap', lineHeight:1.6 }}>{optionsSummary}</div>
        </MoSection>
      ) : optionPriceLines.length > 0 ? (
        <MoSection title="Options & Pricing">
          {optionPriceLines.map((o, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom:`1px solid ${C.linen}` }}>
              <span style={{ fontFamily:'DM Sans', fontSize:13.5, color:C.charcoal }}>{o.label}</span>
              <span style={{ fontFamily:'DM Sans', fontSize:13.5, fontWeight:600, color:C.charcoal, whiteSpace:'nowrap' }}>{o.price}</span>
            </div>
          ))}
        </MoSection>
      ) : null}

      {/* Change orders — line items added in-app after the sale */}
      {changeOrders.length > 0 && (
        <MoSection title="Change Orders">
          {changeOrders.map((co, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom:`1px solid ${C.linen}` }}>
              <span style={{ fontFamily:'DM Sans', fontSize:13.5, color:C.charcoal }}>
                {co.label}{co.detail && <span style={{ color:'#8C8478' }}> — {co.detail}</span>}
                {(co.created_at || co.created_by_name) && (
                  <span style={{ display:'block', fontSize:11, color:'#aaa', marginTop:1 }}>
                    Added {fmtCoDate(co.created_at)}{co.created_by_name ? ` by ${co.created_by_name}` : ''}
                  </span>
                )}
              </span>
              <span style={{ fontFamily:'DM Sans', fontSize:13.5, fontWeight:600, color:C.charcoal, whiteSpace:'nowrap' }}>{fmtCoPrice(co.price)}</span>
            </div>
          ))}
        </MoSection>
      )}

      {/* Pricing summary */}
      <MoSection title="Pricing">
        {pricing.materialCost != null && <MoPriceRow label="Material cost" value={fmt(pricing.materialCost)} muted />}
        {pricing.licenseFee != null && <MoPriceRow label={`Urban Sheds licensing fee (${pricing.licenseRatePct}%)`} value={fmt(pricing.licenseFee)} />}
        {pricing.laborProfit != null && <MoPriceRow label="Labor, overhead & profit" value={fmt(pricing.laborProfit)} />}
        {pricing.appCalcPrice != null && <MoPriceRow label="App calculated price" value={fmt(pricing.appCalcPrice)} bold topBorder />}
        {pricing.hasChangeOrders && (
          <>
            <MoPriceRow label="Sale price · configurator" value={salePriceNum != null ? fmt(salePriceNum) : '—'} topBorder />
            <MoPriceRow label="Change orders" value={`+${fmt(pricing.changeOrdersTotal)}`} />
          </>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:8, paddingTop:10, borderTop:`1.5px solid ${C.linenDarker}` }}>
          <span style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, color:C.charcoal }}>
            {pricing.hasChangeOrders
              ? <>Final total <span style={{ fontFamily:'DM Sans', fontSize:10.5, fontWeight:400, color:'#999' }}>· incl. change orders</span></>
              : <>Sale price <span style={{ fontFamily:'DM Sans', fontSize:10.5, fontWeight:400, color:'#999' }}>· configurator</span></>}
          </span>
          <span style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:700, color:C.sage }}>
            {pricing.hasChangeOrders
              ? fmt(pricing.finalTotal)
              : (salePriceNum != null ? fmt(salePriceNum) : '—')}
          </span>
        </div>
        {monthly != null && (
          <div style={{ textAlign:'right', fontFamily:'DM Sans', fontSize:12, color:'#8C8478', marginTop:3 }}>or from {fmt(monthly)}/mo with financing</div>
        )}
      </MoSection>

      {/* Notes */}
      {notes && notes.trim() && (
        <MoSection title="Notes" last>
          <div style={{ fontFamily:'DM Sans', fontSize:13.5, color:C.charcoal, whiteSpace:'pre-wrap', lineHeight:1.55 }}>{notes}</div>
        </MoSection>
      )}
    </div>
  );
}

const woMobLine = { fontFamily:'DM Sans', fontSize:13.5, color:C.inkLight, marginTop:3 };

// A light section header for the mobile view: a small sage label over a hairline
// rule (calmer than the print doc's solid sage bars).
function MoSection({ title, children, last }) {
  return (
    <div style={{ marginBottom: last ? 4 : 20 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
        <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:C.sageDark, whiteSpace:'nowrap' }}>{title}</span>
        <span style={{ flex:1, height:1, background:C.linenDarker }} />
      </div>
      {children}
    </div>
  );
}

function MoPriceRow({ label, value, muted, bold, topBorder }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'6px 0', fontFamily:'DM Sans', fontSize:13.5, color: muted ? '#8C8478' : C.charcoal, fontWeight: bold ? 600 : 400, borderTop: topBorder ? `1px solid ${C.linen}` : 'none', marginTop: topBorder ? 4 : 0, paddingTop: topBorder ? 9 : 6 }}>
      <span>{label}</span><span style={{ whiteSpace:'nowrap' }}>{value}</span>
    </div>
  );
}

// Hero gallery for the mobile work order. One large image, or a scroll-snap
// carousel that lets the next rendering "peek" so it's obviously swipeable.
// Falls back to the on-brand line icon when a project has no renderings.
function WoGallery({ images }) {
  if (!images.length) {
    return (
      <div style={{ height:160, borderRadius:12, background:C.linen, border:`1px solid ${C.linenDarker}`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:20 }}>
        <ShedIcon size={52} />
      </div>
    );
  }
  if (images.length === 1) {
    return (
      <div style={{ borderRadius:12, overflow:'hidden', border:`1px solid ${C.linenDarker}`, background:C.linen, marginBottom:20 }}>
        <img src={images[0]} alt="" style={{ display:'block', width:'100%', height:230, objectFit:'contain', objectPosition:'center bottom' }} />
      </div>
    );
  }
  return (
    <div style={{ display:'flex', gap:10, overflowX:'auto', scrollSnapType:'x mandatory', WebkitOverflowScrolling:'touch', marginBottom:20, paddingBottom:4 }}>
      {images.map((u, i) => (
        <div key={i} style={{ flex:'0 0 86%', scrollSnapAlign:'center', borderRadius:12, overflow:'hidden', border:`1px solid ${C.linenDarker}`, background:C.linen }}>
          <img src={u} alt="" loading="lazy" style={{ display:'block', width:'100%', height:220, objectFit:'contain', objectPosition:'center bottom' }} />
        </div>
      ))}
    </div>
  );
}

// Tappable customer actions (Call / Text / Email / Map) — the same pattern as the
// ContactProfile bottom bar, but rendered inline inside the work order's Customer
// section. Native tel:/sms:/mailto:/Maps links so a builder can act from the job.
function CustomerActions({ contact }) {
  const tel  = (contact?.phone || '').replace(/[^0-9+]/g, '');
  const addr = [contact?.address, contact?.city, contact?.state, contact?.zip].filter(Boolean).join(', ');
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
  const btns = [
    contact?.phone && { icon:'📞', label:'Call',  href:`tel:${tel}` },
    contact?.phone && { icon:'💬', label:'Text',  href:`sms:${tel}` },
    contact?.email && { icon:'✉️', label:'Email', href:`mailto:${contact.email}` },
    maps && { icon:'🧭', label:'Map', href:maps, ext:true },
  ].filter(Boolean);
  if (!btns.length) return null;
  return (
    <div style={{ display:'flex', gap:8, marginTop:12 }}>
      {btns.map(b => (
        <a key={b.label} href={b.href} {...(b.ext ? { target:'_blank', rel:'noreferrer' } : {})}
          style={{
            flex:'1 1 0', minWidth:0, minHeight:52, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:3, textDecoration:'none',
            background:C.linen, color:C.charcoal, border:`1px solid ${C.linenDarker}`, borderRadius:10,
            fontFamily:'DM Sans', fontSize:11, fontWeight:600,
          }}>
          <span style={{ fontSize:18, lineHeight:1 }}>{b.icon}</span>{b.label}
        </a>
      ))}
    </div>
  );
}
