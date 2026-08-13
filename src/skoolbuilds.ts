// Skool Builds — surfaces artifacts produced by running Skool classroom prompts
// (e.g. the "Free Plan Unlocked" TradingView prompt from the zero-one community).
// Each build records the source lesson/video and the files it generated, so the
// dashboard can show "what was created from the skool prompt" and read each file.
//
// Manifest lives in the daemon data dir (durable, survives rebuilds):
//   ~/.claudeclaw/skool-builds.json
// Append a new build object to `builds` after running the next prompt/video.
//
// Read-only: this module lists builds and serves the declared artifact files.
// Only files explicitly listed in the manifest are readable (allow-list), so
// the file route can never be coaxed into reading arbitrary paths.
import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || '/home/itsju';
const MANIFEST = path.join(HOME, '.claudeclaw', 'skool-builds.json');
const MAX_FILE_BYTES = 512 * 1024; // cap inline file reads at 512 KB

export interface SkoolBuildFile {
  name: string;
  path: string;
  lang?: string;
  label?: string;
  // hydrated at read time:
  exists?: boolean;
  bytes?: number;
  lines?: number;
}
export interface SkoolBuild {
  id: string;
  title: string;
  community?: string;
  communityTitle?: string;
  lesson?: string;
  sourceUrl?: string;
  video?: string;
  createdAt?: string;
  status?: string;
  kind?: string;
  tags?: string[];
  summary?: string;
  files: SkoolBuildFile[];
}

function loadManifest(): SkoolBuild[] {
  try {
    const raw = fs.readFileSync(MANIFEST, 'utf-8');
    const parsed = JSON.parse(raw);
    const builds = Array.isArray(parsed?.builds) ? parsed.builds : [];
    return builds as SkoolBuild[];
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

/** List all builds with each file hydrated (exists / size / line count). */
export function getSkoolBuilds(): SkoolBuild[] {
  return loadManifest().map((b) => ({
    ...b,
    files: (b.files || []).map((f) => ({ ...f, ...statFile(f.path) })),
  }));
}

/** Return the text content of a declared artifact, looked up by (build id, file
 *  name). Returns null if the build/file isn't in the manifest or is missing. */
export function readSkoolArtifact(
  buildId: string,
  fileName: string,
): { name: string; lang: string; content: string; truncated: boolean } | null {
  const build = loadManifest().find((b) => b.id === buildId);
  if (!build) return null;
  const file = (build.files || []).find((f) => f.name === fileName);
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
