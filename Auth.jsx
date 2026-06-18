// src/components/Auth.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, C } from '../lib/supabase';
import { Button, Card, Input, FormField, SuccessBanner, ErrorBanner, Spinner } from './UI';

// ── AUTH CONTEXT ─────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      if (data.session) loadProfile(data.session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
      if (session) loadProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email?.toLowerCase();

    const { data: prof } = await supabase
      .from('profiles').select('*').eq('id', userId).single();

    // No profile yet — check for invite before creating
    if (!prof && email) {
      const { data: inv } = await supabase
        .from('invitations').select('*').eq('email', email).eq('accepted', false).maybeSingle();
      const role = inv ? 'builder' : 'blocked';
      const { data: newProf } = await supabase
        .from('profiles')
        .insert({ id: userId, email, role, full_name: inv?.full_name || null, market: inv?.market || null })
        .select().single();
      if (inv) await supabase.from('invitations').update({ accepted: true }).eq('id', inv.id);
      setProfile(newProf ?? null);
      return;
    }

    // Profile exists but blocked — re-check in case invite was added since
    if (prof?.role === 'blocked' && email) {
      const { data: inv } = await supabase
        .from('invitations').select('*').eq('email', email).eq('accepted', false).maybeSingle();
      if (inv) {
        const { data: upgraded } = await supabase
          .from('profiles')
          .update({ role: 'builder', full_name: inv.full_name || prof.full_name, market: inv.market || prof.market })
          .eq('id', userId).select().single();
        await supabase.from('invitations').update({ accepted: true }).eq('id', inv.id);
        setProfile(upgraded ?? prof);
        return;
      }
    }

    // Sync the user's own settings to localStorage so all pages read consistent values
    if (prof) {
      if (prof.sales_tax != null)  localStorage.setItem('usc_sales_tax', String(prof.sales_tax));
      if (prof.multiplier != null) localStorage.setItem('usc_multiplier', String(prof.multiplier));
    }

    setProfile(prof ?? null);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, profile, signOut, reloadProfile: () => session && loadProfile(session.user.id) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// ── LOGIN PAGE ───────────────────────────────────────────────
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleGoogle() {
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F7F3EC',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontFamily: 'Cormorant Garamond, serif', fontSize: 38,
            fontWeight: 600, color: '#1A1A1A', lineHeight: 1.1, letterSpacing: '-0.02em',
          }}>
            Urban Sheds<br />Collective
          </div>
          <div style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: 11,
            color: '#B8986A', marginTop: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', fontStyle: 'italic',
          }}>
            Materials & Pricing Manager
          </div>
        </div>

        <div style={{ background:'#FFFDF9', border:'1px solid #DDD6C9', borderRadius:8, padding:32 }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
              <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: C.charcoal, margin: '0 0 10px' }}>
                Check your inbox
              </h3>
              <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 14, color: '#666', margin: '0 0 20px', lineHeight: 1.6 }}>
                We sent a magic link to <strong>{email}</strong>.<br />
                Click it to sign in — no password needed.
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setSent(false); setEmail(''); }}>
                Use a different email
              </Button>
            </div>
          ) : (
            <>
              <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: C.charcoal, margin: '0 0 6px' }}>
                Sign in
              </h3>
              <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#888', margin: '0 0 24px' }}>
                Enter your email and we'll send you a sign-in link.
              </p>

              {error && <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>}

              <FormField label="Email address">
                <Input
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoFocus
                />
              </FormField>

              <Button
                onClick={handleSubmit}
                loading={loading}
                disabled={!email.trim()}
                size="lg"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              >
                Send magic link
              </Button>

              <div style={{ display:'flex', alignItems:'center', gap:10, margin:'16px 0 4px' }}>
                <div style={{ flex:1, height:1, background:'#E5E0D8' }} />
                <span style={{ fontFamily:'DM Sans, sans-serif', fontSize:11, color:'#bbb', fontWeight:500 }}>or</span>
                <div style={{ flex:1, height:1, background:'#E5E0D8' }} />
              </div>

              <button
                onClick={handleGoogle}
                style={{
                  width:'100%', padding:'10px 0', marginTop:4,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                  background:'#fff', border:'1.5px solid #E5E0D8', borderRadius:4,
                  fontFamily:'DM Sans, sans-serif', fontSize:14, fontWeight:600,
                  color:'#3C3C3C', cursor:'pointer', transition:'all 0.15s',
                }}
                onMouseOver={e => e.currentTarget.style.borderColor = '#aaa'}
                onMouseOut={e => e.currentTarget.style.borderColor = '#E5E0D8'}
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
                Continue with Google
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: '#aaa', marginTop: 20 }}>
          Access is invite-only. Contact your USC admin if you need access.
        </p>
      </div>
    </div>
  );
}

// ── BLOCKED SCREEN ───────────────────────────────────────────
export function BlockedScreen({ onSignOut }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#F7F3EC',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{
          fontFamily: 'Cormorant Garamond, serif', fontSize: 36,
          fontWeight: 700, color: C.charcoal, lineHeight: 1.15, marginBottom: 8,
        }}>
          Urban Sheds<br />Collective
        </div>
        <div style={{
          fontFamily: 'DM Sans, sans-serif', fontSize: 12,
          color: C.sage, marginBottom: 40, letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Materials & Pricing Manager
        </div>

        <div style={{
          background: '#fff', border: `1px solid ${C.linenDarker}`,
          borderRadius: 8, padding: 36,
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h3 style={{
            fontFamily: 'Cormorant Garamond, serif', fontSize: 24,
            fontWeight: 600, color: C.charcoal, margin: '0 0 12px',
          }}>
            Access restricted
          </h3>
          <p style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: 14,
            color: '#888', margin: '0 0 24px', lineHeight: 1.7,
          }}>
            This tool is for licensed Urban Sheds Collective builders only.
            If you're a USC builder, contact your admin to get access.
          </p>
          <a href="mailto:jeremy@urban-sheds.com" style={{
            display: 'block', padding: '10px 0', marginBottom: 12,
            background: C.sage, color: '#fff', borderRadius: 4,
            fontFamily: 'DM Sans, sans-serif', fontSize: 14, fontWeight: 600,
            textDecoration: 'none',
          }}>
            Request access
          </a>
          <button onClick={onSignOut} style={{
            width: '100%', padding: '9px 0', background: 'transparent',
            border: `1px solid ${C.linenDarker}`, borderRadius: 4,
            fontFamily: 'DM Sans, sans-serif', fontSize: 13,
            color: '#aaa', cursor: 'pointer',
          }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LOADING SCREEN ───────────────────────────────────────────
export function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh', background: '#F7F3EC',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
    }}>
      <Spinner size={32} />
      <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#aaa' }}>
        Loading…
      </div>
    </div>
  );
}
