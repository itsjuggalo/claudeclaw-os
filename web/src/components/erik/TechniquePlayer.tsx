// TechniquePlayer — browse Erik's courses → a technique → step through its
// extracted key-frames in time order, each paired with the transcript at that
// moment. Turns the 2,107 recovered frames into step-by-step visual lessons.
// All data comes from the already-loaded frames map (no extra fetch).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';

interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }
interface QuizBankItem { clipUrl: string; videoId: string; technique: string; caption: string; }

const ACCENT = '#10b981';
const STUDIED_KEY = 'erik-studied-techniques';

function loadStudied(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STUDIED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveStudied(s: Set<string>) {
  try { localStorage.setItem(STUDIED_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

// Plays Erik's REAL teaching voice for the current step (sliced from the source
// DVD per t_start/t_end). Hides itself if the clip is missing or the audio route
// isn't live yet — so the player degrades gracefully, never shows a broken control.
function StepAudio({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontSize: '12px', color: ACCENT, fontWeight: 700, marginBottom: '4px' }}>🔊 Erik’s voice — this step</div>
      <audio controls preload="none" src={src} onError={() => setFailed(true)}
        style={{ width: '100%', maxWidth: '440px', height: '38px' }} />
    </div>
  );
}

// Plays the curated MOTION CLIP for this technique (5s, centered on the teaching
// moment, with Erik's voice) — muted autoplay with a one-tap unmute. Hides itself
// if the clip route isn't live yet, so the player degrades gracefully.
function TechClip({ src, caption }: { src: string; caption?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  if (failed) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '12px', color: ACCENT, fontWeight: 700, marginBottom: '4px' }}>🎬 Technique in motion</div>
      <div style={{ position: 'relative', maxWidth: '640px' }}>
        <video ref={ref} src={src} autoPlay loop muted playsInline controls onError={() => setFailed(true)}
          style={{ width: '100%', borderRadius: '10px', display: 'block', background: '#000' }} />
        <button type="button" onClick={() => setMuted((m) => !m)}
          style={{ position: 'absolute', top: '8px', right: '8px', padding: '4px 10px', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', border: 'none', background: 'rgba(0,0,0,0.62)', color: '#fff' }}>
          {muted ? '🔇 Tap for Erik’s voice' : '🔊 Voice on'}
        </button>
      </div>
      {caption && <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px', lineHeight: 1.5 }}>{caption}</div>}
    </div>
  );
}

export function TechniquePlayer({ itemId, videosMap }: {
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
}) {
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [reading, setReading] = useState(false);
  // Which techniques the user has marked studied (persists on this device).
  const [studied, setStudied] = useState<Set<string>>(loadStudied);
  const toggleStudied = (id: string) => setStudied((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveStudied(next);
    return next;
  });

  // Curated motion clips, indexed by video id (one key teaching moment per technique).
  const [clipByVideo, setClipByVideo] = useState<Record<string, QuizBankItem>>({});
  useEffect(() => {
    let live = true;
    apiGet<{ items?: QuizBankItem[] }>('/api/databases/kb/' + itemId + '/quiz-bank')
      .then((r) => {
        if (!live || !Array.isArray(r.items)) return;
        const m: Record<string, QuizBankItem> = {};
        for (const it of r.items) if (it.videoId && !m[it.videoId]) m[it.videoId] = it;
        setClipByVideo(m);
      })
      .catch(() => { /* clips route not live yet → frames-only */ });
    return () => { live = false; };
  }, [itemId]);

  // Deep-link: ?technique=<id>[&reading=1] opens a specific technique directly
  // (shareable). Applies once, after the frames map has loaded.
  const appliedDeepLink = useRef(false);
  useEffect(() => {
    if (appliedDeepLink.current || Object.keys(videosMap).length === 0) return;
    appliedDeepLink.current = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get('technique');
      if (t && videosMap[t]) { setVideoId(t); setStep(0); setReading(sp.get('reading') === '1'); }
    } catch { /* ignore */ }
  }, [videosMap]);

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
  const audioSrc = (fr: FrameEntry) =>
    '/api/databases/kb/' + itemId + '/anatomy/audio/' + (videoId ?? '') + '/seg-' + String(fr.seg).padStart(3, '0') + '.mp3';
  const fmtTime = (s: number) => {
    const t = Math.round(s); const m = Math.floor(t / 60); const sec = t % 60;
    return (m > 0 ? m + 'm' : '') + sec + 's';
  };

  function openVideo(id: string) { setVideoId(id); setStep(0); setReading(false); }

  if (Object.keys(videosMap).length === 0) {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading techniques…</div>;
  }

  // ── Player view ──
  if (video) {
    const f = frames[step];
    return (
      <div>
        <button type="button" onClick={() => setVideoId(null)}
          style={{ fontSize: '13px', color: ACCENT, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '10px' }}>
          ← All techniques
        </button>
        <h3 style={{ margin: '0 0 2px', fontSize: '18px', color: 'var(--color-text)' }}>{video.title}</h3>
        <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '10px' }}>{video.course} · step {step + 1} of {frames.length}</div>
        <button type="button" onClick={() => toggleStudied(video.id)}
          style={{ marginBottom: '14px', padding: '5px 12px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: '1px solid ' + (studied.has(video.id) ? ACCENT : 'var(--color-border)'),
            background: studied.has(video.id) ? ACCENT + '22' : 'transparent',
            color: studied.has(video.id) ? ACCENT : 'var(--color-text-muted)' }}>
          {studied.has(video.id) ? '✓ Studied — click to unmark' : 'Mark as studied'}
        </button>
        <button type="button" onClick={() => setReading((r) => !r)}
          style={{ marginLeft: '8px', marginBottom: '14px', padding: '5px 12px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)' }}>
          {reading ? '▶ Step view' : '📖 Read full lesson'}
        </button>

        {clipByVideo[video.id] && (
          <TechClip src={clipByVideo[video.id].clipUrl} caption={clipByVideo[video.id].caption} />
        )}

        {reading && (
          <div style={{ maxWidth: '680px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '12px' }}>Full transcript · {frames.length} segments in order — click a frame to jump to that step.</div>
            {frames.map((fr, i) => (
              <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '14px', alignItems: 'flex-start' }}>
                <img src={frameSrc(fr.file)} alt={'segment ' + (i + 1)} loading="lazy"
                  onClick={() => { setReading(false); setStep(i); }}
                  style={{ width: '120px', height: '68px', objectFit: 'cover', borderRadius: '6px', flex: '0 0 auto', cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: '11px', color: ACCENT, fontWeight: 700, marginBottom: '2px', textTransform: 'capitalize' }}>{fmtTime(fr.t_mid)}{fr.region ? ' · ' + fr.region : ''}</div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.55 }}>{fr.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!reading && f && (
          <div style={{ maxWidth: '640px' }}>
            <div style={{ position: 'relative', background: '#000', borderRadius: '10px', overflow: 'hidden' }}>
              <img src={frameSrc(f.file)} alt={f.text.slice(0, 60)} style={{ width: '100%', display: 'block' }} />
              <span style={{ position: 'absolute', top: '8px', right: '10px', fontSize: '12px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '2px 7px', borderRadius: '4px' }}>{fmtTime(f.t_mid)}</span>
              {f.region && <span style={{ position: 'absolute', top: '8px', left: '10px', fontSize: '12px', fontWeight: 700, color: '#fff', background: 'rgba(16,120,90,0.85)', padding: '2px 7px', borderRadius: '4px', textTransform: 'capitalize' }}>{f.region}</span>}
            </div>
            <div style={{ marginTop: '10px', fontSize: '14px', lineHeight: 1.55, color: 'var(--color-text)' }}>{f.text}</div>

            <StepAudio key={step} src={audioSrc(f)} />

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
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '4px' }}>
          <span>Your progress</span>
          <span><b style={{ color: ACCENT }}>{studiedCount}</b> / {withFrames.length} studied · {pct}%</span>
        </div>
        <div style={{ height: '6px', borderRadius: '999px', background: 'var(--color-border)', overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: ACCENT, transition: 'width .3s' }} />
        </div>
      </div>

      {/* Jump straight to a technique by name/keyword across all courses. */}
      <input
        type="text"
        value={filter}
        onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        placeholder="Search techniques (e.g. scalene, sciatica, shoulder)…"
        class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        style={{ marginBottom: '14px' }}
      />

      {(() => {
        const fq = filter.trim().toLowerCase();
        if (!fq) return null;
        const matches = withFrames
          .filter((v) => (v.title + ' ' + v.course).toLowerCase().includes(fq))
          .sort((a, b) => a.title.localeCompare(b.title));
        return (
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden', marginBottom: '4px' }}>
            {matches.length === 0 && <div style={{ padding: '12px 14px', fontSize: '13px', color: 'var(--color-text-faint)' }}>No techniques match “{filter}”.</div>}
            {matches.map((v, i) => (
              <button key={v.id} type="button" onClick={() => openVideo(v.id)}
                class="transition-colors hover:bg-[var(--color-elevated)]"
                style={{ textAlign: 'left', padding: '11px 14px', background: 'transparent', border: 'none', borderTop: i ? '1px solid var(--color-border)' : 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: '13px', color: studied.has(v.id) ? ACCENT : 'var(--color-text)' }}>{studied.has(v.id) ? '✓ ' : ''}{v.title}</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginLeft: '8px' }}>{v.course}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: '11px', color: ACCENT, fontWeight: 600 }}>{v.frames.length} steps ▶</span>
              </button>
            ))}
          </div>
        );
      })()}

      <div style={{ display: filter.trim() ? 'none' : 'flex', flexDirection: 'column', gap: '6px' }}>
        {byCourse.map(([course, vids]) => {
          const open = openCourse === course;
          return (
            <div key={course} style={{ border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpenCourse(open ? null : course)}
                class="transition-colors hover:bg-[var(--color-elevated)]"
                style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: 'var(--color-card)', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{course}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
                  {(() => { const s = vids.filter((v) => studied.has(v.id)).length; return s > 0 ? <span style={{ color: ACCENT }}>{s}/{vids.length} ✓ · </span> : null; })()}
                  {vids.length} · {open ? '▲' : '▼'}
                </span>
              </button>
              {open && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {vids.map((v) => (
                    <button key={v.id} type="button" onClick={() => openVideo(v.id)}
                      class="transition-colors hover:bg-[var(--color-elevated)]"
                      style={{ textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: studied.has(v.id) ? ACCENT : 'var(--color-text-muted)' }}>
                        {studied.has(v.id) ? '✓ ' : ''}{v.title}
                      </span>
                      <span style={{ fontSize: '11px', color: ACCENT }}>{v.frames.length} steps ▶</span>
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
