import { useState } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { formatRelativeTime, safeJsonArray } from '@/lib/format';
import { chatId } from '@/lib/api';

type SortMode = 'importance' | 'salience' | 'recent';

interface Memory {
  id: number;
  chat_id: string;
  source: string;
  agent_id: string;
  raw_text: string;
  summary: string;
  entities: string;     // JSON-encoded string
  topics: string;       // JSON-encoded string
  connections: string;  // JSON-encoded string
  importance: number;
  salience: number;
  consolidated: number;
  pinned: number;
  created_at: number;
  accessed_at: number;
}

const PAGE_SIZE = 30;

export function Memories() {
  const [sort, setSort] = useState<SortMode>('importance');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const path = `/api/memories/list?chatId=${encodeURIComponent(chatId)}&sort=${sort}&limit=${PAGE_SIZE}&offset=0`;
  const { data, loading, error } = useFetch<{ memories: Memory[]; total: number }>(path);

  const memories = data?.memories ?? [];
  const total = data?.total ?? 0;

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Memories"
        actions={<span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{total} memories</span>}
        tabs={
          <>
            <Tab label="Importance" active={sort === 'importance'} onClick={() => setSort('importance')} />
            <Tab label="Salience" active={sort === 'salience'} onClick={() => setSort('salience')} />
            <Tab label="Recent" active={sort === 'recent'} onClick={() => setSort('recent')} />
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && memories.length === 0 && (
        <PageState
          empty
          emptyTitle="No memories yet"
          emptyDescription="Memories are extracted automatically from your Telegram conversations. Have a substantive chat and they'll show up here."
        />
      )}

      {memories.length > 0 && (
        <div class="flex-1 overflow-y-auto">
          {memories.map((m) => (
            <MemoryRow key={m.id} memory={m} expanded={expanded.has(m.id)} onToggle={() => toggle(m.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryRow({ memory, expanded, onToggle }: { memory: Memory; expanded: boolean; onToggle: () => void }) {
  const topics = safeJsonArray<string>(memory.topics);
  const importanceColor =
    memory.importance >= 0.8 ? 'var(--color-priority-high)'
    : memory.importance >= 0.5 ? 'var(--color-priority-medium)'
    : 'var(--color-text-muted)';

  return (
    <div
      class={[
        'border-b border-[var(--color-border)] px-6 py-3 cursor-pointer hover:bg-[var(--color-elevated)] transition-colors',
        expanded ? 'bg-[var(--color-elevated)]' : '',
      ].join(' ')}
      onClick={onToggle}
    >
      <div class="flex items-start gap-3">
        <ChevronRight
          size={14}
          class={'mt-1 shrink-0 text-[var(--color-text-faint)] transition-transform ' + (expanded ? 'rotate-90' : '')}
        />
        <div class="flex-1 min-w-0">
          <div class={'text-[13px] text-[var(--color-text)] leading-snug ' + (expanded ? '' : 'truncate')}>
            {memory.summary}
          </div>
          {topics.length > 0 && (
            <div class="flex flex-wrap items-center gap-1 mt-1.5">
              {topics.slice(0, expanded ? 99 : 5).map((t, i) => (
                <span
                  key={i}
                  class="font-mono text-[10px] text-[var(--color-text-muted)] bg-[var(--color-elevated)] border border-[var(--color-border)] px-1.5 py-0.5 rounded"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {expanded && memory.raw_text && memory.raw_text !== memory.summary && (
            <div class="mt-3 text-[12px] text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap font-mono">
              {memory.raw_text}
            </div>
          )}
        </div>

        <div class="flex items-center gap-3 shrink-0 pt-0.5">
          <span
            class="font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: 'color-mix(in srgb, ' + importanceColor + ' 18%, transparent)',
              color: importanceColor,
            }}
          >
            {memory.importance.toFixed(2)}
          </span>
          <div class="flex flex-col items-end gap-0.5">
            <div class="w-16 h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
              <div
                class="h-full bg-[var(--color-accent)]"
                style={{ width: Math.max(2, Math.min(100, (memory.salience / 5) * 100)) + '%' }}
              />
            </div>
            <span class="font-mono text-[10px] text-[var(--color-text-faint)] tabular-nums">
              {memory.salience.toFixed(2)}
            </span>
          </div>
          <span class="text-[10px] text-[var(--color-text-faint)] w-12 text-right">
            {formatRelativeTime(memory.accessed_at || memory.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
