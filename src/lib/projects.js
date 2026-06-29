// src/lib/projects.js
// Data/service layer for the Projects feature (ARCHITECTURE.md §3.3 — keep a
// section's Supabase access in one place so paging/errors live here, not in
// components).
//
// A project belongs to ONE contact (contact_id); a contact can have many projects.
// RLS (MIGRATION_projects.sql) is the security boundary: a builder sees projects
// whose parent contact they own; admins see all. Ownership is DERIVED from the
// contact, so these helpers never filter by user themselves — they rely on the
// policy. The project carries the Materials Calculator inputs (shed_size,
// style_package_id, siding, selected_packages, package_overrides) so a materials
// list can be generated from it.
import { supabase } from './supabase';

// Project lifecycle. The Sold Projects page shows the SOLD_STATUSES.
export const PROJECT_STATUSES = ['draft', 'quoted', 'sold', 'scheduled', 'completed', 'cancelled'];

// The four pipeline milestones shown as the editable stepper above the work order
// (ProjectDetail), in order. draft/cancelled are valid statuses but live off this
// linear track (set via the Edit modal's full Status dropdown).
export const PROJECT_MILESTONES = ['quoted', 'sold', 'scheduled', 'completed'];

// A won deal that shows on the Sold Projects page: sold, scheduled (build booked),
// and completed. "Open" sold work = sold + scheduled; "Closed" = completed.
export const SOLD_STATUSES = ['sold', 'scheduled', 'completed'];
export const OPEN_SOLD_STATUSES = ['sold', 'scheduled'];
export const CLOSED_SOLD_STATUSES = ['completed'];

export const PROJECT_STATUS_LABELS = {
  draft:     'Draft',
  quoted:    'Quoted',
  sold:      'Sold',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Badge color per status (maps to UI.jsx <Badge> colors).
export const PROJECT_STATUS_COLORS = {
  draft:     'ghost',
  quoted:    'blue',
  sold:      'green',
  scheduled: 'sand',
  completed: 'sage',
  cancelled: 'red',
};

export const isSoldStatus = (s) => SOLD_STATUSES.includes(s);

// Columns + embeds shared by the list/detail reads. We embed the parent contact
// (with its owner profile) so the list can show who the project is for and, for
// admins, which builder owns it; and the style package so the list can show the
// style name without loading every package.
// We embed the parent contact's full mailing/contact details too (phone, address,
// city, state, zip) so the Project Detail page can render a complete work order.
const SELECT =
  '*, contact:contacts(id, full_name, company_name, email, phone, address, city, state, zip, user_id, owner:profiles(id, full_name, email, company_name, phone)), style_package:packages(name)';

// Fetch every project the current user can see. Pages in 1000-row chunks because
// PostgREST caps SELECTs at 1000 rows and .range() does NOT bypass that cap
// (CONTEXT.md gotcha) — projects will grow past 1000. `soldOnly` filters to the
// Sold Projects page.
export async function fetchProjects({ soldOnly = false } = {}) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  for (;;) {
    let query = supabase
      .from('projects')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (soldOnly) query = query.in('status', SOLD_STATUSES);
    const { data, error } = await query;
    if (error) return { data: all, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

// Projects for a single contact (shown on the contact profile page).
export async function fetchProjectsForContact(contactId) {
  return supabase
    .from('projects')
    .select(SELECT)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });
}

export async function getProject(id) {
  return supabase.from('projects').select(SELECT).eq('id', id).maybeSingle();
}

// Create a project under a contact. RLS WITH CHECK enforces that the user owns
// (or is admin for) that contact, so we don't stamp an owner here.
export async function createProject(fields) {
  return supabase.from('projects').insert(fields).select(SELECT).single();
}

export async function updateProject(id, fields) {
  return supabase.from('projects').update(fields).eq('id', id).select(SELECT).single();
}

export async function deleteProject(id) {
  return supabase.from('projects').delete().eq('id', id);
}
