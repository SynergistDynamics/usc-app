// src/modules/Blueprints.jsx
import { useState, useEffect } from 'react';
import { C } from '../lib/supabase';
import { SectionHeader } from '../components/UI';

const BLUEPRINTS = [
  { size:'8x12',  style:'Modern',           url:'https://drive.google.com/file/d/1dy6MzSBmNOkQ6BrxhY8DJKQw7xlEevs8/view?usp=drive_link' },
  { size:'8x12',  style:'Tall Modern',      url:'https://drive.google.com/file/d/1RCQEkvcQSbKAZg6B_7PDDiFz-nD_mjdI/view?usp=drive_link' },
  { size:'8x12',  style:'Traditional',      url:'https://drive.google.com/file/d/1ud66-mqo8k5OpLO0OFyCqHTfrePCmaZB/view?usp=drive_link' },
  { size:'8x12',  style:'Tall Traditional', url:'https://drive.google.com/file/d/1v9QkU7P7Nse89M_lSJB-pykFezeV6Vms/view?usp=drive_link' },
  { size:'10x12', style:'Modern',           url:'https://drive.google.com/file/d/1g5Z2_84FfYid-glgWiLxk19VUIlq-0SM/view?usp=drive_link' },
  { size:'10x12', style:'Tall Modern',      url:'https://drive.google.com/file/d/1rhNurVkCkO2_YPA8LI9NTeOy6fnm6eVL/view?usp=drive_link' },
  { size:'10x12', style:'Traditional',      url:'https://drive.google.com/file/d/1nDKJLF-ZOwk1wQIx0SCL9ea3W82nKlDi/view?usp=drive_link' },
  { size:'10x12', style:'Tall Traditional', url:'https://drive.google.com/file/d/1nDsyItFeBkNmGdSaPKYUYmIvnnSYBPx3/view?usp=drive_link' },
  { size:'12x16', style:'Modern',           url:'https://drive.google.com/file/d/1S8IO0CcNjLG4g46diLBbCtFKqvyDYU3N/view?usp=drive_link' },
  { size:'12x16', style:'Tall Modern',      url:'https://drive.google.com/file/d/1gj3j_b2oL8v5w5fW7Zr2z8UbgBYN6rFH/view?usp=drive_link' },
  { size:'12x16', style:'Traditional',      url:'https://drive.google.com/file/d/1Tf3cPQriayjSoa6MfCV33flD_8vKh3QL/view?usp=drive_link' },
  { size:'12x16', style:'Tall Traditional', url:'https://drive.google.com/file/d/1732bD49Q-ToxFdpDiN9vQ0zWov5NC8Cb/view?usp=drive_link' },
];

const SIZE_GROUPS = ['8x12', '10x12', '12x16'];

const STYLE_META = {
  'Modern':           { icon:'◼', color: C.charcoal,  light: '#F0F0F0' },
  'Tall Modern':      { icon:'◼', color: C.charcoal,  light: '#F0F0F0' },
  'Traditional':      { icon:'⌂', color: C.sage,      light: '#EFF6EE' },
  'Tall Traditional': { icon:'⌂', color: C.sage,      light: '#EFF6EE' },
};

export default function Blueprints() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionHeader sub="12 plan sets available. Click any blueprint to open or download from Google Drive.">
        Blueprints
      </SectionHeader>

      {SIZE_GROUPS.map(size => {
        const plans = BLUEPRINTS.filter(b => b.size === size);
        return (
          <div key={size} style={{ marginBottom: 32 }}>
            {/* Size header */}
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
              <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:26, fontWeight:700, color:C.charcoal, lineHeight:1 }}>
                {size}
              </div>
              <div style={{ flex:1, height:1, background:C.linenDarker }} />
              <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#aaa', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em' }}>
                {plans.length} plans
              </div>
            </div>

            {/* Plan cards */}
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap:10 }}>
              {plans.map(bp => {
                const meta = STYLE_META[bp.style] || STYLE_META['Modern'];
                const isTall = bp.style.startsWith('Tall');
                return (
                  <a key={bp.style} href={bp.url} target="_blank" rel="noreferrer"
                    style={{ textDecoration:'none', display:'flex', flexDirection:'column', background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, overflow:'hidden', transition:'all 0.15s', cursor:'pointer' }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = meta.color; e.currentTarget.style.boxShadow = `0 2px 12px rgba(0,0,0,0.08)`; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = C.linenDarker; e.currentTarget.style.boxShadow = 'none'; }}>

                    {/* Blueprint visual */}
                    <div style={{ background: meta.light, padding:'20px 16px 14px', display:'flex', flexDirection:'column', alignItems:'center', gap:8, borderBottom:`1px solid ${C.linenDarker}` }}>
                      {/* Shed silhouette SVG */}
                      <svg width="72" height={isTall ? 56 : 46} viewBox={`0 0 72 ${isTall ? 56 : 46}`} fill="none">
                        {bp.style.includes('Modern') ? (
                          // Modern — single slope (mono-pitch) roof
                          isTall ? (
                            <>
                              <rect x="6" y="20" width="60" height="30" fill={meta.color} opacity="0.15" stroke={meta.color} strokeWidth="1.5" rx="1"/>
                              <polygon points="6,6 66,20 66,20 6,20" fill={meta.color} opacity="0.25" stroke={meta.color} strokeWidth="1.5" strokeLinejoin="round"/>
                              <rect x="28" y="32" width="16" height="18" fill={meta.color} opacity="0.3" stroke={meta.color} strokeWidth="1"/>
                            </>
                          ) : (
                            <>
                              <rect x="6" y="18" width="60" height="24" fill={meta.color} opacity="0.15" stroke={meta.color} strokeWidth="1.5" rx="1"/>
                              <polygon points="6,10 66,18 66,18 6,18" fill={meta.color} opacity="0.25" stroke={meta.color} strokeWidth="1.5" strokeLinejoin="round"/>
                              <rect x="28" y="28" width="16" height="14" fill={meta.color} opacity="0.3" stroke={meta.color} strokeWidth="1"/>
                            </>
                          )
                        ) : isTall ? (
                          // Tall Traditional — gable roof
                          <>
                            <rect x="6" y="22" width="60" height="28" fill={meta.color} opacity="0.15" stroke={meta.color} strokeWidth="1.5" rx="1"/>
                            <polygon points="6,22 36,4 66,22" fill={meta.color} opacity="0.25" stroke={meta.color} strokeWidth="1.5" strokeLinejoin="round"/>
                            <rect x="28" y="34" width="16" height="16" fill={meta.color} opacity="0.3" stroke={meta.color} strokeWidth="1"/>
                          </>
                        ) : (
                          // Standard Traditional — gable roof
                          <>
                            <rect x="6" y="20" width="60" height="22" fill={meta.color} opacity="0.15" stroke={meta.color} strokeWidth="1.5" rx="1"/>
                            <polygon points="6,20 36,6 66,20" fill={meta.color} opacity="0.25" stroke={meta.color} strokeWidth="1.5" strokeLinejoin="round"/>
                            <rect x="28" y="30" width="16" height="12" fill={meta.color} opacity="0.3" stroke={meta.color} strokeWidth="1"/>
                          </>
                        )}
                      </svg>
                      <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color: meta.color, opacity:0.7 }}>
                        {bp.size}
                      </div>
                    </div>

                    {/* Label + open */}
                    <div style={{ padding:'12px 14px', flex:1, display:'flex', flexDirection:'column', gap:8 }}>
                      <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:C.charcoal, lineHeight:1.3 }}>
                        {bp.style}
                      </div>
                      <div style={{ marginTop:'auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span style={{ fontFamily:'DM Sans', fontSize:10, color:'#aaa', fontWeight:500 }}>Google Drive</span>
                        <span style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, color: meta.color }}>Open ↗</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer note */}
      <div style={{ marginTop:8, padding:'14px 18px', background:C.linen, borderRadius:6, display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:16 }}>📐</span>
        <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', margin:0, lineHeight:1.6 }}>
          All plans are hosted on Google Drive. You'll need to be signed in to a Google account to view or download them.
        </p>
      </div>
    </div>
  );
}
