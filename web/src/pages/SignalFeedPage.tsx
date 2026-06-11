import { useState, useEffect } from 'preact/hooks';
import { useFetch } from '@/lib/useFetch';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const BG = '#0d1420';
const CARD = '#0a1929';
const BORDER = '#1a2332';
const BORDER2 = '#1a3a4a';
const TEXT = '#e0e0e0';
const MUTED = '#607d8b';
const GREEN = '#66bb6a';
const RED = '#ef5350';
const BLUE = '#4fc3f7';
const PURPLE = '#ce93d8';
const AMBER = '#ff9800';

interface FlowEvent {
  symbol: string;
  option_type: string;
  strike: number;
  expiry: string;
  premium: number;
  volume: number;
  block_type: string;
  event_time: number;
  event_time_iso: string;
}

interface SignalData {
  Symbol?: string;
  OptionType?: string;
  Strike?: number;
  Expiry?: string;
  Price?: number;
  Spot?: number;
  Value?: number;
  Volume?: number;
  OI?: number;
  BlockType?: string;
  BidAskType?: string;
  UnderlyingType?: string;
  Time?: number;
  message?: string;
}

interface Signal {
  feed: string;
  key: string;
  data: SignalData;
  received_at: string;
}

interface ApiResponse {
  signals: Signal[];
  flow_events: FlowEvent[];
  feeds_available: string[];
}

function fmtPremium(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}m`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}k`;
  return `$${val}`;
}

function fmtExpiry(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', '-');
  } catch { return iso; }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return iso; }
}

function timeAgo(isoTs: string | undefined): string {
  if (!isoTs) return '—';
  const diffMs = Date.now() - new Date(isoTs).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function Badge({ children, color, bg }: { children: string; color: string; bg: string }) {
  return (
    <span style={{ color, background: bg, fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function FlowTable({ events }: { events: FlowEvent[] }) {
  const [blockFilter, setBlockFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<number | null>(null);

  const filtered = events
    .slice()
    .sort((a, b) => b.event_time - a.event_time)
    .filter(e =>
      (blockFilter === 'ALL' || e.block_type === blockFilter) &&
      (typeFilter === 'ALL' || e.option_type.toUpperCase() === typeFilter) &&
      (!search || e.symbol.toUpperCase().includes(search.toUpperCase()))
    )
    .slice(0, 100);

  const selectStyle: Record<string, string | number> = {
    background: CARD, color: TEXT, border: `1px solid ${BORDER2}`, borderRadius: 5,
    padding: '4px 8px', fontSize: 12, fontFamily: MONO, cursor: 'pointer', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select style={selectStyle} value={blockFilter} onChange={e => setBlockFilter((e.target as HTMLSelectElement).value)}>
          <option value="ALL">All Blocks</option>
          <option value="SWEEP">SWEEP</option>
          <option value="BLOCK">BLOCK</option>
        </select>
        <select style={selectStyle} value={typeFilter} onChange={e => setTypeFilter((e.target as HTMLSelectElement).value)}>
          <option value="ALL">All Types</option>
          <option value="CALL">CALL</option>
          <option value="PUT">PUT</option>
        </select>
        <input
          type="text"
          placeholder="Filter symbol…"
          value={search}
          onInput={e => setSearch((e.target as HTMLInputElement).value)}
          style={{ ...selectStyle, width: 130 }}
        />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, fontFamily: MONO }}>
          Showing {filtered.length} / {events.length}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: MONO }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['TIME', 'SYMBOL', 'TYPE', 'BLOCK', 'STRIKE', 'EXPIRY', 'PREMIUM', 'VOL'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const isSweep = e.block_type === 'SWEEP';
              const rowBg = hovered === i
                ? (isSweep ? 'rgba(255,152,0,0.1)' : 'rgba(79,195,247,0.08)')
                : 'transparent';
              return (
                <tr
                  key={i}
                  style={{ borderBottom: `1px solid ${BORDER}`, background: rowBg, cursor: 'default', transition: 'background 0.15s' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <td style={{ padding: '7px 10px', color: MUTED, whiteSpace: 'nowrap' }}>{fmtTime(e.event_time_iso)}</td>
                  <td style={{ padding: '7px 10px', color: BLUE, fontWeight: 700, whiteSpace: 'nowrap' }}>{e.symbol}</td>
                  <td style={{ padding: '7px 10px' }}>
                    {e.option_type.toUpperCase() === 'CALL'
                      ? <Badge color={GREEN} bg="rgba(102,187,106,0.15)">CALL</Badge>
                      : <Badge color={RED} bg="rgba(239,83,80,0.15)">PUT</Badge>}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    {isSweep
                      ? <Badge color={AMBER} bg="rgba(255,152,0,0.15)">SWEEP</Badge>
                      : <Badge color={BLUE} bg="rgba(79,195,247,0.12)">BLOCK</Badge>}
                  </td>
                  <td style={{ padding: '7px 10px', color: TEXT }}>{e.strike}</td>
                  <td style={{ padding: '7px 10px', color: MUTED }}>{fmtExpiry(e.expiry)}</td>
                  <td style={{ padding: '7px 10px', color: e.premium > 100_000 ? GREEN : TEXT, fontWeight: e.premium > 100_000 ? 700 : 400 }}>
                    {fmtPremium(e.premium)}
                  </td>
                  <td style={{ padding: '7px 10px', color: TEXT }}>{e.volume}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignalCards({ signals, feedsAvailable }: { signals: Signal[]; feedsAvailable: string[] }) {
  const [activeFeed, setActiveFeed] = useState('ALL');

  const filtered = activeFeed === 'ALL' ? signals : signals.filter(s => s.feed === activeFeed);
  const sorted = filtered.slice().sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());

  const chipStyle = (active: boolean): Record<string, string | number> => ({
    padding: '3px 10px', borderRadius: 12, fontSize: 11, fontFamily: MONO, fontWeight: active ? 700 : 400,
    cursor: 'pointer', border: `1px solid ${active ? BLUE : BORDER2}`,
    background: active ? 'rgba(79,195,247,0.15)' : 'transparent',
    color: active ? BLUE : MUTED, transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span style={chipStyle(activeFeed === 'ALL')} onClick={() => setActiveFeed('ALL')}>ALL</span>
        {feedsAvailable.map(f => (
          <span key={f} style={chipStyle(activeFeed === f)} onClick={() => setActiveFeed(f)}>{f}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((sig, i) => {
          const d = sig.data;
          const hasSymbol = !!d.Symbol;
          const isCall = d.OptionType?.toUpperCase() === 'CALL';
          return (
            <div key={sig.key ?? i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: PURPLE, fontFamily: MONO, background: 'rgba(206,147,216,0.12)', padding: '2px 7px', borderRadius: 4 }}>{sig.feed}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, fontFamily: MONO }}>{fmtTime(sig.received_at)}</span>
              </div>
              {hasSymbol ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: BLUE, fontFamily: MONO }}>{d.Symbol}</span>
                  {d.OptionType && (isCall
                    ? <Badge color={GREEN} bg="rgba(102,187,106,0.15)">{d.OptionType.toUpperCase()}</Badge>
                    : <Badge color={RED} bg="rgba(239,83,80,0.15)">{d.OptionType.toUpperCase()}</Badge>
                  )}
                  {d.Strike !== undefined && <span style={{ fontSize: 13, color: TEXT, fontFamily: MONO }}>@ {d.Strike}</span>}
                  {d.Expiry && <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>{fmtExpiry(d.Expiry)}</span>}
                  {d.BlockType && <Badge color={d.BlockType === 'SWEEP' ? AMBER : BLUE} bg={d.BlockType === 'SWEEP' ? 'rgba(255,152,0,0.15)' : 'rgba(79,195,247,0.12)'}>{d.BlockType}</Badge>}
                  {typeof d.Value === 'number' && (
                    <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: d.Value > 100_000 ? GREEN : TEXT, fontFamily: MONO }}>
                      {fmtPremium(d.Value)}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.5 }}>
                  {String(d.message ?? JSON.stringify(d)).slice(0, 150)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SignalFeedPage() {
  const { data, loading, error } = useFetch<ApiResponse>('/api/trade-desk/signals?limit=200', 30_000);
  const [activeTab, setActiveTab] = useState<'flow' | 'signals'>('flow');
  const [, setTick] = useState(0);

  // Re-render every 30s to keep "X ago" fresh
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const flowEvents = data?.flow_events ?? [];
  const signals = data?.signals ?? [];
  const feedsAvailable = data?.feeds_available ?? [];

  const latestIso = flowEvents.length > 0
    ? flowEvents.reduce((best, e) => e.event_time > new Date(best).getTime() ? e.event_time_iso : best, flowEvents[0].event_time_iso)
    : undefined;

  const tabBase: Record<string, string | number> = {
    padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: 'none', background: 'transparent', fontFamily: MONO, letterSpacing: '0.05em',
    transition: 'color 0.15s, border-color 0.15s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: BG, color: TEXT }}>
      <PageHeader
        title="Signal Feed"
        breadcrumb="← Trade Desk"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontFamily: MONO, color: latestIso ? GREEN : MUTED, background: 'rgba(102,187,106,0.1)', border: `1px solid rgba(102,187,106,0.25)`, borderRadius: 12, padding: '2px 10px', whiteSpace: 'nowrap' }}>
              LIVE · {timeAgo(latestIso)}
            </span>
            <span style={{ fontSize: 11, fontFamily: MONO, color: BLUE, background: 'rgba(79,195,247,0.1)', border: `1px solid ${BORDER2}`, borderRadius: 12, padding: '2px 10px' }}>⟳ 30s</span>
          </div>
        }
      />

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, paddingLeft: 20 }}>
        <button
          type="button"
          style={{ ...tabBase, color: activeTab === 'flow' ? TEXT : MUTED, borderBottom: activeTab === 'flow' ? `2px solid ${BLUE}` : '2px solid transparent', paddingBottom: 10 }}
          onClick={() => setActiveTab('flow')}
        >
          LIVE FLOW EVENTS
        </button>
        <button
          type="button"
          style={{ ...tabBase, color: activeTab === 'signals' ? TEXT : MUTED, borderBottom: activeTab === 'signals' ? `2px solid ${BLUE}` : '2px solid transparent', paddingBottom: 10 }}
          onClick={() => setActiveTab('signals')}
        >
          SIGNAL ALERTS
        </button>
      </div>

      {loading && !data && <PageState loading />}
      {error && <PageState error={error} />}

      {data && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {activeTab === 'flow' && (
            flowEvents.length === 0
              ? <PageState empty emptyTitle="No flow events" emptyDescription="No flow events in the last 6 hours — market may be closed" />
              : <FlowTable events={flowEvents} />
          )}
          {activeTab === 'signals' && (
            signals.length === 0
              ? <PageState empty emptyTitle="No signal alerts" emptyDescription="No signal alerts captured yet" />
              : <SignalCards signals={signals} feedsAvailable={feedsAvailable} />
          )}
        </div>
      )}
    </div>
  );
}

export default SignalFeedPage;
