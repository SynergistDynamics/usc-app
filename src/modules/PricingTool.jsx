// src/modules/PricingTool.jsx
import { useState, useMemo, useEffect } from 'react';
import {
  SHED_SIZES, SHED_STYLES, C, fmt,
  applyOverride, buildQtyMap, getMaterialIdsByGroup, getAddonOptions,
} from '../lib/supabase';
import { SectionHeader, Select, Input, Button, WarningBanner, Badge, QuantityTicker } from '../components/UI';

// ── shared calc helpers ───────────────────────────────────────
function calcPackagePrice(pkg, pkgMaterials, pkgQuantities, matById, size) {
  let total = 0;
  const components = pkgMaterials.filter(pm => pm.package_id === pkg.id);
  for (const pm of components) {
    const mat = matById[pm.material_id]; if (!mat) continue;
    const qty = pkg.size_variable
      ? (size ? (pkgQuantities.find(q => q.package_id === pkg.id && q.material_id === pm.material_id && q.shed_size === size)?.quantity ?? 0) : 0)
      : (pm.fixed_quantity ?? 0);
    total += qty * mat.price;
  }
  return total * (pkg.multiplier ?? 1);
}

function buildOutput({ size, siding, selectedPkgs, pkgOverrides, addons, multiplier, salesTax, materials, overrides, quantities, packages, pkgMaterials, pkgQuantities }) {
  const taxMult = 1 + (parseFloat(salesTax) || 0) / 100;
  const matById     = Object.fromEntries(materials.map(m => {
    const r = applyOverride(m, overrides);
    return [m.id, { ...r, price: r.price * taxMult }];
  }));
  const qtyMap      = buildQtyMap(quantities);
  const BASE_IDS    = getMaterialIdsByGroup(materials, 'base');
  const ADDON_OPTIONS = getAddonOptions(materials);
  const regularPkgs = (packages || []).filter(p => !p.siding_type);

  const hasQty = BASE_IDS.some(id => id !== 't111' && (qtyMap[id]?.[size] ?? null) !== null);
  if (!hasQty) return { hasQty: false };

  const lineItems   = [];
  const catGroups   = {};
  const footnotes   = [];
  const pkgGroups   = [];
  let baseCost = 0, sidingCost = 0, pkgCost = 0, pkgMatCost = 0, addonCost = 0;

  const addFn = url => { if (!url) return null; const i = footnotes.indexOf(url); if (i>=0) return i+1; footnotes.push(url); return footnotes.length; };

  function addCatLine(cat, name, qty, unitPrice, total, url, quote=false) {
    if (!catGroups[cat]) catGroups[cat] = { items:[], subtotal:0 };
    catGroups[cat].items.push({ name, qty, unitPrice, total, fn:addFn(url), quote });
    catGroups[cat].subtotal += total;
  }

  // ── Siding ──────────────────────────────────────────────
  if (siding === 'T1-11') {
    // Check for a T1-11 siding package first, fall back to direct material
    const t111Pkg = (packages || []).find(p => p.siding_type === 't111');
    if (t111Pkg) {
      const components = pkgMaterials.filter(pm => pm.package_id === t111Pkg.id);
      const subItems = components.map(pm => {
        const mat = matById[pm.material_id]; if (!mat) return null;
        const qty = t111Pkg.size_variable
          ? (pkgQuantities.find(q => q.package_id === t111Pkg.id && q.material_id === pm.material_id && q.shed_size === size)?.quantity ?? 0)
          : (pm.fixed_quantity ?? 0);
        return { name:mat.name, qty, unitPrice:mat.price, total:qty*mat.price, fn:addFn(mat.url) };
      }).filter(Boolean);
      const sidingMatCost  = subItems.reduce((a,b) => a+b.total, 0);
      const sidingPkgPrice = sidingMatCost * (t111Pkg.multiplier ?? 1);
      subItems.forEach(sub => {
        lineItems.push({ group:'Siding', name:sub.name, qty:sub.qty, unitPrice:sub.unitPrice, total:sub.total, isSidingComponent:true });
      });
      lineItems.push({ group:'Siding', isSidingPkgTotal:true, name:`${t111Pkg.name} (${t111Pkg.multiplier}× multiplier)`, sidingMatCost, sidingPkgPrice });
      pkgGroups.push({ pkg:t111Pkg, customerPkgPrice:sidingPkgPrice, materialCost:sidingMatCost, subItems, hasFlat:false, isSidingPkg:true });
      pkgCost    += sidingPkgPrice;
      pkgMatCost += sidingMatCost;
    } else {
      const mat = matById['t111']; if (mat) {
        const qty = qtyMap['t111']?.[size] ?? 0;
        if (qty) {
          sidingCost = qty * mat.price;
          lineItems.push({ group:'Siding', name:mat.name, qty, unitPrice:mat.price, total:sidingCost });
          addCatLine('Siding', mat.name, qty, mat.price, sidingCost, mat.url);
        }
      }
    }
  } else if (siding === 'Western Red Cedar') {
    lineItems.push({ group:'Siding', name:'Western Red Cedar', qty:'—', unitPrice:'—', total:0, quote:true });
    addCatLine('Siding', 'Western Red Cedar', 0, 0, 0, '', true);
  } else {
    const sidingKey = siding === 'Clapboard' ? 'clapboard' : 'bAndB';
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
      const sidingPkgPrice = sidingMatCost * (sidingPkg.multiplier ?? 1);
      subItems.forEach(sub => {
        lineItems.push({ group:'Siding', name:sub.name, qty:sub.qty, unitPrice:sub.unitPrice, total:sub.total, isSidingComponent:true });
        // Note: intentionally NOT added to catGroups — siding pkg components are shown via pkgGroups in MaterialsListTab
      });
      lineItems.push({ group:'Siding', isSidingPkgTotal:true, name:`${sidingPkg.name} (${sidingPkg.multiplier}× multiplier)`, sidingMatCost, sidingPkgPrice });
      pkgGroups.push({ pkg:sidingPkg, customerPkgPrice:sidingPkgPrice, materialCost:sidingMatCost, subItems, hasFlat:false, isSidingPkg:true });
      pkgCost    += sidingPkgPrice;
      pkgMatCost += sidingMatCost;
    } else {
      const matId = siding === 'Clapboard' ? 'clapboard' : 'bAndB';
      const mat = matById[matId]; if (mat) {
        const qty = qtyMap[matId]?.[size] ?? 0;
        sidingCost = qty * mat.price;
        lineItems.push({ group:'Siding', name:mat.name, qty, unitPrice:mat.price, total:sidingCost });
        addCatLine('Siding', mat.name, qty, mat.price, sidingCost, mat.url);
      }
    }
  }

  // ── Base materials ───────────────────────────────────────
  for (const id of BASE_IDS) {
    if (id === 't111') continue;
    const mat = matById[id]; if (!mat) continue;
    const qty = qtyMap[id]?.[size] ?? 0;
    if (!qty) continue;
    const total = qty * mat.price;
    lineItems.push({ group:'Base', name:mat.name, qty, unitPrice:mat.price, total });
    addCatLine(mat.category, mat.name, qty, mat.price, total, mat.url);
    baseCost += total;
  }

  // ── Regular packages ─────────────────────────────────────
  for (const pkg of regularPkgs) {
    const pkgCount = selectedPkgs[pkg.id] || 0;
    if (!pkgCount) continue;
    const overrideVal = pkgOverrides[pkg.id];
    const useFlat     = overrideVal !== undefined && overrideVal !== '' ? parseFloat(overrideVal) : pkg.flat_rate;
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
    const unitPrice = (useFlat != null && !isNaN(useFlat)) ? useFlat : (materialCost / pkgCount) * (pkg.multiplier ?? 1);
    const customerPkgPrice = unitPrice * pkgCount;
    const label = pkgCount > 1 ? `${pkg.name} (×${pkgCount})` : pkg.name;

    lineItems.push({ group:'Package', name:label, qty:pkgCount, customerPkgPrice, calculated:calculatedUnit*pkgCount, materialCost, hasFlat:useFlat!=null&&!isNaN(useFlat), subItems, pkgId:pkg.id });
    pkgGroups.push({ pkg, customerPkgPrice, materialCost, subItems, hasFlat:useFlat!=null&&!isNaN(useFlat), pkgCount });
    pkgCost    += customerPkgPrice;
    pkgMatCost += materialCost;
  }

  // ── Add-ons ──────────────────────────────────────────────
  for (const ao of ADDON_OPTIONS) {
    const aoCount = addons[ao.key] || 0;
    if (!aoCount) continue;
    const mat = matById[ao.matId]; if (!mat) continue;
    const baseQty = qtyMap[ao.matId]?.[size] ?? 0;
    const qty = baseQty * aoCount;  // scale by count
    if (!qty) continue;
    const total = qty * mat.price;
    const label = aoCount > 1 ? `${mat.name} (×${aoCount})` : mat.name;
    lineItems.push({ group:'Add-on', name:label, qty, unitPrice:mat.price, total });
    addCatLine('Add-ons', label, qty, mat.price, total, mat.url);
    addonCost += total;
  }

  const mult          = parseFloat(multiplier) || 2.5;
  const baseMat       = baseCost + sidingCost + addonCost;
  const customerPrice = (baseMat * mult) + pkgCost;
  const totalMat      = baseMat + pkgMatCost;
  const laborProfit   = customerPrice - totalMat;

  return { hasQty:true, lineItems, catGroups, footnotes, pkgGroups, packages, matById,
           baseCost, sidingCost, addonCost, pkgCost, pkgMatCost,
           mult, baseMat, customerPrice, totalMat, laborProfit };
}

// ── Config Panel ──────────────────────────────────────────────
function ConfigPanel({ cfg, setCfg, packages, pkgMaterials, pkgQuantities, matById, qtyMap }) {
  const regularPkgs = (packages || []).filter(p => !p.siding_type);
  const ADDON_OPTIONS = getAddonOptions([]);

  function set(k, v) { setCfg(p => ({ ...p, [k]: v })); }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Basic config */}
      <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:20 }}>
        <p style={glbl}>Configuration</p>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            ['Shed Size',  <Select value={cfg.size}  onChange={v=>set('size',v)}  options={SHED_SIZES} />],
            ['Shed Style', <Select value={cfg.style} onChange={v=>set('style',v)} options={SHED_STYLES} />],
            ['Siding',     <Select value={cfg.siding} onChange={v=>set('siding',v)} options={['T1-11','Clapboard','B&B','Western Red Cedar']} />],
            // Multiplier managed in Calculator Settings → Quantity Tables
          ].map(([label, el]) => (
            <div key={label}>
              <div style={flbl}>{label}</div>
              {el}
            </div>
          ))}
        </div>
      </div>

      {/* Unified options panel — packages + add-ons merged, countable/boolean separated */}
      <OptionsPanel cfg={cfg} setCfg={setCfg} packages={packages} />
    </div>
  );
}

function OptionsPanel({ cfg, setCfg, packages }) {
  const ADDON_OPTIONS = cfg._addonOptions || [];
  const regularPkgs   = (packages || []).filter(p => !p.siding_type);

  // Build unified item list
  const allItems = [
    ...regularPkgs.map(pkg => ({
      type: 'pkg', id: pkg.id, label: pkg.name,
      allow_quantity: pkg.allow_quantity,
      flat_rate: pkg.flat_rate,
      count: cfg.selectedPkgs[pkg.id] || 0,
      setCount: v => setCfg(p => ({ ...p, selectedPkgs:{ ...p.selectedPkgs, [pkg.id]:v } })),
      override: cfg.pkgOverrides[pkg.id] ?? '',
      setOverride: v => setCfg(p => ({ ...p, pkgOverrides:{ ...p.pkgOverrides, [pkg.id]:v } })),
    })),
    ...ADDON_OPTIONS.map(ao => ({
      type: 'addon', id: ao.key, label: ao.label,
      allow_quantity: ao.allow_quantity,
      count: cfg.addons[ao.key] || 0,
      setCount: v => setCfg(p => ({ ...p, addons:{ ...p.addons, [ao.key]:v } })),
    })),
  ];

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
                    {item.label}
                  </span>
                  {item.flat_rate != null && item.count > 0 && (
                    <span style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, fontWeight:600 }}>{fmt(item.flat_rate)}</span>
                  )}
                </div>
                {item.type === 'pkg' && item.count > 0 && (
                  <div style={{ marginTop:5 }}>
                    <input type="number" min="0" value={item.override}
                      onChange={e => item.setOverride(e.target.value)}
                      placeholder="Override unit price"
                      style={{ width:'100%', padding:'4px 8px', border:`1px solid ${C.linenDarker}`, borderRadius:3, fontFamily:'DM Sans', fontSize:11, background:C.linen, boxSizing:'border-box', color:'#888' }} />
                  </div>
                )}
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
              <div key={item.id}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontFamily:'DM Sans', fontSize:13, color:C.charcoal }}>
                  <input type="checkbox" checked={item.count > 0}
                    onChange={e => item.setCount(e.target.checked ? 1 : 0)}
                    style={{ accentColor:C.sage, width:13, height:13 }} />
                  <span style={{ flex:1 }}>{item.label}</span>
                  {item.flat_rate != null && item.count > 0 && (
                    <span style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, fontWeight:600 }}>{fmt(item.flat_rate)}</span>
                  )}
                </label>
                {item.type === 'pkg' && item.count > 0 && (
                  <div style={{ marginTop:5, marginLeft:21 }}>
                    <input type="number" min="0" value={item.override}
                      onChange={e => item.setOverride(e.target.value)}
                      placeholder="Override price"
                      style={{ width:'100%', padding:'4px 8px', border:`1px solid ${C.linenDarker}`, borderRadius:3, fontFamily:'DM Sans', fontSize:11, background:C.linen, boxSizing:'border-box', color:'#888' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pricing Tab ───────────────────────────────────────────────
function PricingTab({ out, packages, multiplier }) {
  const groups = [
    { key:'Base',    label:'Base Materials' },
    { key:'Siding',  label:'Siding' },
    { key:'Package', label:'Packages' },
    { key:'Add-on',  label:'Add-ons' },
  ];

  return (
    <div>
      {/* Line items */}
      <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:20, marginBottom:16 }}>
        {groups.map(g => {
          const items = out.lineItems.filter(li => li.group === g.key);
          if (!items.length) return null;
          const subtotal = g.key === 'Package'
            ? items.reduce((a,b) => a+(b.customerPkgPrice||0), 0)
            : g.key === 'Siding'
              ? items.filter(li=>!li.isSidingComponent).reduce((a,b) => a+(b.total||0)+(b.sidingPkgPrice||0), 0)
              : items.reduce((a,b) => a+(b.total||0), 0);
          return (
            <div key={g.key} style={{ marginBottom:16 }}>
              <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sage, paddingBottom:5, borderBottom:`1px solid ${C.linenDarker}`, marginBottom:4 }}>
                {g.label}
                {g.key==='Package' && <span style={{ fontWeight:400, color:'#bbb', marginLeft:8, textTransform:'none', letterSpacing:0, fontSize:10 }}>own multiplier — not subject to base multiplier</span>}
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <tbody>
                  {items.map((li, i) => (
                    li.isSidingPkgTotal ? (
                      <tr key={i} style={{ background:C.linenDark, borderBottom:`1px solid ${C.linenDarker}` }}>
                        <td style={{ ...tdN, fontWeight:700 }}>{li.name}</td>
                        <td style={tdR}/>
                        <td style={{ ...tdR, fontSize:11, color:'#aaa' }}>mat: {fmt(li.sidingMatCost)}</td>
                        <td style={{ ...tdR, fontWeight:700, color:C.sage }}>{fmt(li.sidingPkgPrice)}</td>
                      </tr>
                    ) : li.isSidingComponent ? (
                      <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                        <td style={{ ...tdN, paddingLeft:14, color:'#888', fontSize:12 }}>↳ {li.name}</td>
                        <td style={{ ...tdR, fontSize:12, color:'#aaa' }}>{li.qty}</td>
                        <td style={{ ...tdR, fontSize:12, color:'#aaa' }}>{fmt(li.unitPrice)}</td>
                        <td style={{ ...tdR, fontSize:12, color:'#888' }}>{fmt(li.total)}</td>
                      </tr>
                    ) : li.subItems ? (
                      <>
                        <tr key={`ph-${i}`} style={{ background:C.linen }}>
                          <td style={{ ...tdN, fontWeight:700, paddingTop:6 }}>
                            {li.name}
                            {li.hasFlat ? <span style={{ marginLeft:6 }}><Badge color="sand">flat rate</Badge></span>
                              : <span style={{ fontFamily:'DM Sans', fontSize:11, color:'#aaa', marginLeft:6 }}>{(packages||[]).find(p=>p.id===li.pkgId)?.multiplier}×</span>}
                          </td>
                          <td style={tdR}/>
                          <td style={{ ...tdR, fontSize:11, color:'#aaa' }}>mat: {fmt(li.materialCost)}</td>
                          <td style={{ ...tdR, fontWeight:700, color:C.sage }}>{fmt(li.customerPkgPrice)}</td>
                        </tr>
                        {li.subItems.map((sub,j) => (
                          <tr key={`ps-${i}-${j}`} style={{ borderBottom:`1px solid ${C.linen}` }}>
                            <td style={{ ...tdN, paddingLeft:14, color:'#888', fontSize:12 }}>↳ {sub.name}</td>
                            <td style={{ ...tdR, fontSize:12, color:'#aaa' }}>{sub.qty}</td>
                            <td style={{ ...tdR, fontSize:12, color:'#aaa' }}>{fmt(sub.unitPrice)}</td>
                            <td style={{ ...tdR, fontSize:12, color:'#888' }}>{fmt(sub.total)}</td>
                          </tr>
                        ))}
                      </>
                    ) : (
                      <tr key={i} style={{ borderBottom:`1px solid ${C.linen}` }}>
                        <td style={tdN}>{li.name}</td>
                        <td style={tdR}>{li.qty==='—'?'—':li.qty}</td>
                        <td style={tdR}>{li.unitPrice==='—'?'—':fmt(li.unitPrice)}</td>
                        <td style={{ ...tdR, fontWeight:600, color:C.charcoal }}>
                          {li.quote ? <Badge color="sand">Quote</Badge> : fmt(li.total)}
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding:'5px 0 0', fontFamily:'DM Sans', fontSize:11, fontWeight:700 }}>
                      {g.key==='Package' ? 'Package Total (customer price)' : 'Subtotal'}
                    </td>
                    <td style={{ padding:'5px 0 0', fontFamily:'DM Sans', fontSize:12, fontWeight:700, textAlign:'right' }}>{fmt(subtotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </div>

      {/* Totals card */}
      <div style={{ background:'#1A1510', borderRadius:6, padding:24 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:20 }}>
          {[
            ['Material Cost', fmt(out.totalMat), '#fff'],
            ['Labor & Profit', fmt(out.laborProfit), '#fff'],
            ['Customer Price', fmt(out.customerPrice), C.sageLight],
          ].map(([label, val, color]) => (
            <div key={label}>
              <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, marginBottom:3 }}>{label}</div>
              <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:label==='Customer Price'?30:22, fontWeight:700, color }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Materials List Tab ────────────────────────────────────────
function MaterialsListTab({ out, cfg, size, style, multiplier, isMobile }) {
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
export default function PricingTool({ materials, overrides, quantities, packages, pkgMaterials, pkgQuantities }) {
  const ADDON_OPTIONS = useMemo(() => getAddonOptions(materials), [materials]);

  const [cfg, setCfg] = useState({
    size: SHED_SIZES[0], style: SHED_STYLES[0],
    siding: 'T1-11',
    selectedPkgs: {}, pkgOverrides: {}, addons: {},
    _addonOptions: [],
  });

  // Multiplier is managed in Quantity Tables settings — read live from localStorage
  const multiplier = localStorage.getItem('usc_multiplier') || '2.5';
  const salesTax   = localStorage.getItem('usc_sales_tax') || '0';

  // Track mobile viewport
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep _addonOptions in sync without causing infinite loop
  useMemo(() => {
    setCfg(p => ({ ...p, _addonOptions: getAddonOptions(materials) }));
  }, [materials]);

  const out = useMemo(() => buildOutput({
    ...cfg, multiplier, salesTax, materials, overrides, quantities, packages, pkgMaterials, pkgQuantities,
  }), [cfg, multiplier, salesTax, materials, overrides, quantities, packages, pkgMaterials, pkgQuantities]);

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
          <ConfigPanel cfg={cfg} setCfg={setCfg} packages={packages} pkgMaterials={pkgMaterials} pkgQuantities={pkgQuantities} matById={Object.fromEntries(materials.map(m=>[m.id,applyOverride(m,overrides)]))} isMobile={isMobile} />
        </div>

        {/* ── Right: Output ── */}
        <div style={{ minWidth:0 }}>
          {!out.hasQty ? (
            <WarningBanner>No quantities on file for size {cfg.size}. Add them in the Quantity Tables module.</WarningBanner>
          ) : (
            <MaterialsListTab out={out} cfg={cfg} size={cfg.size} style={cfg.style} multiplier={multiplier} isMobile={isMobile} />
          )}
        </div>
      </div>
    </div>
  );
}

const glbl = { fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, margin:'0 0 12px' };
const flbl = { fontFamily:'DM Sans', fontSize:11, color:'#888', marginBottom:4 };
const tdN  = { padding:'5px 0', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, width:'50%' };
const tdR  = { padding:'5px 8px', fontFamily:'DM Sans', fontSize:13, color:'#666', textAlign:'right' };
const trs  = { padding:'5px 0', fontFamily:'DM Sans', fontSize:13, color:C.charcoal };
