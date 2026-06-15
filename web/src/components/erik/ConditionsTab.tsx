// ConditionsTab — the clinician's front door. Working bodyworkers think in
// client COMPLAINTS ("sciatica", "frozen shoulder", "carpal tunnel"), not muscle
// slugs. Pick a condition → see the body areas involved, Erik's matching
// technique frames (scanned live from the 1,925-frame corpus by keyword), and
// his lessons (warm KB search). Pure frontend over the already-loaded data.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { REGION_BY_KEY } from './regions';

interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }
interface KbHit { source: string; heading: string; course?: string; preview: string; }
interface KbSearchResponse { hits: KbHit[]; abstained: boolean; }

const ACCENT = '#10b981';

interface Condition {
  key: string;
  label: string;
  emoji: string;
  match: string[];   // lowercase substrings to find in frame text / video title
  regions: string[]; // ErikRegion keys involved
  query: string;     // warm-KB search query
}

// Curated from the actual corpus coverage (transcript+title keyword counts).
const CONDITIONS: Condition[] = [
  { key: 'sciatica', label: 'Sciatica', emoji: '⚡', match: ['sciatic'], regions: ['low back', 'hip/glutes', 'pelvis/SI'], query: 'sciatica sciatic nerve piriformis low back' },
  { key: 'piriformis', label: 'Piriformis syndrome', emoji: '🍑', match: ['piriformis'], regions: ['hip/glutes', 'pelvis/SI'], query: 'piriformis syndrome deep glute release' },
  { key: 'lowback', label: 'Low back pain / disc', emoji: '🔥', match: ['low back', 'lumbar', 'disc', 'herniat', 'quadratus'], regions: ['low back', 'pelvis/SI', 'core/abdomen'], query: 'low back lumbar disc QL pain' },
  { key: 'si', label: 'SI joint dysfunction', emoji: '🔗', match: ['si joint', 'sacroiliac', 'sacrum'], regions: ['pelvis/SI'], query: 'sacroiliac SI joint sacrum dysfunction' },
  { key: 'scoliosis', label: 'Scoliosis', emoji: '🌀', match: ['scoliosis'], regions: ['spine/general', 'thoracic/ribs', 'low back'], query: 'scoliosis spinal curve functional' },
  { key: 'kyphosis', label: 'Kyphosis / forward head', emoji: '🐢', match: ['kyphosis', 'forward head', 'upper cross'], regions: ['thoracic/ribs', 'neck', 'shoulder'], query: 'kyphosis forward head posture upper crossed' },
  { key: 'lordosis', label: 'Lordosis / anterior tilt', emoji: '〽️', match: ['lordosis', 'anterior pelvic', 'lower cross'], regions: ['low back', 'core/abdomen', 'hip/glutes'], query: 'lordosis anterior pelvic tilt psoas' },
  { key: 'frozen', label: 'Frozen shoulder', emoji: '🧊', match: ['frozen shoulder', 'adhesive', 'capsulitis'], regions: ['shoulder'], query: 'frozen shoulder adhesive capsulitis' },
  { key: 'cuff', label: 'Rotator cuff / impingement', emoji: '💪', match: ['rotator cuff', 'supraspinatus', 'impingement', 'infraspinatus'], regions: ['shoulder', 'arm'], query: 'rotator cuff impingement supraspinatus shoulder' },
  { key: 'tos', label: 'Thoracic outlet syndrome', emoji: '🚪', match: ['thoracic outlet'], regions: ['neck', 'shoulder'], query: 'thoracic outlet syndrome scalene first rib' },
  { key: 'carpal', label: 'Carpal tunnel', emoji: '✋', match: ['carpal tunnel', 'median nerve'], regions: ['wrist/hand', 'elbow'], query: 'carpal tunnel median nerve wrist flexor' },
  { key: 'elbow', label: 'Tennis / golfer’s elbow', emoji: '🎾', match: ['tennis elbow', 'golfer', 'epicond'], regions: ['elbow', 'wrist/hand'], query: 'tennis elbow golfer epicondylitis forearm' },
  { key: 'tmj', label: 'TMJ / jaw pain', emoji: '😬', match: ['tmj', 'jaw', 'masseter', 'temporomandib'], regions: ['jaw/TMJ', 'head/face', 'neck'], query: 'TMJ jaw masseter temporomandibular' },
  { key: 'headache', label: 'Headache / migraine', emoji: '🤕', match: ['headache', 'migraine', 'occiput', 'occipital', 'suboccipital'], regions: ['head/face', 'neck'], query: 'headache cervicogenic suboccipital occiput' },
  { key: 'whiplash', label: 'Whiplash / neck pain', emoji: '🚗', match: ['whiplash', 'neck pain', 'cervical', 'scalene'], regions: ['neck', 'shoulder'], query: 'whiplash cervical neck pain' },
  { key: 'plantar', label: 'Plantar fasciitis', emoji: '🦶', match: ['plantar fasc', 'heel'], regions: ['foot/ankle'], query: 'plantar fasciitis foot arch heel' },
  { key: 'pronation', label: 'Overpronation / flat foot', emoji: '👣', match: ['pronation', 'flat foot', 'arch', 'tibialis'], regions: ['foot/ankle', 'knee'], query: 'overpronation foot arch tibialis' },
  { key: 'knee', label: 'Knee pain', emoji: '🦵', match: ['knee pain', 'patell', 'meniscus', 'it band', 'iliotibial'], regions: ['knee', 'hip/glutes'], query: 'knee patellar tracking IT band' },
  { key: 'psoas', label: 'Hip flexor / psoas', emoji: '🧎', match: ['psoas', 'hip flexor', 'iliacus'], regions: ['hip/glutes', 'core/abdomen', 'low back'], query: 'psoas iliacus hip flexor release' },
  { key: 'hip', label: 'Hip pain / snapping hip', emoji: '🕺', match: ['snapping hip', 'hip pain', 'tensor', 'tfl', 'trochanter'], regions: ['hip/glutes', 'knee'], query: 'hip pain TFL trochanteric bursitis' },
];

export function ConditionsTab({ itemId, videosMap }: {
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
}) {
  const [filter, setFilter] = useState('');
  // Initial condition can come from the URL (?condition=sciatica) — shareable.
  const initial = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get('condition');
      return q && CONDITIONS.some((c) => c.key === q) ? q : null;
    } catch { return null; }
  })();
  const [selected, setSelected] = useState<string | null>(initial);
  const cond = selected ? CONDITIONS.find((c) => c.key === selected) || null : null;

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return CONDITIONS;
    return CONDITIONS.filter((c) => c.label.toLowerCase().includes(q) || c.match.some((m) => m.includes(q)) || c.regions.some((r) => r.includes(q)));
  }, [filter]);

  // Live keyword scan of every frame for the selected condition.
  const frames = useMemo(() => {
    if (!cond) return [];
    const out: Array<{ frame: FrameEntry; videoId: string; title: string; course: string }> = [];
    const perVideo: Record<string, number> = {};
    for (const [videoId, vd] of Object.entries(videosMap)) {
      const titleHit = cond.match.some((m) => vd.title.toLowerCase().includes(m) || vd.course.toLowerCase().includes(m));
      for (const f of vd.frames) {
        const t = (f.text || '').toLowerCase();
        if (!titleHit && !cond.match.some((m) => t.includes(m))) continue;
        if ((perVideo[videoId] ?? 0) >= 2) continue;
        perVideo[videoId] = (perVideo[videoId] ?? 0) + 1;
        out.push({ frame: f, videoId, title: vd.title, course: vd.course });
      }
    }
    return out.sort((a, b) => b.frame.text.length - a.frame.text.length).slice(0, 12);
  }, [cond, videosMap]);

  // KB lessons for the condition.
  const [lessons, setLessons] = useState<KbHit[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  useEffect(() => {
    if (!cond) { setLessons([]); return; }
    let cancelled = false;
    setLoadingLessons(true);
    const p = new URLSearchParams({ q: cond.query, top: '6' });
    apiGet<KbSearchResponse>('/api/databases/kb/' + itemId + '/search?' + p)
      .then((r) => { if (!cancelled) setLessons(r.hits || []); })
      .catch(() => { if (!cancelled) setLessons([]); })
      .finally(() => { if (!cancelled) setLoadingLessons(false); });
    return () => { cancelled = true; };
  }, [selected, itemId]);

  const [zoom, setZoom] = useState<{ src: string; text: string; title: string } | null>(null);
  const frameSrc = (videoId: string, file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + videoId + '/' + (file.split('/').pop() ?? file);
  const framesReady = Object.keys(videosMap).length > 0;

  return (
    <div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
        Pick a client complaint — see the body areas involved, Erik's matching techniques, and the lessons that cover it.
      </div>

      <input
        type="text" value={filter} placeholder="Filter conditions (e.g. shoulder, nerve, foot)…"
        onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        style={{ width: '100%', maxWidth: '420px', padding: '8px 12px', marginBottom: '14px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
      />

      {/* Condition grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
        {list.map((c) => {
          const on = selected === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setSelected(on ? null : c.key)}
              style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', fontWeight: 600, padding: '7px 13px', borderRadius: '10px', cursor: 'pointer',
                border: '1px solid ' + (on ? ACCENT : 'var(--color-border)'),
                background: on ? ACCENT + '22' : 'var(--color-card)',
                color: on ? ACCENT : 'var(--color-text)' }}>
              <span style={{ fontSize: '15px' }}>{c.emoji}</span>{c.label}
            </button>
          );
        })}
        {list.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>No condition matches “{filter}”.</div>}
      </div>

      {cond && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '20px', color: 'var(--color-text)' }}>{cond.emoji} {cond.label}</h3>

          {/* Involved areas */}
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', margin: '12px 0 6px', textTransform: 'uppercase' }}>Body areas involved</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
            {cond.regions.map((rk) => (
              <a key={rk} href={'/databases/' + itemId + '?tab=explore&region=' + encodeURIComponent(rk)}
                style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '999px', textDecoration: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'transparent' }}
                title="Open this area on the 3D body">
                {REGION_BY_KEY[rk]?.label || rk} ↗
              </a>
            ))}
          </div>

          {/* Erik's matching techniques */}
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>
            Erik's techniques for this {framesReady ? `· ${frames.length} found` : ''}
          </div>
          {!framesReady && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>Loading frames…</div>}
          {framesReady && frames.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>No direct frame matches — see the lessons below.</div>}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {frames.map((m, i) => {
              const src = frameSrc(m.videoId, m.frame.file);
              return (
                <div key={i} onClick={() => setZoom({ src, text: m.frame.text, title: m.title })}
                  style={{ width: '150px', cursor: 'pointer', background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}
                  title={m.frame.text}>
                  <img src={src} alt={m.frame.text.slice(0, 50)} loading="lazy" style={{ width: '150px', height: '85px', objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: '5px 7px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                    <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.course}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Lessons */}
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
      )}

      {!cond && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-faint)', border: '1px dashed var(--color-border)', borderRadius: '10px' }}>
          Pick a condition above to see how Erik treats it.
        </div>
      )}

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
