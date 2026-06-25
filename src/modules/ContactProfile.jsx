// src/modules/ContactProfile.jsx
// A single contact's profile page (/contacts/:id) — their contact info, editable in place.
//
// Loads its own row via lib/contacts.js. RLS guarantees a builder can only load/edit their
// own contacts (a bad/foreign id simply comes back empty → "not found"). Admins can open
// any contact.
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  getContact, updateContact, deleteContact, assignContact, fetchAssignableBuilders,
  CONTACT_STATUSES, STATUS_LABELS, STATUS_COLORS,
} from '../lib/contacts';
import {
  fetchProjectsForContact, createProject,
  PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS,
} from '../lib/projects';
import {
  Card, Button, Badge, Input, Select, FormField, Label, Modal,
  ErrorBanner, SuccessBanner, Spinner,
} from '../components/UI';
import { fmt } from '../lib/supabase';

const STATUS_OPTIONS = CONTACT_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }));

const FIELDS = ['full_name','company_name','email','phone','market','address','city','state','zip','status','notes'];

function toForm(c) {
  const f = {};
  for (const k of FIELDS) f[k] = c?.[k] ?? '';
  f.status = c?.status || 'lead';
  return f;
}

export default function ContactProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [contact, setContact] = useState(null);
  const [form,    setForm]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound,setNotFound]= useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [builders, setBuilders] = useState([]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAssignableBuilders().then(({ data }) => setBuilders(data || []));
  }, [isAdmin]);

  async function reassign(userId) {
    setError('');
    const { data, error: e } = await assignContact(id, userId);
    if (e) { setError(e.message); return; }
    setContact(data);
    setSuccess(userId ? 'Owner updated.' : 'Contact unassigned.');
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setNotFound(false); setError('');
      const { data, error: e } = await getContact(id);
      if (cancelled) return;
      setLoading(false);
      if (e) { setError(e.message); return; }
      if (!data) { setNotFound(true); return; }
      setContact(data);
      setForm(toForm(data));
    })();
    return () => { cancelled = true; };
  }, [id]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true); setError(''); setSuccess('');
    const payload = {};
    for (const k of FIELDS) {
      payload[k] = k === 'status' ? form.status : (form[k]?.trim() || null);
    }
    const { data, error: e } = await updateContact(id, payload);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setContact(data);
    setForm(toForm(data));
    setSuccess('Contact saved.');
  }

  async function doDelete() {
    setDeleting(true); setError('');
    const { error: e } = await deleteContact(id);
    setDeleting(false);
    if (e) { setError(e.message); setConfirmDelete(false); return; }
    navigate('/contacts');
  }

  if (loading) return <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spinner size={32} /></div>;

  if (notFound) {
    return (
      <div style={{ maxWidth:720 }}>
        <BackLink />
        <Card style={{ marginTop:16 }}>
          <div style={{ textAlign:'center', padding:'24px 12px', fontFamily:'DM Sans', color:'#888', fontSize:14 }}>
            This contact doesn't exist or isn't available to you.
          </div>
        </Card>
      </div>
    );
  }

  const title = contact?.full_name || contact?.company_name || contact?.email || 'Unnamed contact';
  const initial = title.trim().charAt(0).toUpperCase();
  const added = contact?.created_at ? new Date(contact.created_at).toLocaleDateString() : '—';

  return (
    <div style={{ maxWidth:720 }}>
      <BackLink />

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Identity header */}
      <Card style={{ marginTop:16, marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
          <div style={{ width:72, height:72, borderRadius:'50%', background:C.sage, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Cormorant Garamond, serif', fontSize:32, fontWeight:700, flexShrink:0 }}>
            {initial}
          </div>
          <div style={{ minWidth:160 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:600, color:C.charcoal, lineHeight:1.1 }}>{title}</div>
            <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <Badge color={STATUS_COLORS[contact.status] || 'ghost'}>{STATUS_LABELS[contact.status] || contact.status}</Badge>
              {contact.source && contact.source !== 'manual' && <Badge color="sand">via {contact.source}</Badge>}
              {contact.shedpro_territory && (
                <span style={{ fontFamily:'DM Sans', fontSize:11, color:'#aaa' }}>territory: {contact.shedpro_territory}</span>
              )}
            </div>
          </div>

          {/* Owner assignment (admins) */}
          {isAdmin ? (
            <div style={{ marginLeft:'auto', minWidth:200 }}>
              <Label>Assigned to</Label>
              <Select
                value={contact.user_id || ''}
                onChange={reassign}
                options={[
                  { value:'', label:'— Unassigned —' },
                  ...builders.map(b => ({ value:b.id, label:b.full_name || b.email })),
                ]}
              />
            </div>
          ) : contact.owner ? (
            <div style={{ marginLeft:'auto', fontFamily:'DM Sans', fontSize:11.5, color:'#999' }}>
              Owner: {contact.owner.full_name || contact.owner.email}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Editable details */}
      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }} className="usc-contact-grid">
          <FormField label="Name" style={{ marginBottom:0 }}>
            <Input value={form.full_name} onChange={v => set('full_name', v)} placeholder="Jane Homeowner" />
          </FormField>
          <FormField label="Company" style={{ marginBottom:0 }}>
            <Input value={form.company_name} onChange={v => set('company_name', v)} placeholder="(optional)" />
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
          <FormField label="Address" style={{ marginBottom:0 }}>
            <Input value={form.address} onChange={v => set('address', v)} placeholder="123 Main St" />
          </FormField>
          <FormField label="City" style={{ marginBottom:0 }}>
            <Input value={form.city} onChange={v => set('city', v)} placeholder="Houston" />
          </FormField>
          <FormField label="State" style={{ marginBottom:0 }}>
            <Input value={form.state} onChange={v => set('state', v)} placeholder="TX" />
          </FormField>
          <FormField label="ZIP" style={{ marginBottom:0 }}>
            <Input value={form.zip} onChange={v => set('zip', v)} placeholder="77001" />
          </FormField>
        </div>

        <div style={{ marginTop:16 }}>
          <Label>Notes</Label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={4}
            placeholder="Anything worth remembering about this contact…"
            style={{ fontFamily:'DM Sans, sans-serif', fontSize:14, padding:'10px 12px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, background:'#FFFDF9', color:C.charcoal, width:'100%', boxSizing:'border-box', resize:'vertical', lineHeight:1.5 }}
          />
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:20, flexWrap:'wrap' }}>
          <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#aaa' }}>Added {added}</span>
          <div style={{ display:'flex', gap:10 }}>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
            <Button onClick={save} loading={saving}>Save changes</Button>
          </div>
        </div>
      </Card>

      {/* Projects for this contact */}
      <ContactProjects contactId={id} navigate={navigate} />

      {confirmDelete && (
        <Modal title="Delete contact?" onClose={() => setConfirmDelete(false)} width={420}>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:C.charcoal, marginTop:0 }}>
            Permanently delete <strong>{title}</strong>? This can't be undone.
          </p>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} loading={deleting}>Delete</Button>
          </div>
        </Modal>
      )}

      <style>{`
        @media (max-width: 600px) {
          .usc-contact-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/contacts" style={{ fontFamily:'DM Sans', fontSize:13, color:C.sage, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}>
      ← All contacts
    </Link>
  );
}

// This contact's projects — a contact can have many. New projects are created
// here (contact pre-selected) and open straight into the project page.
function ContactProjects({ contactId, navigate }) {
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: e } = await fetchProjectsForContact(contactId);
      if (cancelled) return;
      setLoading(false);
      if (e) { setError(e.message); return; }
      setProjects(data || []);
    })();
    return () => { cancelled = true; };
  }, [contactId]);

  async function addProject() {
    setCreating(true); setError('');
    const { data, error: e } = await createProject({ contact_id: contactId, status: 'draft' });
    setCreating(false);
    if (e) { setError(e.message); return; }
    navigate(`/projects/${data.id}`);
  }

  return (
    <Card style={{ marginTop:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:C.charcoal }}>Projects</div>
        <Button size="sm" onClick={addProject} loading={creating}>+ New project</Button>
      </div>

      {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner size={22} /></div>
      ) : projects.length === 0 ? (
        <div style={{ fontFamily:'DM Sans', fontSize:13.5, color:'#999', padding:'6px 2px' }}>
          No projects for this contact yet. Create one to spec a shed and generate a materials list.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column' }}>
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 4px', borderTop:`1px solid ${C.linenDarker}`, cursor:'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = C.linen}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:C.charcoal }}>{p.name || 'Untitled project'}</div>
                <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#999', marginTop:1 }}>
                  {[p.shed_size, p.style_package?.name, p.siding].filter(Boolean).join(' · ') || 'No spec yet'}
                </div>
              </div>
              {p.sale_price != null && (
                <span style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.sageDark }}>{fmt(p.sale_price)}</span>
              )}
              <Badge color={PROJECT_STATUS_COLORS[p.status] || 'ghost'}>{PROJECT_STATUS_LABELS[p.status] || p.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
