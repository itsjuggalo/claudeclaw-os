import { Route, Switch, Redirect } from 'wouter-preact';
import { Suspense } from 'preact/compat';
import { Menu } from 'lucide-preact';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { ToastStack } from '@/components/ToastStack';
import { sidebarOpen, closeSidebar } from '@/lib/sidebar';
import { Placeholder } from '@/pages/Placeholder';
import { LazyPages } from '@/lib/page-loaders';
import { DEFAULT_ROUTE } from '@/lib/routes';

// Each page is code-split (see lib/page-loaders). <Page path> resolves the
// lazy component for a route path; Suspense below shows a light fallback while
// its chunk loads. Placeholder (404) stays statically imported — it's tiny and
// is the fallback itself.
function Page({ path }: { path: string }) {
  const C = LazyPages[path];
  return C ? <C /> : null;
}

function PageFallback() {
  return (
    <div class="flex h-full w-full items-center justify-center text-[13px] text-[var(--color-text-faint)]">
      Loading…
    </div>
  );
}

export function App() {
  const open = sidebarOpen.value;
  return (
    <div class="flex h-screen h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Mobile-only hamburger. Hidden on >=md where the sidebar is
       *  always inline. */}
      <button
        type="button"
        onClick={() => { sidebarOpen.value = true; }}
        class="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] shadow-md"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Backdrop when the mobile drawer is open. Tapping it closes. */}
      {open && (
        <div
          class="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={closeSidebar}
        />
      )}

      <Sidebar />
      <main class="flex-1 min-w-0 overflow-hidden pl-12 md:pl-0">
        <Suspense fallback={<PageFallback />}>
          <Switch>
            <Route path="/mission"><Page path="/mission" /></Route>
            <Route path="/control"><Page path="/control" /></Route>
            <Route path="/scheduled"><Page path="/scheduled" /></Route>
            <Route path="/agents"><Page path="/agents" /></Route>
            <Route path="/agents/:id/files"><Page path="/agents/:id/files" /></Route>
            <Route path="/chat"><Page path="/chat" /></Route>
            <Route path="/bunker"><Page path="/bunker" /></Route>
            <Route path="/memories"><Page path="/memories" /></Route>
            <Route path="/hive"><Page path="/hive" /></Route>
            <Route path="/knowledge-graph"><Page path="/knowledge-graph" /></Route>
            <Route path="/mckb"><Page path="/mckb" /></Route>
            <Route path="/databases"><Page path="/databases" /></Route>
            <Route path="/databases/:id"><Page path="/databases/:id" /></Route>
            <Route path="/journal"><Page path="/journal" /></Route>
            <Route path="/usage"><Page path="/usage" /></Route>
            <Route path="/audit"><Page path="/audit" /></Route>
            <Route path="/wallets"><Page path="/wallets" /></Route>
            <Route path="/massage-ops"><Page path="/massage-ops" /></Route>
            <Route path="/massage-admin"><Page path="/massage-admin" /></Route>
            <Route path="/sql-monitor"><Page path="/sql-monitor" /></Route>
            <Route path="/signal-monitor"><Page path="/signal-monitor" /></Route>
            <Route path="/live-apps"><Page path="/live-apps" /></Route>
            <Route path="/gallery"><Page path="/gallery" /></Route>
            <Route path="/skool-builds"><Page path="/skool-builds" /></Route>
            <Route path="/lewis-trading"><Page path="/lewis-trading" /></Route>
            <Route path="/create"><Page path="/create" /></Route>
            <Route path="/characters"><Page path="/characters" /></Route>
            <Route path="/hermes"><Page path="/hermes" /></Route>
            <Route path="/rapidapi"><Page path="/rapidapi" /></Route>
            <Route path="/warroom"><Page path="/warroom" /></Route>
            <Route path="/office"><Page path="/office" /></Route>
            <Route path="/token-usage"><Page path="/token-usage" /></Route>
            <Route path="/token-burn"><Page path="/token-burn" /></Route>
            <Route path="/voices"><Page path="/voices" /></Route>
            <Route path="/peon"><Page path="/peon" /></Route>
            <Route path="/settings"><Page path="/settings" /></Route>

            {/* Trade Desk — live trading intelligence */}
            <Route path="/trade-desk"><Page path="/trade-desk" /></Route>
            <Route path="/equity"><Page path="/equity" /></Route>
            <Route path="/trade-desk/signals"><Page path="/trade-desk/signals" /></Route>
            <Route path="/trade-desk/flow-rank"><Page path="/trade-desk/flow-rank" /></Route>
            <Route path="/trade-desk/portfolio"><Page path="/trade-desk/portfolio" /></Route>
            <Route path="/trade-desk/flow-winners"><Page path="/trade-desk/flow-winners" /></Route>
            <Route path="/options-academy"><Page path="/options-academy" /></Route>

            {/* Common alt slugs that used to point at placeholder pages */}
            <Route path="/hive-mind"><Redirect to="/hive" /></Route>
            <Route path="/hivemind"><Redirect to="/hive" /></Route>
            <Route path="/memory"><Redirect to="/memories" /></Route>

            <Route path="/"><Redirect to={DEFAULT_ROUTE} /></Route>
            <Route>
              <Placeholder
                title="Not found"
                description="This page does not exist. Use ⌘K to jump somewhere."
                hideRoadmapNote
              />
            </Route>
          </Switch>
        </Suspense>
      </main>
      <CommandPalette />
      <ToastStack />
    </div>
  );
}
