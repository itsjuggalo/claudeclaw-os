import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { formatRelativeTime } from '@/lib/format';

interface HiveEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  summary: string;
  artifacts: string | null;
  created_at: number;
}

interface Props {
  entries: HiveEntry[];
  agentFilter: string; // 'all' | agent_id
  agentColors: Record<string, string>;
  blurOn: boolean;
}

// Stylized brain silhouette in a 800×500 viewBox. Two hemispheres with
// a soft pinch at the longitudinal fissure. Coordinates picked by hand
// to read as a brain at a glance — not anatomically faithful.
const BRAIN_PATH =
  'M 110,270 ' +
  'C 110,150 230,80 360,90 ' +
  'C 380,72 420,72 440,90 ' +
  'C 570,80 690,150 690,270 ' +
  'C 700,335 660,385 590,405 ' +
  'C 565,440 515,460 470,455 ' +
  'C 450,475 420,485 400,478 ' +
  'C 380,485 350,475 330,455 ' +
  'C 285,460 235,440 210,405 ' +
  'C 140,385 100,335 110,270 Z';

const VIEW_W = 800;
const VIEW_H = 500;
const MAX_DOTS = 320;

// Mulberry32 — tiny, stable PRNG seeded by an int. Used so the layout
// is deterministic across reloads (same entry id → same seed).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt { x: number; y: number }

// Generate N points inside the brain path via rejection sampling. Runs
// once after mount when the SVG path is in the DOM and we can call
// isPointInFill on it.
function generatePoints(pathEl: SVGPathElement, count: number): Pt[] {
  const r = rng(0xb14b);
  const out: Pt[] = [];
  let tries = 0;
  const maxTries = count * 30;
  while (out.length < count && tries < maxTries) {
    tries++;
    const x = 80 + r() * (VIEW_W - 160);
    const y = 70 + r() * (VIEW_H - 140);
    // SVGPathElement.isPointInFill expects an SVGPoint in the path's
    // own coord space. Modern browsers accept a DOMPoint-like object.
    if ((pathEl as any).isPointInFill({ x, y })) {
      // Quick spacing — reject if too close to an existing point.
      let tooClose = false;
      for (const p of out) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < 9 * 9) { tooClose = true; break; }
      }
      if (!tooClose) out.push({ x, y });
    }
  }
  return out;
}

export function BrainGraph({ entries, agentFilter, agentColors, blurOn }: Props) {
  const pathRef = useRef<SVGPathElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<HiveEntry | null>(null);

  useEffect(() => {
    if (!pathRef.current) return;
    setPoints(generatePoints(pathRef.current, MAX_DOTS));
  }, []);

  // Slot the most recent entries into the precomputed points. New
  // entries push older ones out of the visualization.
  const sliced = useMemo(() => entries.slice(0, points.length), [entries, points.length]);

  // Edges: connect consecutive entries within the same chat_id when
  // they happened within 30 minutes of each other. Gives the graph
  // its sessions-of-activity feel without a force layout.
  const edges = useMemo(() => {
    if (sliced.length === 0 || points.length === 0) return [] as Array<{ a: number; b: number; agent: string }>;
    const out: Array<{ a: number; b: number; agent: string }> = [];
    const byChat = new Map<string, number[]>();
    sliced.forEach((e, i) => {
      const arr = byChat.get(e.chat_id);
      if (arr) arr.push(i); else byChat.set(e.chat_id, [i]);
    });
    for (const idxs of byChat.values()) {
      if (idxs.length < 2) continue;
      const sorted = idxs.slice().sort((a, b) => sliced[a].created_at - sliced[b].created_at);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        if (sliced[b].created_at - sliced[a].created_at <= 1800) {
          out.push({ a, b, agent: sliced[a].agent_id });
        }
      }
    }
    return out;
  }, [sliced, points.length]);

  function handleMove(e: MouseEvent) {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const hoveredEntry = hovered !== null ? sliced.find((e) => e.id === hovered) || null : null;

  return (
    <div class="relative flex-1 min-h-0 overflow-hidden" ref={wrapRef} onMouseMove={handleMove}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        class="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="brainGlow" cx="50%" cy="48%" r="55%">
            <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.10" />
            <stop offset="60%" stop-color="var(--color-accent)" stop-opacity="0.04" />
            <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0" />
          </radialGradient>
          <filter id="dotBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        <path
          ref={pathRef}
          d={BRAIN_PATH}
          fill="url(#brainGlow)"
          stroke="var(--color-border-strong)"
          stroke-width="1"
          stroke-dasharray="3 4"
          opacity="0.85"
        />
        {/* Subtle longitudinal fissure */}
        <path
          d="M 400,90 C 395,200 405,300 400,478"
          fill="none"
          stroke="var(--color-border)"
          stroke-width="0.8"
          stroke-dasharray="2 5"
          opacity="0.5"
        />

        {/* Edges first so dots draw on top */}
        {edges.map((edge, i) => {
          const pa = points[edge.a];
          const pb = points[edge.b];
          if (!pa || !pb) return null;
          const dim = agentFilter !== 'all' && edge.agent !== agentFilter;
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={agentColors[edge.agent] || 'var(--color-text-faint)'}
              stroke-width={dim ? 0.4 : 0.9}
              opacity={dim ? 0.15 : 0.45}
            />
          );
        })}

        {sliced.map((entry, i) => {
          const p = points[i];
          if (!p) return null;
          const dim = agentFilter !== 'all' && entry.agent_id !== agentFilter;
          const isHovered = hovered === entry.id;
          const color = agentColors[entry.agent_id] || 'var(--color-text-muted)';
          const r = isHovered ? 5.5 : 3.5;
          return (
            <g key={entry.id}>
              {isHovered && (
                <circle cx={p.x} cy={p.y} r={11} fill={color} opacity={0.18} filter="url(#dotBlur)" />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={color}
                opacity={dim ? 0.18 : 0.95}
                stroke={isHovered ? 'white' : 'none'}
                stroke-width={isHovered ? 0.8 : 0}
                style={{ cursor: 'pointer', transition: 'r 120ms, opacity 120ms' }}
                onMouseEnter={() => setHovered(entry.id)}
                onMouseLeave={() => setHovered((h) => (h === entry.id ? null : h))}
                onClick={() => setSelected(entry)}
              />
            </g>
          );
        })}
      </svg>

      {points.length > 0 && entries.length === 0 && (
        <div class="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--color-text-faint)] pointer-events-none">
          No activity yet.
        </div>
      )}

      {hoveredEntry && mousePos && (
        <div
          class="absolute pointer-events-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-xl px-3 py-2 text-[11.5px] text-[var(--color-text)] max-w-[320px] z-10"
          style={{
            left: Math.min(mousePos.x + 12, (wrapRef.current?.clientWidth || 800) - 340),
            top: Math.min(mousePos.y + 12, (wrapRef.current?.clientHeight || 500) - 110),
          }}
        >
          <div class="flex items-center gap-2 mb-1">
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: agentColors[hoveredEntry.agent_id] || 'var(--color-text-muted)' }}
            />
            <span class="font-mono text-[10.5px] text-[var(--color-text-muted)]">
              @{hoveredEntry.agent_id} · {hoveredEntry.action}
            </span>
            <span class="text-[10px] text-[var(--color-text-faint)] ml-auto tabular-nums">
              {formatRelativeTime(hoveredEntry.created_at)}
            </span>
          </div>
          <div class={'leading-snug ' + (blurOn ? 'privacy-blur' : '')}>
            {hoveredEntry.summary}
          </div>
        </div>
      )}

      {selected && (
        <DetailPanel
          entry={selected}
          color={agentColors[selected.agent_id] || 'var(--color-text-muted)'}
          blurOn={blurOn}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function DetailPanel({
  entry,
  color,
  blurOn,
  onClose,
}: {
  entry: HiveEntry;
  color: string;
  blurOn: boolean;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div class="absolute top-3 right-3 bottom-3 w-[360px] bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col z-20">
      <div class="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-2">
        <span class="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span class="font-mono text-[12px] text-[var(--color-text)]">@{entry.agent_id}</span>
        <span class="text-[10.5px] text-[var(--color-text-faint)] ml-auto tabular-nums">
          {formatRelativeTime(entry.created_at)}
        </span>
        <button
          type="button"
          onClick={onClose}
          class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Action</div>
          <div class="font-mono text-[11.5px] text-[var(--color-text)]">{entry.action}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Summary</div>
          <div
            class={'text-[12.5px] text-[var(--color-text)] leading-relaxed ' + (blurOn && !revealed ? 'privacy-blur' : (blurOn && revealed ? 'privacy-blur revealed' : ''))}
            onClick={() => blurOn && setRevealed((v) => !v)}
          >
            {entry.summary}
          </div>
        </div>
        {entry.artifacts && (
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Artifacts</div>
            <div class="font-mono text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap break-words">
              {entry.artifacts}
            </div>
          </div>
        )}
        <div>
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Chat</div>
          <div class="font-mono text-[11px] text-[var(--color-text-muted)] truncate">{entry.chat_id}</div>
        </div>
      </div>
    </div>
  );
}
