import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { useState } from 'preact/hooks';
import { Sparkles, Moon, TrendingUp, FileText, ExternalLink, BookMarked, ClipboardCheck, Target } from 'lucide-preact';
import { apiPost } from '@/lib/api';

interface PsychCard {
  id: string;
  leak: string;
  source: string;
  title: string;
  quote: string;
  idea: string;
  evidence: string;
  drill: string;
}

interface PsychCardDay {
  day: string;
  card: PsychCard;
  deckSize: number;
}

const LEAK_LABEL: Record<string, string> = {
  'sizing': 'Sizing (F)', 'chase': 'Chasing (C)', 'dead-bag': 'Holding losers (C)',
  'early-exit': 'Selling early (B)', 'options': 'Options (D)', 'process': 'Process',
};

interface TodayTransits {
  day: string;   // YYYY-MM-DD (ET)
  text: string;  // plain-text reading from the Swiss Ephemeris script
}

interface DailyDrill {
  day: string;
  id: string;
  category: string;
  assetClass: string;
  sizeUsd: number;
  setup: string;
  question: string;
  choices: { key: string; label: string }[];
  entryIdx: number;
  decisionIdx: number;
  answered: boolean;
  series: { dates: string[]; vals: number[] };
  // present only after answering:
  choice?: string;
  correct?: string;
  wasCorrect?: boolean;
  symbol?: string;
  whatHappened?: string;
  lesson?: string;
  rule?: string;
  pnlUsd?: number;
  pnlPct?: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  'biggest-loss': 'Hard Stop', 'dead-bag-ride': 'Dead Bag', 'early-exit': 'Early Exit', 'oversize': 'Oversize',
};

// Minimal price sparkline: white pre-decision path, blue post-decision reveal,
// green entry dot, amber decision dot — same read as the missionctrl Replay page.
function DrillSpark({ d }: { d: DailyDrill }) {
  const vals = d.series.vals;
  if (!vals?.length) return null;
  const W = 640, H = 120, PAD = 6;
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i: number) => PAD + (i / Math.max(1, vals.length - 1)) * (W - PAD * 2);
  const y = (v: number) => max === min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - PAD * 2);
  const cut = Math.min(d.decisionIdx, vals.length - 1);
  const pts = (from: number, to: number) =>
    vals.slice(from, to + 1).map((v, i) => `${x(from + i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full" role="img" aria-label="Price chart up to the decision point">
      <polyline points={pts(0, cut)} fill="none" stroke="var(--color-text)" stroke-width="1.6" stroke-opacity="0.85" />
      {d.answered && cut < vals.length - 1 && (
        <polyline points={pts(cut, vals.length - 1)} fill="none" stroke="#4f9cf9" stroke-width="1.6" />
      )}
      {d.entryIdx >= 0 && d.entryIdx < vals.length && (
        <circle cx={x(d.entryIdx)} cy={y(vals[d.entryIdx])} r="3.5" fill="#34d399" />
      )}
      <circle cx={x(cut)} cy={y(vals[cut])} r="3.5" fill="#fbbf24" />
    </svg>
  );
}

interface WeeklyReviews {
  weeks: string[];
  latest: { week: string; text: string } | null;
}

// Reports are markdown with the review inside a ``` fence — show just the body.
function reviewBody(text: string): string {
  return text.split('\n').filter((l) => !l.startsWith('```') && !l.startsWith('# ')).join('\n').trim();
}

interface ReadingMeta {
  file: string;
  title: string;
  group: 'full' | 'trading' | 'short';
  blurb: string;
  sizeKb: number;
  modified: string;
}

const GROUPS: { key: ReadingMeta['group']; label: string; icon: typeof Sparkles; note: string }[] = [
  { key: 'full', label: 'Full Editions', icon: Sparkles, note: 'The complete deep-dive readings (Jul 12).' },
  { key: 'trading', label: 'Trading Cross-Read', icon: TrendingUp, note: 'Your chart mapped against 5 years of real Robinhood/Coinbase fills.' },
  { key: 'short', label: 'Short Versions', icon: FileText, note: 'The original condensed readings (Jul 10).' },
];

export function Astrology() {
  const res = useFetch<{ readings: ReadingMeta[] }>('/api/astrology/readings', 300_000);
  const today = useFetch<TodayTransits>('/api/astrology/today', 3_600_000);
  const psych = useFetch<PsychCardDay>('/api/astrology/psych-card', 3_600_000);
  const reviews = useFetch<WeeklyReviews>('/api/astrology/weekly-review', 3_600_000);
  const [reviewWeek, setReviewWeek] = useState<string | null>(null);
  const pastReview = useFetch<{ week: string; text: string }>(
    reviewWeek ? `/api/astrology/weekly-review?week=${reviewWeek}` : null,
    3_600_000,
  );
  const shownReview = reviewWeek ? pastReview.data : reviews.data?.latest;
  const readings = res.data?.readings ?? [];

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Astrology" />

      {res.error && <PageState error={res.error} />}
      {!res.error && res.loading && !res.data && <PageState loading />}

      {res.data && (
        <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-[900px]">
          <div class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <Moon size={18} class="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            <div class="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
              <span class="text-[var(--color-text)] font-medium">Born Nov 3, 1992 · 10:46 PM · Dunedin FL</span>
              {' — '}Sun 11° Scorpio (4H) · Moon 1° Pisces (8H) · Cancer Rising + Mars · Aries MC.
              A fresh transit reading also lands in Telegram (trading_command) every morning at 8:32 ET.
            </div>
          </div>

          {/* Today's transits — same Swiss Ephemeris engine as the 8:32 ET Telegram send */}
          <section>
            <div class="mb-2 flex items-center gap-2">
              <Moon size={15} class="text-[var(--color-accent)]" />
              <h2 class="text-[13.5px] font-semibold text-[var(--color-text)]">Today's Transits</h2>
              <span class="text-[11px] text-[var(--color-text-faint)]">
                {today.data ? `${today.data.day} ET · live ephemeris` : today.error ? 'unavailable' : 'computing…'}
              </span>
            </div>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
              {today.data ? (
                <pre class="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{today.data.text}</pre>
              ) : today.error ? (
                <div class="text-[12.5px] text-[var(--color-text-muted)]">
                  Couldn't compute today's transits ({today.error}). The 8:32 AM ET Telegram send still runs independently.
                </div>
              ) : (
                <div class="text-[12.5px] text-[var(--color-text-faint)]">Casting today's sky…</div>
              )}
            </div>
          </section>

          {/* Daily psych card — same deterministic pick as the missionctrl deck + 8:30 ET TG send */}
          {psych.data && (
            <section>
              <div class="mb-2 flex items-center gap-2">
                <BookMarked size={15} class="text-[var(--color-accent)]" />
                <h2 class="text-[13.5px] font-semibold text-[var(--color-text)]">Card of the Day</h2>
                <span class="text-[11px] text-[var(--color-text-faint)]">
                  {LEAK_LABEL[psych.data.card.leak] ?? psych.data.card.leak} · deck of {psych.data.deckSize}
                </span>
              </div>
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 space-y-2.5">
                <div class="text-[13.5px] font-semibold text-[var(--color-text)]">
                  {psych.data.card.title} <span class="font-normal text-[var(--color-text-faint)]">· {psych.data.card.source}</span>
                </div>
                <blockquote class="border-l-2 border-[var(--color-accent)] pl-3 text-[12.5px] italic leading-relaxed text-[var(--color-text-muted)]">
                  “{psych.data.card.quote}”
                </blockquote>
                <div class="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{psych.data.card.idea}</div>
                <div class="text-[12px] leading-snug">
                  <span class="font-semibold text-[var(--color-text)]">📊 Your evidence: </span>
                  <span class="text-[var(--color-text-muted)]">{psych.data.card.evidence}</span>
                </div>
                <div class="text-[12px] leading-snug">
                  <span class="font-semibold text-[var(--color-text)]">🎯 The drill: </span>
                  <span class="text-[var(--color-text-muted)]">{psych.data.card.drill}</span>
                </div>
                <a
                  href={`${location.protocol}//${location.hostname}:3000/?page=psych-cards`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--color-accent)] hover:underline"
                >
                  Full 16-card deck <ExternalLink size={11} />
                </a>
              </div>
            </section>
          )}

          {/* Weekly graded fill review — written by the Sunday 11:00 ET coach cron */}
          {reviews.data && (
            <section>
              <div class="mb-2 flex items-center gap-2">
                <ClipboardCheck size={15} class="text-[var(--color-accent)]" />
                <h2 class="text-[13.5px] font-semibold text-[var(--color-text)]">Weekly Graded Review</h2>
                {reviews.data.weeks.length > 1 ? (
                  <select
                    value={reviewWeek ?? reviews.data.latest?.week ?? ''}
                    onChange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      setReviewWeek(v === reviews.data?.latest?.week ? null : v);
                    }}
                    class="h-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 text-[11px] text-[var(--color-text-muted)]"
                    aria-label="Pick review week"
                  >
                    {reviews.data.weeks.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                ) : (
                  <span class="text-[11px] text-[var(--color-text-faint)]">
                    {reviews.data.latest ? `week ending ${reviews.data.latest.week}` : ''} · Sundays 11:00 ET
                  </span>
                )}
              </div>
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
                {shownReview ? (
                  <pre class="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{reviewBody(shownReview.text)}</pre>
                ) : (
                  <div class="text-[12.5px] text-[var(--color-text-muted)]">
                    No review yet — the first one lands after the Sunday 11:00 ET run.
                  </div>
                )}
              </div>
            </section>
          )}

          {GROUPS.map((g) => {
            const items = readings.filter((r) => r.group === g.key);
            if (items.length === 0) return null;
            const GIcon = g.icon;
            return (
              <section key={g.key}>
                <div class="mb-2 flex items-center gap-2">
                  <GIcon size={15} class="text-[var(--color-accent)]" />
                  <h2 class="text-[13.5px] font-semibold text-[var(--color-text)]">{g.label}</h2>
                  <span class="text-[11px] text-[var(--color-text-faint)]">{g.note}</span>
                </div>
                <div class="grid gap-3 md:grid-cols-2">
                  {items.map((r) => (
                    <a
                      key={r.file}
                      href={`/astrology/readings/${r.file}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="group flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-elevated)]"
                    >
                      <div class="flex items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--color-text)]">{r.title}</span>
                        <ExternalLink size={13} class="shrink-0 text-[var(--color-text-faint)] transition-colors group-hover:text-[var(--color-accent)]" />
                      </div>
                      {r.blurb && <div class="text-[12px] leading-snug text-[var(--color-text-muted)]">{r.blurb}</div>}
                      <div class="text-[10.5px] text-[var(--color-text-faint)]">{r.sizeKb} KB</div>
                    </a>
                  ))}
                </div>
              </section>
            );
          })}

          {readings.length === 0 && (
            <div class="text-[13px] text-[var(--color-text-muted)]">
              No readings found in data/astrology/ — drop HTML readings there and refresh.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
