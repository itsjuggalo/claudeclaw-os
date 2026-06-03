import {
  LayoutGrid, ListTodo, Users, MessageSquare,
  Brain, Network, Activity, ShieldCheck,
  Swords, Database, BookOpen,
  Settings, Smartphone, Wallet, Images, Wand2,
  Rocket, Radio, TrendingUp, Workflow, Bot, Building2,
  BarChart2, Briefcase, Trophy,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';

export type RouteSection = 'workspace' | 'intelligence' | 'collaborate' | 'configure' | 'mc' | 'trade';

export interface RouteDef {
  path: string;
  label: string;
  section: RouteSection;
  icon: typeof LayoutGrid;
  shortcut?: string;
  /** External URL — renders as <a target="_blank"> instead of a router Link. */
  href?: string;
}

// Single source of truth for the sidebar, command palette, and router.
// Voices used to be a top-level item; it now lives under War Room as the
// "Voice config" sub-tab and is reachable via /warroom?mode=voices.
export const ROUTES: RouteDef[] = [
  { path: '/mission',    label: 'Mission Control', section: 'workspace',    icon: LayoutGrid,    shortcut: 'g m' },
  { path: '/scheduled',  label: 'Scheduled',       section: 'workspace',    icon: ListTodo,      shortcut: 'g s' },
  { path: '/agents',     label: 'Agents',          section: 'workspace',    icon: Users,         shortcut: 'g a' },
  { path: '/chat',       label: 'Chat',            section: 'workspace',    icon: MessageSquare, shortcut: 'g c' },
  { path: '/create',     label: 'Create',          section: 'workspace',    icon: Wand2,         shortcut: 'g n' },

  { path: '/memories',   label: 'Memories',        section: 'intelligence', icon: Brain,         shortcut: 'g e' },
  { path: '/hive',       label: 'Hive Mind',       section: 'intelligence', icon: Network,       shortcut: 'g h' },
  { path: '/mckb',       label: 'mc-kb',           section: 'intelligence', icon: Database,      shortcut: 'g k' },
  { path: '/databases',  label: 'Databases',       section: 'intelligence', icon: Database                      },
  { path: '/journal',    label: 'Journal',         section: 'intelligence', icon: BookOpen,      shortcut: 'g j' },
  { path: '/usage',      label: 'Usage',           section: 'intelligence', icon: Activity,      shortcut: 'g u' },
  { path: '/audit',      label: 'Audit',           section: 'intelligence', icon: ShieldCheck                   },
  { path: '/wallets',    label: 'Wallets',         section: 'intelligence', icon: Wallet,        shortcut: 'g $' },
  { path: '/gallery',    label: 'Gallery',         section: 'intelligence', icon: Images,        shortcut: 'g i' },
  { path: '/hermes',     label: 'Hermes',          section: 'intelligence', icon: Bot,           shortcut: 'g r' },

  { path: '/warroom',    label: 'War Room',        section: 'collaborate',  icon: Swords,        shortcut: 'g w' },
  { path: '/office',     label: 'Claude Office',   section: 'collaborate',  icon: Building2,     shortcut: 'g o' },
  { path: '/peon',       label: 'Peon Ping',       section: 'collaborate',  icon: Smartphone                },

  { path: '/settings',   label: 'Settings',        section: 'configure',    icon: Settings                  },

  // Trade Desk — live trading intelligence
  { path: '/trade-desk',          label: 'Trade Desk',    section: 'trade', icon: TrendingUp,  shortcut: 'g t' },
  { path: '/trade-desk/signals',  label: 'Signal Feed',   section: 'trade', icon: Activity               },
  { path: '/trade-desk/flow-rank',label: 'Flow Rank',     section: 'trade', icon: BarChart2              },
  { path: '/trade-desk/portfolio',label: 'Portfolio AI',  section: 'trade', icon: Briefcase              },
  { path: '/trade-desk/flow-winners', label: 'Flow Winners', section: 'trade', icon: Trophy             },

  // Mission Control quick-launch (external links, open in new tab)
  { path: '/ext-aries',    label: 'ARIES',           section: 'mc', icon: Rocket,      href: 'https://g59-wsl.taile1328b.ts.net' },
  { path: '/ext-mcv2',     label: 'MissionCtrl V2',  section: 'mc', icon: LayoutGrid,  href: 'http://100.91.39.122:3000' },
  { path: '/ext-kronos',   label: 'Kronos',          section: 'mc', icon: TrendingUp,  href: 'http://100.91.39.122:7070' },
  { path: '/ext-vibe',     label: 'Vibe Trading',    section: 'mc', icon: Workflow,    href: 'http://100.91.39.122:5899' },
  { path: '/ext-hub',      label: 'Mobile Hub',      section: 'mc', icon: Radio,       href: 'https://100.91.39.122:8443' },
];

export const SECTION_LABEL: Record<RouteSection, string> = {
  workspace:    'Workspace',
  intelligence: 'Intelligence',
  trade:        'Trade Desk',
  collaborate:  'Collaborate',
  configure:    'Configure',
  mc:           'MC Apps',
};

export const DEFAULT_ROUTE = '/mission';

// Lightly typed children helper for placeholder pages.
export type PageProps = { children?: ComponentChildren };
