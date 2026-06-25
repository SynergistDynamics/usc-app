// src/modules/ProjectDetail.jsx
// A single project's page (/projects/:id), presented as a printable WORK ORDER.
//
// Two tabs:
//   • Work Order   — a formatted, printable work-order document with all the
//                    relevant project details (customer, builder, shed spec,
//                    finishes, options, renderings, pricing, notes). Has a
//                    "Print work order" button. The editable project fields
//                    (name, status, sale price, notes) live below the document.
//   • Materials List — the shed spec config + a live materials list, rendered by
//                    the SAME engine as the Materials Calculator (PricingTool's
//                    ConfigPanel + MaterialsListTab + buildOutput — one source of
//                    truth). Editing the spec here updates the work order too.
//
// Loads its own row via lib/projects.js; RLS guarantees a builder can only open/edit
// a project whose contact they own (admins can open any). The global material/package
// data is passed in as props (same as the calculator) since the spec references them.
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  SHED_SIZES, C, fmt, getStyleMultiplier,
} from '../lib/supabase';
import { buildOutput, ConfigPanel, MaterialsListTab } from './PricingTool';
import {
  getProject, updateProject, deleteProject,
  PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS, isSoldStatus,
} from '../lib/projects';
import {
  Card, Button, Badge, Input, Select, FormField, Label, Modal,
  ErrorBanner, SuccessBanner, WarningBanner, Spinner,
} from '../components/UI';

const STATUS_OPTIONS = PROJECT_STATUSES.map(s => ({ value: s, label: PROJECT_STATUS_LABELS[s] }));
const TABS = [['work-order', 'Work Order'], ['materials', 'Materials List']];

// project row → calculator cfg shape (see PricingTool).
function toCfg(project, stylePkgs) {
  return {
    size:        project.shed_size || SHED_SIZES[0],
    stylePkgId:  project.style_package_id || stylePkgs[0]?.id || '',
    siding:      project.siding || 'T1-11',
    selectedPkgs: project.selected_packages || {},
    pkgOverrides: project.package_overrides || {},
  };
}

export default function ProjectDetail({ materials, overrides, packages, pkgMaterials, pkgQuantities, styleMults }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const stylePkgs = useMemo(() => (packages || []).filter(p => p.is_style), [packages]);
  const salesTax = localStorage.getItem('usc_sales_tax') || '0';

  const [project,  setProject]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState('work-order');

  // Editable fields
  const [name,      setName]      = useState('');
  const [status,    setStatus]    = useState('draft');
  const [salePrice, setSalePrice] = useState('');
  const [notes,     setNotes]     = useState('');
  const [cfg,       setCfg]       = useState(null); // calculator config (size/style/siding/options)

  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setNotFound(false); setError('');
      const { data, error: e } = await getProject(id);
      if (cancelled) return;
      setLoading(false);
      if (e) { setError(e.message); return; }
      if (!data) { setNotFound(true); return; }
      hydrate(data);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function hydrate(data) {
    setProject(data);
    setName(data.name || '');
    setStatus(data.status || 'draft');
    setSalePrice(data.sale_price != null ? String(data.sale_price) : '');
    setNotes(data.notes || '');
    setCfg(toCfg(data, stylePkgs));
  }

  // Live materials list from the current (unsaved) config — same engine as the calculator.
  const out = useMemo(() => {
    if (!cfg) return { hasQty: false };
    return buildOutput({
      ...cfg, styleMults, salesTax, materials, overrides, packages, pkgMaterials, pkgQuantities,
    });
  }, [cfg, styleMults, salesTax, materials, overrides, packages, pkgMaterials, pkgQuantities]);

  const stylePkg   = stylePkgs.find(p => p.id === cfg?.stylePkgId);
  const styleLabel = stylePkg?.name || '—';
  const styleMult  = out.styleMult ?? getStyleMultiplier(styleMults, stylePkg);

  async function save() {
    setSaving(true); setError(''); setSuccess('');
    const willBeSold = isSoldStatus(status);
    const payload = {
      name: name.trim() || null,
      status,
      sale_price: salePrice.trim() === '' ? null : parseFloat(salePrice),
      notes: notes.trim() || null,
      shed_size: cfg.size || null,
      style_package_id: cfg.stylePkgId || null,
      siding: cfg.siding || null,
      selected_packages: cfg.selectedPkgs || {},
      package_overrides: cfg.pkgOverrides || {},
    };
    // Stamp sold_at the first time a project becomes sold; keep it once set.
    if (willBeSold && !project.sold_at) payload.sold_at = new Date().toISOString();
    const { data, error: e } = await updateProject(id, payload);
    setSaving(false);
    if (e) { setError(e.message); return; }
    hydrate(data);
    setSuccess('Project saved.');
  }

  async function doDelete() {
    setDeleting(true); setError('');
    const { error: e } = await deleteProject(id);
    setDeleting(false);
    if (e) { setError(e.message); setConfirmDelete(false); return; }
    navigate('/projects');
  }

  if (loading) return <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spinner size={32} /></div>;

  if (notFound) {
    return (
      <div style={{ maxWidth:760 }}>
        <BackLink />
        <Card style={{ marginTop:16 }}>
          <div style={{ textAlign:'center', padding:'24px 12px', fontFamily:'DM Sans', color:'#888', fontSize:14 }}>
            This project doesn't exist or isn't available to you.
          </div>
        </Card>
      </div>
    );
  }

  const contact = project?.contact;
  const contactName = contact?.full_name || contact?.company_name || contact?.email || 'a contact';
  const title = name.trim() || 'Untitled project';

  // Selected option packages (name + count) for the work order, in package order.
  const selectedOptions = (packages || [])
    .filter(p => !p.siding_type && !p.is_style && (cfg?.selectedPkgs?.[p.id] || 0) > 0)
    .map(p => ({ name: p.name, count: cfg.selectedPkgs[p.id] }));

  return (
    <div>
      <BackLink />

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Header */}
      <Card style={{ marginTop:16, marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div style={{ minWidth:200 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:600, color:C.charcoal, lineHeight:1.1 }}>{title}</div>
            <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <Badge color={PROJECT_STATUS_COLORS[status] || 'ghost'}>{PROJECT_STATUS_LABELS[status] || status}</Badge>
              <span style={{ fontFamily:'DM Sans', fontSize:12.5, color:'#888' }}>
                for <Link to={`/contacts/${contact?.id}`} style={{ color:C.sage, textDecoration:'none', fontWeight:600 }}>{contactName}</Link>
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:`2px solid ${C.linenDarker}`, flexWrap:'nowrap', overflowX: isMobile ? 'auto' : 'visible', overflowY:'hidden' }}>
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding: isMobile ? '10px 16px' : '10px 22px', border:'none', cursor:'pointer', background:'transparent', color: activeTab===key ? C.sage : '#aaa', borderBottom: activeTab===key ? `2px solid ${C.sage}` : '2px solid transparent', marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Work Order tab ── */}
      {activeTab === 'work-order' && (
        <>
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:14 }}>
            <Button onClick={printWorkOrder} style={isMobile ? { width:'100%' } : {}}>🖨 Print work order</Button>
          </div>

          <WorkOrderDoc
            project={project}
            contact={contact}
            title={title}
            status={status}
            salePrice={salePrice}
            notes={notes}
            cfg={cfg}
            size={cfg?.size}
            styleLabel={styleLabel}
            styleMult={styleMult}
            out={out}
            selectedOptions={selectedOptions}
            isMobile={isMobile}
          />

          {/* Editable fields (not part of the printed work order) */}
          <Card style={{ marginTop:20, marginBottom:20 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, marginBottom:14 }}>
              Edit project details
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }} className="usc-project-grid">
              <FormField label="Project name" style={{ marginBottom:0 }}>
                <Input value={name} onChange={setName} placeholder="e.g. 10x12 Modern — backyard office" />
              </FormField>
              <FormField label="Status" style={{ marginBottom:0 }}>
                <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
              </FormField>
              <FormField label="Sale price" style={{ marginBottom:0 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <Input type="number" value={salePrice} onChange={setSalePrice} placeholder="0.00" />
                  {out.hasQty && (
                    <Button variant="ghost" size="sm" onClick={() => setSalePrice(String(Math.round(out.customerPrice)))} style={{ whiteSpace:'nowrap' }}>
                      Use calc ({fmt(out.customerPrice)})
                    </Button>
                  )}
                </div>
              </FormField>
            </div>
            <div style={{ marginTop:16 }}>
              <Label>Notes</Label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything worth remembering about this project…"
                style={{ fontFamily:'DM Sans, sans-serif', fontSize:14, padding:'10px 12px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, background:'#FFFDF9', color:C.charcoal, width:'100%', boxSizing:'border-box', resize:'vertical', lineHeight:1.5 }}
              />
            </div>
          </Card>

          {/* Shed specification — the single place to edit size/style/siding/options.
              Editing here updates both the work order above AND the Materials List tab. */}
          <Card style={{ marginBottom:20 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, marginBottom:6 }}>
              Shed specification
            </div>
            <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#999', margin:'0 0 14px' }}>
              Set the size, style, siding and options here — the work order and the Materials List tab update automatically.
            </p>
            <div style={{ maxWidth: isMobile ? '100%' : 340 }}>
              <ConfigPanel cfg={cfg} setCfg={setCfg} packages={packages} />
            </div>
          </Card>
        </>
      )}

      {/* ── Materials List tab (read-only) ── */}
      {/* The list is generated from the spec; edit the spec on the Work Order tab. */}
      {activeTab === 'materials' && cfg && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:12 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand }}>
              Materials list
            </div>
            <button onClick={() => setActiveTab('work-order')}
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontFamily:'DM Sans', fontSize:12, color:C.sage, fontWeight:600 }}>
              Edit the spec on the Work Order tab →
            </button>
          </div>
          <div style={{ minWidth:0 }}>
            {!stylePkgs.length ? (
              <WarningBanner>No shed styles configured yet. Add them under Packages → Shed Styles.</WarningBanner>
            ) : !out.hasQty ? (
              <WarningBanner>No quantities on file for {styleLabel} at size {cfg.size}. Add them under Packages → Shed Styles.</WarningBanner>
            ) : (
              <MaterialsListTab out={out} cfg={cfg} size={cfg.size} style={styleLabel} multiplier={styleMult} isMobile={isMobile} />
            )}
          </div>
        </div>
      )}

      {/* Footer actions (shared by both tabs) */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:24, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#aaa' }}>
          {project?.created_at ? `Created ${new Date(project.created_at).toLocaleDateString()}` : ''}
          {project?.sold_at ? ` · Sold ${new Date(project.sold_at).toLocaleDateString()}` : ''}
        </span>
        <div style={{ display:'flex', gap:10 }}>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          <Button onClick={save} loading={saving}>Save project</Button>
        </div>
      </div>

      {confirmDelete && (
        <Modal title="Delete project?" onClose={() => setConfirmDelete(false)} width={420}>
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
          .usc-project-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/projects" style={{ fontFamily:'DM Sans', fontSize:13, color:C.sage, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}>
      ← All projects
    </Link>
  );
}

// Open the work-order document in a new window and print it. Mirrors PricingTool's
// printList — copies the rendered #work-order-print HTML into a clean print window.
function printWorkOrder() {
  const el = document.getElementById('work-order-print');
  if (!el) return;
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>USC Work Order</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'DM Sans', sans-serif; padding: 32px; color: #3C3C3C; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>${el.innerHTML}</body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 800);
}

// ── Work order document (printable) ───────────────────────────────────────────
// A formatted work order with every relevant project detail. Rendered on screen
// inside #work-order-print and copied verbatim into the print window.
function WorkOrderDoc({ project, contact, title, status, salePrice, notes, cfg, size, styleLabel, styleMult, out, selectedOptions, isMobile }) {
  const dateStr = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const woNumber = project?.project_number ? `#${project.project_number}` : `#${String(project?.id || '').slice(0, 8).toUpperCase()}`;

  const customerName  = contact?.full_name || contact?.company_name || contact?.email || '—';
  const cityStateZip  = [contact?.city, contact?.state].filter(Boolean).join(', ') + (contact?.zip ? ` ${contact.zip}` : '');
  const builderName   = project?.contact?.owner?.full_name || project?.contact?.owner?.company_name || project?.builder_email || '—';
  const builderEmail  = project?.contact?.owner?.email || project?.builder_email || '';

  const renders = [
    project?.rendering_url_1, project?.rendering_url_2, project?.rendering_url_3,
    project?.rendering_url_4, project?.layout_rendering_url,
  ].filter(Boolean);

  // Finishes & configured options that came from ShedPro (only the ones present).
  const finishes = [
    ['Siding type', project?.siding_type],
    ['Overhang', project?.overhang_size],
    ['Siding color', project?.siding_color],
    ['Trim color', project?.trim_color],
    ['Door color', project?.door_color],
    ['Roof color', project?.roof_color],
    ['Doors', project?.doors],
    ['Windows', project?.windows],
    ['Vents', project?.vents],
    ['Roof', project?.roof],
    ['Floor', project?.floor],
    ['Transom', project?.transom_package],
    ['Site prep', project?.site_prep],
    ['Building permit', project?.building_permit],
    ['Access', project?.access],
    ['Additional features', project?.additional_features],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  const salePriceNum = salePrice != null && String(salePrice).trim() !== '' ? parseFloat(salePrice) : null;

  return (
    <div id="work-order-print" style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding: isMobile ? 18 : 32 }}>
      {/* Letterhead */}
      <div style={{ borderBottom:`2px solid ${C.charcoal}`, paddingBottom:14, marginBottom:18, display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:16, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:700, color:C.charcoal }}>Urban Sheds Collective</div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, color:C.sage, letterSpacing:'0.05em' }}>Give homeowners something worth having.</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:700, letterSpacing:'0.04em', color:C.charcoal }}>WORK ORDER</div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#777', marginTop:2 }}>{woNumber} · {dateStr}</div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#777', marginTop:2 }}>Status: {PROJECT_STATUS_LABELS[status] || status}</div>
        </div>
      </div>

      {/* Project title */}
      <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:600, color:C.charcoal, marginBottom:16 }}>{title}</div>

      {/* Customer / Builder */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:18 }}>
        <WoBlock label="Customer">
          <WoLine strong>{customerName}</WoLine>
          {contact?.company_name && contact.company_name !== customerName && <WoLine>{contact.company_name}</WoLine>}
          {contact?.address && <WoLine>{contact.address}</WoLine>}
          {cityStateZip.trim() && <WoLine>{cityStateZip}</WoLine>}
          {contact?.phone && <WoLine>{contact.phone}</WoLine>}
          {contact?.email && <WoLine>{contact.email}</WoLine>}
        </WoBlock>
        <WoBlock label="Builder">
          <WoLine strong>{builderName}</WoLine>
          {builderEmail && <WoLine>{builderEmail}</WoLine>}
          {project?.construction_date && <WoLine>Construction date: {project.construction_date}</WoLine>}
        </WoBlock>
      </div>

      {/* Shed specifications */}
      <WoSection title="Shed Specifications" />
      <div style={{ display:'flex', gap:24, flexWrap:'wrap', background:C.linen, borderRadius:4, padding:'12px 16px', marginBottom:16 }}>
        {[['Size', size], ['Style', styleLabel], ['Siding', cfg?.siding], ['Multiplier', styleMult != null ? `${styleMult}×` : '—']].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand }}>{k}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.charcoal }}>{v || '—'}</div>
          </div>
        ))}
      </div>

      {/* Selected option packages */}
      {selectedOptions.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:C.sand, marginBottom:6 }}>Options & Add-ons</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 10px' }}>
            {selectedOptions.map(o => (
              <span key={o.name} style={{ fontFamily:'DM Sans', fontSize:12, color:C.charcoal, background:C.linen, border:`1px solid ${C.linenDarker}`, borderRadius:3, padding:'3px 9px' }}>
                {o.name}{o.count > 1 ? ` ×${o.count}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Finishes & configured details */}
      {finishes.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Finishes & Configuration" />
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap:'12px 20px' }}>
            {finishes.map(([label, value]) => (
              <div key={label}>
                <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:C.sand }}>{label}</div>
                <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, marginTop:2, wordBreak:'break-word' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Renderings */}
      {renders.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <WoSection title="Renderings" />
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {renders.map((url, i) => (
              <img key={i} src={url} alt="" loading="lazy"
                style={{ width: isMobile ? 110 : 150, height: isMobile ? 82 : 112, objectFit:'cover', borderRadius:4, border:`1px solid ${C.linenDarker}`, background:C.linen }} />
            ))}
          </div>
        </div>
      )}

      {/* Pricing */}
      <WoSection title="Pricing" />
      <table style={{ width:'100%', borderCollapse:'collapse', marginBottom: notes && notes.trim() ? 16 : 0 }}>
        <tbody>
          {out?.hasQty && (
            <>
              <tr><td style={woTd}>Material cost</td><td style={{ ...woTd, textAlign:'right', color:'#888' }}>{fmt(out.totalMat)}</td></tr>
              <tr><td style={woTd}>Labor &amp; profit</td><td style={{ ...woTd, textAlign:'right' }}>{fmt(out.laborProfit)}</td></tr>
              <tr><td style={woTd}>Calculated price</td><td style={{ ...woTd, textAlign:'right', fontWeight:600 }}>{fmt(out.customerPrice)}</td></tr>
            </>
          )}
          <tr style={{ borderTop:`1.5px solid ${C.linenDarker}` }}>
            <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:20, color:C.charcoal }}>Sale price</td>
            <td style={{ padding:'8px 0 0', fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, color:C.sage, textAlign:'right' }}>
              {salePriceNum != null ? fmt(salePriceNum) : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Notes */}
      {notes && notes.trim() && (
        <div>
          <WoSection title="Notes" />
          <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{notes}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop:22, paddingTop:12, borderTop:`1px solid ${C.linenDarker}`, fontFamily:'DM Sans', fontSize:10, color:'#aaa', textAlign:'center' }}>
        Urban Sheds Collective · build.urban-sheds.com · Work order {woNumber}
      </div>
    </div>
  );
}

function WoSection({ title }) {
  return (
    <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#fff', background:C.sage, padding:'5px 10px', borderRadius:'3px 3px 0 0', marginBottom:10 }}>
      {title}
    </div>
  );
}

function WoBlock({ label, children }) {
  return (
    <div style={{ border:`1px solid ${C.linenDarker}`, borderRadius:4, padding:'12px 14px', background:'#fff' }}>
      <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sand, marginBottom:6 }}>{label}</div>
      {children}
    </div>
  );
}

function WoLine({ children, strong }) {
  return (
    <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, fontWeight: strong ? 600 : 400, marginBottom:2, wordBreak:'break-word' }}>
      {children}
    </div>
  );
}

const woTd = { padding:'5px 0', fontFamily:'DM Sans', fontSize:13, color:C.charcoal };
