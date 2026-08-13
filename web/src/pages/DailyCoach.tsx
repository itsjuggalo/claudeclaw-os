import { useState } from 'preact/hooks';
import { BookMarked, ClipboardCheck, Target, ExternalLink } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
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

export function DailyCoach() {
  const psych = useFetch<PsychCardDay>('/api/coach/psych-card', 3_600_000);
  const reviews = useFetch<WeeklyReviews>('/api/coach/weekly-review', 3_600_000);
  const drillFetch = useFetch<DailyDrill>('/api/coach/drill', 3_600_000);
  const [drillOverride, setDrillOverride] = useState<DailyDrill | null>(null);
  const [answering, setAnswering] = useState(false);
  const drill = drillOverride ?? drillFetch.data;
  const [reviewWeek, setReviewWeek] = useState<string | null>(null);
  const pastReview = useFetch<{ week: string; text: string }>(
    reviewWeek ? `/api/coach/weekly-review?week=${reviewWeek}` : null,
    3_600_000,
  );
  const shownReview = reviewWeek ? pastReview.data : reviews.data?.latest;
  const loading = psych.loading && drillFetch.loading && reviews.loading && !psych.data && !drillFetch.data && !reviews.data;

  async function answerDrill(choice: string) {
    if (answering || !drill || drill.answered) return;
    setAnswering(true);
    try { setDrillOverride(await apiPost<DailyDrill>('/api/coach/drill/answer', { choice })); }
    catch { /* leave unanswered on failure; next tap retries */ }
    finally { setAnswering(false); }
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Daily Coach" />

      {loading && <PageState loading />}

      <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-[900px]">
        {/* Drill of the day — blind replay from the worst-20 bank; first answer
            counts and lands in the same replay_results.json as missionctrl. */}
        {drill && (
          <section>
            <div class="mb-2 flex items-center gap-2">
              <Target size={15} class="text-[var(--color-accent)]" />
              <h2 class="text-[13.5px] font-semibold text-[var(--color-text)]">Drill of the Day</h2>
              <span class="text-[11px] text-[var(--color-text-faint)]">
                {CATEGORY_LABEL[drill.category] ?? drill.category} · {drill.answered ? drill.symbol : 'ticker hidden'} · ${drill.sizeUsd.toLocaleString()}
              </span>
            </div>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 space-y-3">
              <div class="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{drill.setup}</div>
              <DrillSpark d={drill} />
              <div class="text-[13px] font-medium text-[var(--color-text)]">{drill.question}</div>

              {!drill.answered ? (
                <div class="flex flex-col gap-2">
                  {drill.choices.map((ch) => (
                    <button
                      key={ch.key}
                      type="button"
                      disabled={answering}
                      onClick={() => void answerDrill(ch.key)}
                      class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-[12.5px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)] disabled:opacity-60"
                    >
                      {ch.label}
                    </button>
                  ))}
                  <div class="text-[10.5px] text-[var(--color-text-faint)]">First answer counts — scored into the same ledger as the Replay page.</div>
                </div>
              ) : (
                <div class="space-y-2">
                  <div class={`text-[13px] font-semibold ${drill.wasCorrect ? 'text-[#34d399]' : 'text-[var(--color-status-failed)]'}`}>
                    {drill.wasCorrect ? '✓ Correct' : '✕ Not the playbook call'}
                    <span class="ml-2 font-normal text-[var(--color-text-muted)]">
                      you: {drill.choices.find((ch) => ch.key === drill.choice)?.label ?? drill.choice}
                      {!drill.wasCorrect && ` · playbook: ${drill.choices.find((ch) => ch.key === drill.correct)?.label ?? drill.correct}`}
                    </span>
                  </div>
                  <div class="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
                    <span class="font-semibold text-[var(--color-text)]">{drill.symbol}: </span>{drill.whatHappened}
                  </div>
                  <div class="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{drill.lesson}</div>
                  {drill.rule && <div class="text-[11px] text-[var(--color-text-faint)]">rule: {drill.rule}</div>}
                </div>
              )}

              <a
                href={`${location.protocol}//${location.hostname}:3000/?page=replay`}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--color-accent)] hover:underline"
              >
                Full worst-20 replay bank <ExternalLink size={11} />
              </a>
            </div>
          </section>
        )}

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
      </div>
    </div>
  );
}
