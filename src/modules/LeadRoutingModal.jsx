// src/modules/LeadRoutingModal.jsx
// Admin-only manager for ShedPro territory -> builder routing (opened from Contacts).
//
// New leads arriving from ShedPro carry a `shedpro_territory` tag; a DB trigger
// auto-assigns them to the mapped builder on insert (see MIGRATION_contacts_territory_routing.sql).
// This UI lets the admin: map any territories already seen on contacts but not yet routed,
// edit/remove existing mappings, and add a mapping by hand. Saving a mapping also assigns
// any existing UNASSIGNED contacts with that territory (handled in lib/contacts.js).
import { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/supabase';
import {
  fetchTerritoryRoutes, fetchUnmappedTerritories, setTerritoryRoute, deleteTerritoryRoute,
} from '../lib/contacts';
import { Modal, Select, Button, Spinner, ErrorBanner, Input } from '../components/UI';

function builderOptions(builders) {
  return [
    { value: '', label: '— Unassigned —' },
    ...builders.map(b => ({ value: b.id, label: b.full_name || b.email })),
  ];
}

export default function LeadRoutingModal({ builders, onClose, onChanged }) {
  const [routes,   setRoutes]   = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState('');     // territory currently saving
  const [newTerr,  setNewTerr]  = useState('');
  const [newUser,  setNewUser]  = useState('');

  const opts = builderOptions(builders);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const [r, u] = await Promise.all([fetchTerritoryRoutes(), fetchUnmappedTerritories()]);
    setLoading(false);
    if (r.error) { setError(r.error.message); return; }
    if (u.error) { setError(u.error.message); return; }
    setRoutes(r.data || []);
    setUnmapped(u.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(territory, userId) {
    if (!territory) return;
    setBusy(territory); setError('');
    const { error: e } = await setTerritoryRoute(territory, userId);
    setBusy('');
    if (e) { setError(e.message); return; }
    await load();
    onChanged?.();
  }

  async function remove(territory) {
    setBusy(territory); setError('');
    const { error: e } = await deleteTerritoryRoute(territory);
    setBusy('');
    if (e) { setError(e.message); return; }
    await load();
    onChanged?.();
  }

  async function addNew() {
    const t = newTerr.trim();
    if (!t) return;
    await save(t, newUser);
    setNewTerr(''); setNewUser('');
  }

  return (
    <Modal title="Lead routing" onClose={onClose} width={620}>
      <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#666', marginTop:0, lineHeight:1.5 }}>
        Map each ShedPro <strong>territory</strong> to a builder. New leads with that territory are
        assigned automatically when they arrive; saving a mapping also assigns any existing
        unassigned leads in that territory.
      </p>

      {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:30 }}><Spinner size={26} /></div>
      ) : (
        <>
          {/* Unmapped territories seen on incoming contacts */}
          {unmapped.length > 0 && (
            <div style={{ marginBottom:22 }}>
              <SectionLabel>Needs mapping ({unmapped.length})</SectionLabel>
              {unmapped.map(u => (
                <Row key={u.territory}>
                  <TerrName>
                    {u.territory}
                    <span style={{ color:'#aaa', fontWeight:400 }}> · {u.count} lead{u.count === 1 ? '' : 's'}</span>
                  </TerrName>
                  <div style={{ width:230, flexShrink:0 }}>
                    <Select
                      value=""
                      disabled={busy === u.territory}
                      onChange={v => save(u.territory, v)}
                      options={[{ value:'', label: busy === u.territory ? 'Saving…' : 'Assign to builder…' }, ...opts.slice(1)]}
                    />
                  </div>
                </Row>
              ))}
            </div>
          )}

          {/* Existing mappings */}
          <SectionLabel>Mappings</SectionLabel>
          {routes.length === 0 ? (
            <div style={{ fontFamily:'DM Sans', fontSize:13, color:'#999', padding:'8px 0 16px' }}>
              No mappings yet.
            </div>
          ) : (
            routes.map(r => (
              <Row key={r.territory}>
                <TerrName>{r.territory}</TerrName>
                <div style={{ width:230, flexShrink:0, display:'flex', gap:8, alignItems:'center' }}>
                  <Select
                    value={r.user_id || ''}
                    disabled={busy === r.territory}
                    onChange={v => save(r.territory, v)}
                    options={opts}
                  />
                  <button
                    onClick={() => remove(r.territory)}
                    title="Remove mapping"
                    style={{ background:'none', border:'none', cursor:'pointer', color:C.error, fontSize:16, lineHeight:1, flexShrink:0 }}
                  >×</button>
                </div>
              </Row>
            ))
          )}

          {/* Add a mapping by hand */}
          <div style={{ marginTop:18, paddingTop:16, borderTop:`1px solid ${C.linenDarker}` }}>
            <SectionLabel>Add a mapping</SectionLabel>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:160 }}>
                <Input value={newTerr} onChange={setNewTerr} placeholder="Territory (exact ShedPro value)" />
              </div>
              <div style={{ width:200 }}>
                <Select value={newUser} onChange={setNewUser} options={opts} />
              </div>
              <Button size="sm" onClick={addNew} loading={busy === newTerr.trim() && !!newTerr.trim()} disabled={!newTerr.trim()}>Add</Button>
            </div>
          </div>
        </>
      )}

      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:22 }}>
        <Button variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{children}</div>;
}
function Row({ children }) {
  return <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'7px 0', borderBottom:`1px solid ${C.linen}` }}>{children}</div>;
}
function TerrName({ children }) {
  return <div style={{ fontFamily:'DM Sans', fontSize:13.5, fontWeight:600, color:C.charcoal, wordBreak:'break-word', minWidth:0 }}>{children}</div>;
}
