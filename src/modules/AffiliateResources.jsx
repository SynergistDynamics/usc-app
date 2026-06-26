// src/modules/AffiliateResources.jsx
import { useState, useEffect } from 'react';
import { supabase, C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { Badge, Button } from '../components/UI';
import ReferralRegistration from './ReferralRegistration';

const STATUS_LABELS = {
  registered:      { label:'Registered',       color:'blue' },
  in_conversation: { label:'In Conversation',  color:'sand' },
  signed:          { label:'Signed',           color:'sage' },
  inactive:        { label:'Inactive',         color:'ghost' },
};

function ReferralTable({ referrals, profile, builders = {}, onStatusChange, onDelete }) {
  const isAdmin = profile?.role === 'admin';
  const rows = isAdmin ? referrals : referrals.filter(r => r.referred_by === profile?.id);
  if (!rows.length) return (
    <div style={{ padding:'48px 0', textAlign:'center' }}>
      <div style={{ fontFamily:'DM Sans', fontSize:13, color:'#bbb' }}>No referrals yet. Register your first one to get started.</div>
    </div>
  );
  return (
    <div className="usc-table-scroll" style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, overflow:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ background:'#1A1510' }}>
            {['Name','Email','Market','Registered','Status',...(isAdmin?['Registered By']:[]),''].map(h=>(
              <th key={h} style={{ padding:'9px 14px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.5)', textAlign:'left', whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>{
            const sm = STATUS_LABELS[r.status]||STATUS_LABELS.registered;
            const isOwn = r.referred_by === profile?.id;
            return (
              <tr key={r.id} style={{ borderBottom:`1px solid ${C.linenDarker}`, background:i%2===0?'#FFFDF9':C.linen }}>
                <td style={{ padding:'10px 14px' }}>
                  <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:'#1A1A1A' }}>{r.name}</div>
                  {r.notes&&<div style={{ fontFamily:'DM Sans', fontSize:11, color:'#bbb', fontStyle:'italic', marginTop:2 }}>{r.notes}</div>}
                </td>
                <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:12, color:'#666' }}>{r.email}</td>
                <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:12, color:'#666' }}>{r.market||'—'}</td>
                <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:11, color:'#aaa', whiteSpace:'nowrap' }}>
                  {new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                </td>
                <td style={{ padding:'10px 14px' }}>
                  {isOwn ? (
                    <select value={r.status} onChange={e=>onStatusChange(r.id,e.target.value)}
                      style={{ fontFamily:'DM Sans', fontSize:11, padding:'3px 8px', border:`1px solid ${C.linenDarker}`, borderRadius:3, background:C.linen, color:'#1A1A1A', cursor:'pointer' }}>
                      {Object.entries(STATUS_LABELS).map(([val,{label}])=>(
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  ) : <Badge color={sm.color}>{sm.label}</Badge>}
                </td>
                {isAdmin&&<td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:12, color:'#666' }}>{builders[r.referred_by] || '—'}</td>}
                <td style={{ padding:'10px 14px' }}>
                  {(isOwn || isAdmin) && (
                    <button onClick={()=>onDelete(r.id, r.name)}
                      style={{ background:'transparent', border:`1px solid #FCA5A5`, borderRadius:3, padding:'3px 8px', fontFamily:'DM Sans', fontSize:11, color:'#DC2626', cursor:'pointer' }}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function copyToClipboard(text, setCopied, id) {
  navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(()=>setCopied(null), 2000); });
}

const SHARE_TEMPLATES = [
  { id:'assessment_dm', label:'Assessment invite — text or DM', icon:'💬', text:`Hey [Name] — I've been building under the Urban Sheds Collective brand for a while now and it's been worth it. Before I say more, take 3 minutes on this self-assessment and see if it fits where you are:\n\nhttps://build.urban-sheds.com/assessment\n\nIt'll tell you honestly whether you're the right fit. Happy to talk after.` },
  { id:'program_dm', label:'Program overview — text or DM', icon:'📨', text:`Here's the full breakdown of how the USC licensing program works — territory, what's included, and how builders are using it:\n\nhttps://build.urban-sheds.com/licensing\n\nLet me know what questions you have.` },
  { id:'cold_email', label:'Cold outreach — email', icon:'📧', text:`Subject: A shed building opportunity — worth 3 minutes\n\nHey [Name],\n\nI build under the Urban Sheds Collective brand and thought you might be worth a conversation about it.\n\nThe short version: it's a licensing model for independent builders — you keep your business, use the brand, and get access to pricing tools, a 3D configurator, and territory protection.\n\nStart here if you're curious:\n\n→ Self-assessment (3 min): https://build.urban-sheds.com/assessment\n→ Full program overview: https://build.urban-sheds.com/licensing\n\nHappy to answer questions if it looks interesting.\n\n[Your name]` },
  { id:'follow_up', label:'Follow-up after no response', icon:'🔄', text:`Hey [Name] — just following up on the USC program I sent over. No pressure either way, but if you had a chance to look at it and have questions I'm happy to talk through it.\n\nThe assessment link again if you haven't tried it:\nhttps://build.urban-sheds.com/assessment` },
  { id:'linkedin', label:'LinkedIn post', icon:'💼', text:`If you're a shed builder who's tired of the factory model — this is worth your time.\n\nUrban Sheds Collective is a brand licensing program for independent builders. You keep your business, price your own work, and build in a territory that's yours.\n\nI've been on the platform and it's changed how I operate.\n\nTake the self-assessment and see if it fits:\nhttps://build.urban-sheds.com/assessment` },
];

export default function AffiliateResources() {
  const { profile } = useAuth();
  const [activeTab,    setActiveTab]    = useState('program');
  const [copied,       setCopied]       = useState(null);
  const [expandedMsg,  setExpandedMsg]  = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [referrals,    setReferrals]    = useState([]);
  const [builders,     setBuilders]     = useState({});
  const [isMobile,     setIsMobile]     = useState(typeof window !== 'undefined' && window.innerWidth <= 768);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { if (profile) loadReferrals(); }, [profile]);

  async function loadReferrals() {
    const isAdmin = profile?.role === 'admin';
    let query = supabase.from('referrals').select('*').order('created_at', { ascending:false });
    if (!isAdmin) query = query.eq('referred_by', profile.id);
    const { data } = await query;
    setReferrals(data || []);
    if (isAdmin && data?.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email');
      if (profiles) {
        const map = {};
        profiles.forEach(p => { map[p.id] = p.full_name || p.email || p.id; });
        setBuilders(map);
      }
    }
  }

  async function updateStatus(id, status) {
    await supabase.from('referrals').update({ status, updated_at:new Date().toISOString() }).eq('id', id);
    loadReferrals();
  }

  async function deleteReferral(id, name) {
    if (!window.confirm(`Delete referral for ${name}? This cannot be undone.`)) return;
    await supabase.from('referrals').delete().eq('id', id);
    loadReferrals();
  }

  const myReferralCount = referrals.filter(r => r.referred_by === profile?.id).length;

  // Tab styles
  function tabStyle(key) {
    const active = activeTab === key;
    return {
      fontFamily:'DM Sans', fontSize:13, fontWeight:600,
      padding: isMobile ? '10px 14px' : '10px 20px', border:'none', cursor:'pointer',
      background:'transparent',
      color: active ? C.sage : '#aaa',
      borderBottom: active ? `2px solid ${C.sage}` : '2px solid transparent',
      marginBottom:-2, transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0,
    };
  }

  return (
    <div style={{ maxWidth:860 }}>

      {/* Header */}
      <div style={{ marginBottom:28, display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 0 }}>
        <div>
          <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.15em', color:C.sage, marginBottom:8 }}>Affiliate Resources</div>
          <h1 style={{ fontFamily:'Cormorant Garamond, serif', fontSize: isMobile ? 28 : 36, fontWeight:700, color:'#1A1A1A', margin:'0 0 10px', lineHeight:1.1 }}>Good builders{isMobile ? ' ' : <br/>}know good builders.</h1>
          <p style={{ fontFamily:'DM Sans', fontSize:14, color:'#888', margin:0, maxWidth:520, lineHeight:1.7 }}>
            The USC affiliate program pays you a commission on every shed your referred builders sell — for as long as they're on the platform.
          </p>
        </div>
        <button onClick={()=>setShowRegister(true)} style={{ flexShrink:0, marginLeft: isMobile ? 0 : 24, width: isMobile ? '100%' : 'auto', justifyContent:'center', display:'flex', alignItems:'center', gap:8, padding:'12px 20px', background:C.sage, color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontFamily:'DM Sans', fontSize:14, fontWeight:700, boxShadow:'0 2px 8px rgba(122,155,118,0.35)', transition:'all 0.15s' }}>
          <span style={{ fontSize:16 }}>📋</span> Register a Referral
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:28, borderBottom:`2px solid ${C.linenDarker}`, overflowX: isMobile ? 'auto' : 'visible', overflowY:'hidden' }}>
        <button style={tabStyle('program')} onClick={()=>setActiveTab('program')}>Program</button>
        <button style={tabStyle('resources')} onClick={()=>setActiveTab('resources')}>Recruiting Resources</button>
        <button style={tabStyle('referrals')} onClick={()=>setActiveTab('referrals')}>
          My Referrals {myReferralCount > 0 && (
            <span style={{ marginLeft:6, background:C.sage, color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:11, fontWeight:700 }}>{myReferralCount}</span>
          )}
        </button>
      </div>

      {/* ── PROGRAM TAB ── */}
      {activeTab === 'program' && (
        <div>
          <div style={{ marginBottom:40 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#aaa', marginBottom:16 }}>How the program works</div>
            <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:8, overflow:'hidden', marginBottom:16 }}>
              <div style={{ background:'#1A1510', padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 4 : 0 }}>
                <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:'#fff' }}>What you earn</div>
                <div style={{ fontFamily:'DM Sans', fontSize:11, color:'rgba(255,255,255,0.4)' }}>Based on avg. $12K job · 3 jobs/mo per builder</div>
              </div>
              <div className="usc-table-scroll" style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth: isMobile ? 440 : 'auto' }}>
                <thead>
                  <tr style={{ background:C.linen }}>
                    {['Referred Builders','Monthly','Annual','Rate'].map(h=>(
                      <th key={h} style={{ padding:'8px 16px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#aaa', textAlign:h==='Referred Builders'?'left':'right', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[['1 builder','$540','$6,480','1.5%',false],['3 builders','$1,620','$19,440','1.5%',false],['5 builders','$2,700','$32,400','1.5%',false],['6+ builders','$4,320+','$51,840+','2.0%',true],['10 builders','$7,200','$86,400','2.0%',true]].map(([b,m,a,r,tier2])=>(
                    <tr key={b} style={{ borderBottom:`1px solid ${C.linenDarker}`, background:tier2?'#EFF6EE':'#FFFDF9' }}>
                      <td style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:13, fontWeight:tier2?700:400, color:'#1A1A1A', whiteSpace:'nowrap' }}>{b}{tier2&&<span style={{ marginLeft:8, fontFamily:'DM Sans', fontSize:10, background:C.sage, color:'#fff', padding:'2px 6px', borderRadius:3, fontWeight:700 }}>TIER 2</span>}</td>
                      <td style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:13, textAlign:'right', color:'#666', whiteSpace:'nowrap' }}>{m}</td>
                      <td style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:13, fontWeight:700, textAlign:'right', color:tier2?C.sage:'#1A1A1A', whiteSpace:'nowrap' }}>{a}</td>
                      <td style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:13, fontWeight:700, textAlign:'right', color:tier2?C.sage:'#888', whiteSpace:'nowrap' }}>{r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div style={{ padding:'10px 16px', fontFamily:'DM Sans', fontSize:11, color:'#bbb', fontStyle:'italic', borderTop:`1px solid ${C.linenDarker}` }}>Drawn from USC's 10% IP fee — no extra cost to referred builders. Paid automatically via Stripe per transaction.</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap:12, marginBottom:16 }}>
              {[{icon:'✓',label:'To qualify',text:'Active BLA for 12+ consecutive months, in good standing'},{icon:'📋',label:'Register first',text:"Referral must be registered before the new builder signs — unregistered referrals don't count"},{icon:'💳',label:'When it starts',text:'First confirmed sale by the referred builder triggers your earnings'}].map(item=>(
                <div key={item.label} style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, padding:'14px 16px' }}>
                  <div style={{ fontFamily:'DM Sans', fontSize:18, marginBottom:8 }}>{item.icon}</div>
                  <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:C.sage, marginBottom:6 }}>{item.label}</div>
                  <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', lineHeight:1.6 }}>{item.text}</div>
                </div>
              ))}
            </div>
            <div style={{ background:'#EFF6EE', border:`1px solid ${C.sage}`, borderRadius:6, padding:'14px 20px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:28, fontWeight:700, color:C.sage, flexShrink:0 }}>6</div>
              <div>
                <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:700, color:'#1A1A1A', marginBottom:2 }}>Tier 2 unlocks at 6 active referred builders</div>
                <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#888' }}>Rate jumps to 2% across all active referred builders — retroactively. Reverts if active count drops below 6.</div>
              </div>
              <a href="https://build.urban-sheds.com/affiliate-program" target="_blank" rel="noreferrer" style={{ flexShrink:0, fontFamily:'DM Sans', fontSize:12, fontWeight:600, color:C.sage, textDecoration:'none', whiteSpace:'nowrap' }}>Full program details ↗</a>
            </div>
          </div>
          <div style={{ padding:'16px 20px', background:C.linen, borderRadius:6, display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:18 }}>💡</span>
            <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', margin:0, lineHeight:1.6 }}>
              <strong style={{ color:'#1A1A1A' }}>Register the referral first.</strong> Before you introduce a builder to USC, register them here. Unregistered referrals don't qualify for commission — no matter how the conversation started.
            </p>
          </div>
        </div>
      )}

      {/* ── RECRUITING RESOURCES TAB ── */}
      {activeTab === 'resources' && (
        <div>
          <div style={{ marginBottom:40 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#aaa', marginBottom:16 }}>Recruiting resources — send these to potential builders</div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
              {[{id:'assessment',category:'STEP 1 — QUALIFY THEM',title:'Builder Self-Assessment',description:"19 questions across 5 categories. Takes 3 minutes. Tells a potential builder honestly whether they're the right fit.",url:'https://build.urban-sheds.com/assessment',cta:'Open Assessment',icon:'📋',color:C.sage},{id:'licensing',category:'STEP 2 — CLOSE THEM',title:'Licensing Program Overview',description:"The full pitch — territory, what's included, pricing, and what sets USC apart. Send this once they've passed the assessment.",url:'https://build.urban-sheds.com/licensing',cta:'Open Program Overview',icon:'📄',color:'#1A1A1A'}].map(r=>(
                <div key={r.id} style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:8, overflow:'hidden' }}>
                  <div style={{ padding:'20px 20px 16px' }}>
                    <div style={{ fontFamily:'DM Sans', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.15em', color:r.color, marginBottom:10, opacity:0.8 }}>{r.category}</div>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                      <span style={{ fontSize:20, lineHeight:1, flexShrink:0 }}>{r.icon}</span>
                      <h3 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:20, fontWeight:600, color:'#1A1A1A', margin:0, lineHeight:1.2 }}>{r.title}</h3>
                    </div>
                    <p style={{ fontFamily:'DM Sans', fontSize:12, color:'#888', lineHeight:1.65, margin:0 }}>{r.description}</p>
                  </div>
                  <div style={{ padding:'0 20px 20px', display:'flex', gap:8 }}>
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ flex:1, display:'block', textAlign:'center', padding:'9px 0', background:r.color, color:'#fff', borderRadius:4, fontFamily:'DM Sans', fontSize:12, fontWeight:600, textDecoration:'none' }}>{r.cta} ↗</a>
                    <button onClick={()=>copyToClipboard(r.url,setCopied,r.id)} style={{ flex:1, textAlign:'center', padding:'8px 0', background:'transparent', border:`1px solid ${C.linenDarker}`, color:copied===r.id?C.sage:'#aaa', borderRadius:4, fontFamily:'DM Sans', fontSize:11, fontWeight:600, cursor:'pointer' }}>{copied===r.id?'✓ Copied!':'⧉ Copy link'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:40 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#aaa', marginBottom:16 }}>Ready-to-send messages</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {SHARE_TEMPLATES.map(t=>(
                <div key={t.id} style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, overflow:'hidden' }}>
                  <div onClick={()=>setExpandedMsg(expandedMsg===t.id?null:t.id)} style={{ display:'flex', alignItems:'center', gap:10, padding:'13px 18px', cursor:'pointer', userSelect:'none' }}>
                    <span style={{ fontSize:16 }}>{t.icon}</span>
                    <span style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:'#1A1A1A', flex:1 }}>{t.label}</span>
                    <span style={{ fontFamily:'DM Sans', fontSize:11, color:'#aaa' }}>{expandedMsg===t.id?'▲':'▼'}</span>
                  </div>
                  {expandedMsg===t.id&&(
                    <div style={{ borderTop:`1px solid ${C.linen}`, padding:'14px 18px' }}>
                      <pre style={{ fontFamily:'DM Sans', fontSize:12, color:'#666', lineHeight:1.7, whiteSpace:'pre-wrap', margin:'0 0 12px', background:C.linen, padding:'12px 14px', borderRadius:4 }}>{t.text}</pre>
                      <button onClick={()=>copyToClipboard(t.text,setCopied,t.id)} style={{ padding:'7px 16px', background:copied===t.id?C.sage:'transparent', color:copied===t.id?'#fff':C.sage, border:`1.5px solid ${C.sage}`, borderRadius:4, fontFamily:'DM Sans', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                        {copied===t.id?'✓ Copied!':'⧉ Copy message'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REFERRALS TAB ── */}
      {activeTab === 'referrals' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
            <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#aaa' }}>
              {profile?.role === 'admin' ? `All Referrals (${referrals.length})` : `My Referrals (${myReferralCount})`}
            </div>
            <button onClick={()=>setShowRegister(true)} style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:C.sage, color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontFamily:'DM Sans', fontSize:13, fontWeight:600 }}>
              + Register New
            </button>
          </div>
          <ReferralTable referrals={referrals} profile={profile} builders={builders} onStatusChange={updateStatus} onDelete={deleteReferral} />
        </div>
      )}

      {/* Register modal */}
      {showRegister&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}
          onClick={e=>{if(e.target===e.currentTarget)setShowRegister(false);}}>
          <div style={{ background:'#fff', borderRadius:8, padding: isMobile ? 20 : 32, width:'100%', maxWidth:560, maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h3 style={{ fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:600, color:'#1A1A1A', margin:0 }}>Register a Referral</h3>
              <button onClick={()=>setShowRegister(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:'#999', lineHeight:1 }}>×</button>
            </div>
            <ReferralRegistration onSuccess={()=>{ setShowRegister(false); loadReferrals(); setActiveTab('referrals'); }} />
          </div>
        </div>
      )}
    </div>
  );
}
