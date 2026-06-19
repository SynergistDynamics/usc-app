// src/modules/PackageManager.jsx
import { useState, useEffect } from 'react';
import { supabase, SHED_SIZES, C, fmt, applyOverride } from '../lib/supabase';
import {
  SectionHeader, Button, Card, Badge, Input, Select,
  ErrorBanner, SuccessBanner, Modal, FormField, Spinner, WarningBanner,
} from '../components/UI';

// ── helpers ──────────────────────────────────────────────────
function calcPackagePrice(pkg, pkgMaterials, pkgQuantities, matById, size) {
  let total = 0;
  const components = pkgMaterials.filter(pm => pm.package_id === pkg.id);
  for (const pm of components) {
    const mat = matById[pm.material_id];
    if (!mat) continue;
    const qty = pkg.size_variable
      ? (size ? (pkgQuantities.find(q => q.package_id === pkg.id && q.material_id === pm.material_id && q.shed_size === size)?.quantity ?? 0) : 0)
      : (pm.fixed_quantity ?? 0);
    total += qty * mat.price;
  }
  return total * (pkg.multiplier ?? 1);
}

const EMPTY_PKG = { name:'', description:'', multiplier:'1.0', flat_rate:'', size_variable:false, siding_type:'', allow_quantity:false, is_style:false };

const TABS = [
  ['style',    'Shed Styles'],
  ['siding',   'Siding'],
  ['fixed',    'Fixed Price Packages'],
  ['variable', 'Size-Variable Packages'],
];

// Which tab a package belongs to.
function pkgTab(p) {
  if (p.is_style)    return 'style';
  if (p.siding_type) return 'siding';
  return p.size_variable ? 'variable' : 'fixed';
}

export default function PackageManager({ materials, overrides, packages, pkgMaterials, pkgQuantities, onRefresh }) {
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [saving,      setSaving]      = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [isMobile,    setIsMobile]    = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  const [editPkg,     setEditPkg]     = useState(null);   // package being edited
  const [deletePkg,   setDeletePkg]   = useState(null);
  const [newPkg,      setNewPkg]      = useState(EMPTY_PKG);
  const [creating,    setCreating]    = useState(false);
  // Component editor state
  const [editingComponents, setEditingComponents] = useState(null); // pkg id
  const [componentEdits,    setComponentEdits]    = useState({});   // matId -> qty
  const [addMatId,          setAddMatId]          = useState('');
  const [addMatQty,         setAddMatQty]         = useState('');
  // Size-variable quantity grid
  const [editingQtyGrid,    setEditingQtyGrid]    = useState(null);  // pkg id
  const [qtyGridEdits,      setQtyGridEdits]      = useState({});    // `matId|size` -> val
  const [activeTab,         setActiveTab]         = useState('style');

  const salesTax = localStorage.getItem('usc_sales_tax') || '0';
  const taxMult  = 1 + (parseFloat(salesTax) || 0) / 100;
  const matById = Object.fromEntries(materials.map(m => {
    const r = applyOverride(m, overrides);
    return [m.id, { ...r, price: r.price * taxMult }];
  }));

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Materials eligible to be package components (all except package_component group shown separately)
  const allMaterials = materials.filter(m => m.material_group !== 'base' || true); // all materials

  // ── Create package ────────────────────────────────────────
  async function createPackage() {
    if (!newPkg.name.trim()) { setError('Package name is required.'); return; }
    const mult = parseFloat(newPkg.multiplier);
    if (isNaN(mult) || mult <= 0) { setError('Multiplier must be a positive number.'); return; }
    setCreating(true); setError('');

    const flatRate = newPkg.flat_rate !== '' ? parseFloat(newPkg.flat_rate) : null;
    const maxOrder = Math.max(0, ...packages.map(p => p.sort_order || 0));

    const { data, error: e } = await supabase.from('packages').insert({
      name: newPkg.name.trim(),
      description: newPkg.description.trim() || null,
      multiplier: mult,
      // Shed styles always use a per-size quantity grid and are never siding/flat-rate.
      flat_rate: newPkg.is_style ? null : (isNaN(flatRate) ? null : flatRate),
      size_variable: newPkg.is_style ? true : newPkg.size_variable,
      siding_type: newPkg.is_style ? null : (newPkg.siding_type || null),
      allow_quantity: newPkg.is_style ? false : (newPkg.allow_quantity || false),
      is_style: newPkg.is_style || false,
      sort_order: maxOrder + 1,
      updated_at: new Date().toISOString(),
    }).select().single();

    if (e) { setError(e.message); setCreating(false); return; }
    setCreating(false);
    setShowCreate(false);
    setNewPkg(EMPTY_PKG);
    onRefresh();
    setSuccess(`"${data.name}" created. Add components to it below.`);
  }

  // ── Update package metadata ───────────────────────────────
  async function savePackageMeta(pkg) {
    const mult = parseFloat(editPkg.multiplier);
    if (isNaN(mult) || mult <= 0) { setError('Multiplier must be > 0.'); return; }
    setSaving(true); setError('');
    const flatRate = editPkg.flat_rate !== '' ? parseFloat(editPkg.flat_rate) : null;
    const { error: e } = await supabase.from('packages').update({
      name: editPkg.name,
      description: editPkg.description || null,
      multiplier: mult,
      flat_rate: editPkg.is_style ? null : (isNaN(flatRate) ? null : flatRate),
      size_variable: editPkg.is_style ? true : editPkg.size_variable,
      siding_type: editPkg.is_style ? null : (editPkg.siding_type || null),
      allow_quantity: editPkg.is_style ? false : (editPkg.allow_quantity || false),
      is_style: editPkg.is_style || false,
      updated_at: new Date().toISOString(),
    }).eq('id', pkg.id);
    if (e) { setError(e.message); setSaving(false); return; }
    setSaving(false);
    setEditPkg(null);
    onRefresh();
    setSuccess('Package updated.');
  }

  // ── Delete package ────────────────────────────────────────
  async function deletePackage(id) {
    setSaving(true);
    const { error: e } = await supabase.from('packages').delete().eq('id', id);
    if (e) { setError(e.message); setSaving(false); setDeletePkg(null); return; }
    setSaving(false); setDeletePkg(null);
    onRefresh(); setSuccess('Package deleted.');
  }

  // ── Component editor ──────────────────────────────────────
  function openComponentEditor(pkg) {
    const mats = pkgMaterials.filter(pm => pm.package_id === pkg.id);
    const edits = {};
    mats.forEach(pm => { edits[pm.material_id] = String(pm.fixed_quantity ?? ''); });
    setComponentEdits(edits);
    setEditingComponents(pkg.id);
    setAddMatId(''); setAddMatQty('');
  }

  async function saveComponents(pkg) {
    setSaving(true); setError('');
    // Delete existing components for this package
    await supabase.from('package_materials').delete().eq('package_id', pkg.id);
    // Re-insert all
    const rows = Object.entries(componentEdits)
      .filter(([, qty]) => pkg.size_variable || (qty !== '' && !isNaN(parseFloat(qty))))
      .map(([material_id]) => ({
        package_id: pkg.id,
        material_id,
        fixed_quantity: pkg.size_variable ? null : parseFloat(componentEdits[material_id]),
      }));
    if (rows.length) {
      const { error: e } = await supabase.from('package_materials').insert(rows);
      if (e) { setError(e.message); setSaving(false); return; }
    }
    setSaving(false);
    setEditingComponents(null);
    setComponentEdits({});
    await onRefresh();
    setSuccess(pkg.size_variable ? 'Components saved. Now click "Edit Qty Grid" to enter quantities per size.' : 'Components saved.');
  }

  function addComponent(pkg) {
    if (!addMatId) return;
    // For size-variable packages qty is set in the grid, not here
    if (!pkg.size_variable && addMatQty === '') return;
    setComponentEdits(p => ({ ...p, [addMatId]: pkg.size_variable ? '0' : addMatQty }));
    setAddMatId(''); setAddMatQty('');
  }

  function removeComponent(matId) {
    setComponentEdits(p => { const n = { ...p }; delete n[matId]; return n; });
  }

  // ── Size-variable qty grid ────────────────────────────────
  function openQtyGrid(pkg) {
    const edits = {};
    const mats = pkgMaterials.filter(pm => pm.package_id === pkg.id);
    mats.forEach(pm => {
      SHED_SIZES.forEach(size => {
        const existing = pkgQuantities.find(q =>
          q.package_id === pkg.id && q.material_id === pm.material_id && q.shed_size === size
        );
        edits[`${pm.material_id}|${size}`] = existing ? String(existing.quantity) : '';
      });
    });
    setQtyGridEdits(edits);
    setEditingQtyGrid(pkg.id);
  }

  async function saveQtyGrid(pkg) {
    setSaving(true); setError('');
    const upserts = Object.entries(qtyGridEdits)
      .filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
      .map(([key, v]) => {
        const [material_id, shed_size] = key.split('|');
        return { package_id: pkg.id, material_id, shed_size, quantity: parseFloat(v), updated_at: new Date().toISOString() };
      });
    const deletes = Object.entries(qtyGridEdits)
      .filter(([, v]) => v === '')
      .map(([key]) => { const [material_id, shed_size] = key.split('|'); return { material_id, shed_size }; });

    if (upserts.length) {
      const { error: e } = await supabase.from('package_quantities')
        .upsert(upserts, { onConflict: 'package_id,material_id,shed_size' });
      if (e) { setError(e.message); setSaving(false); return; }
    }
    for (const { material_id, shed_size } of deletes) {
      await supabase.from('package_quantities').delete()
        .eq('package_id', pkg.id).eq('material_id', material_id).eq('shed_size', shed_size);
    }
    setSaving(false); setEditingQtyGrid(null); setQtyGridEdits({});
    onRefresh(); setSuccess('Package quantities saved.');
  }

  const unusedMaterials = (pkg) => materials.filter(m => !componentEdits.hasOwnProperty(m.id));

  return (
    <div>
      <SectionHeader sub="Manage shed styles and packages. Quantities live inside each package's per-size grid.">
        Package Manager
      </SectionHeader>

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {activeTab === 'style' && (
        <WarningBanner>
          Shed styles are size-variable packages holding every base material per size. The multiplier set here is the
          default — each builder sets their own per-style multiplier on the Configurator Pricing page.
        </WarningBanner>
      )}

      <div style={{ marginBottom:20 }}>
        <Button onClick={() => { setNewPkg({ ...EMPTY_PKG, is_style: activeTab === 'style', size_variable: activeTab === 'style' || activeTab === 'variable', siding_type: '' }); setShowCreate(true); setError(''); }}>
          {activeTab === 'style' ? '+ New Shed Style' : '+ New Package'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="usc-table-scroll" style={{ display:'flex', gap:0, marginBottom:24, borderBottom:`2px solid ${C.linenDarker}`, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible' }}>
        {TABS.map(([key,label]) => {
          const count = packages.filter(p => pkgTab(p) === key).length;
          return (
            <button key={key} onClick={() => setActiveTab(key)} style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding: isMobile ? '10px 14px' : '10px 20px', border:'none', cursor:'pointer', background:'transparent', color:activeTab===key?C.sage:'#aaa', borderBottom:activeTab===key?`2px solid ${C.sage}`:'2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0 }}>
              {label}
              {count > 0 && <span style={{ marginLeft:6, background:activeTab===key?C.sage:'#ddd', color:activeTab===key?'#fff':'#888', borderRadius:10, padding:'1px 7px', fontSize:11, fontWeight:700 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {(() => {
        const filtered = packages.filter(p => pkgTab(p) === activeTab);
        if (filtered.length === 0) return (
          <Card>
            <p style={{ fontFamily:'DM Sans', fontSize:14, color:'#aaa', textAlign:'center', margin:0 }}>
              No {TABS.find(([k]) => k === activeTab)?.[1].toLowerCase()} yet.
            </p>
          </Card>
        );
        return filtered.map(pkg => {
        const components = pkgMaterials.filter(pm => pm.package_id === pkg.id);
        const isEditingMeta = editPkg?.id === pkg.id;
        const isEditingComp = editingComponents === pkg.id;
        const isEditingGrid = editingQtyGrid === pkg.id;

        return (
          <Card key={pkg.id} style={{ marginBottom:16 }}>
            {/* ── Package header ── */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
              <div style={{ flex:1, width: isMobile ? '100%' : 'auto' }}>
                {isEditingMeta ? (
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:12 }}>
                    <FormField label="Name">
                      <Input value={editPkg.name} onChange={v => setEditPkg(p=>({...p,name:v}))} />
                    </FormField>
                    <FormField label="Description">
                      <Input value={editPkg.description||''} onChange={v => setEditPkg(p=>({...p,description:v}))} placeholder="Optional" />
                    </FormField>
                    <FormField label={editPkg.is_style ? 'Default multiplier (builders override their own)' : 'Multiplier'}>
                      <Input type="number" value={editPkg.multiplier} onChange={v => setEditPkg(p=>({...p,multiplier:v}))} />
                    </FormField>
                    {!editPkg.is_style && (
                      <FormField label="Flat Rate Override (leave blank to use calculated)">
                        <Input type="number" value={editPkg.flat_rate||''} onChange={v => setEditPkg(p=>({...p,flat_rate:v}))} placeholder="e.g. 185.07" />
                      </FormField>
                    )}
                    {!editPkg.is_style && (
                      <FormField label="Quantities vary by shed size?">
                        <label style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'DM Sans', fontSize:13, cursor:'pointer' }}>
                          <input type="checkbox" checked={editPkg.size_variable}
                            onChange={e => setEditPkg(p=>({...p,size_variable:e.target.checked}))}
                            style={{ accentColor:C.sage, width:15, height:15 }} />
                          Yes — use per-size quantity grid
                        </label>
                      </FormField>
                    )}
                    {!editPkg.is_style && (
                      <FormField label="Allow multiple quantities?">
                        <label style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'DM Sans', fontSize:13, cursor:'pointer' }}>
                          <input type="checkbox" checked={editPkg.allow_quantity||false}
                            onChange={e => setEditPkg(p=>({...p,allow_quantity:e.target.checked}))}
                            style={{ accentColor:C.sage, width:15, height:15 }} />
                          Yes — show quantity ticker in calculator
                        </label>
                      </FormField>
                    )}
                    {!editPkg.is_style && (
                      <FormField label="Link to siding option">
                        <select value={editPkg.siding_type||''} onChange={e=>setEditPkg(p=>({...p,siding_type:e.target.value}))}
                          style={{ width:'100%', padding:'8px 12px', border:`1.5px solid ${C.sage}`, borderRadius:4, fontFamily:'DM Sans', fontSize:14, background:C.linen, color:C.charcoal }}>
                          <option value="">— Not a siding package —</option>
                          <option value="t111">T1-11 Siding</option>
                          <option value="clapboard">Clapboard Siding</option>
                          <option value="bAndB">B&B Siding</option>
                        </select>
                      </FormField>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
                      <span style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:C.charcoal }}>{pkg.name}</span>
                      {pkg.is_style
                        ? <Badge color="sand">Shed Style</Badge>
                        : <Badge color={pkg.size_variable ? 'blue' : 'ghost'}>{pkg.size_variable ? 'Size-variable' : 'Fixed qty'}</Badge>}
                      {pkg.siding_type && <Badge color="green">{pkg.siding_type === 't111' ? 'T1-11 Siding' : pkg.siding_type === 'clapboard' ? 'Clapboard Siding' : 'B&B Siding'}</Badge>}
                      {pkg.allow_quantity && <Badge color="blue">Countable</Badge>}
                      {pkg.flat_rate != null && <Badge color="sand">Flat rate: {fmt(pkg.flat_rate)}</Badge>}
                    </div>
                    {pkg.description && (
                      <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', margin:0 }}>{pkg.description}</p>
                    )}
                    <div style={{ display:'flex', gap:16, marginTop:6, flexWrap:'wrap', alignItems:'center' }}>
                      <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>
                        {pkg.is_style ? 'Default mult: ' : 'Multiplier: '}<strong style={{ color:C.charcoal }}>{pkg.multiplier}×</strong>
                      </span>
                      <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>
                        Components: <strong style={{ color:C.charcoal }}>{components.length}</strong>
                      </span>
                      {(() => {
                        const calcPrice = calcPackagePrice(pkg, pkgMaterials, pkgQuantities, matById, null);
                        return (
                          <>
                            <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>
                              Calculated: <strong style={{ color:C.charcoal }}>{calcPrice > 0 ? fmt(calcPrice) : '—'}</strong>
                            </span>
                            {pkg.flat_rate != null && (
                              <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>
                                Override: <strong style={{ color:C.sage }}>{fmt(pkg.flat_rate)}</strong>
                                <span style={{ color:'#aaa', fontWeight:400 }}> (active)</span>
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display:'flex', gap:8, flexShrink:0, marginLeft: isMobile ? 0 : 16, width: isMobile ? '100%' : 'auto' }}>
                {isEditingMeta ? (
                  <>
                    <Button size="sm" onClick={() => savePackageMeta(pkg)} loading={saving} style={isMobile?{flex:1}:{}}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditPkg(null)} style={isMobile?{flex:1}:{}}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" style={isMobile?{flex:1}:{}}
                      onClick={() => setEditPkg({ id:pkg.id, name:pkg.name, description:pkg.description||'', multiplier:String(pkg.multiplier), flat_rate: pkg.flat_rate!=null?String(pkg.flat_rate):'', size_variable:pkg.size_variable, siding_type: pkg.siding_type||'', allow_quantity: pkg.allow_quantity||false, is_style: pkg.is_style||false })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDeletePkg(pkg.id)}>✕</Button>
                  </>
                )}
              </div>
            </div>

            {/* ── Component list ── */}
            {!isEditingComp && !isEditingGrid && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems: isMobile ? 'stretch' : 'center', marginBottom:8, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 0 }}>
                  <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sage }}>
                    Components
                  </span>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => openComponentEditor(pkg)} style={isMobile?{flex:1}:{}}>
                      Edit Components
                    </Button>
                    {pkg.size_variable && components.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => openQtyGrid(pkg)} style={isMobile?{flex:1}:{}}>
                        Edit Qty Grid
                      </Button>
                    )}
                    {pkg.size_variable && components.length === 0 && (
                      <span style={{ fontFamily:'DM Sans', fontSize:11, color:'#aaa', alignSelf:'center' }}>
                        Add components first, then edit the qty grid
                      </span>
                    )}
                  </div>
                </div>
                {components.length === 0 ? (
                  <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#ccc', margin:0 }}>No components added yet.</p>
                ) : (
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${C.linenDarker}` }}>
                        {['Material','Category',pkg.size_variable?'Qty (varies by size)':'Fixed Qty','Unit Price'].map(h=>(
                          <th key={h} style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#aaa', textAlign:'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {components.map(pm => {
                        const mat = matById[pm.material_id];
                        if (!mat) return null;
                        return (
                          <tr key={pm.material_id} style={{ borderBottom:`1px solid ${C.linen}` }}>
                            <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:13, color:C.charcoal }}>{mat.name}</td>
                            <td style={{ padding:'6px 10px' }}><Badge color="sand">{mat.category}</Badge></td>
                            <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:13, color:'#666' }}>
                              {pkg.size_variable ? <span style={{ color:C.sage, fontStyle:'italic' }}>per-size grid</span> : pm.fixed_quantity}
                            </td>
                            <td style={{ padding:'6px 10px', fontFamily:'DM Sans', fontSize:13, fontWeight:600 }}>{fmt(mat.price)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Component editor ── */}
            {isEditingComp && (
              <div>
                <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sage, marginBottom:12 }}>
                  Edit Components
                </div>
                <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:12 }}>
                  <thead>
                    <tr style={{ borderBottom:`1px solid ${C.linenDarker}` }}>
                      {['Material',pkg.size_variable?'(qty set in grid)':'Fixed Qty',''].map(h=>(
                        <th key={h} style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#aaa', textAlign:'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(componentEdits).map(([matId, qty]) => {
                      const mat = matById[matId];
                      if (!mat) return null;
                      return (
                        <tr key={matId} style={{ borderBottom:`1px solid ${C.linen}` }}>
                          <td style={{ padding:'5px 10px', fontFamily:'DM Sans', fontSize:13, color:C.charcoal }}>{mat.name}</td>
                          <td style={{ padding:'5px 10px' }}>
                            {!pkg.size_variable ? (
                              <input type="number" min="0" value={qty}
                                onChange={e => setComponentEdits(p=>({...p,[matId]:e.target.value}))}
                                style={{ width:70, padding:'3px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:13, background:C.linen }} />
                            ) : (
                              <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#aaa', fontStyle:'italic' }}>set in qty grid</span>
                            )}
                          </td>
                          <td style={{ padding:'5px 10px' }}>
                            <Button size="sm" variant="ghost" onClick={() => removeComponent(matId)}>Remove</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Add component row */}
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:16, padding:'10px', background:C.linen, borderRadius:4 }}>
                  <div style={{ flex:2 }}>
                    <Select value={addMatId} onChange={setAddMatId}
                      options={[{value:'',label:'— select material —'}, ...unusedMaterials(pkg).map(m=>({value:m.id,label:m.name}))]} />
                  </div>
                  {!pkg.size_variable && (
                    <input type="number" min="0" value={addMatQty} onChange={e=>setAddMatQty(e.target.value)}
                      placeholder="Qty"
                      style={{ width:70, padding:'8px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, fontFamily:'DM Sans', fontSize:13, background:'#FFFDF9' }} />
                  )}
                  <Button size="sm" onClick={() => addComponent(pkg)} disabled={!addMatId || (!pkg.size_variable && !addMatQty)}>
                    Add
                  </Button>
                </div>

                <div style={{ display:'flex', gap:8 }}>
                  <Button size="sm" onClick={() => saveComponents(pkg)} loading={saving}>Save Components</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingComponents(null); setComponentEdits({}); }}>Cancel</Button>
                </div>
              </div>
            )}

            {/* ── Size-variable qty grid ── */}
            {isEditingGrid && (
              <div>
                <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sage, marginBottom:12 }}>
                  Per-Size Quantities
                </div>
                <div className="usc-table-scroll" style={{ overflow:'auto', maxHeight:400, border:`1px solid ${C.linenDarker}`, borderRadius:4 }}>
                  <table style={{ borderCollapse:'collapse', fontSize:12 }}>
                    <thead style={{ position:'sticky', top:0, zIndex:10 }}>
                      <tr style={{ background:'#1A1510' }}>
                        <th style={{ position:'sticky', left:0, background:'#1A1510', padding:'8px 12px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, color:'#ccc', textAlign:'left', minWidth:180, borderRight:`1px solid #555` }}>Material</th>
                        {SHED_SIZES.map(s=>(
                          <th key={s} style={{ padding:'8px 6px', fontFamily:'DM Sans', fontSize:9, fontWeight:700, color:'#ccc', textAlign:'center', minWidth:50, whiteSpace:'nowrap' }}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pkgMaterials.filter(pm=>pm.package_id===pkg.id).map((pm,ri) => {
                        const mat = matById[pm.material_id];
                        if (!mat) return null;
                        return (
                          <tr key={pm.material_id} style={{ borderBottom:`1px solid ${C.linen}`, background:ri%2===0?'#fff':C.linen }}>
                            <td style={{ position:'sticky', left:0, background:ri%2===0?'#fff':C.linen, padding:'5px 12px', fontFamily:'DM Sans', fontSize:12, color:C.charcoal, fontWeight:500, borderRight:`1px solid ${C.linenDarker}`, minWidth:180 }}>
                              {mat.name}
                            </td>
                            {SHED_SIZES.map(s => {
                              const key = `${pm.material_id}|${s}`;
                              const val = qtyGridEdits[key] ?? '';
                              const isPending = val !== '' && val !== String(pkgQuantities.find(q=>q.package_id===pkg.id&&q.material_id===pm.material_id&&q.shed_size===s)?.quantity??'');
                              return (
                                <td key={s} style={{ padding:'2px 3px', textAlign:'center' }}>
                                  <input type="number" min="0" value={val}
                                    onChange={e=>setQtyGridEdits(p=>({...p,[key]:e.target.value}))}
                                    style={{ width:46, padding:'3px', border:`1px solid ${isPending?C.sage:C.linenDarker}`, borderRadius:3, fontFamily:'DM Sans', fontSize:11, textAlign:'center', background:isPending?'#F0FFF4':(val?'#fff':C.linen), color:C.charcoal }} />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display:'flex', gap:8, marginTop:12 }}>
                  <Button size="sm" onClick={() => saveQtyGrid(pkg)} loading={saving}>Save Grid</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingQtyGrid(null); setQtyGridEdits({}); }}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>
        );
      });
      })()}

      {/* ── Create Package Modal ── */}
      {showCreate && (
        <Modal title={newPkg.is_style ? 'New Shed Style' : 'New Package'} onClose={() => { setShowCreate(false); setNewPkg(EMPTY_PKG); setError(''); }}>
          {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
          <FormField label={newPkg.is_style ? 'Style name *' : 'Package name *'}>
            <Input value={newPkg.name} onChange={v=>setNewPkg(p=>({...p,name:v}))} placeholder={newPkg.is_style ? 'e.g. High Wall Modern' : 'e.g. Window Package'} autoFocus />
          </FormField>
          <FormField label="Description (optional)">
            <Input value={newPkg.description} onChange={v=>setNewPkg(p=>({...p,description:v}))} placeholder="Brief description" />
          </FormField>
          {newPkg.is_style ? (
            <FormField label="Default multiplier *">
              <Input type="number" value={newPkg.multiplier} onChange={v=>setNewPkg(p=>({...p,multiplier:v}))} />
            </FormField>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FormField label="Multiplier *">
                <Input type="number" value={newPkg.multiplier} onChange={v=>setNewPkg(p=>({...p,multiplier:v}))} />
              </FormField>
              <FormField label="Flat rate override (optional)">
                <Input type="number" value={newPkg.flat_rate} onChange={v=>setNewPkg(p=>({...p,flat_rate:v}))} placeholder="Leave blank to calculate" />
              </FormField>
            </div>
          )}
          {!newPkg.is_style && (
            <FormField label="Quantities vary by shed size?">
              <label style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'DM Sans', fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={newPkg.size_variable}
                  onChange={e=>setNewPkg(p=>({...p,size_variable:e.target.checked}))}
                  style={{ accentColor:C.sage, width:15, height:15 }} />
                Yes — I'll enter a per-size quantity grid after creating
              </label>
            </FormField>
          )}
          {!newPkg.is_style && (
            <FormField label="Link to siding option (optional)">
              <select value={newPkg.siding_type} onChange={e=>setNewPkg(p=>({...p,siding_type:e.target.value}))}
                style={{ width:'100%', padding:'8px 12px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, fontFamily:'DM Sans', fontSize:14, background:C.linen, color:C.charcoal }}>
                <option value="">— Not a siding package —</option>
                <option value="t111">T1-11 Siding</option>
                <option value="clapboard">Clapboard Siding</option>
                <option value="bAndB">B&B Siding</option>
              </select>
            </FormField>
          )}
          {!newPkg.is_style && (
            <FormField label="Allow multiple quantities?">
              <label style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'DM Sans', fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={newPkg.allow_quantity}
                  onChange={e=>setNewPkg(p=>({...p,allow_quantity:e.target.checked}))}
                  style={{ accentColor:C.sage, width:15, height:15 }} />
                Yes — show a quantity ticker in the calculator (e.g. for windows)
              </label>
            </FormField>
          )}
          <div style={{ background:C.linen, borderRadius:4, padding:'10px 14px', marginBottom:16, fontFamily:'DM Sans', fontSize:12, color:'#888', lineHeight:1.6 }}>
            {newPkg.is_style
              ? "After creating, add the style's base material components, then fill in the per-size quantity grid."
              : 'After creating, add component materials and quantities from the package card.'}
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => { setShowCreate(false); setNewPkg(EMPTY_PKG); }}>Cancel</Button>
            <Button onClick={createPackage} loading={creating} disabled={!newPkg.name.trim()}>{newPkg.is_style ? 'Create Style' : 'Create Package'}</Button>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm ── */}
      {deletePkg && (
        <Modal title="Delete Package" onClose={() => setDeletePkg(null)} width={400}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:C.charcoal, margin:'0 0 20px', lineHeight:1.6 }}>
            This will permanently delete the package and all its component and quantity data. This cannot be undone.
          </p>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => setDeletePkg(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deletePackage(deletePkg)} loading={saving}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
