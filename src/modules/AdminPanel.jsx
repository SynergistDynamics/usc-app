// src/modules/AdminPanel.jsx
import { useState, useEffect } from 'react';
import { supabase, C, ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from '../lib/supabase';
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
  const [activeTab,    setActiveTab]    = useState('users');
  const isSuperAdmin = profile?.is_super_admin === true;

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

  async function updateSuperAdmin(userId, value) {
    // Super admin features live inside the admin-only page, so granting it also
    // promotes the user to admin (otherwise the flag would be unreachable).
    const patch = value ? { is_super_admin: true, role: 'admin' } : { is_super_admin: false };
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) { setError(error.message); return; }
    setSuccess(value ? 'Super admin granted (also set to admin).' : 'Super admin removed.');
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

  return (
    <div>
      <SectionHeader sub="Manage builders, invitations, and roles.">
        Admin Panel
      </SectionHeader>

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Tabs — Tech Stack only visible to super admins */}
      {isSuperAdmin && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:0, marginBottom:24, borderBottom:`2px solid ${C.linenDarker}` }}>
          {[['users','Users'],['onboarding','Builder Onboarding'],['tech','Tech Stack']].map(([key,label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding:'10px 20px', border:'none', cursor:'pointer', background:'transparent', color:activeTab===key?C.sage:'#aaa', borderBottom:activeTab===key?`2px solid ${C.sage}`:'2px solid transparent', marginBottom:-2, transition:'all 0.15s' }}>{label}</button>
          ))}
        </div>
      )}

      {isSuperAdmin && activeTab === 'onboarding' && <BuilderOnboardingTab />}
      {isSuperAdmin && activeTab === 'tech' && <TechStackTab isSuperAdmin={isSuperAdmin} />}

      {activeTab === 'users' && (loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner size={28} /></div>
      ) : (
      <>
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
              {['Name','Email','Role','Market', ...(isSuperAdmin ? ['Super Admin'] : []), 'Joined',''].map(h=>(
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
              {isSuperAdmin && <td style={td}><Badge color="sand">Super admin</Badge></td>}
              <td style={td}>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</td>
              <td style={td} />
            </tr>

            {builders.map(b => (
              <BuilderRow key={b.id} builder={b} isSuperAdmin={isSuperAdmin} onRoleChange={updateRole} onMarketChange={updateMarket} onSuperAdminChange={updateSuperAdmin} onDelete={deleteUser} />
            ))}
          </tbody>
        </table>
        </div>
      </Card>

      {/* ── Access levels reference ── */}
      <AccessLevelsCard />

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
      </>
      ))}
    </div>
  );
}

// ── Builder Onboarding tab (super admin only) ─────────────────
// Links to the public payment pages served as static HTML from /public.
// Keep `path` values in sync with the folders in public/ (and any route checks).
const ONBOARDING_PAGES = [
  {
    key:   'onboarding-fee',
    title: 'Builder Onboarding Fee',
    price: '$499 one-time',
    desc:  'New builder pays the one-time setup fee. We configure the platform for their market (territory zips, pricing, configurator, CRM, ads, profile) before the territory goes live.',
    path:  '/onboarding-fee',
  },
  {
    key:   'activate-license',
    title: 'License Activation',
    price: '$1,495 / month + 10% IP fee',
    desc:  'Approved builder pays their first monthly license payment to activate their territory and go live (typically within 48 hours).',
    path:  '/activate-license',
  },
];

function BuilderOnboardingTab() {
  const [copied, setCopied] = useState(null);

  const fullUrl = (path) => (typeof window !== 'undefined' ? window.location.origin : '') + path;

  async function copyLink(page) {
    try {
      await navigator.clipboard.writeText(fullUrl(page.path));
      setCopied(page.key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <Card>
      <h3 style={sh3}>Builder Onboarding</h3>
      <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', margin:'6px 0 20px', lineHeight:1.6 }}>
        Public payment pages for bringing a new builder online. Open a page to preview it, or copy its
        link to send to the builder when they reach that step. Visible only to super admins.
      </p>

      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {ONBOARDING_PAGES.map(page => (
          <div key={page.key} style={{ border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'16px 18px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, flexWrap:'wrap' }}>
              <h4 style={{ fontFamily:'DM Sans', fontSize:15, fontWeight:700, color:C.charcoal, margin:0 }}>{page.title}</h4>
              <span style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.sage }}>{page.price}</span>
            </div>
            <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#666', margin:'8px 0 14px', lineHeight:1.6 }}>{page.desc}</p>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <Button size="sm" onClick={() => window.open(page.path, '_blank', 'noopener')}>Open page ↗</Button>
              <Button size="sm" variant="secondary" onClick={() => copyLink(page)}>
                {copied === page.key ? 'Copied ✓' : 'Copy link'}
              </Button>
              <code style={{ fontFamily:'monospace', fontSize:12, color:'#999' }}>{page.path}</code>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Tech Stack tab (super admin only) ─────────────────────────
function TechStackTab() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form,    setForm]    = useState({ name:'', url:'', username:'' });
  const [editId,  setEditId]  = useState(null);
  const [editForm,setEditForm]= useState({ name:'', url:'', username:'' });
  const [deleteId,setDeleteId]= useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error: e } = await supabase.from('tech_stack').select('*').order('sort_order').order('name');
    if (e) setError(e.message);
    setItems(data || []);
    setLoading(false);
  }

  async function addItem() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    const maxOrder = Math.max(0, ...items.map(i => i.sort_order || 0));
    const { error: e } = await supabase.from('tech_stack').insert({
      name: form.name.trim(),
      url: form.url.trim() || null,
      username: form.username.trim() || null,
      sort_order: maxOrder + 1,
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setShowAdd(false); setForm({ name:'', url:'', username:'' });
    setSuccess('Added.'); load();
  }

  async function saveEdit(id) {
    if (!editForm.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    const { error: e } = await supabase.from('tech_stack').update({
      name: editForm.name.trim(),
      url: editForm.url.trim() || null,
      username: editForm.username.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setEditId(null); setSuccess('Saved.'); load();
  }

  async function removeItem(id) {
    setSaving(true);
    const { error: e } = await supabase.from('tech_stack').delete().eq('id', id);
    setSaving(false); setDeleteId(null);
    if (e) { setError(e.message); return; }
    setSuccess('Removed.'); load();
  }

  return (
    <div>
      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={sh3}>Tech Stack</h3>
          <Button size="sm" onClick={() => { setShowAdd(true); setError(''); }}>+ Add Tool</Button>
        </div>
        <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', margin:'0 0 16px' }}>
          The software this app runs on, with the account you signed up with. Visible only to super admins.
        </p>

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:30 }}><Spinner size={24} /></div>
        ) : items.length === 0 ? (
          <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#aaa', margin:0 }}>No tools yet. Add your first one.</p>
        ) : (
          <div className="usc-table-scroll" style={{ overflow:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
            <thead>
              <tr style={{ borderBottom:`2px solid ${C.linenDarker}` }}>
                {['Name','Link','Username / Email',''].map(h=>(
                  <th key={h} style={{ padding:'8px 12px', fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#888', textAlign:'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => editId === item.id ? (
                <tr key={item.id} style={{ borderBottom:`1px solid ${C.linen}`, background:C.linen }}>
                  <td style={td}><Input value={editForm.name} onChange={v=>setEditForm(p=>({...p,name:v}))} /></td>
                  <td style={td}><Input value={editForm.url} onChange={v=>setEditForm(p=>({...p,url:v}))} placeholder="https://" /></td>
                  <td style={td}><Input value={editForm.username} onChange={v=>setEditForm(p=>({...p,username:v}))} /></td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>
                    <Button size="sm" onClick={() => saveEdit(item.id)} loading={saving}>Save</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} style={{ borderBottom:`1px solid ${C.linen}` }}>
                  <td style={{ ...td, fontWeight:600 }}>{item.name}</td>
                  <td style={td}>
                    {item.url
                      ? <a href={item.url} target="_blank" rel="noreferrer" style={{ color:C.sage, fontSize:13 }}>{item.url}</a>
                      : <span style={{ color:'#ccc' }}>—</span>}
                  </td>
                  <td style={{ ...td, color:'#666' }}>{item.username || <span style={{ color:'#ccc' }}>—</span>}</td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditId(item.id); setEditForm({ name:item.name, url:item.url||'', username:item.username||'' }); }}>Edit</Button>{' '}
                    <Button size="sm" variant="danger" onClick={() => setDeleteId(item.id)}>✕</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {showAdd && (
        <Modal title="Add Tool" onClose={() => { setShowAdd(false); setForm({ name:'', url:'', username:'' }); }}>
          {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
          <FormField label="Name *">
            <Input value={form.name} onChange={v=>setForm(p=>({...p,name:v}))} placeholder="e.g. Supabase" autoFocus />
          </FormField>
          <FormField label="URL (optional)">
            <Input value={form.url} onChange={v=>setForm(p=>({...p,url:v}))} placeholder="https://..." />
          </FormField>
          <FormField label="Username / email used to sign up (optional)">
            <Input value={form.username} onChange={v=>setForm(p=>({...p,username:v}))} placeholder="you@example.com" />
          </FormField>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setForm({ name:'', url:'', username:'' }); }}>Cancel</Button>
            <Button onClick={addItem} loading={saving} disabled={!form.name.trim()}>Add</Button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Remove Tool" onClose={() => setDeleteId(null)} width={400}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:C.charcoal, margin:'0 0 20px', lineHeight:1.6 }}>
            Remove this tool from your tech stack? This cannot be undone.
          </p>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => removeItem(deleteId)} loading={saving}>Remove</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Access levels reference ───────────────────────────────────
// A short, plain-language summary of what each role can do. Text lives in
// ROLE_DESCRIPTIONS (lib/supabase.js) so it stays in one place.
const ACCESS_LEVELS = [
  { role: 'admin',       color: 'blue' },
  { role: 'builder_pro', color: 'sage' },
  { role: 'builder',     color: 'sand' },
  { role: 'blocked',     color: 'ghost' },
];

function AccessLevelsCard() {
  return (
    <Card style={{ marginBottom:24 }}>
      <h3 style={sh3}>Access Levels</h3>
      <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', margin:'6px 0 18px', lineHeight:1.6 }}>
        What each role can do. Set a user's role in the table above.
      </p>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {ACCESS_LEVELS.map(({ role, color }) => (
          <div key={role} style={{ display:'flex', gap:14, alignItems:'flex-start', flexWrap:'wrap' }}>
            <div style={{ minWidth:110, flexShrink:0 }}>
              <Badge color={color}>{ROLE_LABELS[role] || role}</Badge>
            </div>
            <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#555', margin:0, lineHeight:1.6, flex:1, minWidth:200 }}>
              {ROLE_DESCRIPTIONS[role]}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BuilderRow({ builder, isSuperAdmin, onRoleChange, onMarketChange, onSuperAdminChange, onDelete }) {
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
          {ASSIGNABLE_ROLES.map(r => (
            <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
          ))}
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
      {isSuperAdmin && (
        <td style={td}>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer', fontFamily:'DM Sans', fontSize:12, color:'#666' }}>
            <input type="checkbox" checked={builder.is_super_admin === true}
              onChange={e => onSuperAdminChange(builder.id, e.target.checked)}
              style={{ accentColor:C.sage, width:14, height:14 }} />
            {builder.is_super_admin ? <Badge color="sand">Super</Badge> : 'No'}
          </label>
        </td>
      )}
      <td style={{ ...td, fontSize:11, color:'#aaa' }}>{new Date(builder.created_at).toLocaleDateString()}</td>
      <td style={td}>
        <Button size="sm" variant="danger" onClick={() => onDelete(builder.id, builder.email)}>Delete</Button>
      </td>
    </tr>
  );
}

const sh3 = { fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:C.charcoal, margin:0 };
const td  = { padding:'10px 12px', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, verticalAlign:'middle' };
