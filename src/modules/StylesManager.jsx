// src/modules/StylesManager.jsx
import { useState } from 'react';
import { supabase, C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { SectionHeader, Button, Input, ErrorBanner, SuccessBanner, Modal, FormField, WarningBanner } from '../components/UI';

export default function StylesManager({ styles, setStyles }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editVals,  setEditVals]  = useState({});
  const [showAdd,   setShowAdd]   = useState(false);
  const [newStyle,  setNewStyle]  = useState({ name:'', markup:'0' });
  const [adding,    setAdding]    = useState(false);
  const [deleteId,  setDeleteId]  = useState(null);

  async function refresh() {
    const { data } = await supabase.from('styles').select('*').order('sort_order');
    setStyles(data || []);
  }

  async function saveStyle(style) {
    const markup = parseFloat(editVals.markup);
    if (isNaN(markup)||markup<0) { setError('Markup must be 0 or greater.'); return; }
    setSaving(true); setError('');
    const { error: e } = await supabase.from('styles').update({ name:editVals.name?.trim()||style.name, markup, updated_at:new Date().toISOString() }).eq('id', style.id);
    if (e) { setError(e.message); setSaving(false); return; }
    await refresh(); setSaving(false); setEditingId(null); setSuccess('Style updated.');
  }

  async function addStyle() {
    if (!newStyle.name.trim()) { setError('Name is required.'); return; }
    const markup = parseFloat(newStyle.markup);
    if (isNaN(markup)||markup<0) { setError('Markup must be 0 or greater.'); return; }
    setAdding(true); setError('');
    const maxOrder = Math.max(0, ...styles.map(s=>s.sort_order||0));
    const { error: e } = await supabase.from('styles').insert({ name:newStyle.name.trim(), markup, sort_order:maxOrder+1 });
    if (e) { setError(e.message); setAdding(false); return; }
    await refresh(); setAdding(false); setShowAdd(false); setNewStyle({name:'',markup:'0'});
    setSuccess(`"${newStyle.name.trim()}" added.`);
  }

  async function deleteStyle(id) {
    setSaving(true);
    await supabase.from('styles').delete().eq('id', id);
    await refresh(); setSaving(false); setDeleteId(null); setSuccess('Style deleted.');
  }

  return (
    <div style={{ maxWidth:700 }}>
      <SectionHeader sub="Set a markup percentage per style. Applied to base materials before the general multiplier.">Styles</SectionHeader>
      {!isAdmin && <WarningBanner>Read-only access.</WarningBanner>}
      {error   && <ErrorBanner onDismiss={()=>setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}
      {isAdmin && <div style={{marginBottom:20}}><Button onClick={()=>{setShowAdd(true);setError('');}}>+ Add Style</Button></div>}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {styles.map((style,i)=>{
          const isEditing = editingId===style.id;
          return (
            <div key={style.id} style={{background:'#FFFDF9',border:`1px solid ${C.linenDarker}`,borderRadius:6,padding:'16px 20px',borderLeft:`3px solid ${style.markup>0?C.sage:C.linenDarker}`}}>
              <div style={{display:'flex',alignItems:'center',gap:16}}>
                <div style={{fontFamily:'Cormorant Garamond, serif',fontSize:22,fontWeight:600,color:C.linenDarker,width:28}}>{String(i+1).padStart(2,'0')}</div>
                <div style={{flex:1}}>
                  {isEditing ? <Input value={editVals.name} onChange={v=>setEditVals(p=>({...p,name:v}))} style={{fontSize:15,fontWeight:600}} />
                  : <div style={{fontFamily:'Cormorant Garamond, serif',fontSize:20,fontWeight:600,color:'#1A1A1A'}}>{style.name}</div>}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                  {isEditing ? (
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <input type="number" min="0" max="100" step="0.5" value={editVals.markup} onChange={e=>setEditVals(p=>({...p,markup:e.target.value}))}
                        style={{width:70,padding:'6px 10px',border:`1.5px solid ${C.sage}`,borderRadius:4,fontFamily:'DM Sans',fontSize:14,fontWeight:700,textAlign:'right',background:'#FFFDF9',color:'#1A1A1A'}} />
                      <span style={{fontFamily:'DM Sans',fontSize:14,color:'#888'}}>%</span>
                    </div>
                  ) : (
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:'DM Sans',fontSize:18,fontWeight:700,color:style.markup>0?C.sage:'#ccc'}}>{style.markup>0?`+${style.markup}%`:'—'}</div>
                      {style.markup>0&&<div style={{fontFamily:'DM Sans',fontSize:10,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em'}}>markup</div>}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div style={{display:'flex',gap:6,flexShrink:0}}>
                    {isEditing ? (
                      <><Button size="sm" onClick={()=>saveStyle(style)} loading={saving}>Save</Button><Button size="sm" variant="ghost" onClick={()=>setEditingId(null)}>Cancel</Button></>
                    ) : (
                      <><Button size="sm" variant="secondary" onClick={()=>{setEditingId(style.id);setEditVals({name:style.name,markup:String(style.markup)});}}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={()=>setDeleteId(style.id)}>✕</Button></>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {showAdd && (
        <Modal title="Add Style" onClose={()=>{setShowAdd(false);setNewStyle({name:'',markup:'0'});setError('');}}>
          {error && <ErrorBanner onDismiss={()=>setError('')}>{error}</ErrorBanner>}
          <FormField label="Style name *"><Input value={newStyle.name} onChange={v=>setNewStyle(p=>({...p,name:v}))} placeholder="e.g. High Wall Modern" autoFocus /></FormField>
          <FormField label="Base material markup (%)">
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <Input type="number" value={newStyle.markup} onChange={v=>setNewStyle(p=>({...p,markup:v}))} style={{maxWidth:100}} />
              <span style={{fontFamily:'DM Sans',fontSize:13,color:'#888'}}>% added to base material cost</span>
            </div>
          </FormField>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
            <Button variant="ghost" onClick={()=>{setShowAdd(false);setNewStyle({name:'',markup:'0'});}}>Cancel</Button>
            <Button onClick={addStyle} loading={adding} disabled={!newStyle.name.trim()}>Add Style</Button>
          </div>
        </Modal>
      )}
      {deleteId && (
        <Modal title="Delete Style" onClose={()=>setDeleteId(null)} width={400}>
          <p style={{fontFamily:'DM Sans',fontSize:14,color:'#1A1A1A',margin:'0 0 20px',lineHeight:1.6}}>This will permanently delete this style.</p>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
            <Button variant="ghost" onClick={()=>setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={()=>deleteStyle(deleteId)} loading={saving}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
