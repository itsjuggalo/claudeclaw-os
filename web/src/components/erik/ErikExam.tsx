// ErikExam — Myoskeletal Alignment certification exam prep.
//
// Everything else on this page teaches technique. This tab exists for one job:
// passing the real Advanced Myoskeletal Techniques certification exam. The bank
// is Erik's ACTUAL 137-question Upper Body test booklet, parsed straight out of
// the PDF that ships on USB 1 (erikdalton-kb/build_exam_bank.py), not questions
// invented about his material.
//
// Three modes:
//   Study    — browse by topic, answer visible, with the supporting passage from
//              Erik's own e-Learning textbook underneath.
//   Practice — 20 questions, graded as you go, weighted toward what you've been
//              getting WRONG (a wrong answer comes back; a right one recedes).
//   Mock     — all 137, timed, no feedback until you submit, scored against the
//              real 70% pass mark, then a per-topic breakdown of where you lost.
//
// Honesty rules, because a confident wrong answer is worse than no answer:
//   • "verified" = the wording was located in Erik's textbook/transcripts.
//   • "derived"  = reasoned from Myoskeletal doctrine, not literally located.
//   • Questions with no defensible key are shown, flagged, and excluded from
//     scoring rather than silently guessed.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import examBank from '@/data/erik-exam-bank.json';

const ACCENT = '#10b981';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const LS_KEY = 'erik-exam-progress';

interface ExamQuestion {
  id: string; n: number; stem: string;
  options: Record<string, string>;
  answer: string | null;
  why: string | null;
  source: string | null;
  topic: string;
  confidence: string | null;
  textbook: string | null;
}
interface ExamPaper {
  id: string; title: string; subtitle: string;
  questions: ExamQuestion[]; answered: number; total: number;
  expected: number; missing: number[];
}
type Mode = 'study' | 'practice' | 'mock';

// per-question history: how many times right / wrong on this device
interface Progress { right: Record<string, number>; wrong: Record<string, number>; best?: number; }

function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return { right: p.right || {}, wrong: p.wrong || {}, best: p.best };
  } catch { return { right: {}, wrong: {} }; }
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Weight a question by how badly it's been going: never-seen sits in the
 *  middle, repeatedly-wrong floats to the top, reliably-right sinks. */
function weightOf(q: ExamQuestion, p: Progress): number {
  const w = p.wrong[q.id] || 0;
  const r = p.right[q.id] || 0;
  if (!w && !r) return 2;
  return 1 + w * 3 - Math.min(r, 3);
}

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export function ErikExam({ onSearch }: { onSearch?: (q: string) => void }) {
  // The bank is bundled rather than fetched: the server's top-level static route
  // only allowlists binary extensions, so a .json dropped in web/public/ falls
  // through to the SPA. Bundling keeps this a build:web-only change, and the
  // Exam tab is lazily imported so the 150 KB only loads when you open it.
  const paper = (examBank as unknown as { papers: ExamPaper[] }).papers?.[0] ?? null;
  const loadErr = !paper;
  const [mode, setMode] = useState<Mode>('study');
  const [progress, setProgress] = useState<Progress>(loadProgress);

  const keyed = useMemo(() => (paper?.questions || []).filter((q) => q.answer), [paper]);

  if (loadErr) {
    return (
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        Exam bank not built yet. Run:
        <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT }}>
          ~/02_DATA/mc-kb/.venv/bin/python ~/erikdalton-kb/build_exam_bank.py
        </div>
      </div>
    );
  }
  if (!paper) return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading exam bank…</div>;

  const tab = (m: Mode, label: string, hint: string) => (
    <button type="button" onClick={() => setMode(m)} title={hint}
      style={{
        padding: '7px 14px', borderRadius: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        border: '1px solid ' + (mode === m ? ACCENT : 'var(--color-border)'),
        background: mode === m ? ACCENT + '22' : 'transparent',
        color: mode === m ? ACCENT : 'var(--color-text-muted)',
      }}>{label}</button>
  );

  const seen = new Set([...Object.keys(progress.right), ...Object.keys(progress.wrong)]);
  const mastered = keyed.filter((q) => (progress.right[q.id] || 0) >= 2 && !(progress.wrong[q.id] || 0)).length;

  return (
    <div>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text)' }}>{paper.title}</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{paper.subtitle}</div>
      </div>

      {/* honest coverage line — what's keyed, what isn't */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
        {[
          [`${paper.total}/${paper.expected}`, 'questions from the real booklet'],
          [`${paper.answered}`, 'with an answer key'],
          [`${seen.size}`, 'you have attempted'],
          [`${mastered}`, 'mastered (2× right, 0 wrong)'],
        ].map(([n, l], i) => (
          <div key={i} style={{ padding: '6px 12px', borderRadius: '9px', background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: '15px', fontWeight: 800, color: ACCENT }}>{n}</span>
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '6px' }}>{l}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {tab('study', '📖 Study', 'Browse by topic with answers and Erik’s own wording')}
        {tab('practice', '🎯 Practice 20', 'Graded as you go, weighted to what you keep missing')}
        {tab('mock', '⏱ Mock exam', 'All questions, timed, scored at the real 70% pass mark')}
      </div>

      {mode === 'study' && <StudyMode paper={paper} progress={progress} onSearch={onSearch} />}
      {mode === 'practice' && (
        <DrillMode key="practice" paper={paper} progress={progress}
          onProgress={(p) => { setProgress(p); saveProgress(p); }} count={20} instant />
      )}
      {mode === 'mock' && (
        <DrillMode key="mock" paper={paper} progress={progress}
          onProgress={(p) => { setProgress(p); saveProgress(p); }} count={keyed.length} instant={false} timed />
      )}
    </div>
  );
}

// ── Confidence badge ───────────────────────────────────────────────────────
function ConfBadge({ q }: { q: ExamQuestion }) {
  if (!q.answer) {
    return (
      <span title="No defensible key yet — this question is excluded from scoring."
        style={{ fontSize: '10px', fontWeight: 700, color: RED, border: '1px solid ' + RED + '77', borderRadius: '5px', padding: '1px 5px', textTransform: 'uppercase' }}>
        no key
      </span>
    );
  }
  const verified = q.confidence === 'verified';
  const c = verified ? ACCENT : AMBER;
  return (
    <span title={verified
      ? 'Answer located verbatim in Erik’s textbook or a course transcript.'
      : 'Answer reasoned from Myoskeletal doctrine — check it against the passage below before trusting it.'}
      style={{ fontSize: '10px', fontWeight: 700, color: c, border: '1px solid ' + c + '77', borderRadius: '5px', padding: '1px 5px', textTransform: 'uppercase' }}>
      {verified ? 'verified' : 'derived'}
    </span>
  );
}

// ── Study mode ─────────────────────────────────────────────────────────────
function StudyMode({ paper, progress, onSearch }: {
  paper: ExamPaper; progress: Progress; onSearch?: (q: string) => void;
}) {
  const topics = useMemo(() => {
    const m: Record<string, ExamQuestion[]> = {};
    for (const q of paper.questions) (m[q.topic] ||= []).push(q);
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [paper]);
  const [open, setOpen] = useState<string | null>(topics[0]?.[0] ?? null);
  const [filter, setFilter] = useState('');
  const [weakOnly, setWeakOnly] = useState(false);

  const fq = filter.trim().toLowerCase();
  const matches = (q: ExamQuestion) =>
    (!fq || (q.stem + ' ' + Object.values(q.options).join(' ')).toLowerCase().includes(fq)) &&
    (!weakOnly || (progress.wrong[q.id] || 0) > 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input type="text" value={filter} placeholder="Find a question (e.g. scalene, Zink, firing order)…"
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          style={{ flex: '1 1 280px', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} />
        <button type="button" onClick={() => setWeakOnly((w) => !w)}
          style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: '1px solid ' + (weakOnly ? AMBER : 'var(--color-border)'),
            background: weakOnly ? AMBER + '22' : 'transparent',
            color: weakOnly ? AMBER : 'var(--color-text-muted)' }}>
          {weakOnly ? '⚠ Only what I got wrong' : 'Only what I got wrong'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {topics.map(([topic, qs]) => {
          const shown = qs.filter(matches);
          if (shown.length === 0) return null;
          const isOpen = fq || weakOnly ? true : open === topic;
          const missed = qs.filter((q) => (progress.wrong[q.id] || 0) > 0).length;
          return (
            <div key={topic} style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpen(isOpen && !fq && !weakOnly ? null : topic)}
                style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: 'var(--color-card)', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)' }}>{topic}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
                  {missed > 0 && <span style={{ color: AMBER, fontWeight: 700 }}>{missed} missed · </span>}
                  {shown.length} question{shown.length !== 1 ? 's' : ''} {isOpen ? '▲' : '▼'}
                </span>
              </button>
              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {shown.map((q) => <StudyCard key={q.id} q={q} progress={progress} onSearch={onSearch} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StudyCard({ q, progress, onSearch }: {
  q: ExamQuestion; progress: Progress; onSearch?: (s: string) => void;
}) {
  const [show, setShow] = useState(false);
  const wrong = progress.wrong[q.id] || 0;
  const right = progress.right[q.id] || 0;
  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-faint)' }}>Q{q.n}</span>
        <ConfBadge q={q} />
        {(wrong > 0 || right > 0) && (
          <span style={{ fontSize: '11px', color: wrong > right ? AMBER : ACCENT }}>
            {right}✓ / {wrong}✗
          </span>
        )}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--color-text)', lineHeight: 1.5, marginTop: '4px' }}>{q.stem}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '8px' }}>
        {Object.entries(q.options).sort().map(([k, v]) => {
          const isAns = show && q.answer === k;
          return (
            <div key={k} style={{
              fontSize: '13px', lineHeight: 1.45, padding: '4px 8px', borderRadius: '6px',
              color: isAns ? ACCENT : 'var(--color-text-muted)',
              background: isAns ? ACCENT + '18' : 'transparent',
              fontWeight: isAns ? 700 : 400,
            }}>{k}) {v}{isAns ? '  ✓' : ''}</div>
          );
        })}
      </div>
      <button type="button" onClick={() => setShow((s) => !s)}
        style={{ marginTop: '8px', padding: '4px 11px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: ACCENT }}>
        {show ? 'Hide answer' : q.answer ? 'Show answer' : 'Why is there no answer?'}
      </button>

      {show && (
        <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          {q.answer
            ? <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}><b style={{ color: ACCENT }}>{q.answer})</b> {q.why}</div>
            : <div style={{ fontSize: '13px', color: AMBER, lineHeight: 1.5 }}>
                This one has no defensible key yet — either it asks for a personal opinion, or the booklet's wording
                can't be resolved from the material we hold. It's shown for study but never scored. Guessing an answer
                here would be worse than admitting the gap.
              </div>}
          {q.textbook && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.8px', color: 'var(--color-text-faint)', textTransform: 'uppercase', marginBottom: '3px' }}>
                From Erik's textbook
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.55, fontStyle: 'italic' }}>
                “…{q.textbook.slice(0, 520)}…”
              </div>
            </div>
          )}
          {onSearch && (
            <button type="button" onClick={() => onSearch(q.stem.slice(0, 90))}
              style={{ marginTop: '8px', padding: '4px 11px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)' }}>
              Find this in the video lessons ↗
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Practice / Mock ────────────────────────────────────────────────────────
function DrillMode({ paper, progress, onProgress, count, instant, timed }: {
  paper: ExamPaper; progress: Progress;
  onProgress: (p: Progress) => void;
  count: number; instant: boolean; timed?: boolean;
}) {
  // Question set is chosen ONCE per mount so answering doesn't reshuffle it.
  const [set] = useState<ExamQuestion[]>(() => {
    const keyed = paper.questions.filter((q) => q.answer);
    if (count >= keyed.length) return [...keyed].sort((a, b) => a.n - b.n);
    // weighted sample without replacement — repeatedly-missed questions first
    const pool = shuffle(keyed).map((q) => ({ q, w: weightOf(q, progress) + Math.random() }));
    return pool.sort((a, b) => b.w - a.w).slice(0, count).map((x) => x.q);
  });

  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!timed || submitted) return;
    started.current = true;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [timed, submitted]);

  const q = set[i];
  const answeredCount = Object.keys(picked).length;
  const score = set.filter((x) => picked[x.id] === x.answer).length;
  const pct = set.length ? Math.round((score / set.length) * 100) : 0;
  const passed = pct >= 70;

  function pick(letter: string) {
    if (submitted || (instant && picked[q.id])) return;
    const next = { ...picked, [q.id]: letter };
    setPicked(next);
    if (instant) {
      const p: Progress = { ...progress, right: { ...progress.right }, wrong: { ...progress.wrong } };
      if (letter === q.answer) p.right[q.id] = (p.right[q.id] || 0) + 1;
      else p.wrong[q.id] = (p.wrong[q.id] || 0) + 1;
      onProgress(p);
    }
  }

  function submit() {
    setSubmitted(true);
    const p: Progress = { ...progress, right: { ...progress.right }, wrong: { ...progress.wrong } };
    for (const x of set) {
      if (!picked[x.id]) continue;
      if (picked[x.id] === x.answer) p.right[x.id] = (p.right[x.id] || 0) + 1;
      else p.wrong[x.id] = (p.wrong[x.id] || 0) + 1;
    }
    const s = set.filter((x) => picked[x.id] === x.answer).length;
    const percent = set.length ? Math.round((s / set.length) * 100) : 0;
    if (!p.best || percent > p.best) p.best = percent;
    onProgress(p);
  }

  // per-topic breakdown after a mock
  const byTopic = useMemo(() => {
    const m: Record<string, { right: number; total: number }> = {};
    for (const x of set) {
      const e = (m[x.topic] ||= { right: 0, total: 0 });
      e.total++;
      if (picked[x.id] === x.answer) e.right++;
    }
    return Object.entries(m).sort((a, b) => (a[1].right / a[1].total) - (b[1].right / b[1].total));
  }, [set, picked, submitted]);

  if (!q) return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>No keyed questions available.</div>;

  if (submitted) {
    return (
      <div>
        <div style={{ padding: '18px', borderRadius: '12px', border: '1px solid ' + (passed ? ACCENT : RED) + '77', background: (passed ? ACCENT : RED) + '11', marginBottom: '16px' }}>
          <div style={{ fontSize: '26px', fontWeight: 800, color: passed ? ACCENT : RED }}>
            {pct}% — {passed ? 'PASS' : 'below the 70% pass mark'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {score} of {set.length} correct{timed ? ` · ${fmtClock(elapsed)}` : ''}
            {answeredCount < set.length ? ` · ${set.length - answeredCount} left blank` : ''}
          </div>
        </div>

        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', textTransform: 'uppercase', marginBottom: '8px' }}>
          Where you lost marks — weakest topic first
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
          {byTopic.map(([topic, e]) => {
            const p = Math.round((e.right / e.total) * 100);
            return (
              <div key={topic}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '3px' }}>
                  <span>{topic}</span><span style={{ color: p >= 70 ? ACCENT : AMBER, fontWeight: 700 }}>{e.right}/{e.total} · {p}%</span>
                </div>
                <div style={{ height: '5px', borderRadius: '999px', background: 'var(--color-border)', overflow: 'hidden' }}>
                  <div style={{ width: p + '%', height: '100%', background: p >= 70 ? ACCENT : AMBER }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--color-text-faint)', textTransform: 'uppercase', marginBottom: '8px' }}>
          Every one you missed
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {set.filter((x) => picked[x.id] !== x.answer).map((x) => (
            <div key={x.id} style={{ padding: '11px 13px', borderRadius: '9px', border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-faint)' }}>Q{x.n}</span>
                <ConfBadge q={x} />
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5, marginTop: '3px' }}>{x.stem}</div>
              <div style={{ fontSize: '13px', marginTop: '6px' }}>
                <span style={{ color: RED }}>You: {picked[x.id] ? `${picked[x.id]}) ${x.options[picked[x.id]]}` : '— blank —'}</span>
              </div>
              <div style={{ fontSize: '13px', color: ACCENT, fontWeight: 600 }}>Answer: {x.answer}) {x.options[x.answer!]}</div>
              {x.why && <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.5, marginTop: '4px' }}>{x.why}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const chosen = picked[q.id];
  const graded = instant && !!chosen;

  return (
    <div style={{ maxWidth: '640px' }}>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span>Question <b style={{ color: 'var(--color-text)' }}>{i + 1}</b> / {set.length}</span>
        {instant && <span>Score <b style={{ color: ACCENT }}>{score}/{answeredCount}</b></span>}
        {timed && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', color: ACCENT }}>{fmtClock(elapsed)}</span>}
      </div>
      <div style={{ height: '5px', borderRadius: '999px', background: 'var(--color-border)', overflow: 'hidden', marginBottom: '14px' }}>
        <div style={{ width: ((i + 1) / set.length) * 100 + '%', height: '100%', background: ACCENT, transition: 'width .2s' }} />
      </div>

      <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-faint)' }}>Q{q.n} · {q.topic}</span>
          {graded && <ConfBadge q={q} />}
        </div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5, marginBottom: '14px' }}>{q.stem}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Object.entries(q.options).sort().map(([k, v]) => {
            let bg = 'transparent', bc = 'var(--color-border)', col = 'var(--color-text)';
            if (graded) {
              if (k === q.answer) { bg = ACCENT + '22'; bc = ACCENT; col = ACCENT; }
              else if (k === chosen) { bg = RED + '22'; bc = RED; col = RED; }
            } else if (k === chosen) { bg = ACCENT + '15'; bc = ACCENT; }
            return (
              <button key={k} type="button" onClick={() => pick(k)} disabled={graded}
                style={{ textAlign: 'left', padding: '11px 14px', minHeight: '44px', borderRadius: '9px', border: '1px solid ' + bc, background: bg, color: col, cursor: graded ? 'default' : 'pointer', fontSize: '14px', lineHeight: 1.45 }}>
                <b>{k})</b> {v}
              </button>
            );
          })}
        </div>

        {graded && (
          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}>
              <b style={{ color: chosen === q.answer ? ACCENT : RED }}>
                {chosen === q.answer ? '✓ Correct.' : `✗ The answer is ${q.answer}).`}
              </b>{' '}{q.why}
            </div>
            {q.textbook && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.55, marginTop: '6px', fontStyle: 'italic' }}>
                “…{q.textbook.slice(0, 420)}…”
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button type="button" disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))}
            style={{ padding: '8px 15px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: i === 0 ? 'var(--color-text-faint)' : 'var(--color-text)', cursor: i === 0 ? 'default' : 'pointer', fontSize: '13px' }}>← Prev</button>
          {i < set.length - 1 && (
            <button type="button" onClick={() => setI((x) => x + 1)}
              style={{ padding: '8px 15px', borderRadius: '8px', border: '1px solid ' + ACCENT, background: ACCENT + '22', color: ACCENT, cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>Next →</button>
          )}
          <button type="button" onClick={submit}
            style={{ marginLeft: 'auto', padding: '8px 15px', borderRadius: '8px', border: '1px solid ' + AMBER, background: AMBER + '22', color: AMBER, cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
            {i === set.length - 1 ? 'Finish & score' : `Score now (${answeredCount} answered)`}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginTop: '10px', lineHeight: 1.5 }}>
        {instant
          ? 'Questions you keep missing come back more often; ones you get right twice recede. Progress saved on this device.'
          : 'Mock conditions — no feedback until you submit. Real pass mark is 70%.'}
      </div>
    </div>
  );
}
