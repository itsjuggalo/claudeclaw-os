// ExploreTab — the Erik Dalton "anatomy explorer". Click a body region (or chip)
// → see the muscles there, Erik's technique frames for that area, and his
// lessons (KB search). This is the offline 2D learning surface; the 3D model
// (AnatomyViewer) slots in above the body map when its GLB is available.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { apiGet } from '@/lib/api';
import { BodyMap } from './BodyMap';
import { ERIK_REGIONS, REGION_BY_KEY } from './regions';

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
    // longest-caption first = usually the most descriptive moments
    return out.sort((a, b) => b.frame.text.length - a.frame.text.length).slice(0, 8);
  }, [region, videosMap]);

  const [zoom, setZoom] = useState<{ src: string; text: string; title: string } | null>(null);
  const frameSrc = (videoId: string, file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + videoId + '/' + (file.split('/').pop() ?? file);
  const muscleSrc = (m: AnatomyMuscle) =>
    m.images?.front ? '/api/databases/kb/' + itemId + '/anatomy/img/' + m.images.front.split('/').pop() : '';

  const framesReady = Object.keys(videosMap).length > 0;

  return (
    <div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
        Rotate the 3D figure and click a body part — or use the flat map / chips below — to see the
        muscles there and Erik's techniques for that area.
      </div>

      {/* Interactive 3D body — the headline learning surface. Shares the same
          selected/onSelect state as the chips and 2D map below. */}
      <div style={{ maxWidth: '460px', marginBottom: '18px' }}>
        <Suspense fallback={
          <div style={{ height: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-text-faint)', fontSize: '13px' }}>
            Loading 3D model…
          </div>
        }>
          <AnatomyViewer selected={selected} onSelect={(k) => setSelected((cur) => (cur === k ? null : k))} />
        </Suspense>
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
                fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '999px',
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
              <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '14px' }}>
                {muscles.length} muscle plate{muscles.length !== 1 ? 's' : ''} · {frames.length} technique frame{frames.length !== 1 ? 's' : ''}
              </div>

              {/* Muscles */}
              {muscles.length > 0 && (
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>Muscles here</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {muscles.map((m) => (
                      <div key={m.slug} style={{ width: '92px', textAlign: 'center' }}>
                        {muscleSrc(m) && (
                          <img src={muscleSrc(m)} alt={m.name} loading="lazy"
                            style={{ width: '92px', height: '92px', objectFit: 'contain', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px' }} />
                        )}
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '3px', lineHeight: 1.2, textTransform: 'capitalize' }}>{m.name}</div>
                        {m.viewer_url && (
                          <a href={m.viewer_url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '9px', color: ACCENT, textDecoration: 'none' }}>view 3D ↗</a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Technique frames */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>Erik's techniques — frames</div>
                {!framesReady && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>Loading frames…</div>}
                {framesReady && frames.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>No tagged frames for this region yet.</div>}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {frames.map((m, i) => {
                    const src = frameSrc(m.videoId, m.frame.file);
                    return (
                      <div key={i} onClick={() => setZoom({ src, text: m.frame.text, title: m.title })}
                        style={{ width: '120px', cursor: 'pointer', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}
                        title={m.frame.text}>
                        <img src={src} alt={m.frame.text.slice(0, 50)} loading="lazy" style={{ width: '120px', height: '68px', objectFit: 'cover', display: 'block' }} />
                        <div style={{ padding: '4px 6px', fontSize: '9px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lessons (KB search) */}
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>Lessons that cover this</div>
                {loadingLessons && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>Searching…</div>}
                {!loadingLessons && lessons.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>No lessons matched.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {lessons.map((h, i) => (
                    <div key={i} style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-card)' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text)' }}>{h.heading?.replace(/^\[meta\]\s*/, '') || h.source}</div>
                      {h.course && <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>{h.course}</div>}
                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '3px', lineHeight: 1.4, maxHeight: '40px', overflow: 'hidden' }}>{h.preview?.slice(0, 160)}</div>
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
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>{zoom.title}</div>
          </div>
        </div>
      )}
    </div>
  );
}
