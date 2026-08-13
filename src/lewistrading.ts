// Lewis Trading — integrations harvested from Lewis Jackson's "YouTube Video
// Prompts" course in the ZeroOne (zero-one) Skool community. Kept SEPARATE from
// the generic Skool Builds page so the Lewis trading material doesn't get mixed
// in with other communities' builds.
//
// Each integration records: the source lesson + YouTube video, a verdict
// (integrate / installed / standalone / overlap), a plain-English "how to use"
// note, and the harvested files (the one-shot prompt + the video transcript).
//
// Manifest lives in the daemon data dir (durable, survives rebuilds):
//   ~/.claudeclaw/lewis-trading.json
//
// Read-only: lists integrations and serves the declared files. Only files
// explicitly listed in the manifest are readable (allow-list), so the file
// route can never be coaxed into reading arbitrary paths.
import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || '/home/itsju';
const MANIFEST = path.join(HOME, '.claudeclaw', 'lewis-trading.json');
const MAX_FILE_BYTES = 1024 * 1024; // cap inline file reads at 1 MB (transcripts are big)

export interface LewisFile {
  name: string;
  path: string;
  lang?: string;
  label?: string;
  // hydrated at read time:
  exists?: boolean;
  bytes?: number;
  lines?: number;
}
export interface LewisIntegration {
  id: string;
  title: string;
  lesson?: string;
  sourceUrl?: string;
  video?: string;
  createdAt?: string;
  /** integrate | installed | standalone | overlap */
  verdict?: string;
  /** plain-English: what it is + how/whether to use it here */
  summary?: string;
  useHow?: string;
  tags?: string[];
  files: LewisFile[];
}

function loadManifest(): LewisIntegration[] {
  try {
    const raw = fs.readFileSync(MANIFEST, 'utf-8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.integrations) ? parsed.integrations : [];
    return items as LewisIntegration[];
  } catch {
    return [];
  }
}

function statFile(p: string): { exists: boolean; bytes: number; lines: number } {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return { exists: false, bytes: 0, lines: 0 };
    let lines = 0;
    if (st.size <= MAX_FILE_BYTES) {
      lines = fs.readFileSync(p, 'utf-8').split('\n').length;
    }
    return { exists: true, bytes: st.size, lines };
  } catch {
    return { exists: false, bytes: 0, lines: 0 };
  }
}

/** List all integrations with each file hydrated (exists / size / line count). */
export function getLewisIntegrations(): LewisIntegration[] {
  return loadManifest().map((b) => ({
    ...b,
    files: (b.files || []).map((f) => ({ ...f, ...statFile(f.path) })),
  }));
}

/** Return the text content of a declared file, looked up by (integration id,
 *  file name). Returns null if not in the manifest or missing on disk. */
export function readLewisFile(
  itemId: string,
  fileName: string,
): { name: string; lang: string; content: string; truncated: boolean } | null {
  const item = loadManifest().find((b) => b.id === itemId);
  if (!item) return null;
  const file = (item.files || []).find((f) => f.name === fileName);
  if (!file) return null; // allow-list: only manifest-declared files are readable
  try {
    const st = fs.statSync(file.path);
    if (!st.isFile()) return null;
    const truncated = st.size > MAX_FILE_BYTES;
    const fd = fs.openSync(file.path, 'r');
    try {
      const len = Math.min(st.size, MAX_FILE_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      return { name: file.name, lang: file.lang || 'text', content: buf.toString('utf-8'), truncated };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
