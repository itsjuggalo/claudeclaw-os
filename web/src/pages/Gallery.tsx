// Gallery — generated images/videos from local folders.
// Features: collapsible sections, sticky nav bar, blur toggle (nano/gen),
// drag-and-drop file moves between sections, hover Move-To menu.
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { PhotoStudio } from '@/components/PhotoStudio';
import { useFetch } from '@/lib/useFetch';
import { dashboardToken, apiPost } from '@/lib/api';

interface GFile { name: string; url: string; type: 'image' | 'video'; }
interface GSection { id: string; root: string; sub: string; title: string; desc: string; count: number; files: GFile[]; }

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// Per-section accent colours
const ACCENT: Record<string, string> = {
  nano: '#f59e0b', gen: '#f59e0b', video: '#8b5cf6',
  sig: '#34d39a', sp: '#34d39a', sgif: '#34d39a', cr: '#34d39a',
  gl: '#ef4444', svg: '#3b82f6', avc: '#ec4899', avp: '#ec4899', freq: '#06b6d4',
};
const accent = (id: string) => ACCENT[id] || '#34d39a';

const withTok = (u: string) =>
  dashboardToken ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}` : u;

function loadSet(key: string, defaultVal: string[] = []): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || JSON.stringify(defaultVal))); } catch { return new Set(defaultVal); }
}
function saveSet(key: string, s: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch {}
}

export function Gallery() {
  const { data, loading, error, refresh } = useFetch<GSection[]>('/api/gallery', 60_000);
  const sections: GSection[] = Array.isArray(data) ? data : [];

  const [lightbox, setLightbox] = useState<GFile | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadSet('gallery.collapsed'));
  const [blurred, setBlurred] = useState<Set<string>>(() => loadSet('gallery.blurred', []));
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  // Default: EVERY section blurred until the user reveals it. Seed once when sections
  // first load and no saved preference exists. Not persisted here — so closing/reopening
  // re-blurs everything (the safe default); an explicit per-section toggle writes the set.
  const blurSeeded = useRef(false);
  useEffect(() => {
    if (blurSeeded.current || sections.length === 0) return;
    blurSeeded.current = true;
    if (localStorage.getItem('gallery.blurred') === null) {
      setBlurred(new Set(sections.map(s => s.id)));
    }
  }, [sections.length]);

  // Drag-and-drop state (use a ref so drop handlers always see current value)
  const dragSrcRef = useRef<{ name: string; root: string; sub: string; secId: string } | null>(null);
  const [dragOverSec, setDragOverSec] = useState<string | null>(null);

  // Move-to popup
  const [moveMenu, setMoveMenu] = useState<{
    file: GFile; secId: string; root: string; sub: string; top: number; left: number;
  } | null>(null);
  const [moving, setMoving] = useState(false);

  // Section refs for scroll-into-view
  const secRefs = useRef<Record<string, HTMLElement | null>>({});

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveSet('gallery.collapsed', next);
      return next;
    });
  }, []);

  const toggleBlur = useCallback((id: string) => {
    setBlurred(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveSet('gallery.blurred', next);
      return next;
    });
  }, []);

  const scrollTo = useCallback((id: string) => {
    secRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const doMove = useCallback(async (srcRoot: string, srcSub: string, name: string, dst: GSection) => {
    setMoving(true);
    setMoveMenu(null);
    try {
      await apiPost('/api/gallery/move', { srcRoot, srcSub, name, dstRoot: dst.root, dstSub: dst.sub });
      refresh();
    } catch (e) {
      console.error('Gallery move failed:', e);
    } finally {
      setMoving(false);
    }
  }, [refresh]);

  // Close move menu on outside click
  useEffect(() => {
    if (!moveMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest?.('[data-move-menu]')) setMoveMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moveMenu]);

  if (error) return <div class="flex flex-col h-full"><PageHeader title="Gallery" /><PageState error={error} /></div>;
  if (loading && sections.length === 0) return <div class="flex flex-col h-full"><PageHeader title="Gallery" /><PageState loading /></div>;

  const total = sections.reduce((s, x) => s + x.count, 0);

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Gallery" />
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>

        {/* ── Photo Studio: upload→edit / text→create (the Media & Gens generator) ── */}
        <PhotoStudio onDone={refresh} />

        {/* ── Sticky section nav ─────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'rgba(10,14,20,0.96)', backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '8px 16px', display: 'flex', gap: '6px',
          overflowX: 'auto', scrollbarWidth: 'none',
          alignItems: 'center',
        }}>
          {sections.map(sec => {
            const isTarget = dragOverSec === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollTo(sec.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverSec(sec.id); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = dragSrcRef.current;
                  if (src && src.secId !== sec.id) doMove(src.root, src.sub, src.name, sec);
                  setDragOverSec(null);
                }}
                onDragLeave={() => setDragOverSec(null)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '4px 10px', borderRadius: '999px', cursor: 'pointer',
                  fontSize: '11px', fontFamily: MONO, fontWeight: 700, border: 'none',
                  background: isTarget ? accent(sec.id) : 'rgba(255,255,255,0.05)',
                  outline: isTarget ? `2px solid ${accent(sec.id)}` : 'none',
                  color: isTarget ? '#000' : '#8a97a8',
                  transition: 'all 0.12s',
                }}
              >
                <span style={{
                  background: isTarget ? '#000' : accent(sec.id), color: isTarget ? '#fff' : '#000',
                  borderRadius: '999px', padding: '1px 6px', fontSize: '10px',
                }}>{sec.count}</span>
                {sec.title}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '11px', color: '#3d4f5e', fontFamily: MONO, flexShrink: 0 }}>
            {total} assets · {sections.length} sections
          </span>
          <button
            type="button"
            onClick={() => refresh()}
            style={{
              flexShrink: 0, fontSize: '11px', color: '#7fd1ff', background: '#16323f',
              border: '1px solid #244b5c', borderRadius: '999px', padding: '4px 12px',
              cursor: 'pointer', fontFamily: MONO, fontWeight: 700,
            }}
          >↻</button>
        </div>

        {/* ── Section list ───────────────────────────────────────────── */}
        <div style={{ padding: '16px 20px 48px', maxWidth: '1400px', margin: '0 auto' }}>
          {sections.length === 0 ? (
            <PageState empty emptyTitle="No generated media yet" emptyDescription="Generate an image or video and it'll appear here automatically." />
          ) : sections.map(sec => {
            const isCollapsed = collapsed.has(sec.id);
            const isBlurred = blurred.has(sec.id);
            const canBlur = true;  // every section is blurrable (default-blurred below)
            const ac = accent(sec.id);
            const isDragTarget = dragOverSec === sec.id && dragSrcRef.current?.secId !== sec.id;

            return (
              <section
                key={sec.id}
                ref={(el: HTMLElement | null) => { secRefs.current[sec.id] = el; }}
                style={{ marginBottom: '20px', scrollMarginTop: '58px' }}
                onDragOver={(e: DragEvent) => { e.preventDefault(); setDragOverSec(sec.id); }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  const src = dragSrcRef.current;
                  if (src && src.secId !== sec.id) doMove(src.root, src.sub, src.name, sec);
                  setDragOverSec(null);
                }}
                onDragLeave={(e: DragEvent) => {
                  if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) setDragOverSec(null);
                }}
              >
                {/* Section header */}
                <div
                  onClick={() => toggleCollapse(sec.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 14px',
                    background: isDragTarget ? `${ac}20` : 'rgba(20,27,38,0.7)',
                    border: `2px solid ${isDragTarget ? ac : 'rgba(255,255,255,0.07)'}`,
                    borderRadius: isCollapsed ? '10px' : '10px 10px 0 0',
                    cursor: 'pointer', userSelect: 'none',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span style={{
                    fontSize: '11px', fontWeight: 800, padding: '2px 9px',
                    borderRadius: '999px', background: ac, color: '#000', flexShrink: 0,
                  }}>{sec.count}</span>
                  <span style={{ fontWeight: 700, fontSize: '15px', flex: 1, color: '#c9d1da' }}>{sec.title}</span>

                  {/* Blur toggle (nano/gen only) */}
                  {canBlur && (
                    <button
                      type="button"
                      title={isBlurred ? 'Remove blur' : 'Blur content'}
                      onClick={(e: MouseEvent) => { e.stopPropagation(); toggleBlur(sec.id); }}
                      style={{
                        padding: '3px 10px', borderRadius: '999px', fontSize: '11px',
                        fontFamily: MONO, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        background: isBlurred ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.08)',
                        border: `1px solid ${isBlurred ? '#f59e0b' : 'rgba(245,158,11,0.25)'}`,
                        color: isBlurred ? '#fbbf24' : '#78350f',
                        transition: 'all 0.15s',
                      }}
                    >
                      {isBlurred ? '🔒 Blurred' : '👁 Unblurred'}
                    </button>
                  )}

                  {/* Collapse chevron */}
                  <span style={{
                    color: '#4a5568', fontSize: '13px', flexShrink: 0,
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s', display: 'block',
                  }}>▾</span>
                </div>

                {/* Section body */}
                {!isCollapsed && (
                  <div style={{
                    border: `2px solid ${isDragTarget ? ac : 'rgba(255,255,255,0.06)'}`,
                    borderTop: 'none', borderRadius: '0 0 10px 10px',
                    padding: '12px 14px 14px',
                    background: isDragTarget ? `${ac}08` : 'rgba(12,16,22,0.5)',
                    minHeight: isDragTarget ? '80px' : undefined,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}>
                    <p style={{ fontSize: '11px', color: '#4a5568', margin: '0 0 12px', fontFamily: MONO }}>{sec.desc}</p>
                    <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                      {sec.files.map((f) => {
                        const fKey = `${sec.id}::${f.name}`;
                        const isHov = hoveredFile === fKey;
                        const isDragging = dragSrcRef.current?.name === f.name && dragSrcRef.current?.secId === sec.id;

                        return (
                          <figure
                            key={f.url}
                            draggable
                            onDragStart={(e: DragEvent) => {
                              dragSrcRef.current = { name: f.name, root: sec.root, sub: sec.sub, secId: sec.id };
                              e.dataTransfer?.setData('text/plain', f.name);
                            }}
                            onDragEnd={() => { dragSrcRef.current = null; setDragOverSec(null); }}
                            onMouseEnter={() => setHoveredFile(fKey)}
                            onMouseLeave={() => setHoveredFile(null)}
                            onClick={() => { if (f.type === 'image') setLightbox(f); }}
                            style={{
                              margin: 0, position: 'relative',
                              background: isHov ? 'rgba(28,36,50,0.9)' : 'rgba(21,28,37,0.6)',
                              border: `1px solid ${isHov ? ac : 'rgba(255,255,255,0.08)'}`,
                              borderRadius: '10px', overflow: 'hidden',
                              cursor: f.type === 'image' ? 'zoom-in' : 'default',
                              opacity: isDragging ? 0.35 : 1,
                              transform: isHov && !isDragging ? 'translateY(-2px)' : 'none',
                              transition: 'border-color 0.12s, transform 0.1s, opacity 0.1s',
                            }}
                          >
                            {/* Thumbnail */}
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              aspectRatio: '1 / 1', padding: '8px', background: '#080d12', overflow: 'hidden',
                            }}>
                              {f.type === 'video' ? (
                                <video
                                  src={withTok(f.url)}
                                  controls preload="metadata"
                                  style={{
                                    maxWidth: '100%', maxHeight: '100%', display: 'block',
                                    filter: isBlurred && !isHov ? 'blur(14px) brightness(0.6)' : 'none',
                                    transition: 'filter 0.2s',
                                  }}
                                />
                              ) : (
                                <img
                                  src={withTok(f.url)}
                                  loading="lazy"
                                  alt={f.name}
                                  style={{
                                    maxWidth: '100%', maxHeight: '100%', display: 'block',
                                    filter: isBlurred && !isHov ? 'blur(14px) brightness(0.6)' : 'none',
                                    transition: 'filter 0.2s',
                                  }}
                                />
                              )}
                            </div>

                            {/* Filename */}
                            <figcaption style={{
                              padding: '5px 8px', fontSize: '10px', color: '#5a6a78',
                              fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }} title={f.name}>{f.name}</figcaption>

                            {/* Hover action bar */}
                            {isHov && (
                              <div
                                style={{
                                  position: 'absolute', top: 0, left: 0, right: 0,
                                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
                                  display: 'flex', justifyContent: 'flex-end', padding: '6px 6px 0',
                                }}
                                onClick={(e: MouseEvent) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  title="Move to another folder"
                                  disabled={moving}
                                  onClick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setMoveMenu({
                                      file: f, secId: sec.id, root: sec.root, sub: sec.sub,
                                      top: rect.bottom + 4,
                                      left: Math.min(rect.left, window.innerWidth - 200),
                                    });
                                  }}
                                  style={{
                                    fontSize: '10px', fontFamily: MONO, fontWeight: 700,
                                    padding: '3px 8px', borderRadius: '5px', cursor: 'pointer',
                                    background: 'rgba(0,0,0,0.7)', border: `1px solid ${ac}`,
                                    color: ac,
                                  }}
                                >↗ Move</button>
                              </div>
                            )}
                          </figure>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* ── Move-to dropdown ──────────────────────────────────────────── */}
      {moveMenu && (
        <div
          data-move-menu
          style={{
            position: 'fixed', top: moveMenu.top, left: moveMenu.left, zIndex: 200,
            background: '#0e1520', border: '1px solid #1e2d40',
            borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            padding: '6px', minWidth: '200px', maxHeight: '320px', overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '10px', color: '#3d4f5e', fontFamily: MONO, padding: '4px 10px 8px', letterSpacing: '1px' }}>
            MOVE TO FOLDER
          </div>
          {sections.filter(s => s.id !== moveMenu.secId).map(s => (
            <button
              key={s.id}
              type="button"
              disabled={moving}
              onClick={() => doMove(moveMenu.root, moveMenu.sub, moveMenu.file.name, s)}
              style={{
                display: 'flex', alignItems: 'center', gap: '9px', width: '100%',
                padding: '7px 10px', borderRadius: '6px', cursor: moving ? 'wait' : 'pointer',
                border: 'none', background: 'transparent', color: '#b0bec5',
                fontSize: '12px', textAlign: 'left', transition: 'background 0.1s',
              }}
              onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: accent(s.id), flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{s.title}</span>
              <span style={{ fontSize: '10px', color: '#3d4f5e', fontFamily: MONO }}>{s.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(2,4,7,0.94)', backdropFilter: 'blur(4px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: '12px', padding: '24px', cursor: 'zoom-out',
          }}
        >
          <img
            src={withTok(lightbox.url)}
            alt={lightbox.name}
            style={{ maxWidth: '94vw', maxHeight: '86vh', borderRadius: '10px', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}
          />
          <div style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO }}>{lightbox.name}</div>
        </div>
      )}
    </div>
  );
}
