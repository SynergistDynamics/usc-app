// src/modules/Profile.jsx
// Builder profile page (/profile) — each user edits their OWN profile info and avatar.
//
// What a user can edit: name, business name, phone, market, website, bio, and a profile photo.
// Read-only: email (their login identity) and role (set by an admin). RLS ("Users can update own
// profile", auth.uid() = id) is what actually scopes writes — the UI just never exposes role.
//
// Avatars live in the public `avatars` storage bucket under a {user_id}/ folder; storage RLS lets a
// user write only inside their own folder (see MIGRATION_profile_fields_and_avatars.sql).
import { useState, useRef } from 'react';
import { supabase, C } from '../lib/supabase';
import { useAuth } from '../components/Auth';
import {
  Card, SectionHeader, Button, Badge, Input, FormField, Label,
  ErrorBanner, SuccessBanner, Spinner,
} from '../components/UI';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

export default function Profile() {
  const { profile, reloadProfile } = useAuth();
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    full_name:    profile?.full_name    || '',
    company_name: profile?.company_name || '',
    phone:        profile?.phone        || '',
    market:       profile?.market       || '',
    website:      profile?.website      || '',
    bio:          profile?.bio          || '',
  });
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const initial = (profile?.full_name || profile?.email || '?').trim().charAt(0).toUpperCase();
  const joined  = profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—';

  async function saveProfile() {
    setSaving(true); setError(''); setSuccess('');
    const { error: e } = await supabase
      .from('profiles')
      .update({
        full_name:    form.full_name.trim()    || null,
        company_name: form.company_name.trim() || null,
        phone:        form.phone.trim()        || null,
        market:       form.market.trim()       || null,
        website:      form.website.trim()      || null,
        bio:          form.bio.trim()          || null,
      })
      .eq('id', profile.id);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSuccess('Profile saved.');
    reloadProfile?.();
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    setError(''); setSuccess('');

    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (file.size > MAX_AVATAR_BYTES)    { setError('Image is too large (max 5 MB).'); return; }

    setUploading(true);
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${profile.id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { cacheControl: '3600', upsert: true });
    if (upErr) { setUploading(false); setError(upErr.message); return; }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = pub?.publicUrl;

    const { error: dbErr } = await supabase
      .from('profiles').update({ avatar_url: url }).eq('id', profile.id);
    setUploading(false);
    if (dbErr) { setError(dbErr.message); return; }
    setSuccess('Profile photo updated.');
    reloadProfile?.();
  }

  async function removePhoto() {
    setError(''); setSuccess('');
    setUploading(true);
    const { error: e } = await supabase
      .from('profiles').update({ avatar_url: null }).eq('id', profile.id);
    setUploading(false);
    if (e) { setError(e.message); return; }
    setSuccess('Profile photo removed.');
    reloadProfile?.();
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <SectionHeader sub="Update your details and profile photo. These are yours — only you can edit them.">
        My Profile
      </SectionHeader>

      {error   && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}
      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* ── Avatar + identity ── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:20, flexWrap:'wrap' }}>
          <div style={{ position:'relative', flexShrink:0 }}>
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url} alt="Profile"
                style={{ width:88, height:88, borderRadius:'50%', objectFit:'cover', border:`2px solid ${C.linenDarker}` }}
              />
            ) : (
              <div style={{ width:88, height:88, borderRadius:'50%', background:C.sage, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Cormorant Garamond, serif', fontSize:38, fontWeight:700 }}>
                {initial}
              </div>
            )}
            {uploading && (
              <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Spinner size={22} />
              </div>
            )}
          </div>

          <div style={{ minWidth:180 }}>
            <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:24, fontWeight:600, color:C.charcoal, lineHeight:1.1 }}>
              {profile?.full_name || profile?.email}
            </div>
            <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <Badge color={profile?.role === 'admin' ? 'blue' : 'sage'}>{profile?.role}</Badge>
              {profile?.is_super_admin && <Badge color="sand">Super admin</Badge>}
            </div>
            <div style={{ display:'flex', gap:10, marginTop:14, flexWrap:'wrap' }}>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display:'none' }} />
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {profile?.avatar_url ? 'Change photo' : 'Upload photo'}
              </Button>
              {profile?.avatar_url && (
                <Button size="sm" variant="ghost" onClick={removePhoto} disabled={uploading}>Remove</Button>
              )}
            </div>
            <div style={{ fontFamily:'DM Sans', fontSize:11, color:'#aaa', marginTop:8 }}>JPG or PNG, up to 5 MB.</div>
          </div>
        </div>
      </Card>

      {/* ── Editable details ── */}
      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }} className="usc-profile-grid">
          <FormField label="Your name" style={{ marginBottom:0 }}>
            <Input value={form.full_name} onChange={v => set('full_name', v)} placeholder="Dave Yoder" />
          </FormField>
          <FormField label="Business name" style={{ marginBottom:0 }}>
            <Input value={form.company_name} onChange={v => set('company_name', v)} placeholder="Yoder Sheds LLC" />
          </FormField>
          <FormField label="Phone" style={{ marginBottom:0 }}>
            <Input type="tel" value={form.phone} onChange={v => set('phone', v)} placeholder="(555) 123-4567" />
          </FormField>
          <FormField label="Market / Location" style={{ marginBottom:0 }}>
            <Input value={form.market} onChange={v => set('market', v)} placeholder="Houston, TX" />
          </FormField>
          <FormField label="Website" style={{ marginBottom:0 }}>
            <Input value={form.website} onChange={v => set('website', v)} placeholder="https://yoursite.com" />
          </FormField>
          <FormField label="Email" style={{ marginBottom:0 }}>
            <Input value={profile?.email || ''} onChange={() => {}} disabled />
          </FormField>
        </div>

        <div style={{ marginTop:16 }}>
          <Label>About / Bio</Label>
          <textarea
            value={form.bio}
            onChange={e => set('bio', e.target.value)}
            placeholder="Tell customers a bit about you and your work…"
            rows={4}
            style={{ fontFamily:'DM Sans, sans-serif', fontSize:14, padding:'10px 12px', border:`1.5px solid ${C.linenDarker}`, borderRadius:4, background:'#FFFDF9', color:C.charcoal, width:'100%', boxSizing:'border-box', resize:'vertical', lineHeight:1.5 }}
          />
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:20, flexWrap:'wrap' }}>
          <span style={{ fontFamily:'DM Sans', fontSize:11.5, color:'#aaa' }}>Member since {joined}</span>
          <Button onClick={saveProfile} loading={saving}>Save changes</Button>
        </div>
      </Card>

      <style>{`
        @media (max-width: 600px) {
          .usc-profile-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
