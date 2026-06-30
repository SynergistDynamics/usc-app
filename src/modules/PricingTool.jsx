// src/modules/PricingTool.jsx
import { useState, useMemo, useEffect } from 'react';
import {
  SHED_SIZES, C, fmt,
  applyOverride, getStyleMultiplier,
} from '../lib/supabase';
import { SectionHeader, Select, Button, WarningBanner, Badge, QuantityTicker } from '../components/UI';

// Stable keys in pkgOverrides for the base-shed and siding price overrides (option
// overrides are keyed by their real UUID package id, so these constants never collide).
// They let a manually-added project carry the ShedPro base + siding price.
export const BASE_PRICE_KEY = '__base__';
export const SIDING_PRICE_KEY = '__siding__';

// Parse a price-override value ("$1,200" / "1200" / "") → number or null (blank/bad).
function parsePkgOverride(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// Exported so the Projects feature can render the same materials list from a
// saved project's config (ProjectDetail.jsx) — same engine, one source of truth.
// `overridesOnly` (used for a manually-added project's work order): customer prices come
// ONLY from the entered price overrides — base/siding/options with no override price are
// $0, with NO material×multiplier or flat_rate fallback. Material costs are unaffected.
export function buildOutput({ size, stylePkgId, siding, selectedPkgs, pkgOverrides, styleMults, salesTax, materials, overrides, packages, pkgMaterials, pkgQuantities, overridesOnly = false }) {
  const taxMult = 1 + (parseFloat(salesTax) || 0) / 100;
  const matById = Object.fromEntries(materials.map(m => {
    const r = applyOverride(m, overrides);
    return [m.id, { ...r, price: r.price * taxMult }];
  }));

  const stylePkg    = (packages || []).find(p => p.id === stylePkgId && p.is_style);
  // Selectable add-on/option packages = everything that isn't a style or siding package.
  const regularPkgs = (packages || []).filter(p => !p.siding_type && !p.is_style);

  // Per-size quantity for a material inside the selected style package.
  const styleQty = (materialId) =>
    pkgQuantities.find(q => q.package_id === stylePkg?.id && q.material_id === materialId && q.shed_size === size)?.quantity ?? 0;

  const styleComponents = stylePkg ? pkgMaterials.filter(pm => pm.package_id === stylePkg.id) : [];
  const hasQty = !!stylePkg && styleComponents.some(pm => styleQty(pm.material_id) > 0);
  if (!hasQty) return { hasQty: false };

  const lineItems = [];
  const catGroups = {};
  const footnotes = [];
  const pkgGroups = [];
  let baseCost = 0, pkgCost = 0, pkgMatCost = 0;

  const addFn = url => { if (!url) return null; const i = footnotes.indexOf(url); if (i>=0) return i+1; footnotes.push(url); return footnotes.length; };

  function addCatLine(cat, name, qty, unitPrice, total, url, quote=false) {
    if (!catGroups[cat]) catGroups[cat] = { items:[], subtotal:0 };
    catGroups[cat].items.push({ name, qty, unitPrice, total, fn:addFn(url), quote });
    catGroups[cat].subtotal += total;
  }

  // ── Base materials (the selected shed style) ─────────────
  for (const pm of styleComponents) {
    const mat = matById[pm.material_id]; if (!mat) continue;
    const qty = styleQty(pm.material_id);
    if (!qty) continue;
    const total = qty * mat.price;
    lineItems.push({ group:'Base', name:mat.name, qty, unitPrice:mat.price, total });
    addCatLine(mat.category || 'Base', mat.name, qty, mat.price, total, mat.url);
    baseCost += total;
  }
  const styleMult    = getStyleMultiplier(styleMults, stylePkg);
  // A manually-set base price (ShedPro) overrides the calculated base × multiplier.
  // In overridesOnly mode an unset base price is $0 (no material×multiplier fallback).
  const baseOverride = parsePkgOverride(pkgOverrides?.[BASE_PRICE_KEY]);
  const baseCustomer = baseOverride != null ? baseOverride : (overridesOnly ? 0 : baseCost * styleMult);

  // ── Siding (package-backed) ──────────────────────────────
  // A manually-set siding price (ShedPro) overrides the calculated/quote price.
  const sidingOverride = parsePkgOverride(pkgOverrides?.[SIDING_PRICE_KEY]);
  if (siding === 'Western Red Cedar') {
    if (sidingOverride != null || overridesOnly) {
      const wrcPrice = sidingOverride ?? 0;
      lineItems.push({ group:'Siding', isSidingPkgTotal:true, name:'Western Red Cedar (set price)', sidingMatCost:0, sidingPkgPrice:wrcPrice });
      pkgGroups.push({ pkg:{ id:SIDING_PRICE_KEY, name:'Western Red Cedar' }, customerPkgPrice:wrcPrice, materialCost:0, subItems:[], hasFlat:true, isSidingPkg:true });
      pkgCost += wrcPrice;
    } else {
      lineItems.push({ group:'Siding', name:'Western Red Cedar', qty:'—', unitPrice:'—', total:0, quote:true });
      addCatLine('Siding', 'Western Red Cedar', 0, 0, 0, '', true);
    }
  } else if (siding && siding !== 'None') {
    const sidingKey = siding === 'T1-11' ? 't111' : siding === 'Clapboard' ? 'clapboard' : 'bAndB';
    const sidingPkg = (packages || []).find(p => p.siding_type === sidingKey);
    if (sidingPkg) {
      const components = pkgMaterials.filter(pm => pm.package_id === sidingPkg.id);
      const subItems = components.map(pm => {
        const mat = matById[pm.material_id]; if (!mat) return null;
        const qty = sidingPkg.size_variable
          ? (pkgQuantities.find(q => q.package_id === sidingPkg.id && q.material_id === pm.material_id && q.shed_size === size)?.quantity ?? 0)
          : (pm.fixed_quantity ?? 0);
        return { name:mat.name, qty, unitPrice:mat.price, total:qty*mat.price, fn:addFn(mat.url) };
      }).filter(Boolean);
      const sidingMatCost  = subItems.reduce((a,b) => a+b.total, 0);
      const sidingPkgPrice = sidingOverride != null ? sidingOverride : (overridesOnly ? 0 : sidingMatCost * (sidingPkg.multiplier ?? 1));
      subItems.forEach(sub => {
        lineItems.push({ group:'Siding', name:sub.name, qty:sub.qty, unitPrice:sub.unitPrice, total:sub.total, isSidingComponent:true });
      });
      lineItems.push({ group:'Siding', isSidingPkgTotal:true, name: (sidingOverride != null || overridesOnly) ? `${sidingPkg.name} (set price)` : `${sidingPkg.name} (${sidingPkg.multiplier}× multiplier)`, sidingMatCost, sidingPkgPrice });
      pkgGroups.push({ pkg:sidingPkg, customerPkgPrice:sidingPkgPrice, materialCost:sidingMatCost, subItems, hasFlat:false, isSidingPkg:true });
      pkgCost    += sidingPkgPrice;
      pkgMatCost += sidingMatCost;
    } else if (sidingOverride != null || overridesOnly) {
      const sPrice = sidingOverride ?? 0;
      lineItems.push({ group:'Siding', isSidingPkgTotal:true, name:`${siding} (set price)`, sidingMatCost:0, sidingPkgPrice:sPrice });
      pkgGroups.push({ pkg:{ id:SIDING_PRICE_KEY, name:siding }, customerPkgPrice:sPrice, materialCost:0, subItems:[], hasFlat:true, isSidingPkg:true });
      pkgCost += sPrice;
    } else {
      lineItems.push({ group:'Siding', name:`${siding} (no siding package configured)`, qty:'—', unitPrice:'—', total:0, quote:true });
      addCatLine('Siding', `${siding} (no siding package configured)`, 0, 0, 0, '', true);
    }
  }

  // ── Option packages (incl. former add-ons) ───────────────
  for (const pkg of regularPkgs) {
    const pkgCount = selectedPkgs[pkg.id] || 0;
    if (!pkgCount) continue;
    // Per-unit price override (e.g. the ShedPro option price); tolerates $/commas.
    const overrideNum = parsePkgOverride(pkgOverrides[pkg.id]);
    const components  = pkgMaterials.filter(pm => pm.package_id === pkg.id);

    // Scale sub-item quantities by pkgCount
    const subItems = components.map(pm => {
      const mat = matById[pm.material_id]; if (!mat) return null;
      const baseQty = pkg.size_variable
        ? (pkgQuantities.find(q => q.package_id === pkg.id && q.material_id === pm.material_id && q.shed_size === size)?.quantity ?? 0)
        : (pm.fixed_quantity ?? 0);
      const qty = baseQty * pkgCount;
      return { name:mat.name, qty, unitPrice:mat.price, total:qty*mat.price, fn:addFn(mat.url) };
    }).filter(Boolean);

    const materialCost = subItems.reduce((a,b) => a+b.total, 0);
    const calculatedUnit = materialCost / pkgCount * (pkg.multiplier ?? 1); // per-unit before flat override
    // overridesOnly: the price is the override or $0 (no flat_rate / material fallback).
    const useFlat = overrideNum != null ? overrideNum : (overridesOnly ? null : pkg.flat_rate);
    const unitPrice = overridesOnly
      ? (overrideNum != null ? overrideNum : 0)
      : ((useFlat != null && !isNaN(useFlat)) ? useFlat : (materialCost / pkgCount) * (pkg.multiplier ?? 1));
    const hasFlat = overridesOnly ? (overrideNum != null) : (useFlat != null && !isNaN(useFlat));
    const customerPkgPrice = unitPrice * pkgCount;
    const label = pkgCount > 1 ? `${pkg.name} (×${pkgCount})` : pkg.name;

    lineItems.push({ group:'Package', name:label, qty:pkgCount, customerPkgPrice, calculated:calculatedUnit*pkgCount, materialCost, hasFlat, subItems, pkgId:pkg.id });
    pkgGroups.push({ pkg, customerPkgPrice, materialCost, subItems, hasFlat, pkgCount });
    pkgCost    += customerPkgPrice;
    pkgMatCost += materialCost;
  }

  const customerPrice = baseCustomer + pkgCost;
  const totalMat      = baseCost + pkgMatCost;
  const laborProfit   = customerPrice - totalMat;

  return { hasQty:true, lineItems, catGroups, footnotes, pkgGroups, packages, matById,
           baseCost, baseCustomer, styleMult, pkgCost, pkgMatCost,
           customerPrice, totalMat, laborProfit };
}

// ── Config Panel ──────────────────────────────────────────────
// Exported for reuse on the project page (ProjectDetail.jsx). `editPrices` turns on a
// per-option price field (writes cfg.pkgOverrides) so a manually-added project can carry
// the ShedPro price for each selected option — used in the project Edit modal, off in
// the Materials Calculator.
export function ConfigPanel({ cfg, setCfg, packages, editPrices = false }) {
  const stylePkgs = (packages || []).filter(p => p.is_style);
  function set(k, v) { setCfg(p => ({ ...p, [k]: v })); }
  const setOverride = (key, v) => setCfg(p => ({ ...p, pkgOverrides:{ ...p.pkgOverrides, [key]: v } }));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Basic config */}
      <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:20 }}>
        <p style={glbl}>Configuration</p>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <div style={flbl}>Shed Size</div>
            <Select value={cfg.size} onChange={v=>set('size',v)} options={SHED_SIZES} />
          </div>
          <div>
            <div style={flbl}>Shed Style</div>
            <Select value={cfg.stylePkgId} onChange={v=>set('stylePkgId',v)}
              options={stylePkgs.length ? stylePkgs.map(p => ({ value:p.id, label:p.name })) : [{ value:'', label:'— no styles configured —' }]} />
            {editPrices && (
              <div style={{ marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#8C8478' }}>Base price (ShedPro)</span>
                <PriceField value={cfg.pkgOverrides?.[BASE_PRICE_KEY] ?? ''} onChange={v => setOverride(BASE_PRICE_KEY, v)} />
              </div>
            )}
          </div>
          <div>
            <div style={flbl}>Siding</div>
            <Select value={cfg.siding} onChange={v=>set('siding',v)} options={['T1-11','Clapboard','B&B','Western Red Cedar']} />
            {editPrices && (
              <div style={{ marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#8C8478' }}>Siding price (ShedPro)</span>
                <PriceField value={cfg.pkgOverrides?.[SIDING_PRICE_KEY] ?? ''} onChange={v => setOverride(SIDING_PRICE_KEY, v)} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Option packages (incl. former add-ons) */}
      <OptionsPanel cfg={cfg} setCfg={setCfg} packages={packages} editPrices={editPrices} />
    </div>
  );
}

// $-prefixed price input for a selected option's ShedPro price (writes cfg.pkgOverrides).
function PriceField({ value, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'stretch', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, background:'#fff', overflow:'hidden', width:104, flexShrink:0 }}>
      <span style={{ display:'flex', alignItems:'center', padding:'0 7px', background:C.linen, color:'#8C8478', fontFamily:'DM Sans', fontSize:12, fontWeight:600 }}>$</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="0.00" inputMode="decimal"
        style={{ border:'none', outline:'none', background:'transparent', padding:'6px 8px', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, width:'100%', minWidth:0, textAlign:'right' }} />
    </div>
  );
}

function OptionsPanel({ cfg, setCfg, packages, editPrices = false }) {
  const regularPkgs = (packages || []).filter(p => !p.siding_type && !p.is_style);

  const allItems = regularPkgs.map(pkg => ({
    id: pkg.id, label: pkg.name,
    allow_quantity: pkg.allow_quantity,
    flat_rate: pkg.flat_rate,
    count: cfg.selectedPkgs[pkg.id] || 0,
    setCount: v => setCfg(p => ({ ...p, selectedPkgs:{ ...p.selectedPkgs, [pkg.id]:v } })),
    price: cfg.pkgOverrides?.[pkg.id] ?? '',
    setPrice: v => setCfg(p => ({ ...p, pkgOverrides:{ ...p.pkgOverrides, [pkg.id]:v } })),
  }));

  const countable = allItems.filter(i => i.allow_quantity);
  const boolean   = allItems.filter(i => !i.allow_quantity);

  if (!allItems.length) return null;

  return (
    <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:20 }}>
      {/* Countable items — quantity tickers */}
      {countable.length > 0 && (
        <div style={{ marginBottom: boolean.length > 0 ? 16 : 0 }}>
          <p style={glbl}>Quantity</p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {countable.map(item => (
              <div key={item.id}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <QuantityTicker value={item.count} min={0} onChange={item.setCount} />
                  <span style={{ fontFamily:'DM Sans', fontSize:13, color: item.count > 0 ? C.charcoal : '#999', flex:1 }}>
                    {item.label}{editPrices && item.count > 1 ? <span style={{ color:'#aaa', fontSize:11 }}> (each)</span> : ''}
                  </span>
                  {editPrices ? (
                    item.count > 0 && <PriceField value={item.price} onChange={item.setPrice} />
                  ) : (
                    item.flat_rate != null && item.count > 0 && (
                      <span style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, fontWeight:600 }}>{fmt(item.flat_rate)}</span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      {countable.length > 0 && boolean.length > 0 && (
        <div style={{ borderTop:`1px solid ${C.linenDarker}`, marginBottom:14 }} />
      )}

      {/* Boolean items — checkboxes */}
      {boolean.length > 0 && (
        <div>
          <p style={glbl}>Options</p>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {boolean.map(item => (
              <div key={item.id} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, flex:1, minWidth:0 }}>
                  <input type="checkbox" checked={item.count > 0}
                    onChange={e => item.setCount(e.target.checked ? 1 : 0)}
                    style={{ accentColor:C.sage, width:13, height:13, flexShrink:0 }} />
                  <span style={{ flex:1, minWidth:0 }}>{item.label}</span>
                </label>
                {editPrices ? (
                  item.count > 0 && <PriceField value={item.price} onChange={item.setPrice} />
                ) : (
                  item.flat_rate != null && item.count > 0 && (
                    <span style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, fontWeight:600 }}>{fmt(item.flat_rate)}</span>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Materials List Tab ────────────────────────────────────────
// Exported for reuse on the project page (ProjectDetail.jsx).
export function MaterialsListTab({ out, cfg, size, style, multiplier, isMobile }) {
  const CAT_ORDER = ['Framing','Sheathing','Roofing','Siding','Trim','Hardware','Add-ons'];
  const dateStr = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});

  function printList() {
    const el = document.getElementById('print-area');
    if (!el) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>USC Materials List</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'DM Sans', sans-serif; padding: 32px; color: #3C3C3C; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 800);
  }

  function exportCSV() {
    const rows = [['Category','Material','Qty','Unit Price','Line Total']];
    CAT_ORDER.forEach(cat => {
      const g = out.catGroups[cat]; if (!g) return;
      g.items.forEach(li => rows.push([cat, li.name, li.qty, li.unitPrice, li.total]));
    });
    out.pkgGroups.forEach(({ pkg, customerPkgPrice, subItems }) => {
      rows.push(['Package', pkg.name, 1, customerPkgPrice, customerPkgPrice]);
      subItems.forEach(sub => rows.push(['  Component', sub.name, sub.qty, sub.unitPrice, sub.total]));
    });
    rows.push([],['','Material Cost','','',out.totalMat],['','Labor & Profit','','',out.laborProfit],['','Customer Price','','',out.customerPrice]);
    const csv = rows.map(r=>r.map(c=>`"${c??''}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`usc_${size}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  }

  return (
    <>
      <div id="print-area" style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding: isMobile ? 16 : 28, marginBottom:14 }}>
        {/* Header */}
        <div style={{ borderBottom:`2px solid ${C.charcoal}`, paddingBottom:14, marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
          <div>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, color:C.charcoal }}>Urban Sheds Collective</div>
            <div style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, letterSpacing:'0.05em' }}>Give homeowners something worth having.</div>
          </div>
          <div style={{ fontFamily:'DM Sans', fontSize:10, color:'#999', textAlign:'right' }}>
            <div>{dateStr}</div><div>Materials List</div>
          </div>
        </div>

        {/* Spec block */}
        <div style={{ background:C.linen, borderRadius:4, padding:'10px 14px', marginBottom:16, display:'flex', gap:20, flexWrap:'wrap' }}>
          {[['Size',size],['Style',style],['Siding',cfg.siding],['Multiplier',`${multiplier}×`]].map(([k,v])=>(
            <div key={k}>
              <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand }}>{k}</div>
              <div style={{ fontFamily:'DM Sans', fontSize:12, fontWeight:600, color:C.charcoal }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Regular categories */}
        {CAT_ORDER.map(cat => {
          const g = out.catGroups[cat]; if (!g) return null;
          return (
            <div key={cat} style={{ marginBottom:16 }}>
              <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#fff', background:C.sage, padding:'5px 10px', borderRadius:'3px 3px 0 0' }}>{cat}</div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr style={{ background:C.linen }}>
                  {['Material','Qty','Unit','Total'].map(h=>(
                    <th key={h} style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textAlign:h==='Material'?'left':'right', color:'#666' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {g.items.map((li,i)=>(
                    <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                      <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, color:C.charcoal }}>{li.name}{li.fn?<sup style={{color:C.sage,fontSize:8}}>[{li.fn}]</sup>:''}</td>
                      <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, textAlign:'right', color:'#666' }}>{li.quote?'—':li.qty}</td>
                      <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, textAlign:'right', color:'#666' }}>{li.quote?'—':fmt(li.unitPrice)}</td>
                      <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, textAlign:'right', fontWeight:600 }}>{li.quote?<Badge color="sand">Quote</Badge>:fmt(li.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
                  <td colSpan={3} style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:11, fontWeight:700 }}>Subtotal</td>
                  <td style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:12, fontWeight:700, textAlign:'right' }}>{fmt(g.subtotal)}</td>
                </tr></tfoot>
              </table>
            </div>
          );
        })}

        {/* Package groups */}
        {out.pkgGroups.map(({ pkg, customerPkgPrice, materialCost, subItems, hasFlat, isSidingPkg }) => (
          <div key={pkg.id} style={{ marginBottom:16 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#fff', background:'#1A1510', padding:'5px 10px', borderRadius:'3px 3px 0 0', display:'flex', justifyContent:'space-between' }}>
              <span>{isSidingPkg ? 'Siding Package' : 'Package'} — {pkg.name}</span>
              <span style={{ fontWeight:400, color:'rgba(255,255,255,0.45)', textTransform:'none', letterSpacing:0 }}>
                {hasFlat ? 'flat rate' : `${pkg.multiplier}× multiplier`}
              </span>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr style={{ background:C.linen }}>
                {['Component','Qty','Unit','Mat. Cost'].map(h=>(
                  <th key={h} style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textAlign:h==='Component'?'left':'right', color:'#666' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {subItems.map((sub,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                    <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, color:C.charcoal }}>{sub.name}{sub.fn?<sup style={{color:C.sage,fontSize:8}}>[{sub.fn}]</sup>:''}</td>
                    <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, textAlign:'right', color:'#666' }}>{sub.qty}</td>
                    <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, textAlign:'right', color:'#666' }}>{fmt(sub.unitPrice)}</td>
                    <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, textAlign:'right', color:'#888' }}>{fmt(sub.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
                  <td colSpan={2} style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:11, fontWeight:700 }}>Material Cost</td>
                  <td style={{ padding:'5px 10px', textAlign:'right', fontFamily:'DM Sans', fontSize:11, color:'#888' }}>{fmt(materialCost)}</td>
                  <td/>
                </tr>
                <tr style={{ background:C.linen }}>
                  <td colSpan={2} style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:12, fontWeight:700 }}>Customer Price {hasFlat?'(flat)':''}</td>
                  <td/>
                  <td style={{ padding:'6px 10px', fontFamily:'Cormorant Garamond, serif', fontSize:16, fontWeight:700, textAlign:'right', color:C.sage }}>{fmt(customerPkgPrice)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        {/* Totals */}
        <div style={{ marginTop:20, borderTop:`2px solid ${C.charcoal}`, paddingTop:14 }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              <tr><td style={trs}>Material Cost</td><td style={{ ...trs, textAlign:'right', color:'#888' }}>{fmt(out.totalMat)}</td></tr>
              <tr><td style={trs}>Labor & Profit ({multiplier}×)</td><td style={{ ...trs, textAlign:'right', fontWeight:700 }}>{fmt(out.laborProfit)}</td></tr>
              <tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
                <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:20, color:C.charcoal }}>Customer Price</td>
                <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, color:C.sage, textAlign:'right' }}>{fmt(out.customerPrice)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footnotes */}
        {out.footnotes.length > 0 && (
          <div style={{ marginTop:16, paddingTop:10, borderTop:`1px solid ${C.linenDarker}` }}>
            <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#999', marginBottom:5 }}>Supplier References</div>
            {out.footnotes.map((url,i)=>(
              <div key={i} style={{ fontFamily:'DM Sans', fontSize:10, color:'#666', marginBottom:2 }}>
                <sup>[{i+1}]</sup> <a href={url} style={{ color:C.sage }}>{url}</a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:10, flexDirection: isMobile ? 'column' : 'row' }}>
        <Button onClick={printList} style={isMobile ? { width:'100%' } : {}}>↓ PDF (Print)</Button>
        <Button variant="secondary" onClick={exportCSV} style={isMobile ? { width:'100%' } : {}}>↓ Export CSV</Button>
      </div>
    </>
  );
}

// ── Main export ───────────────────────────────────────────────
export default function PricingTool({ materials, overrides, packages, pkgMaterials, pkgQuantities, styleMults }) {
  const stylePkgs = useMemo(() => (packages || []).filter(p => p.is_style), [packages]);

  const [cfg, setCfg] = useState({
    size: SHED_SIZES[0],
    stylePkgId: '',
    siding: 'T1-11',
    selectedPkgs: {}, pkgOverrides: {},
  });

  // Fall back to the first style package until the user picks one (styles load async).
  const stylePkgId = cfg.stylePkgId || stylePkgs[0]?.id || '';

  const salesTax = localStorage.getItem('usc_sales_tax') || '0';

  // Track mobile viewport
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const out = useMemo(() => buildOutput({
    ...cfg, stylePkgId, styleMults, salesTax, materials, overrides, packages, pkgMaterials, pkgQuantities,
  }), [cfg, stylePkgId, styleMults, salesTax, materials, overrides, packages, pkgMaterials, pkgQuantities]);

  const stylePkg   = stylePkgs.find(p => p.id === stylePkgId);
  const styleLabel = stylePkg?.name || '—';
  const styleMult  = out.styleMult ?? getStyleMultiplier(styleMults, stylePkg);

  return (
    <div>
      <SectionHeader sub="Configure your shed to generate a full materials list.">
        Materials List Generator
      </SectionHeader>

      <div style={{
        display:'grid',
        gridTemplateColumns: isMobile ? '1fr' : '280px 1fr',
        gap:20, alignItems:'start',
      }}>

        {/* ── Left: Config ── */}
        <div style={{ position: isMobile ? 'static' : 'sticky', top:16 }}>
          <ConfigPanel cfg={{ ...cfg, stylePkgId }} setCfg={setCfg} packages={packages} />
        </div>

        {/* ── Right: Output ── */}
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
    </div>
  );
}

const glbl = { fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, margin:'0 0 12px' };
const flbl = { fontFamily:'DM Sans', fontSize:11, color:'#888', marginBottom:4 };
const trs  = { padding:'5px 0', fontFamily:'DM Sans', fontSize:13, color:C.charcoal };
