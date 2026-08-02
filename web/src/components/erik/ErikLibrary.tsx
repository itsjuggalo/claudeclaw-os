// ErikLibrary — a browsable course → lesson index of Erik's whole library, plus
// an honest inventory of what physical media is actually ingested.
//
// Two things changed on 2026-08-01:
//  1. Search used to match lesson TITLES only, so searching a technique or a
//     muscle found nothing unless it happened to be in the title. It now scans
//     the teaching text of every frame and shows the line that matched.
//  2. "Did we include the USBs and the DVDs?" is now answered by data, not by a
//     claim: the coverage panel lists every DVD box set, USB stick and PDF that
//     made it into the knowledge base (built by erikdalton-kb/build_coverage.py).
import { useMemo, useState } from 'preact/hooks';
import coverageData from '@/data/erik-coverage.json';
import { frameScore } from './ExploreTab';
import { lessonOrder } from './TechniquePlayer';

interface FrameEntry { seg: number; t_mid: number; file: string; text: string; region?: string; }
interface VideoFrameData { id: string; title: string; course: string; frames: FrameEntry[]; covers?: string; }
interface Coverage {
  totalFiles: number;
  groups: Array<{ medium: string; note: string; files: number; courses: Array<[string, number]> }>;
}

const ACCENT = '#10b981';
const MEDIA_ICON: Record<string, string> = { DVD: '💿', USB: '🔌', PDF: '📄' };

export function ErikLibrary({ videosMap, onOpen, itemId }: {
  videosMap: Record<string, VideoFrameData>;
  onOpen: (videoId: string) => void;
  itemId: string;
}) {
  const [q, setQ] = useState('');
  // bundled, not fetched — see the note in ErikExam.tsx
  const coverage = coverageData as unknown as Coverage;
  const [openMedium, setOpenMedium] = useState<string | null>(null);

  const byCourse = useMemo(() => {
    const m: Record<string, VideoFrameData[]> = {};
    for (const v of Object.values(videosMap)) {
      if (!v.frames || v.frames.length === 0) continue;
      (m[v.course] ||= []).push(v);
    }
    // same numeric ordering as the Techniques tab — the two lists must agree
    for (const c of Object.keys(m)) m[c].sort(lessonOrder);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [videosMap]);

  const fq = q.trim().toLowerCase();

  // Ripped-DVD lessons are named VTS_01_1 — a filename, not a title. Pair every
  // row with its best hands-on frame and the line Erik says there, so the list
  // reads as "what you'll learn" instead of a directory listing.
  const preview = useMemo(() => {
    const m: Record<string, FrameEntry> = {};
    for (const v of Object.values(videosMap)) {
      if (!v.frames?.length) continue;
      m[v.id] = [...v.frames].sort((a, b) => frameScore(b.text) - frameScore(a.text))[0];
    }
    return m;
  }, [videosMap]);
  const thumb = (vid: string, file: string) =>
    '/api/databases/kb/' + itemId + '/anatomy/frames/' + vid + '/' + (file.split('/').pop() ?? file);
  const CRYPTIC = /^(VTS[_\s-]?\d|VIDEO_TS|title\s*\d+$)/i;

  const totals = useMemo(() => {
    const vids = Object.values(videosMap).filter((v) => v.frames?.length);
    return {
      courses: byCourse.length,
      lessons: vids.length,
      frames: vids.reduce((n, v) => n + v.frames.length, 0),
    };
  }, [videosMap, byCourse]);

  // Full-text hits across every teaching frame — the thing title-only search missed.
  const contentHits = useMemo(() => {
    if (fq.length < 3) return [];
    const out: Array<{ v: VideoFrameData; frame: FrameEntry; hits: number }> = [];
    for (const v of Object.values(videosMap)) {
      if (!v.frames?.length) continue;
      if ((v.title + ' ' + v.course).toLowerCase().includes(fq)) continue; // already listed above
      let best: FrameEntry | null = null;
      let hits = 0;
      for (const f of v.frames) {
        const t = (f.text || '').toLowerCase();
        if (!t.includes(fq)) continue;
        hits++;
        if (!best || f.text.length > best.text.length) best = f;
      }
      if (best) out.push({ v, frame: best, hits });
    }
    return out.sort((a, b) => b.hits - a.hits).slice(0, 25);
  }, [fq, videosMap]);

  if (Object.keys(videosMap).length === 0) {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>Loading library…</div>;
  }

  // highlight the matched span so the reason a lesson matched is obvious
  const excerpt = (text: string) => {
    const i = text.toLowerCase().indexOf(fq);
    if (i < 0) return text.slice(0, 160);
    const from = Math.max(0, i - 60);
    return (from > 0 ? '…' : '') + text.slice(from, i)
      + '⁣' + text.slice(i, i + fq.length) + '⁣'
      + text.slice(i + fq.length, i + fq.length + 90) + '…';
  };
  const renderExcerpt = (s: string) => {
    const parts = s.split('⁣');
    return parts.map((p, i) => i % 2
      ? <b key={i} style={{ color: ACCENT }}>{p}</b>
      : <span key={i}>{p}</span>);
  };

  return (
    <div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
        Erik Dalton's full library — <b style={{ color: 'var(--color-text)' }}>{totals.courses}</b> courses ·{' '}
        <b style={{ color: 'var(--color-text)' }}>{totals.lessons}</b> lessons ·{' '}
        <b style={{ color: 'var(--color-text)' }}>{totals.frames.toLocaleString()}</b> teaching frames.
        Search titles <i>or what Erik actually says</i>, then open any lesson to step through it.
      </div>

      {/* ── What's ingested, by physical medium ── */}
      {coverage && (
        <div style={{ marginBottom: '16px', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: 'var(--color-card)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            <b style={{ color: 'var(--color-text)' }}>{coverage.totalFiles}</b> source documents ingested — every DVD box set,
            every USB stick and every course booklet you own. Tap a medium to see exactly what's in.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
            {coverage.groups.map((g) => {
              const on = openMedium === g.medium;
              return (
                <button key={g.medium} type="button" onClick={() => setOpenMedium(on ? null : g.medium)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 13px', borderRadius: '9px',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    border: '1px solid ' + (on ? ACCENT : 'var(--color-border)'),
                    background: on ? ACCENT + '22' : 'transparent',
                    color: on ? ACCENT : 'var(--color-text)',
                  }}>
                  <span>{MEDIA_ICON[g.medium] || '📁'}</span>
                  {g.medium}
                  <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>
                    {g.courses.length} title{g.courses.length !== 1 ? 's' : ''} · {g.files} files
                  </span>
                </button>
              );
            })}
          </div>
          {openMedium && (() => {
            const g = coverage.groups.find((x) => x.medium === openMedium);
            if (!g) return null;
            return (
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '6px' }}>{g.note}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {g.courses.map(([name, n]) => (
                    <span key={name} style={{ fontSize: '11.5px', padding: '3px 9px', borderRadius: '999px', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      {name}{n > 1 ? ` ·${n}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <input
        type="text"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        placeholder="Search lessons, courses, or anything Erik says…"
        class="w-full px-3 py-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        style={{ marginBottom: '14px' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {byCourse.map(([course, vids]) => {
          const shown = fq ? vids.filter((v) => (v.title + ' ' + course).toLowerCase().includes(fq)) : vids;
          if (shown.length === 0) return null;
          return (
            <div key={course}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)' }}>{course}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>{shown.length} lesson{shown.length !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: '9px', overflow: 'hidden', background: 'var(--color-card)' }}>
                {shown.map((v, i) => {
                  const p = preview[v.id];
                  const cryptic = CRYPTIC.test(v.title.trim());
                  return (
                    <button key={v.id} type="button" onClick={() => onOpen(v.id)}
                      class="transition-colors hover:bg-[var(--color-elevated)]"
                      style={{ textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', borderTop: i ? '1px solid var(--color-border)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '11px' }}>
                      {p && <img src={thumb(v.id, p.file)} alt="" loading="lazy"
                        style={{ width: '92px', height: '52px', objectFit: 'cover', borderRadius: '6px', flex: '0 0 auto', background: '#000' }} />}
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '13px', color: 'var(--color-text)' }}>
                          {cryptic ? `Part ${i + 1}` : v.title}
                          {cryptic && <span style={{ color: 'var(--color-text-faint)', fontSize: '11px', marginLeft: '7px' }}>{v.title}</span>}
                        </span>
                        {v.covers && (
                          <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '1px' }}>
                            covers: {v.covers}
                          </span>
                        )}
                        {p && (
                          <span style={{ display: '-webkit-box', fontSize: '11.5px', color: 'var(--color-text-muted)', lineHeight: 1.4, marginTop: '2px', overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {p.text.slice(0, 150)}…
                          </span>
                        )}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: '11px', color: ACCENT, fontWeight: 600 }}>{v.frames.length} steps ▶</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* ── Full-text hits inside the lessons ── */}
        {contentHits.length > 0 && (
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '6px' }}>
              Mentioned inside these lessons
              <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--color-text-faint)', marginLeft: '8px' }}>
                {contentHits.length} lesson{contentHits.length !== 1 ? 's' : ''} where Erik says “{q.trim()}”
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {contentHits.map(({ v, frame, hits }) => (
                <button key={v.id} type="button" onClick={() => onOpen(v.id)}
                  class="transition-colors hover:bg-[var(--color-elevated)]"
                  style={{ textAlign: 'left', padding: '10px 13px', borderRadius: '9px', border: '1px solid var(--color-border)', background: 'var(--color-card)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{v.title}</span>
                    <span style={{ flexShrink: 0, fontSize: '11px', color: ACCENT, fontWeight: 600 }}>{hits}× · {v.frames.length} steps ▶</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>{v.course}</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: '4px' }}>
                    {renderExcerpt(excerpt(frame.text))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {fq && contentHits.length === 0 && byCourse.every(([course, vids]) =>
          vids.filter((v) => (v.title + ' ' + course).toLowerCase().includes(fq)).length === 0) && (
          <div style={{ fontSize: '13px', color: 'var(--color-text-faint)' }}>
            Nothing in the library matches “{q}” — not in a title and not in anything Erik says on camera.
          </div>
        )}
      </div>
    </div>
  );
}
