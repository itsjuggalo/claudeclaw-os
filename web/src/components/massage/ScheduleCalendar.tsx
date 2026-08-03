// Massage schedule calendar — Month / Week / 3-day / Day views over the massage
// server's /availability/schedule feed. The month grid keeps the original
// tap-a-day-to-target behaviour (it drives the partial-block form below it); the
// time-grid views lay real bookings out against the clock so a working day reads
// at a glance instead of as a "●3" dot.
import { useMemo, useState } from 'preact/hooks';
import { CalendarClock, CalendarDays, CalendarRange, Columns3, Square } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';

export interface ScheduleAppt {
  id: string;
  appt_date: string;
  appt_time: string;
  client_name: string;
  service_name: string;
  status: string;
  beyond_window: number;
  duration_min: number;
}
export interface ScheduleTimeBlock { id: string; day: string; start_hm: string; end_hm: string }
export interface ScheduleResp {
  ok: boolean;
  month: string;
  appts: ScheduleAppt[];
  blackouts: string[];
  timeBlocks: ScheduleTimeBlock[];
}

export type CalendarView = 'month' | 'week' | '3day' | 'day';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_PX = 52;          // one hour of the time grid
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 20;

export function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { return addDays(d, -d.getDay()); }
function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function hmToMin(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function minToLabel(min: number): string {
  const h = Math.floor(min / 60), mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
// "13:30" / "1:30 PM" → 12-hour display, matching how the booking side reads.
function prettyTime(hm: string): string {
  const min = hmToMin(hm);
  const h24 = Math.floor(min / 60), mm = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')}${h24 < 12 ? 'a' : 'p'}`;
}

function statusTone(status: string): { bar: string; text: string; label: string } {
  const s = (status || '').toLowerCase();
  if (s === 'requested' || s === 'pending') return { bar: 'var(--color-warn)', text: 'var(--color-warn)', label: 'requested' };
  if (s === 'cancelled' || s === 'declined') return { bar: 'var(--color-text-faint)', text: 'var(--color-text-faint)', label: s };
  if (s === 'completed') return { bar: 'var(--color-status-done)', text: 'var(--color-status-done)', label: 'completed' };
  return { bar: 'var(--color-accent)', text: 'var(--color-accent)', label: s || 'confirmed' };
}

/**
 * Fetch the schedule for every month the visible range touches. A range is at
 * most 6 weeks (month view) or 7 days, so it never spans more than two months —
 * two fixed hooks keep the hook order stable.
 */
function useSchedule(rangeStart: Date, rangeEnd: Date) {
  const keyA = monthKey(rangeStart);
  const keyB = monthKey(rangeEnd);
  const a = useFetch<ScheduleResp>(`/api/massage-admin/availability/schedule?month=${keyA}`, 30000);
  const b = useFetch<ScheduleResp>(keyB === keyA ? null : `/api/massage-admin/availability/schedule?month=${keyB}`, 30000);

  return useMemo(() => {
    const appts = [...(a.data?.appts ?? []), ...(b.data?.appts ?? [])];
    const blackouts = new Set([...(a.data?.blackouts ?? []), ...(b.data?.blackouts ?? [])]);
    const timeBlocks = [...(a.data?.timeBlocks ?? []), ...(b.data?.timeBlocks ?? [])];
    const byDay: Record<string, ScheduleAppt[]> = {};
    appts.forEach((x) => { (byDay[x.appt_date] ??= []).push(x); });
    Object.values(byDay).forEach((rows) => rows.sort((p, q) => hmToMin(p.appt_time) - hmToMin(q.appt_time)));
    return {
      appts, byDay, blackouts, timeBlocks,
      loading: a.loading || b.loading,
      refresh: () => { a.refresh(); b.refresh(); },
    };
  }, [a.data, b.data, a.loading, b.loading]);
}

// Pack overlapping bookings into side-by-side columns (greedy, earliest-first).
function layout(rows: ScheduleAppt[]): Array<{ appt: ScheduleAppt; col: number; cols: number; start: number; end: number }> {
  const spans = rows.map((appt) => {
    const start = hmToMin(appt.appt_time);
    return { appt, start, end: start + (Number(appt.duration_min) || 60) };
  }).sort((a, b) => a.start - b.start);

  const out: Array<{ appt: ScheduleAppt; col: number; cols: number; start: number; end: number }> = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;

  const flush = () => {
    const cols = cluster.reduce((m, x) => Math.max(m, x.col + 1), 0);
    cluster.forEach((x) => { x.cols = cols; });
    out.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };

  for (const s of spans) {
    if (cluster.length && s.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((x) => x.end > s.start).map((x) => x.col));
    let col = 0; while (taken.has(col)) col += 1;
    cluster.push({ ...s, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  if (cluster.length) flush();
  return out;
}

interface Props {
  /** Day currently targeted by the partial-block form below the calendar. */
  selectedDay: string;
  onPickDay: (iso: string) => void;
}

export function ScheduleCalendar({ selectedDay, onPickDay }: Props) {
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const today = isoLocalDate(new Date());

  // Visible range for the current view.
  const { days, rangeStart, rangeEnd, title } = useMemo(() => {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      return {
        days: [] as Date[], rangeStart: first, rangeEnd: last,
        title: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      };
    }
    const count = view === 'week' ? 7 : view === '3day' ? 3 : 1;
    const start = view === 'week' ? startOfWeek(anchor) : new Date(anchor);
    const list = Array.from({ length: count }, (_, i) => addDays(start, i));
    const end = list[list.length - 1];
    const label = count === 1
      ? start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
      : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return { days: list, rangeStart: start, rangeEnd: end, title: label };
  }, [view, anchor]);

  const sched = useSchedule(rangeStart, rangeEnd);

  // Bookings inside the visible range (drives the "N bookings in view" counter).
  const visibleAppts = useMemo(() => {
    if (view === 'month') {
      const mk = monthKey(rangeStart);
      return sched.appts.filter((a) => a.appt_date.startsWith(mk));
    }
    const set = new Set(days.map(isoLocalDate));
    return sched.appts.filter((a) => set.has(a.appt_date));
  }, [sched.appts, days, view, rangeStart]);

  // Grid hour span: default working window, widened to fit anything booked outside it.
  const { startHour, endHour } = useMemo(() => {
    let lo = DEFAULT_START_HOUR, hi = DEFAULT_END_HOUR;
    for (const a of visibleAppts) {
      const s = hmToMin(a.appt_time);
      const e = s + (Number(a.duration_min) || 60);
      lo = Math.min(lo, Math.floor(s / 60));
      hi = Math.max(hi, Math.ceil(e / 60));
    }
    return { startHour: Math.max(0, lo), endHour: Math.min(24, Math.max(hi, lo + 4)) };
  }, [visibleAppts]);

  function shift(delta: number) {
    setAnchor((d) => {
      if (view === 'month') return new Date(d.getFullYear(), d.getMonth() + delta, 1);
      const step = view === 'week' ? 7 : view === '3day' ? 3 : 1;
      return addDays(d, delta * step);
    });
  }

  const viewBtn = (v: CalendarView, label: string, Icon: typeof CalendarDays) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      class={'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors '
        + (view === v
          ? 'bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-accent)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]')}
    >
      <Icon size={12} /> {label}
    </button>
  );

  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div class="flex items-center gap-2">
          <CalendarClock size={16} class="text-[var(--color-accent)]" />
          <div>
            <h3 class="text-[14px] font-semibold text-[var(--color-text)]">{title}</h3>
            <div class="text-[11px] text-[var(--color-text-faint)]">
              {visibleAppts.length} booking{visibleAppts.length === 1 ? '' : 's'} in view
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1">
          {viewBtn('month', 'Month', CalendarDays)}
          {viewBtn('week', 'Week', CalendarRange)}
          {viewBtn('3day', '3 days', Columns3)}
          {viewBtn('day', 'Day', Square)}
          <div class="ml-2 flex items-center gap-1">
            <button type="button" title="Previous" onClick={() => shift(-1)}
              class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]">‹</button>
            <button type="button" onClick={() => setAnchor(new Date())}
              class="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]">Today</button>
            <button type="button" title="Next" onClick={() => shift(1)}
              class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]">›</button>
          </div>
        </div>
      </div>

      {view === 'month'
        ? <MonthGrid anchor={anchor} sched={sched} selectedDay={selectedDay} onPickDay={onPickDay} today={today} />
        : <TimeGrid days={days} sched={sched} startHour={startHour} endHour={endHour} selectedDay={selectedDay} onPickDay={onPickDay} today={today} />}

      <div class="mt-2 text-[11px] text-[var(--color-text-faint)]">
        <span style="color:var(--color-accent)">▌</span> confirmed ·
        <span style="color:var(--color-warn)"> ▌</span> requested ·
        <span style="color:var(--color-status-failed)"> OFF</span> day off · ◐ partial block ·
        tap a day to target the partial-block form below
      </div>
    </section>
  );
}

// ── Month view — the original dot grid, kept intact so the tap-to-target
//    workflow and its muscle memory don't change.
function MonthGrid({ anchor, sched, selectedDay, onPickDay, today }: {
  anchor: Date; sched: ReturnType<typeof useSchedule>; selectedDay: string; onPickDay: (iso: string) => void; today: string;
}) {
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const monthStr = monthKey(anchor);
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const partialDays = new Set(sched.timeBlocks.map((t) => t.day));

  return (
    <div class="grid grid-cols-7 gap-1 text-center">
      {DAY_NAMES.map((d) => <div key={d} class="text-[11px] font-semibold text-[var(--color-text-faint)]">{d}</div>)}
      {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
      {Array.from({ length: daysInMonth }).map((_, i) => {
        const day = i + 1;
        const iso = `${monthStr}-${String(day).padStart(2, '0')}`;
        const appts = sched.byDay[iso] || [];
        const off = sched.blackouts.has(iso);
        const partial = partialDays.has(iso);
        const cls = 'flex h-12 flex-col items-center justify-start rounded-md border p-1 text-[12px] transition-colors '
          + (off ? 'bg-[color-mix(in_srgb,var(--color-status-failed)_18%,transparent)] '
            : appts.length ? 'bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] '
            : 'hover:bg-[var(--color-elevated)] ')
          + (selectedDay === iso ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)] ' : 'border-[var(--color-border)] ');
        const title = off ? 'Day off'
          : appts.length ? appts.map((a) => `${a.appt_time} ${a.client_name} (${a.status})`).join('\n')
          : partial ? 'Partial block' : '';
        return (
          <button key={iso} type="button" class={cls} title={title} onClick={() => onPickDay(iso)}>
            <span class={iso === today ? 'font-bold text-[var(--color-accent)]' : 'text-[var(--color-text)]'}>{day}</span>
            {off ? <span class="text-[10px] font-semibold text-[var(--color-status-failed)]">OFF</span>
              : appts.length ? <span class="mt-0.5 text-[11px] font-semibold text-[var(--color-accent)]">●{appts.length}</span>
              : partial ? <span class="mt-0.5 text-[11px] text-[var(--color-text-muted)]">◐</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Week / 3-day / Day — bookings positioned against the clock.
function TimeGrid({ days, sched, startHour, endHour, selectedDay, onPickDay, today }: {
  days: Date[]; sched: ReturnType<typeof useSchedule>; startHour: number; endHour: number;
  selectedDay: string; onPickDay: (iso: string) => void; today: string;
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = hours.length * HOUR_PX;
  const topFor = (min: number) => ((min - startHour * 60) / 60) * HOUR_PX;
  const blocksByDay: Record<string, ScheduleTimeBlock[]> = {};
  sched.timeBlocks.forEach((b) => { (blocksByDay[b.day] ??= []).push(b); });

  // Current-time marker, only when today is on screen.
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowVisible = nowMin >= startHour * 60 && nowMin <= endHour * 60;

  return (
    <div class="overflow-x-auto">
      <div class="min-w-[560px]">
        {/* Day headers */}
        <div class="flex border-b border-[var(--color-border)]">
          <div class="w-14 shrink-0 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Time</div>
          {days.map((d) => {
            const iso = isoLocalDate(d);
            const off = sched.blackouts.has(iso);
            const isToday = iso === today;
            return (
              <button key={iso} type="button" onClick={() => onPickDay(iso)}
                class={'flex-1 border-l border-[var(--color-border)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-elevated)] '
                  + (selectedDay === iso ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : '')}>
                <div class="flex items-baseline gap-1.5">
                  <span class={'text-[12px] font-medium ' + (isToday ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]')}>
                    {DAY_NAMES[d.getDay()]}
                  </span>
                  <span class={'text-[13px] font-semibold tabular-nums ' + (isToday
                    ? 'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-white'
                    : 'text-[var(--color-text)]')}
                    style={isToday ? 'background:var(--color-accent)' : ''}>
                    {d.getDate()}
                  </span>
                  {off && <span class="text-[10px] font-semibold text-[var(--color-status-failed)]">OFF</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Hour rows + positioned bookings */}
        <div class="relative flex" style={`height:${gridHeight}px`}>
          <div class="w-14 shrink-0">
            {hours.map((h) => (
              <div key={h} class="relative" style={`height:${HOUR_PX}px`}>
                <span class="absolute -top-1.5 right-2 text-[10px] tabular-nums text-[var(--color-text-faint)]">{minToLabel(h * 60)}</span>
              </div>
            ))}
          </div>

          {days.map((d) => {
            const iso = isoLocalDate(d);
            const off = sched.blackouts.has(iso);
            const placed = layout(sched.byDay[iso] || []);
            return (
              <div key={iso}
                class={'relative flex-1 border-l border-[var(--color-border)] ' + (off ? 'bg-[color-mix(in_srgb,var(--color-status-failed)_9%,transparent)]' : '')}>
                {/* hour lines */}
                {hours.map((h) => (
                  <div key={h} class="border-b border-[var(--color-border)] opacity-40" style={`height:${HOUR_PX}px`} />
                ))}

                {/* partial blocks (unavailable windows) */}
                {(blocksByDay[iso] || []).map((b) => {
                  const s = hmToMin(b.start_hm), e = hmToMin(b.end_hm);
                  return (
                    <div key={b.id} title={`Blocked ${b.start_hm}–${b.end_hm}`}
                      class="absolute inset-x-1 rounded-sm"
                      style={`top:${topFor(s)}px;height:${Math.max(8, ((e - s) / 60) * HOUR_PX)}px;background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--color-text-faint) 22%,transparent) 0 6px,transparent 6px 12px)`} />
                  );
                })}

                {/* bookings */}
                {placed.map(({ appt, col, cols, start, end }) => {
                  const tone = statusTone(appt.status);
                  const w = 100 / cols;
                  const height = Math.max(22, ((end - start) / 60) * HOUR_PX - 3);
                  return (
                    <div key={appt.id}
                      title={`${prettyTime(appt.appt_time)} · ${appt.client_name} · ${appt.service_name} (${tone.label})`}
                      class="absolute overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-left shadow-sm"
                      style={`top:${topFor(start)}px;height:${height}px;left:calc(${col * w}% + 2px);width:calc(${w}% - 4px);border-left:3px solid ${tone.bar}`}>
                      <div class="truncate text-[11px] font-semibold leading-tight text-[var(--color-text)]">{appt.client_name}</div>
                      {height > 34 && <div class="truncate text-[10px] leading-tight text-[var(--color-text-muted)]">{appt.service_name}</div>}
                      {height > 48 && (
                        <div class="truncate text-[10px] leading-tight tabular-nums" style={`color:${tone.text}`}>
                          {prettyTime(appt.appt_time)}–{prettyTime(minToLabel(end))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* now marker */}
                {iso === today && nowVisible && (
                  <div class="pointer-events-none absolute inset-x-0 z-10" style={`top:${topFor(nowMin)}px`}>
                    <div class="h-px w-full" style="background:var(--color-status-failed)" />
                    <div class="absolute -left-0.5 -top-[3px] h-1.5 w-1.5 rounded-full" style="background:var(--color-status-failed)" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
