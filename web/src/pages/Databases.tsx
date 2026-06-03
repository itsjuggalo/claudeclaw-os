// Databases — catalog of every knowledge base, SQL store, and secret vault on
// the laptop hub, grouped and rendered as clickable cards. Data comes from
// GET /api/databases (see src/databases.ts). Clicking a card deep-links to
// /databases/:id (DatabaseDetail).
import { useState, useEffect, useRef } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { BookOpen, Table, KeyRound, Search } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';

type DbType = 'kb' | 'sql' | 'secrets';

// Format an ISO timestamp in Eastern Time (operator is America/New_York).
export function fmtUpdated(iso?: string | null): string {
  if (!iso) return 'unknown';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return 'unknown';
  }
}

// Sum of per-item byte sizes → a compact human string (catalog totals).
export function humanSize(bytes: number): string {
  if (!bytes || bytes < 1) return '—';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return (n < 10 && u > 0 ? n.toFixed(1) : Math.round(n)) + units[u];
}

interface DbItem {
  id: string;
  type: DbType;
  label: string;
  subtitle?: string;
  stat: string;
  size: string;
  bytes?: number;
  updated: string;
  accent: string;
  askable?: boolean;
}

interface DbGroup {
  id: string;
  label: string;
  items: DbItem[];
}

interface CatalogResponse {
  groups: DbGroup[];
  totalBytes?: number;
}

// Accent name → hex. Used for left border + hover glow on cards.
const ACCENT_HEX: Record<string, string> = {
  amber: '#f59e0b',
  emerald: '#10b981',
  violet: '#a78bfa',
  sky: '#5eb6ff',
  rose: '#fb7185',
  slate: '#94a3b8',
};

function accentHex(name: string): string {
  return ACCENT_HEX[name] || ACCENT_HEX.slate;
}

function iconForType(type: DbType) {
  if (type === 'sql') return Table;
  if (type === 'secrets') return KeyRound;
  return BookOpen;
}

function DbCard({ item }: { item: DbItem }) {
  const [, setLocation] = useLocation();
  const [hover, setHover] = useState(false);
  const accent = accentHex(item.accent);
  const Icon = iconForType(item.type);

  return (
    <button
      type="button"
      data-db-card
      onClick={() => setLocation('/databases/' + item.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left',
        background: 'var(--color-card)',
        border: '1px solid ' + (hover ? accent : 'var(--color-border)'),
        borderLeft: '3px solid ' + accent,
        borderRadius: '10px',
        padding: '14px 16px',
        cursor: 'pointer',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 6px 20px ' + accent + '22' : 'none',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px', borderRadius: '7px',
          background: accent + '22', color: accent, flexShrink: 0,
        }}>
          <Icon size={16} />
        </span>
        <span title={item.label} style={{
          fontSize: '14px', fontWeight: 700, color: 'var(--color-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.label}</span>
        <span style={{
          marginLeft: 'auto', flexShrink: 0,
          fontSize: '10px', fontWeight: 700, color: accent,
          background: accent + '1f', padding: '2px 8px', borderRadius: '999px',
        }}>{item.stat}</span>
      </div>
      {item.subtitle && (
        <div title={item.subtitle} style={{
          fontSize: '12px', color: 'var(--color-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.subtitle}</div>
      )}
      <div style={{
        fontSize: '11px', color: 'var(--color-text-faint)',
        display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px',
      }}>
        <span>{item.size}</span>
        <span>·</span>
        <span>updated {fmtUpdated(item.updated)}</span>
      </div>
    </button>
  );
}

export function Databases() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await apiGet<CatalogResponse>('/api/databases');
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const groups = data?.groups ?? [];
  const totalCount = groups.reduce((n, g) => n + g.items.length, 0);
  // De-duped total from the backend (KB dirs already include their fts.db
  // index entries); fall back to a naive client sum if absent.
  const totalBytes = data?.totalBytes ?? groups.reduce((n, g) => n + g.items.reduce((m, it) => m + (it.bytes ?? 0), 0), 0);

  // Arrow keys move focus between cards (linear order); Home/End jump to the
  // ends. Enter/Space activate natively (the cards are <button>s).
  function onGridKeyDown(e: KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    // Don't hijack arrows/Home/End while the user is typing in the filter box.
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const root = scrollRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-db-card]'));
    if (cards.length === 0) return;
    const cur = cards.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cards.length - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = cur < 0 ? 0 : Math.min(cards.length - 1, cur + 1);
    else next = cur < 0 ? 0 : Math.max(0, cur - 1);
    e.preventDefault();
    cards[next]?.focus();
  }

  // Client-side live filter: match label / subtitle / id / type (case-insensitive).
  const q = filter.trim().toLowerCase();
  const matchesItem = (it: DbItem): boolean => {
    if (!q) return true;
    return (
      it.label.toLowerCase().includes(q) ||
      (it.subtitle ?? '').toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      it.type.toLowerCase().includes(q)
    );
  };
  const filteredGroups = groups
    .map(g => ({ ...g, items: g.items.filter(matchesItem) }))
    .filter(g => g.items.length > 0);

  const headerActions = !loading && !error && totalCount > 0
    ? <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>{totalCount} databases · {humanSize(totalBytes)}</span>
    : undefined;

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Databases" actions={headerActions} />
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }} onKeyDown={onGridKeyDown}>
        <div style={{ padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
            Every knowledge base, SQL store, and secret vault — organized.
          </p>

          {!loading && !error && totalCount > 0 && (
            <div style={{ position: 'relative', marginBottom: '20px', maxWidth: '360px' }}>
              <span style={{
                position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--color-text-faint)', display: 'inline-flex', pointerEvents: 'none',
              }}>
                <Search size={14} />
              </span>
              <input
                type="text"
                value={filter}
                onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
                placeholder="Filter databases…"
                class="w-full pl-8 pr-3 py-1.5 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          )}

          {loading && <PageState loading />}
          {error && <PageState error={error} />}

          {!loading && !error && groups.length === 0 && (
            <PageState empty emptyTitle="No databases" emptyDescription="The catalog returned no groups." />
          )}

          {!loading && !error && groups.length > 0 && filteredGroups.length === 0 && (
            <PageState empty emptyTitle="No matches" emptyDescription={'Nothing matches "' + filter.trim() + '".'} />
          )}

          {!loading && !error && filteredGroups.map(group => (
            <section key={group.id} style={{ marginBottom: '28px' }}>
              <div style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px',
                textTransform: 'uppercase', color: 'var(--color-text-faint)',
                marginBottom: '12px',
              }}>
                {group.label} <span style={{ opacity: 0.6 }}>({group.items.length})</span>
                {(() => {
                  const gb = group.items.reduce((m, it) => m + (it.bytes ?? 0), 0);
                  return gb > 0 ? <span style={{ opacity: 0.45, fontWeight: 400 }}> · {humanSize(gb)}</span> : null;
                })()}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '12px',
              }}>
                {group.items.map(item => <DbCard key={item.id} item={item} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
