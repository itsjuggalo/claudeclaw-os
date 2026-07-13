// Astrology readings library — serves Mike's delivered HTML readings for the
// /astrology dashboard page. Files are self-contained HTML (dark-navy/gold)
// copied from OneDrive "From Claude To Mike" into data/astrology/. Read-only.
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, renameSync } from 'node:fs';
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

// Daily psych card — same deck + deterministic date formula as the missionctrl
// Psych Cards page and the 8:30 ET Telegram send (year*372 + month*31 + day,
// mod deck size, ET calendar day), so all three always show the same card.
const PSYCH_DECK = join(HOME, 'portfolio/psych_cards.json');

export interface PsychCard {
  id: string;
  leak: string;
  source: string;
  title: string;
  quote: string;
  idea: string;
  evidence: string;
  drill: string;
}

export function getDailyPsychCard(): { day: string; card: PsychCard; deckSize: number } | null {
  if (!existsSync(PSYCH_DECK)) return null;
  const cards: PsychCard[] = JSON.parse(readFileSync(PSYCH_DECK, 'utf8')).cards;
  if (!cards?.length) return null;
  const day = etDay(); // YYYY-MM-DD in ET
  const [y, m, d] = day.split('-').map(Number);
  const idx = (y * 372 + m * 31 + d) % cards.length;
  return { day, card: cards[idx], deckSize: cards.length };
}

// Weekly graded fill review — markdown reports written by the Sunday 11:00 ET
// cron (~/scripts/real_coach/weekly_review.py) into ~/portfolio/weekly_reviews/.
const REVIEWS_DIR = join(HOME, 'portfolio/weekly_reviews');

export function getWeeklyReviews(): { weeks: string[]; latest: { week: string; text: string } | null } {
  if (!existsSync(REVIEWS_DIR)) return { weeks: [], latest: null };
  const weeks = readdirSync(REVIEWS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ''))
    .sort()
    .reverse();
  if (weeks.length === 0) return { weeks, latest: null };
  const text = readFileSync(join(REVIEWS_DIR, `${weeks[0]}.md`), 'utf8').trim();
  return { weeks, latest: { week: weeks[0], text } };
}

export function getWeeklyReview(week: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  const path = join(REVIEWS_DIR, `${week}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim();
}

// Drill of the day — deterministic date-pick from the worst-20 replay bank
// (~/portfolio/replay_drills.json). Answers append to the SAME results file
// the missionctrl Replay page uses (first answer counts), so scores stay in
// sync across both dashboards. Blind until answered: no symbol / correct /
// reveal / post-decision chart data leaves the server before an answer lands.
const DRILLS_FILE = join(HOME, 'portfolio/replay_drills.json');
const DRILL_RESULTS_FILE = join(HOME, 'portfolio/replay_results.json');

interface DrillRecord {
  id: string; category: string; choice_set: string; symbol: string;
  asset_class: string; size_usd: number; pnl_usd: number; pnl_pct: number;
  max_drawdown_pct: number; hold_days: number;
  series: { dates: string[]; vals: number[]; entry_idx: number };
  decision_idx: number; setup: string; question: string;
  choices: { key: string; label: string }[]; correct: string;
  what_happened: string; lesson: string; rule: string;
}

interface DrillResult { drill_id: string; choice: string; correct: boolean; at: string }

function loadDrills(): DrillRecord[] {
  if (!existsSync(DRILLS_FILE)) return [];
  return JSON.parse(readFileSync(DRILLS_FILE, 'utf8')).drills ?? [];
}

function loadDrillResults(): DrillResult[] {
  if (!existsSync(DRILL_RESULTS_FILE)) return [];
  try { return JSON.parse(readFileSync(DRILL_RESULTS_FILE, 'utf8')); } catch { return []; }
}

function drillOfDay(drills: DrillRecord[]): DrillRecord {
  const [y, m, d] = etDay().split('-').map(Number);
  return drills[(y * 372 + m * 31 + d) % drills.length];
}

export function getDailyDrill(): Record<string, unknown> | null {
  const drills = loadDrills();
  if (drills.length === 0) return null;
  const drill = drillOfDay(drills);
  const first = loadDrillResults().find((r) => r.drill_id === drill.id);
  const s = drill.series;
  const base = {
    day: etDay(),
    id: drill.id,
    category: drill.category,
    assetClass: drill.asset_class,
    sizeUsd: drill.size_usd,
    setup: drill.setup,
    question: drill.question,
    choices: drill.choices,
    entryIdx: s.entry_idx,
    decisionIdx: drill.decision_idx,
  };
  if (!first) {
    return {
      ...base,
      answered: false,
      series: { dates: s.dates.slice(0, drill.decision_idx + 1), vals: s.vals.slice(0, drill.decision_idx + 1) },
    };
  }
  return {
    ...base,
    answered: true,
    choice: first.choice,
    correct: drill.correct,
    wasCorrect: first.choice === drill.correct,
    symbol: drill.symbol,
    whatHappened: drill.what_happened,
    lesson: drill.lesson,
    rule: drill.rule,
    pnlUsd: drill.pnl_usd,
    pnlPct: drill.pnl_pct,
    series: s,
  };
}

export function answerDailyDrill(choice: string): Record<string, unknown> | null {
  const drills = loadDrills();
  if (drills.length === 0) return null;
  const drill = drillOfDay(drills);
  if (!drill.choices.some((c) => c.key === choice)) throw new Error(`invalid choice: ${choice}`);
  const results = loadDrillResults();
  // First answer counts — a repeat submit doesn't overwrite the recorded one.
  if (!results.some((r) => r.drill_id === drill.id)) {
    results.push({ drill_id: drill.id, choice, correct: choice === drill.correct, at: new Date().toISOString() });
    const tmp = `${DRILL_RESULTS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(results, null, 2));
    renameSync(tmp, DRILL_RESULTS_FILE);
  }
  return getDailyDrill();
}

// Serve a reading's raw HTML. Filename is validated (no separators, must end
// .html) and must exist inside DIR — no path traversal.
export function readReadingHtml(file: string): string | null {
  if (!/^[\w.-]+\.html$/.test(file) || file.includes('..')) return null;
  const path = join(DIR, file);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}
