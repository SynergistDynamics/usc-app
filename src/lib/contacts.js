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
