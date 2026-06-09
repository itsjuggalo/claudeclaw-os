import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  BookOpen, RefreshCw, ChevronRight, ChevronLeft, ChevronDown, Calendar,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';

interface ListResp { days: string[]; }
interface JournalResp {
  date: string;
  content: string;
  mtime?: string;
  bytes?: number;
  missing?: boolean;
}

// ── Markdown structure parser ───────────────────────────────────────
// The journal dir holds heterogeneous docs (Boba/Jazzy cycle logs, grade
// reports, account snapshots…). Rather than special-case agents, parse
// generically: every `##` is a collapsible section, every `###` a
// collapsible sub-card. The Raw toggle is the fallback if anything looks
// off. No backend change — we parse the same /api/journal/get markdown.

interface Subsection { heading: string; body: string[]; }
interface Section { heading: string; preamble: string[]; subs: Subsection[]; }
interface Parsed {
  title: string;
  intro: string[];
  sections: Section[];
  rollup: { sections: number; cycles: number; executed: number; passed: number } | null;
}

const COUNTS_RE = /\*\*Picks executed:\*\*\s*(\d+)(?:[\s\S]*?\*\*Passed on:\*\*\s*(\d+))?(?:[\s\S]*?\*\*Position actions:\*\*\s*(\d+))?/;

function parseJournal(md: string): Parsed {
  const lines = md.split('\n');
  let title = '';
  const intro: string[] = [];
  const sections: Section[] = [];
  let cur: Section | null = null;
  let curSub: Subsection | null = null;

  for (const line of lines) {
    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    if (h2) {
      cur = { heading: h2[1].trim(), preamble: [], subs: [] };
      curSub = null;
      sections.push(cur);
      continue;
    }
    if (h3 && cur) {
      curSub = { heading: h3[1].trim(), body: [] };
      cur.subs.push(curSub);
      continue;
    }
    if (!cur) {
      if (h1 && !title) { title = h1[1].trim(); continue; }
      intro.push(line);
      continue;
    }
    if (curSub) curSub.body.push(line);
    else cur.preamble.push(line);
  }

  let cycles = 0, executed = 0, passed = 0;
  for (const s of sections) {
    for (const sub of s.subs) {
      if (/cycle summary/i.test(sub.heading)) cycles++;
      const st = cycleStats(sub.body);
      if (st) { executed += st.executed ?? 0; passed += st.passed ?? 0; }
    }
  }
  const rollup = cycles > 0 ? { sections: sections.length, cycles, executed, passed } : null;
  return { title, intro: trimBlank(intro), sections, rollup };
}

function cycleStats(body: string[]): { executed?: number; passed?: number; positions?: number } | null {
  const m = COUNTS_RE.exec(body.join('\n'));
  if (!m) return null;
  return {
    executed: m[1] != null ? +m[1] : undefined,
    passed: m[2] != null ? +m[2] : undefined,
    positions: m[3] != null ? +m[3] : undefined,
  };
}

function sectionStats(s: Section): { cycles: number; executed: number; passed: number } {
  let cycles = 0, executed = 0, passed = 0;
  for (const sub of s.subs) {
    if (/cycle summary/i.test(sub.heading)) cycles++;
    const st = cycleStats(sub.body);
    if (st) { executed += st.executed ?? 0; passed += st.passed ?? 0; }
  }
  return { cycles, executed, passed };
}

function trimBlank(lines: string[]): string[] {
  let a = 0, b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

function cycleLabel(heading: string): string {
  const m = /^\d{4}-\d{2}-\d{2}\s+(\d{2}):(\d{2})(?::\d{2})?\s*(UTC)?/.exec(heading);
  if (m) return `${m[1]}:${m[2]}${m[3] ? ' UTC' : ''}`;
  return heading.replace(/\s*—\s*cycle summary\s*$/i, '');
}

function fmtDay(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Inline + block markdown rendering (lightweight) ─────────────────

function renderInline(text: string): ComponentChildren {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const b = /^\*\*([^*]+)\*\*$/.exec(p);
    return b
      ? <strong key={i} class="text-[var(--color-text)] font-semibold">{b[1]}</strong>
      : <span key={i}>{p}</span>;
  });
}

function MiniMd({ lines }: { lines: string[] }) {
  const blocks: ComponentChildren[] = [];
  let bullets: string[] = [];
  let table: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`u${blocks.length}`} class="my-1 space-y-0.5 pl-1">
        {bullets.map((b, i) => (
          <li key={i} class="flex gap-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug">
            <span class="text-[var(--color-text-faint)] mt-[1px]">·</span>
            <span>{renderInline(b)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    blocks.push(
      <pre key={`t${blocks.length}`} class="my-1 overflow-x-auto text-[11px] font-mono text-[var(--color-text-muted)] leading-relaxed">{table.join('\n')}</pre>,
    );
    table = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^[-*]\s+/.test(line)) { flushTable(); bullets.push(line.replace(/^[-*]\s+/, '')); continue; }
    if (/^\s*\|.*\|/.test(line)) { flushBullets(); table.push(line); continue; }
    flushBullets(); flushTable();
    if (line.trim() === '') continue;
    if (line.startsWith('> ')) {
      blocks.push(
        <div key={`q${blocks.length}`} class="my-1 pl-2.5 border-l-2 border-[var(--color-accent)] text-[12.5px] text-[var(--color-text)] italic leading-snug">
          {renderInline(line.slice(2))}
        </div>,
      );
      continue;
    }
    blocks.push(
      <div key={`p${blocks.length}`} class="my-0.5 text-[12px] text-[var(--color-text-muted)] leading-snug">
        {renderInline(line)}
      </div>,
    );
  }
  flushBullets(); flushTable();
  return <div>{blocks}</div>;
}

// ── Collapsible ─────────────────────────────────────────────────────

function Collapsible({
  title, badge, defaultOpen, accent, children,
}: {
  title: ComponentChildren;
  badge?: ComponentChildren;
  defaultOpen: boolean;
  accent?: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-card)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-elevated)] transition-colors"
      >
        {open
          ? <ChevronDown size={14} class="text-[var(--color-text-faint)] shrink-0" />
          : <ChevronRight size={14} class="text-[var(--color-text-faint)] shrink-0" />}
        <span class={[
          'flex-1 min-w-0 truncate text-[13px]',
          accent ? 'font-semibold text-[var(--color-text)]' : 'font-medium text-[var(--color-text)]',
        ].join(' ')}>{title}</span>
        {badge && <span class="shrink-0 text-[10.5px] text-[var(--color-text-faint)] tabular-nums">{badge}</span>}
      </button>
      {open && <div class="px-3 pb-3 pt-0.5">{children}</div>}
    </div>
  );
}

function CountChips({ executed, passed, positions }: { executed?: number; passed?: number; positions?: number }) {
  const chips: ComponentChildren[] = [];
  if (executed != null) chips.push(<span key="e" class="text-[var(--color-status-done,#10b981)]">✓{executed}</span>);
  if (passed != null) chips.push(<span key="p">×{passed}</span>);
  if (positions != null && positions > 0) chips.push(<span key="o">⟳{positions}</span>);
  if (!chips.length) return null;
  return <span class="flex items-center gap-1.5">{chips}</span>;
}

// ── Page ────────────────────────────────────────────────────────────

export function Journal() {
  const [days, setDays] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [mtime, setMtime] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);

  async function loadDays() {
    try {
      const r = await apiGet<ListResp>('/api/journal/list');
      setDays(r.days);
      if (r.days.length > 0 && !selected) setSelected(r.days[0]); // newest
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }

  async function loadDay(date: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await apiGet<JournalResp>(`/api/journal/get?date=${date}`);
      setContent(r.content || '');
      setMtime(r.mtime || '');
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDays(); }, []);
  useEffect(() => { if (selected) void loadDay(selected); }, [selected]);
  // Refresh selected day every 60s — picks up cron-driven journal updates.
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => { void loadDay(selected); }, 60_000);
    return () => clearInterval(id);
  }, [selected]);

  const parsed = useMemo(() => (content ? parseJournal(content) : null), [content]);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Journal"
        actions={
          <>
            {mtime && (
              <span class="text-[11px] text-[var(--color-text-faint)] tabular-nums mr-1">
                updated {new Date(mtime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <div class="inline-flex bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setRaw(false)}
                class={['px-2 py-0.5 rounded transition-colors', !raw ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'].join(' ')}
              >Formatted</button>
              <button
                type="button"
                onClick={() => setRaw(true)}
                class={['px-2 py-0.5 rounded transition-colors', raw ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'].join(' ')}
              >Raw</button>
            </div>
          </>
        }
      />

      {/* Compact day picker */}
      <div class="px-4 pt-3 pb-2 border-b border-[var(--color-border)] flex items-center gap-2 flex-wrap">
        <DayPicker days={days} selected={selected} onSelect={setSelected} />
        <button
          type="button"
          onClick={() => { void loadDays(); if (selected) void loadDay(selected); }}
          class="px-2 py-1 text-[11px] rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] flex items-center gap-1"
          title="Refresh"
        >
          <RefreshCw size={12} /> refresh
        </button>
        {parsed?.rollup && (
          <span class="text-[11px] text-[var(--color-text-faint)] tabular-nums ml-1">
            {parsed.rollup.cycles} cycles · ✓{parsed.rollup.executed} executed · ×{parsed.rollup.passed} passed
          </span>
        )}
        {loading && <span class="text-[11px] text-[var(--color-text-faint)]">loading…</span>}
      </div>

      <div class="flex-1 overflow-auto px-4 py-4">
        {error && (
          <div class="p-3 rounded-md border border-[var(--color-status-failed)] text-[var(--color-status-failed)] text-[12.5px] mb-3 font-mono break-all">
            {error}
          </div>
        )}
        {!selected && (
          <PageState
            empty
            emptyTitle="No journal selected"
            emptyDescription="Once Boba/Jazzy run their first cycle today, the journal_writer cron (every 5 min on Oracle) produces today's entry."
          />
        )}
        {selected && !content && !loading && (
          <PageState
            empty
            emptyTitle={`No content for ${selected}`}
            emptyDescription="The file exists or will exist shortly. Check back after the next cycle."
          />
        )}

        {/* Raw fallback — exact original view */}
        {content && raw && (
          <pre class="text-[12px] leading-[1.55] whitespace-pre-wrap break-words text-[var(--color-text)] bg-[var(--color-card)] p-4 rounded-lg border border-[var(--color-border)]"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace' }}>{content}</pre>
        )}

        {/* Formatted view */}
        {content && !raw && parsed && (
          <div class="space-y-2 max-w-3xl">
            {parsed.title && (
              <h2 class="text-[15px] font-semibold text-[var(--color-text)]">{parsed.title}</h2>
            )}
            {parsed.intro.length > 0 && (
              <p class="text-[11.5px] text-[var(--color-text-faint)] leading-snug">
                {parsed.intro.join(' ')}
              </p>
            )}
            {parsed.sections.length === 0 && (
              <MiniMd lines={parsed.intro} />
            )}
            {parsed.sections.map((s) => {
              const st = sectionStats(s);
              const badge = st.cycles > 0
                ? `${st.cycles} cyc · ✓${st.executed} ×${st.passed}`
                : (s.subs.length > 0 ? `${s.subs.length}` : undefined);
              return (
                <Collapsible key={s.heading} title={s.heading} badge={badge} defaultOpen accent>
                  {s.preamble.some((l) => l.trim() !== '') && (
                    <div class="mb-1.5"><MiniMd lines={trimBlank(s.preamble)} /></div>
                  )}
                  {s.subs.length > 0 && (
                    <div class="space-y-1.5">
                      {s.subs.map((sub) => {
                        const stats = cycleStats(sub.body);
                        const isCycle = /cycle summary/i.test(sub.heading);
                        return (
                          <Collapsible
                            key={sub.heading}
                            defaultOpen
                            title={isCycle ? cycleLabel(sub.heading) : sub.heading}
                            badge={stats ? <CountChips {...stats} /> : undefined}
                          >
                            <MiniMd lines={trimBlank(sub.body)} />
                          </Collapsible>
                        );
                      })}
                    </div>
                  )}
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Day picker: ‹ Prev | date ▾ | Next › ────────────────────────────

function DayPicker({ days, selected, onSelect }: { days: string[]; selected: string; onSelect: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const idx = days.indexOf(selected);
  const olderIdx = idx + 1;       // days sorted newest-first
  const newerIdx = idx - 1;
  const hasOlder = olderIdx >= 0 && olderIdx < days.length;
  const hasNewer = newerIdx >= 0;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  if (days.length === 0) {
    return <span class="text-[11px] text-[var(--color-text-faint)]">no journal entries yet</span>;
  }

  return (
    <div ref={ref} class="relative inline-flex items-center">
      <button
        type="button"
        disabled={!hasOlder}
        onClick={() => hasOlder && onSelect(days[olderIdx])}
        class="p-1 rounded-l-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Older day"
      >
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="inline-flex items-center gap-1.5 px-2.5 py-1 border-y border-[var(--color-border)] text-[12px] text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors min-w-[120px] justify-center"
      >
        <Calendar size={12} class="text-[var(--color-text-faint)]" />
        {fmtDay(selected)}
        <ChevronDown size={12} class="text-[var(--color-text-faint)]" />
      </button>
      <button
        type="button"
        disabled={!hasNewer}
        onClick={() => hasNewer && onSelect(days[newerIdx])}
        class="p-1 rounded-r-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Newer day"
      >
        <ChevronRight size={14} />
      </button>

      {open && (
        <div class="absolute left-0 top-full mt-1 z-50 w-[180px] max-h-[280px] overflow-y-auto bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-2xl py-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { onSelect(d); setOpen(false); }}
              class={[
                'w-full flex items-center justify-between px-3 py-1.5 text-[12px] hover:bg-[var(--color-elevated)] transition-colors',
                d === selected ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)]',
              ].join(' ')}
            >
              <span>{fmtDay(d)}</span>
              <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums">{d}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
