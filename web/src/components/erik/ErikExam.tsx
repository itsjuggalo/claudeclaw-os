// ErikExam — Myoskeletal Alignment certification exam prep.
//
// Everything else on this page teaches technique. This tab exists for one job:
// passing the real Myoskeletal Alignment certification exams. The bank is Erik's
// ACTUAL papers — all five of them, 756 questions: every question the five
// booklets print, with nothing invented. (Technique Tour reads 169, not 170 —
// Erik's own numbering jumps 29 -> 31.)
// (erikdalton-kb/build_exam_bank.py), never questions invented about his material:
//   Upper Body (ships on USB 1) and the four home-study finals — Art of MAT,
//   Technique Tour, Dynamic Lower Body, Shoulder/Arm/Hand — whose question PDFs
//   Erik publishes free on erikdalton.com.
//
// Four modes:
//   Study    — browse by topic, answer visible, with the supporting passage from
//              Erik's own e-Learning textbook underneath.
//   Practice — 20 questions, graded as you go, weighted toward what you've been
//              getting WRONG (a wrong answer comes back; a right one recedes).
//   Mock     — the whole paper, timed, no feedback until you submit, scored against the
//              real 70% pass mark, then a per-topic breakdown of where you lost.
//   Review   — spaced repetition. Every answer stamps a Leitner box (right moves
//              it out to 1/3/7/16/35 days, wrong drops it back to tomorrow), and
//              this drills only what has come due. An exam a month away is won by
//              reviewing on a schedule, not by re-reading what you already know.
//
// Honesty rules, because a confident wrong answer is worse than no answer:
//   • "verified" = the wording was located in Erik's textbook/transcripts.
//   • "derived"  = worked out from the booklet's own printed "Tip:" and
//     Myoskeletal doctrine, with that tip quoted in the reasoning. This is most
//     of the four home-study papers — they ship no answer key at all.
//   • "evidence" = auto-keyed from Erik's own words, and ONLY where one option
//     won decisively (key_from_evidence.py; 8/8 on the paper we can grade).
//   • Questions with no defensible key are shown, flagged, and excluded from
//     scoring rather than silently guessed.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';

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
  // The booklet's own "Tip:" line under a question — Erik nudging you at the
  // answer. Only the four home-study papers print these.
  hint?: string | null;
  // The teaching moments in the video library that cover this question — built
  // by erikdalton-kb/build_exam_bank.py. Empty for pure-theory questions, on
  // purpose: the textbook passage teaches those, and inventing a clip would be
  // the same inaccuracy this whole pass exists to remove.
  lessons?: ExamLesson[];
}
interface ExamLesson {
  videoId: string; title: string; course: string;
  seg: number; t_mid: number; text: string;
  // Page in the PRINTED manual that this lesson corresponds to. These tests are
  // open book and the manuals are physical, so this is often the fastest route
  // to an answer. From the USB Table-of-Contents PDFs (build_manual_pages.py).
  manualPage?: number | null;
}
interface ExamPaper {
  id: string; title: string; subtitle: string;
  questions: ExamQuestion[]; answered: number; total: number;
  expected: number; missing: number[];
}
type Mode = 'study' | 'practice' | 'mock' | 'review';

// per-question history: how many times right / wrong on this device, plus a
// Leitner box and when it was last answered — getting a question right once
// proves nothing three weeks later, and an exam you sit in a month is won by
// reviewing on a schedule instead of re-reading what you already know.
interface Progress {
  right: Record<string, number>; wrong: Record<string, number>; best?: number;
  box?: Record<string, number>; at?: Record<string, number>;
}

// days before a question in each box comes back. Box 1 = tomorrow, box 5 = a
// question that's genuinely stuck.
const BOX_DAYS = [0, 1, 3, 7, 16, 35];
const DAY = 86400000;

function boxOf(p: Progress, id: string): number {
  return p.box?.[id] ?? 0;
}

/** Questions already answered whose review interval has elapsed, most overdue
 *  first. Never-answered questions are NOT due — they're new work, not review. */
function dueQuestions(qs: ExamQuestion[], p: Progress, now: number): ExamQuestion[] {
  return qs
    .map((q) => {
      const at = p.at?.[q.id];
      if (!at) {
        // answered before scheduling existed — treat as long overdue rather than
        // invisible, otherwise every question drilled up to now never comes back
        const tallied = (p.right[q.id] || 0) + (p.wrong[q.id] || 0);
        return tallied ? { q, over: Number.MAX_SAFE_INTEGER } : null;
      }
      const wait = BOX_DAYS[Math.min(boxOf(p, q.id), BOX_DAYS.length - 1)] * DAY;
      const over = now - at - wait;
      return over >= 0 ? { q, over } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b as { over: number }).over - (a as { over: number }).over)
    .map((x) => (x as { q: ExamQuestion }).q);
}

function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return { right: p.right || {}, wrong: p.wrong || {}, best: p.best,
             box: p.box || {}, at: p.at || {} };
  } catch { return { right: {}, wrong: {}, box: {}, at: {} }; }
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Record one answer: tally, advance or reset the Leitner box, stamp the time.
 *  Both drill paths go through here so the schedule can't diverge. */
function record(p: Progress, id: string, correct: boolean, now: number) {
  p.box ||= {}; p.at ||= {};
  if (correct) {
    p.right[id] = (p.right[id] || 0) + 1;
    p.box[id] = Math.min((p.box[id] ?? 0) + 1, BOX_DAYS.length - 1);
  } else {
    p.wrong[id] = (p.wrong[id] || 0) + 1;
    p.box[id] = 1;                 // missed = back to tomorrow, however well it went before
  }
  p.at[id] = now;
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

export function ErikExam({ onSearch, onLesson }: {
  onSearch?: (q: string) => void;
  onLesson?: (videoId: string, t: number) => void;
}) {
  // Fetched, not bundled: five papers with their textbook passages and lesson
  // links are ~1 MB, which bloated this lazily-loaded chunk to 300 KB gzipped.
  // (Serving it as JSON only became possible once the server's static-file route
  // stopped swallowing /api paths — see dashboard.ts.)
  const [bank, setBank] = useState<{ papers: ExamPaper[] } | null>(null);
  const [fetchErr, setFetchErr] = useState(false);
  useEffect(() => {
    let live = true;
    apiGet<{ papers: ExamPaper[] }>('/api/databases/kb/erikdalton/exam-bank')
      .then((r) => { if (live) setBank(r); })
      .catch(() => { if (live) setFetchErr(true); });
    return () => { live = false; };
  }, []);
  const papers = bank?.papers ?? [];
  // Mike has five Myoskeletal exams to sit, not one. Remember which he was on.
  const [paperIdx, setPaperIdx] = useState<number>(() => {
    try {
      // The bank is still being fetched on this first render, so papers.length
      // is 0 — bounding against it here silently discarded the saved paper every
      // time. `paper` below already falls back if the index is out of range.
      const saved = Number(localStorage.getItem(LS_KEY + '-paper'));
      return Number.isFinite(saved) && saved >= 0 && saved < 20 ? saved : 0;
    } catch { return 0; }
  });
  const paper = papers[paperIdx] ?? papers[0] ?? null;
  const loadErr = (bank !== null && papers.length === 0) || fetchErr;
  const [mode, setMode] = useState<Mode>('study');
  const [progress, setProgress] = useState<Progress>(loadProgress);
  // set from the weak-sections panel; Study mode then shows only that section
  const [topicFilter, setTopicFilter] = useState<string | null>(null);

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

  // progress is stored across all five papers, so it has to be narrowed to this
  // one — otherwise drilling the shoulder paper inflated "you have attempted" on
  // Upper Body, which is exactly the kind of wrong number that hides a weak spot
  // recomputed on every progress change; `now` is read once per render so the
  // list doesn't reshuffle mid-drill
  const due = dueQuestions(keyed, progress, Date.now());
  const attempted = new Set([...Object.keys(progress.right), ...Object.keys(progress.wrong)]);
  const seen = new Set(keyed.filter((q) => attempted.has(q.id)).map((q) => q.id));
  const mastered = keyed.filter((q) => (progress.right[q.id] || 0) >= 2 && !(progress.wrong[q.id] || 0)).length;

  return (
    <div>
      {papers.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {papers.map((p, i) => (
            <button key={p.id} type="button"
              onClick={() => { setPaperIdx(i); setMode('study'); try { localStorage.setItem(LS_KEY + '-paper', String(i)); } catch { /* ignore */ } }}
              title={p.subtitle}
              style={{
                padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                border: '1px solid ' + (i === paperIdx ? ACCENT : 'var(--color-border)'),
                background: i === paperIdx ? ACCENT + '22' : 'transparent',
                color: i === paperIdx ? ACCENT : 'var(--color-text-muted)',
              }}>
              {p.title.replace(/^(Advanced Myoskeletal Techniques|MAT|The Art of Myoskeletal Alignment Therapy|Dynamic Body) — ?/, '') || p.title}
              <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> · {p.total}</span>
            </button>
          ))}
        </div>
      )}
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

      {/* how the keys were arrived at — so a wrong key can never masquerade as gospel */}
      <KeyProvenance paper={paper} />

      {/* what he'd actually fail on, by the booklet's own sections */}
      <WeakSections paper={paper} progress={progress} onPick={setTopicFilter}
        active={topicFilter} />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {tab('study', '📖 Study', 'Browse by topic with answers and Erik’s own wording')}
        {tab('practice', '🎯 Practice 20', 'Graded as you go, weighted to what you keep missing')}
        {tab('mock', '⏱ Mock exam', 'All questions, timed, scored at the real 70% pass mark')}
        {due.length > 0 && tab('review', `🔁 Review ${due.length}`,
          'Questions you answered before that are due again — spaced so they stick')}
      </div>

      {mode === 'study' && <StudyMode key={paper.id} paper={paper} progress={progress}
        onSearch={onSearch} onLesson={onLesson} topicFilter={topicFilter} />}
      {mode === 'practice' && (
        <DrillMode key={'practice-' + paper.id} paper={paper} progress={progress} onLesson={onLesson}
          onProgress={(p) => { setProgress(p); saveProgress(p); }} count={20} instant />
      )}
      {mode === 'review' && (
        <DrillMode key={'review-' + paper.id} paper={{ ...paper, questions: due }}
          progress={progress} onLesson={onLesson}
          onProgress={(p) => { setProgress(p); saveProgress(p); }}
          count={Math.min(due.length, 25)} instant />
      )}
      {mode === 'mock' && (
        <DrillMode key={'mock-' + paper.id} paper={paper} progress={progress} onLesson={onLesson}
          onProgress={(p) => { setProgress(p); saveProgress(p); }} count={keyed.length} instant={false} timed />
      )}
    </div>
  );
}

// ── Confidence badge ───────────────────────────────────────────────────────
function ConfBadge({ q }: { q: ExamQuestion }) {
  if (!q.answer) {
    // An opinion item isn't a gap in the data — the booklet genuinely has no
    // single key — so it says so rather than reading like something we missed.
    const op = q.confidence === 'opinion';
    const c = op ? AMBER : RED;
    return (
      <span title={op
        ? 'Instructor-graded opinion item — no single correct answer exists. Excluded from scoring.'
        : 'No defensible key yet — this question is excluded from scoring.'}
        style={{ fontSize: '10px', fontWeight: 700, color: c, border: '1px solid ' + c + '77', borderRadius: '5px', padding: '1px 5px', textTransform: 'uppercase' }}>
        {op ? 'your call' : 'no key'}
      </span>
    );
  }
  const tier = q.confidence === 'verified' ? 'verified'
    : q.confidence === 'evidence' ? 'evidence' : 'derived';
  const c = tier === 'derived' ? AMBER : ACCENT;
  const title = tier === 'verified'
    ? 'Answer located verbatim in Erik’s textbook or a course transcript.'
    : tier === 'evidence'
      ? 'Auto-keyed from Erik’s own words in this course, and only where one option won decisively. Measured 8/8 correct on the paper whose real key we hold — but that is a small sample, so the supporting quote is always shown. Check it.'
      : 'Answer worked out from the booklet’s own printed tip and Myoskeletal doctrine — not located word-for-word in Erik’s text. The reasoning is shown with the answer; check it before you trust it.';
  return (
    <span title={title}
      style={{ fontSize: '10px', fontWeight: 700, color: c, border: '1px solid ' + c + '77', borderRadius: '5px', padding: '1px 5px', textTransform: 'uppercase' }}>
      {tier}
    </span>
  );
}

// Passing is a coverage problem, not an effort problem: you fail on the sections
// you never drilled, and you can't see those in a 160-question list. This ranks
// the booklet's own sections by how badly they're going — wrong answers first,
// then sections never touched at all — and jumps straight into one.
function WeakSections({ paper, progress, onPick, active }: {
  paper: ExamPaper; progress: Progress;
  onPick: (t: string | null) => void; active: string | null;
}) {
  const rows = useMemo(() => {
    const m: Record<string, { total: number; right: number; wrong: number; seen: number }> = {};
    for (const q of paper.questions) {
      if (!q.answer) continue;
      const r = (m[q.topic] ||= { total: 0, right: 0, wrong: 0, seen: 0 });
      r.total++;
      const w = progress.wrong[q.id] || 0;
      const g = progress.right[q.id] || 0;
      r.right += g; r.wrong += w;
      if (w || g) r.seen++;
    }
    return Object.entries(m).map(([topic, r]) => {
      const attempts = r.right + r.wrong;
      // never-attempted sections are the real risk, so they rank as 0% known
      // rather than being hidden by having no score at all
      const score = attempts ? r.right / attempts : 0;
      const coverage = r.total ? r.seen / r.total : 0;
      return { topic, ...r, attempts, score, risk: (1 - score) * 0.6 + (1 - coverage) * 0.4 };
    }).sort((a, b) => b.risk - a.risk || b.total - a.total).slice(0, 6);
  }, [paper, progress]);

  if (!rows.length) return null;
  // ask the whole paper, not just the six rows on show — the sections he HAS
  // drilled are exactly the ones that fall off this list, so checking the rows
  // said "nothing drilled yet" to someone who had just sat a mock
  const anyAttempt = paper.questions.some(
    (q) => (progress.right[q.id] || 0) + (progress.wrong[q.id] || 0) > 0);
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '11.5px', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
        <b style={{ color: RED }}>Where you'd lose marks</b>
        {anyAttempt ? ' — ranked by what you get wrong and what you’ve never touched. Tap one to study just it.'
          : ' — nothing drilled yet, so these are simply the biggest untouched sections. Tap one to start.'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {rows.map((r) => {
          const on = active === r.topic;
          const label = r.attempts
            ? `${Math.round(r.score * 100)}% right · ${r.seen}/${r.total} seen`
            : `${r.total} question${r.total !== 1 ? 's' : ''} · untouched`;
          return (
            <button key={r.topic} type="button" onClick={() => onPick(on ? null : r.topic)}
              title={`Study "${r.topic}" on its own`}
              style={{
                padding: '6px 11px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                textAlign: 'left', border: '1px solid ' + (on ? RED : 'var(--color-border)'),
                background: on ? RED + '1e' : 'var(--color-card)', color: 'var(--color-text)',
              }}>
              <span style={{ fontWeight: 700 }}>{r.topic}</span>
              <span style={{ color: 'var(--color-text-faint)', marginLeft: '7px' }}>{label}</span>
            </button>
          );
        })}
        {active && (
          <button type="button" onClick={() => onPick(null)}
            style={{ padding: '6px 11px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
              border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)' }}>
            ✕ show all sections
          </button>
        )}
      </div>
    </div>
  );
}

// Only the Upper Body paper ships a real answer key. Everything else was worked
// out here — so the paper says out loud how its keys were arrived at rather than
// letting a confident badge imply an authority it doesn't have.
function KeyProvenance({ paper }: { paper: ExamPaper }) {
  const n = { verified: 0, evidence: 0, derived: 0, none: 0 };
  for (const q of paper.questions) {
    if (!q.answer) n.none++;
    else if (q.confidence === 'verified') n.verified++;
    else if (q.confidence === 'evidence') n.evidence++;
    else n.derived++;
  }
  const parts: string[] = [];
  if (n.verified) parts.push(`${n.verified} located word-for-word in Erik’s text`);
  if (n.evidence) parts.push(`${n.evidence} auto-keyed from a decisive quote`);
  if (n.derived) parts.push(`${n.derived} worked out from the booklet’s printed tip`);
  if (n.none) parts.push(`${n.none} left unkeyed rather than guessed`);
  return (
    <div style={{ fontSize: '11.5px', color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: '14px' }}>
      <b style={{ color: AMBER }}>Where these answers come from:</b>{' '}{parts.join(' · ')}.
      {' '}Every answer shows its reasoning — read it, don’t just take the letter.
    </div>
  );
}

// The booklet's own printed nudge. Shown BEFORE you answer, because that's how
// Erik intended these open-book papers to be taken — it teaches the reasoning
// instead of rewarding a lucky guess.
function Tip({ q }: { q: ExamQuestion }) {
  if (!q.hint) return null;
  return (
    <div style={{ marginTop: '8px', fontSize: '12px', color: AMBER, lineHeight: 1.5 }}>
      💡 <b>Erik's tip:</b> <span style={{ color: 'var(--color-text-muted)' }}>{q.hint}</span>
    </div>
  );
}

// ── "Watch Erik teach this" ────────────────────────────────────────────────
// Reading why an answer is right is one pass; watching the hands that make it
// true is what survives to exam day. Each link opens the technique player at the
// exact second Erik covers it.
function WatchLessons({ q, onLesson }: { q: ExamQuestion; onLesson?: (videoId: string, t: number) => void }) {
  const ls = q.lessons ?? [];
  if (!ls.length || !onLesson) return null;
  const time = (s: number) => {
    const t = Math.round(s || 0); const m = Math.floor(t / 60);
    return (m > 0 ? m + 'm' : '') + (t % 60) + 's';
  };
  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.8px', color: 'var(--color-text-faint)', textTransform: 'uppercase', marginBottom: '4px' }}>
        Watch Erik teach this
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {ls.map((l) => (
          <button key={l.videoId + l.seg} type="button" onClick={() => onLesson(l.videoId, l.t_mid)}
            class="transition-colors hover:bg-[var(--color-elevated)]"
            style={{ textAlign: 'left', padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer' }}>
            <span style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: ACCENT }}>
              ▶ {l.title} <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>· {l.course} · {time(l.t_mid)}</span>
              {l.manualPage ? (
                <span title="Page in your printed course manual — these tests are open book"
                  style={{ marginLeft: '7px', fontSize: '11px', fontWeight: 700, color: AMBER, border: '1px solid ' + AMBER + '66', borderRadius: '5px', padding: '0 5px' }}>
                  📕 manual p.{l.manualPage}
                </span>
              ) : null}
            </span>
            <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: '2px' }}>
              “{l.text}”
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Study mode ─────────────────────────────────────────────────────────────
function StudyMode({ paper, progress, onSearch, onLesson, topicFilter }: {
  paper: ExamPaper; progress: Progress; onSearch?: (q: string) => void;
  onLesson?: (videoId: string, t: number) => void;
  topicFilter?: string | null;
}) {
  const topics = useMemo(() => {
    const m: Record<string, ExamQuestion[]> = {};
    for (const q of paper.questions) (m[q.topic] ||= []).push(q);
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [paper]);
  const [open, setOpen] = useState<string | null>(topics[0]?.[0] ?? null);
  // picking a weak section above opens it here instead of making him hunt for it
  useEffect(() => { if (topicFilter) setOpen(topicFilter); }, [topicFilter]);
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
        {topics.filter(([t]) => !topicFilter || t === topicFilter).map(([topic, qs]) => {
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
                  {shown.map((q) => <StudyCard key={q.id} q={q} progress={progress} onSearch={onSearch} onLesson={onLesson} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StudyCard({ q, progress, onSearch, onLesson }: {
  q: ExamQuestion; progress: Progress; onSearch?: (s: string) => void;
  onLesson?: (videoId: string, t: number) => void;
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
      <Tip q={q} />
      <button type="button" onClick={() => setShow((s) => !s)}
        style={{ marginTop: '8px', padding: '4px 11px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: ACCENT }}>
        {show ? 'Hide answer' : q.answer ? 'Show answer' : 'Why is there no answer?'}
      </button>

      {show && (
        <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          {q.answer
            ? <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.5 }}><b style={{ color: ACCENT }}>{q.answer})</b> {q.why}</div>
            : <div style={{ fontSize: '13px', color: AMBER, lineHeight: 1.5 }}>
                {q.confidence === 'opinion'
                  ? 'This one is graded on your own judgement — the booklet asks what YOU consider worst, so there is no single key. It is shown for study but never scored.'
                  : 'This one has no defensible key yet — the booklet\'s wording can\'t be resolved from the material we hold. Shown for study, never scored; guessing would be worse than admitting the gap.'}
                {q.why && <div style={{ color: 'var(--color-text)', marginTop: '6px' }}>{q.why}</div>}
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
          <WatchLessons q={q} onLesson={onLesson} />
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
function DrillMode({ paper, progress, onProgress, count, instant, timed, onLesson }: {
  paper: ExamPaper; progress: Progress;
  onProgress: (p: Progress) => void;
  count: number; instant: boolean; timed?: boolean;
  onLesson?: (videoId: string, t: number) => void;
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
      const p: Progress = {
        ...progress, right: { ...progress.right }, wrong: { ...progress.wrong },
        box: { ...(progress.box || {}) }, at: { ...(progress.at || {}) },
      };
      record(p, q.id, letter === q.answer, Date.now());
      onProgress(p);
    }
  }

  function submit() {
    setSubmitted(true);
    const p: Progress = {
      ...progress, right: { ...progress.right }, wrong: { ...progress.wrong },
      box: { ...(progress.box || {}) }, at: { ...(progress.at || {}) },
    };
    const now = Date.now();
    for (const x of set) {
      if (!picked[x.id]) continue;
      record(p, x.id, picked[x.id] === x.answer, now);
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
              <WatchLessons q={x} onLesson={onLesson} />
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
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>{q.stem}</div>
        <div style={{ marginBottom: '14px' }}><Tip q={q} /></div>

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
            {chosen !== q.answer && <WatchLessons q={q} onLesson={onLesson} />}
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
