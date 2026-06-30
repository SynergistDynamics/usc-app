// src/components/UI.jsx
import { useEffect } from 'react';
import { C } from '../lib/supabase';

// A simple line-drawn shed (mono-pitch roof) — the placeholder when a project has
// no ShedPro rendering. A real icon, not an emoji, so it renders identically on
// every device and stays on-brand.
export function ShedIcon({ size = 30, color = '#A7B3A1' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M3 10.2 L12 4.5 L21 8.4" />
      <path d="M5.2 9.5 V19.5 H18.8 V8.2" />
      <path d="M10 19.5 V13.5 H14 V19.5" />
    </svg>
  );
}

export function Spinner({ size = 20 }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid ${C.linenDarker}`,
      borderTopColor: C.sage, borderRadius: '50%',
      animation: 'spin 0.7s linear infinite', display: 'inline-block',
    }} />
  );
}

export function Badge({ children, color = 'sage' }) {
  const map = {
    sage:  { background: C.sage,       color: '#fff' },
    sand:  { background: C.sand,       color: C.charcoal },
    stale: { background: C.stale,      color: C.staleText },
    green: { background: '#D1FAE5',    color: '#065F46' },
    red:   { background: '#FEE2E2',    color: '#991B1B' },
    blue:  { background: '#DBEAFE',    color: '#1E40AF' },
    ghost: { background: C.linenDark,  color: C.charcoal },
  };
  return (
    <span style={{
      ...map[color], padding: '2px 8px', borderRadius: 9999,
      fontSize: 11, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled, loading, style = {}, type = 'button',
}) {
  const base = {
    fontFamily: 'DM Sans, sans-serif', fontWeight: 600,
    border: 'none', cursor: disabled || loading ? 'not-allowed' : 'pointer',
    borderRadius: 4, transition: 'all 0.15s',
    opacity: disabled || loading ? 0.55 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    ...style,
  };
  const pad = size === 'sm' ? '6px 12px' : size === 'lg' ? '13px 28px' : '9px 20px';
  const fs  = size === 'sm' ? 12 : size === 'lg' ? 15 : 14;
  const v = {
    primary:   { background: C.sage,    color: '#fff',       padding: pad, fontSize: fs },
    secondary: { background: 'transparent', color: C.sage,   padding: pad, fontSize: fs, border: `1.5px solid ${C.sage}` },
    ghost:     { background: 'transparent', color: C.charcoal, padding: pad, fontSize: fs },
    danger:    { background: C.error,   color: '#fff',       padding: pad, fontSize: fs },
    dark:      { background: C.charcoal, color: '#fff',      padding: pad, fontSize: fs },
  };
  return (
    <button type={type} onClick={disabled || loading ? undefined : onClick} style={{ ...base, ...v[variant] }}>
      {loading && <Spinner size={13} />}
      {children}
    </button>
  );
}

export function Select({ value, onChange, options, style = {}, disabled }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{
        fontFamily: 'DM Sans, sans-serif', fontSize: 14,
        padding: '8px 12px', border: `1.5px solid ${C.linenDarker}`,
        borderRadius: 4, background: C.linen, color: C.charcoal,
        cursor: 'pointer', width: '100%', ...style,
      }}
    >
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

export function Input({
  value, onChange, type = 'text', style = {},
  placeholder = '', disabled, onBlur, autoFocus,
}) {
  return (
    <input
      type={type} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} disabled={disabled}
      onBlur={onBlur} autoFocus={autoFocus}
      style={{
        fontFamily: 'DM Sans, sans-serif', fontSize: 14,
        padding: '8px 12px', border: `1.5px solid ${C.linenDarker}`,
        borderRadius: 4, background: disabled ? C.linenDark : '#FFFDF9',
        color: C.charcoal, width: '100%', boxSizing: 'border-box', ...style,
      }}
    />
  );
}

export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: '#FFFDF9', border: `1px solid ${C.linenDarker}`,
      borderRadius: 6, padding: 24, ...style,
    }}>
      {children}
    </div>
  );
}

export function SectionHeader({ children, sub }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{
        fontFamily: 'Cormorant Garamond, serif', fontSize: 32,
        fontWeight: 600, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em',
        lineHeight: 1.1,
      }}>
        {children}
      </h2>
      {sub && (
        <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#888', margin: '4px 0 0' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export function WarningBanner({ children }) {
  return (
    <div style={{
      background: C.stale, border: `1px solid #F59E0B`,
      borderRadius: 4, padding: '12px 16px', marginBottom: 16,
      fontFamily: 'DM Sans, sans-serif', fontSize: 13,
      color: C.staleText, display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <span>⚠️</span><span>{children}</span>
    </div>
  );
}

export function ErrorBanner({ children, onDismiss }) {
  return (
    <div style={{
      background: C.errorLight, border: `1px solid #FCA5A5`,
      borderRadius: 4, padding: '12px 16px', marginBottom: 16,
      fontFamily: 'DM Sans, sans-serif', fontSize: 13,
      color: '#991B1B', display: 'flex', alignItems: 'flex-start',
      gap: 8, justifyContent: 'space-between',
    }}>
      <span>❌ {children}</span>
      {onDismiss && (
        <button onClick={onDismiss} style={{ background:'none', border:'none', cursor:'pointer', color:'#991B1B', fontSize:16, lineHeight:1 }}>×</button>
      )}
    </div>
  );
}

export function SuccessBanner({ children }) {
  return (
    <div style={{
      background: '#D1FAE5', border: `1px solid #6EE7B7`,
      borderRadius: 4, padding: '12px 16px', marginBottom: 16,
      fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#065F46',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      ✓ {children}
    </div>
  );
}

// Modal. Esc and a backdrop click both call onClose. Pass an optional `footer` to get
// a fixed layout — sticky title bar + scrolling body + sticky footer action bar — so
// long forms keep the title and the primary actions in view (only the body scrolls).
// Without `footer` the original single-scroll layout is used (unchanged).
export function Modal({ title, children, onClose, width = 480, footer }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const backdrop = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  };
  const closeBtn = (
    <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#999', lineHeight: 1 }}>×</button>
  );
  const heading = (
    <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: C.charcoal, margin: 0 }}>
      {title}
    </h3>
  );

  if (footer) {
    return (
      <div style={backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{
          background: '#fff', borderRadius: 8, width: '100%', maxWidth: width, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '18px 28px', borderBottom: `1px solid ${C.linenDarker}`, flexShrink: 0 }}>
            {heading}{closeBtn}
          </div>
          <div style={{ padding: '22px 28px', overflow: 'auto', flex: 1 }}>{children}</div>
          <div style={{ padding: '14px 28px', borderTop: `1px solid ${C.linenDarker}`, flexShrink: 0, background: '#fff' }}>{footer}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: 32,
        width: '100%', maxWidth: width, maxHeight: '90vh',
        overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          {heading}{closeBtn}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Label({ children }) {
  return (
    <label style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 12, fontWeight: 600, color: '#666', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </label>
  );
}

export function QuantityTicker({ value, onChange, min = 0 }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, border:`1.5px solid ${C.linenDarker}`, borderRadius:3, overflow:'hidden', background:'#fff', flexShrink:0 }}>
      <button onClick={() => onChange(Math.max(min, value - 1))}
        style={{ width:22, height:22, border:'none', cursor: value <= min ? 'not-allowed' : 'pointer', background: value <= min ? C.linen : C.linenDark, color: value <= min ? '#ccc' : C.charcoal, fontFamily:'DM Sans', fontSize:13, fontWeight:700, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, padding:0 }}>
        −
      </button>
      <span style={{ width:24, textAlign:'center', fontFamily:'DM Sans', fontSize:12, fontWeight:700, color:C.charcoal, lineHeight:'22px' }}>
        {value}
      </span>
      <button onClick={() => onChange(value + 1)}
        style={{ width:22, height:22, border:'none', cursor:'pointer', background:C.linenDark, color:C.charcoal, fontFamily:'DM Sans', fontSize:13, fontWeight:700, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, padding:0 }}>
        +
      </button>
    </div>
  );
}

export function FormField({ label, children, style = {} }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}
