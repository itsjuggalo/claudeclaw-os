import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { Sparkles, Moon, TrendingUp, FileText, ExternalLink } from 'lucide-preact';

interface TodayTransits {
  day: string;   // YYYY-MM-DD (ET)
  text: string;  // plain-text reading from the Swiss Ephemeris script
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
