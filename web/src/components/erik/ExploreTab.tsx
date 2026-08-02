// ExploreTab — the Erik Dalton "anatomy explorer". Click a body region (or chip)
// → see the muscles there, Erik's technique frames for that area, and his
// lessons (KB search). This is the offline 2D learning surface; the 3D model
// (AnatomyViewer) slots in above the body map when its GLB is available.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { apiGet } from '@/lib/api';
import { BodyMap } from './BodyMap';
import { ERIK_REGIONS, REGION_BY_KEY } from './regions';
import { MUSCLE_FACTS } from './muscleFacts';

// 3D viewer is heavy (Three.js ~700KB) — code-split it so the Explore tab
// stays light. Falls back to the 2D <BodyMap> below if WebGL is unavailable.
const AnatomyViewer = lazy(() =>
  import('./AnatomyViewer').then((m) => ({ default: m.AnatomyViewer })),
);

interface AnatomyMuscle {
  name: string; slug: string;
  images?: Record<string, string>;
  viewer_url?: string | null;
}
interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }
interface KbHit { source: string; heading: string; course?: string; preview: string; }
interface KbSearchResponse { hits: KbHit[]; abstained: boolean; }

const ACCENT = '#10b981';

// Words that mean Erik is demonstrating with his hands on the client, versus
// lecturing. Frames whose caption scores high make far better thumbnails than
// the old "longest caption wins" rule, which surfaced digressions.
const HANDS_ON = /\b(place|placing|put|hook|hooking|contact|press|pressing|push|pull|drag|dragging|glide|gliding|lift|lifting|hold|holding|grab|grip|elbow|thumb|fingers|forearm|knuckle|traction|stretch|release|releasing|mobilize|mobilizing|rotate|rotating|sidebend|side-bend|inhale|exhale|resist|resisting|barrier|client's|therapist's)\b/gi;
const THEORY = /\b(research|study|studies|percent|book|chapter|doctor|university|years ago|history|remember when)\b/gi;

export function frameScore(text: string): number {
  if (!text) return -99;
  const hands = (text.match(HANDS_ON) || []).length;
  const theory = (text.match(THEORY) || []).length;
  // caption length still counts a little — a 5-word frame explains nothing
  return hands * 3 - theory * 2 + Math.min(text.length, 260) / 120;
}

// The study card behind a muscle plate. Origin / insertion / action is what the
// Myoskeletal exams actually ask for, and `cue` is the practical Dalton note —
// without these the atlas is a picture book.
function MuscleStudyCard({ slug, anatomy }: {
  slug: string | null; anatomy: Record<string, AnatomyMuscle>;
}) {
  if (!slug) return null;
  const f = MUSCLE_FACTS[slug];
  const m = anatomy[slug];
  if (!m) return null;
  const row = (label: string, value?: string) => value ? (
    <div style={{ display: 'flex', gap: '8px', marginTop: '5px' }}>
      <span style={{ flex: '0 0 74px', fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', color: 'var(--color-text-faint)', textTransform: 'uppercase', paddingTop: '1px' }}>{label}</span>
      <span style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}>{value}</span>
    </div>
  ) : null;
  return (
    <div style={{ marginTop: '10px', padding: '12px 14px', borderRadius: '10px', border: '1px solid ' + ACCENT + '55', background: ACCENT + '0e' }}>
      <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text)', textTransform: 'capitalize' }}>{m.name}</div>
      {!f && (
        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
          No study notes written for this plate yet — the 3D render and Erik's lessons below still apply.
        </div>
      )}
      {f && (
        <>
          {row('Origin', f.origin)}
          {row('Insertion', f.insertion)}
          {row('Action', f.action)}
          {row('Refers', f.refers)}
          {row('Test', f.test)}
          {f.cue && (
            <div style={{ marginTop: '9px', padding: '8px 10px', borderRadius: '8px', background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', color: ACCENT, textTransform: 'uppercase', marginBottom: '2px' }}>Myoskeletal note</div>
              <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}>{f.cue}</div>
            </div>
          )}
        </>
      )}
      {m.viewer_url && (
        <a href={m.viewer_url} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: '8px', fontSize: '12px', color: ACCENT, textDecoration: 'none', fontWeight: 600 }}>
          Open the full 3D render ↗
        </a>
      )}
    </div>
  );
}

export function ExploreTab({ itemId, anatomy, videosMap }: {
  itemId: string;
  anatomy: Record<string, AnatomyMuscle>;
  videosMap: Record<string, VideoFrameData>;
}) {
  // Initial region can come from the URL (?region=wrist/hand) so a body area is
  // shareable/bookmarkable; falls back to no selection.
  const initialRegion = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get('region');
      return q && REGION_BY_KEY[q] ? q : null;
    } catch { return null; }
  })();
  const [selected, setSelected] = useState<string | null>(initialRegion);
  const region = selected ? REGION_BY_KEY[selected] : null;

  // The 3D atlas is ~14 MB + Three.js — heavy on phones. Auto-load on wide
  // screens; on mobile show the light 2D body map and load 3D only on tap.
  const [show3d, setShow3d] = useState(() => { try { return window.innerWidth >= 700; } catch { return true; } });

  // Lessons for the selected region (warm KB search).
  const [lessons, setLessons] = useState<KbHit[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  useEffect(() => {
    if (!region) { setLessons([]); return; }
    let cancelled = false;
    setLoadingLessons(true);
    const p = new URLSearchParams({ q: region.query, top: '6' });
    apiGet<KbSearchResponse>('/api/databases/kb/' + itemId + '/search?' + p)
      .then((r) => { if (!cancelled) setLessons(r.hits || []); })
      .catch(() => { if (!cancelled) setLessons([]); })
      .finally(() => { if (!cancelled) setLoadingLessons(false); });
    return () => { cancelled = true; };
  }, [selected, itemId]);

  // Muscles in the selected region (that we actually have plates for).
  const muscles = useMemo(() => {
    if (!region) return [];
    return region.muscles.map((s) => anatomy[s]).filter(Boolean);
  }, [region, anatomy]);

  // Region-filtered technique frames (max 2 per video, cap 8).
  const frames = useMemo(() => {
    if (!region) return [];
    const out: Array<{ frame: FrameEntry; videoId: string; title: string }> = [];
    const perVideo: Record<string, number> = {};
    for (const [videoId, vd] of Object.entries(videosMap)) {
      for (const f of vd.frames) {
        if (f.region !== region.key) continue;
        if ((perVideo[videoId] ?? 0) >= 2) continue;
        perVideo[videoId] = (perVideo[videoId] ?? 0) + 1;
        out.push({ frame: f, videoId, title: vd.title });
        if (out.length >= 24) break;
      }
    }
    // Rank by how much the caption sounds like Erik DOING the technique, not
    // talking theory — "longest caption wins" was picking rambling asides, which
    // is why the thumbnails weren't helping anyone.
    return out.sort((a, b) => frameScore(b.frame.text) - frameScore(a.frame.text)).slice(0, 8);
  }, [region, videosMap]);

  // Which muscle plate is expanded into its study card (origin/insertion/action).
  const [openMuscle, setOpenMuscle] = useState<string | null>(null);
  useEffect(() => { setOpenMuscle(null); }, [selected]);

  const [zoom, setZoom] = useState<{ src: string; text: string; title: string } | null>(null);
  const frameSrc = (videoId: string, file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + videoId + '/' + (file.split('/').pop() ?? file);
  const fmtTime = (s: number) => {
    const t = Math.round(s); const mm = Math.floor(t / 60);
    return (mm > 0 ? mm + 'm' : '') + (t % 60) + 's';
  };
  const muscleSrc = (m: AnatomyMuscle) =>
    m.images?.front ? '/api/databases/kb/' + itemId + '/anatomy/img/' + m.images.front.split('/').pop() : '';

  const framesReady = Object.keys(videosMap).length > 0;

  // Library scale — communicates depth at a glance (good when showing peers).
  const stats = useMemo(() => {
    const vids = Object.values(videosMap);
    const courses = new Set(vids.map((v) => v.course)).size;
    const withFrames = vids.filter((v) => v.frames?.length).length;
    const frames = vids.reduce((n, v) => n + (v.frames?.length || 0), 0);
    return { courses, withFrames, frames, muscles: Object.keys(anatomy).length };
  }, [videosMap, anatomy]);

  return (
    <div>
      {/* credibility stat-strip */}
      {framesReady && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
          {[
            [stats.courses, 'courses'],
            [stats.withFrames, 'techniques'],
            [stats.frames.toLocaleString(), 'teaching frames'],
            [stats.muscles, 'muscle plates'],
            [15, 'body regions'],
            [20, 'conditions'],
          ].map(([n, l], i) => (
            <div key={i} style={{ flex: '0 0 auto', padding: '6px 12px', borderRadius: '9px', background: 'var(--color-card)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
              <span style={{ fontSize: '15px', fontWeight: 800, color: ACCENT }}>{n}</span>
              <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '5px' }}>{l}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
        Rotate the 3D figure and click a body part — or use the flat map / chips below — to see the
        muscles there and Erik's techniques for that area.
      </div>

      {/* Interactive 3D body — the headline learning surface. Shares the same
          selected/onSelect state as the chips and 2D map below. On mobile it's
          opt-in (the 2D map below works the same) so phones don't auto-pull ~14 MB. */}
      <div style={{ maxWidth: '460px', marginBottom: '18px' }}>
        {show3d ? (
          <Suspense fallback={
            <div style={{ height: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text-faint)', fontSize: '13px' }}>
              Loading 3D model…
            </div>
          }>
            <AnatomyViewer selected={selected} onSelect={(k) => setSelected((cur) => (cur === k ? null : k))} />
          </Suspense>
        ) : (
          <button type="button" onClick={() => setShow3d(true)}
            style={{ width: '100%', padding: '16px', border: '1px dashed var(--color-border)', borderRadius: '12px', background: 'var(--color-card)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '13px', lineHeight: 1.5 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: ACCENT, marginBottom: '2px' }}>🧍 Load 3D anatomy model</div>
            ~14 MB — or just use the flat body map below (it works the same).
          </button>
        )}
      </div>

      {/* Region quick-chips (mobile-friendly, no precise clicking needed) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
        {ERIK_REGIONS.map((r) => {
          const on = selected === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setSelected(on ? null : r.key)}
              style={{
                fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '999px',
                cursor: 'pointer', border: '1px solid ' + (on ? ACCENT : 'var(--color-border)'),
                background: on ? ACCENT + '22' : 'transparent',
                color: on ? ACCENT : 'var(--color-text-muted)',
              }}
            >{r.label}</button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Body map */}
        <div style={{ flex: '0 0 auto', position: 'sticky', top: 0 }}>
          <BodyMap selected={selected} onSelect={(k) => setSelected((cur) => (cur === k ? null : k))} />
        </div>

        {/* Detail panel */}
        <div style={{ flex: '1 1 340px', minWidth: '280px' }}>
          {!region && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-faint)', border: '1px dashed var(--color-border)', borderRadius: '10px' }}>
              Pick a body region to start learning.
            </div>
          )}

          {region && (
            <>
              <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: 'var(--color-text)' }}>{region.label}</h3>
              <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginBottom: '14px' }}>
                {muscles.length} muscle plate{muscles.length !== 1 ? 's' : ''} · {frames.length} technique frame{frames.length !== 1 ? 's' : ''}
              </div>

              {/* Muscles — click a plate for the exam-recall facts on it */}
              {muscles.length > 0 && (
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Muscles here — tap one for origin / insertion / action
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {muscles.map((m) => {
                      const on = openMuscle === m.slug;
                      const hasFacts = !!MUSCLE_FACTS[m.slug];
                      return (
                        <button key={m.slug} type="button"
                          onClick={() => setOpenMuscle(on ? null : m.slug)}
                          title={hasFacts ? 'Show the study card for ' + m.name : m.name}
                          style={{
                            width: '92px', textAlign: 'center', cursor: 'pointer', padding: '4px',
                            background: on ? ACCENT + '18' : 'transparent',
                            border: '1px solid ' + (on ? ACCENT : 'transparent'), borderRadius: '10px',
                          }}>
                          {muscleSrc(m) && (
                            <img src={muscleSrc(m)} alt={m.name} loading="lazy"
                              style={{ width: '84px', height: '84px', objectFit: 'contain', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px' }} />
                          )}
                          <span style={{ display: 'block', fontSize: '11px', color: on ? ACCENT : 'var(--color-text-muted)', marginTop: '3px', lineHeight: 1.2, textTransform: 'capitalize' }}>
                            {m.name}{hasFacts ? '' : ' ·'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <MuscleStudyCard slug={openMuscle} anatomy={anatomy} />
                </div>
              )}

              {/* Technique frames */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>Erik's techniques — frames</div>
                {!framesReady && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading frames…</div>}
                {framesReady && frames.length === 0 && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>No tagged frames for this region yet.</div>}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {frames.map((m, i) => {
                    const src = frameSrc(m.videoId, m.frame.file);
                    return (
                      <div key={i} onClick={() => setZoom({ src, text: m.frame.text, title: m.title })}
                        style={{ width: '178px', cursor: 'pointer', background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}
                        title={m.frame.text}>
                        <div style={{ position: 'relative' }}>
                          <img src={src} alt={m.frame.text.slice(0, 60)} loading="lazy"
                            style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', background: '#000' }} />
                          <span style={{ position: 'absolute', bottom: '4px', right: '5px', fontSize: '10px', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.66)', padding: '1px 5px', borderRadius: '4px' }}>
                            {fmtTime(m.frame.t_mid)}
                          </span>
                        </div>
                        <div style={{ padding: '6px 8px' }}>
                          {/* what's actually happening in this frame — the old tiles
                              showed only a lesson title, which told you nothing */}
                          <div style={{ fontSize: '11.5px', color: 'var(--color-text)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {m.frame.text}
                          </div>
                          <div style={{ fontSize: '10.5px', color: 'var(--color-text-faint)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {m.title}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lessons (KB search) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>Lessons that cover this</div>
                {loadingLessons && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Searching…</div>}
                {!loadingLessons && lessons.length === 0 && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>No lessons matched.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {lessons.map((h, i) => (
                    <div key={i} style={{ padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-card)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{h.heading?.replace(/^\[meta\]\s*/, '') || h.source}</div>
                      {h.course && <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{h.course}</div>}
                      <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '3px', lineHeight: 1.4, maxHeight: '40px', overflow: 'hidden' }}>{h.preview?.slice(0, 160)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Frame zoom modal */}
      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '720px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <img src={zoom.src} alt={zoom.text} style={{ width: '100%', borderRadius: '8px', display: 'block' }} />
            <div style={{ marginTop: '12px', color: '#e0e0e0', fontSize: '13px', lineHeight: 1.5 }}>{zoom.text}</div>
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#888' }}>{zoom.title}</div>
          </div>
        </div>
      )}
    </div>
  );
}
