import { Route, Switch, Redirect } from 'wouter-preact';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { ToastStack } from '@/components/ToastStack';
import { Placeholder } from '@/pages/Placeholder';
import { MissionControl } from '@/pages/MissionControl';
import { Memories } from '@/pages/Memories';
import { HiveMind } from '@/pages/HiveMind';
import { Agents } from '@/pages/Agents';
import { Scheduled } from '@/pages/Scheduled';
import { Audit } from '@/pages/Audit';
import { Usage } from '@/pages/Usage';
import { Settings } from '@/pages/Settings';
import { Voices } from '@/pages/Voices';
import { Chat } from '@/pages/Chat';
import { WarRoom } from '@/pages/WarRoom';
import { DEFAULT_ROUTE } from '@/lib/routes';

export function App() {
  return (
    <div class="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <Sidebar />
      <main class="flex-1 min-w-0 overflow-hidden">
        <Switch>
          <Route path="/mission"><MissionControl /></Route>
          <Route path="/scheduled"><Scheduled /></Route>
          <Route path="/agents"><Agents /></Route>
          <Route path="/chat"><Chat /></Route>
          <Route path="/memories"><Memories /></Route>
          <Route path="/hive"><HiveMind /></Route>
          <Route path="/usage"><Usage /></Route>
          <Route path="/audit"><Audit /></Route>
          <Route path="/warroom"><WarRoom /></Route>
          <Route path="/voices"><Voices /></Route>
          <Route path="/settings"><Settings /></Route>

          <Route path="/"><Redirect to={DEFAULT_ROUTE} /></Route>
          <Route>
            <Placeholder title="Not found" description="This page does not exist. Use ⌘K to jump somewhere." />
          </Route>
        </Switch>
      </main>
      <CommandPalette />
      <ToastStack />
    </div>
  );
}
