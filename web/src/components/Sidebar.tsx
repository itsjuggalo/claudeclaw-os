import { Link, useLocation } from 'wouter-preact';
import { Search } from 'lucide-preact';
import { ROUTES, SECTION_LABEL, type RouteSection } from '@/lib/routes';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { commandPaletteOpen } from '@/lib/command-palette';

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
                    <span>{r.label}</span>
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

function SidebarFooter() {
  // Lightweight identity strip. The dashboard is single-user today, so we
  // don't fetch a real user object — just show a system-status hint.
  // A multi-tenant future will replace the placeholder block.
  return (
    <div class="px-3 py-3 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)]">
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded-full bg-[var(--color-elevated)] flex items-center justify-center text-[var(--color-text-muted)]">
          ●
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[var(--color-text)] text-[11.5px] truncate">ClaudeClaw</div>
          <div class="truncate">All systems normal</div>
        </div>
      </div>
    </div>
  );
}
