// /api/catalog — GET search the Android device catalog (public): every phone
// and tablet Google Play lists (device_catalog, loaded by
// scripts/sync-catalog.mjs). ?q= (2+ characters; every word must match the
// brand, marketing name, a codename or a model number), ?limit= (default 20,
// max 50). Phones from the makers people port to come first (TOP_BRANDS, then
// MAJOR_BRANDS; a smaller brand ranks with those when the query names it), then name
// matches before the rest. Each entry says which tracked device it
// is, if any (`tracked`: a slug, matched by name or codename), so a picker can
// offer "add this phone" only for phones the tracker does not list.
// -> {catalog: [{id, brand, name, display, codenames, models, tracked}]}

import { createFileRoute } from '@tanstack/react-router';
import { queryAll } from '@/lib/db';
import { HttpError, json } from '@/lib/auth';
import { apiHandlers, type ApiCtx } from '@/lib/api';
import { likeEscape } from '@/lib/devices';

interface CatalogRow {
  id: number;
  brand: string;
  name: string;
  codenames: string;
  models: string;
}

/** Brands whose product names stand alone ("Galaxy S24", "Pixel 8"); others get the brand in front. */
const STANDALONE = new Set(['samsung', 'google']);

/** Product lines that name a phone without the brand ("Redmi Note 7 Pro", listed under Xiaomi). */
const LINES = /^(redmi|poco|mi |galaxy|pixel|nexus|moto|nokia|oneplus|realme|iqoo|honor|nothing|xperia|zenfone|rog phone|redmagic|black ?shark|blackview)/i;

/** The name a phone goes by on the tracker: "Redmi Note 7", "Galaxy S24 Ultra", "moto g(7)". */
export function displayName(brand: string, name: string): string {
  if (STANDALONE.has(brand.toLowerCase()) || name.toLowerCase().startsWith(brand.toLowerCase()) || LINES.test(name)) return name;
  return `${brand} ${name}`;
}

/**
 * The makers whose phones people port to. Google Play's list also has
 * thousands of no-name tablets and clones ("Hurricane Galaxy"); those rank
 * after these unless the query names their brand.
 */
/** The makers most ports are for: first of all. */
const TOP_BRANDS = ['samsung', 'xiaomi', 'redmi', 'poco', 'google', 'oneplus', 'motorola', 'sony'];

const MAJOR_BRANDS = [
  'lenovo', 'lg', 'nokia', 'hmd global',
  'oppo', 'vivo', 'iqoo', 'realme', 'huawei', 'honor', 'asus', 'nothing', 'zte', 'nubia', 'infinix', 'tecno', 'itel',
  'meizu', 'fairphone', 'htc', 'essential products', 'blackview', 'ulefone', 'oukitel', 'doogee', 'cubot', 'umidigi',
  'teracube', 'shift', 'gigaset', 'tcl', 'alcatel', 'sharp', 'kyocera', 'fujitsu', 'black shark', 'microsoft', 'amazon',
  'razer', 'nvidia', 'leeco', 'letv', 'coolpad', 'wiko', 'bq', 'micromax', 'lava', 'cat', 'crosscall',
];

async function handleGet({ request }: ApiCtx): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const q = (sp.get('q') ?? '').trim().toLowerCase().slice(0, 80);
  if (q.length < 2) throw new HttpError(400, 'query too short', 'send ?q= with at least 2 characters, e.g. ?q=redmi note 7 or ?q=lavender');
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 20, 1), 50);
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const where = words.map(() => "search LIKE ? ESCAPE '\\'").join(' AND ');
  const rows = await queryAll<CatalogRow>(
    `SELECT id, brand, name, codenames, models FROM device_catalog WHERE ${where}
     ORDER BY CASE WHEN lower(brand) IN (${TOP_BRANDS.map(() => '?').join(', ')}) THEN 0
                   WHEN lower(brand) IN (${MAJOR_BRANDS.map(() => '?').join(', ')}) OR ? LIKE '%' || lower(brand) || '%' THEN 1 ELSE 2 END,
              CASE WHEN lower(name) = ? OR lower(replace(replace(replace(name, '(', ''), ')', ''), '-', ' ')) = ? THEN 0 WHEN lower(name) LIKE ? ESCAPE '\\' THEN 1 WHEN lower(brand || ' ' || name) LIKE ? ESCAPE '\\' THEN 2
                   WHEN lower(name) LIKE ? ESCAPE '\\' THEN 3 ELSE 4 END, length(name), name
     LIMIT ?`,
    [...words.map((w) => `%${likeEscape(w)}%`), ...TOP_BRANDS, ...MAJOR_BRANDS, q, q, q, `${likeEscape(q)}%`, `${likeEscape(q)}%`, `%${likeEscape(q)}%`, limit],
  );

  // Which of these the tracker lists already: same name, or a codename as the device's model.
  const devices = await queryAll<{ slug: string; name: string; model: string }>('SELECT slug, name, model FROM devices');
  const byName = new Map(devices.map((d) => [d.name.toLowerCase(), d.slug]));
  const byCode = new Map(devices.filter((d) => d.model).map((d) => [d.model.toLowerCase(), d.slug]));
  const catalog = rows.map((r) => {
    const display = displayName(r.brand, r.name);
    const codenames = r.codenames ? r.codenames.split(',') : [];
    const tracked =
      byName.get(display.toLowerCase()) ?? byName.get(r.name.toLowerCase()) ?? codenames.map((c) => byCode.get(c.toLowerCase())).find(Boolean) ?? null;
    return { id: r.id, brand: r.brand, name: r.name, display, codenames, models: r.models ? r.models.split(',') : [], tracked };
  });
  return json({ catalog });
}

export const Route = createFileRoute('/api/catalog')({
  server: { handlers: apiHandlers({ GET: handleGet }) },
});
