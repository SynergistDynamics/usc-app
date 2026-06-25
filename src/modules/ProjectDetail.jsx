// src/modules/ProjectDetail.jsx
// A single project's page (/projects/:id) — edit its details + its full shed spec.
//
// The shed spec mirrors the Materials Calculator exactly (size, style, siding,
// option packages, per-package overrides) and is stored on the project, so the
// SAME engine (buildOutput) renders a live materials list from the saved project
// (PricingTool's ConfigPanel + MaterialsListTab are reused — one source of truth).
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

      {/* Project details */}
      <Card style={{ marginBottom:20 }}>
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

      {/* ShedPro order details (read-only) — present on synced/seeded projects */}
      <ShedProDetails project={project} isMobile={isMobile} />

      {/* Shed spec + live materials list (same as the Materials Calculator) */}
      <div style={{ fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.sand, marginBottom:12 }}>
        Shed spec & materials list
      </div>
      {cfg && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap:20, alignItems:'start' }}>
          <div style={{ position: isMobile ? 'static' : 'sticky', top:16 }}>
            <ConfigPanel cfg={cfg} setCfg={setCfg} packages={packages} />
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

      {/* Footer actions */}
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

// Read-only ShedPro order details — renderings + the configured options/colors that
// came from ShedPro (today seeded from the CSV export, later via Zapier). Only shows
// for projects that carry ShedPro data; the editable spec above stays the calculator's.
function ShedProDetails({ project, isMobile }) {
  if (!project) return null;
  const renders = [
    project.rendering_url_1, project.rendering_url_2, project.rendering_url_3,
    project.rendering_url_4, project.layout_rendering_url,
  ].filter(Boolean);

  // [label, value] pairs — only the ones that have a value are shown.
  const specs = [
    ['Project #', project.project_number && `#${project.project_number}`],
    ['Customer', project.customer_email],
    ['Builder (ShedPro)', project.builder_email],
    ['Construction date', project.construction_date],
    ['Siding type', project.siding_type],
    ['Overhang', project.overhang_size],
    ['Siding color', project.siding_color],
    ['Trim color', project.trim_color],
    ['Door color', project.door_color],
    ['Roof color', project.roof_color],
    ['Doors', project.doors],
    ['Windows', project.windows],
    ['Vents', project.vents],
    ['Roof', project.roof],
    ['Floor', project.floor],
    ['Transom', project.transom_package],
    ['Site prep', project.site_prep],
    ['Building permit', project.building_permit],
    ['Access', project.access],
    ['Additional features', project.additional_features],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  if (!renders.length && !specs.length) return null;

  return (
    <Card style={{ marginBottom:20 }}>
      <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:C.charcoal, marginBottom:14 }}>
        ShedPro order details
      </div>

      {renders.length > 0 && (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom: specs.length ? 18 : 0 }}>
          {renders.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display:'block', flexShrink:0 }}>
              <img src={url} alt="" loading="lazy"
                style={{ width: isMobile ? 100 : 130, height: isMobile ? 75 : 98, objectFit:'cover', borderRadius:4, border:`1px solid ${C.linenDarker}`, background:C.linen }} />
            </a>
          ))}
        </div>
      )}

      {specs.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap:'12px 20px' }}>
          {specs.map(([label, value]) => (
            <div key={label}>
              <div style={{ fontFamily:'DM Sans', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:C.sand }}>{label}</div>
              <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.charcoal, marginTop:2, wordBreak:'break-word' }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
