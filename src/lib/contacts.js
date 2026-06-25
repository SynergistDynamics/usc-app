// src/lib/contacts.js
// Data/service layer for the Contacts feature (ARCHITECTURE.md §3.3 — keep Supabase
// access for a section in one place so paging/errors live here, not in components).
//
// RLS does the security: a builder only ever sees/writes their own contacts; admins see
// all (see MIGRATION_contacts.sql). These helpers don't filter by user_id themselves —
// they rely on the policy — except createContact, which stamps the owner explicitly.
import { supabase } from './supabase';

// Status values a contact can move through. Keep in sync with any DB check constraint
// if one is ever added (none today — status is a free-ish text column).
export const CONTACT_STATUSES = ['lead', 'quoted', 'customer', 'closed', 'lost'];

export const STATUS_LABELS = {
  lead:     'Lead',
  quoted:   'Quoted',
  customer: 'Customer',
  closed:   'Closed (won)',
  lost:     'Lost',
};

// Badge color per status (maps to UI.jsx <Badge> colors).
export const STATUS_COLORS = {
  lead:     'sand',
  quoted:   'blue',
  customer: 'green',
  closed:   'sage',
  lost:     'red',
};

// Fetch every contact the current user is allowed to see. Pages in 1000-row chunks
// because PostgREST caps SELECTs at 1000 rows and .range() does NOT bypass that cap
// (CONTEXT.md gotcha) — contacts will grow past 1000.
export async function fetchContacts() {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*, owner:profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) return { data: all, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

export async function getContact(id) {
  return supabase
    .from('contacts')
    .select('*, owner:profiles(full_name, email)')
    .eq('id', id)
    .maybeSingle();
}

// Create a contact owned by the given user (the current builder). We pass user_id
// explicitly rather than leaning on the column default so the owner is unambiguous.
export async function createContact(userId, fields) {
  return supabase
    .from('contacts')
    .insert({ ...fields, user_id: userId })
    .select('*, owner:profiles(full_name, email)')
    .single();
}

export async function updateContact(id, fields) {
  return supabase
    .from('contacts')
    .update(fields)
    .eq('id', id)
    .select('*, owner:profiles(full_name, email)')
    .single();
}

export async function deleteContact(id) {
  return supabase.from('contacts').delete().eq('id', id);
}

// Assign (or unassign) a contact's owner. userId may be null to unassign.
export async function assignContact(id, userId) {
  return updateContact(id, { user_id: userId || null });
}

// ── Owner routing ────────────────────────────────────────────────────────────
// Builders/admins a contact can be assigned to (everyone except blocked users).
// Admins can read all profiles (RLS), so this is admin-facing.
export async function fetchAssignableBuilders() {
  return supabase
    .from('profiles')
    .select('id, full_name, email, market, role')
    .neq('role', 'blocked')
    .order('full_name');
}

// territory -> builder map (rows include the builder for display).
export async function fetchTerritoryRoutes() {
  return supabase
    .from('territory_routing')
    .select('territory, user_id, builder:profiles(full_name, email)')
    .order('territory');
}

// Distinct ShedPro territory tags seen on contacts that have NO routing row yet —
// surfaced in the routing manager so the admin can map them as new ones arrive.
export async function fetchUnmappedTerritories() {
  const [{ data: contactRows, error: e1 }, { data: routeRows, error: e2 }] = await Promise.all([
    supabase.from('contacts').select('shedpro_territory').not('shedpro_territory', 'is', null),
    supabase.from('territory_routing').select('territory'),
  ]);
  if (e1) return { data: [], error: e1 };
  if (e2) return { data: [], error: e2 };
  const mapped = new Set((routeRows || []).map(r => r.territory));
  const counts = new Map();
  for (const r of contactRows || []) {
    const t = r.shedpro_territory;
    if (t && !mapped.has(t)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return {
    data: [...counts.entries()].map(([territory, count]) => ({ territory, count }))
      .sort((a, b) => b.count - a.count),
    error: null,
  };
}

// Create/update a territory -> builder mapping, then apply it to existing UNASSIGNED
// contacts carrying that territory (so adding a rule routes the leads already waiting).
export async function setTerritoryRoute(territory, userId) {
  const { error } = await supabase
    .from('territory_routing')
    .upsert({ territory, user_id: userId || null }, { onConflict: 'territory' });
  if (error) return { error };
  if (userId) {
    const { error: e2 } = await supabase
      .from('contacts')
      .update({ user_id: userId })
      .eq('shedpro_territory', territory)
      .is('user_id', null);
    if (e2) return { error: e2 };
  }
  return { error: null };
}

export async function deleteTerritoryRoute(territory) {
  return supabase.from('territory_routing').delete().eq('territory', territory);
}
