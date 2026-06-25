// src/modules/ConfiguratorPricing.jsx
import { useState, useEffect } from 'react';
import { supabase, SHED_SIZES, C, fmt, applyOverride, packageMaterialCost } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { SectionHeader, Button, ErrorBanner, SuccessBanner, WarningBanner } from '../components/UI';
import MaterialPriceManager from './MaterialPriceManager';
import PackageManager from './PackageManager';

export default function ConfiguratorPricing({ materials, overrides, setOverrides, packages, pkgMaterials, pkgQuantities, styleMults, onRefresh }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [activeTab,         setActiveTab]         = useState('base');
  const [isMobile,          setIsMobile]          = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  const [builders,          setBuilders]          = useState([]);
  const [selectedBuilder,   setSelectedBuilder]   = useState('master');
  const [builderOverrides,  setBuilderOverrides]  = useState(null);
  const [builderSalesTax,   setBuilderSalesTax]   = useState(null);
  const [builderStyleMults, setBuilderStyleMults] = useState(null);
  const [multEdits,         setMultEdits]         = useState({});  // package_id -> in-progress string
  const [saving,            setSaving]            = useState(false);
  const [error,             setError]             = useState('');
  const [success,           setSuccess]           = useState('');

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('profiles').select('id, full_name, email, market, role').order('full_name')
      .then(({ data }) => setBuilders((data || []).filter(p => p.role !== 'blocked')));
  }, [isAdmin]);

  async function selectBuilder(builderId) {
    setSelectedBuilder(builderId);
    setMultEdits({});
    if (builderId === 'master') { setBuilderOverrides(null); setBuilderSalesTax(null); setBuilderStyleMults(null); return; }
    const [{ data: ovData }, { data: profData }, { data: smData }] = await Promise.all([
      supabase.from('material_overrides').select('*').eq('user_id', builderId),
      supabase.from('profiles').select('sales_tax').eq('id', builderId).single(),
      supabase.from('style_multipliers').select('*').eq('user_id', builderId),
    ]);
    setBuilderOverrides(Object.fromEntries((ovData || []).map(o => [o.material_id, o])));
    setBuilderSalesTax(profData?.sales_tax ?? null);
    setBuilderStyleMults(Object.fromEntries((smData || []).map(s => [s.package_id, s.multiplier])));
  }

  // ── Viewing context ───────────────────────────────────────
  const viewingBuilder = isAdmin && selectedBuilder !== 'master';
  const viewingMaster  = isAdmin && selectedBuilder === 'master';
  const viewingOwn     = !isAdmin;
  // Admin edits the package default (master); each builder edits their own. Admin previewing a
  // builder sees that builder's values read-only (the builder sets their own).
  const canEditMult    = viewingMaster || viewingOwn;
  const builderName    = builders.find(b => b.id === selectedBuilder)?.full_name || 'Builder';

  const activeOverrides = builderOverrides !== null ? builderOverrides : overrides;
  const ownSalesTax = localStorage.getItem('usc_sales_tax') ?? (profile?.sales_tax != null ? String(profile.sales_tax) : '0');
  const salesTax = viewingBuilder && builderSalesTax !== null ? String(builderSalesTax) : ownSalesTax;
  const taxMult  = 1 + (parseFloat(salesTax) || 0) / 100;
  const matById  = Object.fromEntries(materials.map(m => {
    const r = applyOverride(m, activeOverrides);
    return [m.id, { ...r, price: r.price * taxMult }];
  }));

  const stylePkgs   = (packages || []).filter(p => p.is_style);
  const regularPkgs = (packages || []).filter(p => !p.siding_type && !p.is_style);
  const sidingPkgs  = (packages || []).filter(p => p.siding_type);

  function styleMultFor(pkg) {
    if (viewingBuilder) return builderStyleMults?.[pkg.id] ?? pkg.multiplier;
    if (viewingOwn)     return styleMults?.[pkg.id] ?? pkg.multiplier;
    return pkg.multiplier;
  }

  function styleCustomerPrice(pkg, size) {
    const cost = packageMaterialCost(pkg, pkgMaterials, pkgQuantities, matById, size);
    if (cost === null) return null;
    const m = parseFloat(styleMultFor(pkg)) || 1;
    return cost * m;
  }

  function pkgPrice(pkg, size) {
    const cost = packageMaterialCost(pkg, pkgMaterials, pkgQuantities, matById, size);
    if (cost === null) return null;
    return pkg.flat_rate != null ? pkg.flat_rate : cost * (pkg.multiplier ?? 1);
  }

  async function saveStyleMult(pkg) {
    const raw = multEdits[pkg.id];
    if (raw === undefined) return;
    const m = parseFloat(raw);
    if (isNaN(m) || m <= 0) { setError('Multiplier must be greater than 0.'); return; }
    setSaving(true); setError('');
    let e;
    if (viewingMaster) {
      ({ error: e } = await supabase.from('packages').update({ multiplier: m, updated_at: new Date().toISOString() }).eq('id', pkg.id));
    } else {
      const uid = viewingBuilder ? selectedBuilder : profile.id;
      ({ error: e } = await supabase.from('style_multipliers')
        .upsert({ user_id: uid, package_id: pkg.id, multiplier: m, updated_at: new Date().toISOString() }, { onConflict: 'user_id,package_id' }));
      if (!e && viewingBuilder) setBuilderStyleMults(p => ({ ...(p || {}), [pkg.id]: m }));
    }
    setSaving(false);
    if (e) { setError(e.message); return; }
    setMultEdits(p => { const n = { ...p }; delete n[pkg.id]; return n; });
    setSuccess('Multiplier saved.');
    onRefresh();
  }

  // Sizes that any style has quantities for.
  const sizesWithQty = SHED_SIZES.filter(s => stylePkgs.some(pkg => packageMaterialCost(pkg, pkgMaterials, pkgQuantities, matById, s) !== null));
  const sizesNoQty   = SHED_SIZES.filter(s => !sizesWithQty.includes(s));
  const hasAnyQty    = sizesWithQty.length > 0;
  const refSize      = sizesWithQty[0] || SHED_SIZES[0];

  const sizeGroups = {};
  for (const s of sizesWithQty) { const w = s.split('x')[0]; if (!sizeGroups[w]) sizeGroups[w] = []; sizeGroups[w].push(s); }

  function exportCSV() {
    const rows = [['Size', ...stylePkgs.map(p => p.name)]];
    sizesWithQty.forEach(size => rows.push([size, ...stylePkgs.map(p => { const v = styleCustomerPrice(p, size); return v !== null ? v.toFixed(2) : '—'; })]));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `usc_configurator_pricing.csv`; a.click();
  }

  // ── Generic pricing grid (sizes × columns) ────────────────
  function PricingGrid({ cols, getCellValue }) {
    if (!sizesWithQty.length) return <WarningBanner>No quantities on file.</WarningBanner>;
    return (
      <div className="usc-table-scroll" style={{ overflow:'auto', borderRadius:6, border:`1px solid ${C.linenDarker}`, marginBottom:28 }}>
        <table style={{ borderCollapse:'collapse', width:'100%', minWidth:160+cols.length*130 }}>
          <thead>
            <tr style={{ background:'#1A1510' }}>
              <th style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'rgba(255,255,255,0.4)', textAlign:'left', minWidth:90, position:'sticky', left:0, background:'#1A1510', zIndex:11, borderRight:`1px solid rgba(255,255,255,0.08)` }}>Size</th>
              {cols.map((col,i)=>(
                <th key={i} style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'rgba(255,255,255,0.7)', textAlign:'right', minWidth:120, whiteSpace:'nowrap' }}>
                  <div>{col.label}</div>
                  {col.note&&<div style={{ fontFamily:'DM Sans', fontSize:9, color:'#B8986A', fontWeight:500, textTransform:'none', letterSpacing:0, marginTop:1 }}>{col.note}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(sizeGroups).map(([width,sizes])=>(
              <>
                <tr key={`sep-${width}`} style={{ background:C.linenDarker }}>
                  <td colSpan={cols.length+1} style={{ padding:'4px 16px', fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#888' }}>{width} ft wide</td>
                </tr>
                {sizes.map((size,ri)=>(
                  <tr key={size} style={{ borderBottom:`1px solid ${C.linenDarker}`, background:ri%2===0?'#FFFDF9':C.linen }}>
                    <td style={{ padding:'9px 16px', fontFamily:'Cormorant Garamond, serif', fontSize:16, fontWeight:600, color:'#1A1A1A', position:'sticky', left:0, background:ri%2===0?'#FFFDF9':C.linen, zIndex:5, borderRight:`1px solid ${C.linenDarker}`, whiteSpace:'nowrap' }}>{size}</td>
                    {cols.map((col,i)=>{ const val=getCellValue(col,size); return (
                      <td key={i} style={{ padding:'9px 16px', fontFamily:'DM Sans', fontSize:13, fontWeight:600, textAlign:'right', color:val!==null?'#1A1A1A':'#ddd' }}>{val!==null?fmt(val):'—'}</td>
                    ); })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Base Pricing tab ──────────────────────────────────────
  function BaseTab() {
    if (!stylePkgs.length) return <WarningBanner>No shed styles configured yet. Add them under Packages → Shed Styles.</WarningBanner>;
    return (
      <>
        {/* Per-style multiplier editor */}
        <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:20, marginBottom:24 }}>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#aaa', marginBottom:2 }}>Style Multipliers</div>
            <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>
              {viewingBuilder
                ? `Read-only — these are ${builderName}'s personal multipliers.`
                : viewingMaster
                  ? 'Default multiplier per style (used until a builder sets their own).'
                  : 'Set your own multiplier for each shed style.'}
            </div>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {stylePkgs.map(pkg => {
              const display = multEdits[pkg.id] ?? String(styleMultFor(pkg) ?? '');
              const pending = multEdits[pkg.id] !== undefined && multEdits[pkg.id] !== String(styleMultFor(pkg) ?? '');
              return (
                <div key={pkg.id} style={{ background:C.linen, border:`1px solid ${pending?C.sage:C.linenDarker}`, borderRadius:6, padding:'12px 16px', minWidth:180 }}>
                  <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:17, fontWeight:600, color:'#1A1A1A', marginBottom:8 }}>{pkg.name}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <input type="number" min="0" step="0.1" value={display} readOnly={!canEditMult}
                      onChange={e => setMultEdits(p => ({ ...p, [pkg.id]: e.target.value }))}
                      style={{ width:72, padding:'6px 10px', border:`1.5px solid ${C.sage}`, borderRadius:4, fontFamily:'DM Sans', fontSize:16, fontWeight:700, textAlign:'center', background:canEditMult?'#FFFDF9':'#EFF6EE', color:'#1A1A1A', cursor:canEditMult?'text':'default' }} />
                    <span style={{ fontFamily:'DM Sans', fontSize:14, color:'#888' }}>×</span>
                    {canEditMult && pending && (
                      <Button size="sm" onClick={() => saveStyleMult(pkg)} loading={saving}>Save</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pricing grid */}
        {!hasAnyQty ? <WarningBanner>No quantities on file yet. Add them under Packages → Shed Styles.</WarningBanner> : (
          <>
            {sizesNoQty.length>0 && <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#bbb', marginBottom:12 }}>{sizesNoQty.length} size{sizesNoQty.length>1?'s':''} hidden — no quantities: {sizesNoQty.join(', ')}</div>}
            <PricingGrid
              cols={stylePkgs.map(pkg => ({ label:pkg.name, note:`${styleMultFor(pkg)}× multiplier`, getValue:(size)=>styleCustomerPrice(pkg,size) }))}
              getCellValue={(col,size)=>col.getValue(size)}
            />
          </>
        )}
      </>
    );
  }

  // ── Siding tab ────────────────────────────────────────────
  function SidingTab() {
    if (!sidingPkgs.length) return <WarningBanner>No siding packages configured. Add them under Packages → Siding.</WarningBanner>;
    return (
      <PricingGrid
        cols={sidingPkgs.map(pkg => ({ label:pkg.name, note: pkg.flat_rate!=null?'flat rate':`${pkg.multiplier}× multiplier`, getValue:(size)=>pkgPrice(pkg,size) }))}
        getCellValue={(col,size)=>col.getValue(size)}
      />
    );
  }

  // ── Fixed price options tab ───────────────────────────────
  function FixedOptionsTab() {
    const fixedPkgs = regularPkgs.filter(p => !p.size_variable);
    if (!fixedPkgs.length) return <WarningBanner>No fixed price options configured.</WarningBanner>;
    return (
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:28 }}>
        {fixedPkgs.map(pkg => { const price = pkgPrice(pkg, refSize); return (
          <div key={pkg.id} style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'14px 18px', minWidth:160 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:17, fontWeight:600, color:'#1A1A1A', marginBottom:6 }}>{pkg.name}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:18, fontWeight:700, color:C.sage }}>{price!==null?fmt(price):'—'}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:10, color:'#aaa', marginTop:3 }}>{pkg.flat_rate!=null?'flat rate':`${pkg.multiplier}× multiplier`}</div>
          </div>
        ); })}
      </div>
    );
  }

  // ── Size-variable options tab ─────────────────────────────
  function VariableOptionsTab() {
    const variablePkgs = regularPkgs.filter(p => p.size_variable);
    if (!variablePkgs.length) return <WarningBanner>No size-variable options configured.</WarningBanner>;
    return (
      <PricingGrid
        cols={variablePkgs.map(pkg => ({ label:pkg.name, note:`${pkg.multiplier}× multiplier`, getValue:(size)=>pkgPrice(pkg,size) }))}
        getCellValue={(col,size)=>col.getValue(size)}
      />
    );
  }

  // Tabs: the four pricing views, plus the management tools (Material Prices for
  // everyone, Packages for admins) that used to live in the sidebar submenu.
  const PRICING_TABS = [['base','Base Pricing'],['siding','Siding'],['fixed','Fixed Price Options'],['variable','Size-Variable Options']];
  const MANAGE_TABS  = isAdmin ? [['materials','Material Prices'],['packages','Packages']] : [['materials','Material Prices']];
  const TABS = [...PRICING_TABS, ...MANAGE_TABS];
  const isPricingTab = PRICING_TABS.some(([key]) => key === activeTab);

  return (
    <div>
      <SectionHeader sub="Customer pricing by size and style. Style multipliers are per-builder; manage materials and packages in the tabs below.">Configurator Pricing</SectionHeader>

      {error   && <ErrorBanner onDismiss={()=>setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Builder selector — only relevant to the pricing tabs */}
      {isPricingTab && isAdmin && builders.length > 0 && (
        <div style={{ marginBottom:20, display:'flex', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 6 : 12, flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#aaa' }}>Viewing pricing for:</div>
          <select value={selectedBuilder} onChange={e=>selectBuilder(e.target.value)}
            style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, padding:'8px 14px', border:`2px solid ${selectedBuilder!=='master'?C.sage:C.linenDarker}`, borderRadius:5, background:'#FFFDF9', color:'#1A1A1A', cursor:'pointer', minWidth: isMobile ? 0 : 220, width: isMobile ? '100%' : 'auto' }}>
            <option value="master">Master Prices (default)</option>
            {builders.filter(b=>b.role!=='admin').map(b=>(
              <option key={b.id} value={b.id}>{b.full_name||b.email}{b.market?` — ${b.market}`:''}</option>
            ))}
          </select>
          {selectedBuilder!=='master'&&<div style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, background:'#EFF6EE', borderRadius:4, padding:'4px 10px' }}>● {builderName}'s prices</div>}
        </div>
      )}

      {/* Top controls */}
      {isPricingTab && hasAnyQty && (
        <div style={{ marginBottom:24 }}>
          <Button variant="secondary" size="sm" onClick={exportCSV}>↓ Export CSV</Button>
        </div>
      )}

      {/* Tabs */}
      <div className="usc-table-scroll" style={{ display:'flex', gap:0, marginBottom:20, borderBottom:`2px solid ${C.linenDarker}`, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible' }}>
        {TABS.map(([key,label])=>(
          <button key={key} onClick={()=>setActiveTab(key)} style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding: isMobile ? '10px 14px' : '10px 20px', border:'none', cursor:'pointer', background:'transparent', color:activeTab===key?C.sage:'#aaa', borderBottom:activeTab===key?`2px solid ${C.sage}`:'2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0 }}>{label}</button>
        ))}
      </div>

      {activeTab==='base'     && BaseTab()}
      {activeTab==='siding'   && SidingTab()}
      {activeTab==='fixed'    && FixedOptionsTab()}
      {activeTab==='variable' && VariableOptionsTab()}
      {activeTab==='materials' && (
        <MaterialPriceManager materials={materials} overrides={overrides} setOverrides={setOverrides} onMasterUpdated={onRefresh} />
      )}
      {activeTab==='packages' && isAdmin && (
        <PackageManager materials={materials} overrides={overrides} packages={packages} pkgMaterials={pkgMaterials} pkgQuantities={pkgQuantities} onRefresh={onRefresh} />
      )}
    </div>
  );
}
