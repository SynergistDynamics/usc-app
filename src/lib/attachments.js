// src/lib/attachments.js
// Data/service layer for PROJECT FILE ATTACHMENTS (permits, contracts, site photos,
// renderings the builder wants to keep with the job, …). Follows the same "keep a
// section's Supabase access in one place" convention as lib/projects.js.
//
// Storage: a PRIVATE bucket `project-files`; objects are keyed `{project_id}/{ts}-{name}`
// so the first path segment is the project id (the storage RLS policies check it). Because
// the bucket is private, files are only ever reached via short-lived SIGNED urls — there is
// no public url. Metadata (original name, type, size, who/when) lives in the
// `project_attachments` table; RLS on both the table and storage.objects scopes access to
// the project's owner + admins (see MIGRATION_project_attachments.sql).
import { supabase } from './supabase';

export const ATTACHMENTS_BUCKET = 'project-files';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB
const SIGNED_URL_TTL = 60 * 60; // 1 hour

// Is this attachment an image we can thumbnail/preview inline?
export function isImageAttachment(a) {
  if (a?.file_type) return a.file_type.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(a?.file_name || '');
}

// Human-friendly size, e.g. "2.4 MB".
export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Strip a filename down to something safe for a storage key (keeps the extension).
function safeName(name) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60) || 'file';
  const ext  = (dot > 0 ? name.slice(dot + 1) : '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  return ext ? `${base}.${ext}` : base;
}

// All attachments for a project, newest first. RLS restricts to owned projects/admins.
export async function fetchAttachments(projectId) {
  return supabase
    .from('project_attachments')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
}

// Upload one file to storage, then record its metadata row. Returns { data, error }
// where data is the inserted attachment row (with the storage path).
export async function uploadAttachment(projectId, file, uploadedBy) {
  const path = `${projectId}/${Date.now()}-${safeName(file.name)}`;
  const { error: upErr } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) return { data: null, error: upErr };

  const { data, error } = await supabase
    .from('project_attachments')
    .insert({
      project_id: projectId,
      storage_path: path,
      file_name: file.name,
      file_type: file.type || null,
      size_bytes: file.size ?? null,
      uploaded_by: uploadedBy || null,
    })
    .select('*')
    .single();

  // If the row insert failed, don't leave an orphaned object behind.
  if (error) { await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]); return { data: null, error }; }
  return { data, error: null };
}

// Delete an attachment: remove the storage object, then its metadata row.
export async function deleteAttachment(attachment) {
  const { error: rmErr } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachment.storage_path]);
  // A missing object shouldn't block removing the row; only hard-fail on real errors.
  if (rmErr && !/not found/i.test(rmErr.message || '')) return { error: rmErr };
  return supabase.from('project_attachments').delete().eq('id', attachment.id);
}

// A short-lived signed URL for one stored object (private bucket → no public url).
export async function signedUrl(storagePath, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL, download ? { download: true } : undefined);
  return { url: data?.signedUrl || null, error };
}

// Batch signed URLs (used to thumbnail a whole image grid at once). Returns a
// { storage_path: url } map; paths that fail are simply absent.
export async function signedUrlMap(storagePaths) {
  if (!storagePaths.length) return {};
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrls(storagePaths, SIGNED_URL_TTL);
  if (error || !data) return {};
  const map = {};
  data.forEach(d => { if (d.signedUrl && !d.error) map[d.path] = d.signedUrl; });
  return map;
}
