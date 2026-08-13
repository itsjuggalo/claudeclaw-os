// Erik Dalton video library — serves the same clickable index the nginx route
// serves (/var/www/dalton/index.html, built by ~/restructure/dalton/build_dalton_index.py)
// plus range-streamed playback of the 510 source videos on the D: drive mounts.
//
// The index page derives its media base from location.origin, so the exact same
// HTML works here and on nginx with no rebuild. Everything is behind the global
// mc-access gate in dashboard.ts, same as the rest of claudeclaw.
import { existsSync, statSync, realpathSync, createReadStream, readFileSync } from 'node:fs';
import { join, sep as pathSep } from 'node:path';

export const DALTON_INDEX = '/var/www/dalton/index.html';
const MEDIA_ROOT = '/home/itsju/dropbox';

// Only the three Dalton trees are reachable — not the rest of ~/dropbox
// (family VHS etc. live there too and aren't part of this library).
const TREES = ['erik-dalton', 'erik-dalton-usb', 'erik-dalton-mp4s'];

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', vob: 'video/mpeg',
};

export function daltonIndex(): { html: string } | { error: string } {
  if (!existsSync(DALTON_INDEX)) {
    return { error: 'index not built — run dalton-reindex on the laptop' };
  }
  try {
    return { html: readFileSync(DALTON_INDEX, 'utf8') };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

export interface DaltonMedia { path: string; size: number; mime: string }

// Resolve a request path to a real video file. Traversal-hardened the same way
// as the anatomy routes: tree allowlist + extension allowlist + realpath confirm.
export function daltonMedia(rel: string): DaltonMedia | { error: string } {
  let p: string;
  try {
    p = decodeURIComponent(rel);
  } catch {
    return { error: 'bad path' };
  }
  p = p.replace(/^\/+/, '');
  if (!p || p.includes('\0') || p.split('/').some((s) => s === '..')) {
    return { error: 'bad path' };
  }
  if (!TREES.some((t) => p === t || p.startsWith(t + '/'))) return { error: 'denied' };

  const ext = (p.split('.').pop() || '').toLowerCase();
  const mime = MIME[ext];
  if (!mime) return { error: 'not a video' };

  const full = join(MEDIA_ROOT, p);
  try {
    if (!existsSync(full)) return { error: 'not found' };
    const realRoot = realpathSync(MEDIA_ROOT);
    const real = realpathSync(full);
    if (!real.startsWith(realRoot + pathSep)) return { error: 'denied' };
    const st = statSync(real);
    if (!st.isFile()) return { error: 'not found' };
    return { path: real, size: st.size, mime };
  } catch (e) {
    return { error: String((e as Error).message || e) };
  }
}

// Parse a single "bytes=a-b" range against a known file size.
// Returns null for "no/unsatisfiable range" (caller sends the whole file).
export function parseRange(
  header: string | undefined, size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  let start: number, end: number;
  if (a === '') {
    // suffix range: last N bytes
    const n = parseInt(b, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(a, 10);
    end = b === '' ? size - 1 : parseInt(b, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function daltonStream(path: string, start?: number, end?: number) {
  return createReadStream(path, start === undefined ? {} : { start, end });
}
