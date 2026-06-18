// src/modules/Financing.jsx
import { useState } from 'react';
import { C } from '../lib/supabase';
import { SectionHeader } from '../components/UI';

const OPTIONS = [
  {
    name: 'HFS Financial',
    tagline: 'Home Improvement Loans for Sheds, Man Caves & She Sheds',
    description: 'HFS Financial offers unsecured home improvement loans with fixed rates, no collateral required, and funding in as little as 24 hours. Loan amounts from $1,000 to $100,000 with terms up to 15 years.',
    highlights: ['No equity or collateral required', 'Fixed monthly payments', 'Funding in 24 hours', 'Loans up to $100,000'],
    url: 'https://www.hfsfinancial.net/home-improvement-loans/man-caves-loans-she-sheds-loans/',
    icon: '🏦',
  },
  {
    name: 'Upgrade',
    tagline: 'Personal Home Improvement Loans',
    description: 'Upgrade offers fixed-rate personal loans for home improvement projects. Apply online, check rates without affecting your credit score, and get funds deposited directly to your account.',
    highlights: ['Check rates without credit impact', 'Fixed rates & payments', 'Direct deposit to your account', 'Fast online application'],
    url: 'https://www.upgrade.com/personal-loans/home-improvement/',
    icon: '💳',
  },
];

function copyToClipboard(text, setCopied, id) {
  navigator.clipboard.writeText(text).then(() => {
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  });
}

export default function Financing() {
  const [copied, setCopied] = useState(null);

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionHeader sub="Share these financing options with your customers to help them fund their shed project.">
        Financing Options
      </SectionHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {OPTIONS.map(opt => (
          <div key={opt.name} style={{ background: '#FFFDF9', border: `1px solid ${C.linenDarker}`, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '24px 24px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{opt.icon}</span>
                <div>
                  <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: '#1A1A1A', margin: '0 0 4px', lineHeight: 1.2 }}>{opt.name}</h3>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, color: C.sage, letterSpacing: '0.02em' }}>{opt.tagline}</div>
                </div>
              </div>
              <p style={{ fontFamily: 'DM Sans', fontSize: 13, color: '#888', lineHeight: 1.7, margin: '0 0 16px' }}>{opt.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {opt.highlights.map(h => (
                  <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.sage, fontSize: 13, flexShrink: 0 }}>✓</span>
                    <span style={{ fontFamily: 'DM Sans', fontSize: 12, color: '#666' }}>{h}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '0 24px 24px', marginTop: 'auto', display: 'flex', gap: 8 }}>
              <a href={opt.url} target="_blank" rel="noreferrer"
                style={{ flex: 1, display: 'block', textAlign: 'center', padding: '10px 0', background: C.sage, color: '#fff', borderRadius: 5, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Open Website ↗
              </a>
              <button onClick={() => copyToClipboard(opt.url, setCopied, opt.name)}
                style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: 'transparent', border: `1.5px solid ${C.linenDarker}`, color: copied === opt.name ? C.sage : '#aaa', borderRadius: 5, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
                {copied === opt.name ? '✓ Link Copied!' : '⧉ Copy Link'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: '16px 20px', background: C.linen, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 18 }}>💡</span>
        <p style={{ fontFamily: 'DM Sans', fontSize: 12, color: '#888', margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: '#1A1A1A' }}>Tip:</strong> Copy the link and text it directly to your customer so they can apply on their own time. Financing removes the price objection and gets projects started faster.
        </p>
      </div>

      <style>{`
        @media (max-width: 768px) {
          div[style*="gridTemplateColumns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
