import { useState, useEffect } from 'preact/hooks';
import { BookOpen, RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';

interface ListResp {
  days: string[];
}

interface JournalResp {
  date: string;
  content: string;
  mtime?: string;
  bytes?: number;
  missing?: boolean;
}

export function Journal() {
  const [days, setDays] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [mtime, setMtime] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDays() {
    try {
      const r = await apiGet<ListResp>('/api/journal/list');
      setDays(r.days);
      if (r.days.length > 0 && !selected) {
        setSelected(r.days[0]); // newest
      }
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
  useEffect(() => {
    if (selected) void loadDay(selected);
  }, [selected]);

  // Refresh selected day every 60s — picks up cron-driven journal updates.
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => { void loadDay(selected); }, 60_000);
    return () => clearInterval(id);
  }, [selected]);

  const mtimeBadge = mtime
    ? <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>
        last updated {new Date(mtime).toLocaleString()}
      </span>
    : <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>—</span>;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        icon={BookOpen}
        title="Journal"
        subtitle="Daily reasoning trail for Boba / Jazzy / stock-auto-trader / crypto-executor"
        right={mtimeBadge}
        tabs={[]}
      />

      {/* Day selector + refresh */}
      <div class="px-4 pt-3 pb-2 border-b border-[var(--color-border)] flex items-center gap-3 flex-wrap">
        <span class="text-xs text-[var(--color-muted)]">Day:</span>
        {days.length === 0 ? (
          <span class="text-xs text-[var(--color-muted)]">no journal entries yet</span>
        ) : (
          <select
            value={selected}
            onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
            class="px-2 py-1 text-xs rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)]"
          >
            {days.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={() => { void loadDays(); if (selected) void loadDay(selected); }}
          class="px-2 py-1 text-xs rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent)] flex items-center gap-1"
          title="Refresh"
        >
          <RefreshCw size={12} /> refresh
        </button>
        {loading && <span class="text-xs text-[var(--color-muted)]">loading…</span>}
      </div>

      {/* Content — render markdown as monospace text. The journal is generated
          by Oracle's journal_writer.py and is human-readable as-is. */}
      <div class="flex-1 overflow-auto px-4 py-4">
        {error && (
          <div class="p-3 rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] text-[var(--color-error)] text-sm mb-3">
            {error}
          </div>
        )}
        {!selected && (
          <PageState
            icon={BookOpen}
            title="No journal selected"
            description="Once Boba/Jazzy run their first cycle today, the journal_writer cron (every 5 min on Oracle) will produce today's entry."
          />
        )}
        {selected && !content && !loading && (
          <PageState
            icon={BookOpen}
            title={`No content for ${selected}`}
            description="The file exists or will exist shortly. Check back after the next cycle."
          />
        )}
        {content && (
          <pre
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace',
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--color-text)',
              background: 'var(--color-card)',
              padding: 16,
              borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >{content}</pre>
        )}
      </div>
    </div>
  );
}
