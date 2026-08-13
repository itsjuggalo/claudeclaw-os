import { Link, useLocation } from 'wouter-preact';
import { Search, ChevronDown, ChevronRight, X, Cpu, Monitor, Smartphone, PanelLeftClose, PanelLeftOpen } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ROUTES, SECTION_LABEL, type RouteDef, type RouteSection } from '@/lib/routes';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { Toggle } from './Toggle';
import { viewMode, setViewMode } from '@/lib/view-mode';
import { commandPaletteOpen } from '@/lib/command-palette';
import { chatUnread } from '@/lib/chat-stream';
import { invalidateFetchCache, useFetch } from '@/lib/useFetch';
import { modelLabel } from '@/lib/modelLabels';
import { prefetchPage } from '@/lib/page-loaders';
import { apiPatch } from '@/lib/api';
import { pushToast } from '@/lib/toasts';
import { sidebarOpen, closeSidebar } from '@/lib/sidebar';
import {
  collapsedSections,
  toggleSectionCollapsed,
  runtimeDetailsCollapsed,
  toggleRuntimeDetailsCollapsed,
  workspaceName,
  modKeyLabel,
} from '@/lib/personalization';

const SECTIONS: RouteSection[] = ['workspace', 'trade', 'studio', 'intelligence', 'collaborate', 'massage', 'mc', 'mcctrl', 'system'];
const SIDEBAR_COLLAPSED_KEY = 'claudeclaw.sidebar.nav.collapsed';

export function Sidebar() {
  const [pathname] = useLocation();
  const routePathname = pathname.split(/[?#]/)[0] || '/';
  const modLabel = modKeyLabel();
  const open = sidebarOpen.value;

  // Only show routes where inSidebar is not explicitly false.
  const sidebarRoutes = ROUTES.filter((r) => r.inSidebar !== false);
  const liveSections = SECTIONS.filter((s) => sidebarRoutes.some((r) => r.section === s));
  const matchedRoute = findActiveRoute(routePathname, sidebarRoutes);
  const [selectedSection, setSelectedSection] = useState<RouteSection>(() => matchedRoute?.section ?? liveSections[0] ?? 'workspace');
  // Flyout sub-nav: which section's secondary panel is revealed (null = hidden).
  // Hidden by default; a section click reveals it as an overlay over the board.
  const [flyoutSection, setFlyoutSection] = useState<RouteSection | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'closed'; } catch { return false; }
  });
  const activePath = matchedRoute?.path;

  useEffect(() => {
    const next = findActiveRoute(routePathname, sidebarRoutes)?.section;
    if (next) setSelectedSection(next);
    // Navigating dismisses the flyout overlay so the board is unobstructed.
    setFlyoutSection(null);
  }, [routePathname]);

  // Flyout is only visible while the nav is expanded — it collapses and
  // re-expands together with the rest of the sidebar (flyoutSection is kept
  // through a collapse, so expanding restores it).
  const flyoutOpen = !navCollapsed && flyoutSection !== null;

  useEffect(() => {
    if (!flyoutOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFlyoutSection(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flyoutOpen]);

  // Mobile: fixed drawer that slides in from the left. Desktop (>=md):
  // always-visible inline two-panel navigation.
  const shellClass = [
    'flex h-screen max-w-[calc(100vw-20px)] bg-[var(--color-sidebar)]',
    'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200',
    open ? 'translate-x-0' : '-translate-x-full',
    // md:relative (not static) so the absolutely-positioned flyout overlay
    // anchors to the sidebar shell and floats over the board on desktop.
    'md:relative md:translate-x-0 md:max-w-none md:shrink-0',
  ].join(' ');
  const secondaryItems = sidebarRoutes.filter((r) => r.section === selectedSection);
  const primaryWidthClass = navCollapsed ? 'w-[64px] md:w-[68px]' : 'w-[210px] md:w-[224px]';

  function setNavCollapsedPersisted(next: boolean) {
    setNavCollapsed(next);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? 'closed' : 'open'); } catch {}
  }

  function selectSection(section: RouteSection) {
    setSelectedSection(section);
    if (navCollapsed) {
      // Expand the rail and reveal this section's flyout in one click.
      setNavCollapsedPersisted(false);
      setFlyoutSection(section);
    } else {
      // Toggle: clicking the open section again hides the flyout.
      setFlyoutSection((prev) => (prev === section ? null : section));
    }
  }

  function closeFlyout() {
    setFlyoutSection(null);
  }

  return (
    <div class={shellClass}>
      <aside class={`relative flex h-screen shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)] transition-[width] duration-200 ${primaryWidthClass}`}>
        <div class={navCollapsed ? 'px-2 pt-3 pb-1' : 'px-3 pt-3 pb-1'}>
          <button
            type="button"
            onClick={() => setNavCollapsedPersisted(!navCollapsed)}
            title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!navCollapsed}
            class={[
              'flex items-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]',
              navCollapsed ? 'h-9 w-full justify-center' : 'h-9 w-full gap-2 px-2 pr-8 md:pr-2',
            ].join(' ')}
          >
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!navCollapsed && <span class="text-[12.5px] font-medium">Collapse nav</span>}
          </button>
        </div>

        {!navCollapsed && <WorkspaceSwitcher />}

        {/* Mobile-only close button. Inline-flex with absolute position so
         *  it doesn't disturb the existing header layout. */}
        <button
          type="button"
          onClick={closeSidebar}
          class="md:hidden absolute top-3 right-3 p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>

        {/* Flag a UI issue — opens the markup overlay (draw on the problem + note). */}
        <button
          type="button"
          onClick={() => {
            const w = window as unknown as { __annotateOverlay?: { toggle: () => void } };
            if (w.__annotateOverlay) w.__annotateOverlay.toggle();
            else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true }));
            closeSidebar();
          }}
          title="Flag a UI issue — draw on the problem + add a note"
          class={[
            'mt-1 mb-1 flex items-center rounded-md text-[13px] font-semibold border border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)] hover:opacity-90 transition-colors',
            navCollapsed ? 'mx-2 justify-center px-2 py-2' : 'mx-3 gap-2 px-3 py-2',
          ].join(' ')}
        >
          <span class="text-[15px] leading-none">🖍</span>
          {!navCollapsed && <span>Flag Issue</span>}
        </button>

        <div class={navCollapsed ? 'mx-2 mt-1 mb-2' : 'mx-3 mt-1 mb-2'}>
          <button
            type="button"
            onClick={() => { commandPaletteOpen.value = true; closeSidebar(); }}
            title="Search"
            class={[
              'w-full flex items-center rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors text-[13px]',
              navCollapsed ? 'justify-center px-2 py-2' : 'gap-2 px-3 py-2',
            ].join(' ')}
          >
            <Search size={15} />
            {!navCollapsed && (
              <>
                <span>Search</span>
                <span class="ml-auto text-[10.5px] text-[var(--color-text-faint)]">{modLabel}K</span>
              </>
            )}
          </button>
        </div>

        <nav class="flex-1 overflow-y-auto px-2 pb-3" aria-label="Primary navigation">
          {!navCollapsed && <div class="section-label px-2.5 py-1.5">Sections</div>}
          {liveSections.map((section) => {
            const items = sidebarRoutes.filter((r) => r.section === section);
            const current = matchedRoute?.section === section;
            const selected = selectedSection === section;
            const expanded = flyoutOpen && flyoutSection === section;
            const SectionIcon = items[0]?.icon;
            const itemClass = [
              'relative mt-1 flex w-full items-center rounded-md text-left text-[13.5px] transition-colors',
              navCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2',
              selected
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]',
            ].join(' ');
            return (
              <button
                key={section}
                type="button"
                onClick={() => selectSection(section)}
                onMouseEnter={() => items.forEach((r) => { if (!r.href) prefetchPage(r.path); })}
                class={itemClass}
                title={SECTION_LABEL[section]}
                aria-pressed={selected}
                aria-expanded={expanded}
                aria-current={current ? 'true' : undefined}
              >
                {SectionIcon ? <SectionIcon size={16} /> : null}
                {!navCollapsed && <span class="min-w-0 flex-1 truncate">{SECTION_LABEL[section]}</span>}
                {current ? (
                  <span class={navCollapsed ? 'absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]' : 'h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]'} />
                ) : null}
                {!navCollapsed && (
                  <ChevronRight
                    size={14}
                    class="shrink-0 text-[var(--color-text-faint)] transition-transform duration-200"
                    style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {!navCollapsed && <SidebarFooter />}
      </aside>

      {flyoutOpen && (
        <>
          {/* Click-away catcher — covers the board area only (starts at the
           *  rail's right edge) so section buttons stay clickable to switch. */}
          <div
            class="fixed inset-y-0 right-0 left-[210px] z-30 md:left-[224px]"
            onClick={closeFlyout}
            aria-hidden="true"
          />
          {/* Flyout overlay — floats over the board immediately right of the
           *  rail (anchored to the md:relative shell). Board does not resize. */}
          <div class="absolute left-full top-0 z-40 flex h-screen shadow-2xl">
            <aside
              class="flex h-screen w-[260px] min-w-[230px] max-w-[360px] shrink-0 resize-x flex-col overflow-hidden border-r border-[var(--color-border)] transition-[width,opacity] duration-200 md:w-[280px]"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-sidebar) 88%, var(--color-bg))' }}
            >
              <div class="border-b border-[var(--color-border)] px-4 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="section-label">Selected</div>
                    <div class="mt-1 truncate text-[14px] font-semibold text-[var(--color-text)]">{SECTION_LABEL[selectedSection]}</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeFlyout}
                    title="Close panel (Esc)"
                    aria-label="Close panel"
                    class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
              <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label={`${SECTION_LABEL[selectedSection]} navigation`}>
                {secondaryItems.map((r) => (
                  <SidebarRouteLink key={r.path} route={r} active={activePath === r.path} onNavigate={closeFlyout} />
                ))}
              </nav>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarRouteLink({ route, active, onNavigate }: { route: RouteDef; active: boolean; onNavigate?: () => void }) {
  const Icon = route.icon;
  const unread = route.path === '/chat' ? chatUnread.value : 0;
  const itemClass = [
    'mb-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-[14px] transition-colors',
    active
      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]',
  ].join(' ');
  const inner = (
    <>
      <Icon size={16} />
      <span class="min-w-0 flex-1 truncate">{route.label}</span>
      {unread > 0 && (
        <span class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10.5px] font-semibold tabular-nums text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      {route.href && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity:0.4;flex-shrink:0">
          <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7 1h4m0 0v4m0-4L5 7"/>
        </svg>
      )}
    </>
  );
  const resolvedHref = route.href?.startsWith('self:')
    ? `${location.protocol}//${location.hostname}:${route.href.slice(5)}`
    : route.href;

  return route.href ? (
    <a href={resolvedHref} target="_blank" rel="noopener noreferrer" class={itemClass}>
      {inner}
    </a>
  ) : (
    <Link
      href={route.path}
      onClick={() => { closeSidebar(); onNavigate?.(); }}
      onMouseEnter={() => prefetchPage(route.path)}
      onFocus={() => prefetchPage(route.path)}
      class={itemClass}
    >
      {inner}
    </Link>
  );
}

function findActiveRoute(pathname: string, routes: RouteDef[]): RouteDef | undefined {
  const normalized = pathname === '/' ? '/mission' : pathname;
  const exact = routes.find((r) => r.path === normalized);
  if (exact) return exact;
  return routes
    .filter((r) => normalized.startsWith(r.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

interface Health {
  killSwitches: Record<string, boolean>;
  uptimeSeconds?: number;
}

interface ProviderStatus {
  providerType: 'claude' | 'opencode' | 'openrouter' | 'gemini' | 'acp-codex' | 'openai' | 'acp';
  label: string;
  model: string;
  runtime: string;
  // Short reasoning descriptor (e.g. "high", "off"). Empty when the model uses
  // adaptive thinking and exposes no dial.
  reasoning?: string;
}

// "2d 4h", "3h 12m", "18m", "42s" — two units max, coarse-first.
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function SidebarFooter() {
  const health = useFetch<Health>('/api/health', 30_000);
  const provider = useFetch<ProviderStatus>('/api/provider/status', 15_000);
  const switches = health.data?.killSwitches || {};
  const off = Object.entries(switches).filter(([, on]) => !on);
  const anyOff = off.length > 0;
  const name = workspaceName.value;
  const providerName = provider.data?.label ?? 'Claude';
  const modelName = modelLabel(provider.data?.model ?? 'claude-opus-4-8');
  const reasoning = provider.data?.reasoning?.trim();
  // Combine model + thinking as "Opus 4.8 (high)". Omit the clause for models
  // that expose no dial (adaptive thinking).
  const modelWithReasoning = reasoning ? `${modelName} (${reasoning})` : modelName;
  const collapsed = runtimeDetailsCollapsed.value;

  // The /api/health poll only refreshes every 30s, so the raw uptime sits
  // frozen between polls. Anchor the last server value to the moment it landed
  // and advance it locally on a 30s tick so the line reads as live.
  const rawUptime = health.data?.uptimeSeconds;
  const anchor = useRef<{ base: number; at: number } | null>(null);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (rawUptime == null) return;
    anchor.current = { base: rawUptime, at: Date.now() };
    forceTick((n) => n + 1);
  }, [rawUptime]);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const liveUptime = anchor.current
    ? anchor.current.base + Math.floor((Date.now() - anchor.current.at) / 1000)
    : null;
  const uptime = liveUptime != null ? formatUptime(liveUptime) : null;

  return (
    <div class="border-t border-[var(--color-border)]">
      {/* The block navigates to Settings (where provider/model are configured).
       *  The collapse chevron is an absolutely-positioned sibling — not nested
       *  inside the <a> — so toggling details never triggers navigation and the
       *  markup stays valid. */}
      <div class="relative">
        <Link
          href="/settings"
          aria-label="Active runtime"
          title="Provider and model are configured under Agents or Settings"
          class="block px-3 py-3 hover:bg-[var(--color-elevated)] transition-colors"
        >
          {/* Identity header: the Cpu icon replaces the old status dot and
           *  carries the kill-switch signal via its tint. Right padding leaves
           *  room for the collapse chevron. */}
          <div class="flex items-center gap-2.5 pr-6">
            <div
              class="h-8 w-8 shrink-0 rounded-md border border-[var(--color-border)] flex items-center justify-center"
              style={{
                backgroundColor: anyOff
                  ? 'color-mix(in srgb, var(--color-status-failed) 18%, transparent)'
                  : 'var(--color-elevated)',
                color: anyOff ? 'var(--color-status-failed)' : 'var(--color-text-muted)',
              }}
            >
              <Cpu size={14} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[12.5px] font-medium text-[var(--color-text)] truncate">{name}</div>
              <div class="truncate text-[11px] text-[var(--color-text-faint)]">
                {anyOff
                  ? off.length + ' kill switch' + (off.length === 1 ? '' : 'es') + ' off'
                  : 'All systems normal'}
              </div>
            </div>
          </div>

          {!collapsed && (
            <>
              <div class="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-[11px] leading-none">
                <span class="text-[var(--color-text-faint)]">Runtime</span>
                <span class="min-w-0 max-w-[160px] truncate text-right font-medium text-[var(--color-text-muted)]" title={providerName}>
                  {providerName}
                </span>
              </div>
              <div class="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-[11px] leading-none">
                <span class="text-[var(--color-text-faint)]">Model</span>
                <span class="min-w-0 max-w-[160px] truncate text-right font-medium text-[var(--color-text-muted)]" title={modelWithReasoning}>
                  {modelWithReasoning}
                </span>
              </div>
              {uptime && (
                <div class="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-[11px] leading-none">
                  <span class="text-[var(--color-text-faint)]">Uptime</span>
                  <span class="font-medium tabular-nums text-[var(--color-text-muted)]">{uptime}</span>
                </div>
              )}
            </>
          )}
        </Link>

        <button
          type="button"
          onClick={toggleRuntimeDetailsCollapsed}
          class="absolute top-3 right-2 p-1 rounded-md text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
          aria-label={collapsed ? 'Show runtime details' : 'Hide runtime details'}
          aria-expanded={!collapsed}
        >
          <ChevronDown
            size={14}
            class="transition-transform"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          />
        </button>
      </div>

      {/* Local: desktop-view override. Always rendered — never gate this on a
          breakpoint: forcing desktop makes `md:` match and a breakpoint-hidden
          toggle would strand the user in desktop view. No-op on real desktops. */}
      <div class="px-3 py-2.5 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
          {viewMode.value === 'desktop' ? <Monitor size={14} /> : <Smartphone size={14} />}
          <span>Desktop view</span>
        </div>
        <Toggle
          size="sm"
          on={viewMode.value === 'desktop'}
          onChange={() => setViewMode(viewMode.value === 'desktop' ? 'auto' : 'desktop')}
          ariaLabel="Toggle desktop view"
        />
      </div>
    </div>
  );
}
