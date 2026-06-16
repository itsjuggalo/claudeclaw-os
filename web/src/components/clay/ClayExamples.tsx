// ClayExamples — gallery of the vision-curated chart stills pulled from Clay's lessons,
// grouped/filterable by trading topic. Each thumbnail enlarges in a lightbox with its lesson
// + course. Pure frontend — reads the page's already-loaded videosMap (frames carry `topic`).
import { useMemo, useState } from 'preact/hooks';

interface FrameEntry { seg: number; t?: number; file: string; text?: string; topic?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }

interface Shot { src: string; topic: string; title: string; course: string; }

export function ClayExamples({ itemId, videosMap }: {
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
}) {
  const shots = useMemo<Shot[]>(() => {
    const out: Shot[] = [];
    for (const [vid, vd] of Object.entries(videosMap)) {
      for (const f of vd.frames) {
        if (!f.topic) continue;
        out.push({
          src: '/api/databases/kb/' + itemId + '/anatomy/frames/' + vid + '/' + (f.file.split('/').pop() || f.file),
          topic: f.topic, title: vd.title, course: vd.course,
        });
      }
    }
    return out;
  }, [itemId, videosMap]);

  const topics = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of shots) c[s.topic] = (c[s.topic] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [shots]);

  const [topic, setTopic] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Shot | null>(null);
  const shown = topic ? shots.filter((s) => s.topic === topic) : shots;

  if (!shots.length) {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>
      Chart examples are still being curated from Clay's lessons — check back shortly.
    </div>;
  }

  const chip = (label: string, val: string | null, n?: number) => (
    <button type="button" onClick={() => setTopic(val)}
      style={{ padding: '5px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        border: '1px solid ' + (topic === val ? '#f59e0b' : 'var(--color-border)'),
        background: topic === val ? '#f59e0b22' : 'transparent',
        color: topic === val ? '#f59e0b' : 'var(--color-text-muted)' }}>
      {label}{n != null ? ` ${n}` : ''}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
        {chip('All', null, shots.length)}
        {topics.map(([t, n]) => chip(t, t, n))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
        {shown.map((s, i) => (
          <button key={i} type="button" onClick={() => setZoom(s)}
            style={{ textAlign: 'left', padding: 0, border: '1px solid var(--color-border)', borderRadius: '10px',
              overflow: 'hidden', background: 'var(--color-card)', cursor: 'zoom-in' }}>
            <img src={s.src} alt={s.title} loading="lazy"
              style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block', background: '#000' }} />
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.topic}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text)', marginTop: '2px', lineHeight: 1.3 }}>{s.title}</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '2px' }}>{s.course}</div>
            </div>
          </button>
        ))}
      </div>

      {zoom && (
        <div onClick={() => setZoom(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', cursor: 'zoom-out' }}>
          <div style={{ maxWidth: '1100px', width: '100%' }}>
            <img src={zoom.src} alt={zoom.title}
              style={{ width: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: '10px', display: 'block' }} />
            <div style={{ marginTop: '10px', color: '#e8ecf2', textAlign: 'center' }}>
              <span style={{ color: '#f59e0b', fontWeight: 700 }}>{zoom.topic}</span>
              {'  ·  '}{zoom.title}<span style={{ color: '#9aa4b2' }}>{'  ·  ' + zoom.course}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
