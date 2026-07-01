// src/App.jsx
import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, NavLink, Link } from 'react-router-dom';
import { supabase, C, canManagePackages } from './lib/supabase';
import { AuthProvider, useAuth, LoginPage, LoadingScreen, BlockedScreen, UpdatePasswordPage } from './components/Auth';
import { Spinner, Button } from './components/UI';
import Dashboard             from './modules/Dashboard';
import Contacts              from './modules/Contacts';
import ContactProfile        from './modules/ContactProfile';
import Projects              from './modules/Projects';
import ProjectDetail         from './modules/ProjectDetail';
import PricingTool           from './modules/PricingTool';
import MaterialPriceManager  from './modules/MaterialPriceManager';
import AdminPanel            from './modules/AdminPanel';
import PackageManager        from './modules/PackageManager';
import AffiliateResources    from './modules/AffiliateResources';
import Blueprints            from './modules/Blueprints';
import ConfiguratorPricing   from './modules/ConfiguratorPricing';
import Financing             from './modules/Financing';
import Profile               from './modules/Profile';

export default function App() {
  return (
    <AuthProvider>
      <style>{globalStyles}</style>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { session, profile, signOut, recovery, clearRecovery } = useAuth();
  if (recovery) return <UpdatePasswordPage onDone={clearRecovery} />;
  if (session === undefined || (session && !profile)) return <LoadingScreen />;
  if (!session) return <LoginPage />;
  if (profile?.role === 'blocked') return <BlockedScreen onSignOut={signOut} />;
  return <AppInner />;
}

// ── NAV CONSTANTS ─────────────────────────────────────────────
// Real URLs (React Router) replace the old in-memory module index.
// Route → module map (see <Routes> in AppInner):
//   /dashboard             = Builder Dashboard (landing page)
//   /calculator           = Materials Calculator
//   /material-prices       = Material Prices
//   /packages              = Packages (admin)
//   /affiliate             = Affiliate Resources
//   /admin                 = Admin (admin)
//   /blueprints            = Blueprints
//   /configurator-pricing  = Configurator Pricing
//   /financing             = Financing
const ROUTES = {
  dashboard:    '/dashboard',
  contacts:     '/contacts',
  projects:     '/projects',
  soldProjects: '/sold-projects',
  calculator:   '/calculator',
  matPrices:    '/material-prices',
  packages:     '/packages',
  affiliate:    '/affiliate',
  admin:        '/admin',
  blueprints:   '/blueprints',
  configurator: '/configurator-pricing',
  financing:    '/financing',
  profile:      '/profile',
};

// Material Prices (/material-prices) and Packages (/packages) used to live in a
// collapsible "Calculator Settings" submenu. They're now tabs inside the
// Configurator Pricing page; the routes are kept so direct links still resolve.

// ── NAV COMPONENTS (outside AppInner to prevent re-creation) ──
// NavBtn is now a router NavLink; active state comes from the current URL.
function NavBtn({ to, icon, label, sidebarOpen, onNavigate }) {
  return (
    <NavLink to={to} onClick={onNavigate} style={({ isActive }) => ({
      display:'flex', alignItems:'center', gap:12, width:'100%',
      padding: sidebarOpen ? '10px 20px' : '10px',
      border:'none', cursor:'pointer', textDecoration:'none',
      background: isActive ? C.sage : 'transparent',
      color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
      fontFamily:'DM Sans', fontSize:13, fontWeight: isActive ? 600 : 400,
      textAlign:'left', transition:'all 0.15s', flexShrink:0,
    })}>
      <span style={{ fontSize:15, flexShrink:0 }}>{icon}</span>
      {sidebarOpen && <span>{label}</span>}
    </NavLink>
  );
}

function ExtLink({ href, icon, label, sidebarOpen }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      display:'flex', alignItems:'center', gap:12, width:'100%',
      padding: sidebarOpen ? '10px 20px' : '10px',
      textDecoration:'none', color:'rgba(255,255,255,0.45)',
      fontFamily:'DM Sans', fontSize:13, fontWeight:400, transition:'all 0.15s',
    }}>
      <span style={{ fontSize:15, flexShrink:0 }}>{icon}</span>
      {sidebarOpen && <span>{label}</span>}
    </a>
  );
}

// Small round avatar for the sidebar — photo if set, else the user's first initial.
function UserAvatar({ profile, size = 32 }) {
  const initial = (profile?.full_name || profile?.email || '?').trim().charAt(0).toUpperCase();
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover', flexShrink:0, border:'1px solid rgba(255,255,255,0.15)' }} />;
  }
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:C.sage, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Cormorant Garamond, serif', fontSize:size*0.5, fontWeight:700, flexShrink:0 }}>
      {initial}
    </div>
  );
}

function AppInner() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canPackages = canManagePackages(profile);

  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [isMobile,     setIsMobile]     = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Track viewport size
  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setMobileNavOpen(false);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close the mobile nav drawer whenever a nav link is followed.
  const onNavigate = useCallback(() => {
    if (isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  const [materials,      setMaterials]      = useState([]);
  const [overrides,      setOverrides]      = useState({});
  const [packages,       setPackages]       = useState([]);
  const [pkgMaterials,   setPkgMaterials]   = useState([]);
  const [pkgQuantities,  setPkgQuantities]  = useState([]);
  const [styleMults,     setStyleMults]     = useState({}); // current user's per-style multipliers, keyed by package_id
  const [loading,        setLoading]        = useState(true);
  const [dbError,        setDbError]        = useState('');

  const loadData = useCallback(async () => {
    setLoading(true); setDbError('');
    // package_quantities can exceed the PostgREST max-rows cap (default 1000), and
    // `.range()` cannot exceed that cap — so page through it to get every row.
    async function fetchAllPackageQuantities() {
      const pageSize = 1000;
      let from = 0, all = [];
      for (;;) {
        const { data, error } = await supabase
          .from('package_quantities').select('*')
          .order('package_id').range(from, from + pageSize - 1);
        if (error) return { data: all, error };
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return { data: all, error: null };
    }
    const [mats, ovs, pkgs, pkgMats, pkgQtys, styleMultRes] = await Promise.all([
      supabase.from('materials').select('*').order('sort_order'),
      supabase.from('material_overrides').select('*').eq('user_id', profile.id),
      supabase.from('packages').select('*').order('sort_order'),
      supabase.from('package_materials').select('*').range(0, 9999),
      fetchAllPackageQuantities(),
      supabase.from('style_multipliers').select('*').eq('user_id', profile.id),
    ]);
    if (mats.error) { setDbError(mats.error.message); setLoading(false); return; }
    setMaterials(mats.data || []);
    setOverrides(Object.fromEntries((ovs.data || []).map(o => [o.material_id, o])));
    setPackages(pkgs.data || []);
    setPkgMaterials(pkgMats.data || []);
    setPkgQuantities(pkgQtys.data || []);
    // style_multipliers may not exist yet (before the migration SQL is run) — fail soft.
    setStyleMults(Object.fromEntries((styleMultRes.data || []).map(s => [s.package_id, s.multiplier])));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { loadData(); }, [loadData]);


  // On mobile: sidebar is an overlay drawer, always full-width when open
  const sidebarExpanded = isMobile ? true : sidebarOpen;
  const sw = isMobile ? 260 : (sidebarOpen ? 240 : 64);

  // Sidebar visibility: on desktop always shown; on mobile shown only when mobileNavOpen
  const showSidebar = !isMobile || mobileNavOpen;

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:C.linen }}>

      {/* ── Mobile top bar ── */}
      {isMobile && (
        <div style={{ position:'fixed', top:0, left:0, right:0, height:56, background:'#1A1510', display:'flex', alignItems:'center', padding:'0 16px', zIndex:200, boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
          <button onClick={() => setMobileNavOpen(p=>!p)} aria-label="Menu" style={{ background:'transparent', border:'none', cursor:'pointer', padding:8, display:'flex', flexDirection:'column', gap:4, marginRight:14 }}>
            <span style={{ width:22, height:2, background:'#fff', borderRadius:2, transition:'all 0.2s', transform: mobileNavOpen ? 'rotate(45deg) translate(5px,5px)' : 'none' }} />
            <span style={{ width:22, height:2, background:'#fff', borderRadius:2, opacity: mobileNavOpen ? 0 : 1 }} />
            <span style={{ width:22, height:2, background:'#fff', borderRadius:2, transition:'all 0.2s', transform: mobileNavOpen ? 'rotate(-45deg) translate(5px,-5px)' : 'none' }} />
          </button>
          <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:18, fontWeight:700, color:'#fff' }}>Urban Sheds Collective</div>
        </div>
      )}

      {/* ── Mobile backdrop ── */}
      {isMobile && mobileNavOpen && (
        <div onClick={() => setMobileNavOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:250 }} />
      )}

      {/* ── Sidebar ── */}
      {showSidebar && (
      <div style={{
        width:sw, minHeight:'100vh', background:'#1A1510', display:'flex', flexDirection:'column',
        transition:'width 0.2s', flexShrink:0,
        position: isMobile ? 'fixed' : 'sticky',
        top:0, height:'100vh', zIndex: isMobile ? 300 : 1,
        boxShadow: isMobile ? '2px 0 16px rgba(0,0,0,0.3)' : 'none',
      }}>

        {/* Logo */}
        <div style={{ padding: sidebarExpanded ? '24px 20px 18px' : '20px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
          {sidebarExpanded ? (
            <>
              <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:19, fontWeight:700, color:'#fff', lineHeight:1.25 }}>Urban Sheds<br/>Collective</div>
              <div style={{ fontFamily:'DM Sans', fontSize:10, color:'#B8986A', marginTop:6, letterSpacing:'0.06em', fontStyle:'italic' }}>Give homeowners something worth having.</div>
            </>
          ) : (
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:16, fontWeight:700, color:'#fff', textAlign:'center' }}>USC</div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'8px 0' }}>

          {/* Dashboard */}
          <NavBtn to={ROUTES.dashboard}    icon="🏡" label="Dashboard"              sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />
          <NavBtn to={ROUTES.contacts}     icon="📇" label="Contacts"               sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />
          <NavBtn to={ROUTES.soldProjects} icon="✅" label="Sold Projects"          sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />

          {/* Main tools */}
          <NavBtn to={ROUTES.calculator}   icon="⚡" label="Materials Calculator"   sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />
          <NavBtn to={ROUTES.configurator} icon="💲" label="Configurator Pricing"   sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />

          <div style={{ margin:'10px 16px', borderTop:'1px solid rgba(255,255,255,0.07)' }} />

          {/* Other pages */}
          <NavBtn to={ROUTES.profile}    icon="👤" label="My Profile"          sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />
          <NavBtn to={ROUTES.affiliate}  icon="🔗" label="Affiliate Resources" sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />
          <NavBtn to={ROUTES.blueprints} icon="📐" label="Blueprints"          sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />
          <NavBtn to={ROUTES.financing}  icon="💰" label="Financing"           sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />

          <div style={{ margin:'10px 16px', borderTop:'1px solid rgba(255,255,255,0.07)' }} />

          {/* External links */}
          <ExtLink href="https://www.urban-sheds.com/"                                        icon="🌐" label="urban-sheds.com"   sidebarOpen={sidebarExpanded} />
          <ExtLink href="https://urbansheds.shedpro.co/wp-login.php"                          icon="🏠" label="ShedPro Backend"   sidebarOpen={sidebarExpanded} />
          <ExtLink href="https://urbansheds.shedpro.co/"                                      icon="🧊" label="3D Configurator"   sidebarOpen={sidebarExpanded} />
          <ExtLink href="https://app.velocity360crm.com/"                                     icon="📊" label="Velocity CRM"      sidebarOpen={sidebarExpanded} />

          {isAdmin && <div style={{ margin:'10px 16px', borderTop:'1px solid rgba(255,255,255,0.07)' }} />}
          {isAdmin && <NavBtn to={ROUTES.admin} icon="🛠" label="Admin" sidebarOpen={sidebarExpanded} onNavigate={onNavigate} />}
          {/* Tech-stack links (Supabase, Vercel, …) live in Admin → Tech Stack (super admin only) */}

        </nav>

        {/* User + sign out — the identity block links to the profile page */}
        <div style={{ padding: sidebarExpanded ? '14px 20px' : '14px 8px', borderTop:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
          <Link to={ROUTES.profile} onClick={onNavigate} style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', marginBottom:8, justifyContent: sidebarExpanded ? 'flex-start' : 'center' }}>
            <UserAvatar profile={profile} size={sidebarExpanded ? 32 : 30} />
            {sidebarExpanded && (
              <div style={{ minWidth:0 }}>
                <div style={{ fontFamily:'DM Sans', fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.8)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{profile?.full_name || profile?.email}</div>
                {profile?.market && <div style={{ fontFamily:'DM Sans', fontSize:10, color:C.sageLight, marginTop:2 }}>{profile.market}</div>}
              </div>
            )}
          </Link>
          <button onClick={signOut} style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding: sidebarExpanded ? '6px 0' : '6px', border:'none', cursor:'pointer', background:'transparent', color:'rgba(255,255,255,0.35)', fontFamily:'DM Sans', fontSize:11, justifyContent: sidebarExpanded ? 'flex-start' : 'center' }}>
            <span>↩</span>{sidebarExpanded && <span>Sign out</span>}
          </button>
        </div>

        {!isMobile && (
          <button onClick={() => setSidebarOpen(p=>!p)} style={{ padding:'7px', border:'none', background:'transparent', color:'rgba(255,255,255,0.2)', cursor:'pointer', fontSize:11, fontFamily:'DM Sans', textAlign: sidebarOpen ? 'right' : 'center', paddingRight: sidebarOpen ? 14 : 7, flexShrink:0 }}>
            {sidebarOpen ? '← hide' : '→'}
          </button>
        )}
      </div>
      )}

      {/* ── Main content ── */}
      <div style={{ flex:1, padding: isMobile ? '72px 16px 32px' : '36px 40px', maxWidth: isMobile ? '100%' : 1300, width:'100%', overflowX:'hidden', background:'#F7F3EC' }}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spinner size={32} /></div>
        ) : dbError ? (
          <div style={{ fontFamily:'DM Sans', fontSize:14, color:C.error, padding:40, textAlign:'center' }}>
            Failed to load data: {dbError}<br/>
            <Button variant="secondary" onClick={loadData} style={{ marginTop:12 }}>Retry</Button>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to={ROUTES.dashboard} replace />} />
            <Route path={ROUTES.dashboard} element={<Dashboard />} />
            <Route path={ROUTES.contacts} element={<Contacts />} />
            <Route path={`${ROUTES.contacts}/:id`} element={<ContactProfile />} />
            <Route path={ROUTES.projects} element={<Projects />} />
            <Route path={ROUTES.soldProjects} element={<Projects soldOnly />} />
            <Route path={`${ROUTES.projects}/:id`} element={<ProjectDetail materials={materials} overrides={overrides} packages={packages} pkgMaterials={pkgMaterials} pkgQuantities={pkgQuantities} styleMults={styleMults} />} />
            <Route path={ROUTES.calculator} element={<PricingTool materials={materials} overrides={overrides} packages={packages} pkgMaterials={pkgMaterials} pkgQuantities={pkgQuantities} styleMults={styleMults} />} />
            <Route path={ROUTES.matPrices} element={<MaterialPriceManager materials={materials} overrides={overrides} setOverrides={setOverrides} onMasterUpdated={loadData} />} />
            <Route path={ROUTES.packages} element={canPackages ? <PackageManager materials={materials} overrides={overrides} packages={packages} pkgMaterials={pkgMaterials} pkgQuantities={pkgQuantities} onRefresh={loadData} /> : <Navigate to={ROUTES.calculator} replace />} />
            <Route path={ROUTES.affiliate} element={<AffiliateResources />} />
            <Route path={ROUTES.admin} element={isAdmin ? <AdminPanel /> : <Navigate to={ROUTES.calculator} replace />} />
            <Route path={ROUTES.blueprints} element={<Blueprints />} />
            <Route path={ROUTES.financing} element={<Financing />} />
            <Route path={ROUTES.profile} element={<Profile />} />
            <Route path={ROUTES.configurator} element={<ConfiguratorPricing materials={materials} overrides={overrides} setOverrides={setOverrides} packages={packages} pkgMaterials={pkgMaterials} pkgQuantities={pkgQuantities} styleMults={styleMults} onRefresh={loadData} />} />
            <Route path="*" element={<Navigate to={ROUTES.dashboard} replace />} />
          </Routes>
        )}
      </div>
    </div>
  );
}

const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap');
  *, *::before, *::after { box-sizing: border-box; }
  body { margin:0; font-family:'DM Sans',sans-serif; background:#F7F3EC; color:#1A1A1A; -webkit-font-smoothing:antialiased; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; }
  @keyframes spin { to { transform:rotate(360deg); } }
  select:focus, input:focus { outline:none; border-color:#7A9B76 !important; box-shadow:0 0 0 2px #7A9B7622; }
  nav::-webkit-scrollbar { width: 4px; }
  nav::-webkit-scrollbar-track { background: transparent; }
  nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
  a { color: #7A9B76; }

  /* ── Mobile responsiveness ── */
  @media (max-width: 768px) {
    /* Two-column grids stack to one column */
    div[style*="gridTemplateColumns: '1fr 1fr'"],
    div[style*="grid-template-columns: 1fr 1fr"],
    div[style*="gridTemplateColumns:'1fr 1fr'"] {
      grid-template-columns: 1fr !important;
    }
    /* Config/output split layouts stack */
    div[style*="gridTemplateColumns:'280px 1fr'"],
    div[style*="gridTemplateColumns: '280px 1fr'"] {
      grid-template-columns: 1fr !important;
    }
    /* Sticky config panels become static on mobile */
    div[style*="position:'sticky'"][style*="top:16"],
    div[style*="position: sticky"][style*="top: 16"] {
      position: static !important;
    }
    /* Headings scale down */
    h1 { font-size: 26px !important; }
    h2 { font-size: 22px !important; }
    h3 { font-size: 18px !important; }
  }

  /* ── Make all tables horizontally scrollable on touch devices ── */
  .usc-table-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  .usc-table-scroll::-webkit-scrollbar { height: 8px; }
  .usc-table-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.04); border-radius: 4px; }
  .usc-table-scroll::-webkit-scrollbar-thumb { background: rgba(122,155,118,0.4); border-radius: 4px; }

  /* Tables inside scroll containers keep their min-width so columns don't crush */
  @media (max-width: 768px) {
    .usc-table-scroll table { min-width: 600px; }
  }
`;
