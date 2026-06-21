// Live Apps — status layer for the /live-apps page (B2 of the signal-monitor plan).
// Goal: run the signal apps' REAL Android UI in the dashboard via redroid + ws-scrcpy.
// redroid needs a custom WSL2 kernel (binder/binderfs/dmabuf). Until the whole stack
// is up this page is a live setup tracker; once ws-scrcpy is reachable it embeds the app.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

// Default 8010 (8000 is taken by a local uvicorn service). Override via env.
const WS_SCRCPY_PORT = parseInt(process.env.WS_SCRCPY_PORT || '8010', 10);

// Kernel features can't change without a reboot → compute once and cache for the
// process lifetime.
let _kCache: { binder: boolean; binderfs: boolean; dmabuf: boolean; ready: boolean } | null = null;
function kernelFeatures() {
  if (_kCache) return _kCache;
  let binder = false, binderfs = false, dmabuf = false;
  // Runtime evidence (post-reboot truth).
  try { binderfs = readFileSync('/proc/filesystems', 'utf-8').includes('binder'); } catch { /* */ }
  try { dmabuf = existsSync('/dev/dma_heap'); } catch { /* */ }
  binder = binderfs || existsSync('/dev/binderfs') || existsSync('/dev/binder');
  // Config evidence (covers the running kernel even before /dev nodes appear).
  try {
    const out = spawnSync('zcat', ['/proc/config.gz'], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024, timeout: 3000 }).stdout || '';
    if (out.includes('CONFIG_ANDROID_BINDER_IPC=y')) binder = true;
    if (out.includes('CONFIG_ANDROID_BINDERFS=y')) binderfs = true;
    if (out.includes('CONFIG_DMABUF_HEAPS=y')) dmabuf = true;
  } catch { /* config not exposed */ }
  _kCache = { binder, binderfs, dmabuf, ready: binder && binderfs && dmabuf };
  return _kCache;
}

// IMPORTANT: call the NATIVE docker by absolute path. `docker` on PATH resolves to
// the Windows Docker Desktop shim (/mnt/c/...) which hangs here — and spawnSync blocks
// the whole event loop. Hard 4s timeout + 5s cache so the 5s page-poll stays cheap.
const DOCKER = '/usr/bin/docker';
const parsePs = (out: string) => out.trim().split('\n').filter(Boolean)
  .filter((l) => /redroid/i.test(l))
  .map((l) => { const [name, status, ports] = l.split('\t'); return { name, status: status || '', ports: ports || '' }; });

let _dCache: { at: number; val: any } | null = null;
function dockerStatus() {
  const now = Date.now();
  if (_dCache && now - _dCache.at < 5000) return _dCache.val;
  const present = existsSync(DOCKER);
  let daemonUp = false;
  let redroid: Array<{ name: string; status: string; ports: string }> = [];
  if (present) {
    const fmt = '{{.Names}}\t{{.Status}}\t{{.Ports}}';
    let ps = spawnSync(DOCKER, ['ps', '--format', fmt], { encoding: 'utf-8', timeout: 4000 });
    if (ps.status !== 0) ps = spawnSync('sudo', ['-n', DOCKER, 'ps', '--format', fmt], { encoding: 'utf-8', timeout: 4000 });
    if (ps.status === 0) { daemonUp = true; redroid = parsePs(ps.stdout || ''); }
  }
  const val = { present, daemonUp, redroid, anyUp: redroid.length > 0 };
  _dCache = { at: now, val };
  return val;
}

function tcpProbe(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const fin = (v: boolean) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => fin(true));
    sock.once('timeout', () => fin(false));
    sock.once('error', () => fin(false));
    sock.connect(port, '127.0.0.1');
  });
}

export async function getLiveAppsStatus(): Promise<any> {
  const kernel = kernelFeatures();
  const docker = dockerStatus();
  const reachable = await tcpProbe(WS_SCRCPY_PORT);
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    kernel,
    docker,
    wsScrcpy: { reachable, port: WS_SCRCPY_PORT, url: `http://localhost:${WS_SCRCPY_PORT}` },
    ready: kernel.ready && docker.anyUp && reachable,
  };
}
