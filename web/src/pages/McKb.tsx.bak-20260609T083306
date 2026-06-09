import { useState, useEffect } from 'preact/hooks';
import { Search, Database } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';
import { useDebouncedValue } from '@/lib/useDebounce';

interface Hit {
  source: string;
  heading: string;
  tier: string;
  _distance: number;
  preview: string;
}

interface QueryResponse {
  query: string;
  tiers: string[] | null;
  elapsed_ms: number;
  hits: Hit[];
}

interface HealthResponse {
  status: string;
  chunks: number;
  last_sync: string;
}

const TIERS = ['identity', 'critical', 'working', 'episodic'] as const;
type Tier = (typeof TIERS)[number];

const TIER_COLOR: Record<string, string> = {
  identity: '#a78bfa',
  critical: '#f59e0b',
  working: '#10b981',
  episodic: '#5eb6ff',
  untiered: '#6b7280',
};

export function McKb() {
  const [query, setQuery] = useState('');
  const [selectedTiers, setSelectedTiers] = useState<Set<Tier>>(new Set());
  const [top, setTop] = useState(10);
  const [data, setData] = useState<QueryResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dq = useDebouncedValue(query, 250);

  // Fetch health once on mount + every 60s.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const h = await apiGet<HealthResponse>('/api/mckb/health');
        if (!cancelled) setHealth(h);
      } catch {
        if (!cancelled) setHealth(null);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Run query when debounced text changes (and is non-empty).
  useEffect(() => {
    if (!dq.trim()) { setData(null); setError(null); return; }
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: dq, top: String(top) });
        if (selectedTiers.size > 0) {
          params.set('tier', [...selectedTiers].join(','));
        }
        const r = await apiGet<QueryResponse>(`/api/mckb/query?${params}`);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [dq, top, selectedTiers]);

  function toggleTier(t: Tier) {
    setSelectedTiers(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  const healthBadge = health
    ? <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>
        {health.chunks} chunks · synced {health.last_sync ? new Date(health.last_sync).toLocaleString() : 'never'}
      </span>
    : <span style={{ color: 'var(--color-warn)', fontSize: 12 }}>mc-kb server offline</span>;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        icon={Database}
        title="mc-kb"
        subtitle="Semantic search across bible, memory, skool, and notes — laptop's RAG layer"
        right={healthBadge}
        tabs={[]}
      />

      {/* Search input */}
      <div class="px-4 pt-3 pb-2 border-b border-[var(--color-border)] flex flex-col gap-3">
        <div class="relative">
          <Search size={16} class="absolute top-3 left-3 text-[var(--color-muted)]" />
          <input
            type="text"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Ask mc-kb anything — e.g. 'how does MacroDroid notification pipeline work?'"
            class="w-full pl-10 pr-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {/* Tier filter chips */}
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-[var(--color-muted)]">Tier:</span>
          {TIERS.map(t => {
            const active = selectedTiers.has(t);
            const color = TIER_COLOR[t] || '#6b7280';
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTier(t)}
                style={{
                  background: active ? color + '33' : 'transparent',
                  borderColor: active ? color : 'var(--color-border)',
                  color: active ? color : 'var(--color-muted)',
                }}
                class="px-2 py-1 text-xs rounded-full border transition-colors"
              >
                {t}
              </button>
            );
          })}
          <span class="ml-3 text-xs text-[var(--color-muted)]">Top:</span>
          {[5, 10, 20, 50].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setTop(n)}
              class={`px-2 py-1 text-xs rounded-md border ${top === n ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-muted)]'}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div class="flex-1 overflow-auto px-4 py-3">
        {!dq.trim() && !data && (
          <PageState
            icon={Database}
            title="Search the knowledge base"
            description="Type a question above to query 357+ chunks across the bible, your memory files, Mark Kashef's skool community, and your second-brain notes."
          />
        )}
        {error && (
          <div class="p-3 rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] text-[var(--color-error)] text-sm">
            {error}
          </div>
        )}
        {loading && (
          <div class="text-sm text-[var(--color-muted)]">Searching…</div>
        )}
        {data && !loading && (
          <>
            <div class="text-xs text-[var(--color-muted)] mb-3">
              {data.hits.length} hits · {data.elapsed_ms}ms
              {data.tiers && data.tiers.length > 0 && <> · tier: {data.tiers.join(', ')}</>}
            </div>
            <div class="flex flex-col gap-3">
              {data.hits.map((h, i) => {
                const tierColor = TIER_COLOR[h.tier] || '#6b7280';
                return (
                  <div
                    key={i}
                    class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)]"
                  >
                    <div class="flex items-center gap-2 mb-1 text-xs">
                      <span style={{ background: tierColor + '33', color: tierColor, padding: '2px 6px', borderRadius: 4 }}>
                        {h.tier || 'untiered'}
                      </span>
                      <span class="text-[var(--color-muted)]">{h.source}</span>
                      <span class="ml-auto text-[var(--color-muted)]">dist {h._distance?.toFixed(3)}</span>
                    </div>
                    {h.heading && h.heading !== '---' && (
                      <div class="font-medium text-sm mb-1 text-[var(--color-text)]">{h.heading}</div>
                    )}
                    <pre class="text-xs whitespace-pre-wrap text-[var(--color-muted)]" style={{ fontFamily: 'inherit' }}>
                      {h.preview}
                    </pre>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
