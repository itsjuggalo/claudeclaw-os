// Astrology readings library — serves Mike's delivered HTML readings for the
// /astrology dashboard page. Files are self-contained HTML (dark-navy/gold)
// copied from OneDrive "From Claude To Mike" into data/astrology/. Read-only.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const HOME = process.env.HOME || '/home/itsju';
const DIR = join(HOME, 'agents/claudeclaw/data/astrology');
const PYTHON = join(HOME, '.venv/bin/python');
const TRANSITS_SCRIPT = join(HOME, 'scripts/real_coach/daily_transits.py');

export interface ReadingMeta {
  file: string;        // filename, e.g. mike-natal-reading-FULL.html
  title: string;
  group: 'full' | 'trading' | 'short';
  blurb: string;
  sizeKb: number;
  modified: string;    // ISO
}

// Curated metadata keyed by filename stem — anything in the dir but not here
// still shows up with a derived title so new readings appear automatically.
const META: Record<string, { title: string; group: ReadingMeta['group']; blurb: string }> = {
  'mike-natal-reading-FULL': { title: 'Natal Chart — Full Edition', group: 'full', blurb: 'The complete birth-chart reading: every placement, house, and aspect (Sun 11° Scorpio 4H, Moon 1° Pisces 8H, Cancer ASC + Mars).' },
  'mike-2026-transits-FULL': { title: '2026 Transits — Full Edition', group: 'full', blurb: 'Month-by-month 2026 transit map — all 12 months against the natal chart.' },
  'mike-career-reading-FULL': { title: 'Career Reading — Full Edition', group: 'full', blurb: 'Career + calling deep-dive: Aries MC, Capricorn 6H stellium, the builder signature.' },
  'mike-future-reading-FULL': { title: 'Future Outlook — Full Edition', group: 'full', blurb: 'Long-arc forecast 2026 → 2040: the major outer-planet chapters ahead.' },
  'mike-trading-chart-reading': { title: "Trader's Chart — Chart × Real Fills", group: 'trading', blurb: 'Your chart cross-read against 5 years of real Robinhood/Coinbase fills: Chiron 2H ↔ sizing, Sag 5H ↔ FOMO chases, water trinity ↔ long holds and bag-riding.' },
  'mike-natal-reading': { title: 'Natal Chart (short)', group: 'short', blurb: 'Original condensed natal reading (Jul 10).' },
  'mike-2026-transits': { title: '2026 Transits (short)', group: 'short', blurb: 'Original condensed 2026 transit overview (Jul 10).' },
  'mike-career-reading': { title: 'Career Reading (short)', group: 'short', blurb: 'Original condensed career reading (Jul 10).' },
  'mike-future-reading': { title: 'Future Outlook (short)', group: 'short', blurb: 'Original condensed future outlook (Jul 10).' },
};

function deriveTitle(stem: string): string {
  return stem.replace(/^mike-/, '').replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function listReadings(): ReadingMeta[] {
  if (!existsSync(DIR)) return [];
  const out: ReadingMeta[] = [];
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith('.html')) continue;
    const stem = file.replace(/\.html$/, '');
    const st = statSync(join(DIR, file));
    const m = META[stem];
    out.push({
      file,
      title: m?.title ?? deriveTitle(stem),
      group: m?.group ?? 'short',
      blurb: m?.blurb ?? '',
      sizeKb: Math.round(st.size / 1024),
      modified: st.mtime.toISOString(),
    });
  }
  const order = { full: 0, trading: 1, short: 2 } as const;
  out.sort((a, b) => order[a.group] - order[b.group] || a.title.localeCompare(b.title));
  return out;
}

// Today's transit reading — runs the same pyswisseph script the 8:32 ET
// Telegram cron uses (real ephemeris, no --send). Cached per ET calendar day.
let transitCache: { day: string; text: string } | null = null;

function etDay(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function getTodayTransits(): Promise<{ day: string; text: string }> {
  const day = etDay();
  if (transitCache && transitCache.day === day) return Promise.resolve(transitCache);
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [TRANSITS_SCRIPT], { timeout: 30_000 }, (err, stdout) => {
      if (err) return reject(new Error(`daily_transits failed: ${err.message}`));
      transitCache = { day, text: stdout.trim() };
      resolve(transitCache);
    });
  });
}

// Serve a reading's raw HTML. Filename is validated (no separators, must end
// .html) and must exist inside DIR — no path traversal.
export function readReadingHtml(file: string): string | null {
  if (!/^[\w.-]+\.html$/.test(file) || file.includes('..')) return null;
  const path = join(DIR, file);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}
