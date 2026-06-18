// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── SHED DATA ────────────────────────────────────────────────
export const SHED_SIZES = [
  '4x6','4x8','4x10','4x12','4x14','4x16',
  '6x6','6x8','6x10','6x12','6x14','6x16',
  '8x8','8x10','8x12','8x14','8x16',
  '10x10','10x12','10x14','10x16','10x18','10x20',
  '12x12','12x14','12x16','12x18','12x20','12x22','12x24','12x28','12x32',
  '14x14','14x16','14x18','14x20','14x22','14x24','14x26','14x28','14x30','14x32','14x36','14x40',
  '16x16','16x18','16x20','16x22','16x24','16x26','16x28','16x30','16x32','16x36','16x40',
];

export const SHED_STYLES = [
  'Traditional','High Wall Traditional','Modern','High Wall Modern',
];

// Static fallback IDs (used before materials load)
export const BASE_MATERIAL_IDS = [
  '4x4x12pt','2x4x8pt','2x4x10pt','2x4x12pt','2x4x8kd','2x4x12kd',
  '2x6x14kd','advantech','t111','cdx','cornerTrim','eaveTrim6',
  'eaveTrim8','eaveTrim10','shingles','dripEdge',
];
export const DOOR_MATERIAL_IDS = ['hinges','thandle','doorHeader','doorTrim','doorPaint'];
export const ADDON_MATERIAL_IDS = [
  'clapboard','bAndB','transom','foundationBlocks','crushedStone',
  'stonePerimeter','oc12floor','paint','overhang','ramp','loftTrad','loftMod',
];

// ── DYNAMIC GROUP HELPERS ────────────────────────────────────
/** Get material IDs for a group from live materials array */
export function getMaterialIdsByGroup(materials, group) {
  return materials.filter(m => m.material_group === group).map(m => m.id);
}

/** Build addon options dynamically — excludes siding (handled separately) */
export function getAddonOptions(materials) {
  const SIDING_IDS = ['clapboard', 'bAndB', 't111'];
  return materials
    .filter(m => m.material_group === 'addon' && !SIDING_IDS.includes(m.id))
    .map(m => ({ key: m.id, label: m.name, matId: m.id, allow_quantity: m.allow_quantity ?? false }));
}

export const DOOR_PACKAGES = { single: 138.80, double: 185.07 };
export const CATEGORIES = ['Framing','Sheathing','Roofing','Siding','Trim','Hardware','Add-ons'];
export const GROUPS = [
  { value: 'base',  label: 'Base' },
  { value: 'door',  label: 'Door' },
  { value: 'addon', label: 'Add-on' },
];

// ── BRAND ────────────────────────────────────────────────────
export const C = {
  linen:        '#F7F3EC',
  linenDark:    '#EDE8DF',
  linenDarker:  '#DDD6C9',
  sage:         '#7A9B76',
  sageLight:    '#9BB897',
  sageDark:     '#5C7A58',
  charcoal:     '#1A1A1A',
  sand:         '#B8986A',
  stale:        '#FEF3C7',
  staleText:    '#92400E',
  error:        '#DC2626',
  errorLight:   '#FEE2E2',
  paper:        '#FFFDF9',
  paperDark:    '#F7F3EC',
  ink:          '#2C2115',
  inkLight:     '#5C4F3A',
};

// ── HELPERS ──────────────────────────────────────────────────
export const fmt = (n) =>
  new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(n ?? 0);

export const daysSince = (ts) =>
  ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000) : 999;

export function applyOverride(material, overridesMap) {
  const ov = overridesMap?.[material.id];
  return {
    ...material,
    price: ov?.price ?? material.default_price,
    url:   ov?.url   ?? material.default_url,
    hasOverride: !!ov,
    overrideId: ov?.id,
  };
}

export function buildQtyMap(quantities) {
  const map = {};
  for (const row of quantities) {
    if (!map[row.material_id]) map[row.material_id] = {};
    map[row.material_id][row.shed_size] = parseFloat(row.quantity) ?? 0;
  }
  return map;
}

/** Generate a slug-style ID from a material name */
export function generateMaterialId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    + '_' + Date.now().toString(36);
}
