import {
  LayoutGrid, ListTodo, Users, MessageSquare,
  Brain, Network, Activity, ShieldCheck,
  Swords, Database, BookOpen,
  Settings, Smartphone, Wallet, Images, Wand2,
  Rocket, Radio, TrendingUp, Workflow, Bot, Building2,
  BarChart2, Briefcase, Trophy, GraduationCap,
  Coins, Gauge, FolderKanban, Server, ScrollText, MonitorDot, Flame,
  HeartPulse,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';

export type RouteSection = 'workspace' | 'studio' | 'intelligence' | 'collaborate' | 'configure' | 'system' | 'mc' | 'trade' | 'ops' | 'wellness';

export interface RouteDef {
  path: string;
  label: string;
  section: RouteSection;
  icon: typeof LayoutGrid;
  shortcut?: string;
  /** External URL — renders as <a target="_blank"> instead of a router Link. */
  href?: string;
  /** Set false to keep the route registered (router + command palette) but hide from sidebar nav. */
  inSidebar?: boolean;
}

// Single source of truth for the sidebar, command palette, and router.
// Voices used to be a top-level item; it now lives under War Room as the
// "Voice config" sub-tab and is reachable via /warroom?mode=voices.
export const ROUTES: RouteDef[] = [
  { path: '/mission',    label: 'Mission Control', section: 'workspace',    icon: LayoutGrid,    shortcut: 'g m' },
  { path: '/scheduled',  label: 'Scheduled',       section: 'workspace',    icon: ListTodo,      shortcut: 'g s' },
  { path: '/agents',     label: 'Agents',          section: 'workspace',    icon: Users,         shortcut: 'g a' },
  { path: '/chat',       label: 'Chat',            section: 'workspace',    icon: MessageSquare, shortcut: 'g c' },

  // Studio — creative / media
  { path: '/create',     label: 'Create',          section: 'studio',       icon: Wand2,         shortcut: 'g n' },
  { path: '/gallery',    label: 'Gallery',         section: 'studio',       icon: Images,        shortcut: 'g i' },

  // Intelligence — knowledge / AI
  { path: '/memories',   label: 'Memories',        section: 'intelligence', icon: Brain,         shortcut: 'g e' },
  { path: '/hive',       label: 'Hive Mind',       section: 'intelligence', icon: Network,       shortcut: 'g h' },
  { path: '/knowledge-graph', label: 'Knowledge Graph', section: 'intelligence', icon: Workflow              },
  { path: '/databases',  label: 'Databases',       section: 'intelligence', icon: Database                      },
  { path: '/journal',    label: 'Journal',         section: 'intelligence', icon: BookOpen,      shortcut: 'g j' },
  { path: '/audit',      label: 'Audit',           section: 'intelligence', icon: ShieldCheck                   },
  { path: '/skool-builds', label: 'Skool Builds',  section: 'intelligence', icon: GraduationCap, inSidebar: false },
  { path: '/hermes',     label: 'Hermes',          section: 'intelligence', icon: Bot,           shortcut: 'g r' },

  // Trade Desk — live trading / finance
  { path: '/trade-desk',          label: 'Trade Desk',    section: 'trade', icon: TrendingUp,  shortcut: 'g t' },
  { path: '/equity',              label: 'Equity Mgmt',   section: 'trade', icon: Gauge,       shortcut: 'g q' },
  { path: '/trade-desk/signals',  label: 'Signal Feed',   section: 'trade', icon: Activity               },
  { path: '/trade-desk/flow-rank',label: 'Flow Rank',     section: 'trade', icon: BarChart2              },
  { path: '/trade-desk/portfolio',label: 'Portfolio AI',  section: 'trade', icon: Briefcase              },
  { path: '/trade-desk/flow-winners', label: 'Flow Winners', section: 'trade', icon: Trophy             },
  { path: '/databases/claytrader',    label: 'ClayTrader KB', section: 'trade', icon: GraduationCap,   shortcut: 'g y' },
  { path: '/lewis-trading',       label: 'Lewis Trading', section: 'trade', icon: GraduationCap, inSidebar: false },
  { path: '/wallets',    label: 'Wallets',         section: 'trade',        icon: Wallet,        shortcut: 'g $' },

  { path: '/warroom',    label: 'War Room',        section: 'collaborate',  icon: Swords,        shortcut: 'g w' },
  { path: '/office',     label: 'Claude Office',   section: 'collaborate',  icon: Building2,     shortcut: 'g o' },
  { path: '/peon',       label: 'Peon Ping',       section: 'collaborate',  icon: Smartphone                },

  // System — metering / config
  { path: '/usage',      label: 'Usage',           section: 'system',       icon: Activity,      shortcut: 'g u' },
  { path: '/token-usage', label: 'Token Usage',    section: 'system',       icon: Coins,         shortcut: 'g k' },
  { path: '/token-burn', label: 'Token Burn',      section: 'system',       icon: Flame,         shortcut: 'g b' },
  { path: '/settings',   label: 'Settings',        section: 'system',       icon: Settings                  },

  // Mission Control quick-launch (external links, open in new tab)
  { path: '/ext-aries',    label: 'ARIES',           section: 'mc', icon: Rocket,      href: 'http://100.91.39.122:1337' },
  { path: '/ext-mcv2',     label: 'MissionCtrl V2',  section: 'mc', icon: LayoutGrid,  href: 'http://100.91.39.122:3000' },
  { path: '/ext-kronos',   label: 'Kronos',          section: 'mc', icon: TrendingUp,  href: 'http://100.91.39.122:7070' },
  { path: '/ext-vibe',     label: 'Vibe Trading',    section: 'mc', icon: Workflow,    href: 'http://100.91.39.122:8899' },
  { path: '/ext-hub',      label: 'Mobile Hub',      section: 'mc', icon: Radio,       href: 'https://100.91.39.122:8443' },
  { path: '/ext-n8n',      label: 'n8n',             section: 'mc', icon: Workflow,    href: 'http://100.91.39.122:5678' },

  // Ops & Admin — non-trading pages parked here from the trading apps (MissionCtrl
  // :3000 + ARIES :1337). Sidebar links only; the source pages still live in their
  // apps. Open in a new tab. (Relocated 2026-06-13 to keep the trading apps lean.)
  { path: '/ext-mc-projects',    label: 'Projects',         section: 'ops', icon: FolderKanban,   href: 'http://100.91.39.122:3000/?page=projects' },
  { path: '/ext-mc-sessions',    label: 'Sessions',         section: 'ops', icon: MessageSquare,  href: 'http://100.91.39.122:3000/?page=sessions' },
  { path: '/ext-mc-memory',      label: 'MC Memory',        section: 'ops', icon: Brain,          href: 'http://100.91.39.122:3000/?page=memory' },
  { path: '/ext-mc-memgraph',    label: 'Memory Graph',     section: 'ops', icon: Network,        href: 'http://100.91.39.122:3000/?page=memory-graph' },
  { path: '/ext-mc-skills',      label: 'Skills',           section: 'ops', icon: Database,       href: 'http://100.91.39.122:3000/?page=skills' },
  { path: '/ext-mc-usage',       label: 'MC Usage',         section: 'ops', icon: Activity,       href: 'http://100.91.39.122:3000/?page=usage' },
  { path: '/ext-mc-pm2',         label: 'PM2 Control',      section: 'ops', icon: Server,         href: 'http://100.91.39.122:3000/?page=pm2-control' },
  { path: '/ext-mc-docs',        label: 'MC Docs',          section: 'ops', icon: BookOpen,       href: 'http://100.91.39.122:3000/?page=docs' },
  { path: '/ext-mc-office',      label: 'MC Office',        section: 'ops', icon: Building2,      href: 'http://100.91.39.122:3000/?page=office' },
  { path: '/ext-mc-tasks',       label: 'MC Tasks',         section: 'ops', icon: ListTodo,       href: 'http://100.91.39.122:3000/?page=tasks' },
  { path: '/ext-mc-agents',      label: 'MC Agents',        section: 'ops', icon: Bot,            href: 'http://100.91.39.122:3000/?page=agents' },
  { path: '/ext-aries-log',      label: 'Mission Log',      section: 'ops', icon: ScrollText,     href: 'http://100.91.39.122:1337/log' },
  { path: '/ext-aries-settings', label: 'ARIES Settings',   section: 'ops', icon: Settings,       href: 'http://100.91.39.122:1337/settings' },
  { path: '/ext-aries-system',   label: 'System Analytics', section: 'ops', icon: MonitorDot,     href: 'http://100.91.39.122:1337/system' },

  // Wellness — bodywork / MAT self-care (NOT trading)
  { path: '/databases/erikdalton', label: 'Erik Dalton — Learn', section: 'wellness', icon: HeartPulse, shortcut: 'g d' },
];

export const SECTION_LABEL: Record<RouteSection, string> = {
  workspace:    'Workspace',
  studio:       'Studio',
  intelligence: 'Intelligence',
  trade:        'Trade Desk',
  collaborate:  'Collaborate',
  configure:    'Configure',
  system:       'System',
  mc:           'MC Apps',
  ops:          'Ops & Admin',
  wellness:     'Wellness',
};

export const DEFAULT_ROUTE = '/mission';

// Lightly typed children helper for placeholder pages.
export type PageProps = { children?: ComponentChildren };
