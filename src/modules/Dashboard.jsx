// src/modules/Dashboard.jsx
// Builder dashboard — the landing page each builder sees after login.
// For now it's a simple welcome + quick-links shell (ARCHITECTURE.md build sequence, step 2).
// It will grow once ShedPro and projects are connected (see "Coming soon" section below).
import { Link } from 'react-router-dom';
import { C } from '../lib/supabase';
import { useAuth } from '../components/Auth';

// Time-of-day greeting so the welcome feels alive without any extra data.
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Quick links into the tools that already exist. `adminOnly` hides admin-only routes.
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

export default function Dashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const firstName = (profile?.full_name || '').trim().split(' ')[0];
  const links = QUICK_LINKS.filter(l => !l.adminOnly || isAdmin);

  return (
    <div style={{ maxWidth: 980 }}>
      {/* ── Welcome banner ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.charcoal} 0%, #2C2115 100%)`,
        borderRadius: 10, padding: '32px 36px', marginBottom: 28, color: '#fff',
      }}>
        <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.sand, letterSpacing: '0.04em', marginBottom: 6 }}>
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </div>
        <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 34, fontWeight: 700, margin: '0 0 8px', lineHeight: 1.1 }}>
          Welcome to Urban Sheds Collective
        </h1>
        <p style={{ fontFamily: 'DM Sans', fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.6, maxWidth: 560 }}>
          Your home base for pricing, materials, and the tools you need to run your shed business.
          {profile?.market ? ` Building in ${profile.market}.` : ''}
        </p>
      </div>

      {/* ── Quick links ── */}
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: C.charcoal, margin: '0 0 14px' }}>
        Quick Access
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
        {links.map(l => (
          <Link key={l.to} to={l.to} style={{
            display: 'flex', alignItems: 'flex-start', gap: 14, textDecoration: 'none',
            background: C.paper, border: `1px solid ${C.linenDarker}`, borderRadius: 8,
            padding: '20px 22px', transition: 'all 0.15s',
          }}>
            <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{l.icon}</span>
            <div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 15, fontWeight: 600, color: C.charcoal, marginBottom: 4 }}>{l.title}</div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: '#888', lineHeight: 1.5 }}>{l.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Coming soon ── */}
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: C.charcoal, margin: '0 0 6px' }}>
        Coming Soon
      </h2>
      <p style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: '#999', margin: '0 0 14px' }}>
        We're building out the full platform piece by piece. Here's what's next.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {COMING_SOON.map(c => (
          <div key={c.title} style={{
            background: C.linen, border: `1px dashed ${C.linenDarker}`, borderRadius: 8,
            padding: '18px 20px', opacity: 0.85,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{c.icon}</span>
              <span style={{ fontFamily: 'DM Sans', fontSize: 11, fontWeight: 600, color: C.sand, background: '#fff', border: `1px solid ${C.linenDarker}`, borderRadius: 9999, padding: '2px 8px' }}>Soon</span>
            </div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 14, fontWeight: 600, color: C.charcoal, marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: '#999', lineHeight: 1.5 }}>{c.desc}</div>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 768px) {
          div[style*="gridTemplateColumns: '1fr 1fr'"],
          div[style*="gridTemplateColumns: '1fr 1fr 1fr'"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
