// ErikQuiz — self-testing flashcards generated from the region↔muscle model.
// Two question types (muscle→region, region→muscle); multiple choice with
// instant feedback. Progress (answered / best streak) persists in localStorage.
// Pure frontend, derived from regions.ts — no backend, no fetch.
import { useMemo, useState } from 'preact/hooks';
import { ERIK_REGIONS, REGION_BY_KEY } from './regions';

interface AnatomyMuscle { name: string; slug: string; }
interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }

const ACCENT = '#10b981';
const LS_KEY = 'erik-quiz-progress';

interface Q { prompt: string; answer: string; options: string[]; img?: string }

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function buildBank(anatomy: Record<string, AnatomyMuscle>): Q[] {
  const name = (slug: string) => anatomy[slug]?.name?.replace(/\b\w/g, (c) => c.toUpperCase()) || slug.replace(/-/g, ' ');
  // muscle -> set of region labels
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

// "Spot the region" — show a real region-tagged technique frame, guess the area.
function buildFrameBank(itemId: string, videosMap: Record<string, VideoFrameData>): Q[] {
  const labels = ERIK_REGIONS.map((r) => r.label);
  const tagged: Array<{ src: string; label: string }> = [];
  for (const [vid, vd] of Object.entries(videosMap)) {
    for (const f of vd.frames) {
      if (!f.region || !REGION_BY_KEY[f.region]) continue;
      tagged.push({ src: '/api/databases/kb/' + itemId + '/anatomy/frames/' + vid + '/' + (f.file.split('/').pop() || f.file), label: REGION_BY_KEY[f.region].label });
    }
  }
  return shuffle(tagged).slice(0, 60).map((t) => {
    const distractors = shuffle(labels.filter((l) => l !== t.label)).slice(0, 3);
    return { prompt: 'Which area is Erik working here?', answer: t.label, options: shuffle([t.label, ...distractors]), img: t.src };
  });
}

export function ErikQuiz({ anatomy, itemId, videosMap }: {
  anatomy: Record<string, AnatomyMuscle>;
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
}) {
  const recallBank = useMemo(() => buildBank(anatomy), [anatomy]);
  const frameBank = useMemo(() => buildFrameBank(itemId, videosMap), [itemId, videosMap]);
  const initialMode = (() => { try { return new URLSearchParams(window.location.search).get('quizmode') === 'frames' ? 'frames' : 'recall'; } catch { return 'recall'; } })();
  const [mode, setMode] = useState<'recall' | 'frames'>(initialMode);
  const bank = mode === 'frames' ? frameBank : recallBank;
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const switchMode = (m: 'recall' | 'frames') => { setMode(m); setIdx(0); setPicked(null); };

  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } })();
  const best: number = saved.bestStreak || 0;
  const [streak, setStreak] = useState(0);

  const q = bank.length ? bank[idx % bank.length] : null;

  function pick(opt: string) {
    if (!q || picked) return;
    setPicked(opt);
    setAnswered((a) => a + 1);
    if (opt === q.answer) {
      setScore((s) => s + 1);
      const ns = streak + 1; setStreak(ns);
      if (ns > best) { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...saved, bestStreak: ns })); } catch { /* ignore */ } }
    } else {
      setStreak(0);
    }
  }
  function next() { setPicked(null); setIdx((i) => i + 1); }

  const tabBtn = (m: 'recall' | 'frames', label: string) => (
    <button type="button" onClick={() => switchMode(m)}
      style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        border: '1px solid ' + (mode === m ? ACCENT : 'var(--color-border)'),
        background: mode === m ? ACCENT + '22' : 'transparent',
        color: mode === m ? ACCENT : 'var(--color-text-muted)' }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {tabBtn('recall', '🧠 Recall')}
        {tabBtn('frames', '👁 Spot the region')}
      </div>

      {!q && <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading quiz…</div>}

      {q && (
        <>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            <span>Score <b style={{ color: 'var(--color-text)' }}>{score}/{answered}</b></span>
            <span>Streak <b style={{ color: ACCENT }}>{streak}</b></span>
            <span>Best <b style={{ color: 'var(--color-text)' }}>{Math.max(best, streak)}</b></span>
            <span style={{ marginLeft: 'auto', color: 'var(--color-text-faint)' }}>{bank.length} cards</span>
          </div>

          <div style={{ padding: '18px', border: '1px solid var(--color-border)', borderRadius: '12px', background: 'var(--color-card)' }}>
            {q.img && (
              <img src={q.img} alt="Erik technique frame" loading="lazy"
                style={{ width: '100%', maxHeight: '300px', objectFit: 'cover', borderRadius: '9px', marginBottom: '14px', display: 'block', background: '#000' }} />
            )}
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px', lineHeight: 1.45 }}>{q.prompt}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {q.options.map((opt) => {
                const isAnswer = opt === q.answer;
                const isPicked = opt === picked;
                let bg = 'transparent', bc = 'var(--color-border)', col = 'var(--color-text)';
                if (picked) {
                  if (isAnswer) { bg = ACCENT + '22'; bc = ACCENT; col = ACCENT; }
                  else if (isPicked) { bg = '#ef444422'; bc = '#ef4444'; col = '#ef4444'; }
                }
                return (
                  <button key={opt} type="button" onClick={() => pick(opt)} disabled={!!picked}
                    style={{ textAlign: 'left', padding: '10px 14px', borderRadius: '9px', border: '1px solid ' + bc, background: bg, color: col, cursor: picked ? 'default' : 'pointer', fontSize: '14px', transition: 'background .12s' }}>
                    {opt}{picked && isAnswer ? '  ✓' : ''}{picked && isPicked && !isAnswer ? '  ✗' : ''}
                  </button>
                );
              })}
            </div>
            {picked && (
              <button type="button" onClick={next}
                style={{ marginTop: '16px', padding: '8px 18px', borderRadius: '8px', border: '1px solid ' + ACCENT, background: ACCENT + '22', color: ACCENT, cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                Next card →
              </button>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '10px' }}>
            {mode === 'frames' ? 'Identify the body area in real technique stills from Erik’s library.' : 'Recall practice from Erik’s region ↔ muscle map.'} Best streak saved on this device.
          </div>
        </>
      )}
    </div>
  );
}
