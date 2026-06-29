// src/modules/Projects.jsx
// Projects list (/projects) and Sold Projects list (/projects/sold — soldOnly).
//
// A project is a shed job tied to a contact. Admins see every project; builders
// see only projects whose contact they own — RLS (MIGRATION_projects.sql) is the
// real boundary. Loads its own data via lib/projects.js (per-route loading,
// ARCHITECTURE.md §3.3). New projects are created against a contact (picked here,
// or pre-selected from the contact profile page).
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, fmt, fmtMoneyShort, fmtShortDate } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  fetchProjects, createProject,
  PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS, PROJECT_STATUS_EDGE,
  OPEN_SOLD_STATUSES, CLOSED_SOLD_STATUSES,
} from '../lib/projects';
import { fetchContacts } from '../lib/contacts';
import {
  Card, SectionHeader, Button, Badge, Input, Modal, FormField, Spinner, ErrorBanner, ShedIcon,
} from '../components/UI';

// Shared muted text tones for the project cards (one secondary, one tertiary —
// disciplined instead of a handful of near-identical grays).
const CARD_SECONDARY = '#8C8478';
const CARD_TERTIARY  = '#B3AC9F';

export default function Projects({ soldOnly = false }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';

  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [statusTab, setStatusTab] = useState('open'); // Sold Projects: Open (sold) vs Closed (completed)
  const [builderTab, setBuilderTab] = useState('all'); // Sold Projects: filter by builder (admin)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);

  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  async function load() {
    setLoading(true); setError('');
    const { data, error: e } = await fetchProjects({ soldOnly });
    setLoading(false);
    if (e) { setError(e.message); return; }
    setProjects(data);
  }
  useEffect(() => { load(); }, [soldOnly]);

  // Sold Projects (admin) shows a tab per builder that owns one of these projects,
  // plus "All" and (when present) "Unassigned". Builders only ever see their own
  // projects (RLS), so the tabs are an admin-only convenience.
  const showBuilderTabs = soldOnly && isAdmin;
  const builderTabs = useMemo(() => {
    if (!showBuilderTabs) return [];
    const map = new Map();
    let unassigned = 0;
    for (const p of projects) {
      const o = p.contact?.owner;
      if (o?.id) {
        const cur = map.get(o.id) || { id: o.id, name: o.full_name || o.email || 'Builder', count: 0 };
        cur.count++; map.set(o.id, cur);
      } else {
        unassigned++;
      }
    }
    const arr = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (unassigned) arr.push({ id: 'unassigned', name: 'Unassigned', count: unassigned });
    return arr;
  }, [projects, showBuilderTabs]);

  // Sold Projects splits into Open (sold or scheduled — won, job not yet finished)
  // and Closed (completed — job done). Shown to everyone on the sold view; composes
  // with the admin builder tabs. Counts reflect the selected builder tab.
  const builderFiltered = useMemo(() => {
    if (showBuilderTabs && builderTab !== 'all') {
      return projects.filter(p => (p.contact?.owner?.id || 'unassigned') === builderTab);
    }
    return projects;
  }, [projects, builderTab, showBuilderTabs]);

  const openCount   = useMemo(() => builderFiltered.filter(p => OPEN_SOLD_STATUSES.includes(p.status)).length, [builderFiltered]);
  const closedCount = useMemo(() => builderFiltered.filter(p => CLOSED_SOLD_STATUSES.includes(p.status)).length, [builderFiltered]);

  const filtered = useMemo(() => {
    let list = builderFiltered;
    if (soldOnly) {
      const wanted = statusTab === 'closed' ? CLOSED_SOLD_STATUSES : OPEN_SOLD_STATUSES;
      list = list.filter(p => wanted.includes(p.status));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        [p.name, p.contact?.full_name, p.contact?.company_name, p.customer_email, p.project_number, p.shed_size, p.style_package?.name]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [builderFiltered, soldOnly, statusTab, search]);

  // Sold-projects total (sum of sale_price) — quick at-a-glance number.
  const soldTotal = useMemo(
    () => soldOnly ? filtered.reduce((sum, p) => sum + (parseFloat(p.sale_price) || 0), 0) : 0,
    [soldOnly, filtered]
  );

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
        <SectionHeader sub={soldOnly
          ? 'Won deals. Each is a project with a recorded sale.'
          : 'Shed jobs for your contacts. Each carries a full shed spec for generating materials lists.'}>
          {soldOnly ? 'Sold Projects' : 'Projects'}
        </SectionHeader>
        {!soldOnly && (
          <Button onClick={() => setShowAdd(true)}>+ New project</Button>
        )}
      </div>

      {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

      <div style={{ maxWidth:360, marginBottom:16 }}>
        <Input value={search} onChange={setSearch} placeholder="Search project, contact, size, style…" />
      </div>

      {soldOnly && (
        <div style={{ display:'flex', gap:0, marginBottom:18, borderBottom:`2px solid ${C.linenDarker}`, flexWrap:'nowrap', overflowX:'auto', overflowY:'hidden' }}>
          {[{ id:'open', name:'Open', count:openCount }, { id:'closed', name:'Closed', count:closedCount }].map(t => (
            <button key={t.id} onClick={() => setStatusTab(t.id)}
              style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding: isMobile ? '9px 13px' : '9px 18px', border:'none', cursor:'pointer', background:'transparent', color: statusTab===t.id ? C.sage : '#aaa', borderBottom: statusTab===t.id ? `2px solid ${C.sage}` : '2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0 }}>
              {t.name} <span style={{ color: statusTab===t.id ? C.sage : '#ccc', fontWeight:500 }}>({t.count})</span>
            </button>
          ))}
        </div>
      )}

      {showBuilderTabs && builderTabs.length > 0 && (
        <div style={{ display:'flex', gap:0, marginBottom:18, borderBottom:`2px solid ${C.linenDarker}`, flexWrap:'nowrap', overflowX:'auto', overflowY:'hidden' }}>
          {[{ id:'all', name:'All', count:projects.length }, ...builderTabs].map(t => (
            <button key={t.id} onClick={() => setBuilderTab(t.id)}
              style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding: isMobile ? '9px 13px' : '9px 18px', border:'none', cursor:'pointer', background:'transparent', color: builderTab===t.id ? C.sage : '#aaa', borderBottom: builderTab===t.id ? `2px solid ${C.sage}` : '2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0 }}>
              {t.name} <span style={{ color: builderTab===t.id ? C.sage : '#ccc', fontWeight:500 }}>({t.count})</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><Spinner size={28} /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:'28px 12px', fontFamily:'DM Sans', color:'#888', fontSize:14 }}>
            {projects.length === 0
              ? (soldOnly ? 'No sold projects yet. Mark a project Sold to see it here.' : 'No projects yet. Create one for a contact to get started.')
              : search.trim()
                ? 'No projects match your search.'
                : (soldOnly
                    ? (statusTab === 'closed'
                        ? 'No closed projects. Mark a sold project Completed to see it here.'
                        : 'No open projects. They appear here while a sold job is in progress.')
                    : 'No projects match your search.')}
          </div>
        </Card>
      ) : soldOnly ? (
        // Sold Projects: compact horizontal cards — a small shed-rendering thumbnail
        // on the left, details on the right. One column on mobile (the priority),
        // two columns on wider screens. Far more scannable than a cramped table row,
        // without the big image-led cards cropping the renderings.
        <div style={{
          display:'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: isMobile ? 12 : 14,
        }}>
          {filtered.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              isAdmin={isAdmin}
              isMobile={isMobile}
              onOpen={() => navigate(`/projects/${p.id}`)}
            />
          ))}
        </div>
      ) : (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div className="usc-table-scroll">
            <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'DM Sans', fontSize:13 }}>
              <thead>
                <tr style={{ background:C.linenDark, textAlign:'left' }}>
                  <Th>Project</Th>
                  <Th>Contact</Th>
                  {!isMobile && <Th>Size</Th>}
                  {!isMobile && <Th>Style</Th>}
                  <Th>Status</Th>
                  {!isMobile && <Th>Sale price</Th>}
                  {isAdmin && !isMobile && <Th>Owner</Th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    style={{ cursor:'pointer', borderTop:`1px solid ${C.linenDarker}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.linen}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Td>
                      <div style={{ fontWeight:600, color:C.charcoal }}>{p.name || 'Untitled project'}</div>
                      {isMobile && p.shed_size && (
                        <div style={{ color:'#888', fontSize:12, marginTop:2 }}>{p.shed_size}{p.style_package?.name ? ` · ${p.style_package.name}` : ''}</div>
                      )}
                    </Td>
                    <Td>{p.contact?.full_name || p.contact?.company_name || p.contact?.email || p.customer_email || '—'}</Td>
                    {!isMobile && <Td>{p.shed_size || '—'}</Td>}
                    {!isMobile && <Td>{p.style_package?.name || '—'}</Td>}
                    <Td><Badge color={PROJECT_STATUS_COLORS[p.status] || 'ghost'}>{PROJECT_STATUS_LABELS[p.status] || p.status}</Badge></Td>
                    {!isMobile && <Td>{p.sale_price != null ? fmt(p.sale_price) : '—'}</Td>}
                    {isAdmin && !isMobile && <Td>{p.contact?.owner?.full_name || p.contact?.owner?.email || '— Unassigned —'}</Td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8, fontFamily:'DM Sans', fontSize:11.5, color:'#aaa', marginTop:10 }}>
          <span>{filtered.length} {filtered.length === 1 ? 'project' : 'projects'}{search && ` (of ${projects.length})`}</span>
          {soldOnly && <span style={{ color:C.sageDark, fontWeight:600 }}>Total sold: {fmt(soldTotal)}</span>}
        </div>
      )}

      {showAdd && (
        <NewProjectModal
          onClose={() => setShowAdd(false)}
          onCreated={(id) => navigate(`/projects/${id}`)}
        />
      )}
    </div>
  );
}

// Modal to start a new project: pick a contact, give it a name, create → open it.
function NewProjectModal({ onClose, onCreated }) {
  const [contacts, setContacts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [contactId, setContactId] = useState('');
  const [name,    setName]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    fetchContacts().then(({ data, error }) => {
      setLoading(false);
      if (error) { setErr(error.message); return; }
      setContacts(data || []);
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? contacts.filter(c => [c.full_name, c.company_name, c.email]
          .filter(Boolean).some(v => v.toLowerCase().includes(q)))
      : contacts;
    return list.slice(0, 50); // keep the picker light even with hundreds of contacts
  }, [contacts, search]);

  async function create() {
    if (!contactId) { setErr('Pick a contact for this project.'); return; }
    setSaving(true); setErr('');
    const { data, error } = await createProject({
      contact_id: contactId,
      name: name.trim() || null,
      status: 'draft',
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onCreated(data.id);
  }

  return (
    <Modal title="New project" onClose={onClose} width={520}>
      {err && <ErrorBanner onDismiss={() => setErr('')}>{err}</ErrorBanner>}

      <FormField label="Project name">
        <Input value={name} onChange={setName} placeholder="e.g. 10x12 Modern — backyard office" autoFocus />
      </FormField>

      <FormField label="Contact" style={{ marginBottom:0 }}>
        <Input value={search} onChange={setSearch} placeholder="Search your contacts by name, company, email…" />
      </FormField>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner size={22} /></div>
      ) : (
        <div style={{ marginTop:10, maxHeight:240, overflowY:'auto', border:`1px solid ${C.linenDarker}`, borderRadius:4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding:'16px', fontFamily:'DM Sans', fontSize:13, color:'#888', textAlign:'center' }}>
              {contacts.length === 0 ? 'No contacts yet — add one on the Contacts page first.' : 'No contacts match.'}
            </div>
          ) : filtered.map(c => {
            const label = c.full_name || c.company_name || c.email || 'Unnamed contact';
            const selected = c.id === contactId;
            return (
              <div
                key={c.id}
                onClick={() => setContactId(c.id)}
                style={{
                  padding:'9px 12px', cursor:'pointer', fontFamily:'DM Sans', fontSize:13,
                  borderBottom:`1px solid ${C.linen}`,
                  background: selected ? C.sage : 'transparent',
                  color: selected ? '#fff' : C.charcoal,
                }}
              >
                <div style={{ fontWeight:600 }}>{label}</div>
                {(c.email || c.market) && (
                  <div style={{ fontSize:11, color: selected ? 'rgba(255,255,255,0.8)' : '#999', marginTop:1 }}>
                    {[c.email, c.market].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} loading={saving} disabled={!contactId}>Create project</Button>
      </div>
    </Modal>
  );
}

// A compact horizontal card for the Sold Projects grid. Two anchors carry the scan:
// the customer name (top-left) and the sale price (top-right, bold) — everything
// else recedes to one muted tone. A thin status-colored LEFT EDGE encodes the stage
// ambiently (no shouty "SOLD" badge), echoed by the status label in the meta line.
// The thumbnail is a flat panel with the rendering bottom-aligned (a consistent
// "ground line" across the list); a line-icon stands in when there's no render. A
// chevron hints the card is tappable. The whole card navigates to the project.
function ProjectCard({ project: p, isAdmin, isMobile, onOpen }) {
  const [hover, setHover] = useState(false);

  const img = [p.rendering_url_1, p.rendering_url_2, p.rendering_url_3, p.rendering_url_4]
    .find(Boolean) || null;

  const contactName = p.contact?.full_name || p.contact?.company_name || p.contact?.email || p.customer_email || 'Unnamed';
  const spec = [p.shed_size, p.style_package?.name].filter(Boolean).join(' ');
  const cityState = [p.contact?.city, p.contact?.state].filter(Boolean).join(', ');
  const dateStr = p.sold_at ? fmtShortDate(p.sold_at) : null;
  const ownerName = p.contact?.owner?.full_name || p.contact?.owner?.email || 'Unassigned';
  const statusLabel = PROJECT_STATUS_LABELS[p.status] || p.status || '';
  const edge = PROJECT_STATUS_EDGE[p.status] || CARD_TERTIARY;
  // Status (colored) leads; date before city so the city truncates first when tight.
  const meta = [dateStr, cityState].filter(Boolean).join('  ·  ');
  const thumb = isMobile ? 96 : 104;

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor:'pointer', background: hover ? C.linen : '#fff', borderRadius:10, overflow:'hidden',
        border:`1px solid ${C.linenDarker}`, borderLeft:`3px solid ${edge}`,
        boxShadow: hover ? '0 6px 18px rgba(26,21,16,0.09)' : 'none',
        transform: hover && !isMobile ? 'translateY(-1px)' : 'none',
        transition:'box-shadow 0.18s, transform 0.18s, background 0.18s',
        display:'flex', alignItems:'stretch',
      }}
    >
      {/* Thumbnail — flat panel, rendering sits on a consistent ground line */}
      <div style={{
        flexShrink:0, width:thumb, alignSelf:'stretch', background:'#F4F1EA',
        display:'flex', alignItems:'flex-end', justifyContent:'center', overflow:'hidden',
      }}>
        {img ? (
          <img
            src={img}
            alt={p.name || 'Shed rendering'}
            loading="lazy"
            style={{ width:'100%', height:'100%', objectFit:'contain', objectPosition:'center bottom', display:'block', padding:7 }}
          />
        ) : (
          <div style={{ alignSelf:'stretch', flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <ShedIcon size={isMobile ? 28 : 32} />
          </div>
        )}
      </div>

      {/* Details */}
      <div style={{ flex:1, minWidth:0, padding: isMobile ? '12px 6px 12px 14px' : '13px 6px 13px 16px', display:'flex', flexDirection:'column', justifyContent:'center', gap:4 }}>
        {/* Anchors: customer (left) + price (right) */}
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10 }}>
          <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize: isMobile ? 15.5 : 15, color:C.charcoal, lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {contactName}
          </span>
          {p.sale_price != null && (
            <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize: isMobile ? 15.5 : 15, color:C.sageDark, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
              {fmtMoneyShort(p.sale_price)}
            </span>
          )}
        </div>

        {spec && (
          <div style={{ fontFamily:'DM Sans', fontSize:12.5, color:CARD_SECONDARY, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {spec}{p.project_number && <span style={{ color:CARD_TERTIARY }}>{'  ·  #' + p.project_number}</span>}
          </div>
        )}

        <div style={{ fontFamily:'DM Sans', fontSize:12, color:CARD_SECONDARY, fontVariantNumeric:'tabular-nums', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          <span style={{ color:edge, fontWeight:600 }}>{statusLabel}</span>{meta && `  ·  ${meta}`}
        </div>

        {isAdmin && (
          <div style={{ fontFamily:'DM Sans', fontSize:11.5, color:CARD_TERTIARY, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {ownerName}
          </div>
        )}
      </div>

      {/* Tappable affordance */}
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', paddingRight:12, paddingLeft:2, color: hover ? C.sage : '#CFC8BB', fontSize:20, transition:'color 0.15s' }}>
        ›
      </div>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding:'11px 14px', fontWeight:600, color:'#666', fontSize:11, textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding:'11px 14px', color:C.charcoal, verticalAlign:'top' }}>{children}</td>;
}
