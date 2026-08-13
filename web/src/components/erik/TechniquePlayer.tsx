// TechniquePlayer — browse Erik's courses → a technique → step through its
// extracted key-frames in time order, each paired with the transcript at that
// moment. Turns the 2,107 recovered frames into step-by-step visual lessons.
// All data comes from the already-loaded frames map (no extra fetch).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { frameScore } from './ExploreTab';

interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; covers?: string; }
interface QuizBankItem { clipUrl: string; videoId: string; technique: string; caption: string; }

const ACCENT = '#10b981';
const STUDIED_KEY = 'erik-studied-techniques';
const RESUME_KEY = 'erik-technique-step';

// Where you stopped in each technique, so a half-finished lesson picks up where
// you left it instead of restarting at step 1 every time.
function loadResume(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'); }
  catch { return {}; }
}
function saveResume(id: string, step: number) {
  try {
    const m = loadResume();
    if (step > 0) m[id] = step; else delete m[id];
    localStorage.setItem(RESUME_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}

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

interface ExamHit { id: string; n: number; stem: string; paper: string; answer: string | null; }

// "The Art of Myoskeletal Alignment Therapy Q1" spends a whole line saying which
// paper before it gets to the question. Only two of the five titles use an
// em-dash, so stripping to the tail was not enough.
function shortPaper(title: string): string {
  const t = title.replace(/^(Advanced Myoskeletal Techniques|MAT|Dynamic Body)\s+—\s+/, '');
  if (/Art of Myoskeletal/i.test(t)) return 'Art of MAT';
  if (/Technique Tour/i.test(t)) return 'Technique Tour';
  if (/Shoulder/i.test(t)) return 'Shoulder/Arm/Hand';
  if (/Lower Body/i.test(t)) return 'Lower Body';
  if (/Upper Body/i.test(t)) return 'Upper Body';
  return t;
}

// The exam bank already records, per question, which technique clips teach it.
// Reading that index BACKWARDS costs nothing and closes the loop the other way:
// having just watched a technique, Mike sees exactly which certification
// questions are on it and can go drill them while it is fresh. No matching, no
// guessing — these are the same links, read from the other end.
function ExamOnTechnique({ itemId, videoId }: { itemId: string; videoId: string }) {
  const [hits, setHits] = useState<ExamHit[]>([]);
  useEffect(() => {
    let alive = true;
    apiGet<{ papers: { id: string; title: string; questions: {
      id: string; n: number; stem: string; answer: string | null;
      lessons?: { videoId: string }[] }[] }[] }>(
      '/api/databases/kb/' + itemId + '/exam-bank')
      .then((b) => {
        if (!alive) return;
        const out: ExamHit[] = [];
        for (const p of b.papers || []) {
          for (const q of p.questions || []) {
            if ((q.lessons || []).some((l) => l.videoId === videoId)) {
              out.push({ id: q.id, n: q.n, stem: q.stem, paper: p.title, answer: q.answer });
            }
          }
        }
        setHits(out);
      })
      .catch(() => { /* exam bank not available — say nothing */ });
    return () => { alive = false; };
  }, [itemId, videoId]);
  if (!hits.length) return null;
  return (
    <div style={{ marginTop: '18px', padding: '11px 13px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
      <div style={{ fontSize: '12.5px', fontWeight: 800, color: ACCENT, marginBottom: '2px' }}>
        On the exam · {hits.length} question{hits.length === 1 ? '' : 's'}
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--color-text-faint)', marginBottom: '7px' }}>
        Certification questions this technique teaches — drill them now, while you've just watched it.
      </div>
      {hits.slice(0, 8).map((h) => (
        <div key={h.id} style={{ fontSize: '12.5px', color: 'var(--color-text)', lineHeight: 1.5, marginBottom: '4px' }}>
          <span style={{ color: 'var(--color-text-faint)' }}>{shortPaper(h.paper)} Q{h.n} · </span>
          {h.stem.slice(0, 130)}{h.stem.length > 130 ? '…' : ''}
          {!h.answer && <span style={{ color: 'var(--color-text-faint)' }}> (no key — study only)</span>}
        </div>
      ))}
      {hits.length > 8 && (
        <div style={{ fontSize: '11.5px', color: 'var(--color-text-faint)', marginTop: '3px' }}>
          …and {hits.length - 8} more. Open the Exam tab to drill them with answers.
        </div>
      )}
    </div>
  );
}

// Erik NUMBERS his lessons ("1. Addressing Thoracic Outlet Syndrome", "10.
// Treating Functional Scoliosis"), and that number IS the teaching order. Plain
// string sorting produced 1, 10, 12, 13, 14, 15, 2, 3, 4 — so a course could not
// be stepped through in the order Erik built it, which is the whole point of
// this tab. Sort on the leading number when there is one, and fall back to the
// title for the DVD segments that carry none.
export function lessonOrder(a: { title: string }, b: { title: string }): number {
  const n = (t: string) => {
    const m = t.match(/^\s*(\d+)\s*[.)-]/);
    return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };
  const d = n(a.title) - n(b.title);
  return d === 0 || !Number.isFinite(d) ? a.title.localeCompare(b.title) : d;
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
      if (t && videosMap[t]) {
        setVideoId(t);
        // ?at=<seconds> lands on the step covering that moment — this is how the
        // Exam tab sends you from a missed question to the hands that teach it.
        const at = Number(sp.get('at'));
        const ord = [...videosMap[t].frames].sort((a, b) => a.t_mid - b.t_mid);
        let step = 0;
        if (Number.isFinite(at) && at > 0 && ord.length) {
          step = ord.reduce((best, f, idx) =>
            Math.abs(f.t_mid - at) < Math.abs(ord[best].t_mid - at) ? idx : best, 0);
        }
        setStep(step);
        setReading(sp.get('reading') === '1');
      }
    } catch { /* ignore */ }
  }, [videosMap]);

  // Group videos by course; each course's lessons in Erik's own teaching order.
  const byCourse = useMemo(() => {
    const m: Record<string, VideoFrameData[]> = {};
    for (const v of Object.values(videosMap)) {
      if (!v.frames || v.frames.length === 0) continue;
      (m[v.course] ||= []).push(v);
    }
    for (const c of Object.keys(m)) m[c].sort(lessonOrder);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [videosMap]);

  const video = videoId ? videosMap[videoId] : null;
  const frames = useMemo(() => {
    if (!video) return [];
    return [...video.frames].sort((a, b) => a.t_mid - b.t_mid);
  }, [video]);

  const frameSrc = (file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + (videoId ?? '') + '/' + (file.split('/').pop() ?? file);
  // Same URL for any technique (browse rows need a thumb before one is opened).
  const frameSrcOf = (vid: string, file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + vid + '/' + (file.split('/').pop() ?? file);
  const audioSrc = (fr: FrameEntry) =>
    '/api/databases/kb/' + itemId + '/anatomy/audio/' + (videoId ?? '') + '/seg-' + String(fr.seg).padStart(3, '0') + '.mp3';
  const fmtTime = (s: number) => {
    const t = Math.round(s); const m = Math.floor(t / 60); const sec = t % 60;
    return (m > 0 ? m + 'm' : '') + sec + 's';
  };

  // Best "hands-on" frame per technique — the same ranker Explore/Conditions use,
  // so a browse row previews Erik's hands on the client instead of frame 0 (a
  // title card or a wide shot of him talking).
  const coverOf = useMemo(() => {
    const m: Record<string, FrameEntry> = {};
    for (const v of Object.values(videosMap)) {
      if (!v.frames?.length) continue;
      m[v.id] = [...v.frames].sort((a, b) => frameScore(b.text) - frameScore(a.text))[0];
    }
    return m;
  }, [videosMap]);

  function openVideo(id: string) {
    setVideoId(id);
    const saved = loadResume()[id];
    const n = videosMap[id]?.frames?.length ?? 0;
    setStep(typeof saved === 'number' && saved > 0 && saved < n ? saved : 0);
    setReading(false);
  }

  // Remember the step so a lesson resumes where you stopped.
  const [resume, setResume] = useState<Record<string, number>>(loadResume);
  useEffect(() => {
    if (!videoId) return;
    saveResume(videoId, step);
    setResume(loadResume());
  }, [videoId, step]);

  // ← / → step through the lesson (hands stay on the keyboard while studying).
  useEffect(() => {
    if (!videoId || reading) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(frames.length - 1, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoId, reading, frames.length]);

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

        {/* what this technique is actually tested on */}
        <ExamOnTechnique itemId={itemId} videoId={video.id} />

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
              <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>or use ← / →</span>
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
        // Match the TITLE first, then fall back to what Erik actually SAYS in the
        // lesson — searching "bicep" or "firing order" used to return nothing
        // because those words live in the transcript, not in a lesson title.
        const titled: VideoFrameData[] = [];
        const spoken: Array<{ v: VideoFrameData; frame: FrameEntry; hits: number }> = [];
        for (const v of withFrames) {
          if ((v.title + ' ' + v.course).toLowerCase().includes(fq)) { titled.push(v); continue; }
          if (fq.length < 3) continue;
          let best: FrameEntry | null = null; let hits = 0;
          for (const fr of v.frames) {
            if (!(fr.text || '').toLowerCase().includes(fq)) continue;
            hits++;
            if (!best || fr.text.length > best.text.length) best = fr;
          }
          if (best) spoken.push({ v, frame: best, hits });
        }
        titled.sort(lessonOrder);
        spoken.sort((a, b) => b.hits - a.hits);
        const row = (v: VideoFrameData, i: number, sub?: ComponentChildren, jump?: number) => (
          <button key={v.id} type="button" onClick={() => { openVideo(v.id); if (jump !== undefined) setStep(jump); }}
            class="transition-colors hover:bg-[var(--color-elevated)]"
            style={{ textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', borderTop: i ? '1px solid var(--color-border)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '11px' }}>
            {coverOf[v.id] && (
              <img src={frameSrcOf(v.id, coverOf[v.id].file)} alt="" loading="lazy"
                style={{ width: '92px', height: '52px', objectFit: 'cover', borderRadius: '6px', flex: '0 0 auto', background: '#000' }} />
            )}
            <span style={{ minWidth: 0, flex: 1 }}>
              {/* "VTS_01_2" is a DVD-VOB filename, not a lesson name. The Library
                  already renders these as "Part N"; do the same here so the two
                  tabs agree, and keep the raw token visible for cross-reference. */}
              <span style={{ display: 'block', fontSize: '13px', color: studied.has(v.id) ? ACCENT : 'var(--color-text)' }}>
                {studied.has(v.id) ? '✓ ' : ''}
                {/^VTS[_0-9]*$/i.test(v.title) ? `Part ${i + 1}` : v.title}
                {/^VTS[_0-9]*$/i.test(v.title) && (
                  <span style={{ color: 'var(--color-text-faint)', fontSize: '11px', marginLeft: '7px' }}>{v.title}</span>
                )}
              </span>
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-faint)' }}>{v.course}</span>
              {/* A DVD segment's filename says nothing. This says what it actually
                  covers, worked out from its own transcript — not a title Erik gave it. */}
              {v.covers && (
                <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  covers: {v.covers}
                </span>
              )}
              {sub}
            </span>
            <span style={{ flexShrink: 0, fontSize: '11px', color: ACCENT, fontWeight: 600 }}>{v.frames.length} steps ▶</span>
          </button>
        );
        return (
          <div style={{ marginBottom: '4px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}>
              {titled.length === 0 && spoken.length === 0 && <div style={{ padding: '12px 14px', fontSize: '13px', color: 'var(--color-text-faint)' }}>No technique matches “{filter}” — not in a title and not in anything Erik says.</div>}
              {titled.map((v, i) => row(v, i))}
            </div>
            {spoken.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '5px' }}>
                  Erik says “{filter.trim()}” inside {spoken.length} more lesson{spoken.length !== 1 ? 's' : ''} — opens at that moment
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}>
                  {spoken.slice(0, 20).map(({ v, frame, hits }, i) => row(v, i, (
                    <span style={{ display: '-webkit-box', fontSize: '11.5px', color: 'var(--color-text-muted)', lineHeight: 1.4, marginTop: '3px', overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {hits}× · {frame.text.slice(0, 150)}…
                    </span>
                  ), [...v.frames].sort((a, b) => a.t_mid - b.t_mid).indexOf(frame)))}
                </div>
              </div>
            )}
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
                  {vids.map((v, vi) => {
                    const at = resume[v.id];
                    const cryptic = /^VTS[_0-9]*$/i.test(v.title);
                    return (
                      <button key={v.id} type="button" onClick={() => openVideo(v.id)}
                        class="transition-colors hover:bg-[var(--color-elevated)]"
                        style={{ textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '11px' }}>
                        {coverOf[v.id] && (
                          <img src={frameSrcOf(v.id, coverOf[v.id].file)} alt="" loading="lazy"
                            style={{ width: '92px', height: '52px', objectFit: 'cover', borderRadius: '6px', flex: '0 0 auto', background: '#000' }} />
                        )}
                        <span style={{ minWidth: 0, flex: 1, fontSize: '13px', color: studied.has(v.id) ? ACCENT : 'var(--color-text-muted)' }}>
                          {studied.has(v.id) ? '✓ ' : ''}
                          {cryptic ? `Part ${vi + 1}` : v.title}
                          {cryptic && <span style={{ color: 'var(--color-text-faint)', fontSize: '11px', marginLeft: '7px' }}>{v.title}</span>}
                          {/* what the segment demonstrably covers, from its own
                              transcript — the only handle these DVD rips have */}
                          {v.covers && (
                            <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                              covers: {v.covers}
                            </span>
                          )}
                          {at ? <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-faint)' }}>resume at step {at + 1}</span> : null}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: '11px', color: ACCENT }}>{v.frames.length} steps ▶</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
