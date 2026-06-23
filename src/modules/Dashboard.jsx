// src/modules/Dashboard.jsx
// Builder dashboard — the landing page after login (ARCHITECTURE.md build sequence, step 2).
//
// Two views, gated by role (UI gate; Supabase RLS is the real boundary):
//   • Builders  → BuilderHome: their own welcome + quick links. They only ever see their own data.
//   • Admins    → AdminDashboard: a tabbed view — a "Business Overview" tab plus one tab per builder,
//                 so the admin can switch tabs and see how each builder is doing.
//
// Most performance metrics are placeholders for now — they light up once ShedPro and projects are
// connected (ARCHITECTURE.md steps 3–5). The profile data we already have is shown for real.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase, C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { Spinner } from '../components/UI';

// Time-of-day greeting so the welcome feels alive without any extra data.
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Quick links into the tools that already exist.
const QUICK_LINKS = [
  { icon: '⚡', title: 'Materials Calculator', desc: 'Build a materials list and price a shed for a customer.', to: '/calculator' },
  { icon: '💲', title: 'Configurator Pricing', desc: 'Set your base, siding, and add-on pricing.', to: '/configurator-pricing' },
  { icon: '📐', title: 'Blueprints', desc: 'Access shed blueprints and build plans.', to: '/blueprints' },
  { icon: '🔗', title: 'Affiliate Resources', desc: 'Tools, links, and referral resources for your business.', to: '/affiliate' },
  { icon: '💰', title: 'Financing', desc: 'Financing options to share with your customers.', to: '/financing' },
];

// Things on the roadmap that aren't wired up yet (ARCHITECTURE.md build sequence, steps 3–5).
const COMING_SOON = [
  { icon: '🧊', title: 'ShedPro Configurator', desc: 'Your 3D configurator and quotes, connected right here.' },
  { icon: '📋', title: 'Projects', desc: 'Track your builds from quote to completion.' },
  { icon: '⭐', title: 'Customer Reviews', desc: 'Reviews that sync to your public builder profile.' },
];

// Per-builder / business metrics that don't have a data source yet. Shown as placeholders so the
// layout is ready; they become real once ShedPro/projects land.
const PLACEHOLDER_METRICS = [
  { icon: '📋', label: 'Active Projects' },
  { icon: '🧾', label: 'Open Quotes' },
  { icon: '💵', label: 'Revenue (YTD)' },
  { icon: '⭐', label: 'Avg. Rating' },
];

export default function Dashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  return isAdmin ? <AdminDashboard /> : <BuilderHome profile={profile} />;
}

// ── Builder view: their own welcome page (single tab) ─────────────────────────
function BuilderHome({ profile }) {
  const firstName = (profile?.full_name || '').trim().split(' ')[0];
  return (
    <div style={{ maxWidth: 980 }}>
      <WelcomeBanner
        kicker={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        title="Welcome to Urban Sheds Collective"
        sub={`Your home base for pricing, materials, and the tools you need to run your shed business.${profile?.market ? ` Building in ${profile.market}.` : ''}`}
      />

      <SubHeading>Quick Access</SubHeading>
      <div style={grid2} >
        {QUICK_LINKS.map(l => <QuickLinkCard key={l.to} {...l} />)}
      </div>

      <SubHeading style={{ marginTop: 32, marginBottom: 6 }}>Coming Soon</SubHeading>
      <p style={mutedNote}>We're building out the full platform piece by piece. Here's what's next.</p>
      <div style={grid3}>
        {COMING_SOON.map(c => <ComingSoonCard key={c.title} {...c} />)}
      </div>

      <ResponsiveGridStyle />
    </div>
  );
}

// ── Admin view: tabbed — Business Overview + one tab per builder ──────────────
function AdminDashboard() {
  const { profile } = useAuth();
  const [builders, setBuilders] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | builder.id

  useEffect(() => {
    let alive = true;
    (async () => {
      // Admins can read all profiles (RLS allows it). We only list actual builders.
      const { data } = await supabase
        .from('profiles').select('*').eq('role', 'builder').order('full_name');
      if (alive) { setBuilders(data || []); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const firstName = (profile?.full_name || '').trim().split(' ')[0];
  const activeBuilder = builders.find(b => b.id === activeTab);

  return (
    <div style={{ maxWidth: 980 }}>
      <WelcomeBanner
        kicker={`${greeting()}${firstName ? `, ${firstName}` : ''} · Admin`}
        title="Business Dashboard"
        sub="See how the collective is doing overall, then switch tabs to check in on each builder."
      />

      {/* Tabs — Overview + one per builder (scrolls horizontally if there are many). */}
      <div className="usc-table-scroll" style={{ display:'flex', gap:0, marginBottom:24, borderBottom:`2px solid ${C.linenDarker}`, overflowX:'auto' }}>
        <TabBtn label="Business Overview" active={activeTab==='overview'} onClick={() => setActiveTab('overview')} />
        {builders.map(b => (
          <TabBtn key={b.id} label={tabName(b)} active={activeTab===b.id} onClick={() => setActiveTab(b.id)} />
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner size={28} /></div>
      ) : activeTab === 'overview' ? (
        <OverviewTab builders={builders} />
      ) : activeBuilder ? (
        <BuilderTab builder={activeBuilder} />
      ) : (
        <p style={mutedNote}>That builder is no longer available.</p>
      )}

      <ResponsiveGridStyle />
    </div>
  );
}

// Business-wide overview.
function OverviewTab({ builders }) {
  const markets = [...new Set(builders.map(b => (b.market || '').trim()).filter(Boolean))];
  return (
    <div>
      {/* Real numbers we already have */}
      <div style={grid2}>
        <StatCard icon="👷" label="Builders" value={builders.length} />
        <StatCard icon="📍" label="Active Markets" value={markets.length} sub={markets.slice(0, 4).join(' · ') || '—'} />
      </div>

      <SubHeading style={{ marginTop: 28 }}>Across the Collective</SubHeading>
      <p style={mutedNote}>Live business metrics arrive once ShedPro and projects are connected.</p>
      <div style={grid4}>
        {PLACEHOLDER_METRICS.map(m => <MetricCard key={m.label} {...m} />)}
      </div>

      <SubHeading style={{ marginTop: 32, marginBottom: 6 }}>Coming Soon</SubHeading>
      <div style={grid3}>
        {COMING_SOON.map(c => <ComingSoonCard key={c.title} {...c} />)}
      </div>
    </div>
  );
}

// One builder's detail tab.
function BuilderTab({ builder }) {
  const joined = builder.created_at ? new Date(builder.created_at).toLocaleDateString() : '—';
  const details = [
    { label: 'Email',     value: builder.email || '—' },
    { label: 'Market',    value: builder.market || '—' },
    { label: 'Joined',    value: joined },
    { label: 'Sales Tax', value: builder.sales_tax != null ? `${builder.sales_tax}%` : '—' },
  ];
  return (
    <div>
      {/* Builder header */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
        <div style={{ width:48, height:48, borderRadius:'50%', background:C.sage, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:700, flexShrink:0 }}>
          {(builder.full_name || builder.email || '?').trim().charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:600, color:C.charcoal, margin:0, lineHeight:1.1 }}>
            {builder.full_name || builder.email}
          </h2>
          {builder.market && <div style={{ fontFamily:'DM Sans', fontSize:12.5, color:C.sage, marginTop:2 }}>{builder.market}</div>}
        </div>
      </div>

      {/* Profile details we already have */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:28 }} className="usc-grid4">
        {details.map(d => (
          <div key={d.label} style={{ background:C.paper, border:`1px solid ${C.linenDarker}`, borderRadius:8, padding:'14px 16px' }}>
            <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#aaa', marginBottom:4 }}>{d.label}</div>
            <div style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:C.charcoal, wordBreak:'break-word' }}>{d.value}</div>
          </div>
        ))}
      </div>

      <SubHeading>Performance</SubHeading>
      <p style={mutedNote}>This builder's live numbers arrive once ShedPro and projects are connected.</p>
      <div style={grid4}>
        {PLACEHOLDER_METRICS.map(m => <MetricCard key={m.label} {...m} />)}
      </div>
    </div>
  );
}

// ── Small presentational pieces ───────────────────────────────────────────────
function WelcomeBanner({ kicker, title, sub }) {
  return (
    <div style={{ background:`linear-gradient(135deg, ${C.charcoal} 0%, #2C2115 100%)`, borderRadius:10, padding:'32px 36px', marginBottom:28, color:'#fff' }}>
      <div style={{ fontFamily:'DM Sans', fontSize:13, color:C.sand, letterSpacing:'0.04em', marginBottom:6 }}>{kicker}</div>
      <h1 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:34, fontWeight:700, margin:'0 0 8px', lineHeight:1.1 }}>{title}</h1>
      <p style={{ fontFamily:'DM Sans', fontSize:14, color:'rgba(255,255,255,0.7)', margin:0, lineHeight:1.6, maxWidth:560 }}>{sub}</p>
    </div>
  );
}

function SubHeading({ children, style = {} }) {
  return <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:22, fontWeight:600, color:C.charcoal, margin:'0 0 14px', ...style }}>{children}</h2>;
}

function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, padding:'10px 18px', border:'none', cursor:'pointer', background:'transparent', whiteSpace:'nowrap', color:active?C.sage:'#aaa', borderBottom:active?`2px solid ${C.sage}`:'2px solid transparent', marginBottom:-2, transition:'all 0.15s' }}>
      {label}
    </button>
  );
}

function QuickLinkCard({ icon, title, desc, to }) {
  return (
    <Link to={to} style={{ display:'flex', alignItems:'flex-start', gap:14, textDecoration:'none', background:C.paper, border:`1px solid ${C.linenDarker}`, borderRadius:8, padding:'20px 22px', transition:'all 0.15s' }}>
      <span style={{ fontSize:26, lineHeight:1, flexShrink:0 }}>{icon}</span>
      <div>
        <div style={{ fontFamily:'DM Sans', fontSize:15, fontWeight:600, color:C.charcoal, marginBottom:4 }}>{title}</div>
        <div style={{ fontFamily:'DM Sans', fontSize:12.5, color:'#888', lineHeight:1.5 }}>{desc}</div>
      </div>
    </Link>
  );
}

function ComingSoonCard({ icon, title, desc }) {
  return (
    <div style={{ background:C.linen, border:`1px dashed ${C.linenDarker}`, borderRadius:8, padding:'18px 20px', opacity:0.85 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <span style={{ fontSize:20, lineHeight:1 }}>{icon}</span>
        <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:600, color:C.sand, background:'#fff', border:`1px solid ${C.linenDarker}`, borderRadius:9999, padding:'2px 8px' }}>Soon</span>
      </div>
      <div style={{ fontFamily:'DM Sans', fontSize:14, fontWeight:600, color:C.charcoal, marginBottom:4 }}>{title}</div>
      <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#999', lineHeight:1.5 }}>{desc}</div>
    </div>
  );
}

// Stat with a real value we already have.
function StatCard({ icon, label, value, sub }) {
  return (
    <div style={{ background:C.paper, border:`1px solid ${C.linenDarker}`, borderRadius:8, padding:'18px 22px', display:'flex', alignItems:'center', gap:16 }}>
      <span style={{ fontSize:28, lineHeight:1, flexShrink:0 }}>{icon}</span>
      <div>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:30, fontWeight:700, color:C.charcoal, lineHeight:1 }}>{value}</div>
        <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', marginTop:3 }}>{label}{sub ? ` · ${sub}` : ''}</div>
      </div>
    </div>
  );
}

// Placeholder metric (no data source yet).
function MetricCard({ icon, label }) {
  return (
    <div style={{ background:C.linen, border:`1px dashed ${C.linenDarker}`, borderRadius:8, padding:'16px 18px', opacity:0.85 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:16, lineHeight:1 }}>{icon}</span>
        <span style={{ fontFamily:'DM Sans', fontSize:11.5, fontWeight:600, color:'#999' }}>{label}</span>
      </div>
      <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:700, color:'#bbb', lineHeight:1 }}>—</div>
      <div style={{ fontFamily:'DM Sans', fontSize:10.5, color:'#bbb', marginTop:3 }}>Coming soon</div>
    </div>
  );
}

function tabName(b) {
  const name = (b.full_name || '').trim();
  if (name) return name.split(' ')[0]; // first name keeps tabs compact
  return (b.email || 'Builder').split('@')[0];
}

// Shared layout tokens
const grid2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 };
const grid3 = { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 };
const grid4 = { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 };
const mutedNote = { fontFamily:'DM Sans', fontSize:12.5, color:'#999', margin:'0 0 14px' };

// On mobile, collapse the multi-column grids to a single column.
function ResponsiveGridStyle() {
  return (
    <style>{`
      @media (max-width: 768px) {
        div[style*="gridTemplateColumns: '1fr 1fr'"],
        div[style*="gridTemplateColumns: '1fr 1fr 1fr'"],
        div[style*="gridTemplateColumns: '1fr 1fr 1fr 1fr'"],
        .usc-grid4 {
          grid-template-columns: 1fr 1fr !important;
        }
      }
      @media (max-width: 480px) {
        div[style*="gridTemplateColumns: '1fr 1fr'"],
        div[style*="gridTemplateColumns: '1fr 1fr 1fr'"],
        div[style*="gridTemplateColumns: '1fr 1fr 1fr 1fr'"],
        .usc-grid4 {
          grid-template-columns: 1fr !important;
        }
      }
    `}</style>
  );
}
