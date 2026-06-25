// RapidAPI search console — server-side adapter registry.
//
// One generic console for every RapidAPI marketplace API Mike subscribes to.
// The dashboard "RapidAPI" page calls /api/rapidapi/search?api=<id>&q=<query>;
// this dispatches to the selected adapter, normalizes the upstream response to
// a common { title, thumbnail?, url, stream? } shape, and caches it so repeat
// searches don't burn the free-tier quota. The key stays here (server-side) —
// it never reaches the browser. A single RapidAPI key authorizes every API the
// account is subscribed to, so adding an API = one adapter object below.
import { RAPIDAPI_KEY } from './config.js';

export interface MediaResult {
  title: string;
  url: string;          // canonical page — always "Open" in a new tab
  thumbnail?: string;   // preview image
  stream?: string;      // direct mp4 -> inline <video> player
  embed?: string;       // provider embed/iframe URL -> inline <iframe> player
  duration?: string;
  meta?: string;
}

export class RapidApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RapidApiError';
  }
}

interface RapidApiAdapter {
  id: string;
  label: string;
  host: string;       // x-rapidapi-host
  nsfw?: boolean;
  allowEmpty?: boolean; // true for feeds that need no query (return page 1 on empty search)
  search(q: string, key: string): Promise<MediaResult[]>;
}

/** First non-empty value among candidate keys (defensive field mapping — the
 *  exact field names vary per upstream API and aren't documented up front). */
function pick(obj: any, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return typeof v === 'string' ? v : String(v);
  }
  return undefined;
}

/** Pull the result array out of whatever envelope the API used. */
function extractItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  const arr = data?.data ?? data?.results ?? data?.videos ?? data?.items ?? data?.list ?? data?.result;
  return Array.isArray(arr) ? arr : [];
}

function normalizeVideo(it: any): MediaResult {
  const url = pick(it, ['url', 'link', 'video_link', 'video', 'page', 'href', 'permalink']) || '';
  const stream = pick(it, ['stream', 'embed', 'player', 'mp4', 'video_url', 'videoUrl', 'hls', 'file', 'source']);
  const thumbnail = pick(it, ['thumbnail', 'thumb', 'image', 'preview', 'poster', 'cover', 'img']);
  const title = pick(it, ['title', 'name', 'text', 'caption']) || '(untitled)';
  const duration = pick(it, ['duration', 'length', 'time']);
  const meta = pick(it, ['views', 'view_count', 'meta', 'info', 'rating']);
  return {
    title,
    url: url || stream || '',
    stream: stream || undefined,
    thumbnail: thumbnail || undefined,
    duration: duration || undefined,
    meta: meta || undefined,
  };
}

async function rapidFetch(host: string, path: string, key: string, init: RequestInit, timeoutMs = 15_000): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`https://${host}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when we're actually sending one (GET has none).
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        'x-rapidapi-host': host,
        'x-rapidapi-key': key,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new RapidApiError(502, `Could not reach ${host}: ${e}`);
  }
  if (res.status === 403)
    throw new RapidApiError(403, `Not subscribed to ${host} — open its RapidAPI page and click "Subscribe to Test" (free), then retry.`);
  if (res.status === 429)
    throw new RapidApiError(429, `RapidAPI free quota exhausted for ${host} — resets next cycle.`);
  if (!res.ok)
    throw new RapidApiError(res.status, `Upstream ${host} returned ${res.status}.`);
  return res.json().catch(() => ({}));
}

// ── Adapters ────────────────────────────────────────────────────────────────
// Add a new API by appending an adapter here (and subscribing to it on RapidAPI
// with the same key). The dropdown updates automatically.

const xnxx: RapidApiAdapter = {
  id: 'xnxx',
  label: 'Xnxx (video search)',
  host: 'porn-xnxx-api.p.rapidapi.com',
  nsfw: true,
  async search(q, key) {
    // Verified live contract (2026-06-25): POST /search with body {q}. Returns a
    // bare JSON array of {duration, thumbnail, title, video_link, views}. The
    // body param is "q" (NOT "query" — that yields 400 "Missing q parameter").
    const data = await rapidFetch(this.host, '/search', key, {
      method: 'POST',
      body: JSON.stringify({ q }),
    });
    return extractItems(data)
      .slice(0, 40)
      .map(normalizeVideo)
      .map((r) => {
        // Inline play uses xnxx's own embed iframe — the direct mp4 CDN
        // (mp4-cdn77) is hotlink-protected with per-IP CDN77 tokens, so a raw
        // <video> 403s. The embed player runs in the viewer's browser and does
        // the token handshake itself. Encoded id lives in /video-<id>/...
        const m = r.url.match(/\/video-([a-z0-9]+)\//i);
        return m ? { ...r, embed: `https://www.xnxx.com/embedframe/${m[1]}` } : r;
      })
      .filter((r) => r.url || r.stream || r.embed);
  },
};

/** Factory for "one image per query" APIs (generators + single-pic endpoints).
 *  Most NSFW image APIs on RapidAPI are GET <path> -> a JSON object with the
 *  image URL under some field; this maps that to one viewable card. Adding a new
 *  such API is one line at the registry below. `path` builds the request path
 *  from the query (prompt / type / etc); `timeoutMs` is bumped for slow gens. */
function imageGenAdapter(
  id: string,
  label: string,
  host: string,
  path: (q: string) => string,
  timeoutMs = 30_000,
): RapidApiAdapter {
  return {
    id,
    label,
    host,
    nsfw: true,
    async search(q, key) {
      const data = await rapidFetch(host, path(q), key, { method: 'GET' }, timeoutMs);
      const img = pick(data, ['image', 'image_url', 'url', 'output', 'result', 'src', 'link']);
      return img ? [{ title: q || label, url: img, thumbnail: img }] : [];
    },
  };
}

/** Factory for "many images per query" APIs (galleries / paginated feeds).
 *  Pulls the result array out of any envelope, maps each row's image URL to a
 *  card, and drops junk rows (header placeholders, non-URL values). */
function imageListAdapter(
  id: string,
  label: string,
  host: string,
  path: (q: string) => string,
  opts: { timeoutMs?: number; allowEmpty?: boolean } = {},
): RapidApiAdapter {
  const { timeoutMs = 30_000, allowEmpty = false } = opts;
  return {
    id,
    label,
    host,
    nsfw: true,
    allowEmpty,
    async search(q, key) {
      const data = await rapidFetch(host, path(q), key, { method: 'GET' }, timeoutMs);
      const out: MediaResult[] = [];
      for (const it of extractItems(data)) {
        const img = pick(it, ['imgLink', 'image', 'image_url', 'imageUrl', 'url', 'thumbnail', 'thumb', 'src', 'link', 'photo']);
        if (!img || !/^https?:\/\//i.test(img)) continue; // skip header/placeholder rows
        out.push({ title: pick(it, ['title', 'category', 'name', 'tags', 'caption']) || label, url: img, thumbnail: img });
        if (out.length >= 60) break;
      }
      return out;
    },
  };
}

// ai-porn-nsfw-generator: GET /?prompt=<text> -> {"image":"<png>"} (slow gen).
const aiPornGen = imageGenAdapter(
  'aiporn', 'AI Image Generator (NSFW)', 'ai-porn-nsfw-generator.p.rapidapi.com',
  (q) => `/?prompt=${encodeURIComponent(q)}`, 90_000,
);
// girls-nude-image: GET /?type=<category> -> {"url":"<gif/img>"} (boobs/ass/etc).
const girlsNude = imageGenAdapter(
  'girlsnude', 'Girls Nude Image (by type)', 'girls-nude-image.p.rapidapi.com',
  (q) => `/?type=${encodeURIComponent(q || 'boobs')}`,
);
// hot-porn-pictures: GET /hotphotos?pagenumber=<n>&pagesize=20 -> [{imgLink,category}].
// No search term — the query is treated as a page number (default 1).
const hotPics = imageListAdapter(
  'hotpics', 'Hot Porn Pictures (feed)', 'hot-porn-pictures.p.rapidapi.com',
  (q) => `/hotphotos?pagenumber=${/^\d+$/.test(q.trim()) ? q.trim() : 1}&pagesize=20`,
  { allowEmpty: true },
);

const ADAPTERS: RapidApiAdapter[] = [xnxx, aiPornGen, girlsNude, hotPics];
const REGISTRY = new Map(ADAPTERS.map((a) => [a.id, a]));

// ── Public API ───────────────────────────────────────────────────────────────

export function listRapidApis(): Array<{ id: string; label: string; nsfw: boolean }> {
  return ADAPTERS.map((a) => ({ id: a.id, label: a.label, nsfw: !!a.nsfw }));
}

const CACHE = new Map<string, { at: number; results: MediaResult[] }>();
const TTL_MS = 10 * 60 * 1000;

export async function rapidApiSearch(
  apiId: string,
  q: string,
): Promise<{ results: MediaResult[]; cached?: boolean }> {
  const adapter = REGISTRY.get(apiId);
  if (!adapter) throw new RapidApiError(400, `Unknown API '${apiId}'.`);
  const query = (q || '').trim();
  if (!query && !adapter.allowEmpty) return { results: [] };
  if (!RAPIDAPI_KEY) throw new RapidApiError(500, 'RAPIDAPI_KEY is not set in claudeclaw .env.');

  const ck = `${apiId}::${query.toLowerCase()}`;
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return { results: hit.results, cached: true };

  const results = await adapter.search(query, RAPIDAPI_KEY);
  CACHE.set(ck, { at: Date.now(), results });
  return { results };
}
