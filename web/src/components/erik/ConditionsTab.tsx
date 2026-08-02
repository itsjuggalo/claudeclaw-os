// ConditionsTab — the clinician's front door. Working bodyworkers think in
// client COMPLAINTS ("sciatica", "frozen shoulder", "carpal tunnel"), not muscle
// slugs. Pick a condition → see the body areas involved, Erik's matching
// technique frames (scanned live from the 1,925-frame corpus by keyword), and
// his lessons (warm KB search). Pure frontend over the already-loaded data.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { REGION_BY_KEY } from './regions';
import { frameScore } from './ExploreTab';

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

// ── the certification papers, filtered to this condition ───────────────────
// Mike has five Myoskeletal exams to sit. Reading how Erik treats thoracic outlet
// and then meeting the exam questions on thoracic outlet in the same breath is
// worth far more than either alone — so the condition page pulls its own
// questions out of the bank.
interface ExamQ {
  id: string; n: number | string; stem: string; options: Record<string, string>;
  answer?: string | null; why?: string | null; confidence?: string | null; topic?: string;
}

function ExamOnThis({ cond }: { cond: Condition }) {
  const [bank, setBank] = useState<{ papers: { id: string; title: string; questions: ExamQ[] }[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<{ papers: { id: string; title: string; questions: ExamQ[] }[] }>(
      '/api/databases/kb/erikdalton/exam-bank')
      .then((r) => { if (live) setBank(r); }).catch(() => { /* section just stays hidden */ });
    return () => { live = false; };
  }, []);

  const hits = useMemo(() => {
    if (!bank) return [];
    const out: { q: ExamQ; paper: string }[] = [];
    for (const p of bank.papers) {
      for (const q of p.questions) {
        // Match on the stem, the booklet's section heading, and the KEYED answer
        // only. Searching the distractors too dragged in questions where
        // "thoracic outlet syndrome" is merely the wrong answer — the question
        // isn't about this condition at all.
        const keyed = q.answer ? q.options[q.answer] || '' : '';
        const hay = (q.stem + ' ' + (q.topic || '') + ' ' + keyed).toLowerCase();
        if (cond.match.some((m) => hay.includes(m))) out.push({ q, paper: p.title });
      }
    }
    // keyed questions first — an unkeyed one can still be worth reading, but it
    // shouldn't push a keyed one off the list
    return out.sort((a, b) => Number(!!b.q.answer) - Number(!!a.q.answer)).slice(0, 10);
  }, [bank, cond]);

  if (!hits.length) return null;
  return (
    <>
      <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', margin: '18px 0 5px', textTransform: 'uppercase' }}>
        ④ On the exam · {hits.length} question{hits.length !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {hits.map(({ q, paper }) => {
          const shown = open === q.id;
          return (
            <div key={q.id} style={{ border: '1px solid var(--color-border)', borderRadius: '9px', padding: '9px 12px', background: 'var(--color-card)' }}>
              <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '3px' }}>
                {paper} · Q{q.n}{q.topic ? ' · ' + q.topic : ''}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.45 }}>{q.stem}</div>
              {shown ? (
                <div style={{ marginTop: '6px', fontSize: '12.5px', lineHeight: 1.5 }}>
                  {q.answer ? (
                    <>
                      <span style={{ color: ACCENT, fontWeight: 700 }}>{q.answer}) {q.options[q.answer]}</span>
                      {q.why && <div style={{ color: 'var(--color-text-muted)', marginTop: '4px' }}>{q.why}</div>}
                    </>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      No defensible key for this one — it’s shown, not guessed at.
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  {Object.entries(q.options).map(([k, v]) => `${k}) ${v}`).join('   ')}
                </div>
              )}
              <button type="button" onClick={() => setOpen(shown ? null : q.id)}
                style={{ marginTop: '6px', padding: '3px 9px', fontSize: '11.5px', fontWeight: 600, borderRadius: '7px', cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: ACCENT }}>
                {shown ? 'Hide answer' : 'Show answer'}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// Clinical scaffold per condition — standard bodywork guidance (NOT a diagnosis).
// assess = what to check first · caution = red flags / refer-out · homecare = client self-care.
interface CondDetail { assess: string; caution: string; homecare: string; }
const DETAIL: Record<string, CondDetail> = {
  sciatica:  { assess: 'SLR & slump test; map dermatomal numbness/weakness vs local glute pain.', caution: 'Progressive weakness, saddle numbness, or bowel/bladder change = refer out NOW (cauda equina).', homecare: 'Nerve flossing, glute/piriformis stretch, avoid prolonged sitting.' },
  piriformis:{ assess: 'FAIR test / resisted external rotation reproduces deep glute pain; rule out true radiculopathy.', caution: 'Differentiate from lumbar nerve-root referral; avoid heavy direct pressure on the nerve.', homecare: 'Piriformis & glute stretch, foam-roll, hip mobility.' },
  lowback:   { assess: 'Flexion/extension AROM; note centralization vs peripheralization of symptoms.', caution: 'Acute disc with neuro loss, trauma, fever, or unexplained weight loss = refer.', homecare: 'McGill big-3 core, hip-hinge mechanics, frequent position change.' },
  si:        { assess: 'Provocation cluster: thigh-thrust, compression, Gaenslen, FABER.', caution: 'Young client + night pain/stiffness = screen for inflammatory (ankylosing) pattern.', homecare: 'SI belt during flares, glute-med strengthening.' },
  scoliosis: { assess: 'Adams forward-bend, leg-length, rib hump — functional vs structural.', caution: 'Rapidly progressing or adolescent structural curves = co-manage with MD.', homecare: 'Side-specific strengthening, breathe into the concavity.' },
  kyphosis:  { assess: 'Occiput-to-wall, thoracic extension ROM; upper-crossed pattern.', caution: 'Osteoporosis/elderly — no forceful thoracic-extension mobilization.', homecare: 'Extension over a roller, chin tucks, pec-minor stretch.' },
  lordosis:  { assess: 'Thomas test for hip-flexor tightness; anterior pelvic tilt; lower-crossed.', caution: 'Spondylolisthesis — avoid end-range extension loading.', homecare: 'Hip-flexor stretch, glute/ab activation, posterior-tilt drills.' },
  frozen:    { assess: 'Capsular pattern (ER > abduction > IR limited); stage = freezing / frozen / thawing.', caution: 'Inflammatory freezing stage — gentle only; aggressive stretch worsens it.', homecare: 'Pendulums, pain-free ROM, heat before motion.' },
  cuff:      { assess: 'Painful arc, empty-can, drop-arm, Hawkins-Kennedy.', caution: 'Full-thickness tear or post-op = PT/MD scope — don’t force.', homecare: 'Scapular stabilization, posture, sleep positioning.' },
  tos:       { assess: 'Roos/EAST, Adson’s, costoclavicular; separate neuro vs vascular.', caution: 'Vascular signs (color change, swelling, pulse loss) = urgent referral.', homecare: 'Scalene/pec-minor stretch, nerve glides, posture.' },
  carpal:    { assess: 'Phalen / Tinel, thenar bulk, median-nerve distribution.', caution: 'Thenar wasting or constant numbness = nerve-conduction study + MD.', homecare: 'Neutral-wrist night splint, nerve glides, ergonomics.' },
  elbow:     { assess: 'Resisted wrist extension (tennis) / flexion (golfer) reproduces pain; palpate epicondyle.', caution: 'Acute high-pain stage — lower load before deep work.', homecare: 'Eccentric forearm loading, counterforce brace.' },
  tmj:       { assess: 'Opening range/deviation, palpate masseter-temporalis-pterygoid, note clicking.', caution: 'Locked jaw, recent trauma, or dental pathology = dentist/TMJ specialist.', homecare: 'Soft diet, posture, gentle self-massage, clench awareness.' },
  headache:  { assess: 'Cervicogenic screen: suboccipital tenderness, C1–2 ROM, referral pattern.', caution: 'Sudden “worst-ever”, neuro signs, or new onset >50 = medical workup.', homecare: 'Suboccipital release, posture, hydration, screen breaks.' },
  whiplash:  { assess: 'Cervical AROM; acute vs chronic; ligament stress only once cleared.', caution: 'Recent MVA — clear for fracture/instability before any mobilization.', homecare: 'Gentle AROM, isometrics, avoid prolonged collar use.' },
  plantar:   { assess: 'First-step pain, windlass test, palpate medial calcaneal tubercle.', caution: 'Atypical pain — rule out stress fracture or nerve entrapment.', homecare: 'Calf/plantar stretch, ball roll, supportive shoes, night splint.' },
  pronation: { assess: 'Navicular drop, single-leg stance, footwear wear pattern.', caution: 'Rigid deformity or acute post-tib dysfunction = podiatry.', homecare: 'Foot-intrinsic & tib-posterior strengthening, orthotics.' },
  knee:      { assess: 'Patellar tracking, VMO timing, Ober (IT band), squat mechanics.', caution: 'Locking, giving-way, or effusion = MD (meniscus/ligament).', homecare: 'Glute-med/VMO work, IT-band/TFL release, alignment drills.' },
  psoas:     { assess: 'Thomas test, hip-flexor strength, anterior hip pain on sit-to-stand.', caution: 'Abdominal work — stay off organs/aorta; gentle, with the breath.', homecare: 'Hip-flexor stretch, glute activation, anti-tilt core.' },
  hip:       { assess: 'Snap location (lateral = IT/TFL, anterior = iliopsoas); palpate trochanter.', caution: 'Deep constant night hip pain or trauma = image for labrum/joint.', homecare: 'TFL/IT release, glute strengthening, lateral-hip stretch.' },
};
const DISCLAIMER = 'General bodywork education — not a diagnosis. When red flags appear or you’re unsure, refer out.';

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
  const detail = cond ? DETAIL[cond.key] : undefined;

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
    // hands-on demonstration frames beat rambling theory frames — see frameScore
    return out.sort((a, b) => frameScore(b.frame.text) - frameScore(a.frame.text)).slice(0, 12);
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

  // Open a clean, self-contained one-page cheat sheet and print it.
  const printCheatSheet = () => {
    if (!cond) return;
    const d = DETAIL[cond.key];
    const origin = window.location.origin;
    const esc = (s: string) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const areaList = cond.regions.map((r) => esc(REGION_BY_KEY[r]?.label || r)).join(' · ');
    const techCards = frames.slice(0, 6).map((m) => `<div class="t"><img src="${origin + frameSrc(m.videoId, m.frame.file)}"/><div class="cap"><b>${esc(m.title)}</b><br><span>${esc(m.frame.text.slice(0, 180))}</span></div></div>`).join('');
    const lessonList = lessons.slice(0, 5).map((h) => `<li><b>${esc(h.heading?.replace(/^\[meta\]\s*/, '') || h.source)}</b> — ${esc((h.preview || '').slice(0, 140))}</li>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cond.label)} — Erik Dalton cheat sheet</title>
      <style>*{box-sizing:border-box}body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:28px;max-width:760px}
      h1{font-size:22px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:14px}
      h2{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#0a7;border-bottom:1px solid #ddd;padding-bottom:3px;margin:16px 0 8px}
      .areas{font-weight:600;margin-bottom:6px}.caution{background:#fff5e6;border:1px solid #f0c074;border-radius:6px;padding:8px 10px;color:#7a4a00}
      .grid{display:flex;flex-wrap:wrap;gap:10px}.t{width:230px;border:1px solid #ddd;border-radius:6px;overflow:hidden}
      .t img{width:100%;height:130px;object-fit:cover;display:block}.cap{padding:5px 7px;font-size:10px}.cap span{color:#555}
      ul{margin:4px 0;padding-left:18px}li{margin-bottom:4px}.foot{margin-top:18px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}
      @media print{body{margin:12mm}}</style></head><body>
      <h1>${cond.emoji} ${esc(cond.label)}</h1><div class="sub">Erik Dalton Myoskeletal · clinical cheat sheet</div>
      <h2>Body areas</h2><div class="areas">${areaList}</div>
      ${d ? `<h2>Assess first</h2><div>${esc(d.assess)}</div><h2>&#9888; Cautions</h2><div class="caution">${esc(d.caution)}</div>` : ''}
      <h2>Erik's techniques</h2><div class="grid">${techCards || '<i>See lessons.</i>'}</div>
      ${lessonList ? `<h2>Key lessons</h2><ul>${lessonList}</ul>` : ''}
      ${d ? `<h2>Client homecare</h2><div>${esc(d.homecare)}</div>` : ''}
      <div class="foot">${esc(DISCLAIMER)}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script></body></html>`;
    const wnd = window.open('', '_blank');
    if (wnd) { wnd.document.write(html); wnd.document.close(); }
  };

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
              style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 600, padding: '7px 13px', borderRadius: '10px', cursor: 'pointer',
                border: '1px solid ' + (on ? ACCENT : 'var(--color-border)'),
                background: on ? ACCENT + '22' : 'var(--color-card)',
                color: on ? ACCENT : 'var(--color-text)' }}>
              <span style={{ fontSize: '15px' }}>{c.emoji}</span>{c.label}
            </button>
          );
        })}
        {list.length === 0 && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>No condition matches “{filter}”.</div>}
      </div>

      {cond && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '20px', color: 'var(--color-text)' }}>{cond.emoji} {cond.label}</h3>
            <button type="button" onClick={printCheatSheet}
              style={{ fontSize: '13px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid ' + ACCENT, background: ACCENT + '22', color: ACCENT }}>
              🖨 Print cheat sheet
            </button>
          </div>

          {detail && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', margin: '12px 0 5px', textTransform: 'uppercase' }}>① Assess first</div>
              <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5, marginBottom: '12px' }}>{detail.assess}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '9px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.5)', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', lineHeight: 1.3 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: '#f59e0b', textTransform: 'uppercase', marginBottom: '2px' }}>Cautions / refer out</div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}>{detail.caution}</div>
                </div>
              </div>
            </>
          )}

          {/* Involved areas */}
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', margin: '12px 0 6px', textTransform: 'uppercase' }}>Body areas involved</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
            {cond.regions.map((rk) => (
              <a key={rk} href={'/databases/' + itemId + '?tab=explore&region=' + encodeURIComponent(rk)}
                style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '999px', textDecoration: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'transparent' }}
                title="Open this area on the 3D body">
                {REGION_BY_KEY[rk]?.label || rk} ↗
              </a>
            ))}
          </div>

          {/* Erik's matching techniques */}
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', marginBottom: '6px', textTransform: 'uppercase' }}>
            ② Treat — Erik's techniques {framesReady ? `· ${frames.length} found` : ''}
          </div>
          {!framesReady && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading frames…</div>}
          {framesReady && frames.length === 0 && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>No direct frame matches — see the lessons below.</div>}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {frames.map((m, i) => {
              const src = frameSrc(m.videoId, m.frame.file);
              return (
                <div key={i} onClick={() => setZoom({ src, text: m.frame.text, title: m.title })}
                  style={{ width: '178px', cursor: 'pointer', background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden' }}
                  title={m.frame.text}>
                  <img src={src} alt={m.frame.text.slice(0, 60)} loading="lazy"
                    style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', background: '#000' }} />
                  <div style={{ padding: '6px 8px' }}>
                    {/* the caption is the point — a cropped still with only a
                        lesson title told the learner nothing */}
                    <div style={{ fontSize: '11.5px', color: 'var(--color-text)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.frame.text}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--color-text-faint)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title} · {m.course}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Lessons */}
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

          {detail && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', margin: '18px 0 5px', textTransform: 'uppercase' }}>③ Client homecare</div>
              <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}>{detail.homecare}</div>
            </>
          )}

          {/* What the certification papers ask about this condition. Reading how
              Erik treats TOS and then meeting the four exam questions on it in
              the same place is the whole point — clinic and exam are one subject. */}
          <ExamOnThis cond={cond} />
          <div style={{ marginTop: '16px', fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>{DISCLAIMER}</div>
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
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#888' }}>{zoom.title}</div>
          </div>
        </div>
      )}
    </div>
  );
}
