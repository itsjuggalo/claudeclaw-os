import { Link, useLocation } from 'wouter-preact';
import { Search } from 'lucide-preact';
import { ROUTES, SECTION_LABEL, type RouteSection } from '@/lib/routes';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { commandPaletteOpen } from '@/lib/command-palette';
import { chatUnread } from '@/lib/chat-stream';
import { useFetch } from '@/lib/useFetch';

const SECTIONS: RouteSection[] = ['workspace', 'intelligence', 'collaborate', 'configure'];

export function Sidebar() {
  const [pathname] = useLocation();

  return (
    <aside class="flex flex-col h-screen w-[240px] shrink-0 bg-[var(--color-sidebar)] border-r border-[var(--color-border)]">
      <WorkspaceSwitcher />

      <button
        type="button"
        onClick={() => { commandPaletteOpen.value = true; }}
        class="mx-3 mt-1 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors text-[12px]"
      >
        <Search size={14} />
        <span>Search</span>
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">⌘K</span>
      </button>

      <nav class="flex-1 overflow-y-auto px-2 pb-3">
        {SECTIONS.map((section) => {
          const items = ROUTES.filter((r) => r.section === section);
          if (items.length === 0) return null;
          return (
            <div key={section} class="mt-3 first:mt-1">
              <div class="px-2.5 py-1 section-label">{SECTION_LABEL[section]}</div>
              {items.map((r) => {
                const active = pathname === r.path || (pathname === '/' && r.path === '/mission');
                const Icon = r.icon;
                const unread = r.path === '/chat' ? chatUnread.value : 0;
                return (
                  <Link
                    key={r.path}
                    href={r.path}
                    class={[
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors',
                      active
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
                    ].join(' ')}
                  >
                    <Icon size={14} />
                    <span class="flex-1">{r.label}</span>
                    {unread > 0 && (
                      <span class="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold tabular-nums bg-[var(--color-accent)] text-white">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <SidebarFooter />
    </aside>
  );
}

interface Health { killSwitches: Record<string, boolean>; }

function SidebarFooter() {
  const { data } = useFetch<Health>('/api/health', 30_000);
  const switches = data?.killSwitches || {};
  const off = Object.entries(switches).filter(([, on]) => !on);
  const anyOff = off.length > 0;
  return (
    <Link
      href="/settings"
      class="px-3 py-3 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)] hover:bg-[var(--color-elevated)] transition-colors"
    >
      <div class="flex items-center gap-2">
        <div
          class="w-6 h-6 rounded-full flex items-center justify-center text-[var(--color-text-muted)]"
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
          <div class="text-[var(--color-text)] text-[11.5px] truncate">ClaudeClaw</div>
          <div class="truncate">
            {anyOff
              ? off.length + ' kill switch' + (off.length === 1 ? '' : 'es') + ' off'
              : 'All systems normal'}
          </div>
        </div>
      </div>
    </Link>
  );
}
