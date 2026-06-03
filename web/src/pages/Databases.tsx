// Databases — catalog of every knowledge base, SQL store, and secret vault on
// the laptop hub, grouped and rendered as clickable cards. Data comes from
// GET /api/databases (see src/databases.ts). Clicking a card deep-links to
// /databases/:id (DatabaseDetail).
import { useState, useEffect } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { BookOpen, Table, KeyRound } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';

type DbType = 'kb' | 'sql' | 'secrets';

interface DbItem {
  id: string;
  type: DbType;
  label: string;
  subtitle?: string;
  stat: string;
  size: string;
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
        <span style={{
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
        <div style={{
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
        <span>updated {item.updated}</span>
      </div>
    </button>
  );
}

export function Databases() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const groups = data?.groups ?? [];

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Databases" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '20px' }}>
            Every knowledge base, SQL store, and secret vault — organized.
          </p>

          {loading && <PageState loading />}
          {error && <PageState error={error} />}

          {!loading && !error && groups.length === 0 && (
            <PageState empty emptyTitle="No databases" emptyDescription="The catalog returned no groups." />
          )}

          {!loading && !error && groups.map(group => (
            <section key={group.id} style={{ marginBottom: '28px' }}>
              <div style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px',
                textTransform: 'uppercase', color: 'var(--color-text-faint)',
                marginBottom: '12px',
              }}>
                {group.label} <span style={{ opacity: 0.6 }}>({group.items.length})</span>
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
