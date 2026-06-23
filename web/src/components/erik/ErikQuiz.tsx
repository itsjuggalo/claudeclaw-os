// ErikQuiz — self-testing flashcards generated from the region↔muscle model.
// Two modes: Recall (muscle→region & region→muscle facts) and "Spot the region",
// which plays a real MOTION CLIP (5s of the technique, centered on the teaching
// moment, with Erik's voice) and asks the learner to name the body area worked.
//
// Spot-the-region UX (2026-06-23 overhaul):
//  • The QUESTION is shown big, ABOVE the clip, with a neutral "what to look for"
//    cue — so it's obvious what's being asked before you watch.
//  • Clip controls: ▶ replay, 🐢 0.5× slow-mo, 🔊 Erik's voice.
//  • Distractors never include an anatomically-adjacent region, so the 4 options are
//    clearly distinct and answerable from a clip; a neighbouring guess grades amber
//    ("close"), not a hard miss, and doesn't break the streak.
//  • On answer the correct region lights up on a body figure + the technique, cue,
//    and deep-links into Explore / Techniques.
//  • Low-confidence cards (regionConfidence < 0.6, set by the vision re-audit) are
//    deprioritised so the quiz only tests clearly-identifiable techniques.
// Clips come from the vision-curated quiz bank; if that route isn't live it falls
// back to region-tagged stills so the quiz never breaks. Best streak persists in LS.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { ERIK_REGIONS, REGION_BY_KEY, LABEL_BY_KEY, KEY_BY_LABEL, REGION_NEIGHBORS, regionsAreNeighbors } from './regions';
import { BodyMap } from './BodyMap';

interface AnatomyMuscle { name: string; slug: string; }
interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }
interface QuizBankItem {
  clipUrl: string; stillUrl: string; videoId: string;
  technique: string; region: string; caption: string;
  difficulty: string; lesson: string; course: string;
  regionConfidence?: number;
}

const ACCENT = '#10b981';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const LS_KEY = 'erik-quiz-progress';
const CONF_FLOOR = 0.6;

interface Q {
  prompt: string; answer: string; options: string[];
  img?: string; clip?: string; poster?: string;
  technique?: string; caption?: string; difficulty?: string;
  regionKey?: string; lesson?: string; course?: string; videoId?: string;
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// Pick 3 distractor region labels that are NOT the answer and NOT anatomically
// adjacent to it — so the four options are visually distinguishable from a clip.
// Backfills from the remaining labels if a region has many neighbours.
function pickDistractors(answerKey: string): string[] {
  const answerLabel = LABEL_BY_KEY[answerKey];
  const neighborLabels = (REGION_NEIGHBORS[answerKey] || []).map((k) => LABEL_BY_KEY[k]);
  const allLabels = ERIK_REGIONS.map((r) => r.label);
  const far = shuffle(allLabels.filter((l) => l !== answerLabel && !neighborLabels.includes(l)));
  const out = far.slice(0, 3);
  if (out.length < 3) {
    const backfill = shuffle(allLabels.filter((l) => l !== answerLabel && !out.includes(l)));
    for (const l of backfill) { if (out.length >= 3) break; out.push(l); }
  }
  return out;
}

function buildBank(anatomy: Record<string, AnatomyMuscle>): Q[] {
  const name = (slug: string) => anatomy[slug]?.name?.replace(/\b\w/g, (c) => c.toUpperCase()) || slug.replace(/-/g, ' ');
  const muscleRegions: Record<string, string[]> = {};
  for (const r of ERIK_REGIONS)
    for (const m of r.muscles) (muscleRegions[m] ||= []).push(r.label);
  const allRegionLabels = ERIK_REGIONS.map((r) => r.label);
  const bank: Q[] = [];

  // muscle → region (only unambiguous muscles, i.e. one region)
  for (const [slug, regs] of Object.entries(muscleRegions)) {
    if (regs.length !== 1) continue;
    const correct = regs[0];
    const distractors = shuffle(allRegionLabels.filter((l) => l !== correct)).slice(0, 3);
    bank.push({ prompt: `Which body region does Erik address the ${name(slug)} in?`, answer: correct, options: shuffle([correct, ...distractors]) });
  }
  // region → muscle
  for (const r of ERIK_REGIONS) {
    if (r.muscles.length === 0) continue;
    const correct = name(r.muscles[Math.floor(Math.random() * r.muscles.length)]);
    const otherMuscles = ERIK_REGIONS.filter((x) => x.key !== r.key).flatMap((x) => x.muscles).filter((m) => !r.muscles.includes(m));
    const distractors = shuffle([...new Set(otherMuscles)]).slice(0, 3).map(name);
    if (distractors.length < 3) continue;
    bank.push({ prompt: `Which muscle does Erik work when treating the ${r.label}?`, answer: correct, options: shuffle([correct, ...distractors]) });
  }
  return shuffle(bank);
}

// "Spot the region" via MOTION CLIPS — preferred. Low-confidence cards are dropped
// so the quiz only asks about clearly-identifiable techniques.
function buildClipBank(items: QuizBankItem[]): Q[] {
  const valid = items.filter((it) => it.region && REGION_BY_KEY[it.region]);
  const confident = valid.filter((it) => typeof it.regionConfidence !== 'number' || it.regionConfidence >= CONF_FLOOR);
  const usable = confident.length >= 10 ? confident : valid; // never starve the quiz
  return shuffle(usable).map((it) => {
    const label = REGION_BY_KEY[it.region].label;
    return {
      prompt: 'Which body area is Erik working here?',
      answer: label, options: shuffle([label, ...pickDistractors(it.region)]),
      clip: it.clipUrl, poster: it.stillUrl, regionKey: it.region,
      technique: it.technique, caption: it.caption, difficulty: it.difficulty,
      lesson: it.lesson, course: it.course, videoId: it.videoId,
    };
  });
}

// Fallback: region-tagged stills (used only if the clip bank route isn't live).
function buildFrameBank(itemId: string, videosMap: Record<string, VideoFrameData>): Q[] {
  const tagged: Array<{ src: string; key: string }> = [];
  for (const [vid, vd] of Object.entries(videosMap)) {
    for (const f of vd.frames) {
      if (!f.region || !REGION_BY_KEY[f.region]) continue;
      tagged.push({ src: '/api/databases/kb/' + itemId + '/anatomy/frames/' + vid + '/' + (f.file.split('/').pop() || f.file), key: f.region });
    }
  }
  return shuffle(tagged).slice(0, 60).map((t) => ({
    prompt: 'Which body area is Erik working here?',
    answer: LABEL_BY_KEY[t.key], options: shuffle([LABEL_BY_KEY[t.key], ...pickDistractors(t.key)]),
    img: t.src, regionKey: t.key,
  }));
}

export function ErikQuiz({ anatomy, itemId, videosMap, onNavigate }: {
  anatomy: Record<string, AnatomyMuscle>;
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
  onNavigate?: (tab: string, params?: Record<string, string>) => void;
}) {
  // Load the curated motion-clip bank once. Falls back silently to stills.
  const [clipItems, setClipItems] = useState<QuizBankItem[]>([]);
  useEffect(() => {
    let live = true;
    apiGet<{ items?: QuizBankItem[] }>('/api/databases/kb/' + itemId + '/quiz-bank')
      .then((r) => { if (live && Array.isArray(r.items)) setClipItems(r.items); })
      .catch(() => { /* route not live yet → stills fallback */ });
    return () => { live = false; };
  }, [itemId]);

  const recallBank = useMemo(() => buildBank(anatomy), [anatomy]);
  const clipBank = useMemo(() => buildClipBank(clipItems), [clipItems]);
  const frameBank = useMemo(() => buildFrameBank(itemId, videosMap), [itemId, videosMap]);
  const spotBank = clipBank.length ? clipBank : frameBank;

  const initialMode = (() => { try { return new URLSearchParams(window.location.search).get('quizmode') === 'frames' ? 'frames' : 'recall'; } catch { return 'recall'; } })();
  const [mode, setMode] = useState<'recall' | 'frames'>(initialMode);
  const bank = mode === 'frames' ? spotBank : recallBank;
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [muted, setMuted] = useState(true);
  const [slow, setSlow] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const switchMode = (m: 'recall' | 'frames') => { setMode(m); setIdx(0); setPicked(null); setSlow(false); };

  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } })();
  const best: number = saved.bestStreak || 0;
  const [streak, setStreak] = useState(0);

  const q = bank.length ? bank[idx % bank.length] : null;

  // Keep the actual <video> muted/rate in sync with toggles (Preact attr unreliable).
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted, idx, mode]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = slow ? 0.5 : 1; }, [slow, idx, mode]);

  function replay() { const v = videoRef.current; if (v) { try { v.currentTime = 0; void v.play(); } catch { /* ignore */ } } }

  // Grade: exact = correct; anatomically-adjacent = "close" (amber, streak-neutral);
  // otherwise a miss (resets streak).
  function gradeOf(opt: string): 'correct' | 'close' | 'wrong' {
    if (!q) return 'wrong';
    if (opt === q.answer) return 'correct';
    const ak = q.regionKey || KEY_BY_LABEL[q.answer];
    const ok = KEY_BY_LABEL[opt];
    if (ak && ok && regionsAreNeighbors(ak, ok)) return 'close';
    return 'wrong';
  }

  function pick(opt: string) {
    if (!q || picked) return;
    setPicked(opt);
    setAnswered((a) => a + 1);
    const g = gradeOf(opt);
    if (g === 'correct') {
      setScore((s) => s + 1);
      const ns = streak + 1; setStreak(ns);
      if (ns > best) { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...saved, bestStreak: ns })); } catch { /* ignore */ } }
    } else if (g === 'close') {
      /* streak-neutral: keep streak, no score */
    } else {
      setStreak(0);
    }
  }
  function next() { setPicked(null); setSlow(false); setIdx((i) => i + 1); }

  const tabBtn = (m: 'recall' | 'frames', label: string) => (
    <button type="button" onClick={() => switchMode(m)}
      style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        border: '1px solid ' + (mode === m ? ACCENT : 'var(--color-border)'),
        background: mode === m ? ACCENT + '22' : 'transparent',
        color: mode === m ? ACCENT : 'var(--color-text-muted)' }}>{label}</button>
  );

  const diffColor = (d?: string) => d === 'hard' ? RED : d === 'easy' ? ACCENT : AMBER;
  const ctrlBtn = (label: string, on: boolean, onClick: () => void) => (
    <button type="button" onClick={onClick}
      style={{ padding: '5px 11px', borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
        border: '1px solid ' + (on ? ACCENT : 'rgba(255,255,255,0.35)'),
        background: on ? ACCENT + 'cc' : 'rgba(0,0,0,0.62)', color: '#fff' }}>{label}</button>
  );

  const isSpot = mode === 'frames';
  const pickedGrade = picked ? gradeOf(picked) : null;

  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {tabBtn('recall', '🧠 Recall')}
        {tabBtn('frames', clipBank.length ? '🎬 Spot the region' : '👁 Spot the region')}
      </div>

      {!q && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading quiz…</div>}

      {q && (
        <>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '14px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            <span>Score <b style={{ color: 'var(--color-text)' }}>{score}/{answered}</b></span>
            <span>Streak <b style={{ color: ACCENT }}>{streak}</b></span>
            <span>Best <b style={{ color: 'var(--color-text)' }}>{Math.max(best, streak)}</b></span>
            <span style={{ marginLeft: 'auto', color: 'var(--color-text-faint)' }}>{bank.length} cards</span>
          </div>

          {/* Spot-the-region: QUESTION FIRST, big and clear, with a what-to-look-for cue. */}
          {isSpot && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text)', lineHeight: 1.3, overflowWrap: 'break-word' }}>{q.prompt}</div>
              <div style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', marginTop: '5px', lineHeight: 1.45 }}>
                Watch where the therapist’s hands contact the client and which joint moves — then pick the area.
              </div>
            </div>
          )}

          <div style={{ padding: '16px', border: '1px solid var(--color-border)', borderRadius: '12px', background: 'var(--color-card)' }}>
            {q.clip && (
              <div style={{ position: 'relative', marginBottom: '12px' }}>
                <video ref={videoRef} key={q.clip} src={q.clip} poster={q.poster}
                  autoPlay loop muted playsInline controls
                  style={{ width: '100%', maxHeight: '360px', borderRadius: '9px', display: 'block', background: '#000' }} />
                <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '6px' }}>
                  {ctrlBtn('▶ Replay', false, replay)}
                  {ctrlBtn('🐢 Slow', slow, () => setSlow((s) => !s))}
                  {ctrlBtn(muted ? '🔇 Voice' : '🔊 Voice', !muted, () => setMuted((m) => !m))}
                </div>
              </div>
            )}
            {!q.clip && q.img && (
              <img src={q.img} alt="Erik technique frame" loading="lazy"
                style={{ width: '100%', maxHeight: '320px', objectFit: 'cover', borderRadius: '9px', marginBottom: '12px', display: 'block', background: '#000' }} />
            )}

            {/* Recall mode keeps the prompt inside the card (no media to caption). */}
            {!isSpot && (
              <div style={{ fontSize: '17px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px', lineHeight: 1.45 }}>{q.prompt}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {q.options.map((opt) => {
                const isAnswer = opt === q.answer;
                const isPicked = opt === picked;
                let bg = 'transparent', bc = 'var(--color-border)', col = 'var(--color-text)';
                if (picked) {
                  if (isAnswer) { bg = ACCENT + '22'; bc = ACCENT; col = ACCENT; }
                  else if (isPicked && pickedGrade === 'close') { bg = AMBER + '22'; bc = AMBER; col = AMBER; }
                  else if (isPicked) { bg = RED + '22'; bc = RED; col = RED; }
                }
                return (
                  <button key={opt} type="button" onClick={() => pick(opt)} disabled={!!picked}
                    style={{ textAlign: 'left', padding: '11px 14px', minHeight: '44px', borderRadius: '9px', border: '1px solid ' + bc, background: bg, color: col, cursor: picked ? 'default' : 'pointer', fontSize: '14px', fontWeight: 500, transition: 'background .12s' }}>
                    {opt}{picked && isAnswer ? '  ✓' : ''}{picked && isPicked && !isAnswer ? (pickedGrade === 'close' ? '  ≈' : '  ✗') : ''}
                  </button>
                );
              })}
            </div>

            {/* "Close" coaching line for an adjacent-region guess. */}
            {picked && pickedGrade === 'close' && (
              <div style={{ marginTop: '12px', fontSize: '13px', fontWeight: 600, color: AMBER }}>
                Close — that’s the neighbouring area. The answer is <b>{q.answer}</b>.
              </div>
            )}

            {/* Reveal: light up the correct region on the body + technique + cue + jumps. */}
            {picked && isSpot && q.regionKey && (
              <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '9px', border: '1px solid ' + ACCENT + '55', background: ACCENT + '11' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: ACCENT, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '6px' }}>
                  ✓ {q.answer}
                </div>
                <div style={{ maxWidth: '320px', margin: '0 auto 8px' }}>
                  <BodyMap selected={q.regionKey} onSelect={(key) => onNavigate?.('explore', { region: key })} />
                </div>
                {q.technique && (
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {q.technique}
                    {q.difficulty && <span style={{ fontSize: '10px', fontWeight: 700, color: diffColor(q.difficulty), border: '1px solid ' + diffColor(q.difficulty) + '88', borderRadius: '5px', padding: '1px 6px', textTransform: 'uppercase' }}>{q.difficulty}</span>}
                  </div>
                )}
                {q.caption && <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5, marginTop: '4px' }}>{q.caption}</div>}
                {(q.course || q.lesson) && <div style={{ fontSize: '11.5px', color: 'var(--color-text-muted)', marginTop: '6px' }}>{[q.course, q.lesson].filter(Boolean).join(' · ')}</div>}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <button type="button" onClick={replay}
                    style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>▶ Watch again</button>
                  <button type="button" onClick={() => onNavigate?.('explore', { region: q.regionKey! })}
                    style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Explore this region ↗</button>
                  {q.videoId && <button type="button" onClick={() => onNavigate?.('techniques', { technique: q.videoId! })}
                    style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>See full technique ↗</button>}
                </div>
              </div>
            )}

            {picked && (
              <button type="button" onClick={next}
                style={{ marginTop: '16px', padding: '9px 18px', borderRadius: '8px', border: '1px solid ' + ACCENT, background: ACCENT + '22', color: ACCENT, cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                Next card →
              </button>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '10px' }}>
            {isSpot
              ? (clipBank.length ? 'Watch the technique in motion (replay / slow-mo / Erik’s voice), pick the area, then see it on the body. A neighbouring guess counts as “close”.' : 'Identify the body area in real technique stills from Erik’s library.')
              : 'Recall practice from Erik’s region ↔ muscle map.'} Best streak saved on this device.
          </div>
        </>
      )}
    </div>
  );
}
