// src/modules/QuantityTableEditor.jsx
import { useState, useRef, useCallback } from 'react';
import { supabase, SHED_SIZES, C, fmt, applyOverride, getMaterialIdsByGroup } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { SectionHeader, Button, WarningBanner, ErrorBanner, SuccessBanner } from '../components/UI';

export default function QuantityTableEditor({ materials, overrides, quantities, setQuantities, onRefresh }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [collapsed,   setCollapsed]   = useState({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [localEdits,  setLocalEdits]  = useState({});
  const [savedCells,  setSavedCells]  = useState({});   // key → true, flashes green briefly

  // Debounce timers per cell
  const timers = useRef({});

  const matById = Object.fromEntries(materials.map(m => [m.id, applyOverride(m, overrides)]));

  const GROUPS = [
    { key:'base',  label:'Base Materials',   ids: getMaterialIdsByGroup(materials, 'base') },
    { key:'addon', label:'Add-on Materials', ids: getMaterialIdsByGroup(materials, 'addon') },
  ];

  const qtyMap = {};
  for (const row of quantities) {
    if (!qtyMap[row.material_id]) qtyMap[row.material_id] = {};
    qtyMap[row.material_id][row.shed_size] = row.quantity;
  }

  function getDisplayVal(matId, size) {
    const key = `${matId}|${size}`;
    if (localEdits[key] !== undefined) return localEdits[key];
    const q = qtyMap[matId]?.[size];
    return q != null ? String(q) : '';
  }

  const saveCell = useCallback(async (matId, size, val) => {
    const key = `${matId}|${size}`;

    if (val === '') {
      await supabase.from('quantities').delete()
        .eq('material_id', matId).eq('shed_size', size);
      setQuantities(prev => prev.filter(r => !(r.material_id === matId && r.shed_size === size)));
    } else {
      const qty = parseFloat(val);
      if (isNaN(qty) || qty < 0) return;
      const { error: e } = await supabase.from('quantities')
        .upsert(
          { material_id: matId, shed_size: size, quantity: qty, updated_at: new Date().toISOString() },
          { onConflict: 'material_id,shed_size' }
        );
      if (e) { setError(`Save failed for ${matId}/${size}: ${e.message}`); return; }
      setQuantities(prev => {
        const next = prev.filter(r => !(r.material_id === matId && r.shed_size === size));
        next.push({ material_id: matId, shed_size: size, quantity: qty });
        return next;
      });
    }

    // Clear local edit and flash green
    setLocalEdits(p => { const n = {...p}; delete n[key]; return n; });
    setSavedCells(p => ({ ...p, [key]: true }));
    setTimeout(() => setSavedCells(p => { const n = {...p}; delete n[key]; return n; }), 800);
  }, [setQuantities]);

  function handleChange(matId, size, val) {
    if (!isAdmin) return;
    const key = `${matId}|${size}`;

    // Update display immediately
    setLocalEdits(p => ({ ...p, [key]: val }));

    // Debounce save — 600ms after last keystroke
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      saveCell(matId, size, val);
      delete timers.current[key];
    }, 600);
  }

  // Also save immediately on blur in case they navigate away quickly
  function handleBlur(matId, size) {
    if (!isAdmin) return;
    const key = `${matId}|${size}`;
    if (localEdits[key] === undefined) return;
    // Cancel debounce and save right now
    if (timers.current[key]) { clearTimeout(timers.current[key]); delete timers.current[key]; }
    saveCell(matId, size, localEdits[key]);
  }

  async function resetAll() {
    setSaving(true);
    await supabase.from('quantities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setQuantities([]);
    setLocalEdits({});
    setSaving(false);
    setShowConfirm(false);
    setSuccess('All quantities cleared.');
  }

  function exportCSV() {
    const allIds = [...getMaterialIdsByGroup(materials,'base'), ...getMaterialIdsByGroup(materials,'addon')];
    const rows = [['Material', ...SHED_SIZES]];
    allIds.forEach(id => {
      const mat = matById[id]; if (!mat) return;
      rows.push([mat.name, ...SHED_SIZES.map(s => qtyMap[id]?.[s] ?? '')]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = 'usc_quantities.csv'; a.click();
  }

  function sizeTotal(size) {
    let total = 0;
    materials.forEach(m => {
      const mat = matById[m.id]; if (!mat) return;
      total += (parseFloat(qtyMap[m.id]?.[size]) || 0) * mat.price;
    });
    return total;
  }

  return (
    <div>
      <SectionHeader sub={isAdmin ? 'Changes save automatically as you type.' : 'Read-only. Contact your USC admin to update quantities.'}>
        Quantity Tables
      </SectionHeader>

      {!isAdmin && <WarningBanner>You have read-only access to quantity data.</WarningBanner>}

      {success && <SuccessBanner>{success}</SuccessBanner>}
      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

      <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {isAdmin && (
          <Button variant="danger" size="sm" onClick={() => setShowConfirm(true)}>Reset All</Button>
        )}
        <Button variant="secondary" size="sm" onClick={exportCSV}>↓ Export CSV</Button>
        {isAdmin && (
          <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#aaa', marginLeft:'auto' }}>
            ⚡ Saves automatically as you type
          </span>
        )}
      </div>

      {showConfirm && (
        <div style={{ background:'#FEF2F2', border:`1px solid #FCA5A5`, borderRadius:4, padding:16, marginBottom:16 }}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:'#991B1B', margin:'0 0 12px' }}>Delete all quantity data for all sizes?</p>
          <div style={{ display:'flex', gap:8 }}>
            <Button variant="danger" size="sm" onClick={resetAll} loading={saving}>Yes, Reset All</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="usc-table-scroll" style={{ overflow:'auto', maxHeight:'70vh', border:`1px solid ${C.linenDarker}`, borderRadius:6, background:'#FFFDF9' }}>
        <table style={{ borderCollapse:'collapse', fontSize:12 }}>
          <thead style={{ position:'sticky', top:0, zIndex:20 }}>
            <tr style={{ background:'#1A1510' }}>
              <th style={{ position:'sticky', left:0, zIndex:30, background:'#1A1510', padding:'10px 14px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#ccc', textAlign:'left', minWidth:220, borderRight:`1px solid #555` }}>
                Material
              </th>
              {SHED_SIZES.map(s => (
                <th key={s} style={{ padding:'10px 8px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, color:'#ccc', textAlign:'center', minWidth:58, whiteSpace:'nowrap' }}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(g => {
              const isCollapsed = collapsed[g.key];
              return [
                <tr key={`hdr-${g.key}`}
                  onClick={() => setCollapsed(p => ({ ...p, [g.key]: !p[g.key] }))}
                  style={{ background:'#1A1510', cursor:'pointer' }}>
                  <td colSpan={SHED_SIZES.length+1} style={{ padding:'8px 14px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, color:C.sageLight, userSelect:'none' }}>
                    {isCollapsed ? '▶' : '▼'} {g.label} ({g.ids.length})
                  </td>
                </tr>,
                ...(!isCollapsed ? g.ids.map((id, ri) => {
                  const mat = matById[id]; if (!mat) return null;
                  const filledCount = SHED_SIZES.filter(s => (qtyMap[id]?.[s] ?? null) !== null).length;
                  const incomplete = filledCount > 0 && filledCount < 10;
                  const rowBg = incomplete ? C.stale : (ri%2===0 ? '#fff' : C.linen);
                  return (
                    <tr key={id} style={{ borderBottom:`1px solid ${C.linen}`, background:rowBg }}>
                      <td style={{ position:'sticky', left:0, zIndex:10, background:rowBg, padding:'6px 14px', fontFamily:'DM Sans', fontSize:12, color:C.charcoal, fontWeight:500, borderRight:`1px solid ${C.linenDarker}`, minWidth:220 }}>
                        {mat.name}
                        {incomplete && <span title="Fewer than 10 sizes filled" style={{ marginLeft:6, color:C.staleText }}>⚠</span>}
                      </td>
                      {SHED_SIZES.map(s => {
                        const key = `${id}|${s}`;
                        const isEditing = localEdits[key] !== undefined;
                        const isSaved   = savedCells[key];
                        const val = getDisplayVal(id, s);
                        return (
                          <td key={s} style={{ padding:'2px 3px', textAlign:'center' }}>
                            <input
                              type="number" min="0"
                              value={val}
                              readOnly={!isAdmin}
                              onChange={e => handleChange(id, s, e.target.value)}
                              onBlur={() => handleBlur(id, s)}
                              style={{
                                width:52, padding:'3px 4px',
                                border: isSaved  ? `1.5px solid ${C.sage}`
                                      : isEditing ? `1.5px solid ${C.sand}`
                                      : `1px solid ${C.linenDarker}`,
                                borderRadius:3, fontFamily:'DM Sans', fontSize:12,
                                textAlign:'center',
                                background: isSaved   ? '#EFF6EE'
                                          : isEditing ? '#FFFBF0'
                                          : (val ? '#fff' : C.linen),
                                color: C.charcoal,
                                cursor: isAdmin ? 'text' : 'default',
                                transition: 'background 0.3s, border-color 0.3s',
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                }) : []),
              ];
            })}
            <tr style={{ background:'#1A1510', position:'sticky', bottom:0 }}>
              <td style={{ position:'sticky', left:0, zIndex:10, background:'#1A1510', padding:'8px 14px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, color:C.sageLight, borderRight:'1px solid #555' }}>
                Total Material Cost
              </td>
              {SHED_SIZES.map(s => (
                <td key={s} style={{ padding:'8px 3px', textAlign:'center', fontFamily:'DM Sans', fontSize:10, fontWeight:700, color:'#fff', whiteSpace:'nowrap' }}>
                  {sizeTotal(s) > 0 ? fmt(sizeTotal(s)) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
