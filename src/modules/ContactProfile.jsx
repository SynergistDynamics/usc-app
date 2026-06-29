// src/modules/ContactProfile.jsx
// A single contact's profile page (/contacts/:id), tuned for a smooth mobile experience:
//  • Identity block: name-colored avatar, name, tap-to-change status (bottom-sheet on mobile),
//    a one-line summary, and a quiet ✎ edit in the corner.
//  • Quick actions (Call / Text / Email / Map): inline pills on desktop; a safe-area-aware
//    sticky icon bar at the bottom on mobile.
//  • Calm, full-row-tappable detail rows (big targets); "+ Add …" prompts for missing fields;
//    copy buttons on desktop.
//  • Projects grouped — "Sold" (with total) pinned on top, then "Quotes & Drafts" — rendered
//    as stacked cards on mobile so nothing is cramped.
//  • Editing is a popup (EditContactModal).
//
// Loads contact (lib/contacts) + its projects (lib/projects) at the parent. RLS scopes access.
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { C, fmt } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  getContact, updateContact, deleteContact, assignContact, fetchAssignableBuilders,
  CONTACT_STATUSES, STATUS_LABELS, STATUS_COLORS,
} from '../lib/contacts';
import {
  fetchProjectsForContact, createProject, isSoldStatus,
  PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS,
} from '../lib/projects';
import {
  Card, Button, Badge, Input, Select, FormField, Label, Modal,
  ErrorBanner, SuccessBanner, Spinner,
} from '../components/UI';

const STATUS_OPTIONS = CONTACT_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }));
const FIELDS = ['full_name','company_name','email','phone','market','address','city','state','zip','status','notes'];

const AVATAR_COLORS = ['#7A9B76', '#B8986A', '#6E8BA3', '#A3746E', '#8A7AA0', '#6FA08A', '#9A8C5C'];
function colorFor(s) {
  let h = 0;
  for (const ch of (s || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

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
  const [loading, setLoading] = useState(true);
  const [notFound,setNotFound]= useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [builders, setBuilders] = useState([]);

  const [projects, setProjects] = useState([]);
  const [projLoading, setProjLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAssignableBuilders().then(({ data }) => setBuilders(data || []));
  }, [isAdmin]);

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
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProjLoading(true);
      const { data } = await fetchProjectsForContact(id);
      if (cancelled) return;
      setProjects(data || []);
      setProjLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  async function reassign(userId) {
    setError('');
    const { data, error: e } = await assignContact(id, userId);
    if (e) { setError(e.message); return; }
    setContact(data);
    setSuccess(userId ? 'Owner updated.' : 'Contact unassigned.');
  }

  async function changeStatus(next) {
    setError(''); setSuccess('');
    const { data, error: e } = await updateContact(id, { status: next });
    if (e) { setError(e.message); return; }
    setContact(data);
    setSuccess('Status updated.');
  }

  async function addProject() {
    setCreating(true); setError('');
    const { data, error: e } = await createProject({ contact_id: id, status: 'draft' });
    setCreating(false);
    if (e) { setError(e.message); return; }
    navigate(`/projects/${data.id}`);
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

  const title = contact.full_name || contact.company_name || contact.email || 'Unnamed contact';
  const initial = title.trim().charAt(0).toUpperCase();
  const fullAddr = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ');
  const telDigits = (contact.phone || '').replace(/[^0-9+]/g, '');
  const mapsUrl = fullAddr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}` : null;

  const sold = projects.filter(p => isSoldStatus(p.status));
  const soldTotal = sold.reduce((s, p) => s + (Number(p.sale_price) || 0), 0);
  const lastActivityTs = [
    ...projects.map(p => new Date(p.updated_at || p.created_at || 0).getTime()),
    new Date(contact.updated_at || contact.created_at || 0).getTime(),
  ].reduce((a, b) => Math.max(a, b), 0);
  const summaryParts = [];
  if (!projLoading) {
    summaryParts.push(`${projects.length} project${projects.length === 1 ? '' : 's'}`);
    if (sold.length) summaryParts.push(`${sold.length} sold · ${fmt(soldTotal)}`);
  }
  if (lastActivityTs) summaryParts.push(`active ${fmtDate(lastActivityTs)}`);

  return (
    <div style={{ maxWidth:720, paddingBottom: isMobile ? 92 : 0 }}>
      <BackLink />

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Identity + details card */}
      <Card style={{ marginTop:16, marginBottom: isMobile ? 16 : 20, padding: isMobile ? 16 : 24 }}>
        {/* Identity */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
          <div style={{ width:52, height:52, borderRadius:'50%', background:colorFor(title), color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, flexShrink:0 }}>
            {initial}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:23, fontWeight:600, color:C.charcoal, lineHeight:1.15, wordBreak:'break-word' }}>{title}</div>
            <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <StatusPicker value={contact.status} onChange={changeStatus} isMobile={isMobile} />
              {contact.company_name && contact.company_name !== title && (
                <span style={{ fontFamily:'DM Sans', fontSize:12.5, color:'#888' }}>{contact.company_name}</span>
              )}
              {contact.source && contact.source !== 'manual' && <Badge color="sand">via {contact.source}</Badge>}
            </div>
          </div>
          <button
            onClick={() => setShowEdit(true)}
            title="Edit contact"
            style={{ flexShrink:0, border:`1px solid ${C.linenDarker}`, background:'#fff', cursor:'pointer', borderRadius:6, padding: isMobile ? '7px 9px' : '6px 12px', fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.charcoal }}
          >
            {isMobile ? '✎' : '✎ Edit'}
          </button>
        </div>

        {/* Summary line */}
        {summaryParts.length > 0 && (
          <div style={{ marginTop:10, fontFamily:'DM Sans', fontSize:12.5, color:'#999' }}>
            {summaryParts.join('  ·  ')}
          </div>
        )}

        {/* Quick actions — inline pills on desktop (sticky bar on mobile, below) */}
        {!isMobile && <ActionBar contact={contact} />}

        {/* Tappable contact details */}
        <div style={{ marginTop:16 }}>
          {contact.phone ? (
            <DetailRow
              icon="📞" href={`tel:${telDigits}`} value={contact.phone}
              trailing={<>
                <a href={`sms:${telDigits}`} onClick={e => e.stopPropagation()} style={pillLink}>Text</a>
                {!isMobile && <CopyBtn text={contact.phone} />}
              </>}
            />
          ) : <AddPrompt icon="📞" label="Add phone" onClick={() => setShowEdit(true)} />}

          {contact.email ? (
            <DetailRow
              icon="✉️" href={`mailto:${contact.email}`} value={contact.email}
              trailing={!isMobile ? <CopyBtn text={contact.email} /> : null}
            />
          ) : <AddPrompt icon="✉️" label="Add email" onClick={() => setShowEdit(true)} />}

          {fullAddr ? (
            <DetailRow
              icon="📍" href={mapsUrl} ext value={fullAddr}
              trailing={<span style={{ fontFamily:'DM Sans', fontSize:12, color:'#bbb', whiteSpace:'nowrap' }}>Map ↗</span>}
            />
          ) : <AddPrompt icon="📍" label="Add address" onClick={() => setShowEdit(true)} />}

          {contact.market && <DetailRow icon="📌" value={contact.market} />}
          {contact.notes && <DetailRow icon="📝" value={contact.notes} wrap />}
        </div>

        {/* Footer: added/updated + owner */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:16, paddingTop:12, borderTop:`1px solid ${C.linenDarker}`, flexWrap:'wrap' }}>
          <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#aaa' }}>
            {contact.created_at ? `Added ${fmtDate(contact.created_at)}` : ''}
            {contact.updated_at ? ` · Updated ${fmtDate(contact.updated_at)}` : ''}
            {contact.shedpro_territory ? ` · territory: ${contact.shedpro_territory}` : ''}
          </span>
          {isAdmin ? (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#888' }}>Builder:</span>
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
            <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#999' }}>
              Builder: {contact.owner.full_name || contact.owner.email}
            </span>
          ) : null}
        </div>
      </Card>

      {/* Projects */}
      <ProjectsSection
        projects={projects}
        loading={projLoading}
        creating={creating}
        onAdd={addProject}
        navigate={navigate}
        isMobile={isMobile}
      />

      {/* Sticky action bar on mobile */}
      {isMobile && <ActionBar contact={contact} sticky />}

      {showEdit && (
        <EditContactModal
          contact={contact}
          onClose={() => setShowEdit(false)}
          onSaved={(data) => { setContact(data); setShowEdit(false); setSuccess('Contact saved.'); }}
          onDelete={() => { setShowEdit(false); setConfirmDelete(true); }}
        />
      )}

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
    </div>
  );
}

const pillLink = {
  fontFamily:'DM Sans', fontSize:12.5, fontWeight:600, color:C.sand, textDecoration:'none',
  border:`1px solid ${C.linenDarker}`, borderRadius:9999, padding:'3px 10px', whiteSpace:'nowrap',
};

// Quick-action buttons. Inline pills (in the card) on desktop; a fixed bottom bar on mobile
// with stacked icon+label, even widths, and iOS safe-area padding.
function ActionBar({ contact, sticky }) {
  const tel = (contact.phone || '').replace(/[^0-9+]/g, '');
  const addr = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ');
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
  const btns = [
    contact.phone && { icon:'📞', label:'Call', href:`tel:${tel}` },
    contact.phone && { icon:'💬', label:'Text', href:`sms:${tel}` },
    contact.email && { icon:'✉️', label:'Email', href:`mailto:${contact.email}` },
    maps && { icon:'🧭', label:'Map', href:maps, ext:true },
  ].filter(Boolean);
  if (!btns.length) return null;

  if (sticky) {
    return (
      <div style={{
        position:'fixed', left:0, right:0, bottom:0, zIndex:50, background:'#fff',
        borderTop:`1px solid ${C.linenDarker}`, boxShadow:'0 -2px 12px rgba(0,0,0,0.07)',
        display:'flex', gap:6, padding:'8px 8px', paddingBottom:'calc(8px + env(safe-area-inset-bottom))',
      }}>
        {btns.map(b => (
          <a key={b.label} href={b.href} {...(b.ext ? { target:'_blank', rel:'noreferrer' } : {})}
            style={{
              flex:'1 1 0', minWidth:0, minHeight:50, display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center', gap:3, textDecoration:'none',
              background:C.linen, color:C.charcoal, border:`1px solid ${C.linenDarker}`, borderRadius:10,
              fontFamily:'DM Sans', fontSize:11, fontWeight:600,
            }}>
            <span style={{ fontSize:18, lineHeight:1 }}>{b.icon}</span>
            {b.label}
          </a>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:14 }}>
      {btns.map(b => (
        <a key={b.label} href={b.href} {...(b.ext ? { target:'_blank', rel:'noreferrer' } : {})}
          style={{
            display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
            padding:'10px 14px', borderRadius:8, textDecoration:'none',
            background:C.linen, color:C.charcoal, border:`1px solid ${C.linenDarker}`,
            fontFamily:'DM Sans', fontSize:13, fontWeight:600, whiteSpace:'nowrap',
          }}>
          <span style={{ fontSize:15 }}>{b.icon}</span> {b.label}
        </a>
      ))}
    </div>
  );
}

// Clickable status badge → dropdown (desktop) or bottom sheet (mobile) to change the stage.
function StatusPicker({ value, onChange, isMobile }) {
  const [open, setOpen] = useState(false);
  const pick = (s) => { setOpen(false); if (s !== value) onChange(s); };

  const trigger = (
    <button
      onClick={() => setOpen(o => !o)}
      title="Change status"
      style={{ border:'none', background:'transparent', cursor:'pointer', padding:0, display:'inline-flex', alignItems:'center' }}
    >
      <Badge color={STATUS_COLORS[value] || 'ghost'}>{STATUS_LABELS[value] || value} ▾</Badge>
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        {open && (
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'flex-end' }}>
            <div onClick={e => e.stopPropagation()} style={{ width:'100%', background:'#fff', borderRadius:'14px 14px 0 0', padding:'8px 0 calc(8px + env(safe-area-inset-bottom))', boxShadow:'0 -8px 30px rgba(0,0,0,0.2)' }}>
              <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand, padding:'10px 18px 6px' }}>Set status</div>
              {CONTACT_STATUSES.map(s => (
                <div key={s} onClick={() => pick(s)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 18px', fontFamily:'DM Sans', fontSize:15, color:C.charcoal, borderTop:`1px solid ${C.linen}`, background: s === value ? C.linen : 'transparent' }}>
                  <span style={{ width:9, height:9, borderRadius:'50%', background:C.sage, opacity: s === value ? 1 : 0 }} />
                  {STATUS_LABELS[s]}
                </div>
              ))}
              <div onClick={() => setOpen(false)} style={{ textAlign:'center', padding:'14px', fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:'#888', borderTop:`1px solid ${C.linenDarker}`, marginTop:4 }}>Cancel</div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <span style={{ position:'relative', display:'inline-block' }}>
      {trigger}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:19 }} />
          <div style={{ position:'absolute', zIndex:20, top:'100%', left:0, marginTop:4, background:'#fff', border:`1px solid ${C.linenDarker}`, borderRadius:6, boxShadow:'0 6px 18px rgba(0,0,0,0.12)', minWidth:150, overflow:'hidden' }}>
            {CONTACT_STATUSES.map(s => (
              <div key={s} onClick={() => pick(s)}
                style={{ padding:'9px 12px', cursor:'pointer', fontFamily:'DM Sans', fontSize:13, color:C.charcoal, background: s === value ? C.linen : 'transparent', display:'flex', alignItems:'center', gap:8 }}
                onMouseEnter={e => e.currentTarget.style.background = C.linen}
                onMouseLeave={e => e.currentTarget.style.background = s === value ? C.linen : 'transparent'}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:C.sage, opacity: s === value ? 1 : 0 }} />
                {STATUS_LABELS[s]}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}
      title="Copy"
      style={{ border:'none', background:'transparent', cursor:'pointer', color: done ? C.sage : '#bbb', fontSize:12, fontFamily:'DM Sans', fontWeight:600 }}
    >
      {done ? '✓' : '📋'}
    </button>
  );
}

// A calm, full-row-tappable detail row. The left region (icon + value) is the primary link
// (big tap target); `trailing` holds secondary actions (Text pill, copy, Map hint). If no
// href, the value is plain text (e.g. market, notes).
function DetailRow({ icon, href, ext, value, trailing, wrap }) {
  const inner = (
    <>
      <span style={{ width:22, textAlign:'center', fontSize:15, flexShrink:0 }}>{icon}</span>
      <span style={{ fontFamily:'DM Sans', fontSize:14, color:C.charcoal, fontWeight:500, minWidth:0, ...(wrap ? { whiteSpace:'pre-wrap' } : { overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }) }}>
        {value}
      </span>
    </>
  );
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, minHeight:46, borderTop:`1px solid ${C.linen}` }}>
      {href ? (
        <a href={href} {...(ext ? { target:'_blank', rel:'noreferrer' } : {})}
          style={{ display:'flex', alignItems:'center', gap:12, flex:1, minWidth:0, textDecoration:'none', padding:'6px 2px' }}>
          {inner}
        </a>
      ) : (
        <div style={{ display:'flex', alignItems:'center', gap:12, flex:1, minWidth:0, padding:'6px 2px' }}>{inner}</div>
      )}
      {trailing && <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, paddingRight:2 }}>{trailing}</div>}
    </div>
  );
}

function AddPrompt({ icon, label, onClick }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, minHeight:46, borderTop:`1px solid ${C.linen}`, padding:'6px 2px' }}>
      <span style={{ width:22, textAlign:'center', fontSize:15, flexShrink:0, opacity:0.5 }}>{icon}</span>
      <button onClick={onClick} style={{ border:'none', background:'transparent', cursor:'pointer', padding:0, fontFamily:'DM Sans', fontSize:13.5, color:C.sand, fontWeight:600 }}>
        + {label}
      </button>
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

// Edit popup — edits a draft copy of the contact fields and persists on Save.
function EditContactModal({ contact, onClose, onSaved, onDelete }) {
  const [form, setForm] = useState(toForm(contact));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true); setErr('');
    const payload = {};
    for (const k of FIELDS) payload[k] = k === 'status' ? form.status : (form[k]?.trim() || null);
    const { data, error: e } = await updateContact(contact.id, payload);
    setSaving(false);
    if (e) { setErr(e.message); return; }
    onSaved(data);
  }

  return (
    <Modal title="Edit contact" onClose={onClose} width={620}>
      {err && <ErrorBanner onDismiss={() => setErr('')}>{err}</ErrorBanner>}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }} className="usc-contact-grid">
        <FormField label="Name" style={{ marginBottom:0 }}>
          <Input value={form.full_name} onChange={v => set('full_name', v)} placeholder="Jane Homeowner" autoFocus />
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

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:22, flexWrap:'wrap' }}>
        <Button variant="danger" size="sm" onClick={onDelete}>Delete</Button>
        <div style={{ display:'flex', gap:10 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save changes</Button>
        </div>
      </div>

      <style>{`
        @media (max-width: 600px) {
          .usc-contact-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Modal>
  );
}

// This contact's projects, GROUPED: sold (sold/scheduled/completed) pinned + totaled on top,
// then quotes/drafts — each newest-first. Rows are stacked cards on mobile.
function ProjectsSection({ projects, loading, creating, onAdd, navigate, isMobile }) {
  const ts = (p) => new Date(p.sold_at || p.created_at || 0).getTime();
  const byRecent = (a, b) => ts(b) - ts(a);
  const sold = projects.filter(p => isSoldStatus(p.status)).sort(byRecent);
  const open = projects.filter(p => !isSoldStatus(p.status)).sort(byRecent);
  const soldTotal = sold.reduce((s, p) => s + (Number(p.sale_price) || 0), 0);

  return (
    <Card style={{ marginTop: isMobile ? 0 : 20, padding: isMobile ? 16 : 24 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:C.charcoal }}>Projects</div>
        <Button size="sm" onClick={onAdd} loading={creating}>+ New project</Button>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner size={22} /></div>
      ) : projects.length === 0 ? (
        <div style={{ fontFamily:'DM Sans', fontSize:13.5, color:'#999', padding:'6px 2px' }}>
          No projects for this contact yet. Create one to spec a shed and generate a materials list.
        </div>
      ) : (
        <>
          {sold.length > 0 && (
            <>
              <GroupHeader label={`Sold (${sold.length})`} right={fmt(soldTotal)} />
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom: open.length ? 18 : 0 }}>
                {sold.map(p => <ProjectRow key={p.id} p={p} sold navigate={navigate} isMobile={isMobile} />)}
              </div>
            </>
          )}
          {open.length > 0 && (
            <>
              {sold.length > 0 && <GroupHeader label={`Quotes & Drafts (${open.length})`} />}
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {open.map(p => <ProjectRow key={p.id} p={p} navigate={navigate} isMobile={isMobile} />)}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function GroupHeader({ label, right }) {
  return (
    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10, margin:'4px 2px 8px' }}>
      <span style={{ fontFamily:'DM Sans', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand }}>{label}</span>
      {right && <span style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:700, color:C.sageDark }}>{right}</span>}
    </div>
  );
}

function ProjectRow({ p, sold, navigate, isMobile }) {
  const spec = [p.shed_size, p.style_package?.name, p.siding].filter(Boolean).join(' · ') || 'No spec yet';
  const dateStr = sold && p.sold_at ? `Sold ${fmtDate(p.sold_at)}` : (p.created_at ? fmtDate(p.created_at) : '');
  const cardStyle = {
    cursor:'pointer', borderRadius:6,
    border:`1px solid ${sold ? C.sage : C.linenDarker}`,
    borderLeft:`4px solid ${sold ? C.sage : C.linenDarker}`,
    background: sold ? C.linen : '#fff',
  };
  const hoverIn = e => { e.currentTarget.style.background = C.linen; };
  const hoverOut = e => { e.currentTarget.style.background = sold ? C.linen : '#fff'; };

  if (isMobile) {
    return (
      <div onClick={() => navigate(`/projects/${p.id}`)} style={{ ...cardStyle, padding:'12px 12px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
          <span style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:C.charcoal, minWidth:0 }}>{p.name || 'Untitled project'}</span>
          <span style={{ flexShrink:0 }}><Badge color={PROJECT_STATUS_COLORS[p.status] || 'ghost'}>{PROJECT_STATUS_LABELS[p.status] || p.status}</Badge></span>
        </div>
        <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#999', marginTop:3 }}>{spec}</div>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8, marginTop:8 }}>
          <span style={{ fontFamily:'DM Sans', fontSize:15, fontWeight:700, color:C.sageDark }}>{p.sale_price != null ? fmt(p.sale_price) : ''}</span>
          <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#aaa' }}>{dateStr}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => navigate(`/projects/${p.id}`)}
      style={{ ...cardStyle, display:'flex', alignItems:'center', gap:12, padding:'11px 12px' }}
      onMouseEnter={hoverIn} onMouseLeave={hoverOut}
    >
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:C.charcoal }}>{p.name || 'Untitled project'}</div>
        <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#999', marginTop:1 }}>{spec}</div>
      </div>
      <span style={{ fontFamily:'DM Sans', fontSize:12, color:'#aaa', whiteSpace:'nowrap' }}>{dateStr}</span>
      {p.sale_price != null && (
        <span style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.sageDark }}>{fmt(p.sale_price)}</span>
      )}
      <Badge color={PROJECT_STATUS_COLORS[p.status] || 'ghost'}>{PROJECT_STATUS_LABELS[p.status] || p.status}</Badge>
    </div>
  );
}
