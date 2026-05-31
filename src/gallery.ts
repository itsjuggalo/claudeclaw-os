// Gallery — surfaces every generated image/video from the same local source
// folders as the always-on :8090 "BobaCatTrades + Nano Banana" gallery server,
// but served by THIS dashboard so it's same-origin (no CORS) and keeps working
// even if :8090 is down. Read-only: we only list + stream existing files.
//
// ROOTS + SECTIONS below MIRROR ~/.claude/skills/banana-maker/bobacat_server.py
// (its ROOTS / SOURCES). If you add a source folder there, add it here too.
import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || '/home/itsju';

// Named source roots (mirror of bobacat_server.py ROOTS).
const ROOTS: Record<string, string> = {
  pack: '/mnt/c/Users/itsju/OneDrive/Desktop/From Claude To Mike/bobacattrades',
  nano: '/mnt/c/Users/itsju/OneDrive/Desktop/ai bot stuff/NanoBanana Generations',
  freqplot: `${HOME}/LapClaw/freqtrade/user_data/plot`,
  video: `${HOME}/01_ACTIVE/free-video-maker/renders`,
  avcartoon: '/mnt/c/Users/itsju/OneDrive/Desktop/From Claude To Mike/bobacattrades/discord-avatars/cartoon',
  avphoto: '/mnt/c/Users/itsju/OneDrive/Desktop/From Claude To Mike/bobacattrades/discord-avatars/photo',
  generated: `${HOME}/.claude/skills/banana-maker/output`,
  scratchgif: '/mnt/c/Users/itsju/OneDrive/Desktop/From Claude To Mike/bobacattrades/scratching-gifs',
};

interface SourceDef {
  id: string;
  root: keyof typeof ROOTS | string;
  sub: string;
  title: string;
  desc: string;
  exts: string[];
  sort: 'name' | 'mtime';
}

// Section list (mirror of bobacat_server.py SOURCES). Generation folders first
// (newest-first), brand-pack folders below. .html plots are intentionally
// dropped here since the dashboard renders <img>/<video> tiles only.
const SOURCES: SourceDef[] = [
  { id: 'nano',  root: 'nano',       sub: '',                title: 'Nano Banana Generations', desc: 'Everything generated into the NanoBanana Generations folder — newest first.',          exts: ['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.mp4', '.webm', '.mov'], sort: 'mtime' },
  { id: 'gen',   root: 'generated',  sub: '',                title: 'Generated — Nano Banana', desc: 'Every image/video from the banana-maker skill (default output dir) — newest first.',  exts: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm'],                   sort: 'mtime' },
  { id: 'video', root: 'video',      sub: '',                title: 'Free Video Maker',        desc: 'Renders auto-saved by free-video-maker — newest first.',                              exts: ['.mp4', '.webm', '.mov', '.gif', '.png', '.jpg'],                            sort: 'mtime' },
  { id: 'sig',   root: 'pack',       sub: 'signals',         title: 'Buy / Sell Signals',      desc: 'Bullish/bearish mascots, BUY/SELL stamps, Discord emotes.',                           exts: ['.png'],                                                                     sort: 'name'  },
  { id: 'sp',    root: 'pack',       sub: 'scratching-post', title: 'Scratching-Post Scenes',  desc: 'Cat clawing candlesticks across art styles, color-matched to your cats.',             exts: ['.png'],                                                                     sort: 'name'  },
  { id: 'sgif',  root: 'scratchgif', sub: '',                title: 'Scratching-Post GIFs',    desc: 'Animated cats using candlesticks as a scratching post — looping GIFs.',                exts: ['.gif'],                                                                     sort: 'name'  },
  { id: 'cr',    root: 'pack',       sub: 'cat-recreations', title: 'Cat Recreations',         desc: 'Every folder cat re-drawn: portrait · trader · emote.',                               exts: ['.png'],                                                                     sort: 'name'  },
  { id: 'gl',    root: 'pack',       sub: 'glitch',          title: 'Glitch / RGB-Split',      desc: 'Chromatic aberration + scanlines + VHS distortion.',                                  exts: ['.png'],                                                                     sort: 'name'  },
  { id: 'svg',   root: 'pack',       sub: 'svg-logos',       title: 'Vector Logos',            desc: 'Scalable .svg + transparent PNG brand logos.',                                        exts: ['.svg', '.png'],                                                             sort: 'name'  },
  { id: 'avc',   root: 'avcartoon',  sub: '',                title: 'Discord Avatars — Cartoon', desc: 'Brand mascot avatars for the agent Discord profiles.',                              exts: ['.png'],                                                                     sort: 'name'  },
  { id: 'avp',   root: 'avphoto',    sub: '',                title: 'Discord Avatars — Photo', desc: 'Real-photo avatar crops (cat-centered) for each agent.',                              exts: ['.png'],                                                                     sort: 'name'  },
  { id: 'freq',  root: 'freqplot',   sub: '',                title: 'Freqtrade Plots',         desc: 'Saved charts from freqtrade plot-dataframe / plot-profit.',                           exts: ['.png', '.jpg'],                                                             sort: 'mtime' },
];

const VID = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/quicktime',
};

// Only these (root, sub) pairs are valid file requests — locks the file route
// to declared sections (defense in depth on top of the path-traversal check).
const ALLOWED = new Set(SOURCES.map((s) => `${s.root}|${s.sub}`));

export interface GalleryFile { name: string; url: string; type: 'image' | 'video'; }
export interface GallerySection { id: string; title: string; desc: string; count: number; files: GalleryFile[]; }

function baseDir(s: SourceDef): string {
  const r = ROOTS[s.root];
  return s.sub ? path.join(r, s.sub) : r;
}

function safeMtime(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

function listSection(s: SourceDef): GalleryFile[] {
  const dir = baseDir(s);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const exts = new Set(s.exts.map((e) => e.toLowerCase()));
  let files = names.filter((n) => exts.has(path.extname(n).toLowerCase()));
  if (s.sort === 'mtime') {
    files = files
      .map((n) => ({ n, m: safeMtime(path.join(dir, n)) }))
      .sort((a, b) => b.m - a.m)
      .map((x) => x.n);
  } else {
    files = files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }
  const q = (v: string) => encodeURIComponent(v);
  return files.map((n) => ({
    name: n,
    url: `/api/gallery/file?root=${q(String(s.root))}&sub=${q(s.sub)}&name=${q(n)}`,
    type: VID.has(path.extname(n).toLowerCase()) ? 'video' : 'image',
  }));
}

// Light cache so a 60s page-poll doesn't re-scan every folder each request.
let _cache: { ts: number; sections: GallerySection[] } | null = null;
const TTL_MS = 15_000;

export function getGallery(): GallerySection[] {
  const now = Date.now();
  if (_cache && now - _cache.ts < TTL_MS) return _cache.sections;
  const sections: GallerySection[] = [];
  for (const s of SOURCES) {
    if (!ROOTS[s.root]) continue;
    const files = listSection(s);
    if (files.length === 0) continue;
    sections.push({ id: s.id, title: s.title, desc: s.desc, count: files.length, files });
  }
  _cache = { ts: now, sections };
  return sections;
}

/** Drop the cached scan so the next /api/gallery reflects new files immediately
 *  (called after a generation so the new image shows without the 15s wait). */
export function invalidateGalleryCache(): void {
  _cache = null;
}

export function galleryMime(name: string): string {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// Resolve a requested file to an absolute path, guaranteeing it stays inside the
// declared section folder (no path traversal). Returns null if invalid/missing.
export function resolveGalleryFile(root: string, sub: string, name: string): string | null {
  if (!ALLOWED.has(`${root}|${sub}`)) return null;
  const base = ROOTS[root];
  if (!base || !name) return null;
  // Sections are flat: `name` must be a bare filename. Reject any path
  // separator, null byte, or '..' up front so a request can never resolve into
  // a subfolder of the section or escape it.
  if (/[\\/\0]/.test(name) || name.includes('..')) return null;
  const dir = sub ? path.join(base, sub) : base;
  const full = path.resolve(dir, name);
  // `full` must be a direct child of `dir` (belt-and-suspenders after the above).
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
  try {
    // lstat (not stat) so a symlink planted in a section folder can't point out.
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return full;
}
