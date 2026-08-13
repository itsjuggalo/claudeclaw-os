// ClayQuiz — "which ClayTrader setup/concept is this chart?" flashcards built from the
// vision-curated, topic-tagged chart stills (claytrader_quiz_build.py). Multiple choice with
// instant feedback; best streak persists in localStorage. Pure frontend — reads the same
// frames the page already loads (videosMap), each frame carrying a `topic`.
// Mirror of erik/ErikQuiz.tsx (amber ClayTrader accent).
import { useMemo, useState } from 'preact/hooks';

interface FrameEntry {
  seg: number; t?: number; file: string; text?: string; topic?: string;
  keep?: boolean; concept?: string; caption?: string; difficulty?: string;
}
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; }

const ACCENT = '#f59e0b';
const LS_KEY = 'clay-quiz-progress';

interface Q { prompt: string; answer: string; options: string[]; img?: string; caption?: string }

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// Build "which setup/concept" cards from the vision-curated chart frames. Prefers the
// kept frames (precise `concept` answer + teaching `caption`); falls back to the coarse
// `topic` label only if a KB has no kept frames yet.
function buildFrameBank(itemId: string, videosMap: Record<string, VideoFrameData>): Q[] {
  const all = Object.entries(videosMap);
  const anyKeep = all.some(([, vd]) => vd.frames.some((f) => f.keep));
  const tagged: Array<{ src: string; label: string; caption: string }> = [];
  const labels = new Set<string>();
  for (const [vid, vd] of all) {
    for (const f of vd.frames) {
      const ok = anyKeep ? f.keep : !!f.topic;
      if (!ok) continue;
      const label = (anyKeep ? f.concept : f.topic) || f.topic || '';
      if (!label) continue;
      labels.add(label);
      tagged.push({
        src: '/api/databases/kb/' + itemId + '/anatomy/frames/' + vid + '/' + (f.file.split('/').pop() || f.file),
        label, caption: f.caption || '',
      });
    }
  }
  const allLabels = [...labels];
  if (allLabels.length < 3) return [];
  return shuffle(tagged).slice(0, 60).map((t) => {
    const distractors = shuffle(allLabels.filter((l) => l !== t.label)).slice(0, 3);
    return { prompt: 'Which ClayTrader concept/setup is this chart showing?', answer: t.label, options: shuffle([t.label, ...distractors]), img: t.src, caption: t.caption };
  });
}

export function ClayQuiz({ itemId, videosMap }: {
  itemId: string;
  videosMap: Record<string, VideoFrameData>;
}) {
  const bank = useMemo(() => buildFrameBank(itemId, videosMap), [itemId, videosMap]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);

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

  if (!bank.length) {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>
      Quiz bank is still building — chart examples are being curated from the lessons. Check back shortly.
    </div>;
  }

  return (
    <div style={{ maxWidth: '560px' }}>
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
              <img src={q.img} alt="ClayTrader chart" loading="lazy"
                style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', borderRadius: '9px', marginBottom: '14px', display: 'block', background: '#000' }} />
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
            {picked && q.caption && (
              <div style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '8px', background: 'var(--color-bg-subtle, rgba(255,255,255,.03))', border: '1px solid var(--color-border)', fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
                <b style={{ color: ACCENT }}>{q.answer}</b> — {q.caption}
              </div>
            )}
            {picked && (
              <button type="button" onClick={next}
                style={{ marginTop: '16px', padding: '8px 18px', borderRadius: '8px', border: '1px solid ' + ACCENT, background: ACCENT + '22', color: ACCENT, cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                Next chart →
              </button>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '10px' }}>
            Identify the setup/concept in real chart stills from Clay’s lessons. Best streak saved on this device.
          </div>
        </>
      )}
    </div>
  );
}
