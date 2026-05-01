import { useState } from 'preact/hooks';
import { Brain as BrainIcon, List as ListIcon } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { PrivacyToggle } from '@/components/PrivacyToggle';
import { BrainGraph } from '@/components/BrainGraph';
import { useFetch } from '@/lib/useFetch';
import { formatRelativeTime } from '@/lib/format';
import { privacyBlur } from '@/lib/privacy';

interface HiveEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  summary: string;
  artifacts: string | null;
  created_at: number;
}

const AGENT_HUE: Record<string, string> = {
  main: 'var(--color-accent)',
  research: '#5eb6ff',
  comms: '#10b981',
  content: '#f59e0b',
  ops: '#a78bfa',
};

const KNOWN_AGENTS = ['main', 'research', 'comms', 'content', 'ops'];
const VIEW_KEY = 'claudeclaw.hive.view';
type ViewMode = 'brain' | 'activity';

function loadView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'brain' || v === 'activity') return v;
  } catch {}
  return 'brain';
}

export function HiveMind() {
  const [filter, setFilter] = useState<string>('all');
  const [view, setView] = useState<ViewMode>(loadView());
  // Per-row reveal overrides — session only, not persisted. Clicking a
  // blurred summary unblurs that row until the page closes.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const agentList = useFetch<{ agents: { id: string }[] }>('/api/agents');
  const path = filter === 'all'
    ? '/api/hive-mind?limit=200'
    : `/api/hive-mind?agent=${encodeURIComponent(filter)}&limit=200`;
  const { data, loading, error } = useFetch<{ entries: HiveEntry[] }>(path, 30_000);
  const entries = data?.entries ?? [];
  const allAgents = agentList.data?.agents?.map((a) => a.id) ?? KNOWN_AGENTS;
  const blurOn = privacyBlur('hive').value;

  function setViewPersisted(v: ViewMode) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  }

  function toggleRow(id: number) {
    if (!blurOn) return;
    const next = new Set(revealed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setRevealed(next);
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Hive Mind"
        actions={
          <>
            <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{entries.length} entries</span>
            <PrivacyToggle section="hive" />
            <ViewSwitcher view={view} onChange={setViewPersisted} />
          </>
        }
        tabs={
          <>
            <Tab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
            {allAgents.map((id) => (
              <Tab key={id} label={id} active={filter === id} onClick={() => setFilter(id)} />
            ))}
          </>
        }
      />
      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && entries.length === 0 && (
        <PageState
          empty
          emptyTitle="No activity yet"
          emptyDescription="Every agent action — Telegram messages, delegated tasks, memory consolidations, kill-switch refusals — lands here as it happens."
        />
      )}

      {entries.length > 0 && view === 'brain' && (
        <BrainGraph
          entries={entries}
          agentFilter={filter}
          agentColors={AGENT_HUE}
          blurOn={blurOn}
        />
      )}

      {entries.length > 0 && view === 'activity' && (
        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-[12px]">
            <thead class="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)]">
              <tr class="text-left">
                <th class="px-6 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[12%]">When</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[12%]">Agent</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[14%]">Action</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Summary</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors">
                  <td class="px-6 py-2 text-[var(--color-text-faint)] tabular-nums whitespace-nowrap">
                    {formatRelativeTime(e.created_at)}
                  </td>
                  <td class="px-3 py-2">
                    <span
                      class="inline-flex items-center gap-1.5"
                      style={{ color: AGENT_HUE[e.agent_id] || 'var(--color-text-muted)' }}
                    >
                      <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />
                      {e.agent_id}
                    </span>
                  </td>
                  <td class="px-3 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                    {e.action}
                  </td>
                  <td class="px-3 py-2 text-[var(--color-text)] truncate max-w-0">
                    <span
                      class={[
                        blurOn ? 'privacy-blur' : '',
                        revealed.has(e.id) ? 'revealed' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={(ev) => { ev.stopPropagation(); toggleRow(e.id); }}
                    >
                      {e.summary}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ViewSwitcher({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div class="inline-flex bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-0.5">
      <button
        type="button"
        onClick={() => onChange('brain')}
        class={[
          'inline-flex items-center justify-center w-7 h-7 rounded transition-colors',
          view === 'brain' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
        ].join(' ')}
        title="Brain view"
      >
        <BrainIcon size={13} />
      </button>
      <button
        type="button"
        onClick={() => onChange('activity')}
        class={[
          'inline-flex items-center justify-center w-7 h-7 rounded transition-colors',
          view === 'activity' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
        ].join(' ')}
        title="Activity table"
      >
        <ListIcon size={13} />
      </button>
    </div>
  );
}
