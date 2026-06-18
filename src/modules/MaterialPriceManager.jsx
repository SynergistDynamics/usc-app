// src/modules/MaterialPriceManager.jsx
import { useState } from 'react';
import {
  supabase, CATEGORIES, GROUPS, C, fmt, daysSince,
  applyOverride, generateMaterialId,
} from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  Card, SectionHeader, Button, Badge, Select, Input,
  ErrorBanner, SuccessBanner, Modal, FormField, Label,
} from '../components/UI';

const EMPTY_NEW = { name:'', category:'Framing', material_group:'base', price:'', url:'' };

export default function MaterialPriceManager({ materials, overrides, setOverrides, onMasterUpdated }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [filterCat,  setFilterCat]  = useState('All');
  const [editingId,  setEditingId]  = useState(null);
  const [editVals,   setEditVals]   = useState({});
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [showAdd,    setShowAdd]    = useState(false);
  const [newMat,     setNewMat]     = useState(EMPTY_NEW);
  const [adding,     setAdding]     = useState(false);
  const [showDelete, setShowDelete] = useState(null); // material id to confirm delete
  const [salesTax,   setSalesTax]   = useState(() => localStorage.getItem('usc_sales_tax') || (profile?.sales_tax != null ? String(profile.sales_tax) : '0'));

  async function saveSalesTax(val) {
    setSalesTax(val);
    localStorage.setItem('usc_sales_tax', val);
    if (profile?.id) await supabase.from('profiles').update({ sales_tax: parseFloat(val) || 0 }).eq('id', profile.id);
  }

  const resolved = materials.map(m => applyOverride(m, overrides));
  const filtered = filterCat === 'All' ? resolved : resolved.filter(m => m.category === filterCat);

  // ── Edit existing row ─────────────────────────────────────
  function startEdit(m) {
    setEditingId(m.id);
    setEditVals({ name: m.name, category: m.category, material_group: m.material_group, price: String(m.price), url: m.url ?? '', allow_quantity: m.allow_quantity ?? false });
    setError('');
  }

  function cancelEdit() { setEditingId(null); setEditVals({}); }

  async function saveRow(m) {
    const newPrice = parseFloat(editVals.price);
    if (isNaN(newPrice) || newPrice < 0) { setError('Enter a valid price.'); return; }
    setSaving(true); setError('');

    if (isAdmin) {
      const { error: e } = await supabase
        .from('materials')
        .update({ name: editVals.name?.trim() || m.name, category: editVals.category || m.category, material_group: editVals.material_group || m.material_group, default_price: newPrice, default_url: editVals.url, allow_quantity: editVals.allow_quantity ?? m.allow_quantity ?? false, updated_at: new Date().toISOString() })
        .eq('id', m.id);
      if (e) { setError(e.message); setSaving(false); return; }
      if (newPrice !== m.default_price) {
        await supabase.from('price_history').insert({
          user_id: profile.id, material_id: m.id,
          old_price: m.default_price, new_price: newPrice,
        });
      }
      onMasterUpdated();
      setSuccess(`${m.name} updated.`);
    } else {
      const { data: existing } = await supabase
        .from('material_overrides').select('id, price')
        .eq('user_id', profile.id).eq('material_id', m.id).single();
      const payload = { user_id: profile.id, material_id: m.id, price: newPrice, url: editVals.url || null, updated_at: new Date().toISOString() };
      let ovError;
      if (existing) {
        await supabase.from('price_history').insert({ user_id: profile.id, material_id: m.id, old_price: existing.price ?? m.default_price, new_price: newPrice });
        ({ error: ovError } = await supabase.from('material_overrides').update(payload).eq('id', existing.id));
      } else {
        ({ error: ovError } = await supabase.from('material_overrides').insert(payload));
      }
      if (ovError) { setError(ovError.message); setSaving(false); return; }
      const { data: fresh } = await supabase.from('material_overrides').select('*').eq('user_id', profile.id);
      setOverrides(Object.fromEntries((fresh || []).map(o => [o.material_id, o])));
      setSuccess(`${m.name} local price updated.`);
    }
    setSaving(false); setEditingId(null);
  }

  async function clearOverride(m) {
    if (!m.overrideId) return;
    setSaving(true);
    await supabase.from('material_overrides').delete().eq('id', m.overrideId);
    const { data: fresh } = await supabase.from('material_overrides').select('*').eq('user_id', profile.id);
    setOverrides(Object.fromEntries((fresh || []).map(o => [o.material_id, o])));
    setSaving(false);
    setSuccess(`${m.name} reset to master price.`);
  }

  // ── Add new material ──────────────────────────────────────
  async function addMaterial() {
    if (!newMat.name.trim()) { setError('Name is required.'); return; }
    const price = parseFloat(newMat.price);
    if (isNaN(price) || price < 0) { setError('Enter a valid price.'); return; }
    setAdding(true); setError('');

    const id = generateMaterialId(newMat.name);
    const maxOrder = Math.max(0, ...materials.map(m => m.sort_order || 0));

    const { error: e } = await supabase.from('materials').insert({
      id,
      name: newMat.name.trim(),
      category: newMat.category,
      material_group: newMat.material_group,
      default_price: price,
      default_url: newMat.url.trim() || '',
      sort_order: maxOrder + 1,
      updated_at: new Date().toISOString(),
    });

    if (e) { setError(e.message); setAdding(false); return; }
    setAdding(false);
    setShowAdd(false);
    setNewMat(EMPTY_NEW);
    onMasterUpdated();
    setSuccess(`"${newMat.name.trim()}" added. Add quantities for it in the Quantity Tables module.`);
  }

  // ── Delete material ───────────────────────────────────────
  async function deleteMaterial(id) {
    setSaving(true);
    await supabase.from('quantities').delete().eq('material_id', id);
    await supabase.from('material_overrides').delete().eq('material_id', id);
    await supabase.from('price_history').delete().eq('material_id', id);
    const { error: e } = await supabase.from('materials').delete().eq('id', id);
    if (e) { setError(e.message); setSaving(false); setShowDelete(null); return; }
    setSaving(false);
    setShowDelete(null);
    onMasterUpdated();
    setSuccess('Material deleted.');
  }

  // ── Export / open links ───────────────────────────────────
  function exportCSV() {
    const rows = [['Name','Category','Group','Local Price','Master Price','Local Override?','Supplier URL','Last Updated']];
    resolved.forEach(m => rows.push([m.name, m.category, m.material_group, m.price, m.default_price, m.hasOverride?'Yes':'No', m.url, m.updated_at??'']));
    const csv = rows.map(r => r.map(c => `"${c??''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'usc_materials.csv'; a.click();
  }

  function openAllLinks() {
    filtered.filter(m => m.url).forEach(m => window.open(m.url, '_blank'));
  }

  const groupLabel = { base:'Base', addon:'Add-on', package_component:'Pkg Component' };
  const groupColor = { base:'sage', addon:'ghost', package_component:'blue' };

  return (
    <div>
      <SectionHeader
        sub={isAdmin
          ? "Edit master prices and add new materials. Changes apply to all builders who haven't set their own override."
          : 'Set your local prices for your area. Master prices shown as fallback.'}
      >
        Material Prices
      </SectionHeader>

      {success && <SuccessBanner>{success}</SuccessBanner>}
      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

      {/* Sales Tax setting */}
      <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'14px 18px', marginBottom:20, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:200 }}>
          <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:700, color:C.charcoal, marginBottom:2 }}>Sales Tax Rate</div>
          <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>Applied to material costs in the Materials Calculator, Configurator Pricing, and Packages.</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <input type="number" min="0" step="0.01" value={salesTax}
            onChange={e => saveSalesTax(e.target.value)}
            style={{ width:90, padding:'8px 12px', border:`1.5px solid ${C.sage}`, borderRadius:4, fontFamily:'DM Sans', fontSize:18, fontWeight:700, textAlign:'center', background:C.linen, color:C.charcoal }} />
          <span style={{ fontFamily:'DM Sans', fontSize:14, color:'#888' }}>% tax</span>
        </div>
        <div style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, background:'#F0FFF4', border:`1px solid ${C.sageLight}`, borderRadius:4, padding:'6px 12px' }}>
          Saved automatically
        </div>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <Select value={filterCat} onChange={setFilterCat}
          options={['All',...CATEGORIES].map(c=>({value:c,label:c}))} style={{width:'auto'}} />
        {isAdmin && (
          <Button size="sm" onClick={() => { setShowAdd(true); setError(''); }}>+ Add Material</Button>
        )}
        <Button variant="secondary" size="sm" onClick={exportCSV}>↓ Export CSV</Button>
        <Button variant="secondary" size="sm" onClick={openAllLinks}>↗ Open All Links</Button>
        <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#999', marginLeft:'auto' }}>
          {!isAdmin && '💡 Bold = local price set. '}Yellow = not updated in 30+ days
        </span>
      </div>

      <div className="usc-table-scroll" style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#1A1510' }}>
              {['Material','Category','Group',isAdmin?'Master Price':'Local Price',
                ...(!isAdmin?['Master']:['']),...(!isAdmin?['Local Supplier']:['Supplier']),'Countable','Updated',''].map((h,i) => (
                <th key={i} style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#ccc', textAlign:'left', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => {
              const stale = daysSince(m.updated_at) >= 30;
              const isEditing = editingId === m.id;
              const rowBg = stale ? C.stale : (i%2===0 ? '#fff' : C.linen);
              return (
                <tr key={m.id} style={{ background:rowBg, borderBottom:`1px solid ${C.linenDarker}` }}>
                  {/* Name */}
                  <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, fontWeight: m.hasOverride?700:400 }}>
                    {isEditing && isAdmin ? (
                      <input value={editVals.name ?? m.name}
                        onChange={e => setEditVals(p=>({...p,name:e.target.value}))}
                        style={{ width:180, padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:13, background:C.linen }} />
                    ) : (
                      <>
                        {m.name}
                        {m.hasOverride && m.material_group !== 'package_component' && <span style={{ marginLeft:6 }}><Badge color="blue">local price</Badge></span>}
                      </>
                    )}
                  </td>
                  {/* Category */}
                  <td style={{ padding:'10px 14px' }}>
                    {isEditing && isAdmin ? (
                      <select value={editVals.category} onChange={e => setEditVals(p=>({...p,category:e.target.value}))}
                        style={{ padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:12, background:C.linen, color:C.charcoal, cursor:'pointer' }}>
                        {['Framing','Sheathing','Roofing','Siding','Trim','Hardware','Add-ons'].map(c=>(
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge color="sand">{m.category}</Badge>
                    )}
                  </td>
                  {/* Group */}
                  <td style={{ padding:'10px 14px' }}>
                    {isEditing && isAdmin ? (
                      <select value={editVals.material_group} onChange={e => setEditVals(p=>({...p,material_group:e.target.value}))}
                        style={{ padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:12, background:C.linen, color:C.charcoal, cursor:'pointer' }}>
                        {[{v:'base',l:'Base'},{v:'addon',l:'Add-on'},{v:'package_component',l:'Pkg Component'}].map(o=>(
                          <option key={o.v} value={o.v}>{o.l}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge color={groupColor[m.material_group] || 'ghost'}>
                        {groupLabel[m.material_group] || m.material_group}
                      </Badge>
                    )}
                  </td>
                  {/* Price */}
                  <td style={{ padding:'10px 14px', minWidth:110 }}>
                    {isEditing && (isAdmin || m.material_group !== 'package_component') ? (
                      <input type="number" value={editVals.price}
                        onChange={e => setEditVals(p=>({...p,price:e.target.value}))}
                        style={{ width:80, padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:13, background:C.linen }} />
                    ) : (
                      <span style={{ fontWeight:600, color: m.hasOverride && m.material_group !== 'package_component' ? C.sage : C.charcoal }}>{fmt(m.price)}</span>
                    )}
                  </td>
                  {/* Master price (builder only) */}
                  {!isAdmin && (
                    <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:12, color:'#aaa' }}>
                      {m.hasOverride ? fmt(m.default_price) : '—'}
                    </td>
                  )}
                  {/* Admin spacer */}
                  {isAdmin && <td style={{ padding:'10px 14px' }} />}
                  {/* URL */}
                  <td style={{ padding:'10px 14px' }}>
                    {isEditing && (isAdmin || m.material_group !== 'package_component') ? (
                      <input value={editVals.url}
                        onChange={e => setEditVals(p=>({...p,url:e.target.value}))}
                        style={{ width:150, padding:'4px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:12, background:C.linen }} />
                    ) : (
                      m.url
                        ? <a href={m.url} target="_blank" rel="noreferrer" style={{ color:C.sage, fontFamily:'DM Sans', fontSize:12, fontWeight:600 }}>Shop ↗</a>
                        : <span style={{ color:'#ccc', fontSize:12 }}>—</span>
                    )}
                  </td>
                  {/* Allow quantity (admin only) */}
                  {isAdmin && (
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      {m.material_group === 'addon' ? (
                        isEditing ? (
                          <input type="checkbox" checked={editVals.allow_quantity ?? false}
                            onChange={e => setEditVals(p=>({...p, allow_quantity: e.target.checked}))}
                            style={{ accentColor:C.sage, width:15, height:15, cursor:'pointer' }} />
                        ) : (
                          <span style={{ fontFamily:'DM Sans', fontSize:11, color: m.allow_quantity ? C.sage : '#ccc', fontWeight:600 }}>
                            {m.allow_quantity ? 'Yes' : '—'}
                          </span>
                        )
                      ) : <span style={{ color:'#eee' }}>—</span>}
                    </td>
                  )}
                  {/* Updated */}
                  <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:11, color:'#888', whiteSpace:'nowrap' }}>
                    {m.updated_at ? new Date(m.updated_at).toLocaleDateString() : '—'}
                    {stale && <span style={{ marginLeft:4, color:C.staleText }}>⚠</span>}
                  </td>
                  {/* Actions */}
                  <td style={{ padding:'10px 14px' }}>
                    {isEditing ? (
                      <div style={{ display:'flex', gap:6 }}>
                        <Button size="sm" onClick={() => saveRow(m)} loading={saving}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                      </div>
                    ) : (
                      <div style={{ display:'flex', gap:6 }}>
                        {(isAdmin || m.material_group !== 'package_component') ? (
                          <Button size="sm" variant="secondary" onClick={() => startEdit(m)}>Edit</Button>
                        ) : (
                          <span title="Admin-managed price" style={{ fontFamily:'DM Sans', fontSize:11, color:'#bbb', display:'flex', alignItems:'center', gap:4 }}>🔒 Admin only</span>
                        )}
                        {!isAdmin && m.hasOverride && m.material_group !== 'package_component' && (
                          <Button size="sm" variant="ghost" onClick={() => clearOverride(m)}>Reset</Button>
                        )}
                        {isAdmin && (
                          <Button size="sm" variant="danger" onClick={() => setShowDelete(m.id)}>✕</Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Add Material Modal ── */}
      {showAdd && (
        <Modal title="Add New Material" onClose={() => { setShowAdd(false); setError(''); setNewMat(EMPTY_NEW); }}>
          {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

          <FormField label="Material name *">
            <Input value={newMat.name} onChange={v => setNewMat(p=>({...p,name:v}))}
              placeholder="e.g. 2x6x16 KD" autoFocus />
          </FormField>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FormField label="Category *">
              <Select value={newMat.category} onChange={v => setNewMat(p=>({...p,category:v}))}
                options={CATEGORIES.map(c=>({value:c,label:c}))} />
            </FormField>
            <FormField label="Group *">
              <Select value={newMat.material_group} onChange={v => setNewMat(p=>({...p,material_group:v}))}
                options={[
                  { value:'base',  label:'Base — always included in builds' },
                  { value:'addon', label:'Add-on — optional checkbox in calculator' },
                  { value:'package_component', label:'Pkg Component — used in packages only' },
                ]} />
            </FormField>
          </div>

          <FormField label="Unit price *">
            <Input type="number" value={newMat.price} onChange={v => setNewMat(p=>({...p,price:v}))}
              placeholder="0.00" />
          </FormField>

          <FormField label="Supplier URL (optional)">
            <Input value={newMat.url} onChange={v => setNewMat(p=>({...p,url:v}))}
              placeholder="https://..." />
          </FormField>

          <div style={{ background:C.linen, borderRadius:4, padding:'10px 14px', marginBottom:16, fontFamily:'DM Sans', fontSize:12, color:'#888', lineHeight:1.6 }}>
            <strong style={{ color:C.charcoal }}>Next step:</strong> After adding, go to <strong>Quantity Tables</strong> to enter quantities for each shed size.
          </div>

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setNewMat(EMPTY_NEW); }}>Cancel</Button>
            <Button onClick={addMaterial} loading={adding} disabled={!newMat.name.trim() || !newMat.price}>
              Add Material
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm Modal ── */}
      {showDelete && (
        <Modal title="Delete Material" onClose={() => setShowDelete(null)} width={400}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:C.charcoal, margin:'0 0 8px', lineHeight:1.6 }}>
            This will permanently delete this material and all its quantities, overrides, and price history.
          </p>
          <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#888', margin:'0 0 20px' }}>
            This cannot be undone.
          </p>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => setShowDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteMaterial(showDelete)} loading={saving}>
              Delete Permanently
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
