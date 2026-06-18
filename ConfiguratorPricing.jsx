// src/modules/ConfiguratorPricing.jsx
import { useState, useMemo, useEffect } from 'react';
import { supabase, SHED_SIZES, C, fmt, applyOverride, buildQtyMap, getMaterialIdsByGroup, getAddonOptions } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { SectionHeader, Button, ErrorBanner, SuccessBanner, Modal, FormField, Input, WarningBanner } from '../components/UI';

export default function ConfiguratorPricing({ materials, overrides, quantities, styles, setStyles, packages, pkgMaterials, pkgQuantities }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [activeTab,         setActiveTab]         = useState('base');
  const [isMobile,          setIsMobile]          = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  const [builders,          setBuilders]          = useState([]);
  const [selectedBuilder,   setSelectedBuilder]   = useState('master');
  const [builderOverrides,  setBuilderOverrides]  = useState(null);
  const [builderMultiplier, setBuilderMultiplier] = useState(null);
  const [builderSalesTax,   setBuilderSalesTax]   = useState(null);
  const ownMultiplier = String(profile?.multiplier || localStorage.getItem('usc_multiplier') || '2.5');
  const [ownMultiplierState, setOwnMultiplierState] = useState(ownMultiplier);
  const multiplier = selectedBuilder !== 'master' && builderMultiplier !== null ? String(builderMultiplier) : ownMultiplierState;

  // Style management state
  const [editingStyle, setEditingStyle] = useState(null);
  const [editVals,     setEditVals]     = useState({});
  const [showAdd,      setShowAdd]      = useState(false);
  const [newStyle,     setNewStyle]     = useState({ name:'', markup:'0' });
  const [adding,       setAdding]       = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [deleteId,     setDeleteId]     = useState(null);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

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

  async function saveMultiplier(val) {
    setOwnMultiplierState(val);
    localStorage.setItem('usc_multiplier', val);
    if (profile?.id) await supabase.from('profiles').update({ multiplier: parseFloat(val)||2.5 }).eq('id', profile.id);
  }

  async function selectBuilder(builderId) {
    setSelectedBuilder(builderId);
    if (builderId === 'master') { setBuilderOverrides(null); setBuilderMultiplier(null); setBuilderSalesTax(null); return; }
    const [{ data: ovData }, { data: profData }] = await Promise.all([
      supabase.from('material_overrides').select('*').eq('user_id', builderId),
      supabase.from('profiles').select('multiplier, sales_tax').eq('id', builderId).single(),
    ]);
    setBuilderOverrides(Object.fromEntries((ovData||[]).map(o=>[o.material_id,o])));
    setBuilderMultiplier(profData?.multiplier ?? null);
    setBuilderSalesTax(profData?.sales_tax ?? null);
  }

  const activeOverrides = builderOverrides !== null ? builderOverrides : overrides;

  async function refreshStyles() {
    const { data } = await supabase.from('styles').select('*').order('sort_order');
    setStyles(data || []);
  }

  async function saveStyle(style) {
    const markup = parseFloat(editVals.markup);
    if (isNaN(markup)||markup<0) { setError('Markup must be 0 or greater.'); return; }
    setSaving(true); setError('');
    const { error: e } = await supabase.from('styles').update({ name:editVals.name?.trim()||style.name, markup, updated_at:new Date().toISOString() }).eq('id', style.id);
    if (e) { setError(e.message); setSaving(false); return; }
    await refreshStyles(); setSaving(false); setEditingStyle(null); setSuccess('Style updated.');
  }

  async function addStyle() {
    if (!newStyle.name.trim()) { setError('Name is required.'); return; }
    const markup = parseFloat(newStyle.markup);
    if (isNaN(markup)||markup<0) { setError('Markup must be 0 or greater.'); return; }
    setAdding(true); setError('');
    const maxOrder = Math.max(0, ...styles.map(s=>s.sort_order||0));
    const { error: e } = await supabase.from('styles').insert({ name:newStyle.name.trim(), markup, sort_order:maxOrder+1 });
    if (e) { setError(e.message); setAdding(false); return; }
    await refreshStyles(); setAdding(false); setShowAdd(false); setNewStyle({name:'',markup:'0'});
    setSuccess(`"${newStyle.name.trim()}" added.`);
  }

  async function deleteStyle(id) {
    setSaving(true);
    await supabase.from('styles').delete().eq('id', id);
    await refreshStyles(); setSaving(false); setDeleteId(null); setSuccess('Style deleted.');
  }

  // ── Pricing calc ─────────────────────────────────────────
  const ownSalesTax = localStorage.getItem('usc_sales_tax') ?? (profile?.sales_tax != null ? String(profile.sales_tax) : '0');
  const salesTax = selectedBuilder !== 'master' && builderSalesTax !== null ? String(builderSalesTax) : ownSalesTax;
  const taxMult  = 1 + (parseFloat(salesTax) || 0) / 100;
  const matById  = Object.fromEntries(materials.map(m => {
    const r = applyOverride(m, activeOverrides);
    return [m.id, { ...r, price: r.price * taxMult }];
  }));
  const qtyMap   = buildQtyMap(quantities);
  const BASE_IDS = getMaterialIdsByGroup(materials, 'base').filter(id => id !== 't111');
  const mult     = parseFloat(multiplier) || 2.5;

  function baseCost(size) {
    let total = 0, hasAny = false;
    for (const id of BASE_IDS) {
      const mat = matById[id]; if (!mat) continue;
      const qty = qtyMap[id]?.[size] ?? null;
      if (qty === null) continue;
      total += qty * mat.price; hasAny = true;
    }
    return hasAny ? total : null;
  }

  function customerPrice(size, style) {
    const base = baseCost(size); if (base === null) return null;
    const markup = style ? (parseFloat(style.markup)||0)/100 : 0;
    return base * (1 + markup) * mult;
  }

  const sizesWithQty = SHED_SIZES.filter(s => BASE_IDS.some(id => (qtyMap[id]?.[s]??null)!==null));
  const sizesNoQty   = SHED_SIZES.filter(s => !sizesWithQty.includes(s));
  const hasAnyQty    = sizesWithQty.length > 0;

  const sizeGroups = useMemo(() => {
    const groups = {};
    for (const s of sizesWithQty) { const w=s.split('x')[0]; if(!groups[w]) groups[w]=[]; groups[w].push(s); }
    return groups;
  }, [sizesWithQty]);

  function exportCSV() {
    const rows = [['Size',...styles.map(s=>s.name)]];
    sizesWithQty.forEach(size => rows.push([size,...styles.map(s=>{ const p=customerPrice(size,s); return p!==null?p.toFixed(2):'—'; })]));
    const csv = rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`usc_configurator_pricing_${mult}x.csv`; a.click();
  }

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
          <tfoot>
            <tr style={{ background:'#1A1510' }}>
              <td colSpan={cols.length+1} style={{ padding:'8px 16px', fontFamily:'DM Sans', fontSize:9, color:'rgba(255,255,255,0.25)', fontStyle:'italic' }}>
                {mult}× multiplier applied · customer prices
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const ADDON_OPTIONS  = getAddonOptions(materials);
  const regularPkgs   = (packages||[]).filter(p=>!p.siding_type);
  const sidingPkgs    = (packages||[]).filter(p=>p.siding_type);

  function sidingCost(matId, size) {
    const mat=matById[matId]; if(!mat) return null;
    const qty=qtyMap[matId]?.[size]??null; if(qty===null) return null;
    return qty*mat.price*mult;
  }

  function pkgPrice(pkg, size) {
    const components=pkgMaterials.filter(pm=>pm.package_id===pkg.id);
    let total=0, hasAny=false;
    for (const pm of components) {
      const mat=matById[pm.material_id]; if(!mat) continue;
      const qty=pkg.size_variable
        ? (pkgQuantities.find(q=>q.package_id===pkg.id&&q.material_id===pm.material_id&&q.shed_size===size)?.quantity??null)
        : (pm.fixed_quantity??null);
      if(qty===null&&!pkg.size_variable){const fq=pm.fixed_quantity??0; total+=fq*mat.price; hasAny=true; continue;}
      if(qty===null) continue;
      total+=qty*mat.price; hasAny=true;
    }
    if(!hasAny) return null;
    const raw=total*(pkg.multiplier??1);
    return pkg.flat_rate!=null ? pkg.flat_rate : raw;
  }

  function addonCost(matId, size) {
    const mat=matById[matId]; if(!mat) return null;
    const qty=qtyMap[matId]?.[size]??null; if(qty===null) return null;
    return qty*mat.price*mult;
  }

  const SIDING_OPTIONS = [
    { label:'T1-11 Smartside', matId:'t111', note: sidingPkgs.find(p=>p.siding_type==='t111')?`${sidingPkgs.find(p=>p.siding_type==='t111').multiplier}× pkg`:'standard' },
    { label:'Clapboard', matId:'clapboard', note: sidingPkgs.find(p=>p.siding_type==='clapboard')?`${sidingPkgs.find(p=>p.siding_type==='clapboard').multiplier}× pkg`:null },
    { label:'B&B Siding', matId:'bAndB', note: sidingPkgs.find(p=>p.siding_type==='bAndB')?`${sidingPkgs.find(p=>p.siding_type==='bAndB').multiplier}× pkg`:null },
  ];

  function FixedOptionsTab() {
    const fixedPkgs=regularPkgs.filter(p=>!p.size_variable);
    const fixedAddons=ADDON_OPTIONS.filter(ao=>{ const prices=sizesWithQty.map(s=>addonCost(ao.matId,s)).filter(v=>v!==null); return !prices.length||prices.every(p=>Math.abs(p-prices[0])<0.01); });
    const hasFixed=fixedPkgs.length>0||fixedAddons.length>0;
    if (!hasFixed) return <WarningBanner>No fixed price options configured.</WarningBanner>;
    return (
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:28 }}>
        {fixedPkgs.map(pkg=>{ const price=pkgPrice(pkg,sizesWithQty[0]); return (
          <div key={pkg.id} style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'14px 18px', minWidth:160 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:17, fontWeight:600, color:'#1A1A1A', marginBottom:6 }}>{pkg.name}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:18, fontWeight:700, color:C.sage }}>{price!==null?fmt(price):'—'}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:10, color:'#aaa', marginTop:3 }}>{pkg.flat_rate!=null?'flat rate':`${pkg.multiplier}× multiplier`}</div>
          </div>
        ); })}
        {fixedAddons.map(ao=>{ const price=addonCost(ao.matId,sizesWithQty[0]); return (
          <div key={ao.key} style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'14px 18px', minWidth:160 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:17, fontWeight:600, color:'#1A1A1A', marginBottom:6 }}>{ao.label}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:18, fontWeight:700, color:C.sage }}>{price!==null?fmt(price):'—'}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:10, color:'#aaa', marginTop:3 }}>{mult}× multiplier</div>
          </div>
        ); })}
      </div>
    );
  }

  function VariableOptionsTab() {
    const variablePkgs=regularPkgs.filter(p=>p.size_variable);
    const fixedAddons=ADDON_OPTIONS.filter(ao=>{ const prices=sizesWithQty.map(s=>addonCost(ao.matId,s)).filter(v=>v!==null); return !prices.length||prices.every(p=>Math.abs(p-prices[0])<0.01); });
    const variableAddons=ADDON_OPTIONS.filter(ao=>!fixedAddons.includes(ao));
    const hasVariable=variablePkgs.length>0||variableAddons.length>0;
    if (!hasVariable) return <WarningBanner>No size-variable options configured.</WarningBanner>;
    return (
      <PricingGrid
        cols={[
          ...variablePkgs.map(pkg=>({ label:pkg.name, note:`${pkg.multiplier}× multiplier`, getValue:(size)=>pkgPrice(pkg,size) })),
          ...variableAddons.map(ao=>({ label:ao.label, note:`${mult}× multiplier`, getValue:(size)=>addonCost(ao.matId,size) })),
        ]}
        getCellValue={(col,size)=>col.getValue(size)}
      />
    );
  }

  return (
    <div>
      <SectionHeader sub="Base material customer pricing by size and style. Manage styles and markup here.">Configurator Pricing</SectionHeader>

      {error   && <ErrorBanner onDismiss={()=>setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Builder selector */}
      {isAdmin && builders.length > 0 && (
        <div style={{ marginBottom:20, display:'flex', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 6 : 12, flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#aaa' }}>Viewing pricing for:</div>
          <select value={selectedBuilder} onChange={e=>selectBuilder(e.target.value)}
            style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, padding:'8px 14px', border:`2px solid ${selectedBuilder!=='master'?C.sage:C.linenDarker}`, borderRadius:5, background:'#FFFDF9', color:'#1A1A1A', cursor:'pointer', minWidth: isMobile ? 0 : 220, width: isMobile ? '100%' : 'auto' }}>
            <option value="master">Master Prices (default)</option>
            {builders.filter(b=>b.role!=='admin').map(b=>(
              <option key={b.id} value={b.id}>{b.full_name||b.email}{b.market?` — ${b.market}`:''}</option>
            ))}
          </select>
          {selectedBuilder!=='master'&&<div style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, background:'#EFF6EE', borderRadius:4, padding:'4px 10px' }}>● {builders.find(b=>b.id===selectedBuilder)?.full_name||'Builder'}'s prices</div>}
        </div>
      )}

      {/* Top controls */}
      <div style={{ display:'flex', gap:16, marginBottom:24, flexWrap:'wrap', alignItems:'stretch' }}>
        <div style={{ background:'#FFFDF9', border:`1px solid ${selectedBuilder!=='master'?C.sage:C.linenDarker}`, borderRadius:6, padding:'14px 18px', display:'flex', alignItems:'center', gap:14, width: isMobile ? '100%' : 'auto', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <div>
            <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#aaa', marginBottom:2 }}>
              {selectedBuilder!=='master'?`${builders.find(b=>b.id===selectedBuilder)?.full_name||'Builder'}'s Multiplier`:'General Multiplier'}
            </div>
            <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#bbb' }}>Applied to all prices</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="number" min="1" step="0.1" value={multiplier} readOnly={selectedBuilder!=='master'} onChange={e=>saveMultiplier(e.target.value)}
              style={{ width:68, padding:'8px 10px', border:`2px solid ${C.sage}`, borderRadius:4, fontFamily:'DM Sans', fontSize:20, fontWeight:700, textAlign:'center', background:selectedBuilder!=='master'?'#EFF6EE':'#FFFDF9', color:'#1A1A1A', cursor:selectedBuilder!=='master'?'default':'text' }} />
            <span style={{ fontFamily:'DM Sans', fontSize:15, color:'#888' }}>×</span>
          </div>
          <div style={{ fontFamily:'DM Sans', fontSize:10, color:C.sage, background:'#EFF6EE', borderRadius:3, padding:'3px 8px' }}>
            {selectedBuilder==='master'?'Auto-saved':"Builder's rate"}
          </div>
        </div>
        {hasAnyQty && <Button variant="secondary" size="sm" onClick={exportCSV} style={{ alignSelf:'center' }}>↓ Export CSV</Button>}
      </div>

      {/* Tabs */}
      <div className="usc-table-scroll" style={{ display:'flex', gap:0, marginBottom:20, borderBottom:`2px solid ${C.linenDarker}`, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible' }}>
        {[['base','Base Pricing'],['siding','Siding'],['fixed','Fixed Price Options'],['variable','Size-Variable Options']].map(([key,label])=>(
          <button key={key} onClick={()=>setActiveTab(key)} style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding: isMobile ? '10px 14px' : '10px 20px', border:'none', cursor:'pointer', background:'transparent', color:activeTab===key?C.sage:'#aaa', borderBottom:activeTab===key?`2px solid ${C.sage}`:'2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0 }}>{label}</button>
        ))}
      </div>

      {/* ── BASE PRICING TAB ── */}
      {activeTab==='base' && <>
        {/* Styles management */}
        <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:20, marginBottom:24 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems: isMobile ? 'stretch' : 'center', marginBottom:14, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
            <div>
              <div style={{ fontFamily:'DM Sans', fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#aaa', marginBottom:2 }}>Styles & Markup</div>
              <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>Each style can have a base material markup applied before the general multiplier.</div>
            </div>
            {isAdmin && <Button size="sm" onClick={()=>{setShowAdd(true);setError('');}} style={isMobile?{width:'100%'}:{}}>+ Add Style</Button>}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {styles.map(style=>{
              const isEditing=editingStyle?.id===style.id;
              return (
                <div key={style.id} style={{ background:style.markup>0?'#EFF6EE':C.linen, border:`1px solid ${style.markup>0?C.sage:C.linenDarker}`, borderRadius:6, padding:'12px 16px', minWidth:180, display:'flex', flexDirection:'column', gap:8 }}>
                  {isEditing ? (
                    <>
                      <input value={editVals.name} onChange={e=>setEditVals(p=>({...p,name:e.target.value}))}
                        style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, background:'#fff', color:'#1A1A1A', width:'100%', boxSizing:'border-box' }} />
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <input type="number" min="0" max="100" step="0.5" value={editVals.markup} onChange={e=>setEditVals(p=>({...p,markup:e.target.value}))}
                          style={{ width:60, padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:14, fontWeight:700, textAlign:'right', background:'#fff', color:'#1A1A1A' }} />
                        <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>% markup</span>
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <Button size="sm" onClick={()=>saveStyle(style)} loading={saving}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={()=>setEditingStyle(null)}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:17, fontWeight:600, color:'#1A1A1A', lineHeight:1.2 }}>{style.name}</div>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span style={{ fontFamily:'DM Sans', fontSize:15, fontWeight:700, color:style.markup>0?C.sage:'#ccc' }}>{style.markup>0?`+${style.markup}%`:'No markup'}</span>
                        {isAdmin && (
                          <div style={{ display:'flex', gap:4 }}>
                            <button onClick={()=>{setEditingStyle(style);setEditVals({name:style.name,markup:String(style.markup)});}} style={{ background:'transparent', border:`1px solid ${C.linenDarker}`, borderRadius:3, padding:'3px 8px', fontFamily:'DM Sans', fontSize:11, color:'#888', cursor:'pointer' }}>Edit</button>
                            <button onClick={()=>setDeleteId(style.id)} style={{ background:'transparent', border:`1px solid #FCA5A5`, borderRadius:3, padding:'3px 8px', fontFamily:'DM Sans', fontSize:11, color:'#DC2626', cursor:'pointer' }}>✕</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Pricing grid */}
        {!hasAnyQty ? <WarningBanner>No quantities on file yet. Add them in Calculator Settings → Quantity Tables.</WarningBanner> : (
          <>
            {sizesNoQty.length>0 && <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#bbb', marginBottom:12 }}>{sizesNoQty.length} size{sizesNoQty.length>1?'s':''} hidden — no quantities: {sizesNoQty.join(', ')}</div>}
            <div className="usc-table-scroll" style={{ overflow:'auto', borderRadius:6, border:`1px solid ${C.linenDarker}` }}>
              <table style={{ borderCollapse:'collapse', width:'100%', minWidth:160+styles.length*140 }}>
                <thead>
                  <tr style={{ background:'#1A1510', position:'sticky', top:0, zIndex:10 }}>
                    <th style={{ padding:'12px 20px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'rgba(255,255,255,0.5)', textAlign:'left', minWidth:100, position:'sticky', left:0, background:'#1A1510', zIndex:11, borderRight:`1px solid rgba(255,255,255,0.08)` }}>Size</th>
                    {styles.map(s=>(
                      <th key={s.id} style={{ padding:'12px 20px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.7)', textAlign:'right', minWidth:140, whiteSpace:'nowrap' }}>
                        <div>{s.name}</div>
                        {s.markup>0&&<div style={{ fontFamily:'DM Sans', fontSize:9, color:'#B8986A', fontWeight:500, textTransform:'none', letterSpacing:0, marginTop:2 }}>+{s.markup}% markup</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(sizeGroups).map(([width,sizes])=>(
                    <>
                      <tr key={`sep-${width}`} style={{ background:C.linenDarker }}>
                        <td colSpan={styles.length+1} style={{ padding:'5px 20px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#888' }}>{width} ft wide</td>
                      </tr>
                      {sizes.map((size,ri)=>(
                        <tr key={size} style={{ borderBottom:`1px solid ${C.linenDarker}`, background:ri%2===0?'#FFFDF9':C.linen }}>
                          <td style={{ padding:'11px 20px', fontFamily:'Cormorant Garamond, serif', fontSize:17, fontWeight:600, color:'#1A1A1A', position:'sticky', left:0, background:ri%2===0?'#FFFDF9':C.linen, zIndex:5, borderRight:`1px solid ${C.linenDarker}`, whiteSpace:'nowrap' }}>{size}</td>
                          {styles.map(s=>{ const price=customerPrice(size,s); return (
                            <td key={s.id} style={{ padding:'11px 20px', fontFamily:'DM Sans', fontSize:14, fontWeight:600, textAlign:'right', color:price!==null?'#1A1A1A':'#ddd' }}>{price!==null?fmt(price):'—'}</td>
                          ); })}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background:'#1A1510' }}>
                    <td colSpan={styles.length+1} style={{ padding:'10px 20px', fontFamily:'DM Sans', fontSize:10, color:'rgba(255,255,255,0.3)', fontStyle:'italic' }}>
                      Base materials only · {mult}× multiplier · style markups applied · excludes siding, packages & add-ons
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </>}

      {/* ── SIDING TAB ── */}
      {activeTab==='siding' && (
        <div>
          <PricingGrid
            cols={SIDING_OPTIONS}
            getCellValue={(col,size)=>{
              const sp=sidingPkgs.find(p=>p.siding_type===col.matId);
              if(sp){
                const components=pkgMaterials.filter(pm=>pm.package_id===sp.id);
                let total=0,hasAny=false;
                for(const pm of components){
                  const mat=matById[pm.material_id]; if(!mat) continue;
                  const qty=sp.size_variable?(pkgQuantities.find(q=>q.package_id===sp.id&&q.material_id===pm.material_id&&q.shed_size===size)?.quantity??null):(pm.fixed_quantity??null);
                  if(qty===null) continue; total+=qty*mat.price; hasAny=true;
                }
                return hasAny?total*(sp.multiplier??1):null;
              }
              return sidingCost(col.matId,size);
            }}
          />
        </div>
      )}

      {/* ── FIXED PRICE OPTIONS TAB ── */}
      {activeTab==='fixed' && FixedOptionsTab()}

      {/* ── SIZE-VARIABLE OPTIONS TAB ── */}
      {activeTab==='variable' && VariableOptionsTab()}

      {/* Modals */}
      {showAdd && (
        <Modal title="Add Style" onClose={()=>{setShowAdd(false);setNewStyle({name:'',markup:'0'});setError('');}}>
          {error&&<ErrorBanner onDismiss={()=>setError('')}>{error}</ErrorBanner>}
          <FormField label="Style name *"><Input value={newStyle.name} onChange={v=>setNewStyle(p=>({...p,name:v}))} placeholder="e.g. High Wall Modern" autoFocus /></FormField>
          <FormField label="Base material markup (%)">
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Input type="number" value={newStyle.markup} onChange={v=>setNewStyle(p=>({...p,markup:v}))} style={{ maxWidth:100 }} />
              <span style={{ fontFamily:'DM Sans', fontSize:13, color:'#888' }}>% added to base material cost</span>
            </div>
          </FormField>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Button variant="ghost" onClick={()=>{setShowAdd(false);setNewStyle({name:'',markup:'0'});}}>Cancel</Button>
            <Button onClick={addStyle} loading={adding} disabled={!newStyle.name.trim()}>Add Style</Button>
          </div>
        </Modal>
      )}
      {deleteId && (
        <Modal title="Delete Style" onClose={()=>setDeleteId(null)} width={400}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:'#1A1A1A', margin:'0 0 20px', lineHeight:1.6 }}>This will permanently delete this style.</p>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={()=>setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={()=>deleteStyle(deleteId)} loading={saving}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
