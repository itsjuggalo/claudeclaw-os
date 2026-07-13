import { lazy } from 'preact/compat';
import type { FunctionComponent } from 'preact';

// Single source of truth for route-level code splitting (App.tsx builds its
// lazy() components from this map) AND sidebar hover-prefetch (prefetchPage
// warms a page's JS chunk before the click). Keyed by route path.
//
// Before this, all ~44 pages were static-imported into one ~1.3MB bundle that
// loaded before first paint. Now each page is its own chunk, fetched on demand
// (the heavy three.js/OrbitControls stack only downloads on Knowledge Graph /
// Character Studio), and hovering a nav link preloads its chunk so navigation
// still feels instant.
type PageDef = { load: () => Promise<Record<string, unknown>>; name: string };

export const PAGES: Record<string, PageDef> = {
  '/mission':               { load: () => import('@/pages/MissionControl'), name: 'MissionControl' },
  '/control':               { load: () => import('@/pages/ControlPanel'), name: 'ControlPanel' },
  '/scheduled':             { load: () => import('@/pages/Scheduled'), name: 'Scheduled' },
  '/agents':                { load: () => import('@/pages/Agents'), name: 'Agents' },
  '/agents/:id/files':      { load: () => import('@/pages/AgentFiles'), name: 'AgentFiles' },
  '/chat':                  { load: () => import('@/pages/Chat'), name: 'Chat' },
  '/bunker':                { load: () => import('@/pages/Bunker'), name: 'Bunker' },
  '/memories':              { load: () => import('@/pages/Memories'), name: 'Memories' },
  '/hive':                  { load: () => import('@/pages/HiveMind'), name: 'HiveMind' },
  '/knowledge-graph':       { load: () => import('@/pages/KnowledgeGraph'), name: 'KnowledgeGraph' },
  '/mckb':                  { load: () => import('@/pages/McKb'), name: 'McKb' },
  '/databases':             { load: () => import('@/pages/Databases'), name: 'Databases' },
  '/databases/:id':         { load: () => import('@/pages/DatabaseDetail'), name: 'DatabaseDetail' },
  '/journal':               { load: () => import('@/pages/Journal'), name: 'Journal' },
  '/usage':                 { load: () => import('@/pages/Usage'), name: 'Usage' },
  '/audit':                 { load: () => import('@/pages/Audit'), name: 'Audit' },
  '/wallets':               { load: () => import('@/pages/Wallets'), name: 'Wallets' },
  '/massage-ops':           { load: () => import('@/pages/MassageOps'), name: 'MassageOps' },
  '/massage-admin':         { load: () => import('@/pages/MassageAdmin'), name: 'MassageAdmin' },
  '/sql-monitor':           { load: () => import('@/pages/SqlMonitor'), name: 'SqlMonitor' },
  '/signal-monitor':        { load: () => import('@/pages/SignalMonitor'), name: 'SignalMonitor' },
  '/live-apps':             { load: () => import('@/pages/LiveApps'), name: 'LiveApps' },
  '/gallery':               { load: () => import('@/pages/Gallery'), name: 'Gallery' },
  '/skool-builds':          { load: () => import('@/pages/SkoolBuilds'), name: 'SkoolBuilds' },
  '/lewis-trading':         { load: () => import('@/pages/LewisTrading'), name: 'LewisTrading' },
  '/create':                { load: () => import('@/pages/Create'), name: 'Create' },
  '/characters':            { load: () => import('@/pages/CharacterStudio'), name: 'CharacterStudio' },
  '/hermes':                { load: () => import('@/pages/Hermes'), name: 'Hermes' },
  '/rapidapi':              { load: () => import('@/pages/RapidApi'), name: 'RapidApi' },
  '/warroom':               { load: () => import('@/pages/WarRoom'), name: 'WarRoom' },
  '/office':                { load: () => import('@/pages/ClaudeOffice'), name: 'ClaudeOffice' },
  '/token-usage':           { load: () => import('@/pages/TokenUsage'), name: 'TokenUsage' },
  '/token-burn':            { load: () => import('@/pages/TokenBurn'), name: 'TokenBurn' },
  '/voices':                { load: () => import('@/pages/Voices'), name: 'Voices' },
  '/peon':                  { load: () => import('@/pages/Peon'), name: 'Peon' },
  '/settings':              { load: () => import('@/pages/Settings'), name: 'Settings' },
  '/trade-desk':            { load: () => import('@/pages/TradeDeskPage'), name: 'TradeDeskPage' },
  '/equity':                { load: () => import('@/pages/EquityManagement'), name: 'EquityManagement' },
  '/trade-desk/signals':    { load: () => import('@/pages/SignalFeedPage'), name: 'SignalFeedPage' },
  '/trade-desk/flow-rank':  { load: () => import('@/pages/FlowRankPage'), name: 'FlowRankPage' },
  '/trade-desk/portfolio':  { load: () => import('@/pages/PortfolioAIPage'), name: 'PortfolioAIPage' },
  '/trade-desk/flow-winners': { load: () => import('@/pages/FlowWinnersPage'), name: 'FlowWinnersPage' },
  '/options-academy':       { load: () => import('@/pages/OptionsAcademy'), name: 'OptionsAcademy' },
  '/astrology':             { load: () => import('@/pages/Astrology'), name: 'Astrology' },
  '/coach':                 { load: () => import('@/pages/DailyCoach'), name: 'DailyCoach' },
};

export const LazyPages: Record<string, FunctionComponent> = Object.fromEntries(
  Object.entries(PAGES).map(([p, d]) => [
    p,
    lazy(() => d.load().then((m) => ({ default: m[d.name] as FunctionComponent }))),
  ]),
) as Record<string, FunctionComponent>;

// Warm a route's chunk (called on nav hover/focus). Idempotent — the bundler
// dedupes the dynamic import after the first call; we also guard so a hover
// storm doesn't spawn repeat work.
const warmed = new Set<string>();
export function prefetchPage(path: string): void {
  const d = PAGES[path];
  if (!d || warmed.has(path)) return;
  warmed.add(path);
  d.load().catch(() => warmed.delete(path));
}
