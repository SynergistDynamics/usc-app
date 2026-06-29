// src/modules/Contacts.jsx
// Contacts list (/contacts) — first step of the ShedPro integration.
//
// Each builder keeps their own customers/leads here; admins see everyone's (RLS in
// MIGRATION_contacts.sql is the real boundary). Contacts are added manually today;
// ShedPro leads will be pushed in later via Zapier (they'll arrive with source!='manual'
// and a shedpro_id). Loads its own data via lib/contacts.js (per-route loading,
// ARCHITECTURE.md §3.3) rather than through App.jsx's global loadData.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  fetchContacts, createContact, CONTACT_STATUSES, STATUS_LABELS, STATUS_COLORS,
  fetchAssignableBuilders, assignContact,
} from '../lib/contacts';
import {
  Card, SectionHeader, Button, Badge, Input, Select, Modal, FormField, Label,
  ErrorBanner, Spinner,
} from '../components/UI';
import LeadRoutingModal from './LeadRoutingModal';

const STATUS_OPTIONS = CONTACT_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }));

const EMPTY_FORM = {
  full_name: '', email: '', phone: '',
  market: '', state: '', status: 'lead', notes: '',
};

// Short, human-friendly date for the "Created" column (e.g. "Jun 29, 2026").
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Contacts() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';

  const [contacts, setContacts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);

  const [showAdd, setShowAdd] = useState(false);
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [addErr,  setAddErr]  = useState('');

  const [builders,    setBuilders]    = useState([]);
  const [showRouting, setShowRouting] = useState(false);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  async function load() {
    setLoading(true); setError('');
    const { data, error: e } = await fetchContacts();
    setLoading(false);
    if (e) { setError(e.message); return; }
    setContacts(data);
  }
  useEffect(() => { load(); }, []);

  // Admins can assign owners, so load the builder list for the dropdowns.
  useEffect(() => {
    if (!isAdmin) return;
    fetchAssignableBuilders().then(({ data }) => setBuilders(data || []));
  }, [isAdmin]);

  const builderOptions = useMemo(() => ([
    { value: '', label: '— Unassigned —' },
    ...builders.map(b => ({ value: b.id, label: b.full_name || b.email })),
  ]), [builders]);

  // Reassign a contact's owner inline; update the row in place.
  async function reassign(contactId, userId) {
    const { data, error: e } = await assignContact(contactId, userId);
    if (e) { setError(e.message); return; }
    setContacts(prev => prev.map(c => (c.id === contactId ? { ...c, user_id: data.user_id, owner: data.owner } : c)));
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      [c.full_name, c.email, c.phone, c.market, c.state]
        .filter(Boolean).some(v => v.toLowerCase().includes(q))
    );
  }, [contacts, search]);

  async function addContact() {
    if (!form.full_name.trim() && !form.email.trim()) {
      setAddErr('Enter at least a name or email.');
      return;
    }
    setSaving(true); setAddErr('');
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v])
    );
    payload.status = form.status; // status always set
    const { data, error: e } = await createContact(profile.id, payload);
    setSaving(false);
    if (e) { setAddErr(e.message); return; }
    setShowAdd(false);
    setForm(EMPTY_FORM);
    // Drop straight into the new contact's profile page.
    if (data?.id) navigate(`/contacts/${data.id}`);
    else load();
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
        <SectionHeader sub="Your customers and leads. New ShedPro leads sync in and auto-assign by territory.">
          Contacts
        </SectionHeader>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {isAdmin && <Button variant="secondary" onClick={() => setShowRouting(true)}>⚙ Lead routing</Button>}
          <Button onClick={() => { setForm(EMPTY_FORM); setAddErr(''); setShowAdd(true); }}>+ Add contact</Button>
        </div>
      </div>

      {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

      <div style={{ maxWidth:360, marginBottom:16 }}>
        <Input value={search} onChange={setSearch} placeholder="Search name, email, phone, state…" />
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><Spinner size={28} /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:'28px 12px', fontFamily:'DM Sans', color:'#888', fontSize:14 }}>
            {contacts.length === 0
              ? 'No contacts yet. Add your first one, or connect ShedPro to sync leads in.'
              : 'No contacts match your search.'}
          </div>
        </Card>
      ) : (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div className="usc-table-scroll">
            <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'DM Sans', fontSize:13 }}>
              <thead>
                <tr style={{ background:C.linenDark, textAlign:'left' }}>
                  <Th>Name</Th>
                  {!isMobile && <Th>Email</Th>}
                  {!isMobile && <Th>Phone</Th>}
                  {!isMobile && <Th>State</Th>}
                  {!isMobile && <Th>Created</Th>}
                  <Th>Status</Th>
                  {isAdmin && !isMobile && <Th>Owner</Th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/contacts/${c.id}`)}
                    style={{ cursor:'pointer', borderTop:`1px solid ${C.linenDarker}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.linen}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Td>
                      <div style={{ fontWeight:600, color:C.charcoal }}>{c.full_name || c.company_name || c.email || 'Unnamed contact'}</div>
                      {isMobile && (c.email || c.phone) && (
                        <div style={{ color:'#888', fontSize:12, marginTop:2 }}>{c.email || c.phone}</div>
                      )}
                      {c.source && c.source !== 'manual' && (
                        <span style={{ fontSize:10, color:C.sand, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.source}</span>
                      )}
                    </Td>
                    {!isMobile && <Td>{c.email || '—'}</Td>}
                    {!isMobile && <Td>{c.phone || '—'}</Td>}
                    {!isMobile && <Td>{c.state || '—'}</Td>}
                    {!isMobile && <Td style={{ whiteSpace:'nowrap' }}>{fmtDate(c.created_at)}</Td>}
                    <Td><Badge color={STATUS_COLORS[c.status] || 'ghost'}>{STATUS_LABELS[c.status] || c.status}</Badge></Td>
                    {isAdmin && !isMobile && (
                      <td style={{ padding:'8px 14px', verticalAlign:'top' }} onClick={e => e.stopPropagation()}>
                        <Select
                          value={c.user_id || ''}
                          onChange={v => reassign(c.id, v)}
                          options={builderOptions}
                          style={{ fontSize:12, padding:'5px 8px', minWidth:140 }}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#aaa', marginTop:10 }}>
          {filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}{search && ` (of ${contacts.length})`}
        </div>
      )}

      {showAdd && (
        <Modal title="Add contact" onClose={() => setShowAdd(false)} width={560}>
          {addErr && <ErrorBanner onDismiss={() => setAddErr('')}>{addErr}</ErrorBanner>}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }} className="usc-contact-grid">
            <FormField label="Name" style={{ marginBottom:0 }}>
              <Input value={form.full_name} onChange={v => set('full_name', v)} placeholder="Jane Homeowner" autoFocus />
            </FormField>
            <FormField label="State" style={{ marginBottom:0 }}>
              <Input value={form.state} onChange={v => set('state', v)} placeholder="TX" />
            </FormField>
            <FormField label="Email" style={{ marginBottom:0 }}>
              <Input type="email" value={form.email} onChange={v => set('email', v)} placeholder="jane@example.com" />
            </FormField>
            <FormField label="Phone" style={{ marginBottom:0 }}>
              <Input type="tel" value={form.phone} onChange={v => set('phone', v)} placeholder="(555) 123-4567" />
            </FormField>
            <FormField label="Market / Location" style={{ marginBottom:0 }}>
              <Input value={form.market} onChange={v => set('market', v)} placeholder="Houston, TX" />
            </FormField>
            <FormField label="Status" style={{ marginBottom:0 }}>
              <Select value={form.status} onChange={v => set('status', v)} options={STATUS_OPTIONS} />
            </FormField>
          </div>
          <div style={{ marginTop:14 }}>
            <Label>Notes</Label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              placeholder="Anything worth remembering about this contact…"
              style={{ fontFamily:'DM Sans, sans-serif', fontSize:14, padding:'10px 12px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, background:'#FFFDF9', color:C.charcoal, width:'100%', boxSizing:'border-box', resize:'vertical', lineHeight:1.5 }}
            />
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={addContact} loading={saving}>Save contact</Button>
          </div>
        </Modal>
      )}

      {showRouting && (
        <LeadRoutingModal
          builders={builders}
          onClose={() => setShowRouting(false)}
          onChanged={load}
        />
      )}

      <style>{`
        @media (max-width: 600px) {
          .usc-contact-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding:'11px 14px', fontWeight:600, color:'#666', fontSize:11, textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding:'11px 14px', color:C.charcoal, verticalAlign:'top', ...style }}>{children}</td>;
}
