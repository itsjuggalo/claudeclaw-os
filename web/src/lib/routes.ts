import {
  LayoutGrid, ListTodo, Users, MessageSquare,
  Brain, Network, Activity, ShieldCheck,
  Swords, Database, BookOpen,
  Settings, Smartphone, Wallet, Images, Wand2,
  Rocket, Radio, TrendingUp, Workflow, Bot, Building2,
  BarChart2, Briefcase, Trophy, GraduationCap,
  Coins, Gauge, FolderKanban, Server, ScrollText, MonitorDot, Flame,
  HeartPulse, DatabaseZap, Drama, SlidersHorizontal, Film, ClipboardList,
  StickyNote, Sparkles, Target,
  Gamepad2,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';

export type RouteSection = 'workspace' | 'trade' | 'studio' | 'intelligence' | 'collaborate' | 'massage' | 'mc' | 'mcctrl' | 'system';

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
  { path: '/control',    label: 'Control Panel',   section: 'workspace',    icon: SlidersHorizontal, shortcut: 'g .' },
  { path: '/scheduled',  label: 'Scheduled',       section: 'workspace',    icon: ListTodo,      shortcut: 'g s' },
  { path: '/agents',     label: 'Agents',          section: 'workspace',    icon: Users,         shortcut: 'g a' },
  { path: '/chat',       label: 'Chat',            section: 'workspace',    icon: MessageSquare, shortcut: 'g c' },
  { path: '/bunker',     label: 'Bunker',          section: 'workspace',    icon: StickyNote,    shortcut: 'g f' },

  // Studio — creative / media
  { path: '/create',     label: 'Create',          section: 'studio',       icon: Wand2,         shortcut: 'g n' },
  { path: '/gallery',    label: 'Gallery',         section: 'studio',       icon: Images,        shortcut: 'g i' },
  { path: '/characters', label: 'Character Studio', section: 'studio',      icon: Drama,         shortcut: 'g d' },
  { path: '/rapidapi',   label: 'RapidAPI',        section: 'studio',       icon: Film,          shortcut: 'g v' },

  // Intelligence — knowledge / AI
  { path: '/memories',   label: 'Memories',        section: 'intelligence', icon: Brain,         shortcut: 'g e' },
  { path: '/hive',       label: 'Hive Mind',       section: 'intelligence', icon: Network,       shortcut: 'g h' },
  { path: '/knowledge-graph', label: 'Knowledge Graph', section: 'intelligence', icon: Workflow              },
  { path: '/databases',  label: 'Databases',       section: 'intelligence', icon: Database                      },
  { path: '/sql-monitor', label: 'SQL Databases',    section: 'intelligence', icon: DatabaseZap                   },
  { path: '/journal',    label: 'Journal',         section: 'intelligence', icon: BookOpen,      shortcut: 'g j' },
  { path: '/audit',      label: 'Audit',           section: 'intelligence', icon: ShieldCheck                   },
  { path: '/skool-builds', label: 'Skool Builds',  section: 'intelligence', icon: GraduationCap, inSidebar: false },
  { path: '/hermes',     label: 'Hermes',          section: 'intelligence', icon: Bot,           shortcut: 'g r' },
  { path: '/astrology',  label: 'Astrology',       section: 'intelligence', icon: Sparkles                      },

  // Trade Desk — live trading / finance
  { path: '/quick-trade',         label: 'Quick Trade',   section: 'trade', icon: Coins,       href: 'self:3000/phone.html' },
  { path: '/coach',               label: 'Daily Coach',   section: 'trade', icon: Target                 },
  { path: '/trade-desk',          label: 'Trade Desk',    section: 'trade', icon: TrendingUp,  shortcut: 'g t' },
  { path: '/equity',              label: 'Equity Mgmt',   section: 'trade', icon: Gauge,       shortcut: 'g q' },
  { path: '/trade-desk/signals',  label: 'Signal Feed',   section: 'trade', icon: Activity               },
  { path: '/signal-monitor',      label: 'Signal Monitor',section: 'trade', icon: Radio                  },
  { path: '/live-apps',           label: 'Live Apps',     section: 'trade', icon: Smartphone             },
  { path: '/trade-desk/flow-rank',label: 'Flow Rank',     section: 'trade', icon: BarChart2              },
  { path: '/trade-desk/portfolio',label: 'Portfolio AI',  section: 'trade', icon: Briefcase              },
  { path: '/trade-desk/flow-winners', label: 'Flow Winners', section: 'trade', icon: Trophy             },
  { path: '/options-academy',         label: 'Options Academy', section: 'trade', icon: GraduationCap, shortcut: 'g x' },
  { path: '/databases/claytrader',    label: 'ClayTrader KB', section: 'trade', icon: GraduationCap,   shortcut: 'g y' },
  { path: '/lewis-trading',       label: 'Lewis Trading', section: 'trade', icon: GraduationCap, inSidebar: false },
  { path: '/video-game',          label: 'Video Game',    section: 'trade', icon: Gamepad2 },
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
  { path: '/ext-board',    label: 'Session Board',   section: 'mc', icon: FolderKanban, href: 'self:3222' },
  { path: '/ext-aries',    label: 'ARIES',           section: 'mc', icon: Rocket,      href: 'self:1337' },
  { path: '/ext-mcv2',     label: 'MissionCtrl V2',  section: 'mc', icon: LayoutGrid,  href: 'self:3000' },
  { path: '/ext-kronos',   label: 'Kronos',          section: 'mc', icon: TrendingUp,  href: 'self:7070' },
  { path: '/ext-vibe',     label: 'Vibe Trading',    section: 'mc', icon: Workflow,    href: 'self:8899' },
  // Mobile Hub launchpad. self:8443 → http://localhost:8443 on desktop (plain-http
  // nginx block) / https://<tailnet-host>:8443 on phone (tailscale-cert ssl block).
  { path: '/ext-hub',      label: 'Mobile Hub',      section: 'mc', icon: Radio,       href: 'self:8443' },
  { path: '/ext-n8n',      label: 'n8n',             section: 'mc', icon: Workflow,    href: 'self:5678' },

  // Mission Control — ALL operator/personal pages moved off the PUBLIC missionctrl site
  // (2026-06-20, Mike's call). missionctrl :3000 is now a clean public product (signal8-style);
  // anything Mike-specific (money/positions), internal admin, or infra lives HERE. Deep-links
  // into MC :3000 (pages still resolve via ?page=<slug>); open in a new tab.
  { path: '/ext-mc-wallets',   label: 'Wallets',       section: 'mcctrl', icon: Wallet,       href: 'self:3000/?page=wallets' },
  { path: '/ext-mc-trades',    label: 'Trades',        section: 'mcctrl', icon: Briefcase,    href: 'self:3000/?page=trades' },
  { path: '/ext-mc-llmport',   label: 'LLM Portfolio', section: 'mcctrl', icon: BarChart2,    href: 'self:3000/?page=llm-portfolio' },
  { path: '/ext-mc-risk',      label: 'Risk',          section: 'mcctrl', icon: ShieldCheck,  href: 'self:3000/?page=risk' },
  { path: '/ext-mc-perf',      label: 'Performance',   section: 'mcctrl', icon: Gauge,        href: 'self:3000/?page=performance' },
  { path: '/ext-mc-journal',   label: 'MC Journal',    section: 'mcctrl', icon: BookOpen,     href: 'self:3000/?page=journal' },
  { path: '/ext-mc-telegram',  label: 'Telegram',      section: 'mcctrl', icon: MessageSquare, href: 'self:3000/?page=telegram' },
  { path: '/ext-mc-approvals', label: 'Approvals',     section: 'mcctrl', icon: ListTodo,     href: 'self:3000/?page=approvals' },
  { path: '/ext-mc-activity',  label: 'Activity',      section: 'mcctrl', icon: Activity,     href: 'self:3000/?page=activity' },
  { path: '/ext-mc-agents',    label: 'Agents',        section: 'mcctrl', icon: Bot,          href: 'self:3000/?page=agents' },
  { path: '/ext-mc-pm2',       label: 'PM2 Control',   section: 'mcctrl', icon: Server,       href: 'self:3000/?page=pm2-control' },
  { path: '/ext-mc-sessions',  label: 'Sessions',      section: 'mcctrl', icon: MessageSquare, href: 'self:3000/?page=sessions' },
  { path: '/ext-mc-memory',    label: 'Memory',        section: 'mcctrl', icon: Brain,        href: 'self:3000/?page=memory' },
  { path: '/ext-mc-memgraph',  label: 'Memory Graph',  section: 'mcctrl', icon: Network,      href: 'self:3000/?page=memory-graph' },
  { path: '/ext-mc-tasks',     label: 'Tasks',         section: 'mcctrl', icon: ListTodo,     href: 'self:3000/?page=tasks' },
  { path: '/ext-mc-skills',    label: 'Skills',        section: 'mcctrl', icon: Database,     href: 'self:3000/?page=skills' },
  { path: '/ext-mc-docs',      label: 'Docs',          section: 'mcctrl', icon: BookOpen,     href: 'self:3000/?page=docs' },
  { path: '/ext-mc-usage',     label: 'Usage',         section: 'mcctrl', icon: Activity,     href: 'self:3000/?page=usage' },
  { path: '/ext-mc-office',    label: 'Office',        section: 'mcctrl', icon: Building2,    href: 'self:3000/?page=office' },
  { path: '/ext-mc-projects',  label: 'Projects',      section: 'mcctrl', icon: FolderKanban, href: 'self:3000/?page=projects' },
  // Lewis Program is an MC :3000 page (Lewis Live + Strategy Compare stayed on MC) — grouped
  // here with the rest of Mission Control instead of a one-item "Lewis Lab" section.
  { path: '/ext-lewis-program', label: 'Lewis Program', section: 'mcctrl', icon: GraduationCap, href: 'self:3000/?page=lewis-program' },

  // Massage & bodywork — Mike's non-trading business: admin console, ops, and the
  // Erik Dalton learning KB (folded in from the old one-item "Wellness" section).
  { path: '/massage-admin', label: 'Massage Admin',       section: 'massage', icon: ClipboardList },
  { path: '/massage-ops',   label: 'Massage Ops',         section: 'massage', icon: HeartPulse },
  { path: '/databases/erikdalton', label: 'Erik Dalton — Learn', section: 'massage', icon: HeartPulse, shortcut: 'g d' },

  // ARIES admin — external ARIES pages, grouped with the ARIES launcher under MC Apps.
  { path: '/ext-aries-log',      label: 'Mission Log',      section: 'mc', icon: ScrollText,     href: 'self:1337/log' },
  { path: '/ext-aries-settings', label: 'ARIES Settings',   section: 'mc', icon: Settings,       href: 'self:1337/settings' },
  { path: '/ext-aries-system',   label: 'System Analytics', section: 'mc', icon: MonitorDot,     href: 'self:1337/system' },
];

export const SECTION_LABEL: Record<RouteSection, string> = {
  workspace:    'Workspace',
  trade:        'Trade Desk',
  studio:       'Studio',
  intelligence: 'Intelligence',
  collaborate:  'Collaborate',
  massage:      'Massage',
  mc:           'MC Apps',
  mcctrl:       'Mission Control',
  system:       'System',
};

export const DEFAULT_ROUTE = '/mission';

// Lightly typed children helper for placeholder pages.
export type PageProps = { children?: ComponentChildren };
