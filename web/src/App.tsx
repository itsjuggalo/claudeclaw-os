import { Route, Switch, Redirect } from 'wouter-preact';
import { Menu } from 'lucide-preact';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { ToastStack } from '@/components/ToastStack';
import { sidebarOpen, closeSidebar } from '@/lib/sidebar';
import { Placeholder } from '@/pages/Placeholder';
import { MissionControl } from '@/pages/MissionControl';
import { Memories } from '@/pages/Memories';
import { HiveMind } from '@/pages/HiveMind';
import { McKb } from '@/pages/McKb';
import { Journal } from '@/pages/Journal';
import { Agents } from '@/pages/Agents';
import { Scheduled } from '@/pages/Scheduled';
import { Audit } from '@/pages/Audit';
import { Usage } from '@/pages/Usage';
import { Settings } from '@/pages/Settings';
import { Voices } from '@/pages/Voices';
import { Chat } from '@/pages/Chat';
import { WarRoom } from '@/pages/WarRoom';
import { AgentFiles } from '@/pages/AgentFiles';
import { Peon } from '@/pages/Peon';
import { Wallets } from '@/pages/Wallets';
import { Gallery } from '@/pages/Gallery';
import { SkoolBuilds } from '@/pages/SkoolBuilds';
import { LewisTrading } from '@/pages/LewisTrading';
import { Create } from '@/pages/Create';
import { Hermes } from '@/pages/Hermes';
import { ClaudeOffice } from '@/pages/ClaudeOffice';
import { TokenUsage } from '@/pages/TokenUsage';
import { TradeDeskPage } from '@/pages/TradeDeskPage';
import { SignalFeedPage } from '@/pages/SignalFeedPage';
import { FlowRankPage } from '@/pages/FlowRankPage';
import { PortfolioAIPage } from '@/pages/PortfolioAIPage';
import { FlowWinnersPage } from '@/pages/FlowWinnersPage';
import { Databases } from '@/pages/Databases';
import { DatabaseDetail } from '@/pages/DatabaseDetail';
import { DEFAULT_ROUTE } from '@/lib/routes';

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
        <Switch>
          <Route path="/mission"><MissionControl /></Route>
          <Route path="/scheduled"><Scheduled /></Route>
          <Route path="/agents"><Agents /></Route>
          <Route path="/agents/:id/files"><AgentFiles /></Route>
          <Route path="/chat"><Chat /></Route>
          <Route path="/memories"><Memories /></Route>
          <Route path="/hive"><HiveMind /></Route>
          <Route path="/mckb"><McKb /></Route>
          <Route path="/databases"><Databases /></Route>
          <Route path="/databases/:id"><DatabaseDetail /></Route>
          <Route path="/journal"><Journal /></Route>
          <Route path="/usage"><Usage /></Route>
          <Route path="/audit"><Audit /></Route>
          <Route path="/wallets"><Wallets /></Route>
          <Route path="/gallery"><Gallery /></Route>
          <Route path="/skool-builds"><SkoolBuilds /></Route>
          <Route path="/lewis-trading"><LewisTrading /></Route>
          <Route path="/create"><Create /></Route>
          <Route path="/hermes"><Hermes /></Route>
          <Route path="/warroom"><WarRoom /></Route>
          <Route path="/office"><ClaudeOffice /></Route>
          <Route path="/token-usage"><TokenUsage /></Route>
          <Route path="/voices"><Voices /></Route>
          <Route path="/peon"><Peon /></Route>
          <Route path="/settings"><Settings /></Route>

          {/* Trade Desk — live trading intelligence */}
          <Route path="/trade-desk"><TradeDeskPage /></Route>
          <Route path="/trade-desk/signals"><SignalFeedPage /></Route>
          <Route path="/trade-desk/flow-rank"><FlowRankPage /></Route>
          <Route path="/trade-desk/portfolio"><PortfolioAIPage /></Route>
          <Route path="/trade-desk/flow-winners"><FlowWinnersPage /></Route>

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
      </main>
      <CommandPalette />
      <ToastStack />
    </div>
  );
}
