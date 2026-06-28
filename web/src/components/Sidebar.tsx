import { Link, useLocation, useSearch } from 'wouter-preact';
import { Search, ChevronDown, ChevronRight, X, Monitor, Smartphone, PanelLeftClose, PanelLeftOpen, Database, DatabaseZap, ShieldCheck } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ROUTES, SECTION_LABEL, type RouteDef, type RouteSection } from '@/lib/routes';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { Toggle } from './Toggle';
import { viewMode, setViewMode } from '@/lib/view-mode';
import { commandPaletteOpen } from '@/lib/command-palette';
import { chatUnread } from '@/lib/chat-stream';
import { invalidateFetchCache, useFetch } from '@/lib/useFetch';
import { apiPatch } from '@/lib/api';
import { pushToast } from '@/lib/toasts';
import { sidebarOpen, closeSidebar } from '@/lib/sidebar';
import {
  workspaceName,
  modKeyLabel,
} from '@/lib/personalization';

const SECTIONS: RouteSection[] = ['workspace', 'studio', 'intelligence', 'trade', 'lewis', 'collaborate', 'system', 'mc', 'mcctrl', 'ops', 'wellness'];
const RUNTIME_PANEL_KEY = 'claudeclaw.sidebar.runtime.expanded';
const SIDEBAR_COLLAPSED_KEY = 'claudeclaw.sidebar.nav.collapsed';
const SQL_DB_NAV_KEY = 'claudeclaw.sidebar.sqlDatabases.expanded';
const SQL_DB_GROUPS_KEY = 'claudeclaw.sidebar.sqlDatabases.groups';

export function Sidebar() {
  const [pathname] = useLocation();
  const search = useSearch();
  const routePathname = pathname.split(/[?#]/)[0] || '/';
  const modLabel = modKeyLabel();
  const open = sidebarOpen.value;

  // Only show routes where inSidebar is not explicitly false.
  const sidebarRoutes = ROUTES.filter((r) => r.inSidebar !== false);
  const liveSections = SECTIONS.filter((s) => sidebarRoutes.some((r) => r.section === s));
  const matchedRoute = findActiveRoute(routePathname, sidebarRoutes);
  const [selectedSection, setSelectedSection] = useState<RouteSection>(() => matchedRoute?.section ?? liveSections[0] ?? 'workspace');
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'closed'; } catch { return false; }
  });
  const [sqlPanelOpen, setSqlPanelOpen] = useState(() => {
    try { return localStorage.getItem(SQL_DB_NAV_KEY) !== 'closed'; } catch { return true; }
  });
  const activePath = matchedRoute?.path;
  const activeSqlDbId = routePathname === '/sql-monitor' ? getSqlDbIdFromSearch(search) : null;

  useEffect(() => {
    const next = findActiveRoute(routePathname, sidebarRoutes)?.section;
    if (next) setSelectedSection(next);
  }, [routePathname]);

  // Mobile: fixed drawer that slides in from the left. Desktop (>=md):
  // always-visible inline two-panel navigation.
  const shellClass = [
    'flex h-screen max-w-[calc(100vw-20px)] bg-[var(--color-sidebar)]',
    'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200',
    open ? 'translate-x-0' : '-translate-x-full',
    'md:static md:translate-x-0 md:max-w-none md:shrink-0',
  ].join(' ');
  const secondaryItems = sidebarRoutes.filter((r) => r.section === selectedSection);
  const primaryWidthClass = navCollapsed ? 'w-[64px] md:w-[68px]' : 'w-[210px] md:w-[224px]';
  const showSqlPanel = !navCollapsed && selectedSection === 'intelligence' && sqlPanelOpen;

  function setNavCollapsedPersisted(next: boolean) {
    setNavCollapsed(next);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? 'closed' : 'open'); } catch {}
  }

  function selectSection(section: RouteSection) {
    setSelectedSection(section);
    if (navCollapsed) setNavCollapsedPersisted(false);
  }

  function setSqlPanelOpenPersisted(next: boolean) {
    setSqlPanelOpen(next);
    try { localStorage.setItem(SQL_DB_NAV_KEY, next ? 'open' : 'closed'); } catch {}
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
                class={itemClass}
                title={SECTION_LABEL[section]}
                aria-pressed={selected}
                aria-current={current ? 'true' : undefined}
              >
                {SectionIcon ? <SectionIcon size={16} /> : null}
                {!navCollapsed && <span class="min-w-0 flex-1 truncate">{SECTION_LABEL[section]}</span>}
                {current ? (
                  <span class={navCollapsed ? 'absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]' : 'h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]'} />
                ) : null}
                {!navCollapsed && <ChevronRight size={14} class="shrink-0 text-[var(--color-text-faint)]" />}
              </button>
            );
          })}
        </nav>

        {!navCollapsed && <SidebarFooter />}
      </aside>

      {!navCollapsed && (
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
              {selectedSection === 'intelligence' && (
                <button
                  type="button"
                  onClick={() => setSqlPanelOpenPersisted(!sqlPanelOpen)}
                  title={sqlPanelOpen ? 'Hide SQL databases panel' : 'Show SQL databases panel'}
                  aria-label={sqlPanelOpen ? 'Hide SQL databases panel' : 'Show SQL databases panel'}
                  aria-pressed={sqlPanelOpen}
                  class={[
                    'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors',
                    sqlPanelOpen
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]',
                  ].join(' ')}
                >
                  <DatabaseZap size={13} />
                  <span>SQL</span>
                </button>
              )}
            </div>
          </div>
          <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label={`${SECTION_LABEL[selectedSection]} navigation`}>
            {secondaryItems.map((r) => (
              <SidebarRouteLink key={r.path} route={r} active={activePath === r.path} />
            ))}
          </nav>
        </aside>
      )}

      {showSqlPanel && (
        <aside
          class="flex h-screen w-[280px] min-w-[240px] max-w-[380px] shrink-0 resize-x flex-col overflow-hidden border-r border-[var(--color-border)] transition-[width,opacity] duration-200 md:w-[300px]"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-sidebar) 82%, var(--color-bg))' }}
        >
          <SqlDatabasesPanel activeDbId={activeSqlDbId} onClose={() => setSqlPanelOpenPersisted(false)} />
        </aside>
      )}
    </div>
  );
}

interface SqlNavDbInfo {
  id: string;
  label: string;
  subtitle?: string;
  writable?: boolean;
  live?: boolean;
  stale?: boolean;
  size?: string;
}

interface SqlNavGroup {
  id: string;
  label: string;
  items: SqlNavDbInfo[];
}

interface SqlNavCatalog {
  groups: SqlNavGroup[];
}

function SqlDatabasesPanel({ activeDbId, onClose }: { activeDbId: string | null; onClose: () => void }) {
  const catalog = useFetch<SqlNavCatalog>('/api/sql', 30_000);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(SQL_DB_GROUPS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { apps: true, pipeline: true, state: false, tooling: false, internals: false };
  });

  function setGroupOpen(groupId: string, next: boolean) {
    const nextGroups = { ...openGroups, [groupId]: next };
    setOpenGroups(nextGroups);
    try { localStorage.setItem(SQL_DB_GROUPS_KEY, JSON.stringify(nextGroups)); } catch {}
  }

  const groups = catalog.data?.groups.filter((g) => g.items.length > 0) ?? [];

  return (
    <>
      <div class="border-b border-[var(--color-border)] px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="section-label">Database rail</div>
            <div class="mt-1 flex items-center gap-2 truncate text-[14px] font-semibold text-[var(--color-text)]">
              <DatabaseZap size={15} class="shrink-0 text-[var(--color-accent)]" />
              <span class="truncate">SQL databases</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Hide SQL databases panel"
            aria-label="Hide SQL databases panel"
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label="SQL database navigation">
        {catalog.loading && !catalog.data && (
          <div class="px-3 py-2 text-[12px] text-[var(--color-text-faint)]">Loading databases...</div>
        )}
        {catalog.error && (
          <div class="px-3 py-2 text-[11px] text-[var(--color-status-failed)]">SQL catalog unavailable</div>
        )}
        {groups.map((group) => {
          const groupOpen = openGroups[group.id] ?? (group.id === 'apps' || group.id === 'pipeline');
          return (
            <div key={group.id} class="mt-1">
              <button
                type="button"
                onClick={() => setGroupOpen(group.id, !groupOpen)}
                class="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-[11px] font-semibold uppercase text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text-muted)]"
                aria-expanded={groupOpen}
              >
                {groupOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span class="min-w-0 flex-1 truncate">{group.label}</span>
                <span class="font-mono font-normal">{group.items.length}</span>
              </button>
              {groupOpen && (
                <div class="mt-0.5">
                  {group.items.map((db) => (
                    <Link
                      key={db.id}
                      href={`/sql-monitor?db=${encodeURIComponent(db.id)}`}
                      onClick={closeSidebar}
                      class={[
                        'mb-0.5 flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] transition-colors',
                        activeDbId === db.id
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]',
                      ].join(' ')}
                      title={db.subtitle || db.label}
                    >
                      <Database size={13} class="shrink-0" />
                      <span class="min-w-0 flex-1 truncate">{db.label}</span>
                      {db.writable && <ShieldCheck size={11} class="shrink-0 text-[var(--color-accent)]" />}
                      {db.live && !db.stale && <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-status-done)]" title="Live" />}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function SidebarRouteLink({ route, active }: { route: RouteDef; active: boolean }) {
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
    <Link href={route.path} onClick={closeSidebar} class={itemClass}>
      {inner}
    </Link>
  );
}

function getSqlDbIdFromSearch(search: string): string | null {
  try { return new URLSearchParams(search).get('db'); } catch { return null; }
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
}

interface ProviderStatus {
  providerType: 'claude' | 'opencode' | 'openrouter' | 'gemini' | 'codex' | 'acp';
  label: string;
  model: string;
  runtime: string;
  acpEnabled?: boolean;
}

function SidebarFooter() {
  const health = useFetch<Health>('/api/health', 30_000);
  const provider = useFetch<ProviderStatus>('/api/provider/status', 15_000);
  const [switching, setSwitching] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(RUNTIME_PANEL_KEY) === 'open'; } catch { return false; }
  });
  const switches = health.data?.killSwitches || {};
  const off = Object.entries(switches).filter(([, on]) => !on);
  const anyOff = off.length > 0;
  const name = workspaceName.value;
  const providerType = provider.data?.providerType ?? 'claude';
  const acpEnabled = provider.data?.acpEnabled ?? false;

  async function switchProvider(nextType: string) {
    if (nextType === providerType || switching) return;
    setSwitching(true);
    try {
      // OpenRouter (and other non-Claude providers) switch with just { type };
      // the backend applies its single DEFAULT_OPENROUTER_MODEL default and the
      // user picks a specific model from the live list in Settings.
      const nextProvider = nextType === 'claude'
        ? { type: 'claude', model: 'claude-opus-4-8' }
        : { type: nextType };
      await apiPatch('/api/agents/main/provider', { provider: nextProvider });
      invalidateFetchCache('/api/provider/status');
      invalidateFetchCache('/api/health');
      invalidateFetchCache('/api/agents');
      provider.refresh();
      health.refresh();
      pushToast({
        tone: 'success',
        title: 'Provider set to ' + providerLabel(nextType),
        description: providerDescription(nextType),
      });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Provider change failed', description: err?.message || String(err), durationMs: 7000 });
    } finally {
      setSwitching(false);
    }
  }

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(RUNTIME_PANEL_KEY, next ? 'open' : 'closed'); } catch {}
  }

  return (
    <div class="border-t border-[var(--color-border)]">
      <button
        type="button"
        onClick={toggleExpanded}
        class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
        aria-expanded={expanded}
      >
        <ChevronDown
          size={14}
          class="shrink-0 text-[var(--color-text-faint)] transition-transform"
          style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
        <span class="section-label flex-1">Runtime</span>
        <span class="max-w-[86px] truncate text-[11px] text-[var(--color-text-faint)]">{provider.data?.label ?? 'Claude'}</span>
      </button>

      {expanded && (
        <div class="overflow-hidden border-t border-[var(--color-border)] transition-all duration-200">
          <div class="px-3 py-2.5 border-b border-[var(--color-border)]">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[11px] uppercase text-[var(--color-text-faint)]">Runtime</div>
                <div class="text-[12.5px] font-medium text-[var(--color-text)] truncate">{provider.data?.label ?? 'Claude'}</div>
              </div>
              {acpEnabled ? (
                <select
                  value={providerType}
                  disabled={switching}
                  onChange={(event) => switchProvider((event.currentTarget as HTMLSelectElement).value)}
                  class="h-8 max-w-[116px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[12px] text-[var(--color-text)] disabled:opacity-60"
                  aria-label="Switch main provider"
                >
                  <option value="claude">Claude</option>
                  <option value="opencode">OpenCode</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="gemini">Gemini</option>
                  <option value="codex">Codex</option>
                </select>
              ) : null}
            </div>
            <div class="mt-1.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
              <span class="text-[var(--color-text-faint)]">Model</span>{' '}
              <span class="break-all">{provider.data?.model ?? 'claude-opus-4-8'}</span>
            </div>
          </div>

          {/* Always rendered — never gate this on a breakpoint: forcing
              desktop makes `md:` match and a breakpoint-hidden toggle would
              strand the user in desktop view. No-op on real desktops. */}
          <div class="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between gap-2">
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

          <Link
            href="/settings"
            class="block px-3 py-3 text-[12px] text-[var(--color-text-faint)] hover:bg-[var(--color-elevated)] transition-colors"
          >
            <div class="flex items-center gap-2.5">
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)]"
                style={{
                  backgroundColor: anyOff
                    ? 'color-mix(in srgb, var(--color-status-failed) 18%, transparent)'
                    : 'var(--color-elevated)',
                  color: anyOff ? 'var(--color-status-failed)' : 'var(--color-text-muted)',
                }}
              >
                ●
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[var(--color-text)] text-[12.5px] font-medium truncate">{name}</div>
                <div class="truncate text-[11px]">
                  {anyOff
                    ? off.length + ' kill switch' + (off.length === 1 ? '' : 'es') + ' off'
                    : 'All systems normal'}
                </div>
              </div>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}

function providerLabel(type: string): string {
  if (type === 'claude') return 'Claude';
  if (type === 'gemini') return 'Gemini';
  if (type === 'codex') return 'Codex';
  if (type === 'openrouter') return 'OpenRouter';
  if (type === 'acp') return 'Custom ACP';
  return 'OpenCode';
}

function providerDescription(type: string): string {
  if (type === 'opencode') return 'OpenCode will use its configured default model.';
  if (type === 'gemini') return 'Requires Gemini CLI on PATH. Model/auth are managed by Gemini.';
  if (type === 'codex') return 'Requires the codex-acp adapter on PATH. Auth is managed by Codex.';
  if (type === 'openrouter') return 'OpenRouter (native). Set OPENROUTER_API_KEY in .env. Pick a model from the live list in Settings. Single-turn chat only — no prior-turn context.';
  return 'Takes effect on the next message.';
}
