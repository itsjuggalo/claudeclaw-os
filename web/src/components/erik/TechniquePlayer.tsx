// TechniquePlayer — browse Erik's courses → a technique → step through its
// extracted key-frames in time order, each paired with the transcript at that
// moment. Turns the 2,107 recovered frames into step-by-step visual lessons.
// All data comes from the already-loaded frames map (no extra fetch).
import { useMemo, useState } from 'preact/hooks';

interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }

const ACCENT = '#10b981';
const STUDIED_KEY = 'erik-studied-techniques';

function loadStudied(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STUDIED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveStudied(s: Set<string>) {
  try { localStorage.setItem(STUDIED_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

export function TechniquePlayer({ itemId, videosMap }: {
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
}) {
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  // Which techniques the user has marked studied (persists on this device).
  const [studied, setStudied] = useState<Set<string>>(loadStudied);
  const toggleStudied = (id: string) => setStudied((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveStudied(next);
    return next;
  });

  // Group videos by course, sorted; each course's techniques sorted by title.
  const byCourse = useMemo(() => {
    const m: Record<string, VideoFrameData[]> = {};
    for (const v of Object.values(videosMap)) {
      if (!v.frames || v.frames.length === 0) continue;
      (m[v.course] ||= []).push(v);
    }
    for (const c of Object.keys(m)) m[c].sort((a, b) => a.title.localeCompare(b.title));
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [videosMap]);

  const video = videoId ? videosMap[videoId] : null;
  const frames = useMemo(() => {
    if (!video) return [];
    return [...video.frames].sort((a, b) => a.t_mid - b.t_mid);
  }, [video]);

  const frameSrc = (file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + (videoId ?? '') + '/' + (file.split('/').pop() ?? file);
  const fmtTime = (s: number) => {
    const t = Math.round(s); const m = Math.floor(t / 60); const sec = t % 60;
    return (m > 0 ? m + 'm' : '') + sec + 's';
  };

  function openVideo(id: string) { setVideoId(id); setStep(0); }

  if (Object.keys(videosMap).length === 0) {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading techniques…</div>;
  }

  // ── Player view ──
  if (video) {
    const f = frames[step];
    return (
      <div>
        <button type="button" onClick={() => setVideoId(null)}
          style={{ fontSize: '12px', color: ACCENT, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '10px' }}>
          ← All techniques
        </button>
        <h3 style={{ margin: '0 0 2px', fontSize: '18px', color: 'var(--color-text)' }}>{video.title}</h3>
        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '10px' }}>{video.course} · step {step + 1} of {frames.length}</div>
        <button type="button" onClick={() => toggleStudied(video.id)}
          style={{ marginBottom: '14px', padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            border: '1px solid ' + (studied.has(video.id) ? ACCENT : 'var(--color-border)'),
            background: studied.has(video.id) ? ACCENT + '22' : 'transparent',
            color: studied.has(video.id) ? ACCENT : 'var(--color-text-muted)' }}>
          {studied.has(video.id) ? '✓ Studied — click to unmark' : 'Mark as studied'}
        </button>

        {f && (
          <div style={{ maxWidth: '640px' }}>
            <div style={{ position: 'relative', background: '#000', borderRadius: '10px', overflow: 'hidden' }}>
              <img src={frameSrc(f.file)} alt={f.text.slice(0, 60)} style={{ width: '100%', display: 'block' }} />
              <span style={{ position: 'absolute', top: '8px', right: '10px', fontSize: '11px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '2px 7px', borderRadius: '4px' }}>{fmtTime(f.t_mid)}</span>
              {f.region && <span style={{ position: 'absolute', top: '8px', left: '10px', fontSize: '11px', fontWeight: 700, color: '#fff', background: 'rgba(16,120,90,0.85)', padding: '2px 7px', borderRadius: '4px', textTransform: 'capitalize' }}>{f.region}</span>}
            </div>
            <div style={{ marginTop: '10px', fontSize: '14px', lineHeight: 1.55, color: 'var(--color-text)' }}>{f.text}</div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '14px', alignItems: 'center' }}>
              <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}
                style={{ padding: '6px 14px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'var(--color-card)', color: step === 0 ? 'var(--color-text-faint)' : 'var(--color-text)', cursor: step === 0 ? 'default' : 'pointer', fontSize: '13px' }}>← Prev</button>
              <button type="button" disabled={step >= frames.length - 1} onClick={() => setStep((s) => Math.min(frames.length - 1, s + 1))}
                style={{ padding: '6px 14px', borderRadius: '7px', border: '1px solid ' + ACCENT, background: ACCENT + '22', color: ACCENT, cursor: step >= frames.length - 1 ? 'default' : 'pointer', fontSize: '13px', fontWeight: 600, opacity: step >= frames.length - 1 ? 0.5 : 1 }}>Next step →</button>
            </div>

            {/* filmstrip */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginTop: '14px', paddingBottom: '4px' }}>
              {frames.map((fr, i) => (
                <img key={i} src={frameSrc(fr.file)} alt={'step ' + (i + 1)} loading="lazy" onClick={() => setStep(i)}
                  style={{ width: '74px', height: '42px', objectFit: 'cover', borderRadius: '5px', cursor: 'pointer', flex: '0 0 auto', border: '2px solid ' + (i === step ? ACCENT : 'transparent'), opacity: i === step ? 1 : 0.6 }} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Browse view ──
  const withFrames = Object.values(videosMap).filter((v) => v.frames?.length);
  const studiedCount = withFrames.filter((v) => studied.has(v.id)).length;
  const pct = withFrames.length ? Math.round((studiedCount / withFrames.length) * 100) : 0;
  return (
    <div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
        {byCourse.length} courses · {withFrames.length} techniques with frames. Pick a course, then a technique to step through it.
      </div>
      {/* study progress */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '4px' }}>
          <span>Your progress</span>
          <span><b style={{ color: ACCENT }}>{studiedCount}</b> / {withFrames.length} studied · {pct}%</span>
        </div>
        <div style={{ height: '6px', borderRadius: '999px', background: 'var(--color-border)', overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: ACCENT, transition: 'width .3s' }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {byCourse.map(([course, vids]) => {
          const open = openCourse === course;
          return (
            <div key={course} style={{ border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpenCourse(open ? null : course)}
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'var(--color-card)', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{course}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                  {(() => { const s = vids.filter((v) => studied.has(v.id)).length; return s > 0 ? <span style={{ color: ACCENT }}>{s}/{vids.length} ✓ · </span> : null; })()}
                  {vids.length} · {open ? '▲' : '▼'}
                </span>
              </button>
              {open && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {vids.map((v) => (
                    <button key={v.id} type="button" onClick={() => openVideo(v.id)}
                      style={{ textAlign: 'left', padding: '8px 14px', background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: studied.has(v.id) ? ACCENT : 'var(--color-text-muted)' }}>
                        {studied.has(v.id) ? '✓ ' : ''}{v.title}
                      </span>
                      <span style={{ fontSize: '10px', color: ACCENT }}>{v.frames.length} steps ▶</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
