// src/modules/AdminPanel.jsx
import { useState, useEffect } from 'react';
import { supabase, C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  Card, SectionHeader, Button, Badge, Input, FormField,
  ErrorBanner, SuccessBanner, Modal, Label, Spinner,
} from '../components/UI';

export default function AdminPanel() {
  const { profile } = useAuth();
  const [builders,     setBuilders]     = useState([]);
  const [invitations,  setInvitations]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showInvite,   setShowInvite]   = useState(false);
  const [invEmail,     setInvEmail]     = useState('');
  const [invName,      setInvName]      = useState('');
  const [invMarket,    setInvMarket]    = useState('');
  const [inviting,     setInviting]     = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: profs }, { data: invs }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('invitations').select('*').order('created_at', { ascending:false }),
    ]);
    setBuilders((profs || []).filter(p => p.id !== profile?.id && p.role !== 'blocked'));
    setInvitations(invs || []);
    setLoading(false);
  }

  async function sendInvite() {
    if (!invEmail.trim()) return;
    setInviting(true); setError('');
    const email = invEmail.trim().toLowerCase();

    // Upsert invitation record
    const { error: e1 } = await supabase.from('invitations').upsert({
      email,
      full_name: invName.trim() || null,
      market: invMarket.trim() || null,
      invited_by: profile.id,
      accepted: false,
    }, { onConflict: 'email' });
    if (e1) { setError(e1.message); setInviting(false); return; }

    // If a blocked profile already exists for this email, upgrade it immediately
    const { data: existing } = await supabase
      .from('profiles').select('id, role').eq('email', email).maybeSingle();
    if (existing?.role === 'blocked') {
      await supabase.from('profiles')
        .update({ role: 'builder', full_name: invName.trim() || null, market: invMarket.trim() || null })
        .eq('id', existing.id);
      await supabase.from('invitations').update({ accepted: true }).eq('email', email);
      setSuccess(`${email} already had an account — they've been upgraded to builder and can log in now.`);
    } else {
      setSuccess(`Invitation recorded for ${email}. They can now sign in at the app and will get builder access automatically.`);
    }

    setInvEmail(''); setInvName(''); setInvMarket('');
    setInviting(false);
    setShowInvite(false);
    load();
  }

  async function updateRole(userId, newRole) {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);
    if (error) { setError(error.message); return; }
    setSuccess('Role updated.');
    load();
  }

  async function updateMarket(userId, market) {
    await supabase.from('profiles').update({ market }).eq('id', userId);
    load();
  }

  async function revokeInvite(id) {
    await supabase.from('invitations').delete().eq('id', id);
    load();
  }

  async function deleteUser(userId, email) {
    if (!window.confirm(`Delete ${email}? This removes them from the user list.`)) return;
    setError('');

    // Try a hard delete first
    const { error: delErr, count } = await supabase
      .from('profiles').delete({ count: 'exact' }).eq('id', userId);

    if (delErr) { setError(delErr.message); return; }

    // If RLS silently blocked the delete (count === 0), fall back to blocking the role
    if (count === 0) {
      const { error: upErr } = await supabase
        .from('profiles').update({ role: 'blocked' }).eq('id', userId);
      if (upErr) { setError(upErr.message); return; }
      setSuccess(`${email} has been blocked.`);
    } else {
      setSuccess(`${email} removed.`);
    }

    // Remove any pending invitations for this email so they can't re-enter
    await supabase.from('invitations').delete().eq('email', email.toLowerCase());

    load();
  }

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner size={28} /></div>;

  return (
    <div>
      <SectionHeader sub="Manage builders, invitations, and roles.">
        Admin Panel
      </SectionHeader>

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* ── Builders ── */}
      <Card style={{ marginBottom:24 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={sh3}>Users ({builders.length + 1})</h3>
          <Button size="sm" onClick={() => setShowInvite(true)}>+ Invite Builder</Button>
        </div>

        <div className="usc-table-scroll" style={{ overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
          <thead>
            <tr style={{ borderBottom:`2px solid ${C.linenDarker}` }}>
              {['Name','Email','Role','Market','Joined',''].map(h=>(
                <th key={h} style={{ padding:'8px 12px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#888', textAlign:'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Admin row (you) */}
            <tr style={{ borderBottom:`1px solid ${C.linen}`, background:C.linen }}>
              <td style={td}>{profile?.full_name} <Badge color="sage">You</Badge></td>
              <td style={td}>{profile?.email}</td>
              <td style={td}><Badge color="blue">admin</Badge></td>
              <td style={td}>{profile?.market || '—'}</td>
              <td style={td}>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</td>
              <td style={td} />
            </tr>

            {builders.map(b => (
              <BuilderRow key={b.id} builder={b} onRoleChange={updateRole} onMarketChange={updateMarket} onDelete={deleteUser} />
            ))}
          </tbody>
        </table>
        </div>
      </Card>

      {/* ── Pending invitations ── */}
      {invitations.filter(i => !i.accepted).length > 0 && (
        <Card>
          <h3 style={{ ...sh3, marginBottom:16 }}>Pending Invitations</h3>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`2px solid ${C.linenDarker}` }}>
                {['Email','Name','Market','Invited',''].map(h=>(
                  <th key={h} style={{ padding:'8px 12px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#888', textAlign:'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invitations.filter(i=>!i.accepted).map(inv => (
                <tr key={inv.id} style={{ borderBottom:`1px solid ${C.linen}` }}>
                  <td style={td}>{inv.email}</td>
                  <td style={td}>{inv.full_name || '—'}</td>
                  <td style={td}>{inv.market || '—'}</td>
                  <td style={{ ...td, fontSize:11, color:'#aaa' }}>{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td style={td}>
                    <Button size="sm" variant="ghost" onClick={() => revokeInvite(inv.id)}>Revoke</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Invite modal ── */}
      {showInvite && (
        <Modal title="Invite a Builder" onClose={() => setShowInvite(false)}>
          <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#666', margin:'0 0 20px', lineHeight:1.6 }}>
            Add their email below. When they visit the app and sign in, their account will be created automatically as a builder.
          </p>
          <FormField label="Email address *">
            <Input type="email" value={invEmail} onChange={setInvEmail} placeholder="builder@example.com" autoFocus />
          </FormField>
          <FormField label="Full name (optional)">
            <Input value={invName} onChange={setInvName} placeholder="Dave Yoder" />
          </FormField>
          <FormField label="Market (optional)">
            <Input value={invMarket} onChange={setInvMarket} placeholder="Houston, TX" />
          </FormField>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Button variant="ghost" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button onClick={sendInvite} loading={inviting} disabled={!invEmail.trim()}>
              Record Invitation
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BuilderRow({ builder, onRoleChange, onMarketChange, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [market,  setMarket]  = useState(builder.market || '');

  async function save() {
    await onMarketChange(builder.id, market);
    setEditing(false);
  }

  return (
    <tr style={{ borderBottom:`1px solid ${C.linen}` }}>
      <td style={td}>{builder.full_name || '—'}</td>
      <td style={{ ...td, color:'#888' }}>{builder.email}</td>
      <td style={td}>
        <select
          value={builder.role}
          onChange={e => onRoleChange(builder.id, e.target.value)}
          style={{ fontFamily:'DM Sans', fontSize:12, padding:'3px 8px', border:`1px solid ${C.linenDarker}`, borderRadius:3, background:C.linen, color:C.charcoal, cursor:'pointer' }}
        >
          <option value="builder">builder</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td style={td}>
        {editing ? (
          <div style={{ display:'flex', gap:6 }}>
            <input value={market} onChange={e=>setMarket(e.target.value)}
              style={{ width:100, padding:'3px 8px', border:`1.5px solid ${C.sage}`, borderRadius:3, fontFamily:'DM Sans', fontSize:12, background:C.linen }} />
            <Button size="sm" onClick={save}>✓</Button>
          </div>
        ) : (
          <span style={{ cursor:'pointer', borderBottom:`1px dashed ${C.linenDarker}`, fontFamily:'DM Sans', fontSize:13 }}
            onClick={() => setEditing(true)}>
            {builder.market || <span style={{ color:'#ccc' }}>+ market</span>}
          </span>
        )}
      </td>
      <td style={{ ...td, fontSize:11, color:'#aaa' }}>{new Date(builder.created_at).toLocaleDateString()}</td>
      <td style={td}>
        <Button size="sm" variant="danger" onClick={() => onDelete(builder.id, builder.email)}>Delete</Button>
      </td>
    </tr>
  );
}

const sh3 = { fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:C.charcoal, margin:0 };
const td  = { padding:'10px 12px', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, verticalAlign:'middle' };
