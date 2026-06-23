// src/modules/ReferralRegistration.jsx
import { useState, useEffect } from 'react';
import { supabase, C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import { Button, Input, FormField, ErrorBanner, SuccessBanner, Badge } from '../components/UI';

const STATUS_LABELS = {
  registered:      { label:'Registered',       color:'blue' },
  in_conversation: { label:'In Conversation',  color:'sand' },
  signed:          { label:'Signed',           color:'sage' },
  inactive:        { label:'Inactive',         color:'ghost' },
};

export default function ReferralRegistration({ onSuccess }) {
  const { profile } = useAuth();
  const [form,    setForm]    = useState({ name:'', email:'', phone:'', market:'', notes:'' });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit() {
    if (!form.name.trim() || !form.email.trim()) { setError('Name and email are required.'); return; }
    setSaving(true); setError(''); setSuccess('');

    // referrals has strict RLS (you can only read your OWN rows), so we can't directly
    // query across builders to detect a duplicate. The referral_email_taken() SECURITY
    // DEFINER function does that check server-side and returns only minimal info
    // (when + who) without exposing the other builder's row. See MIGRATION_referrals_rls.sql.
    const { data: existing } = await supabase
      .rpc('referral_email_taken', { p_email: form.email.trim() })
      .maybeSingle();

    if (existing) {
      const who  = existing.builder_name || 'another builder';
      const date = new Date(existing.created_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
      setError(`${form.email.trim()} was already registered on ${date} by ${who}.`);
      setSaving(false); return;
    }

    const { error: e } = await supabase.from('referrals').insert({
      referred_by: profile.id,
      name:   form.name.trim(),
      email:  form.email.trim().toLowerCase(),
      phone:  form.phone.trim() || null,
      market: form.market.trim() || null,
      notes:  form.notes.trim() || null,
    });

    if (e) { setError(e.message); setSaving(false); return; }

    setSuccess(`${form.name.trim()} registered. Your referral is on record as of ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}.`);
    setForm({ name:'', email:'', phone:'', market:'', notes:'' });
    setSaving(false);
    if (onSuccess) setTimeout(() => onSuccess(), 1800);
  }

  return (
    <div>
      <p style={{ fontFamily:'DM Sans', fontSize:13, color:'#888', margin:'0 0 20px', lineHeight:1.6 }}>
        Register a potential builder before they sign. This timestamps your referral and protects your commission.
      </p>

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <FormField label="Full name *"><Input value={form.name}   onChange={v=>setForm(p=>({...p,name:v}))}   placeholder="Dave Yoder" /></FormField>
        <FormField label="Email *">    <Input type="email" value={form.email}  onChange={v=>setForm(p=>({...p,email:v}))}  placeholder="dave@example.com" /></FormField>
        <FormField label="Phone">      <Input value={form.phone}  onChange={v=>setForm(p=>({...p,phone:v}))}  placeholder="555-000-0000" /></FormField>
        <FormField label="Market">     <Input value={form.market} onChange={v=>setForm(p=>({...p,market:v}))} placeholder="Houston, TX" /></FormField>
      </div>
      <FormField label="Notes (optional)">
        <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}
          placeholder="How you know them, where they are in the conversation..."
          rows={2} style={{ width:'100%', padding:'8px 12px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, fontFamily:'DM Sans', fontSize:14, background:'#FFFDF9', color:'#1A1A1A', resize:'vertical', boxSizing:'border-box' }} />
      </FormField>
      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:8 }}>
        <Button onClick={handleSubmit} loading={saving} disabled={!form.name.trim()||!form.email.trim()}>Register Referral</Button>
      </div>
    </div>
  );
}

export function ReferralTable({ referrals, profile, onStatusChange }) {
  const isAdmin = profile?.role === 'admin';
  const rows = isAdmin ? referrals : referrals.filter(r => r.referred_by === profile?.id);
  if (!rows.length) return null;

  return (
    <div style={{ marginTop:40 }}>
      <div style={{ fontFamily:'DM Sans', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#aaa', marginBottom:12 }}>
        {isAdmin ? `All Referrals (${rows.length})` : `My Referrals (${rows.length})`}
      </div>
      <div style={{ background:'#FFFDF9', border:`1px solid ${C.linenDarker}`, borderRadius:6, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#1A1510' }}>
              {['Name','Email','Market','Registered','Status',...(isAdmin?['Registered By']:[])].map(h=>(
                <th key={h} style={{ padding:'9px 14px', fontFamily:'DM Sans', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.5)', textAlign:'left', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r,i)=>{
              const sm = STATUS_LABELS[r.status] || STATUS_LABELS.registered;
              const isOwn = r.referred_by === profile?.id;
              return (
                <tr key={r.id} style={{ borderBottom:`1px solid ${C.linenDarker}`, background:i%2===0?'#FFFDF9':C.linen }}>
                  <td style={{ padding:'10px 14px' }}>
                    <div style={{ fontFamily:'DM Sans', fontSize:13, fontWeight:600, color:'#1A1A1A' }}>{r.name}</div>
                    {r.notes && <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#bbb', fontStyle:'italic', marginTop:2 }}>{r.notes}</div>}
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
                  {isAdmin && (
                    <td style={{ padding:'10px 14px', fontFamily:'DM Sans', fontSize:12, color:'#666' }}>
                      {r.profiles?.full_name || r.profiles?.email || '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
