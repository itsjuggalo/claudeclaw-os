// DatabaseDetail — deep page for a single database. Behaviour depends on the
// item's type (resolved from the /api/databases catalog by id):
//   kb      → Ask | Search tabs (RAG question-answering + semantic search)
//   sql     → table browser + SELECT-only query runner
//   secrets → grouped masked secrets with reveal + copy
// All data comes from /api/databases/* (see src/databases.ts). Read-only:
// the SQL runner is SELECT-only on the backend; secrets never auto-reveal.
import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { useRoute, useLocation } from 'wouter-preact';
import { KeyRound, Eye, EyeOff, Copy, ArrowLeft, Search, Download, RefreshCw } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost } from '@/lib/api';
import { ExploreTab } from '@/components/erik/ExploreTab';
import { ConditionsTab } from '@/components/erik/ConditionsTab';
import { TechniquePlayer } from '@/components/erik/TechniquePlayer';
import { ErikQuiz } from '@/components/erik/ErikQuiz';
import { ErikLibrary } from '@/components/erik/ErikLibrary';
import { ClayQuiz } from '@/components/clay/ClayQuiz';
import { ClayExamples } from '@/components/clay/ClayExamples';
import { useDebouncedValue } from '@/lib/useDebounce';
import { fmtUpdated } from '@/pages/Databases';
import { renderMarkdown } from '@/lib/markdown';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// ── ClayTrader static method reference (distilled from claytrader-rules/) ──
// Embedded so the panel has zero API round-trips and works without a restart.
// Source: ~/restructure/DB-OVERHAUL/claytrader-rules/ ADOPT.md + per-method rules.json
const CLAY_SETUPS = [
  {
    name: 'Panic Buy', verdict: 'ADAPT', course: 'Risk vs Reward Trading (RVR)',
    summary: "Buy a pullback INSIDE an uptrend at a pre-chosen support, resting limit orders, 3:1+ R:R. 'When others run for the exits, plan a favorable entry.'",
    entry: 'Uptrend (50 SMA up-sloping), stock pulling back, resting limit buy CUT THE LINE 1-2c above support.',
    stop: "Previous candle's low OR Golden Brick Road MA (10 SMA). Cushion validates; negative cushion = skip.",
    rvr: 'Default 3:1+. Target = realistic resistance, cut 1c below it.',
  },
  {
    name: 'Momentum Buy', verdict: 'ADAPT', course: 'Risk vs Reward Trading (RVR)',
    summary: "Buy a confirmed breakout; the stop defines the MAXIMUM entry price — math, not feeling. Must be at screen.",
    entry: 'Break of pattern resistance (pole/flag/pennant/triangle). Upside cushion: pay up to ~5c past break.',
    stop: "Previous candle's low at the break. Highest valid entry = stop + risk budget / shares.",
    rvr: '3:1+. Target via flagpole projection (pole length + breakout level).',
  },
  {
    name: 'Speculation Buy', verdict: 'ADOPT', course: 'Risk vs Reward Trading (RVR)',
    summary: "Position INSIDE consolidation near support BEFORE breakout. 'Massively right or minimally wrong.' ClayTrader's most-used method.",
    entry: 'Any point between support and resistance inside consolidation; no breakout needed.',
    stop: "Below indecision candle cluster OR Golden Brick Road MA (10 SMA).",
    rvr: '3:1+. Top of consolidation / measured-move. Failed breakout can still exit green.',
  },
  {
    name: 'Volcano', verdict: 'ADOPT', course: 'Volcano Trading',
    summary: "Classify chart state (EXTINCT / DORMANT / ACTIVE) via MACD signal + 50 SMA + 20/50 relationship. Only trade DORMANT/ACTIVE.",
    entry: 'Break of short-term resistance trigger. EXTINCT (MACD signal <0, 20<50) = hard skip.',
    stop: '10 EMA (or 20 SMA for swing) + cushion. Set immediately on fill.',
    rvr: 'Progressive profit-locks at successive resistance levels. Trail final 25% on 10 EMA.',
  },
  {
    name: 'Trampoline', verdict: 'ADAPT', course: 'Trampoline Trading',
    summary: "Hunt heavily-shorted stocks (days-to-cover ≥5) in a basing phase, buy the break of a 'major problem' resistance. GATED: needs short-interest data feed.",
    entry: 'Big-volume buy-signal candle, then break of major-problem resistance above it.',
    stop: "Prior support low - cushion, never a round number. Set immediately, ratchet each bar.",
    rvr: 'Managed by trailing stop. Lock partial profits; hold ≥25% for the squeeze.',
  },
] as const;

const CLAY_HABITS = [
  { n: 1, rule: 'The stop defines your MAX entry.', detail: "Set the stop FIRST. Compute the highest price that still yields ≥3:1 R:R. Above that price, the trade is dead — don't pay up. Kills FOMO entries." },
  { n: 2, rule: 'Buy the one-foot drop, never the cliff.', detail: 'Only panic-buy a pullback when price is ABOVE an up-sloping 50 SMA. Rolling 50 SMA = real cliff, stay out.' },
  { n: 3, rule: "Near support so you're 'massively right or minimally wrong.'", detail: 'Entering inside tight consolidation at support makes dollar risk tiny. Patience near support beats excitement at the breakout.' },
  { n: 4, rule: 'Classify before you act. Never buy breakouts below MACD zero line.', detail: 'One glance: MACD signal, 50 SMA slope, 20 vs 50. MACD signal <0 and 20<50 = EXTINCT = skip, full stop.' },
  { n: 5, rule: 'A stop only works if you honor it.', detail: 'Set the stop immediately on fill (below prior support + cushion, never round numbers). Ratchet to previous candle low each bar. "It will come back" = portfolio fires.' },
] as const;

// Small refresh control placed in a deep page's header (deep pages fetch once;
// this re-pulls on demand since the catalog's 60s SWR doesn't cover them).
function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Refresh"
      class="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      <RefreshCw size={13} class={busy ? 'animate-spin' : undefined} /> Refresh
    </button>
  );
}

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
interface CatalogResponse { groups: { id: string; label: string; items: DbItem[] }[]; }

export function DatabaseDetail() {
  const [, params] = useRoute<{ id: string }>('/databases/:id');
  const [, setLocation] = useLocation();
  const id = params?.id ?? '';

  const [item, setItem] = useState<DbItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await apiGet<CatalogResponse>('/api/databases');
        const found = r.groups.flatMap(g => g.items).find(i => i.id === id) ?? null;
        if (!cancelled) {
          setItem(found);
          if (!found) setError('Database "' + id + '" not found in the catalog.');
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  const backLink = (
    <button
      type="button"
      onClick={() => setLocation('/databases')}
      class="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    >
      <ArrowLeft size={13} /> Databases
    </button>
  );

  if (loading) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Database" breadcrumb="Databases" actions={backLink} />
        <PageState loading />
      </div>
    );
  }
  if (error || !item) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Database" breadcrumb="Databases" actions={backLink} />
        <PageState error={error || 'Not found'} />
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      {/* key by id so internal state (tab, answer, sources, query, result)
          fully resets when navigating between two DBs of the same type. */}
      {item.type === 'kb' && <KbDetail key={item.id} item={item} back={backLink} />}
      {item.type === 'sql' && <SqlDetail key={item.id} item={item} back={backLink} />}
      {item.type === 'secrets' && <SecretsDetail key={item.id} item={item} back={backLink} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── KB ────────

interface KbHit {
  source: string;
  heading: string;
  course?: string;
  preview: string;
  distance: number;
  layer: string;
}
interface KbSearchResponse { hits: KbHit[]; abstained: boolean; }
interface KbAskResponse { answer: string; sources: string[]; abstained?: boolean; used_portfolio?: boolean; }
interface KbSourceGroup { name: string; chunks: number; sources: number; }
interface KbSourcesResponse {
  groupBy: string | null; totalChunks: number; totalSources: number;
  groups: KbSourceGroup[]; error?: string;
}

// "Heading (course)" → "Heading" — the bit worth re-searching.
function citationHeading(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// ClayTrader transcripts are named "<vimeoId>.md" (e.g. .../107144125.md). The raw
// videos are gone locally, but the Vimeo IDs survive in the filenames + the course
// catalog — so we can deep-link any answer chunk straight back to its source lesson.
// This is the ClayTrader half of the "make the KBs visual" goal (Erik Dalton already
// surfaces technique frames; ClayTrader gets the chart-on-video it was distilled from).
function claytraderVimeoId(source: string): string | null {
  const m = (source || '').match(/(\d{6,})\.md$/);
  return m ? m[1] : null;
}

const LAYER_COLOR: Record<string, string> = {
  identity: '#a78bfa', critical: '#f59e0b', working: '#10b981', episodic: '#5eb6ff',
};

// ── Anatomy image layer (KBs that ship anatomy/index.json, e.g. erikdalton) ──
interface AnatomyMuscle {
  name: string;
  slug: string;
  images?: Record<string, string>; // view -> "img/<slug>-front.png"
  viewer_url?: string | null;
  source?: string | null;
  attribution?: string | null;
  aliases?: string[];
}

// One muscle: front render, hover-swaps to back, links out to the full 3D view.
function MuscleCard({ m, itemId }: { m: AnatomyMuscle; itemId: string }) {
  const [back, setBack] = useState(false);
  const imgUrl = (rel?: string) =>
    rel ? '/api/databases/kb/' + itemId + '/anatomy/img/' + rel.split('/').pop() : '';
  const front = m.images?.front;
  const rear = m.images?.back;
  const shown = back && rear ? rear : front;
  if (!shown) return null;
  return (
    <div
      onMouseEnter={() => setBack(true)}
      onMouseLeave={() => setBack(false)}
      style={{
        width: '108px', flex: '0 0 auto', textAlign: 'center',
        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
        borderRadius: '8px', padding: '6px',
      }}
      title={m.name + (rear ? ' — hover for posterior view' : '')}
    >
      <div style={{ position: 'relative' }}>
        <img
          src={imgUrl(shown)}
          alt={m.name}
          loading="lazy"
          style={{ width: '96px', height: '96px', objectFit: 'contain' }}
        />
        {rear && (
          <span style={{
            position: 'absolute', bottom: 0, right: 0, fontSize: '8px', fontWeight: 700,
            color: 'var(--color-text-faint)', background: 'var(--color-card)',
            padding: '1px 4px', borderRadius: '4px',
          }}>{back ? 'back' : 'front'}</span>
        )}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text)', marginTop: '4px', lineHeight: 1.2, textTransform: 'capitalize' }}>
        {m.name}
      </div>
      {m.viewer_url && (
        <a href={m.viewer_url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '10px', color: 'var(--color-accent)' }}
          class="hover:underline">view 3D ↗</a>
      )}
    </div>
  );
}

// A horizontal strip of muscle cards for a set of slugs.
function MuscleStrip({ slugs, anatomy, itemId }: {
  slugs: string[]; anatomy: Record<string, AnatomyMuscle>; itemId: string;
}) {
  const muscles = slugs.map((s) => anatomy[s]).filter(Boolean);
  if (muscles.length === 0) return null;
  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>
        Anatomy · {muscles.length} muscle{muscles.length > 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {muscles.map((m) => <MuscleCard key={m.slug} m={m} itemId={itemId} />)}
      </div>
      <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', marginTop: '6px' }}>
        BodyParts3D © DBCLS, CC BY-SA 2.1 JP · Wikimedia Commons
      </div>
    </div>
  );
}

// ── TechniqueStrip: DVD frame thumbnails relevant to an Ask/Search result ──
// Frames are served by the backend after a one-time restart:
//   GET /api/databases/kb/erikdalton/anatomy/frames/<videoId>/<file>
// The frames-index is loaded once per KbDetail mount (same lifecycle as anatomy).

interface FrameEntry {
  seg: number;
  t_mid: number;
  file: string;   // relative like "frames/<videoId>/seg-000-29s.jpg"
  text: string;
  region?: string;  // body region tag, e.g. "wrist/hand", "low back" (erikdalton_region_tags.py)
}

// Query words that signal a body region → the region label tagged on frames.
// Lets "carpal tunnel" / "wrist pain" surface upper-extremity frames even when a
// given segment's transcript doesn't literally repeat the word.
const REGION_HINTS: Array<[string, string[]]> = [
  ['wrist/hand', ['carpal', 'wrist', 'median nerve', 'tinel']],
  ['elbow', ['elbow', 'epicondyle', 'forearm', 'tennis elbow']],
  ['shoulder', ['shoulder', 'rotator cuff', 'scapula', 'frozen shoulder']],
  ['neck', ['neck', 'cervical', 'scalene', 'whiplash', 'suboccipital']],
  ['low back', ['low back', 'lower back', 'lumbar', 'sciatic', 'sciatica', 'disc']],
  ['pelvis/SI', ['pelvis', 'pelvic', 'sacrum', 'si joint', 'sacroiliac', 'sacroiliac']],
  ['hip/glutes', ['hip', 'glute', 'piriformis', 'psoas', 'groin']],
  ['knee', ['knee', 'patella', 'meniscus', 'hamstring']],
  ['foot/ankle', ['foot', 'feet', 'ankle', 'plantar', 'calf', 'achilles']],
  ['thoracic/ribs', ['thoracic', 'rib', 'mid back', 'mid-back', 'kyphosis']],
  ['jaw/TMJ', ['tmj', 'jaw', 'masseter']],
  ['head/face', ['headache', 'cranial', 'occiput', 'migraine']],
  ['core/abdomen', ['abdomen', 'belly', 'diaphragm', 'pelvic floor', 'psoas']],
];

// Which region labels does this query text point at? (substring is fine here —
// these are intentional multi-char anatomy terms, and the query is short.)
function queryRegions(text: string): Set<string> {
  const t = text.toLowerCase();
  const out = new Set<string>();
  for (const [label, hints] of REGION_HINTS) {
    if (hints.some((h) => t.includes(h))) out.add(label);
  }
  return out;
}
interface VideoFrameData {
  id: string;
  title: string;
  course: string;
  frames: FrameEntry[];
}

// A single frame card: thumbnail + timestamp + transcript caption, clickable to enlarge.
function FrameCard({ frame, videoId, itemId, videoTitle }: {
  frame: FrameEntry; videoId: string; itemId: string; videoTitle: string;
}) {
  const [enlarged, setEnlarged] = useState(false);
  // file is like "frames/<videoId>/seg-000-29s.jpg" — extract just the filename
  const fileName = frame.file.split('/').pop() ?? frame.file;
  const src = '/api/databases/kb/' + itemId + '/anatomy/frames/' + videoId + '/' + fileName;
  const ts = Math.round(frame.t_mid);
  const mins = Math.floor(ts / 60);
  const secs = ts % 60;
  const label = (mins > 0 ? mins + 'm' : '') + secs + 's';

  return (
    <>
      <div
        onClick={() => setEnlarged(true)}
        style={{
          width: '120px', flex: '0 0 auto', cursor: 'pointer',
          background: 'var(--color-bg)', border: '1px solid var(--color-border)',
          borderRadius: '8px', overflow: 'hidden',
          transition: 'border-color 0.15s',
        }}
        title={frame.text}
      >
        <div style={{ position: 'relative', background: '#000' }}>
          <img
            src={src}
            alt={frame.text.slice(0, 60)}
            loading="lazy"
            style={{ width: '120px', height: '68px', objectFit: 'cover', display: 'block' }}
          />
          <span style={{
            position: 'absolute', bottom: '3px', right: '4px',
            fontSize: '9px', fontWeight: 700, color: '#fff',
            background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: '3px',
          }}>{label}</span>
          {frame.region && (
            <span style={{
              position: 'absolute', top: '3px', left: '4px',
              fontSize: '9px', fontWeight: 700, color: '#fff',
              background: 'rgba(16,120,90,0.82)', padding: '1px 5px', borderRadius: '3px',
              textTransform: 'capitalize',
            }}>{frame.region}</span>
          )}
        </div>
        <div style={{ padding: '4px 6px' }}>
          <div style={{
            fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.3,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {frame.text.slice(0, 120)}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', marginTop: '2px' }}>{videoTitle}</div>
        </div>
      </div>

      {enlarged && (
        <div
          onClick={() => setEnlarged(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
          }}
        >
          <div style={{ maxWidth: '720px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={frame.text} style={{ width: '100%', borderRadius: '8px', display: 'block' }} />
            <div style={{ marginTop: '12px', color: '#e0e0e0', fontSize: '13px', lineHeight: 1.5 }}>{frame.text}</div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>{videoTitle} · {label}</div>
          </div>
        </div>
      )}
    </>
  );
}

// Match text against a loaded frames index. Returns up to maxCards most-relevant frames.
function matchFrames(
  text: string,
  videosMap: Record<string, VideoFrameData>,
  maxCards = 6,
): Array<{ frame: FrameEntry; videoId: string; videoTitle: string }> {
  if (!text.trim() || Object.keys(videosMap).length === 0) return [];
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (words.length === 0) return [];
  // If the query names a body region, boost frames tagged with that region so
  // they surface even when the segment's own transcript doesn't repeat the word.
  const wantRegions = queryRegions(text);

  const scored: Array<{ frame: FrameEntry; videoId: string; videoTitle: string; score: number }> = [];
  for (const [videoId, vd] of Object.entries(videosMap)) {
    for (const frame of vd.frames) {
      const ft = frame.text.toLowerCase();
      let score = 0;
      for (const w of words) { if (ft.includes(w)) score++; }
      if (frame.region && wantRegions.has(frame.region)) score += 2;
      if (score > 0) scored.push({ frame, videoId, videoTitle: vd.title + ' · ' + vd.course, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  // deduplicate by videoId (max 2 per video) to avoid flooding with one course
  const seen: Record<string, number> = {};
  const result: typeof scored = [];
  for (const item of scored) {
    if ((seen[item.videoId] ?? 0) >= 2) continue;
    seen[item.videoId] = (seen[item.videoId] ?? 0) + 1;
    result.push(item);
    if (result.length >= maxCards) break;
  }
  return result;
}

// A horizontal strip of frame thumbnails for an Erik Dalton Ask/Search result.
function TechniqueStrip({ text, videosMap, itemId }: {
  text: string;
  videosMap: Record<string, VideoFrameData>;
  itemId: string;
}) {
  const matches = useMemo(() => matchFrames(text, videosMap), [text, videosMap]);
  if (matches.length === 0) return null;
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>
        Technique Frames · {matches.length} clip{matches.length > 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
        {matches.map((m, i) => (
          <FrameCard
            key={i}
            frame={m.frame}
            videoId={m.videoId}
            itemId={itemId}
            videoTitle={m.videoTitle}
          />
        ))}
      </div>
      <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', marginTop: '4px' }}>
        Erik Dalton DVD frames — educational reference only
      </div>
    </div>
  );
}

// ── ClayTrader panel: rendered for the 'claytrader' KB ──────────────────────

const VERDICT_STYLE: Record<string, { bg: string; color: string }> = {
  ADOPT: { bg: '#10b98122', color: '#10b981' },
  ADAPT: { bg: '#f59e0b22', color: '#f59e0b' },
  SKIP:  { bg: '#ef444422', color: '#ef4444' },
};

function ClayTraderPanel() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div style={{
      marginTop: '24px', border: '1px solid var(--color-border)',
      borderRadius: '12px', overflow: 'hidden',
      background: 'var(--color-card)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px 10px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)' }}>
            ClayTrader Method Reference
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            5 university setups distilled from transcripts
          </div>
        </div>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
          padding: '3px 8px', borderRadius: '999px',
          background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44',
        }}>
          METHOD REFERENCE — pick-engine wiring staged for approval
        </span>
      </div>

      {/* Setup cards */}
      <div>
        {CLAY_SETUPS.map((s, i) => {
          const vs = VERDICT_STYLE[s.verdict] ?? VERDICT_STYLE.ADAPT;
          const open = openIdx === i;
          return (
            <div key={s.name} style={{ borderBottom: i < CLAY_SETUPS.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : i)}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none',
                  padding: '12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '10px',
                }}
              >
                <span style={{
                  flexShrink: 0, fontSize: '10px', fontWeight: 700, padding: '2px 7px',
                  borderRadius: '999px', background: vs.bg, color: vs.color, marginTop: '1px',
                }}>
                  {s.verdict}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
                    {s.name}
                    <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--color-text-faint)', marginLeft: '8px' }}>
                      {s.course}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '3px', lineHeight: 1.4 }}>
                    {s.summary}
                  </div>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', flexShrink: 0, marginTop: '2px' }}>
                  {open ? '▲' : '▼'}
                </span>
              </button>
              {open && (
                <div style={{ padding: '0 18px 14px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    { label: 'Entry', value: s.entry },
                    { label: 'Stop', value: s.stop },
                    { label: 'R:R', value: s.rvr },
                  ].map((row) => (
                    <div key={row.label} style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                      <span style={{ flexShrink: 0, width: '42px', fontWeight: 700, color: 'var(--color-text-faint)', fontSize: '10px', paddingTop: '2px', textTransform: 'uppercase' }}>
                        {row.label}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)', lineHeight: 1.45 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Habits section */}
      <div style={{ borderTop: '1px solid var(--color-border)', padding: '14px 18px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--color-text-faint)', marginBottom: '10px' }}>
          5 Habits to Fix FOMO Entries
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {CLAY_HABITS.map((h) => (
            <div key={h.n} style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
              <span style={{
                flexShrink: 0, width: '20px', height: '20px', borderRadius: '50%',
                background: 'var(--color-elevated)', color: 'var(--color-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '10px', fontWeight: 700,
              }}>{h.n}</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3 }}>{h.rule}</div>
                <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: '2px' }}>{h.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--color-text-faint)' }}>
          Source: ClayTrader University transcripts (~/claytrader-kb) · Distilled 2026-06-15
        </div>
      </div>
    </div>
  );
}

// Tag arbitrary text with the muscle slugs it references, using the KB's alias
// table. This MUST stay equivalent to tag_text() in erikdalton-kb/anatomy_tags.py
// (both read the same alias table): longest alias first, full word boundary
// (plural-aware), all occurrences tried, result ordered by position in the text.
//
// NOTE for parallel anatomy-tagger agent: aliases are DATA-DRIVEN — they live in
// erikdalton-kb/anatomy/index.json (each muscle's "aliases" array). This TS
// function reads whatever is in that JSON at runtime via /api/databases/kb/erikdalton/anatomy.
// There is NO hardcoded alias table here to sync. When you add forearm/wrist/hand
// muscles to anatomy/index.json, tagMuscles() picks them up automatically.
// TODO (parallel agent): confirm new muscle slugs appear in anatomy/index.json
// once the forearm/wrist/hand tagger run completes.
const isAlpha = (ch: string) => ch >= 'a' && ch <= 'z';
function boundaryOk(left: string, right: string, right2: string): boolean {
  if (isAlpha(left)) return false;
  if (!isAlpha(right)) return true;
  return right === 's' && !isAlpha(right2); // plural: "rhomboids" yes, "psoasxyz" no
}
function tagMuscles(text: string, aliasPairs: [string, string][]): string[] {
  if (!text) return [];
  const low = ' ' + text.toLowerCase() + ' ';
  const n = low.length;
  const pos: Record<string, number> = {};
  for (const [alias, slug] of aliasPairs) {
    if (slug in pos) continue;
    let start = 0;
    for (;;) {
      const idx = low.indexOf(alias, start);
      if (idx < 0) break;
      const e = idx + alias.length;
      const left = low[idx - 1];
      const right = e < n ? low[e] : ' ';
      const right2 = e + 1 < n ? low[e + 1] : ' ';
      if (boundaryOk(left, right, right2)) { pos[slug] = idx; break; }
      start = idx + 1;
    }
  }
  return Object.keys(pos).sort((a, b) => pos[a] - pos[b]);
}

function KbDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  type KbTab = 'explore' | 'conditions' | 'techniques' | 'quiz' | 'examples' | 'ask' | 'search' | 'sources';
  const urlTab = (() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      return (['explore', 'conditions', 'techniques', 'quiz', 'examples', 'ask', 'search', 'sources'] as string[]).includes(t || '') ? (t as KbTab) : null;
    } catch { return null; }
  })();
  const [tab, setTab] = useState<KbTab>(
    urlTab ?? (item.id === 'erikdalton' ? 'explore'
      : item.id === 'claytrader' ? 'examples'
      : item.askable ? 'ask' : 'search'),
  );

  // Ask state
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<KbAskResponse | null>(null);

  // Search state
  const [query, setQuery] = useState('');
  const dq = useDebouncedValue(query, 250);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [search, setSearch] = useState<KbSearchResponse | null>(null);

  // Sources (breakdown) state — lazily loaded the first time the tab opens.
  const [sources, setSources] = useState<KbSourcesResponse | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesErr, setSourcesErr] = useState<string | null>(null);

  // Anatomy image layer — loaded once; empty {} for KBs without one.
  const [anatomy, setAnatomy] = useState<Record<string, AnatomyMuscle>>({});
  useEffect(() => {
    let cancelled = false;
    apiGet<{ muscles: Record<string, AnatomyMuscle> }>('/api/databases/kb/' + item.id + '/anatomy')
      .then((r) => { if (!cancelled) setAnatomy(r.muscles || {}); })
      .catch(() => { /* no anatomy layer for this KB */ });
    return () => { cancelled = true; };
  }, [item.id]);
  const aliasPairs = useMemo<[string, string][]>(() => {
    const pairs: [string, string][] = [];
    for (const [slug, m] of Object.entries(anatomy))
      for (const a of m.aliases || []) pairs.push([a.toLowerCase(), slug]);
    return pairs.sort((x, y) => y[0].length - x[0].length);
  }, [anatomy]);

  // TechniqueStrip: load frames index + per-video frames for erikdalton KB.
  // Loaded lazily — on first Ask/Search result for this KB only.
  const isErikDalton = item.id === 'erikdalton';
  const isClayTrader = item.id === 'claytrader';
  const [videosMap, setVideosMap] = useState<Record<string, VideoFrameData>>({});
  const videosLoaded = useRef(false);
  useEffect(() => {
    if ((!isErikDalton && !isClayTrader) || videosLoaded.current) return;
    videosLoaded.current = true;
    // Load the _index.json to get the list of video IDs, then load each frames.json
    apiGet<Record<string, { title: string; course: string; n_frames: number }>>('/api/databases/kb/' + item.id + '/frames-index')
      .then(async (idx) => {
        const map: Record<string, VideoFrameData> = {};
        // Load all videos in parallel (47 requests, each tiny JSON)
        await Promise.all(Object.entries(idx).map(async ([videoId, meta]) => {
          try {
            const r = await apiGet<{ frames: FrameEntry[] }>('/api/databases/kb/' + item.id + '/frames/' + videoId);
            map[videoId] = { id: videoId, title: meta.title, course: meta.course, frames: r.frames || [] };
          } catch { /* skip failed video */ }
        }));
        setVideosMap(map);
      })
      .catch(() => { /* no frames for this KB or backend not yet restarted */ });
  }, [item.id, isErikDalton, isClayTrader]);

  // Jump from a citation to the Search tab, pre-filled with the lesson heading.
  function jumpToSearch(heading: string) {
    setQuery(heading);
    setTab('search');
  }

  // Cross-tab deep-link navigation: set the URL params the target tab reads on
  // mount (?region=, ?technique=, ?quizmode=…), then switch tabs. Used by the
  // quiz reveal ("Explore this region" / "See full technique") and the Library.
  function goTo(t: KbTab, params: Record<string, string> = {}) {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('tab', t);
      ['region', 'condition', 'technique', 'quizmode', 'reading'].forEach((k) => u.searchParams.delete(k));
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      window.history.replaceState({}, '', u.toString());
    } catch { /* ignore */ }
    setTab(t);
  }

  // First-visit onboarding strip (Erik Dalton page only), dismissible per device.
  const [showIntro, setShowIntro] = useState(() => {
    try { return item.id === 'erikdalton' && localStorage.getItem('erik-intro-dismissed') !== '1'; }
    catch { return item.id === 'erikdalton'; }
  });
  function dismissIntro() {
    setShowIntro(false);
    try { localStorage.setItem('erik-intro-dismissed', '1'); } catch { /* ignore */ }
  }

  async function runAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setAskErr(null);
    setAnswer(null);
    try {
      const r = await apiPost<KbAskResponse>('/api/databases/kb/' + item.id + '/ask', { question });
      setAnswer(r);
    } catch (e) {
      setAskErr(String((e as Error).message || e));
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    if (tab !== 'search') return;
    if (!dq.trim()) { setSearch(null); setSearchErr(null); return; }
    let cancelled = false;
    async function run() {
      setSearching(true);
      setSearchErr(null);
      try {
        const p = new URLSearchParams({ q: dq, top: '10' });
        const r = await apiGet<KbSearchResponse>('/api/databases/kb/' + item.id + '/search?' + p);
        if (!cancelled) setSearch(r);
      } catch (e) {
        if (!cancelled) setSearchErr(String((e as Error).message || e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [dq, tab, item.id]);

  useEffect(() => {
    if (tab !== 'sources' || sources || sourcesLoading) return;
    let cancelled = false;
    async function run() {
      setSourcesLoading(true);
      setSourcesErr(null);
      try {
        const r = await apiGet<KbSourcesResponse>('/api/databases/kb/' + item.id + '/sources');
        if (!cancelled) setSources(r);
      } catch (e) {
        if (!cancelled) setSourcesErr(String((e as Error).message || e));
      } finally {
        if (!cancelled) setSourcesLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [tab, item.id, sources, sourcesLoading]);

  const noData = answer && (answer.abstained || !answer.answer.trim());

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {tab === 'sources' && <RefreshButton onClick={() => setSources(null)} busy={sourcesLoading} />}
            {back}
          </div>
        }
        tabs={
          <>
            {isErikDalton && <Tab label="Explore" active={tab === 'explore'} onClick={() => setTab('explore')} />}
            {isErikDalton && <Tab label="Conditions" active={tab === 'conditions'} onClick={() => setTab('conditions')} />}
            {isErikDalton && <Tab label="Techniques" active={tab === 'techniques'} onClick={() => setTab('techniques')} />}
            {isErikDalton && <Tab label="Quiz" active={tab === 'quiz'} onClick={() => setTab('quiz')} />}
            {isClayTrader && <Tab label="Examples" active={tab === 'examples'} onClick={() => setTab('examples')} />}
            {isClayTrader && <Tab label="Quiz" active={tab === 'quiz'} onClick={() => setTab('quiz')} />}
            {item.askable && <Tab label="Ask" active={tab === 'ask'} onClick={() => setTab('ask')} />}
            <Tab label="Search" active={tab === 'search'} onClick={() => setTab('search')} />
            <Tab label={isErikDalton ? 'Library' : 'Sources'} active={tab === 'sources'} onClick={() => setTab('sources')} />
          </>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '900px', margin: '0 auto' }}>

          {isErikDalton && showIntro && (
            <div style={{ position: 'relative', marginBottom: '18px', padding: '14px 16px', border: '1px solid var(--color-accent)', borderRadius: '12px', background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}>
              <button type="button" onClick={dismissIntro} aria-label="Dismiss"
                style={{ position: 'absolute', top: '8px', right: '10px', background: 'none', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
              <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text)', marginBottom: '6px' }}>👋 Learn Erik Dalton's bodywork — start anywhere</div>
              <div style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', lineHeight: 1.6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '2px 18px' }}>
                <div><b style={{ color: 'var(--color-text)' }}>Explore</b> — tap a body region to see its muscles & techniques.</div>
                <div><b style={{ color: 'var(--color-text)' }}>Conditions</b> — start from a client complaint (sciatica, frozen shoulder…).</div>
                <div><b style={{ color: 'var(--color-text)' }}>Techniques</b> — step through each lesson frame-by-frame with Erik's voice.</div>
                <div><b style={{ color: 'var(--color-text)' }}>Quiz</b> — test yourself: watch a clip, name the body area worked.</div>
                <div><b style={{ color: 'var(--color-text)' }}>Library</b> — browse every course & lesson.</div>
                <div><b style={{ color: 'var(--color-text)' }}>Search / Ask</b> — find or ask anything across the library.</div>
              </div>
            </div>
          )}

          {tab === 'explore' && (
            <ExploreTab itemId={item.id} anatomy={anatomy} videosMap={videosMap} />
          )}

          {tab === 'conditions' && (
            <ConditionsTab itemId={item.id} videosMap={videosMap} />
          )}

          {tab === 'techniques' && (
            <TechniquePlayer itemId={item.id} videosMap={videosMap} />
          )}

          {tab === 'quiz' && isErikDalton && (
            <ErikQuiz anatomy={anatomy} itemId={item.id} videosMap={videosMap} onNavigate={(t, p) => goTo(t as KbTab, p)} />
          )}

          {tab === 'examples' && isClayTrader && (
            <ClayExamples itemId={item.id} videosMap={videosMap} />
          )}

          {tab === 'quiz' && isClayTrader && (
            <ClayQuiz itemId={item.id} videosMap={videosMap} />
          )}

          {tab === 'ask' && (
            <>
              <textarea
                value={question}
                onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void runAsk();
                  }
                }}
                placeholder={'Ask ' + item.label + ' anything…'}
                rows={3}
                class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => void runAsk()}
                  disabled={asking || !question.trim()}
                  class="px-4 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-50"
                >
                  {asking ? 'Thinking…' : 'Ask'}
                </button>
                {asking && (
                  <span class="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                    <span class="animate-spin" style={{
                      width: '12px', height: '12px', borderRadius: '50%',
                      border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)',
                      display: 'inline-block',
                    }} />
                    Thinking…
                  </span>
                )}
                {!asking && (
                  <span class="text-[11px] text-[var(--color-text-faint)]">⌘/Ctrl+Enter to ask</span>
                )}
              </div>

              {askErr && (
                <div style={{ marginTop: '16px' }}>
                  <PageState error={askErr} />
                </div>
              )}

              {answer && !asking && (
                <div style={{ marginTop: '18px' }}>
                  {noData ? (
                    <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]">
                      This KB doesn't cover that.
                    </div>
                  ) : (
                    <>
                      <div style={{
                        background: 'var(--color-card)', border: '1px solid var(--color-border)',
                        borderRadius: '10px', padding: '16px',
                      }}>
                        {answer.used_portfolio && (
                          <span style={{
                            display: 'inline-block', fontSize: '10px', fontWeight: 700,
                            color: '#10b981', background: '#10b98122', padding: '2px 8px',
                            borderRadius: '999px', marginBottom: '10px',
                          }}>portfolio context</span>
                        )}
                        <div
                          class="chat-md"
                          style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text)' }}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.answer) }}
                        />
                      </div>
                      {answer.sources && answer.sources.length > 0 && (
                        <div style={{ marginTop: '14px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '8px', textTransform: 'uppercase' }}>
                            Sources — click to search
                          </div>
                          <ul style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {answer.sources.map((s, i) => (
                              <li key={i}>
                                <button
                                  type="button"
                                  onClick={() => jumpToSearch(citationHeading(s))}
                                  title={'Search this KB for "' + citationHeading(s) + '"'}
                                  style={{
                                    fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: MONO,
                                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                  class="hover:text-[var(--color-accent)] hover:underline"
                                >{s}</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <MuscleStrip
                        slugs={tagMuscles(answer.answer + ' ' + (answer.sources || []).join(' '), aliasPairs)}
                        anatomy={anatomy}
                        itemId={item.id}
                      />
                      {isErikDalton && (
                        <TechniqueStrip
                          text={answer.answer + ' ' + (answer.sources || []).join(' ')}
                          videosMap={videosMap}
                          itemId={item.id}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'search' && (
            <>
              <input
                type="text"
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                placeholder={'Search ' + item.label + '…'}
                class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              {searchErr && <div style={{ marginTop: '16px' }}><PageState error={searchErr} /></div>}
              {searching && <div class="text-[12px] text-[var(--color-text-muted)]" style={{ marginTop: '14px' }}>Searching…</div>}
              {search && !searching && (search.abstained || search.hits.length === 0) && (
                <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]" style={{ marginTop: '14px' }}>
                  No relevant content in this knowledge base.
                </div>
              )}
              {search && !searching && !search.abstained && search.hits.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
                  {search.hits.map((h, i) => {
                    const lc = LAYER_COLOR[h.layer] || '#6b7280';
                    const clayVid = isClayTrader ? claytraderVimeoId(h.source) : null;
                    return (
                      <div key={i} class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
                        <div class="flex items-center gap-2 mb-1 text-xs">
                          {h.layer && (
                            <span style={{ background: lc + '33', color: lc, padding: '2px 6px', borderRadius: 4 }}>{h.layer}</span>
                          )}
                          <span class="text-[var(--color-text-muted)]">{h.source}</span>
                          {h.course && <span class="text-[var(--color-text-faint)]">· {h.course}</span>}
                          <span class="ml-auto text-[var(--color-text-faint)]">dist {h.distance?.toFixed(3)}</span>
                        </div>
                        {h.heading && h.heading !== '---' && (
                          <div class="font-medium text-sm mb-1 text-[var(--color-text)]">{h.heading}</div>
                        )}
                        <div
                          class="chat-md text-xs text-[var(--color-text-muted)]"
                          style={{ lineHeight: 1.55 }}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(h.preview) }}
                        />
                        <MuscleStrip
                          slugs={tagMuscles((h.heading || '') + ' ' + h.preview, aliasPairs)}
                          anatomy={anatomy}
                          itemId={item.id}
                        />
                        {isErikDalton && (
                          <TechniqueStrip
                            text={(h.heading || '') + ' ' + h.preview}
                            videosMap={videosMap}
                            itemId={item.id}
                          />
                        )}
                        {clayVid && (
                          <a
                            href={`https://vimeo.com/${clayVid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the original ClayTrader lesson on Vimeo"
                            style={{
                              display: 'inline-flex', flexDirection: 'column', gap: '4px',
                              marginTop: '10px', textDecoration: 'none', width: '200px', maxWidth: '100%',
                            }}
                          >
                            <span style={{ position: 'relative', display: 'block', borderRadius: '6px', overflow: 'hidden', border: '1px solid #f59e0b55' }}>
                              <img
                                src={`https://vumbnail.com/${clayVid}.jpg`}
                                alt="ClayTrader lesson frame"
                                loading="lazy"
                                width={640}
                                height={360}
                                onError={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }}
                                style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '16 / 9', objectFit: 'cover' }}
                              />
                              <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}>▶</span>
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b' }}>Watch this lesson on Vimeo</span>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'sources' && isErikDalton && (
            <ErikLibrary videosMap={videosMap} onOpen={(id) => goTo('techniques', { technique: id })} />
          )}

          {tab === 'sources' && !isErikDalton && (
            <>
              <div style={{
                background: 'var(--color-card)', border: '1px solid var(--color-border)',
                borderRadius: '10px', padding: '16px', marginBottom: '16px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '6px' }}>
                  {sources && !sources.error
                    ? sources.totalChunks.toLocaleString() + ' chunks · ' + sources.totalSources.toLocaleString() + ' sources'
                    : item.stat}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  {item.size} · updated {fmtUpdated(item.updated)}
                  {sources?.groupBy && <> · grouped by <code style={{ fontFamily: MONO }}>{sources.groupBy}</code></>}
                </div>
              </div>

              {sourcesLoading && <PageState loading />}
              {sourcesErr && <PageState error={sourcesErr} />}
              {sources?.error && (
                <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]">
                  Breakdown unavailable: {sources.error}
                </div>
              )}

              {sources && !sources.error && sources.groups.length > 0 && (
                <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                  {sources.groups.map((g, i) => {
                    const pct = sources.totalChunks > 0 ? (g.chunks / sources.totalChunks) * 100 : 0;
                    return (
                      <div key={i} style={{
                        position: 'relative', padding: '11px 14px',
                        borderBottom: i < sources.groups.length - 1 ? '1px solid var(--color-border)' : 'none',
                      }}>
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: pct + '%', background: 'color-mix(in srgb, var(--color-accent) 9%, transparent)',
                          pointerEvents: 'none',
                        }} />
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ minWidth: 0, flex: 1, fontSize: '13px', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</span>
                          <span style={{ flexShrink: 0, fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO }}>
                            {g.sources > 0 && <>{g.sources.toLocaleString()} src · </>}{g.chunks.toLocaleString()} chunks
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {sources && !sources.error && sources.groups.length === 0 && (
                <div class="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[13px] text-[var(--color-text-muted)]">
                  No per-source breakdown available for this knowledge base.
                </div>
              )}
            </>
          )}

          {/* ClayTrader method reference — always visible on all tabs for this KB */}
          {item.id === 'claytrader' && <ClayTraderPanel />}

        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────── SQL ────────

interface SqlMeta { size: string; tables: { name: string; rows: number }[]; }
interface SqlQueryResponse {
  columns: string[];
  columnTypes?: (string | null)[];
  rows: unknown[][];
  elapsed_ms: number;
  capped?: boolean;
}

// Serialize a result set to CSV (RFC-4180-ish quoting) or row-objects JSON.
function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}
function toJson(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), null, 2);
}

// Save text to a real file via a transient object URL (large result sets don't
// belong on the clipboard). Filename: <dbid>-<localdatetime>.<ext>.
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a tick to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportStamp(): string {
  // YYYYMMDD-HHmmss in the browser's local time, no separators that break
  // filenames. (The operator's laptop browser runs ET.)
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const SQL_HISTORY_MAX = 8;
function historyKey(id: string): string { return `claudeclaw:sqlhist:${id}`; }
function loadHistory(id: string): string[] {
  try {
    const raw = localStorage.getItem(historyKey(id));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
function pushHistory(id: string, sql: string): string[] {
  const q = sql.trim();
  if (!q) return loadHistory(id);
  const prev = loadHistory(id).filter(s => s !== q);
  const next = [q, ...prev].slice(0, SQL_HISTORY_MAX);
  try { localStorage.setItem(historyKey(id), JSON.stringify(next)); } catch { /* quota / disabled */ }
  return next;
}

function SqlDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  const [meta, setMeta] = useState<SqlMeta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [result, setResult] = useState<SqlQueryResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory(item.id));

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(toCsv(result.columns, result.rows));
      setCopied('copy');
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  function downloadResult(fmt: 'csv' | 'json') {
    if (!result) return;
    const text = fmt === 'csv'
      ? toCsv(result.columns, result.rows)
      : toJson(result.columns, result.rows);
    const mime = fmt === 'csv' ? 'text/csv' : 'application/json';
    downloadText(`${item.id}-${exportStamp()}.${fmt}`, text, mime);
  }

  async function loadMeta() {
    setMetaLoading(true);
    setMetaErr(null);
    try {
      const r = await apiGet<SqlMeta>('/api/databases/sql/' + item.id + '/meta');
      setMeta(r);
    } catch (e) {
      setMetaErr(String((e as Error).message || e));
    } finally {
      setMetaLoading(false);
    }
  }

  useEffect(() => {
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function runQuery(sqlText: string) {
    if (!sqlText.trim()) return;
    setRunning(true);
    setQueryErr(null);
    setResult(null);
    try {
      const r = await apiPost<SqlQueryResponse>('/api/databases/sql/' + item.id + '/query', { sql: sqlText });
      setResult(r);
      setHistory(pushHistory(item.id, sqlText));
    } catch (e) {
      // apiPost throws ApiError; the 400 body carries { error }.
      const err = e as { body?: { error?: string }; message?: string };
      setQueryErr(err?.body?.error || String(err?.message || e));
    } finally {
      setRunning(false);
    }
  }

  function previewTable(name: string) {
    const q = 'SELECT * FROM "' + name + '" LIMIT 50';
    setSql(q);
    void runQuery(q);
  }

  // Curated "insight" queries that surface otherwise-dark tables as instant
  // answers (hive-mind efficiency plan 2026-06-13). Keyed by db id; only shown
  // for DBs that have presets. SELECT-only, schema-verified against live data.
  const INSIGHTS: Record<string, { label: string; sql: string }[]> = {
    'desk-pipeline': [
      { label: 'Win rate by source',
        sql: "SELECT source, side, COUNT(*) n, ROUND(100.0*AVG(CASE WHEN forward_5d_aligned THEN 1 ELSE 0 END),1) hit_pct, ROUND(AVG(forward_5d_pct),2) avg_fwd5d FROM historical_outcomes GROUP BY source, side ORDER BY n DESC" },
      { label: 'Veto accuracy (was the veto right?)',
        sql: "SELECT veto_reason, COUNT(*) n, ROUND(AVG(outcome_opt_pnl_pct),1) avg_pnl_if_taken, SUM(CASE WHEN outcome_opt_pnl_pct>0 THEN 1 ELSE 0 END) would_have_won FROM vetoed_candidates WHERE outcome_opt_pnl_pct IS NOT NULL GROUP BY veto_reason ORDER BY n DESC" },
      { label: 'Factor contribution (what drives picks)',
        sql: "SELECT factor_name, COUNT(*) n, ROUND(AVG(contribution),3) avg_contribution, ROUND(AVG(weight),3) avg_weight FROM decipher_audit GROUP BY factor_name ORDER BY ABS(AVG(contribution)) DESC LIMIT 20" },
    ],
  };
  const presets = INSIGHTS[item.id] || [];

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <RefreshButton onClick={() => void loadMeta()} busy={metaLoading} />
            {back}
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '1100px', margin: '0 auto' }}>

          {metaLoading && <PageState loading />}
          {metaErr && <PageState error={metaErr} />}

          {meta && (
            <>
              <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '12px' }}>
                {meta.size} · {meta.tables.length} tables
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))',
                gap: '8px', marginBottom: '20px',
              }}>
                {/* Empty tables sort last and render dimmed — schema leftovers
                    shouldn't visually compete with live tables. Stable sort
                    keeps the server's alphabetical order within each half. */}
                {[...meta.tables].sort((a, b) => Number(a.rows === 0) - Number(b.rows === 0)).map(t => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => previewTable(t.name)}
                    style={{
                      textAlign: 'left', background: 'var(--color-card)',
                      border: '1px solid var(--color-border)', borderRadius: '8px',
                      padding: '10px 12px', cursor: 'pointer',
                      opacity: t.rows === 0 ? 0.55 : 1,
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '3px' }}>
                      {t.rows === 0 ? '0 rows · empty' : `${t.rows.toLocaleString()} rows`}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {presets.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-faint)', marginBottom: '6px' }}>
                Insights · one-click
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => { setSql(p.sql); void runQuery(p.sql); }}
                    style={{
                      fontSize: '12px', padding: '5px 10px', borderRadius: '999px',
                      background: 'var(--color-card)', border: '1px solid var(--color-accent)',
                      color: 'var(--color-text)', cursor: 'pointer',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            value={sql}
            onInput={(e) => setSql((e.target as HTMLTextAreaElement).value)}
            placeholder={'SELECT * FROM …'}
            rows={4}
            spellcheck={false}
            style={{ fontFamily: MONO, fontSize: '13px' }}
            class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => void runQuery(sql)}
              disabled={running || !sql.trim()}
              class="px-4 py-1.5 rounded-md text-[13px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              {running ? 'Running…' : 'Run'}
            </button>
            <span class="text-[11px] text-[var(--color-text-faint)]">SELECT only — writes are blocked.</span>
            {result && !running && (
              <span class="text-[11px] text-[var(--color-text-faint)] ml-auto">{result.rows.length} rows · {result.elapsed_ms}ms</span>
            )}
          </div>

          {history.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-faint)', marginRight: '2px' }}>Recent</span>
              {history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setSql(h); void runQuery(h); }}
                  title={h}
                  style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO }}
                  class="px-2 py-0.5 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] bg-[var(--color-card)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]"
                >{h}</button>
              ))}
              <button
                type="button"
                onClick={() => { try { localStorage.removeItem(historyKey(item.id)); } catch { /* ignore */ } setHistory([]); }}
                title="Clear query history"
                class="px-2 py-0.5 rounded-md text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)]"
              >clear</button>
            </div>
          )}

          {queryErr && (
            <div class="p-3 rounded-md border border-[var(--color-status-failed)] mt-3" style={{ background: 'color-mix(in srgb, var(--color-status-failed) 8%, transparent)' }}>
              <div class="text-[var(--color-status-failed)] text-[12px] font-mono">{queryErr}</div>
            </div>
          )}

          {result && !running && result.columns.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
              <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                {result.rows.length.toLocaleString()} rows · {result.columns.length} cols · {result.elapsed_ms}ms
              </span>
              {result.capped && (
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b' }}>
                  showing first {result.rows.length.toLocaleString()} — result truncated
                </span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => void copyResult()}
                  title="Copy result as CSV to clipboard"
                  class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                >
                  <Copy size={12} /> {copied === 'copy' ? 'copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadResult('csv')}
                  title="Download as .csv file"
                  class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                >
                  <Download size={12} /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => downloadResult('json')}
                  title="Download as .json file"
                  class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                >
                  <Download size={12} /> JSON
                </button>
              </span>
            </div>
          )}

          {result && !running && result.columns.length > 0 && (
            <div style={{ marginTop: '8px', overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px', fontFamily: MONO }}>
                <thead>
                  <tr>
                    {result.columns.map((c, i) => {
                      const ty = result.columnTypes?.[i];
                      return (
                        <th key={i} title={ty ? c + ' : ' + ty : c} style={{
                          textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap',
                          borderBottom: '1px solid var(--color-border)',
                          background: 'var(--color-elevated)', color: 'var(--color-text)',
                          position: 'sticky', top: 0,
                        }}>
                          {c}
                          {ty && <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 400, color: 'var(--color-text-faint)', textTransform: 'lowercase' }}>{ty}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{
                          padding: '6px 10px', whiteSpace: 'nowrap', maxWidth: '380px',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          borderBottom: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)',
                        }} title={cell === null ? 'NULL' : String(cell)}>
                          {cell === null ? <span style={{ opacity: 0.4 }}>NULL</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result && !running && result.columns.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)]" style={{ marginTop: '14px' }}>Query returned no columns.</div>
          )}

        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────── SECRETS ───────

interface SecretItem { name: string; source: string; masked: string; modified?: string | null; }
interface SecretsResponse { groups: { category: string; items: SecretItem[] }[]; }
interface RevealResponse { value: string; }

function SecretRow({ source, name, masked, modified }: SecretItem) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal(): Promise<string | null> {
    if (revealed !== null) return revealed;
    setBusy(true);
    setErr(null);
    try {
      const p = new URLSearchParams({ source, name });
      const r = await apiGet<RevealResponse>('/api/databases/secrets/reveal?' + p);
      setRevealed(r.value);
      return r.value;
    } catch (e) {
      const e2 = e as { body?: { error?: string }; message?: string };
      setErr(e2?.body?.error || String(e2?.message || e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (revealed !== null) { setRevealed(null); return; }
    await reveal();
  }

  async function copy() {
    const val = revealed !== null ? revealed : await reveal();
    if (val == null) return;
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('clipboard blocked');
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 12px', borderBottom: '1px solid var(--color-border)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', fontFamily: MONO }}>{name}</div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source}{modified && <span> · {fmtUpdated(modified)}</span>}
        </div>
      </div>
      <div style={{
        fontSize: '12px', fontFamily: MONO, color: err ? 'var(--color-status-failed)' : 'var(--color-text-muted)',
        maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {err ? err : (busy ? '…' : (revealed !== null ? revealed : masked))}
      </div>
      <button
        type="button"
        onClick={() => void toggle()}
        title={revealed !== null ? 'Hide' : 'Reveal'}
        class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
      >
        {revealed !== null ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy"
        class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
      >
        {copied ? <span style={{ fontSize: '10px', color: '#10b981' }}>copied</span> : <Copy size={15} />}
      </button>
    </div>
  );
}

function SecretsDetail({ item, back }: { item: DbItem; back: ComponentChildren }) {
  const [data, setData] = useState<SecretsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  async function loadSecrets() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiGet<SecretsResponse>('/api/databases/secrets');
      setData(r);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSecrets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const totalCount = data ? data.groups.reduce((n, g) => n + g.items.length, 0) : 0;

  // Client-side filter on name / source / category (case-insensitive).
  const q = filter.trim().toLowerCase();
  const filteredGroups = (data?.groups ?? [])
    .map(g => ({
      category: g.category,
      items: q
        ? g.items.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.source.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q))
        : g.items,
    }))
    .filter(g => g.items.length > 0);

  return (
    <>
      <PageHeader
        title={item.label}
        breadcrumb="Databases"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <RefreshButton onClick={() => void loadSecrets()} busy={loading} />
            {back}
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 24px', maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '16px' }}>
            <KeyRound size={14} /> Values stay masked until you reveal them.
            {data && totalCount > 0 && <span style={{ marginLeft: 'auto' }}>{totalCount} secrets</span>}
          </div>

          {data && totalCount > 0 && (
            <div style={{ position: 'relative', marginBottom: '16px', maxWidth: '360px' }}>
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
                placeholder="Filter secrets…"
                class="w-full pl-8 pr-3 py-1.5 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          )}

          {/* Category jump-nav — 200+ rows are long even filtered. */}
          {filteredGroups.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
              {filteredGroups.map(group => (
                <button
                  key={group.category}
                  type="button"
                  onClick={() => sectionRefs.current[group.category]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  class="px-2.5 py-1 rounded-full text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] bg-[var(--color-card)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]"
                >
                  {group.category} <span style={{ opacity: 0.55 }}>{group.items.length}</span>
                </button>
              ))}
            </div>
          )}

          {loading && <PageState loading />}
          {error && <PageState error={error} />}

          {filteredGroups.map(group => (
            <section
              key={group.category}
              ref={(el) => { sectionRefs.current[group.category] = el as HTMLElement | null; }}
              style={{ marginBottom: '20px', scrollMarginTop: '12px' }}
            >
              <div style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px',
                textTransform: 'uppercase', color: 'var(--color-text-faint)', marginBottom: '8px',
              }}>{group.category}</div>
              <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {group.items.map((s, i) => <SecretRow key={s.source + ':' + s.name + ':' + i} {...s} />)}
              </div>
            </section>
          ))}

          {data && data.groups.length === 0 && (
            <PageState empty emptyTitle="No secrets" emptyDescription="No secret sources were found." />
          )}

          {data && totalCount > 0 && q && filteredGroups.length === 0 && (
            <PageState empty emptyTitle="No matches" emptyDescription={'No secrets match "' + filter.trim() + '".'} />
          )}
        </div>
      </div>
    </>
  );
}
