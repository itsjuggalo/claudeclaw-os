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
  stream?: string;      // direct mp4 / embeddable URL -> inline player
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
  return {
    title,
    url: url || stream || '',
    stream: stream || undefined,
    thumbnail: thumbnail || undefined,
    duration: duration || undefined,
  };
}

async function rapidFetch(host: string, path: string, key: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`https://${host}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': host,
        'x-rapidapi-key': key,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
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
    // POST {query} to the "Search video" endpoint. The exact body field may
    // need a 1-line tweak after the first live call (the response is mapped
    // defensively regardless of field names).
    const data = await rapidFetch(this.host, '/search', key, {
      method: 'POST',
      body: JSON.stringify({ query: q }),
    });
    return extractItems(data).slice(0, 40).map(normalizeVideo).filter((r) => r.url || r.stream);
  },
};

const ADAPTERS: RapidApiAdapter[] = [xnxx];
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
  if (!query) return { results: [] };
  if (!RAPIDAPI_KEY) throw new RapidApiError(500, 'RAPIDAPI_KEY is not set in claudeclaw .env.');

  const ck = `${apiId}::${query.toLowerCase()}`;
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return { results: hit.results, cached: true };

  const results = await adapter.search(query, RAPIDAPI_KEY);
  CACHE.set(ck, { at: Date.now(), results });
  return { results };
}
