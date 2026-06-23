// ErikLibrary — a browsable course → lesson index of Erik's whole library, built
// from the already-loaded frames map. Replaces the old raw "chunks · sources" stats
// tab (useless to a learner) with a searchable catalogue: every course, every lesson,
// teaching-frame counts, and a one-click jump into the step-through Techniques player.
import { useMemo, useState } from 'preact/hooks';

interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }

const ACCENT = '#10b981';

export function ErikLibrary({ videosMap, onOpen }: {
  videosMap: Record<string, VideoFrameData>;
  onOpen: (videoId: string) => void;
}) {
  const [q, setQ] = useState('');

  const byCourse = useMemo(() => {
    const m: Record<string, VideoFrameData[]> = {};
    for (const v of Object.values(videosMap)) {
      if (!v.frames || v.frames.length === 0) continue;
      (m[v.course] ||= []).push(v);
    }
    for (const c of Object.keys(m)) m[c].sort((a, b) => a.title.localeCompare(b.title));
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [videosMap]);

  const fq = q.trim().toLowerCase();
  const totals = useMemo(() => {
    const vids = Object.values(videosMap).filter((v) => v.frames?.length);
    return {
      courses: byCourse.length,
      lessons: vids.length,
      frames: vids.reduce((n, v) => n + v.frames.length, 0),
    };
  }, [videosMap, byCourse]);

  if (Object.keys(videosMap).length === 0) {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading library…</div>;
  }

  return (
    <div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
        Erik Dalton's full library — <b style={{ color: 'var(--color-text)' }}>{totals.courses}</b> courses ·{' '}
        <b style={{ color: 'var(--color-text)' }}>{totals.lessons}</b> lessons ·{' '}
        <b style={{ color: 'var(--color-text)' }}>{totals.frames.toLocaleString()}</b> teaching frames.
        Search or browse, then open any lesson to step through it.
      </div>

      <input
        type="text"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        placeholder="Search lessons & courses…"
        class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        style={{ marginBottom: '14px' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {byCourse.map(([course, vids]) => {
          const shown = fq ? vids.filter((v) => (v.title + ' ' + course).toLowerCase().includes(fq)) : vids;
          if (shown.length === 0) return null;
          return (
            <div key={course}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)' }}>{course}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{shown.length} lesson{shown.length !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden', background: 'var(--color-card)' }}>
                {shown.map((v, i) => (
                  <button key={v.id} type="button" onClick={() => onOpen(v.id)}
                    style={{ textAlign: 'left', padding: '9px 13px', background: 'transparent', border: 'none', borderTop: i ? '1px solid var(--color-border)' : 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12.5px', color: 'var(--color-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                    <span style={{ flexShrink: 0, fontSize: '10.5px', color: ACCENT, fontWeight: 600 }}>{v.frames.length} steps ▶</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {fq && byCourse.every(([course, vids]) => vids.filter((v) => (v.title + ' ' + course).toLowerCase().includes(fq)).length === 0) && (
          <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>No lessons match “{q}”.</div>
        )}
      </div>
    </div>
  );
}
