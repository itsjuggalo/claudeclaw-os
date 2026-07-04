import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { AGENT_ID, ENABLE_ACP, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_BIND, DASHBOARD_AUTH_DISABLED, DASHBOARD_TOKEN, DASHBOARD_URL, MC_ACCESS_SECRET, MC_ACCESS_DISABLED, PROJECT_ROOT, STORE_DIR, WARROOM_TMP_DIR, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT, agentDefaultModel, CLAUDECLAW_CONFIG, AIME_SESSION_COOKIE, updateAgentProvider } from './config.js';
import { MC_COOKIE, MASTER_TTL_SEC, verifyToken, masterToken, signToken, isLoopbackAddr, nowSec, mcLoginPage } from './mc-access.js';
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL, ProviderConfig, getProviderDisplay, checkProviderAvailability, getMainProviderConfig, normalizeProviderConfig, setMainProviderConfig } from './provider.js';
import crypto from 'crypto';
import { getWallets } from './wallets.js';
import { getMassageMonitor, keepAccount, deleteAccount, setReaper, massageAdmin } from './massage.js';
import { getMassageAdminOverview, updateMassageAdminClient } from './massage-admin.js';
import { massageAdminLoginStart, massageAdminOauthCallback, isAllowlistedAdmin } from './massage-oauth.js';
import { getSqlCatalog, getSqlTables, runSqlSelect, getModerationRows, updateRow, deleteRow, insertRow, getAuditLog as getSqlAuditLog, undoMutation } from './sqlmonitor.js';
import { getEquity } from './equity.js';
import { getTradeHistory } from './tradehistory.js';
import { getTokenBurn } from './tokenburn.js';
import { getCatalog, kbSearch, kbAsk, kbSources, kbAnatomy, kbAnatomyImage, kbAnatomyFrame, kbAnatomyAudio, kbAnatomyClip, kbQuizBank, kbFramesIndex, kbVideoFrames, sqlMeta, sqlSelect, listSecrets, revealSecret, warmupDatabases } from './databases.js';
import { registerAccounts } from './accounts.js';
import { getSignals, getFlowRank, getFlowWinners, getMomentum, getMacro, getTradeLedger, getBrief, queryAIME, getTradeDeskOverview } from './trade-desk.js';
import { getSignalMonitor } from './signal-monitor.js';
import { getLiveAppsStatus } from './live-apps.js';
import { getGallery, resolveGalleryFile, galleryMime, invalidateGalleryCache, moveGalleryFile } from './gallery.js';
import { getLewisIntegrations, readLewisFile } from './lewistrading.js';
import { getSkoolBuilds, readSkoolArtifact } from './skoolbuilds.js';
import { getHermesData, getHermesLogs, hermesRestartGateway, hermesSend, hermesOneshot, getHermesStatus, getHermesConfigRedacted, getHermesToolsets } from './hermes.js';
import { listRapidApis, rapidApiSearch } from './rapidapi.js';
import { generateImage } from './generate.js';
import { generateLocalImage, generateLocalVideo, generateKeyframeVideo } from './localgen.js';
import { generateHiggsfield, listHiggsfieldModels } from './higgsfield.js';
import { preflightGate, comfyQueueDepth, comfyFree, notify } from './genguard.js';
import { readManifest, metaFor, upsertMeta, mergeMeta, normalizeFamily, loraCompat, readCurated, enrichedMetaFor, familyFromFilename, ModelMeta } from './modelmeta.js';
import { applyGenRules, loraStrength } from './genrules.js';
import { listLooks, saveUserLook, deleteUserLook } from './looks.js';
import { readControlPanel, applyControl } from './controls.js';
import Database from 'better-sqlite3';
import { listEntries as bunkerList, listArchived as bunkerArchivedList, setPinned as bunkerSetPinned, archiveEntry as bunkerArchive, promoteEntry as bunkerPromote, resolveArtifact as bunkerResolveArtifact, verifyArtifact as bunkerVerifyArtifact } from './bunker.js';
import {
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  updateScheduledTask,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardPinnedMemories,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardConsolidations,
  getDashboardMemoriesList,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getSession,
  getSessionTokenUsage,
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
  getMissionTasks,
  getMissionTask,
  createMissionTask,
  cancelMissionTask,
  deleteMissionTask,
  reassignMissionTask,
  assignMissionTask,
  getUnassignedMissionTasks,
  getMissionTaskHistory,
  getAuditLog,
  getAuditLogCount,
  getRecentBlockedActions,
  listActiveMeetSessions,
  listRecentMeetSessions,
  getMeetSession,
  type MeetSession,
  createWarRoomMeeting,
  endWarRoomMeeting,
  addWarRoomTranscript,
  getWarRoomMeetings,
  getWarRoomTranscript,
  getAllDashboardSettings,
  getDashboardSetting,
  setDashboardSetting,
  insertAuditLog,
  appendAgentFileHistory,
  listAgentFileHistory,
  getAgentFileHistory,
  pruneAgentFileHistory,
  type AgentFileKind,
  insertAgentSuggestion,
  listActiveAgentSuggestions,
  dismissAgentSuggestion,
  markAgentSuggestionActed,
  getRecentlySuggestedSplits,
} from './db.js';
import { computeNextRun } from './scheduler.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { getSecurityStatus } from './security.js';
import {
  AGENT_ID_RE,
  DEFAULT_MAIN_DESCRIPTION,
  agentExists,
  listAgentIds,
  loadAgentConfig,
  resolveAgentDir,
  resolveAgentDisplayName,
  setAgentModel,
  setAgentProvider,
  getMainDescription,
  setMainDescription,
} from './agent-config.js';
import {
  resolveAgentAvatar,
  avatarEtag,
  avatarEtagForId,
  tryFetchTelegramAvatar,
  writeUploadedAvatar,
  deleteUploadedAvatar,
  getMutableAvatarPath,
} from './avatars.js';
import {
  listTemplates,
  validateAgentId,
  validateBotToken,
  createAgent,
  activateAgent,
  deactivateAgent,
  restartAgent,
  deleteAgent,
  suggestBotNames,
  isAgentRunning,
} from './agent-create.js';
import { getSelectedProviderConfig } from './active-provider.js';
import { getMainModelOverride, processMessageFromDashboard } from './bot.js';
import { getDashboardHtml } from './dashboard-html.js';
import { getWarRoomHtml } from './warroom-html.js';
import { getWarRoomPickerHtml } from './warroom-text-picker-html.js';
import { getWarRoomTextHtml } from './warroom-text-html.js';
import { handleTextTurn, cancelMeetingTurns, getRoster, warmupMeeting, isWarmupDone, getActiveTurnIds, waitForMeetingTurnsIdle } from './warroom-text-orchestrator.js';
import { getChannel, closeChannel, startChannelSweeper } from './warroom-text-events.js';
import {
  createTextMeeting,
  getTextMeeting,
  setMeetingPin,
  clearMeetingSessions,
  getOpenTextMeetingIds,
  getTextMeetings,
} from './db.js';
import { messageQueue } from './message-queue.js';
import * as killSwitches from './kill-switches.js';
import { getIngestionQuotaStatus, extractViaProvider } from './memory-ingest.js';
import { WARROOM_ENABLED, WARROOM_PORT, CLAUDE_MODEL_OPUS, CLAUDE_MODEL_SONNET, CLAUDE_MODEL_HAIKU, DEFAULT_OPENROUTER_MODEL } from './config.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';
import { killProcess, isProcessAlive, findProcessesByPattern } from './platform.js';
import { inspectAcpProviderRuntimeOptions, type AcpProviderRuntimeOptions } from './agent-engine/acp-adapter.js';
import { listCharacters, getCharacter, configureCharacter, publishCharacter, trainCommandFor } from './character.js';
import { reviewGen, qaSummary } from './qa.js';

// Static-asset compression cache. Keyed by `${filePath}|${encoding}`; the
// compressed buffer for an immutable content-hashed asset never changes, so
// we compress once and reuse. Bounded naturally by the number of hashed
// assets in dist/web (a new build = new filenames = new keys; stale keys just
// go cold and cost a little memory until process restart).
const _assetCompressCache = new Map<string, Buffer>();
function getCompressedAsset(filePath: string, data: Buffer, enc: 'br' | 'gzip'): Buffer {
  const key = `${filePath}|${enc}`;
  const hit = _assetCompressCache.get(key);
  if (hit) return hit;
  const out = enc === 'br'
    ? zlib.brotliCompressSync(data, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
        },
      })
    : zlib.gzipSync(data, { level: 6 });
  _assetCompressCache.set(key, out);
  return out;
}

// Selectable/valid Claude models for the dashboard pickers and the model-set
// endpoints. The current lineup is derived from the CLAUDE_MODEL_* config
// constants (see config.ts) so an env-driven model bump is picked up here
// without editing this file; older pinned IDs stay valid for agents still on
// them. Deduped so a config value matching a legacy literal isn't listed twice.
const VALID_CLAUDE_MODELS = Array.from(new Set([
  CLAUDE_MODEL_OPUS,
  CLAUDE_MODEL_SONNET,
  CLAUDE_MODEL_HAIKU,
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
]));

const CLAUDE_MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
};

const CLAUDE_MODEL_OPTIONS = VALID_CLAUDE_MODELS.map((id) => ({
  id,
  label: CLAUDE_MODEL_LABELS[id] ?? id,
}));

const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

const CODEX_MODEL_OPTIONS = [
  { id: DEFAULT_CODEX_MODEL, label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  { id: 'gpt-5.2', label: 'GPT-5.2' },
];

const CUSTOM_ACP_MODEL_OPTIONS = [
  { id: 'provider-default', label: 'Provider default' },
];

const CLAUDE_RUNTIME_OPTIONS = [
  { id: 'fast', label: 'Low / fast' },
  { id: 'normal', label: 'Medium / normal' },
  { id: 'deep', label: 'High / deep' },
  { id: 'max', label: 'Max' },
];

const CLAUDE_THINKING_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'off', label: 'Off' },
  { id: 'on', label: 'On' },
];

const CODEX_THINKING_FALLBACK_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];

function fallbackRuntimeOptions(provider: ProviderConfig): AcpProviderRuntimeOptions {
  if (provider.type === 'codex') {
    return {
      provider: provider.type,
      modeOptions: [],
      thinkingOptions: CODEX_THINKING_FALLBACK_OPTIONS,
      rawConfigOptions: [],
      source: 'fallback',
    };
  }
  return {
    provider: provider.type,
    modeOptions: [],
    thinkingOptions: [
      { id: 'auto', label: 'Auto' },
      { id: 'off', label: 'Off' },
      { id: 'on', label: 'On' },
    ],
    rawConfigOptions: [],
    source: 'fallback',
  };
}

function parseProviderArgsQuery(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
  } catch { /* fall through to shell-ish split */ }
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^["']|["']$/g, '')) ?? [];
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function getOpenCodeModels(): Array<{ id: string; label: string }> {
  const result = spawnSync('opencode', ['models'], { stdio: 'pipe', encoding: 'utf-8', windowsHide: true });
  if (result.status !== 0) return [];
  return stripAnsi(result.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(line))
    .map((id) => ({ id, label: id }));
}

// In-memory cache for OpenRouter /models (5-minute TTL). The dashboard hits
// /api/providers/models on every Settings page load, so we don't want to call
// OpenRouter for every poll. Cache survives only as long as the process.
const openRouterModelsCache: { fetchedAt: number; models: Array<{ id: string; label: string }> } = {
  fetchedAt: 0,
  models: [],
};
const OPENROUTER_MODELS_TTL_MS = 5 * 60 * 1000;

async function fetchOpenRouterModels(): Promise<Array<{ id: string; label: string }>> {
  const now = Date.now();
  if (openRouterModelsCache.models.length > 0 && now - openRouterModelsCache.fetchedAt < OPENROUTER_MODELS_TTL_MS) {
    return openRouterModelsCache.models;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Accept: 'application/json' },
      // Keep this short — the dashboard shouldn't block on a slow network.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return openRouterModelsCache.models; // serve stale on transient failure
    const data = await res.json() as { data?: Array<{ id?: string; name?: string }> };
    const models = (data.data ?? [])
      .map((m) => ({ id: typeof m.id === 'string' ? m.id : '', label: typeof m.id === 'string' ? m.id : '' }))
      .filter((m) => m.id.length > 0)
      .sort((a, b) => {
        // Free tier first for discoverability, then alphabetic.
        const aFree = a.id.endsWith(':free');
        const bFree = b.id.endsWith(':free');
        if (aFree !== bFree) return aFree ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
    openRouterModelsCache.fetchedAt = now;
    openRouterModelsCache.models = models;
    return models;
  } catch {
    return openRouterModelsCache.models; // serve stale on error
  }
}

function getOpenCodeDefaultModel(): string | undefined {
  const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc');
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const raw = JSON.parse(content) as Record<string, unknown>;
    return typeof raw.model === 'string' ? raw.model : undefined;
  } catch {
    return undefined;
  }
}

function getProviderStatus() {
  // Use getSelectedProviderConfig so the dashboard reflects the EFFECTIVE
  // runtime engine, not the stored config. When ENABLE_ACP=false, the gate
  // forces Claude regardless of what's in main-config.json, and the sidebar
  // should show that truth instead of a stale Gemini/OpenCode label.
  const provider = getSelectedProviderConfig();
  const model = provider.type === 'claude'
    ? (getMainModelOverride() ?? provider.model ?? agentDefaultModel ?? DEFAULT_CLAUDE_MODEL)
    : provider.type === 'opencode'
      ? (provider.model ?? getOpenCodeDefaultModel() ?? 'OpenCode default')
      : provider.type === 'gemini'
        ? (provider.model ?? 'Gemini CLI default')
        : provider.type === 'codex'
          ? (provider.model ?? DEFAULT_CODEX_MODEL)
      : (provider.model ?? (provider.command ? `${provider.command}${provider.args?.length ? ` ${provider.args.join(' ')}` : ''}` : 'Provider default'));

  return {
    provider,
    providerType: provider.type,
    label: provider.type === 'claude'
      ? 'Claude'
      : provider.type === 'opencode'
        ? 'OpenCode'
        : provider.type === 'gemini'
          ? 'Gemini'
          : provider.type === 'codex'
            ? 'Codex'
            : provider.type === 'openrouter'
              ? 'OpenRouter'
              : 'ACP',
    runtime: getProviderDisplay(provider),
    model,
    // Surfaced so the dashboard can hide the provider picker when the
    // beta ACP feature is off. Single source of truth for the UI.
    acpEnabled: ENABLE_ACP,
  };
}

function validateProviderConfig(provider: ProviderConfig): string | null {
  if (provider.type === 'acp' && !provider.command?.trim()) {
    return 'Custom ACP provider requires a command';
  }
  return null;
}

async function classifyTaskAgent(prompt: string): Promise<string | null> {
  const agentIds = listAgentIds();
  const validAgents = ['main', ...agentIds];
  const agentDescriptions = agentIds.map((id) => {
    try {
      const config = loadAgentConfig(id);
      return `- ${id}: ${config.description}`;
    } catch { return `- ${id}: (no description)`; }
  });

  const classificationPrompt = `Given these agents and their roles:
- main: Primary assistant, general tasks, anything that doesn't clearly fit another agent
${agentDescriptions.join('\n')}

Which ONE agent is best suited for this task?
Task: "${prompt.slice(0, 500)}"

Reply with JSON: {"agent": "agent_id"}`;

  // Primary path: selected provider via the agent engine. Gemini fallback
  // can hit 429 and surface a 500, blocking the auto-assign UI.
  try {
    const raw = await extractViaProvider(classificationPrompt);
    const parsed = parseJsonResponse<{ agent: string }>(raw);
    if (parsed?.agent && validAgents.includes(parsed.agent)) return parsed.agent;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'selected-provider classify failed, falling back to Gemini');
  }

  // Fallback: Gemini. Wrapped so a 429 doesn't bubble up — we'd rather
  // assign to 'main' than fail the request.
  try {
    const response = await generateContent(classificationPrompt);
    const parsed = parseJsonResponse<{ agent: string }>(response);
    if (parsed?.agent && validAgents.includes(parsed.agent)) return parsed.agent;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Gemini classify failed, defaulting to main');
  }
  return 'main';
}

// Meeting id format: wr_<timestampBase36>_<6-hex-random>. Regex also allows
// the same shape without the hex suffix in case an id is created manually
// in tests. Validated on every route that takes meetingId.
const WARROOM_TEXT_ID_RE = /^wr_[a-z0-9_]{4,64}$/i;
// Browser crypto.randomUUID() produces lowercase v4 UUIDs. Accept either case.
const CLIENT_MSG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Constant-time token comparison (audit fix A4E-1, ported from fork).
// Plain `===` leaks timing info that lets a remote attacker recover the token
// one byte at a time. timingSafeEqual takes O(n) regardless of where the
// mismatch occurs. Length pre-check prevents a panic on differing buffers.
function safeTokenEqual(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ── mc-access (fleet password gate) helpers ─────────────────────────────────
// Master passphrases are read from disk at REQUEST time so `mc-grant set-password`
// takes effect with no rebuild/restart. /home/ubuntu → /home/itsju (symlink).
// MULTIPLE values supported (newline / comma / semicolon separated) — ANY one
// unlocks, so outsiders can't tell which of the N strings is "the" password.
function readMasterPasswords(): string[] {
  let raw = '';
  for (const p of [
    '/home/itsju/.openclaw/secrets/mc-access-password',
    '/home/ubuntu/.openclaw/secrets/mc-access-password',
  ]) {
    try { const v = fs.readFileSync(p, 'utf-8').trim(); if (v) { raw = v; break; } } catch { /* next */ }
  }
  if (!raw) raw = (process.env.MC_ACCESS_PASSWORD || '').trim();
  return raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}
function safeStrEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

/**
 * Build the dashboard Hono app without binding it to a port. Exported for
 * contract tests so the route surface can be exercised via `app.request()`
 * without standing up a real server. Production callers should use
 * `startDashboard` instead, which builds the app then serves it.
 */
export function buildDashboardApp(botApi?: Api<RawApi>): Hono {
  const app = new Hono();

  // Hosts always trusted for CORS reflection + CSRF, on top of the
  // configured DASHBOARD_URL host. Loopback plus the Tailscale mesh
  // (CGNAT IP + MagicDNS) — both tailnet-scoped, so a foreign web origin
  // can never present them. This is how the dashboard is opened from phone/LAN.
  const allowedOriginHost = (() => {
    const raw = (DASHBOARD_URL || '').trim();
    if (!raw) return '';
    try { return new URL(raw).hostname; } catch { return ''; }
  })();
  const STATIC_TRUSTED_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    '100.91.39.122',              // Tailscale IP
    'g59-wsl.taile1328b.ts.net',  // Tailscale MagicDNS
  ]);
  const isTrustedHost = (host: string): boolean =>
    STATIC_TRUSTED_HOSTS.has(host) ||
    (!!allowedOriginHost && host === allowedOriginHost);

  // CORS headers for cross-origin access (Cloudflare tunnel, mobile browsers).
  // Reflect Origin only when it matches a known-good host (audit fix A4E-3,
  // ported from fork). Wildcard `*` is functionally equivalent to "trust
  // anyone" for credentialed reads of authenticated endpoints; pinning to
  // an allowlist closes that surface. The CSRF middleware below provides
  // the second layer of defense for state-changing requests.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin) {
      try {
        const host = new URL(origin).hostname;
        const allowed =
          isTrustedHost(host) ||
          host.endsWith('.trycloudflare.com');
        if (allowed) {
          c.header('Access-Control-Allow-Origin', origin);
          c.header('Vary', 'Origin');
        }
      } catch { /* malformed Origin — emit no header */ }
    }
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Security headers (defense-in-depth on top of token-in-URL auth).
  //
  //   Referrer-Policy: no-referrer
  //     User clicks an external link from inside the dashboard or war
  //     room — the browser must NOT send `?token=...` via the Referer
  //     header to the destination. Without this header, that's a clear
  //     leak vector for any agent reply that contains a hyperlink.
  //
  //   X-Content-Type-Options: nosniff
  //     Stops MIME-sniff XSS on uploaded assets. Dashboard mostly
  //     serves JSON + HTML, but the favicon and avatar routes return
  //     binary; sniff-XSS is a real class.
  //
  //   X-Frame-Options: DENY
  //     The dashboard should never be embedded in an iframe. Without
  //     this, a phisher with the token-in-URL can embed the dashboard
  //     in a frame and overlay clickjacking UI.
  //
  //   Cache-Control: no-store on authenticated API responses
  //     Memory contents, transcript snippets, and conversation history
  //     are sensitive. Default Hono caching can leak them via shared
  //     proxy caches (Cloudflare, corp proxies). Set no-store on every
  //     API response by default; static favicon already overrides.
  app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    await next();
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/')) {
      // After next() so any handler-set Cache-Control would have run; we
      // override here to enforce no-store on API JSON.
      c.header('Cache-Control', 'no-store');
    }
  });

  // Global error handler — prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Request logging middleware — logs method, path, IP, user agent, auth result
  app.use('*', async (c, next) => {
    const start = Date.now();
    const ip = c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const ua = c.req.header('user-agent') || 'unknown';
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    await next();

    const status = c.res.status;
    const ms = Date.now() - start;
    const level = status === 401 || status === 403 ? 'warn' : 'info';
    logger[level](
      { method, path, status, ip, ua, ms },
      `Dashboard ${method} ${path} ${status}`
    );
  });

  // Serve favicon BEFORE the token middleware so browsers don't spam
  // 401 errors in the console. Returns a 1x1 transparent PNG.
  const FAVICON_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  app.get('/favicon.ico', (c) => new Response(FAVICON_BYTES, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  }));

  // Token auth middleware.
  //
  // Strategy: the v2 SPA does client-side routing across many paths
  // (/mission, /scheduled, /agents, /agents/:id/files, /chat,
  // /memories, /hive, /usage, /audit, /settings, /warroom, /). When a
  // user refreshes any of those URLs the server sees a real GET to
  // that path. None of those response bodies contain secrets — they're
  // all the same SPA shell index.html, which reads the token from
  // window.location at runtime.
  //
  // So the rule is simple: GATE THE API. Everything else passes through
  // the middleware, and the handlers fall through to the SPA-shell
  // catch-all unless an earlier route matched. Legacy HTML routes that
  // DO embed the token (warroom?mode=picker|voice, /warroom/text,
  // / under DASHBOARD_LEGACY=true) call requireToken() inline.
  // ── Fleet-wide password gate (mc-access) ──────────────────────────────────
  // Was: gate /api/* by DASHBOARD_TOKEN only (SPA shell + deep links rendered
  // unauthenticated, relying on the API 401 + re-auth overlay). Now the WHOLE
  // surface is gated so a bookmark/deep-link can't render before auth, and the
  // credential is the shared `mc_access` cookie — one login unlocks missionctrl
  // + aries + claudeclaw because cookies ignore port.
  //
  // Trust model: LOCAL = trusted, REMOTE = password. Loopback is judged by the
  // real socket peer (c.env.incoming.socket.remoteAddress) — NOT headers, which
  // are spoofable here since Hono sits behind no trusted proxy. So the laptop on
  // localhost is never prompted and local automation/cron keep working; a phone
  // over Tailscale gets the password once, then the cookie remembers it.
  //
  // Authorized if: gate disabled / no secret (fail-open so a misconfig can't
  // brick local use) OR loopback OR a valid mc_access cookie OR a valid
  // claudeclaw_token (query or cookie — keeps existing scripts + the ?token=
  // bookmark working and bridges the legacy token into an mc_access session).
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // The mc-access gate is INDEPENDENT of the legacy DASHBOARD_AUTH_DISABLED flag
    // (which only ever governed the old token-only /api/* check). It's currently
    // 'true' in .env, so honoring it here would leave claudeclaw wide open — the
    // gate's only off-switches are MC_ACCESS_DISABLED or a missing secret.
    const gateOff = MC_ACCESS_DISABLED || !MC_ACCESS_SECRET;

    const remoteAddr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
      ?.incoming?.socket?.remoteAddress;
    // Behind the Tailscale Serve HTTPS proxy the upstream socket is ALWAYS 127.0.0.1,
    // so a bare socket check would treat every phone/remote request as local and skip
    // the password gate. Serve forwards the real client (tailnet) IP in x-forwarded-for,
    // so only count a loopback socket as LOCAL when there's no non-loopback forwarded
    // client. A DIRECT LAN hit has a non-loopback SOCKET (unspoofable) → still gated.
    const socketLocal = isLoopbackAddr(remoteAddr);
    const xffClient = (c.req.header('x-forwarded-for') || '').split(',')[0].trim();
    const proxiedRemote = socketLocal && !!xffClient && !isLoopbackAddr(xffClient);
    const local = socketLocal && !proxiedRemote;

    const mc = MC_ACCESS_SECRET
      ? await verifyToken(getCookie(c, MC_COOKIE), MC_ACCESS_SECRET)
      : null;

    // The mc_access cookie (set after entering any one of the fleet master
    // passwords — see readMasterPasswords) is the SOLE credential (Mike's call
    // 06-17). The legacy DASHBOARD_TOKEN no longer authenticates the site. Local
    // scripts reach claudeclaw over loopback, which stays open.
    const authed = gateOff || local || !!mc;

    // Slide the master cookie so the device stays remembered.
    if (MC_ACCESS_SECRET && mc && mc.kind === 'master') {
      try {
        setCookie(c, MC_COOKIE, await masterToken(MC_ACCESS_SECRET), {
          httpOnly: true, sameSite: 'Lax', path: '/', maxAge: MASTER_TTL_SEC,
        });
      } catch { /* maxAge pinned ≤400d; setCookie throws only above the ceiling */ }
    }

    if (authed) { await next(); return; }

    // Unauthorized: allow the login surface + static assets through so the
    // password page (and, post-login, the SPA) can load; block everything else.
    const isOpen =
      path === '/favicon.ico' ||
      path === '/login' ||
      path.startsWith('/api/mc-login') ||
      path.startsWith('/api/mc-logout') ||
      // Massage Admin Google sign-in: the OAuth start + callback must be reachable
      // WITHOUT an existing session (that's how a remote admin authenticates). The
      // callback itself only mints a session for an allow-listed, verified email.
      path === '/massage-admin/login' ||
      path.startsWith('/massage-admin/oauth/') ||
      // Bunker artifact files carry their OWN per-slug scoped capability
      // (?t=&exp=, verified in the handler), so they must NOT require the
      // master mc-access session — that's the whole point of not shipping the
      // master credential inside artifact URLs.
      path.startsWith('/api/bunker-files/') ||
      path.startsWith('/assets/') ||
      /\.(glb|gltf|bin|ktx2|wasm|svg|webmanifest|png|ico|css|js|map|woff2?|ttf)$/i.test(path);
    if (isOpen) { await next(); return; }

    if (path.startsWith('/api/')) return c.json({ error: 'Unauthorized' }, 401);
    const back = encodeURIComponent(path + (new URL(c.req.url).search || ''));
    return c.redirect(`/login?next=${back}`, 302);
  });

  // ── Login surface (allowlisted in the gate above) ─────────────────────────
  app.get('/login', (c) => {
    const nextUrl = c.req.query('next') || '/';
    const err = c.req.query('error') ? 'Wrong password — try again.' : '';
    return c.html(mcLoginPage(nextUrl, err));
  });

  // Fire-and-forget login audit → aries' shared LoginEvent table (Postgres) via its
  // loopback /api/login-event sink. NEVER blocks the login. Same secret-guarded sink
  // missionctrl uses; claudeclaw already holds MC_ACCESS_SECRET.
  const logFleetLogin = (ev: Record<string, unknown>): void => {
    try {
      if (!MC_ACCESS_SECRET) return;
      void fetch('http://127.0.0.1:1337/api/login-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mc-secret': MC_ACCESS_SECRET },
        body: JSON.stringify({ appName: 'claudeclaw', ...ev }),
      }).catch(() => {});
    } catch { /* never block login on audit */ }
  };

  // Accepts: POST form (password page), POST JSON (programmatic), or GET with
  // ?guest=<signed-token> (tap-to-unlock guest links). On success sets mc_access.
  app.on(['GET', 'POST'], '/api/mc-login', async (c) => {
    let password = c.req.query('password') || '';
    let nextUrl = c.req.query('next') || '/';
    const guest = c.req.query('guest') || '';
    const isJson = (c.req.header('content-type') || '').includes('application/json');
    if (c.req.method === 'POST') {
      if (isJson) {
        const b = await c.req.json().catch(() => ({} as Record<string, string>));
        password = b.password || password;
        nextUrl = b.next || nextUrl;
      } else {
        const b = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
        password = (b.password as string) || password;
        nextUrl = (b.next as string) || nextUrl;
      }
    }
    // Same-origin path only (no open redirect).
    if (!nextUrl.startsWith('/') || nextUrl.startsWith('//')) nextUrl = '/';

    let kind: 'master' | 'guest' | null = null;
    let exp = 0;
    let label: string | undefined;
    const candidate = guest || password;
    if (MC_ACCESS_SECRET && candidate.includes('.')) {
      const v = await verifyToken(candidate, MC_ACCESS_SECRET);
      if (v && v.kind === 'guest') { kind = 'guest'; exp = v.exp; label = v.label; }
    }
    if (!kind && password) {
      // Master passwords are case-INSENSITIVE by design (Mike's call) and MULTIPLE
      // values are accepted — ANY one unlocks. Guest tokens above stay exact (HMAC).
      // Lowercasing preserves length for the timing-safe cmp.
      const pw = password.toLowerCase();
      if (readMasterPasswords().some((m) => safeStrEqual(pw, m.toLowerCase()))) kind = 'master';
    }

    const ip = (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || null;
    const ua = c.req.header('user-agent') || null;

    if (!kind) {
      logFleetLogin({ authMethod: guest ? 'guest' : 'password', status: 'failure', failureReason: 'invalid_credentials', ipAddress: ip, userAgent: ua });
      if (isJson) return c.json({ error: 'Access denied' }, 401);
      return c.redirect(`/login?error=1&next=${encodeURIComponent(nextUrl)}`, 302);
    }
    logFleetLogin({ authMethod: kind === 'guest' ? 'guest' : 'password', accountId: kind === 'guest' ? (label ?? 'guest') : null, status: 'success', ipAddress: ip, userAgent: ua });

    if (MC_ACCESS_SECRET) {
      if (kind === 'master') {
        setCookie(c, MC_COOKIE, await masterToken(MC_ACCESS_SECRET), {
          httpOnly: true, sameSite: 'Lax', path: '/', maxAge: MASTER_TTL_SEC,
        });
      } else {
        const ttl = Math.max(1, exp - nowSec());
        setCookie(c, MC_COOKIE, await signToken({ exp, kind: 'guest', label }, MC_ACCESS_SECRET), {
          httpOnly: true, sameSite: 'Lax', path: '/', maxAge: ttl,
        });
      }
    }
    if (isJson) return c.json({ ok: true, next: nextUrl });
    return c.redirect(nextUrl, 302);
  });

  app.on(['GET', 'POST'], '/api/mc-logout', (c) => {
    deleteCookie(c, MC_COOKIE, { path: '/' });
    deleteCookie(c, 'claudeclaw_token', { path: '/' });
    return c.redirect('/login', 302);
  });

  // Inline token check for handlers that USED to rely on the global
  // middleware but now serve a public SPA shell on the same path. Used
  // by legacy fallbacks that DO embed the token in the page source.
  function requireToken(_c: any): Response | null {
    // Auth is enforced upstream by the global mc-access gate (app.use('*')); any
    // request reaching a legacy handler has already passed it. No-op kept for the
    // legacy call sites (legacy GET / under DASHBOARD_LEGACY, warroom HTML routes).
    return null;
  }

  async function requireMassageAdmin(c: any): Promise<{ ok: true; adminUser: string } | { ok: false; status: number; error: string }> {
    const remoteAddr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
      ?.incoming?.socket?.remoteAddress;
    const socketLocal = isLoopbackAddr(remoteAddr);
    const xffClient = (c.req.header('x-forwarded-for') || '').split(',')[0].trim();
    const proxiedRemote = socketLocal && !!xffClient && !isLoopbackAddr(xffClient);
    const local = socketLocal && !proxiedRemote;
    if (local) return { ok: true, adminUser: 'local-loopback' };

    if (!MC_ACCESS_SECRET) {
      return { ok: false, status: 403, error: 'admin auth is not configured for remote writes' };
    }
    const mc = await verifyToken(getCookie(c, MC_COOKIE), MC_ACCESS_SECRET);
    if (!mc) return { ok: false, status: 401, error: 'not authenticated' };
    if (mc.kind !== 'master') return { ok: false, status: 403, error: 'admin access requires a master session' };
    // "Both" mode (Mike's call 2026-07-02): a valid master session — which requires
    // being ON the tailnet AND holding the fleet password — may edit. Signing in via
    // Google (/massage-admin/login) is OPTIONAL and only upgrades the audit attribution
    // from a generic 'mc_master(remote)' to the specific allow-listed admin email.
    const adminUser = isAllowlistedAdmin(mc.user?.email)
      ? (mc.user!.email as string)
      : (mc.user?.name || mc.label || 'mc_master(remote)');
    return { ok: true, adminUser };
  }

  // Mutation kill-switch middleware. When DASHBOARD_MUTATIONS_ENABLED is
  // off, every non-GET request returns 503 — the runbook's promise is
  // "flip this to put the dashboard in read-only mode during an incident."
  // GET routes (including /api/health) keep working so an operator can
  // diagnose. This MUST run before route handlers so the per-route checks
  // I scattered earlier (now removed) can't be the only line of defense.
  const mutationReadonlyExempt = new Set<string>([
    // Add safe-recovery POST endpoints here if needed; none today.
  ]);
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    const path = new URL(c.req.url).pathname;
    if (mutationReadonlyExempt.has(path)) {
      await next();
      return;
    }
    if (!killSwitches.isEnabled('DASHBOARD_MUTATIONS_ENABLED')) {
      logger.warn({ method, path }, 'mutation refused: DASHBOARD_MUTATIONS_ENABLED off');
      return c.json({ error: 'mutations disabled (incident kill switch)' }, 503);
    }
    await next();
  });

  // CSRF / origin enforcement on state-changing requests.
  //
  // Without this, a malicious page that captured the token (browser
  // history, referer leak, share-link paste) can issue cross-origin
  // POSTs and weaponize the session — wildcard CORS plus token-in-URL
  // is a CSRF foundation. Browsers send `Origin` on cross-origin
  // POST/PATCH/DELETE; we reject if it isn't on our allowlist.
  //
  // Allowlist:
  //   - missing Origin (same-origin form posts, fetch from same page,
  //     curl/CLI tools that don't set Origin) → allow
  //   - localhost / 127.0.0.1 / loopback hostnames → always allow
  //   - DASHBOARD_URL value (if set) → allow if request Origin's host
  //     matches the configured URL's host
  //
  // Operators exposing via Cloudflare tunnel set DASHBOARD_URL to the
  // tunnel URL; everything else is rejected.
  // Read from the config constant (which checks process.env AND the
  // .env file via readEnvFile), not process.env directly. launchd
  // doesn't populate process.env from .env, so process.env.DASHBOARD_URL
  // is empty under the production daemon — meaning every cross-origin
  // POST 403'd from the Cloudflare tunnel even though .env had the
  // right URL.
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    const origin = c.req.header('origin');
    if (origin) {
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* malformed */ }
      // Note: 0.0.0.0 was previously in this allowlist but is a bind
      // address, never a valid Origin header any browser would send.
      // Removed (audit fix A4E-3 follow-on, ported from fork-side review).
      const allowed = isTrustedHost(host);
      if (!allowed) {
        logger.warn({ origin, method, path: new URL(c.req.url).pathname }, 'CSRF: rejected cross-origin request');
        return c.json({ error: 'cross-origin request rejected' }, 403);
      }
    } else {
      // No Origin header. Browsers ALWAYS send Origin on cross-origin
      // state-changing requests, so a missing Origin is normally a
      // same-origin post or a non-browser client (curl/CLI). Honor
      // Sec-Fetch-Site so a browser request that stripped Origin can't
      // slip past: if the browser says this came cross-site, reject it.
      // curl/CLI send no Sec-Fetch-Site, so they still pass.
      const sfs = (c.req.header('sec-fetch-site') || '').toLowerCase();
      if (sfs === 'cross-site' || sfs === 'cross-origin') {
        logger.warn({ method, sfs, path: new URL(c.req.url).pathname }, 'CSRF: rejected cross-site request (no Origin)');
        return c.json({ error: 'cross-origin request rejected' }, 403);
      }
    }
    await next();
  });

  // Phone portal — a static landing page listing all services by Tailscale IP.
  // Bookmark http://100.91.39.122:3141/portal on the phone.
  app.get('/portal', (c) => {
    const ts = '100.91.39.122';
    const services = [
      { name: 'ClaudeClaw',     port: 3141, path: '/',          desc: 'AI agent dashboard + gallery' },
      { name: 'ARIES',          port: 1337, path: '/',          desc: 'Trading PWA — broker + strategy engine' },
      { name: 'MissionCtrl V2', port: 3000, path: '/',          desc: 'Main MC trading dashboard' },
      { name: 'Vibe Trading',   port: 8899, path: '/',          desc: 'AI trading research & backtesting' },
      { name: 'Kronos',         port: 7070, path: '/',          desc: 'ML model training & forecast WebUI' },
      { name: 'n8n',            port: 5678, path: '/',          desc: 'Workflow automation' },
      { name: 'Mobile Hub',     port: 8443, path: '/',          desc: 'Mobile launchpad (HTTPS)', https: true },
      { name: 'Uptime Kuma',    port: 3001, path: '/',          desc: 'Service health monitor' },
      { name: 'Gallery',        port: 3141, path: '/#/gallery',      desc: 'Nano Banana generations' },
      { name: 'Token Dashboard', port: 3141, path: '/token-dashboard', desc: 'Per-prompt cost analytics & cache stats' },
      { name: 'CLI Tools',       port: 3141, path: '/cli-tools',       desc: 'Printing Press Library + CLI-Anything inventory' },
      { name: 'Accounts',        port: 3141, path: '/accounts',        desc: 'Users per product (ARIES / MissionCtrl / Massage) — read-only' },
    ];
    const rows = services.map(s =>
      `<a href="${(s as any).https ? 'https' : 'http'}://${ts}:${s.port}${s.path}" class="card">
        <div class="name">${s.name} <span class="port">:${s.port}</span></div>
        <div class="desc">${s.desc}</div>
      </a>`
    ).join('');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="mobile-web-app-capable" content="yes">
<title>Mission Control — Portal</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080d12;color:#c9d1da;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:20px}
  h1{font-size:18px;font-weight:700;color:#7fd1ff;margin-bottom:4px;letter-spacing:.5px}
  .sub{font-size:12px;color:#3d5a6e;margin-bottom:20px;font-family:monospace}
  .grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
  .card{display:block;background:#0e1824;border:1px solid #1a2b38;border-radius:12px;padding:14px;text-decoration:none;transition:border-color .15s,transform .1s;-webkit-tap-highlight-color:transparent}
  .card:active{transform:scale(.97);border-color:#7fd1ff}
  .name{font-size:15px;font-weight:700;color:#e2e8f0;margin-bottom:4px}
  .port{font-size:11px;color:#3d8fad;font-family:monospace;font-weight:400}
  .desc{font-size:11px;color:#4a6070;line-height:1.4}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:6px;vertical-align:middle}
  footer{margin-top:24px;font-size:11px;color:#1e3040;text-align:center;font-family:monospace}
</style></head><body>
<h1>&#127968; Mission Control</h1>
<div class="sub"><span class="dot"></span>g59-wsl · ${ts} · ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'})} ET</div>
<div class="grid">${rows}</div>
<footer>Tailscale mesh · add to home screen for quick access</footer>
</body></html>`;
    return c.html(html);
  });

  // CLI Tools — Printing Press Library catalog + CLI-Anything inventory.
  // Reads ~/printing-press-library/registry.json and detects installed CLIs.
  app.get('/api/cli-tools', (c) => {
    const HOME = os.homedir();
    const registryPath = path.join(HOME, 'printing-press-library', 'registry.json');
    const skillsDir = path.join(HOME, '.claude', 'skills');
    const cliAnythingDir = path.join(HOME, 'CLI-Anything');

    // Load registry
    let entries: any[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      entries = raw.entries || [];
    } catch { /* repo not cloned */ }

    // Installed skill names (lowercased)
    const installedSkills = new Set<string>();
    try {
      fs.readdirSync(skillsDir).forEach(s => installedSkills.add(s.toLowerCase()));
    } catch { /* ignore */ }

    // Mark each entry installed if skill matches pp-<name> or <name>
    const catalog = entries.map((e: any) => {
      const key = (e.name || '').toLowerCase();
      const installed = installedSkills.has(`pp-${key}`) || installedSkills.has(key);
      return { ...e, installed };
    });

    // Scan CLI-Anything for generated CLIs (dirs with cli.py or main.py or README.md but not meta dirs)
    const META_DIRS = new Set(['cli-anything-plugin','cli-hub','cli-hub-meta-skill','codex-skill',
      'hermes-skill','qoder-plugin','skill_generation','skills','docs','assets','templates',
      'commands','tests','scripts','guides','seaclip','macrocli']);
    let cliAnythingCLIs: { name: string; hasReadme: boolean; hasCli: boolean }[] = [];
    try {
      cliAnythingCLIs = fs.readdirSync(cliAnythingDir)
        .filter(d => {
          if (META_DIRS.has(d)) return false;
          const full = path.join(cliAnythingDir, d);
          try { return fs.statSync(full).isDirectory(); } catch { return false; }
        })
        .map(d => {
          const full = path.join(cliAnythingDir, d);
          const hasCli = fs.existsSync(path.join(full, 'cli.py')) ||
                         fs.existsSync(path.join(full, 'main.py')) ||
                         fs.existsSync(path.join(full, 'cli'));
          const hasReadme = fs.existsSync(path.join(full, 'README.md'));
          return { name: d, hasReadme, hasCli };
        });
    } catch { /* ignore */ }

    const installedCount = catalog.filter((e: any) => e.installed).length;
    return c.json({ catalog, installedCount, cliAnythingCLIs });
  });

  app.get('/cli-tools', (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CLI Tools — ClaudeClaw</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f0f0f; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-direction: column; min-height: 100vh; }
  .topbar { display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: #141414; border-bottom: 1px solid #2a2a2a; flex-shrink: 0; position: sticky; top: 0; z-index: 20; }
  .back-btn { background: none; border: 1px solid #2a2a2a; border-radius: 6px; color: #9ca3af; font-size: 12px; padding: 4px 10px; cursor: pointer; text-decoration: none; transition: border-color 0.15s, color 0.15s; }
  .back-btn:hover { border-color: #4f46e5; color: #a5b4fc; }
  .topbar-title { font-size: 13px; font-weight: 600; color: #e0e0e0; flex: 1; }
  .stat-chip { font-size: 11px; color: #6b7280; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 4px; padding: 2px 8px; }
  .stat-chip b { color: #a5b4fc; }
  main { flex: 1; padding: 16px; max-width: 1200px; width: 100%; margin: 0 auto; }
  .controls { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
  .search { flex: 1; min-width: 200px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; color: #e0e0e0; font-size: 13px; padding: 8px 12px; outline: none; }
  .search:focus { border-color: #4f46e5; }
  .cat-pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid #2a2a2a; background: #1a1a1a; color: #6b7280; transition: all 0.15s; user-select: none; }
  .pill:hover, .pill.active { background: #312e81; border-color: #4f46e5; color: #a5b4fc; }
  .pill.installed-filter.active { background: #064e3b; border-color: #10b981; color: #6ee7b7; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 12px; transition: border-color 0.15s; }
  .card:hover { border-color: #3a3a4a; }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .card-name { font-size: 13px; font-weight: 700; color: #e0e0e0; }
  .card-cat { font-size: 10px; color: #6b7280; background: #111; border: 1px solid #222; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
  .card-desc { font-size: 11px; color: #9ca3af; line-height: 1.5; margin-bottom: 8px; }
  .card-footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge-mcp { font-size: 10px; background: #1e3a5f; color: #60a5fa; border-radius: 4px; padding: 2px 6px; }
  .badge-installed { font-size: 10px; background: #064e3b; color: #6ee7b7; border-radius: 4px; padding: 2px 6px; }
  .badge-api { font-size: 10px; background: #2a1a3a; color: #a78bfa; border-radius: 4px; padding: 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
  .install-cmd { font-size: 10px; font-family: monospace; color: #6b7280; background: #111; border: 1px solid #1e1e1e; border-radius: 4px; padding: 2px 6px; cursor: pointer; transition: color 0.15s, border-color 0.15s; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .install-cmd:hover { color: #a5b4fc; border-color: #4f46e5; }
  .install-cmd.copied { color: #6ee7b7; border-color: #10b981; }
  .section-title { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
  .divider { border: none; border-top: 1px solid #1e1e1e; margin: 24px 0; }
  .cli-anything-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .cli-chip { background: #1a1a2a; border: 1px solid #2a2a3a; border-radius: 6px; padding: 4px 10px; font-size: 11px; color: #a5b4fc; }
  .cli-chip.has-cli { border-color: #3a2a5a; color: #c4b5fd; }
  .empty { text-align: center; color: #6b7280; padding: 40px; grid-column: 1/-1; font-size: 13px; }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="topbar">
  <a href="/" class="back-btn">&#8592; ClaudeClaw</a>
  <span class="topbar-title">CLI Tools</span>
  <span class="stat-chip" id="stat-showing"></span>
  <span class="stat-chip"><b id="stat-installed">-</b> installed</span>
  <span class="stat-chip"><b id="stat-total">-</b> total</span>
</div>
<main>
  <div class="controls">
    <input class="search" id="search" placeholder="Search CLIs…" oninput="applyFilters()" autocomplete="off">
    <div class="cat-pills" id="cat-pills"></div>
    <span class="pill installed-filter" id="pill-installed" onclick="toggleInstalled()">Installed only</span>
  </div>
  <div class="grid" id="grid"></div>
  <hr class="divider">
  <div class="section-title">CLI-Anything — locally generated CLIs</div>
  <div class="cli-anything-grid" id="cli-anything-grid"></div>
</main>
<script>
let ALL = [];
let activeCat = 'all';
let installedOnly = false;

function copyCmd(el, cmd) {
  navigator.clipboard.writeText(cmd).then(() => {
    el.textContent = 'copied!';
    el.classList.add('copied');
    setTimeout(() => { el.textContent = cmd; el.classList.remove('copied'); }, 1500);
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderCard(e) {
  const cmd = \`npx skills add mvanhorn/printing-press-library/cli-skills/pp-\${e.name} -g -y\`;
  const mcp = e.mcp && e.mcp.tool_count ? \`<span class="badge-mcp">MCP \${e.mcp.tool_count} tools</span>\` : '';
  const inst = e.installed ? '<span class="badge-installed">&#10003; installed</span>' : '';
  const api = e.api ? \`<span class="badge-api" title="\${esc(e.api)}">\${esc(e.api)}</span>\` : '';
  const desc = (e.description || '').length > 120 ? e.description.slice(0,117)+'…' : (e.description || '');
  return \`<div class="card" data-name="\${esc(e.name)}" data-cat="\${esc(e.category)}" data-installed="\${e.installed}">
  <div class="card-head">
    <span class="card-name">\${esc(e.name)}</span>
    <span class="card-cat">\${esc(e.category)}</span>
  </div>
  <div class="card-desc">\${esc(desc)}</div>
  <div class="card-footer">
    \${inst}\${mcp}\${api}
    <span class="install-cmd" title="Click to copy install command" onclick="copyCmd(this, \${JSON.stringify(cmd)})">\${esc(cmd)}</span>
  </div>
</div>\`;
}

function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  const grid = document.getElementById('grid');
  let visible = 0;
  const cards = grid.querySelectorAll('.card');
  cards.forEach(card => {
    const name = card.dataset.name || '';
    const cat = card.dataset.cat || '';
    const installed = card.dataset.installed === 'true';
    const matchQ = !q || name.includes(q) || cat.includes(q) || card.querySelector('.card-desc').textContent.toLowerCase().includes(q);
    const matchCat = activeCat === 'all' || cat === activeCat;
    const matchInst = !installedOnly || installed;
    const show = matchQ && matchCat && matchInst;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('stat-showing').innerHTML = '<b>' + visible + '</b> shown';
}

function setCat(cat) {
  activeCat = cat;
  document.querySelectorAll('.pill[data-cat]').forEach(p => p.classList.toggle('active', p.dataset.cat === cat));
  applyFilters();
}

function toggleInstalled() {
  installedOnly = !installedOnly;
  document.getElementById('pill-installed').classList.toggle('active', installedOnly);
  applyFilters();
}

async function init() {
  const res = await fetch('/api/cli-tools');
  const data = await res.json();
  ALL = data.catalog || [];

  document.getElementById('stat-total').textContent = ALL.length;
  document.getElementById('stat-installed').textContent = data.installedCount || 0;
  document.getElementById('stat-showing').innerHTML = '<b>' + ALL.length + '</b> shown';

  // Build category pills
  const cats = ['all', ...new Set(ALL.map(e => e.category).filter(Boolean))];
  const pillsEl = document.getElementById('cat-pills');
  pillsEl.innerHTML = cats.map(c =>
    \`<span class="pill \${c==='all'?'active':''}" data-cat="\${c}" onclick="setCat('\${c}')">\${c==='all'?'All':c}</span>\`
  ).join('');

  // Render all cards
  const grid = document.getElementById('grid');
  grid.innerHTML = ALL.map(renderCard).join('') || '<div class="empty">Registry not found — clone mvanhorn/printing-press-library to ~/printing-press-library</div>';

  // CLI-Anything chips
  const cliGrid = document.getElementById('cli-anything-grid');
  const clis = data.cliAnythingCLIs || [];
  cliGrid.innerHTML = clis.length
    ? clis.map(c => \`<span class="cli-chip \${c.hasCli?'has-cli':''}" title="\${c.hasReadme?'has README':''}">&#128295; \${esc(c.name)}</span>\`).join('')
    : '<span style="color:#4b5563;font-size:12px">No generated CLIs found in ~/CLI-Anything</span>';
}

init();
</script>
</body>
</html>`;
    return c.html(html);
  });

  // Token Dashboard — embeds nateherkai/token-dashboard (:8080) in a full-page iframe.
  // No auth required: the embedded service is localhost-only.
  app.get('/token-dashboard', (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Token Dashboard — ClaudeClaw</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f0f0f; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .topbar { display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: #141414; border-bottom: 1px solid #2a2a2a; flex-shrink: 0; }
  .back-btn { background: none; border: 1px solid #2a2a2a; border-radius: 6px; color: #9ca3af; font-size: 12px; padding: 4px 10px; cursor: pointer; text-decoration: none; transition: border-color 0.15s, color 0.15s; }
  .back-btn:hover { border-color: #4f46e5; color: #a5b4fc; }
  .title { font-size: 13px; font-weight: 600; color: #e0e0e0; }
  .badge { font-size: 11px; color: #6b7280; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 4px; padding: 2px 7px; }
  iframe { flex: 1; border: none; width: 100%; }
</style>
</head>
<body>
<div class="topbar">
  <a href="/" class="back-btn">&#8592; ClaudeClaw</a>
  <span class="title">Token Dashboard</span>
  <span class="badge">:8080</span>
</div>
<iframe src="http://localhost:8080" title="Token Dashboard"></iframe>
</body>
</html>`;
    return c.html(html);
  });

  // Serve dashboard HTML.
  // Default: the new Vite-built Mission Control frontend at dist/web/index.html.
  // Fallback: set DASHBOARD_LEGACY=true in .env to revert to the legacy
  // single-file template HTML (kept around as the rollback ejector seat
  // for the rewrite — see SHIP-CHECKLIST and the rewrite plan).
  const legacyMode = (process.env.DASHBOARD_LEGACY || '').toLowerCase() === 'true';
  const newDashboardIndex = path.join(PROJECT_ROOT, 'dist', 'web', 'index.html');
  app.get('/', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (legacyMode || !fs.existsSync(newDashboardIndex)) {
      // Legacy path interpolates DASHBOARD_TOKEN into the HTML, so it
      // MUST require the token. SPA path doesn't.
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getDashboardHtml(DASHBOARD_TOKEN, chatId, WARROOM_ENABLED));
    }
    // SPA shell. Read fresh on each request so dev rebuilds appear
    // without restart. The frontend reads ?token= and ?chatId= from
    // window.location, falling back to sessionStorage. Serving this
    // unauthenticated means a token-stripped URL still loads the app
    // instead of showing raw 401 JSON.
    const html = fs.readFileSync(newDashboardIndex, 'utf-8');
    return c.html(html);
  });

  // Static asset serving for the Vite-built frontend.
  // Vite emits hashed files under dist/web/assets/.
  //
  // Compression: text assets (js/css/map/svg) are brotli/gzip-compressed on the
  // fly and cached in memory keyed by filePath+encoding. Filenames are content-
  // hashed and immutable, so a compressed buffer never goes stale — compress
  // once, serve forever. This cuts the JS/CSS transfer ~4× (the main bundle
  // ~1.3MB → ~0.3MB), a big win on the phone/cellular path. Already-compressed
  // types (woff2) are passed through untouched.
  app.get('/assets/*', (c) => {
    const url = new URL(c.req.url);
    const rel = url.pathname.replace(/^\//, '');
    const filePath = path.join(PROJECT_ROOT, 'dist', 'web', rel);
    // Defense in depth: ensure the resolved path stays inside dist/web/.
    const root = path.join(PROJECT_ROOT, 'dist', 'web');
    if (!filePath.startsWith(root + path.sep)) return c.text('', 403);
    if (!fs.existsSync(filePath)) return c.text('', 404);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.js' ? 'application/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.map' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.woff2' ? 'font/woff2'
      : 'application/octet-stream';

    const compressible = ext === '.js' || ext === '.css' || ext === '.map' || ext === '.svg';
    const accept = c.req.header('accept-encoding') || '';
    const enc = compressible && /\bbr\b/.test(accept) ? 'br'
      : compressible && /\bgzip\b/.test(accept) ? 'gzip'
      : null;

    const headers: Record<string, string> = {
      'Content-Type': ctype,
      'Cache-Control': 'public, max-age=31536000, immutable',
      Vary: 'Accept-Encoding',
    };

    if (enc) {
      const body = getCompressedAsset(filePath, data, enc);
      headers['Content-Encoding'] = enc;
      return new Response(new Uint8Array(body), { headers });
    }
    return new Response(new Uint8Array(data), { headers });
  });

  // Top-level static files copied from web/public/ at build time
  // (e.g. /brain.glb for the 3D Hive Mind view). These have stable
  // names so they sit at the root rather than under /assets/.
  app.get('/:filename{.+\\.(glb|gltf|bin|ktx2|wasm|svg|webmanifest|png|ico)}', (c) => {
    const filename = c.req.param('filename');
    const filePath = path.join(PROJECT_ROOT, 'dist', 'web', filename);
    const root = path.join(PROJECT_ROOT, 'dist', 'web');
    if (!filePath.startsWith(root + path.sep)) return c.text('', 403);
    if (!fs.existsSync(filePath)) return c.text('', 404);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.glb' ? 'model/gltf-binary'
      : ext === '.gltf' ? 'model/gltf+json'
      : ext === '.wasm' ? 'application/wasm'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.webmanifest' ? 'application/manifest+json'
      : ext === '.png' ? 'image/png'
      : ext === '.ico' ? 'image/x-icon'
      : 'application/octet-stream';
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': ctype,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  // War Room entry.
  //   - ?mode=voice → serve the cinematic legacy voice page (interactive
  //     Pipecat WebSocket UI).
  //   - ?mode=picker → serve the legacy picker (kept around as an escape
  //     hatch when v2 is misbehaving).
  //   - In legacy mode → serve the legacy picker (current pre-v2 behavior).
  //   - Otherwise → fall through to the v2 SPA so a refresh of /warroom
  //     stays inside the new dashboard. The v2 page has its own picker.
  app.get('/warroom', (c) => {
    const chatId = c.req.query('chatId') || '';
    const mode = c.req.query('mode') || '';
    // Legacy variants interpolate DASHBOARD_TOKEN into the HTML so they
    // MUST require a token. The v2 SPA path doesn't.
    if (mode === 'voice') {
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getWarRoomHtml(DASHBOARD_TOKEN, chatId, WARROOM_PORT));
    }
    if (mode === 'picker' || legacyMode || !fs.existsSync(newDashboardIndex)) {
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getWarRoomPickerHtml(DASHBOARD_TOKEN, chatId));
    }
    // v2 SPA shell — no embedded token, safe to serve unauth so a
    // hard-refresh of a token-stripped URL still loads the app.
    return c.html(fs.readFileSync(newDashboardIndex, 'utf-8'));
  });

  // Text War Room page. Expects ?meetingId= (created via POST
  // /api/warroom/text/new). Routing matrix:
  //   - missing/invalid meetingId   → picker (refresh-becomes-fresh)
  //   - meeting not found           → picker
  //   - meeting ended, no ?archive  → picker (so a plain refresh of an
  //                                   ended room starts a new meeting
  //                                   instead of staring at "Meeting
  //                                   ended." forever)
  //   - meeting ended + ?archive=1  → serve read-only (used by the
  //                                   "Recent meetings" list on the
  //                                   picker)
  //   - meeting open                → serve interactive war room
  function pickerRedirect(chatId: string) {
    const q = new URLSearchParams({ token: DASHBOARD_TOKEN });
    if (chatId) q.set('chatId', chatId);
    return '/warroom?' + q.toString();
  }
  app.get('/warroom/text', (c) => {
    // Legacy HTML embeds DASHBOARD_TOKEN — gate it inline since the
    // global middleware now only protects /api/*.
    const denied = requireToken(c); if (denied) return denied;
    const chatId = c.req.query('chatId') || '';
    const meetingId = (c.req.query('meetingId') || '').trim();
    const archive = c.req.query('archive') === '1';
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) {
      return c.redirect(pickerRedirect(chatId));
    }
    const existing = getTextMeeting(meetingId);
    if (!existing) {
      return c.redirect(pickerRedirect(chatId));
    }
    if (existing.ended_at !== null && !archive) {
      return c.redirect(pickerRedirect(chatId));
    }
    // Chat-id mismatch: don't render the page (would let a stale meetingId
    // from chat A render under chat B's session). Send them back to the
    // picker for their actual chat. Legacy meetings with chat_id='' bypass
    // this since they pre-date the migration.
    if (existing.chat_id !== '' && existing.chat_id !== chatId) {
      return c.redirect(pickerRedirect(chatId));
    }
    return c.html(getWarRoomTextHtml(DASHBOARD_TOKEN, chatId, meetingId));
  });

  // Serve War Room background music (user's custom music.mp3 first, then bundled entrance.mp3)
  app.get('/warroom-music', (c) => {
    const musicPath = path.join(PROJECT_ROOT, 'warroom', 'music.mp3');
    if (!fs.existsSync(musicPath)) return c.text('', 404);
    const data = fs.readFileSync(musicPath);
    return new Response(data, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  });

  // Upload custom War Room entrance music from the dashboard
  app.post('/warroom-music-upload', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file || typeof file === 'string') return c.json({ error: 'No file uploaded' }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return c.json({ error: 'File too large (max 20MB)' }, 400);
    if (buf.length < 3) return c.json({ error: 'File too short to be MP3' }, 400);
    // Magic-byte check: ID3v2 header ("ID3") OR MPEG audio frame sync
    // (0xFF 0xFB / 0xFA / 0xF3 / 0xF2 — the common MP3 layer-3 variants).
    const isId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
    const isMpegFrame = buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0;
    if (!isId3 && !isMpegFrame) return c.json({ error: 'Not a valid MP3 file' }, 400);
    fs.writeFileSync(path.join(PROJECT_ROOT, 'warroom', 'music.mp3'), buf);
    return c.json({ ok: true });
  });

  // Serve War Room test audio for the browser-side autotest harness.
  // Used by the mock microphone in warroom browser tests; served only
  // when the dashboard token matches so it's not a public endpoint.
  app.get('/warroom-test-audio', (c) => {
    const audioPath = path.join(PROJECT_ROOT, 'warroom', 'test-audio.wav');
    if (!fs.existsSync(audioPath)) return c.text('', 404);
    const data = fs.readFileSync(audioPath);
    return new Response(data, {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  });

  // Serve War Room Pipecat client bundle
  app.get('/warroom-client.js', (c) => {
    const bundlePath = path.join(PROJECT_ROOT, 'warroom', 'client.bundle.js');
    if (!fs.existsSync(bundlePath)) return c.text('// bundle not built', 404);
    const data = fs.readFileSync(bundlePath, 'utf-8');
    return new Response(data, {
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=3600' },
    });
  });

  // The legacy /warroom-avatar/:id route used to live here. It read
  // ONLY from warroom/avatars/<id>.png (bundled art) and lived outside
  // the /api/ token gate, so it could not safely fall back to per-agent
  // mutable caches or trigger Telegram fetches without leaking those
  // outside the auth boundary. All War Room views now hit the
  // tokenized /api/agents/:id/avatar endpoint, which goes through the
  // unified resolver in avatars.ts.

  // War Room API: meeting state management.
  // ── Bunker (ad-hoc report surface) ─────────────────────────────
  // Drop an HTML artifact into ~/.claudeclaw/bunker/<slug>/ (helper:
  // scripts/bunker-add.mjs) and it appears here, served from the
  // dashboard origin — no throwaway localhost ports to hunt down. Gated by
  // the /api token middleware; mutations respect the kill-switch.
  app.get('/api/bunker', (c) => {
    // DASHBOARD_TOKEN keys the per-entry scoped artifact capabilities.
    return c.json({ entries: bunkerList(DASHBOARD_TOKEN), archived: bunkerArchivedList(DASHBOARD_TOKEN) });
  });

  app.post('/api/bunker/:slug/pin', async (c) => {
    const body: { pinned?: boolean } = await c.req.json().catch(() => ({}));
    if (!bunkerSetPinned(c.req.param('slug'), body.pinned !== false)) {
      return c.json({ error: 'Bunker entry not found' }, 404);
    }
    return c.json({ ok: true });
  });

  app.post('/api/bunker/:slug/archive', (c) => {
    if (!bunkerArchive(c.req.param('slug'))) {
      return c.json({ error: 'Bunker entry not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // Promote: copy the artifact into the vault as a searchable markdown note.
  app.post('/api/bunker/:slug/promote', (c) => {
    const result = bunkerPromote(c.req.param('slug'));
    if (!result) return c.json({ error: 'Bunker entry not found' }, 404);
    return c.json({ ok: true, vaultPath: result.vaultPath });
  });

  // Serve the artifact files themselves. NOT gated by the master /api token
  // (exempted above); instead each request must carry a per-slug scoped
  // capability (?t=&exp=) minted by the list endpoint. Opened in a NEW TAB —
  // the global X-Frame-Options: DENY header makes inline framing impossible.
  app.get('/api/bunker-files/*', (c) => {
    const pathname = new URL(c.req.url).pathname;
    const sub = pathname.replace(/^\/api\/bunker-files\//, '');

    // Bind the capability to the slug: first path segment after an optional
    // _archive/ prefix. Mirrors resolveArtifact's prefix handling so a token
    // signed for slug A cannot read slug B (or _archive/A vs A).
    let slugPath = sub.replace(/^\/+/, '');
    if (slugPath === '_archive' || slugPath.startsWith('_archive/')) {
      slugPath = slugPath.slice('_archive'.length).replace(/^\/+/, '');
    }
    const slug = decodeURIComponent(slugPath.split('/')[0] ?? '');

    const t = c.req.query('t') ?? '';
    const exp = Number(c.req.query('exp'));
    if (!bunkerVerifyArtifact(slug, exp, t, DASHBOARD_TOKEN)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const file = bunkerResolveArtifact(sub);
    if (!file) return c.text('', 404);
    return new Response(new Uint8Array(file.data), {
      headers: { 'Content-Type': file.contentType },
    });
  });

  // We deliberately do NOT return a ws_url here. Older versions of this
  // route sent `ws://localhost:${WARROOM_PORT}`, which broke any
  // Cloudflare-tunneled access since the browser would try to connect to
  // its own localhost instead of the tunnel host. The client-side code
  // in src/warroom-html.ts always has a `window.location.hostname`
  // fallback, so just returning {ok:true} lets the browser build the
  // right WS url on its own.
  app.post('/api/warroom/start', async (c) => {
    if (!WARROOM_ENABLED) {
      return c.json({ error: 'War Room not enabled. Set WARROOM_ENABLED=true in .env with GOOGLE_API_KEY (for live mode) or DEEPGRAM_API_KEY + CARTESIA_API_KEY (for legacy mode).' }, 400);
    }
    // DASHBOARD_MUTATIONS_ENABLED is enforced by the global mutation
    // middleware above; no per-route check needed.
    if (!killSwitches.isEnabled('WARROOM_VOICE_ENABLED')) {
      return c.json({ error: 'voice war room disabled' }, 503);
    }
    // If the pin file was updated recently (agent switch while no meeting
    // was active), the running server has the wrong agent. Kill it so it
    // restarts with the correct persona/voice before we probe readiness.
    try {
      const pinStat = fs.statSync(WARROOM_PIN_PATH);
      const pinAge = Date.now() - pinStat.mtimeMs;
      if (pinAge < 30000) {
        // Pin changed in the last 30 seconds. Kill the server so it
        // picks up the new pin, then poll until it's ready.
        await killWarroomAsync('pin changed recently, restarting for Start Meeting');
        const net = await import('net');
        let serverReady = false;
        for (let attempt = 0; attempt < 15 && !serverReady; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          serverReady = await new Promise<boolean>((resolve) => {
            const sock = new net.Socket();
            const t = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
            sock.connect(WARROOM_PORT, '127.0.0.1', () => { clearTimeout(t); sock.destroy(); resolve(true); });
            sock.on('error', () => { clearTimeout(t); sock.destroy(); resolve(false); });
          });
        }
        if (serverReady) {
          await new Promise((r) => setTimeout(r, 200));
          return c.json({ ok: true, status: 'ready' });
        }
        return c.json({ ok: false, status: 'starting', error: 'War Room server restarting, try again' }, 503);
      }
    } catch { /* pin file might not exist yet, that's fine */ }

    // Probe the Python WebSocket server to verify it's actually accepting
    // connections. Without this, the browser connects before the server is
    // ready and gets silent failures or "only one client allowed" errors.
    try {
      const net = await import('net');
      const ready = await new Promise<boolean>((resolve) => {
        const sock = new net.Socket();
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 3000);
        sock.connect(WARROOM_PORT, '127.0.0.1', () => {
          clearTimeout(timer);
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
      });
      if (!ready) {
        return c.json({ ok: false, status: 'starting', error: 'War Room server not ready yet' }, 503);
      }
      // Small delay after TCP success: the socket may be bound but the
      // Pipecat WebSocket upgrade handler might not be fully initialized.
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return c.json({ ok: false, status: 'starting', error: 'Could not probe War Room server' }, 503);
    }
    return c.json({ ok: true, status: 'ready' });
  });

  // Return the dynamic agent list for the War Room UI to render cards.
  // Includes main + all configured agents with their display names.
  app.get('/api/warroom/agents', (c) => {
    const ids = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const agents = ids.map((id) => {
      try {
        if (id === 'main') return { id: 'main', name: resolveAgentDisplayName('main'), description: getMainDescription() };
        const cfg = loadAgentConfig(id);
        return { id, name: cfg.name || resolveAgentDisplayName(id), description: cfg.description || '' };
      } catch {
        return { id, name: resolveAgentDisplayName(id), description: '' };
      }
    });
    return c.json({ agents });
  });

  // ── ComfyUI — status + VRAM for the local image/video generation stack ──
  app.get('/api/comfyui/status', async (c) => {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      // Check if ComfyUI is responding on port 8188 — native fetch; the old
      // curl-via-execSync blocked the event loop for up to 2s per poll.
      let running = false;
      try {
        const probe = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(2000) });
        running = probe.ok;
      } catch {}
      // VRAM via nvidia-smi (async for the same reason)
      let vram: { total: number; used: number; free: number } | null = null;
      try {
        const { stdout } = await execFileAsync(
          '/usr/lib/wsl/lib/nvidia-smi',
          ['--query-gpu=memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
          { timeout: 5000 },
        );
        const [total, used, free] = stdout.trim().split(', ').map(Number);
        vram = { total, used, free };
      } catch {}
      // Model inventory
      const HOME = process.env.HOME || '/home/itsju';
      const checkpointDir = `${HOME}/ComfyUI/models/checkpoints`;
      const loraDir = `${HOME}/ComfyUI/models/loras`;
      // Attach Civitai-sourced compatibility metadata (family/triggers/verified)
      // plus the curated friendly layer (label/description/category) so the UI
      // can show human names and lock incompatible LoRAs. Compatibility is
      // computed HERE (single source of truth) — the client only does lookups
      // on compatibleCheckpoints/unknownCheckpoints, it has no rule logic.
      const manifest = readManifest();
      const curated = readCurated();
      const checkpoints = fs.existsSync(checkpointDir) ? fs.readdirSync(checkpointDir).filter(f => f.endsWith('.safetensors') || f.endsWith('.ckpt') || f.endsWith('.gguf')).map(f => {
        const md = enrichedMetaFor(f, manifest, curated);
        return { name: f, sizeGB: +(fs.statSync(`${checkpointDir}/${f}`).size / 1e9).toFixed(2), family: md.family, baseModel: md.baseModel, triggers: md.triggers || [], verified: !!md.verified, thumb: md.thumb, thumbNsfw: md.thumbNsfw, label: md.label, description: md.description, category: md.category };
      }) : [];
      const loras = fs.existsSync(loraDir) ? fs.readdirSync(loraDir).filter(f => f.endsWith('.safetensors')).map(f => {
        const md = enrichedMetaFor(f, manifest, curated);
        const loraFam = md.requiresCheckpointFamily || md.family;
        const compatibleCheckpoints = checkpoints.filter(ck => loraCompat(loraFam, ck.family) === 'ok').map(ck => ck.name);
        const unknownCheckpoints = checkpoints.filter(ck => loraCompat(loraFam, ck.family) === 'unknown').map(ck => ck.name);
        return { name: f, sizeMB: +(fs.statSync(`${loraDir}/${f}`).size / 1e6).toFixed(1), family: md.family, baseModel: md.baseModel, triggers: md.triggers || [], verified: !!md.verified, thumb: md.thumb, thumbNsfw: md.thumbNsfw, label: md.label, description: md.description, category: md.category, recommendedStrength: md.recommendedStrength, compatibleCheckpoints, unknownCheckpoints };
      }) : [];
      return c.json({ running, vram, checkpoints, loras, url: running ? 'http://localhost:8188' : null });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Master Control Panel (/control) — phone-first operator toggles ──
  // Registry lives in src/controls.ts; add a control there and it shows up here.
  // These routes sit behind the same mc-access gate as the rest of /api/* (remote
  // needs the cookie; loopback open), so only an authed device can flip anything.
  app.get('/api/control/state', async (c) => {
    try {
      return c.json({ controls: await readControlPanel() });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
  app.post('/api/control/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = (await c.req.json().catch(() => ({}))) as { on?: boolean; confirm?: boolean };
      const on = body.on !== false; // default true (actions / enable)
      const result = await applyControl(id, on, body.confirm === true);
      return c.json(result, result.ok ? 200 : (result.error === 'confirm required' ? 409 : 400));
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  // ── ComfyUI remote control — start/stop from Tailscale or ClaudeClaw UI ──
  app.post('/api/comfy/start', async (c) => {
    try {
      // B2: non-blocking fetch instead of execSync('curl …') so this route
      // can't freeze the event loop for 2s while ComfyUI is cold.
      let running = false;
      try {
        const probe = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(2500) });
        running = probe.ok;
      } catch {}
      if (running) return c.json({ ok: false, error: 'already running' });
      const { spawn } = await import('child_process');
      const HOME = process.env.HOME || '/home/itsju';
      // Spawn via `bash` so a missing execute bit on comfyui-start can't EACCES.
      const child = spawn('bash', [`${HOME}/bin/comfyui-start`], {
        detached: true, stdio: 'ignore', env: { ...process.env, HOME },
      });
      child.unref();
      return c.json({ ok: true, pid: child.pid, message: 'ComfyUI launching — poll /api/comfyui/status for ready (30–60s)' });
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  app.post('/api/comfy/stop', async (c) => {
    try {
      const { execSync } = await import('child_process');
      let stopped = false;
      try {
        const pid = execSync('cat /tmp/comfyui.pid 2>/dev/null || true', { stdio: 'pipe' }).toString().trim();
        if (pid) { execSync(`kill ${pid}`, { stdio: 'pipe' }); stopped = true; }
      } catch {}
      // ALWAYS sweep the real python child — the pidfile can be stale or (pre-fix)
      // hold the wrong pid, which would leave ComfyUI orphaned holding VRAM on the
      // 8GB GPU. Then clear the shared lock so the next gen isn't falsely blocked.
      // Pattern covers both the legacy ~/ComfyUI path and the 2026-06-07
      // restructure home /AIWorkWSL/tools/comfyui (case differs between them).
      try { execSync("pkill -f '[Cc]omfy[Uu][Ii]/venv/bin/python.*main.py' 2>/dev/null || true", { stdio: 'pipe' }); stopped = true; } catch {}
      try { execSync('rm -f /tmp/heavy-gpu-job.lock 2>/dev/null || true', { stdio: 'pipe' }); } catch {}
      return c.json({ ok: stopped, message: stopped ? 'ComfyUI stopped' : 'ComfyUI was not running' });
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  // ── Live ComfyUI step progress (SSE) ─────────────────────────────────────────
  // Relays ComfyUI's native /ws `progress` (step k of N) so the Create page can
  // show a REAL progress bar instead of a guessed estimate. Only ONE GPU gen runs
  // at a time (shared lock), so whatever ComfyUI emits is the user's current gen.
  app.get('/api/comfy/progress', (c) => {
    return streamSSE(c, async (stream) => {
      const wsModule: any = await import('ws').catch(() => null);
      const WS = wsModule ? (wsModule.default?.WebSocket ?? wsModule.WebSocket) : null;
      let writeChain: Promise<void> = Promise.resolve();
      const send = (obj: unknown) => {
        writeChain = writeChain.then(async () => {
          try { await stream.writeSSE({ event: 'message', data: JSON.stringify(obj) }); } catch {}
        });
      };
      if (!WS) { send({ type: 'error', error: 'ws unavailable' }); return; }

      let ws: any = null;
      try {
        ws = new WS('ws://127.0.0.1:8188/ws');
        ws.on('message', (raw: Buffer, isBinary: boolean) => {
          if (isBinary) return; // preview-image frames — ignore
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'progress' && msg.data) {
              send({ type: 'progress', value: msg.data.value, max: msg.data.max, node: msg.data.node ?? null });
            } else if (msg.type === 'executing') {
              send({ type: 'executing', node: msg.data?.node ?? null });
            } else if (msg.type === 'executed') {
              send({ type: 'executed', node: msg.data?.node ?? null });
            }
          } catch { /* non-JSON frame */ }
        });
        ws.on('error', () => send({ type: 'error', error: 'comfy ws error' }));
      } catch { send({ type: 'error', error: 'comfy ws connect failed' }); }

      const ping = setInterval(async () => {
        try { await stream.writeSSE({ event: 'ping', data: '' }); } catch { clearInterval(ping); }
      }, 30_000);

      try {
        // B7: also resolve (not just reject) on ws 'close' so the WS is always
        // released if the socket drops before the SSE stream fires onAbort.
        // Without this, a WS that closes mid-gen leaks until the client
        // eventually disconnects and onAbort fires (or never, on keep-alive).
        await new Promise<void>((resolve, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
          ws?.on('close', () => resolve());
        });
      } catch { /* client disconnected */ }
      finally { clearInterval(ping); try { ws?.close(); } catch {} }
    });
  });

  app.post('/api/comfy/queue', async (c) => {
    try {
      // Safety gate — the raw passthrough is a bypass door for the high-level
      // /api/comfy/generate gate, so it must enforce the same checks.
      const gate = await preflightGate();
      if (!gate.ok) { notify(`🛑 ComfyUI queue blocked: ${gate.reason}`); return c.json({ ok: false, blocked: true, error: `blocked: ${gate.reason}` }, 429); }
      if (await comfyQueueDepth() >= 1) return c.json({ ok: false, blocked: true, error: 'blocked: a generation is already queued (one job at a time on the 8GB GPU)' }, 429);
      const body = await c.req.json();
      const res = await fetch('http://127.0.0.1:8188/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) return c.json({ ok: false, error: `ComfyUI returned ${res.status}` }, 502);
      return c.json({ ok: true, ...(await res.json() as object) });
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  app.get('/api/comfy/queue/:id', async (c) => {
    try {
      const res = await fetch(`http://127.0.0.1:8188/history/${c.req.param('id')}`);
      if (!res.ok) return c.json({ ok: false, error: `ComfyUI returned ${res.status}` }, 502);
      return c.json({ ok: true, ...(await res.json() as object) });
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  // Server-side compatibility gate using the tri-state loraCompat() from
  // modelmeta.ts (the single source of truth — the client only consumes
  // precomputed arrays from /api/comfyui/status). 'mismatch' always rejects;
  // 'unknown' rejects too UNLESS the caller passed allowUnknown (set by the
  // Advanced-mode confirm dialog) — unknown-family combos were the source of
  // deformed output when silently allowed. Returns the first offender.
  function validateLoraFamilies(
    checkpoint: string,
    loras: Array<{ name: string }>,
    manifest: Record<string, ModelMeta>,
    allowUnknown = false,
  ): { lora: string; loraFam: string; ckptFam: string; compat: 'mismatch' | 'unknown' } | null {
    const ckptFam = metaFor(checkpoint, manifest).family;
    for (const l of loras) {
      const md = metaFor(l.name, manifest);
      const compat = loraCompat(md.requiresCheckpointFamily || md.family, ckptFam);
      if (compat === 'mismatch') return { lora: l.name, loraFam: md.family, ckptFam, compat };
      if (compat === 'unknown' && !allowUnknown) return { lora: l.name, loraFam: md.family, ckptFam, compat };
    }
    return null;
  }

  // ── ComfyUI high-level generate — prompt → workflow → queue → job id ──
  // This is the endpoint the Create page calls. Handles ComfyUI startup,
  // workflow construction, and queueing, then returns a prompt_id the client
  // polls via GET /api/comfy/generate/:prompt_id.
  app.post('/api/comfy/generate', async (c) => {
    const HOME = process.env.HOME || '/home/itsju';
    try {
      const body = await c.req.json() as {
        prompt?: string; negative_prompt?: string; steps?: number; cfg?: number;
        width?: number; height?: number; checkpoint?: string; seed?: number;
        loras?: Array<{ name: string; strength?: number }>;
        allowUnknownCompat?: boolean;
        fast?: boolean;        // DMD2 4-step distillation (SDXL-family checkpoints only)
        detailer?: boolean;    // foot+hand FaceDetailer pass after VAEDecodeTiled (ported from verify_feet_gen.py)
        detailer_strength?: number; // reserved for future per-pass strength override (unused in A2)
      };
      const prompt = (body.prompt || '').trim();
      if (!prompt) return c.json({ ok: false, error: 'prompt is required' }, 400);

      // ── 0a. Hardware guards — a custom combo must never OOM the 8GB GPU ──
      // Cap stacked add-ons (each LoRA adds VRAM + can corrupt output) and total
      // resolution (the real OOM/freeze vector on the shared 8GB card).
      const MAX_LORAS = 3;
      const nLoras = body.loras?.length ?? 0;
      if (nLoras > MAX_LORAS) {
        return c.json({ ok: false, error: `Too many add-ons (${nLoras}) — max ${MAX_LORAS} at once to stay within the 8GB GPU.` }, 400);
      }
      const reqW = body.width ?? 768, reqH = body.height ?? 1024;
      const MAX_DIM = 1536, MAX_PX = 1024 * 1536;   // ~1.57M px ceiling for 8GB + detailer
      if (reqW > MAX_DIM || reqH > MAX_DIM || reqW * reqH > MAX_PX) {
        return c.json({ ok: false, error: `Resolution ${reqW}×${reqH} is too high for the 8GB GPU (max ${MAX_DIM}px per side / ~${MAX_PX.toLocaleString()} total pixels).` }, 400);
      }

      // ── 0. Safety gate — refuse if unsafe, no matter the trigger source ──
      // (phone, dashboard, or raw API). Closes the warm-ComfyUI gap: cold start
      // runs preflight via comfyui-start, but a warm instance had no gate.
      //
      // Auto-free recovery: if the only failure reason is stale VRAM/RAM held by
      // a previous gen or idle ComfyUI model weights, call comfyFree() and retry
      // once. Patterns matched:
      //   "VRAM" / "GPU memory" / "already holds" — GPU-side stale allocation
      //   "RAM only"  — idle ComfyUI holding 9–12 GB of model weights in system
      //                 RAM (comfyFree() calls unload_models+free_memory which
      //                 releases that too, so the retry will actually recover)
      // Non-recoverable failures (low C: disk, concurrency lock) skip the retry.
      let gate = await preflightGate();
      if (!gate.ok && /VRAM|GPU memory|already holds|RAM only/i.test(gate.reason ?? '')) {
        logger.info({ reason: gate.reason }, 'preflight blocked on memory — attempting comfyFree recovery');
        await comfyFree();
        await new Promise(r => setTimeout(r, 1500)); // give the driver 1.5s to release pages
        gate = await preflightGate();
        // comfyFree() releases VRAM, but ComfyUI keeps the model resident in CPU RAM
        // (offload under --disable-pinned-memory). If we're STILL blocked on RAM and
        // ComfyUI is idle (no job queued), recycling the process is the only thing that
        // frees those 8–12 GB. Kill it, reset the cold-start cooldown, and hand back
        // { starting:true } so the client re-kicks into a fresh, headroom-clean cold start.
        if (!gate.ok && /RAM only/i.test(gate.reason ?? '') && (await comfyQueueDepth()) === 0) {
          logger.warn({ reason: gate.reason }, 'RAM still low after comfyFree — recycling idle ComfyUI to release its CPU-resident model');
          try {
            const { spawn: spawnKill } = await import('child_process');
            spawnKill('pkill', ['-TERM', '-f', 'venv/bin/python main.py'], { stdio: 'ignore' });
          } catch { /* best-effort */ }
          comfyStartedAt = 0;                              // allow an immediate cold start on the re-kick
          await new Promise(r => setTimeout(r, 2500));     // let the process die + pages return
          gate = await preflightGate();
          if (gate.ok) {
            notify('♻️ Recycled idle ComfyUI to free RAM — image gen will cold-start');
            return c.json({ ok: true, starting: true });
          }
        }
        // VRAM held by an idle, already-loaded model is REUSABLE by this sequential
        // gen — it is not a real blocker. The downstream queue-depth gate (one job at
        // a time) is the actual concurrency guard, so when ComfyUI is idle (queue 0)
        // we proceed and let ComfyUI swap/reuse the model rather than hard-block.
        if (!gate.ok && /already holds|GPU memory|VRAM/i.test(gate.reason ?? '') && (await comfyQueueDepth()) === 0) {
          logger.info({ reason: gate.reason }, 'VRAM held by idle ComfyUI model — proceeding (reused; queue gate enforces single-job)');
          gate = { ok: true, reason: 'idle-model-reuse' };
        }
        if (gate.ok) logger.info('preflight: retry passed after comfyFree');
      }
      if (!gate.ok) { notify(`🛑 Image gen blocked: ${gate.reason}`); return c.json({ ok: false, blocked: true, error: `blocked: ${gate.reason}` }, 429); }

      // ── 0b. Resolve checkpoint + LoRAs and validate family compatibility BEFORE
      // the (slow) ComfyUI startup, so a known-mismatched combo fails instantly
      // regardless of whether ComfyUI is up.
      const ckptDir = `${HOME}/ComfyUI/models/checkpoints`;
      const ckptFiles = fs.existsSync(ckptDir)
        ? fs.readdirSync(ckptDir).filter((f: string) => f.endsWith('.safetensors') || f.endsWith('.ckpt') || f.endsWith('.gguf'))
        : [];
      const checkpoint = body.checkpoint || ckptFiles[0] || 'cyberrealisticPony_v170.safetensors';
      const loraList = body.loras ?? [];
      const manifest = readManifest();
      const bad = validateLoraFamilies(checkpoint, loraList, manifest, !!body.allowUnknownCompat);
      if (bad) {
        const loraLabel = bad.lora.replace(/\.(safetensors|ckpt|gguf)$/i, '');
        const msg = bad.compat === 'mismatch'
          ? `Incompatible LoRA "${loraLabel}" (${bad.loraFam}) for a ${bad.ckptFam} checkpoint. Pick a ${bad.ckptFam} LoRA or a matching checkpoint.`
          : `LoRA "${loraLabel}" has an unknown model family — it can produce broken images with this checkpoint. Use Advanced mode and confirm to run it anyway.`;
        return c.json({ ok: false, error: msg }, 400);
      }

      const { spawn } = await import('child_process');

      // ── 1. Ensure ComfyUI is up — but DON'T block the request for the full
      // cold boot. A cold WSL ComfyUI takes ~30–90s to load; holding the HTTP
      // request open that long is exactly what produced "failed to fetch". So
      // we kick off startup (once per boot window), wait only a few seconds in
      // case it's nearly ready, then hand back `{ starting: true }` and let the
      // client re-kick. Each request stays short, so no intermediary can drop it.
      //
      // B2: replaced execSync('curl …') with non-blocking fetch so a cold/slow
      // ComfyUI can't freeze all routes for up to 2s per probe.
      const comfyHealthy = async (): Promise<boolean> => {
        try {
          const r = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(2500) });
          return r.ok;
        } catch { return false; }
      };
      let running = await comfyHealthy();
      if (!running) {
        if (Date.now() - comfyStartedAt > 180_000) {
          comfyStartedAt = Date.now();
          // Spawn via `bash` so a missing execute bit can't EACCES the cold start.
          const child = spawn('bash', [`${HOME}/bin/comfyui-start`], {
            detached: true, stdio: 'ignore', env: { ...process.env, HOME },
          });
          child.unref();
          logger.info('ComfyUI cold start kicked off (async)');
        }
        const startMs = Date.now();
        while (Date.now() - startMs < 8000) {
          await new Promise(r => setTimeout(r, 2000));
          if (await comfyHealthy()) { running = true; break; }
        }
        if (!running) return c.json({ ok: true, starting: true });
      }

      // ── 1b. Queue-depth cap — one heavy job at a time on the 8GB GPU ────
      // B5 — TOCTOU guard: two concurrent POSTs can both pass comfyQueueDepth()
      // in the same event-loop tick (both await the same async depth read, both
      // see 0, both proceed). The module-scope boolean is set synchronously
      // before the first await so any concurrent request sees it immediately.
      if (comfySubmitting) {
        return c.json({ ok: false, blocked: true, error: 'blocked: a generation is already queued (one job at a time on the 8GB GPU)' }, 429);
      }
      comfySubmitting = true;
      try {
      if (await comfyQueueDepth() >= 1) {
        return c.json({ ok: false, blocked: true, error: 'blocked: a generation is already queued (one job at a time on the 8GB GPU)' }, 429);
      }

      // ── 2. Build workflow from template ─────────────────────────────────
      const seed = body.seed ?? Math.floor(Math.random() * 2 ** 32);

      // Build workflow — chain LoRA nodes between checkpoint and sampler
      const workflow: Record<string, any> = {
        "4": { inputs: { ckpt_name: checkpoint }, class_type: "CheckpointLoaderSimple" },
      };
      // ── Fast mode (DMD2 distillation): 4-8 steps at cfg 1.0 instead of
      // 20 at cfg 7 — ~4x faster sampling, near-identical quality. Only valid
      // on SDXL-architecture checkpoints (sdxl/pony/illustrious); the LoRA
      // breaks sd15/flux, so fall back to the normal path for those. Requires
      // models/loras/dmd2_sdxl_4step_lora_fp16.safetensors (tianweiy/DMD2).
      const DMD2_LORA = 'dmd2_sdxl_4step_lora_fp16.safetensors';
      const SDXL_ARCH = new Set(['sdxl', 'pony', 'illustrious']);
      const ckptFamily = manifest[checkpoint]?.family || familyFromFilename(checkpoint);
      const loraDir = `${HOME}/ComfyUI/models/loras`;
      const fastMode = !!body.fast && SDXL_ARCH.has(ckptFamily) && fs.existsSync(`${loraDir}/${DMD2_LORA}`);

      // LoRA chain: node ids 100, 101, 102... each feeds into the next
      let modelRef: [string, number] = ["4", 0];
      let clipRef:  [string, number] = ["4", 1];
      for (let i = 0; i < loraList.length; i++) {
        const nodeId = String(100 + i);
        // Rule 5: character/identity LoRAs default to ~0.95 (never lower — drifts
        // identity); style LoRAs keep the prior 0.8 default. Explicit values honored.
        const lmeta = metaFor(loraList[i].name, manifest);
        const strength = loraStrength(loraList[i].strength, lmeta.category === 'character', lmeta.recommendedStrength);
        workflow[nodeId] = {
          inputs: { lora_name: loraList[i].name, strength_model: strength, strength_clip: strength, model: modelRef, clip: clipRef },
          class_type: "LoraLoader",
        };
        modelRef = [nodeId, 0];
        clipRef  = [nodeId, 1];
      }
      if (fastMode) {
        // DMD2 goes LAST in the chain at full strength so style LoRAs upstream
        // keep their effect while DMD2 controls the denoising trajectory.
        const nodeId = String(100 + loraList.length);
        workflow[nodeId] = {
          inputs: { lora_name: DMD2_LORA, strength_model: 1.0, strength_clip: 1.0, model: modelRef, clip: clipRef },
          class_type: "LoraLoader",
        };
        modelRef = [nodeId, 0];
        clipRef  = [nodeId, 1];
      }
      // ── Hard-rules pass (DaForgeLayer studio method): framing/lighting/cfg
      // discipline applied to every gen so quality holds without the user
      // remembering the footguns. cfg is 1.0 under fast/DMD2, else body.cfg.
      const effCfg = fastMode ? 1.0 : (body.cfg ?? 7.0);
      const baseNeg = body.negative_prompt || "deformed, ugly, blurry, low quality, bad anatomy, watermark, text";
      const ruled = applyGenRules({ prompt, negative: baseNeg, cfg: effCfg, kind: 'image', hasLora: loraList.length > 0 });
      if (ruled.notes.length) logger.info({ notes: ruled.notes }, 'gen hard-rules applied');
      workflow["6"] = { inputs: { text: ruled.prompt, clip: clipRef }, class_type: "CLIPTextEncode" };
      workflow["7"] = { inputs: { text: ruled.negative ?? "", clip: clipRef }, class_type: "CLIPTextEncode" };
      workflow["5"] = { inputs: { width: body.width ?? 512, height: body.height ?? 768, batch_size: 1 }, class_type: "EmptyLatentImage" };
      workflow["3"] = fastMode
        // DMD2 contract: cfg MUST be 1.0 (no CFG), lcm sampler, 4-8 steps.
        ? { inputs: { seed, steps: Math.min(Math.max(body.steps ?? 4, 4), 8), cfg: 1.0, sampler_name: "lcm", scheduler: "sgm_uniform", denoise: 1.0, model: modelRef, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] }, class_type: "KSampler" }
        : { inputs: { seed, steps: body.steps ?? 20, cfg: body.cfg ?? 7.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0, model: modelRef, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] }, class_type: "KSampler" };
      // ── Node "8": VAEDecodeTiled — replaces plain VAEDecode for ALL gens.
      // Tiled pinned allocs avoid the WSL2 "Pin error" hang that the old VAEDecode
      // triggered under --disable-pinned-memory. Params match verify_feet_gen.py.
      workflow["8"] = {
        inputs: { samples: ["3", 0], vae: ["4", 2], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
        class_type: "VAEDecodeTiled",
      };

      // ── Detailer chain (nodes "30"–"33"): foot+hand FaceDetailer passes.
      // Ported verbatim from verify_feet_gen.py::detailer() + build_workflow().
      // Only appended when body.detailer === true; otherwise the graph ends at "8".
      // "30" → foot bbox detector → "31" FaceDetailer on base image
      // "32" → hand bbox detector → "33" FaceDetailer on foot-corrected image
      // SaveImage ("9") points at the last Detailer output when on, else "8".
      if (body.detailer) {
        workflow["30"] = {
          class_type: "UltralyticsDetectorProvider",
          inputs: { model_name: "bbox/foot_yolov8.pt" },
        };
        workflow["31"] = {
          class_type: "FaceDetailer",
          inputs: {
            image: ["8", 0], model: modelRef, clip: clipRef, vae: ["4", 2],
            positive: ["6", 0], negative: ["7", 0], bbox_detector: ["30", 0],
            wildcard: "",
            guide_size: 384, guide_size_for: true, max_size: 768,
            seed, steps: 20, cfg: 6.0, sampler_name: "euler", scheduler: "karras",
            denoise: 0.45, feather: 5, noise_mask: true, force_inpaint: true,
            bbox_threshold: 0.40, bbox_dilation: 10, bbox_crop_factor: 3.0,
            sam_detection_hint: "center-1", sam_dilation: 0, sam_threshold: 0.93,
            sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7,
            sam_mask_hint_use_negative: "False", drop_size: 10, cycle: 1,
            tiled_encode: true, tiled_decode: true,
          },
        };
        workflow["32"] = {
          class_type: "UltralyticsDetectorProvider",
          inputs: { model_name: "bbox/hand_yolov8s.pt" },
        };
        workflow["33"] = {
          class_type: "FaceDetailer",
          inputs: {
            image: ["31", 0], model: modelRef, clip: clipRef, vae: ["4", 2],
            positive: ["6", 0], negative: ["7", 0], bbox_detector: ["32", 0],
            wildcard: "",
            guide_size: 384, guide_size_for: true, max_size: 768,
            seed, steps: 20, cfg: 6.0, sampler_name: "euler", scheduler: "karras",
            denoise: 0.40, feather: 5, noise_mask: true, force_inpaint: true,
            bbox_threshold: 0.45, bbox_dilation: 10, bbox_crop_factor: 3.0,
            sam_detection_hint: "center-1", sam_dilation: 0, sam_threshold: 0.93,
            sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7,
            sam_mask_hint_use_negative: "False", drop_size: 10, cycle: 1,
            tiled_encode: true, tiled_decode: true,
          },
        };
      }
      // SaveImage: point at last Detailer output when active, else directly at VAEDecodeTiled.
      workflow["9"] = {
        inputs: { filename_prefix: "cc_gen", images: body.detailer ? ["33", 0] : ["8", 0] },
        class_type: "SaveImage",
      };

      // ── 3. Queue ────────────────────────────────────────────────────────
      // B3: 8s timeout so an unresponsive ComfyUI can't hang this route in
      // 'settling' limbo until the TCP connection times out (minutes). The
      // existing catch() below surfaces it as a transient error so the client
      // retries on the next poll cycle.
      const queueRes = await fetch('http://127.0.0.1:8188/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(8000),
      });
      if (!queueRes.ok) return c.json({ ok: false, error: `ComfyUI queue rejected: ${queueRes.status}` }, 502);
      const { prompt_id } = await queueRes.json() as { prompt_id: string };

      // ── 4. Register job + return immediately — client polls for the result ─
      logger.info({ prompt_id, seed, checkpoint }, 'ComfyUI job queued (async)');
      comfyJobs.set(prompt_id, { seed, checkpoint, done: false, queuedAt: Date.now() });
      return c.json({ ok: true, prompt_id, seed });
      } finally {
        // B5 — always release the submit lock, whether the queue POST succeeded,
        // failed, or threw (AbortError from B3 timeout lands here too).
        comfySubmitting = false;
      }
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  // ── ComfyUI generate — poll one job by prompt_id ──────────────────────────
  // Single (non-looping) history check. On a terminal state it moves the output
  // into the gallery, surfaces real ComfyUI errors, and flushes VRAM exactly once.
  app.get('/api/comfy/generate/:prompt_id', async (c) => {
    const HOME = process.env.HOME || '/home/itsju';
    const prompt_id = c.req.param('prompt_id');
    const job = comfyJobs.get(prompt_id);
    const seed = job?.seed;
    if (job?.done) {
      return job.error
        ? c.json({ ok: false, done: true, error: job.error, seed })
        : c.json({ ok: true, done: true, file: job.file, url: job.url, seed,
                   notes: `checkpoint: ${(job.checkpoint||'').replace('.safetensors','')}` });
    }
    // Concurrency claim: if another poll for this id is already finalizing (moving
    // the file / freeing VRAM), don't re-enter the terminal branch and double-free.
    // The get→set below is synchronous (no await between), so it's atomic per tick.
    if (job?.settling) return c.json({ ok: true, done: false });
    if (job) job.settling = true;
    const release = () => { const j = comfyJobs.get(prompt_id); if (j && !j.done) j.settling = false; };
    const finish = (patch: { file?: string; url?: string; error?: string }) => {
      const j = comfyJobs.get(prompt_id) || { seed: seed ?? 0, checkpoint: job?.checkpoint || '', done: false, queuedAt: Date.now() };
      comfyJobs.set(prompt_id, { ...j, ...patch, done: true, settling: false });
    };
    try {
      // B3: 8s timeout — history poll must not block forever if ComfyUI stalls.
      const histRaw = await fetch(`http://127.0.0.1:8188/history/${prompt_id}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
      const entry = (histRaw as Record<string, any>)[prompt_id];
      if (!entry) { release(); return c.json({ ok: true, done: false }); }
      const statusMsgs: Array<[string, any]> = entry.status?.status_messages ?? [];
      const errMsg = statusMsgs.find(([t]) => t === 'execution_error');
      if (errMsg) {
        const d = errMsg[1] || {};
        const detail = [d.node_type, d.exception_type, d.exception_message].filter(Boolean).join(': ') || 'ComfyUI execution error';
        finish({ error: detail });
        void comfyFree();
        return c.json({ ok: false, done: true, error: detail, seed });
      }
      if (entry.status?.completed === true) {
        const comfyOutputDir = `${HOME}/ComfyUI/output`;
        const galleryDir = `${HOME}/gallery-watched/comfyui`;
        let filename: string | null = null; let subfolder = '';
        const outputs = entry.outputs ?? {};
        for (const nodeId of Object.keys(outputs)) {
          const images: Array<{ filename: string; subfolder: string; type: string }> = outputs[nodeId]?.images ?? [];
          if (images.length > 0) { filename = images[0].filename; subfolder = images[0].subfolder ?? ''; break; }
        }
        if (!filename) { finish({ error: 'ComfyUI completed but no output image found' }); void comfyFree(); return c.json({ ok: false, done: true, error: 'ComfyUI completed but no output image found', seed }); }
        const srcPath = subfolder ? `${comfyOutputDir}/${subfolder}/${filename}` : `${comfyOutputDir}/${filename}`;
        if (!fs.existsSync(galleryDir)) fs.mkdirSync(galleryDir, { recursive: true });
        const dstPath = `${galleryDir}/${filename}`;
        // Move output → gallery. A move failure is TERMINAL (don't leave the client
        // polling forever): mark the job failed with the real error and free VRAM.
        try {
          try { fs.renameSync(srcPath, dstPath); }
          catch { fs.copyFileSync(srcPath, dstPath); try { fs.unlinkSync(srcPath); } catch {} }
        } catch (moveErr) {
          logger.warn({ srcPath, dstPath, err: String(moveErr) }, 'ComfyUI output move to gallery failed');
          finish({ error: `couldn't save the image to the gallery: ${String(moveErr)}` });
          void comfyFree();
          return c.json({ ok: false, done: true, error: `couldn't save the image to the gallery: ${String(moveErr)}`, seed });
        }
        // B6: the `if (!url)` guard that was here was unreachable — a template
        // literal is never falsy, and `filename` is already null-checked above.
        // Removed to eliminate dead code (the original comment was aspirational).
        const url = `/api/gallery/file?root=comfyui&sub=&name=${encodeURIComponent(filename)}`;
        finish({ file: filename, url });
        void comfyFree();
        notify(`✅ Image ready: ${filename} (${(job?.checkpoint||'').replace('.safetensors','')})`);
        return c.json({ ok: true, done: true, file: filename, url, seed, notes: `checkpoint: ${(job?.checkpoint||'').replace('.safetensors','')}` });
      }
      release();
      return c.json({ ok: true, done: false });
    } catch (e) {
      release();
      return c.json({ ok: true, done: false, transient: String(e) });
    }
  });

  // ── System disk — always report WSL virtual AND C: physical ──
  // C: is the true ceiling: the WSL .vhdx file expands into C: space.
  // "df /" returns 846 GB "free" (expandable virtual) but C: has ~133 GB.
  app.get('/api/system/disk', async (c) => {
    try {
      const { execSync } = await import('child_process');
      const parseDF = (raw: string) => {
        const p = raw.trim().split(/\s+/);
        return { fs: p[0], size: p[1], used: p[2], avail: p[3], pct: p[4] };
      };
      let wsl: ReturnType<typeof parseDF> | null = null;
      let cdrive: ReturnType<typeof parseDF> | null = null;
      try { wsl = parseDF(execSync('df -h / | tail -1', { stdio: 'pipe' }).toString()); } catch {}
      try { cdrive = parseDF(execSync('df -h /mnt/c | tail -1', { stdio: 'pipe' }).toString()); } catch {}
      const cPct = cdrive ? parseInt(cdrive.pct) : 0;
      const warning = cPct >= 85 ? `C: drive ${cdrive!.pct} full — ${cdrive!.avail} free` : null;
      return c.json({ wsl, cdrive, warning, critical: cPct >= 95, note: 'C: is the physical limit; WSL .vhdx expands into it.' });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // ── System metrics for the phone — surfaces ~/metrics/metrics.db (cpu/ram/
  //    gpu/disk/protection health, collected every 60s by metrics/collector.py)
  //    PLUS a LIVE system-guardian preflight verdict, so the Create page can show
  //    health and hard-disable Generate when unsafe. Read-only; never recollects.
  app.get('/api/system/metrics', async (c) => {
    const HOME = process.env.HOME || '/home/itsju';
    const dbPath = `${HOME}/metrics/metrics.db`;
    let metrics: Record<string, unknown> = {};
    let staleness = -1;
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const hw = db.prepare('SELECT * FROM hw_metrics ORDER BY ts DESC LIMIT 1').get() as Record<string, number> | undefined;
        const disk = db.prepare('SELECT * FROM disk_metrics ORDER BY ts DESC LIMIT 1').get() as Record<string, number> | undefined;
        const prot = db.prepare('SELECT * FROM protection_health ORDER BY ts DESC LIMIT 1').get() as Record<string, number> | undefined;
        metrics = { hw: hw ?? null, disk: disk ?? null, protection: prot ?? null };
        const latestTs = Math.max(hw?.ts ?? 0, disk?.ts ?? 0, prot?.ts ?? 0);
        if (latestTs > 0) staleness = Math.floor(Date.now() / 1000) - latestTs;
      } finally { db.close(); }
    } catch (e) { metrics = { error: String(e) }; }
    // Live preflight = the exact gate the server enforces, so the UI verdict can
    // never disagree with what the server will actually allow.
    const preflight = await preflightGate();
    return c.json({ metrics, preflight, staleness, stale: staleness < 0 || staleness > 180 });
  });

  // ── Model manager — download a Civitai model from the phone, disk-gated ──
  //   Every download goes through model-cap-check (hard folder ceiling) and
  //   safe-model-download (refuses if C: <= 30G), so models can never silently
  //   refill C:. Progress is polled via GET /api/models/download/:id.
  const comfyJobs = new Map<string, { seed: number; checkpoint: string; done: boolean;
    settling?: boolean; file?: string; url?: string; error?: string; queuedAt: number }>();
  // Sweep finished jobs (free RAM) and reclaim VRAM from abandoned ones (browser
  // closed mid-gen → its poll never reached the terminal comfyFree). Runs every
  // 10 min; unref'd so it never keeps the process alive on its own.
  setInterval(() => {
    const now = Date.now();
    for (const [id, j] of comfyJobs) {
      if (j.done && now - j.queuedAt > 30 * 60_000) comfyJobs.delete(id);
      else if (!j.done && now - j.queuedAt > 20 * 60_000) { void comfyFree(); comfyJobs.delete(id); }
    }
  }, 10 * 60_000).unref?.();
  // Last time we spawned comfyui-start, so a burst of "still starting" re-kicks
  // from the client doesn't spawn a launcher storm during the cold-boot window.
  let comfyStartedAt = 0;
  // B5 — TOCTOU guard: two concurrent POSTs can both pass comfyQueueDepth()>=1
  // in the same event-loop tick. This single-tick boolean prevents the double-
  // submit. Set true before the async depth check, cleared in finally after the
  // queue POST (or on any early return path that goes through finally).
  let comfySubmitting = false;
  const modelDownloads = new Map<string, { dest: string; name: string; status: 'downloading' | 'done' | 'failed'; pct: number; error?: string }>();
  const MODEL_DEST_DIRS: Record<string, string> = { checkpoints: 'checkpoints', loras: 'loras', controlnet: 'controlnet', vae: 'vae' };

  // Best-effort: after a Civitai download finishes, ask Civitai what it is and
  // record family + trigger words in the manifest. Never throws / never blocks.
  async function captureCivitaiMeta(url: string, token: string, name: string, dest: string) {
    try {
      const m = url.match(/models\/(\d+)/);
      if (!m) return;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const r = await fetch(`https://civitai.com/api/v1/model-versions/${m[1]}`, { headers });
      if (!r.ok) return;
      const data = await r.json() as { baseModel?: string; trainedWords?: string[]; model?: { type?: string } };
      if (!data?.baseModel) return;
      // MERGE, don't replace — a re-download must never wipe user-set labels/
      // categories or the cached sha256/thumb.
      mergeMeta(name, {
        family: normalizeFamily(data.baseModel),
        baseModel: data.baseModel,
        type: dest === 'loras' ? 'lora' : dest === 'checkpoints' ? 'checkpoint' : dest,
        triggers: Array.isArray(data.trainedWords) ? data.trainedWords : [],
        source: 'civitai',
        verified: true,
      });
    } catch { /* metadata is a nicety; download already succeeded */ }
  }

  // ── Civitai thumbnails — look up each model's preview image by file hash ──
  // Cards show a family-colored tile until this runs; it hashes each model file
  // (sha256, cached so it never re-hashes the GBs) and asks Civitai for that
  // version's images, storing the primary image URL + its nsfwLevel. NSFW images
  // need a Civitai token (the same one used for downloads); without it Civitai
  // returns only the SFW previews. One job at a time; progress polled via GET.
  const thumbJobs = new Map<string, { total: number; processed: number; updated: number; current: string; done: boolean; error?: string }>();
  async function fetchThumbForFile(absPath: string, name: string, type: 'checkpoint' | 'lora', token: string, force = false): Promise<boolean> {
    const { execFileSync } = await import('child_process');
    const manifest = readManifest();
    const existing = manifest[name] || metaFor(name, manifest);
    if (existing.thumb && !force) return false;             // already have one (force re-fetches, e.g. to pull NSFW previews with a token)
    let sha = existing.sha256;
    if (!sha) { try { sha = execFileSync('sha256sum', [absPath]).toString().split(' ')[0]; } catch { return false; } }
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    let data: any = null;
    try {
      const r = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${sha}`, { headers });
      if (r.ok) data = await r.json();
    } catch { /* offline / not found */ }
    const imgs: any[] = (data?.images || []).filter((i: any) => (i?.type === 'image' || !i?.type) && i?.url);
    // Cache the sha even on a miss so a re-run never re-hashes this file.
    if (!imgs.length) { upsertMeta(name, { ...existing, sha256: sha }); return false; }
    const primary = imgs[0];
    // Normalize the Civitai transform segment to a light thumbnail width.
    const thumb = String(primary.url).replace(/(\/[0-9a-f-]{36}\/)(?:[^/]*=[^/]*)\//i, '$1width=350,quality=80/');
    upsertMeta(name, {
      ...existing, sha256: sha, thumb, thumbNsfw: primary.nsfwLevel ?? 1,
      // Opportunistically backfill family/triggers from the same response if we
      // only had a filename guess before (gives 'other' LoRAs a real family).
      ...(existing.verified ? {} : {
        family: normalizeFamily(data.baseModel), baseModel: data.baseModel,
        triggers: Array.isArray(data.trainedWords) ? data.trainedWords : [],
        type, source: 'civitai', verified: true,
      }),
    });
    return true;
  }
  app.post('/api/comfy/thumbs/refresh', async (c) => {
    const HOME = process.env.HOME || '/home/itsju';
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const token = String((body as any)?.token ?? '').trim();
    const force = !!(body as any)?.force;
    if ([...thumbJobs.values()].some(j => !j.done)) return c.json({ ok: false, error: 'a thumbnail refresh is already running' }, 429);
    const ckptDir = `${HOME}/ComfyUI/models/checkpoints`;
    const loraDir = `${HOME}/ComfyUI/models/loras`;
    const list = (dir: string, type: 'checkpoint' | 'lora') => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter(f => f.endsWith('.safetensors') || f.endsWith('.ckpt') || f.endsWith('.gguf'))
      .map(f => ({ name: f, abs: `${dir}/${f}`, type }));
    const all = [...list(ckptDir, 'checkpoint'), ...list(loraDir, 'lora')];
    const jobId = `thumbs-${Date.now()}`;
    const job = { total: all.length, processed: 0, updated: 0, current: '', done: false };
    thumbJobs.set(jobId, job);
    void (async () => {
      for (const f of all) {
        job.current = f.name;
        try { if (await fetchThumbForFile(f.abs, f.name, f.type, token, force)) job.updated++; } catch { /* skip */ }
        job.processed++;
      }
      job.current = ''; job.done = true;
      logger.info({ updated: job.updated, total: job.total }, 'Civitai thumbnail refresh complete');
    })();
    return c.json({ ok: true, jobId, total: all.length });
  });
  app.get('/api/comfy/thumbs/refresh/:id', (c) => {
    const j = thumbJobs.get(c.req.param('id'));
    return j ? c.json({ ok: true, ...j }) : c.json({ ok: false, error: 'unknown job' }, 404);
  });

  // ── Character Studio — trained, reusable character LoRAs (local, SDXL) ────
  // Read/manage the Character Studio (/AIWorkWSL/tools/character-studio). Training
  // is a heavy GPU step owned by the CLI (returned as a command); these routes are
  // light: list/status, write the kohya config, publish (symlink, C:-safe), and QA.
  app.get('/api/characters', (c) => {
    try { return c.json({ ok: true, characters: listCharacters() }); }
    catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });
  app.get('/api/characters/:name', (c) => {
    const ch = getCharacter(c.req.param('name'));
    if (!ch) return c.json({ ok: false, error: 'unknown character' }, 404);
    return c.json({ ok: true, character: ch, trainCommand: trainCommandFor(ch.name) });
  });
  app.post('/api/characters/:name/config', async (c) => {
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const r = await configureCharacter(
      c.req.param('name'),
      typeof b.base === 'string' ? b.base : undefined,
      Number(b.res) || 768,
      Number(b.steps) || 0,
    );
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post('/api/characters/:name/publish', async (c) => {
    const r = await publishCharacter(c.req.param('name'));
    return c.json(r, r.ok ? 200 : 400);
  });
  // Keyframe drift-free video: pin a clip to a locked keyframe (a gallery still)
  // and let LTX add only motion (no character drift). One keyframe = subtle i2v;
  // add an end keyframe for first-last-frame. Preflight-gated + 14G cgroup via
  // generateKeyframeVideo (same crash-safety as t2v). Body: {init:{root,sub,name},
  // end?:{root,sub,name}, prompt?, frames?, steps?, seed?}.
  app.post('/api/comfy/keyframe-video', async (c) => {
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const init = (b.init || {}) as { root?: string; sub?: string; name?: string };
    const initPath = resolveGalleryFile(String(init.root || 'generated'), String(init.sub || ''), String(init.name || ''));
    if (!initPath) return c.json({ ok: false, error: 'keyframe (init) not found' }, 404);
    let endPath: string | undefined;
    if (b.end && typeof b.end === 'object') {
      const end = b.end as { root?: string; sub?: string; name?: string };
      endPath = resolveGalleryFile(String(end.root || 'generated'), String(end.sub || ''), String(end.name || '')) || undefined;
    }
    const result = await generateKeyframeVideo({
      initImage: initPath, endImage: endPath,
      prompt: typeof b.prompt === 'string' ? b.prompt : undefined,
      frames: Number(b.frames) || undefined, steps: Number(b.steps) || undefined,
      seed: Number.isFinite(Number(b.seed)) ? Number(b.seed) : undefined,
    });
    return c.json(result, result.ok ? 200 : 400);
  });

  // Auto-QA a generated still/clip. Accepts a gallery {root,sub,name} (resolved
  // safely, same as /api/gallery/file) so it can't read arbitrary paths.
  app.post('/api/qa/review', async (c) => {
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const full = resolveGalleryFile(
      String(b.root || 'generated'), String(b.sub || ''), String(b.name || ''),
    );
    if (!full) return c.json({ ok: false, error: 'file not found' }, 404);
    const verdict = await reviewGen(full, b.vlm === true);
    return c.json({ ok: true, verdict, summary: qaSummary(verdict) });
  });

  // ── Looks — curated checkpoint+LoRA presets for the Create page ──────────
  // Builtins live in data/looks.json (repo), user-saved Looks in
  // ~/.claudeclaw/looks.local.json. Validated against installed files at read
  // time so a removed model shows as "needs <file>" instead of breaking.
  app.get('/api/looks', (c) => {
    try { return c.json({ ok: true, looks: listLooks() }); }
    catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  app.post('/api/looks', async (c) => {
    try {
      const body = await c.req.json();
      const saved = saveUserLook(body);
      return c.json({ ok: true, look: saved });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  app.delete('/api/looks/:id', (c) => {
    try {
      const removed = deleteUserLook(c.req.param('id'));
      return removed ? c.json({ ok: true }) : c.json({ ok: false, error: 'unknown look (builtins cannot be deleted)' }, 404);
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  // ── Friendly model metadata — user-set label/description/category ────────
  // Merge-upsert into the manifest (survives Civitai re-downloads since
  // captureCivitaiMeta also merges). Powers the post-download "name this
  // model" form and any future per-card edit affordance.
  app.post('/api/models/meta', async (c) => {
    try {
      const body = await c.req.json() as { name?: string; label?: string; description?: string; category?: string; recommendedStrength?: number };
      const name = String(body?.name ?? '').trim();
      if (!name) return c.json({ ok: false, error: 'name is required' }, 400);
      const patch: Partial<ModelMeta> = {};
      if (typeof body.label === 'string') patch.label = body.label.trim() || undefined;
      if (typeof body.description === 'string') patch.description = body.description.trim() || undefined;
      if (typeof body.category === 'string') patch.category = body.category.trim() || undefined;
      if (typeof body.recommendedStrength === 'number' && isFinite(body.recommendedStrength)) patch.recommendedStrength = body.recommendedStrength;
      if (!Object.keys(patch).length) return c.json({ ok: false, error: 'nothing to update' }, 400);
      const merged = mergeMeta(name, patch);
      return c.json({ ok: true, meta: merged });
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  app.post('/api/models/download', async (c) => {
    const HOME = process.env.HOME || '/home/itsju';
    try {
      const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
      const url = String(body?.url ?? '').trim();
      const token = String(body?.token ?? '').trim();
      const dest = String(body?.dest ?? '').trim();
      let name = String(body?.filename ?? '').trim();
      let host = '';
      try { host = new URL(url).host; } catch { return c.json({ ok: false, error: 'invalid url' }, 400); }
      if (!/(^|\.)civitai\.com$/.test(host)) return c.json({ ok: false, error: 'only civitai.com downloads are allowed' }, 400);
      if (!MODEL_DEST_DIRS[dest]) return c.json({ ok: false, error: `dest must be one of: ${Object.keys(MODEL_DEST_DIRS).join(', ')}` }, 400);
      if (!name) { const m = url.match(/models\/(\d+)/); name = `civitai-${m ? m[1] : 'model'}.safetensors`; }
      name = name.replace(/[^\w.\-]/g, '_');  // sanitize — block path traversal
      if (!/\.(safetensors|ckpt|pt|gguf)$/i.test(name)) name += '.safetensors';

      const { execSync, spawn } = await import('child_process');
      // Hard model-folder cap — refuse before we even start.
      try { execSync(`${HOME}/05_AUTOMATION/bin/model-cap-check`, { stdio: 'pipe' }); }
      catch (e) {
        const out = (e as { stdout?: Buffer }).stdout?.toString().trim() || 'model folder cap exceeded';
        notify(`🛑 Model download refused (cap): ${out}`);
        return c.json({ ok: false, blocked: true, error: out }, 409);
      }

      const destDir = `${HOME}/ComfyUI/models/${MODEL_DEST_DIRS[dest]}`;
      const jobId = crypto.randomUUID();
      modelDownloads.set(jobId, { dest, name, status: 'downloading', pct: 0 });
      const args = ['aria2c', '-x8', '-s8', '--summary-interval=1', '--auto-file-renaming=false', '--allow-overwrite=false', '-d', destDir, '-o', name];
      if (token) args.push(`--header=Authorization: Bearer ${token}`);
      args.push(url);
      const child = spawn(`${HOME}/05_AUTOMATION/bin/safe-model-download`, args, { env: { ...process.env, HOME } });
      const onData = (buf: Buffer) => { const m = buf.toString().match(/\((\d+)%\)/); if (m) { const j = modelDownloads.get(jobId); if (j) j.pct = Number(m[1]); } };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('close', (code) => {
        const j = modelDownloads.get(jobId); if (!j) return;
        if (code === 0) {
          j.status = 'done'; j.pct = 100; invalidateGalleryCache();
          // Capture compatibility metadata straight from Civitai so the new model
          // is correctly classified (family + triggers) with no hardcoding.
          void captureCivitaiMeta(url, token, name, dest);
        }
        else { j.status = 'failed'; j.error = `download exited ${code} — safe-model-download may have refused (C: too low) or auth failed`; }
        notify(j.status === 'done' ? `✅ Model downloaded: ${name} → ${dest}` : `⚠️ Model download failed: ${name} — ${j.error}`);
      });
      return c.json({ ok: true, jobId, name, dest });
    } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
  });

  app.get('/api/models/download/:id', (c) => {
    const j = modelDownloads.get(c.req.param('id'));
    if (!j) return c.json({ ok: false, error: 'unknown job' }, 404);
    return c.json({ ok: true, ...j });
  });

  // ── Wallets — aggregated brokerage/exchange balances (moved here from
  //    MissionCtrl so sensitive balances stay on the local-only dashboard) ──
  app.get('/api/wallets', async (c) => {
    try {
      const wallets = await getWallets();
      return c.json(wallets);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Equity Management — per-agent Alpaca analytics (boba + jazzy):
  //    equity curves, risk metrics, and trading-discipline guardrail flags.
  //    Read-only; same local-only stance as /api/wallets. See src/equity.ts.
  app.get('/api/equity', async (c) => {
    try {
      return c.json(await getEquity());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Massage By Mike — ops cockpit. Proxies the massage server's token-guarded admin API
  //    (localhost:3003); the bearer token is injected server-side so it never reaches a browser.
  //    See src/massage.ts. Read = account health + lifecycle countdowns; POST = keep/delete/reaper.
  app.get('/api/massage/monitor', async (c) => {
    try { return c.json(await getMassageMonitor(c.req.query('force') === '1')); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage/account/:id/keep', async (c) => {
    try { return c.json(await keepAccount(c.req.param('id'))); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage/account/:id/delete', async (c) => {
    try { return c.json(await deleteAccount(c.req.param('id'))); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage/reaper', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      return c.json(await setReaper(body));
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });

  app.get('/api/massage-admin/session', async (c) => {
    const admin = await requireMassageAdmin(c);
    return c.json({
      canEdit: admin.ok,
      adminUser: admin.ok ? admin.adminUser : null,
      reason: admin.ok ? null : admin.error,
      roleTodo: 'Replace master-session/local admin-equivalent checks with real per-user admin roles.',
    });
  });
  app.get('/api/massage-admin/clients', (c) => {
    try { return c.json(getMassageAdminOverview()); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.patch('/api/massage-admin/clients/:id', async (c) => {
    const admin = await requireMassageAdmin(c);
    if (!admin.ok) return c.json({ error: admin.error }, admin.status as 401);
    try {
      const body = await c.req.json().catch(() => ({}));
      const result = updateMassageAdminClient(c.req.param('id'), body, admin.adminUser);
      return 'error' in result ? c.json(result, result.migration ? 409 : 400) : c.json(result);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });

  // Two-admin Google sign-in (gives remote sessions a real, allow-listed identity).
  app.get('/massage-admin/login', (c) => massageAdminLoginStart(c));
  app.get('/massage-admin/oauth/callback', (c) => massageAdminOauthCallback(c));

  // Full-admin actions — every one gated by requireMassageAdmin and proxied to the
  // massage server (system of record) with the acting admin's email in x-admin-user.
  const withAdmin = (fn: (c: any, adminUser: string) => Promise<Response>) => async (c: any) => {
    const admin = await requireMassageAdmin(c);
    if (!admin.ok) return c.json({ error: admin.error }, admin.status as 401);
    try { return await fn(c, admin.adminUser); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  };
  const body = async (c: any) => c.req.json().catch(() => ({}));
  const enc = encodeURIComponent;

  // account lifecycle
  app.post('/api/massage-admin/clients/:id/delete', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/delete`, { method: 'POST', adminUser: u }))));
  app.post('/api/massage-admin/clients/:id/reset-password', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/reset-password`, { method: 'POST', adminUser: u }))));
  app.post('/api/massage-admin/clients/:id/set-password', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/set-password`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/clients/:id/verify', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/verify`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/clients/create', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/new/create`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/clients/:id/enhancement', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/enhancement`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/clients/:id/reward', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/reward`, { method: 'POST', body: await body(c), adminUser: u }))));

  // appointments (read is loopback-safe via global gate; actions require admin)
  app.get('/api/massage-admin/clients/:id/appointments', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/appointments`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage-admin/appointments/:id/:action', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/appointment/${enc(c.req.param('id'))}/${enc(c.req.param('action'))}`, { method: 'POST', adminUser: u }))));

  // messaging
  app.post('/api/massage-admin/appointments/:id/nudge-intake', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/appointment/${enc(c.req.param('id'))}/nudge-intake`, { method: 'POST', adminUser: u }))));
  app.post('/api/massage-admin/appointments/:id/remind', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/appointment/${enc(c.req.param('id'))}/remind`, { method: 'POST', adminUser: u }))));
  app.post('/api/massage-admin/clients/:id/message', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/account/${enc(c.req.param('id'))}/message`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.get('/api/massage-admin/messages', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/messages?limit=${enc(c.req.query('limit') || '50')}`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.get('/api/massage-admin/schedule', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/schedule`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });

  // coupons / promos
  app.get('/api/massage-admin/codes', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/codes`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage-admin/codes', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/codes`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/codes/:code/toggle', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/codes/${enc(c.req.param('code'))}/toggle`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/gift/issue', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/gift/issue`, { method: 'POST', body: await body(c), adminUser: u }))));

  // intake review + clinical SOAP notes (reads loopback-safe; writes require admin)
  app.get('/api/massage-admin/intakes', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/intakes?limit=${enc(c.req.query('limit') || '200')}`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.get('/api/massage-admin/intakes/:id', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/intakes/${enc(c.req.param('id'))}`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage-admin/intakes/:id/reviewed', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/intakes/${enc(c.req.param('id'))}/reviewed`, { method: 'POST', adminUser: u }))));
  app.get('/api/massage-admin/soap', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/soap?client=${enc(c.req.query('client') || '')}`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.get('/api/massage-admin/soap/appt/:apptId', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/soap/appt/${enc(c.req.param('apptId'))}`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage-admin/soap', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/soap`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.patch('/api/massage-admin/soap/:id', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/soap/${enc(c.req.param('id'))}`, { method: 'PATCH', body: await body(c), adminUser: u }))));

  // availability — days off, booking window, beyond-window approval queue (reads loopback-safe; writes require admin)
  app.get('/api/massage-admin/availability', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/availability`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.get('/api/massage-admin/availability/pending', async (c) => {
    try { return c.json(await massageAdmin(`/api/admin/availability/pending`, { method: 'GET', adminUser: 'reader' })); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  });
  app.post('/api/massage-admin/availability/blackout', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/availability/blackout`, { method: 'POST', body: await body(c), adminUser: u }))));
  app.delete('/api/massage-admin/availability/blackout/:day', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/availability/blackout/${enc(c.req.param('day'))}`, { method: 'DELETE', adminUser: u }))));
  app.put('/api/massage-admin/availability/window', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/availability/window`, { method: 'PUT', body: await body(c), adminUser: u }))));
  app.post('/api/massage-admin/availability/pending/:id/:action', withAdmin(async (c, u) =>
    c.json(await massageAdmin(`/api/admin/availability/pending/${enc(c.req.param('id'))}/${enc(c.req.param('action'))}`, { method: 'POST', adminUser: u }))));

  // ── SQL Monitor — read-only inventory + browse for every operational SQLite DB
  //    on the box (see src/sqlmonitor.ts). Self-contained; shares no code with the
  //    /databases catalog. SELECT-only queries; no write/action routes. Localhost is
  //    auto-authed by the global token middleware, so no extra auth wiring here.
  app.get('/api/sql', async (c) => {
    try { return c.json(await getSqlCatalog()); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.get('/api/sql/:id/meta', async (c) => {
    try {
      const result = await getSqlTables(c.req.param('id'));
      if ('error' in result) return c.json(result, 404);
      return c.json(result);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.post('/api/sql/:id/query', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({} as { sql?: string }));
      const result = runSqlSelect(c.req.param('id'), (body as { sql?: string }).sql || '');
      if ('error' in result) return c.json(result, 400);
      return c.json(result);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });

  // ── SQL MODERATION — single-row writes on `writable` DBs only. Each write is
  //    auto-backed-up (file snapshot + before-image) and audited to a separate
  //    moderation_audit.sqlite (one-click undo). Read-only DBs reject these.
  const modIp = (c: { req: { header: (k: string) => string | undefined } }) =>
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || (c.req.header('x-real-ip') || '');

  // Addressable rows (rowid + columns) for an editable table.
  app.get('/api/sql/:id/rows', (c) => {
    try {
      const r = getModerationRows(c.req.param('id'), c.req.query('table') || '',
        Number(c.req.query('limit')) || 200, Number(c.req.query('offset')) || 0);
      return 'error' in r ? c.json(r, 400) : c.json(r);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.post('/api/sql/:id/row/update', async (c) => {
    try {
      const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
      const r = await updateRow(c.req.param('id'), (b.table as string) || '',
        (b.key as { rowid?: number | string; pk?: Record<string, unknown> }) || {},
        (b.changes as Record<string, unknown>) || {}, modIp(c));
      return 'error' in r ? c.json(r, 400) : c.json(r);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.post('/api/sql/:id/row/delete', async (c) => {
    try {
      const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
      const r = await deleteRow(c.req.param('id'), (b.table as string) || '',
        (b.key as { rowid?: number | string; pk?: Record<string, unknown> }) || {}, modIp(c));
      return 'error' in r ? c.json(r, 400) : c.json(r);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.post('/api/sql/:id/row/insert', async (c) => {
    try {
      const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
      const r = await insertRow(c.req.param('id'), (b.table as string) || '',
        (b.values as Record<string, unknown>) || {}, modIp(c));
      return 'error' in r ? c.json(r, 400) : c.json(r);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.get('/api/sql/audit', (c) => {
    try { return c.json(getSqlAuditLog(Number(c.req.query('limit')) || 100, c.req.query('db') || undefined)); }
    catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });
  app.post('/api/sql/audit/:auditId/undo', async (c) => {
    try {
      const r = await undoMutation(Number(c.req.param('auditId')), modIp(c));
      return 'error' in r ? c.json(r, 400) : c.json(r);
    } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 500); }
  });

  // ── Trade History & What-If — RH-crypto buy/sell ledger + "never sold"
  //    counterfactual + forward compounding. See src/tradehistory.ts.
  app.get('/api/trade-history', async (c) => {
    try {
      return c.json(await getTradeHistory());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Token Burn — normalised codeburn export (codeburn.export.v2).
  //    Reads ~/.claudeclaw/token-burn.json written nightly by codeburn-daily.sh.
  //    Drops sessions[]/shellCommands[] before sending to frontend. See src/tokenburn.ts.
  app.get('/api/token-burn', async (c) => {
    try {
      return c.json(await getTokenBurn());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Lewis Trading — integrations harvested from Lewis Jackson's "YouTube
  //    Video Prompts" course (zero-one Skool). Kept separate from Skool Builds.
  //    Read-only: manifest at ~/.claudeclaw/lewis-trading.json; only
  //    manifest-declared files are readable (see src/lewistrading.ts).
  app.get('/api/lewis-trading', (c) => {
    try { return c.json(getLewisIntegrations()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });
  app.get('/api/lewis-trading/file', (c) => {
    const id = c.req.query('id') || '';
    const name = c.req.query('name') || '';
    const out = readLewisFile(id, name);
    if (!out) return c.json({ error: 'not found' }, 404);
    return c.json(out);
  });

  // ── Skool Builds — artifacts generated from running Skool classroom prompts.
  //    Read-only; manifest at ~/.claudeclaw/skool-builds.json; only manifest-
  //    declared files are readable (see src/skoolbuilds.ts).
  app.get('/api/skool-builds', (c) => {
    try { return c.json(getSkoolBuilds()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });
  app.get('/api/skool-builds/file', (c) => {
    const id = c.req.query('id') || '';
    const name = c.req.query('name') || '';
    const out = readSkoolArtifact(id, name);
    if (!out) return c.json({ error: 'not found' }, 404);
    return c.json(out);
  });

  // ── Trade Desk — unified trading intelligence panel (signals, flow rank,
  //    winners, momentum, macro, brief, AIME). All read-only. Data comes from
  //    the live pipeline DBs and firebase-signals on the laptop.

  app.get('/api/trade-desk/overview', (c) => {
    try { return c.json(getTradeDeskOverview()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/signals', (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);
    try { return c.json(getSignals(limit)); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/flow-rank', (c) => {
    try { return c.json(getFlowRank()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // Signal Monitor — live option/flow app feeds + headless-listener health.
  app.get('/api/signal-monitor', (c) => {
    const perApp = Math.min(parseInt(c.req.query('perApp') || '30', 10), 100);
    try { return c.json(getSignalMonitor(perApp)); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // Live Apps — redroid + ws-scrcpy setup status / embed gate (B2).
  app.get('/api/live-apps/status', async (c) => {
    try { return c.json(await getLiveAppsStatus()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/flow-winners', (c) => {
    const days = parseInt(c.req.query('days') || '7', 10);
    const symbol = c.req.query('symbol') || undefined;
    try { return c.json({ winners: getFlowWinners(days, symbol) }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/momentum', (c) => {
    try { return c.json({ momentum: getMomentum() }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/macro', (c) => {
    try { return c.json({ macro: getMacro() }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/ledger', (c) => {
    const hours = parseInt(c.req.query('hours') || '48', 10);
    try { return c.json({ ledger: getTradeLedger(hours) }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/trade-desk/brief', (c) => {
    try { return c.json(getBrief()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post('/api/trade-desk/aime', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return c.json({ error: 'prompt required' }, 400);
      const cookie = AIME_SESSION_COOKIE;
      if (!cookie) return c.json({ response: '', status: 'no_cookie', message: 'Set AIME_SESSION_COOKIE in .env to activate' });
      const result = await queryAIME(prompt, cookie);
      return c.json(result);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // ── Gallery — generated images/videos, surfaced from the same local source
  //    folders as the :8090 BobaCatTrades + Nano gallery (see src/gallery.ts).
  //    Served here so it's same-origin (no CORS) and works even if :8090 is down.
  app.get('/api/gallery', (c) => {
    try {
      return c.json(getGallery());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
  app.get('/api/gallery/file', (c) => {
    const full = resolveGalleryFile(
      c.req.query('root') || '',
      c.req.query('sub') || '',
      c.req.query('name') || '',
    );
    if (!full) return c.text('', 404);
    let data: Buffer;
    try {
      data = fs.readFileSync(full);
    } catch {
      return c.text('', 404); // file vanished between stat and read (live folders)
    }
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': galleryMime(full), 'Cache-Control': 'public, max-age=300' },
    });
  });

  // POST a prompt → run the Nano Banana generator (banana-maker skill). The image
  // saves into its output/ dir, which is the gallery "Generated" section, so it
  // appears in /gallery automatically. Returns {ok,file,url,notes} or {ok:false,error}.
  app.post('/api/gallery/generate', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const prompt = String(body?.prompt ?? '');
    const source = typeof body?.source === 'string' ? body.source : 'banana';
    let result;
    if (source === 'higgsfield') {
      result = await generateHiggsfield({
        kind: 'image',
        prompt,
        model: typeof body?.model === 'string' ? body.model : undefined,
        aspectRatio: typeof body?.aspectRatio === 'string' ? body.aspectRatio : undefined,
        resolution: typeof body?.resolution === 'string' ? body.resolution : undefined,
      });
    } else if (source === 'local') {
      result = await generateLocalImage({
        prompt,
        model: typeof body?.model === 'string' ? body.model : undefined,
        steps: typeof body?.steps === 'number' ? body.steps : undefined,
        seed: typeof body?.seed === 'number' ? body.seed : undefined,
      });
    } else {
      result = await generateImage({
        prompt,
        model: typeof body?.model === 'string' ? body.model : undefined,
        aspectRatio: typeof body?.aspectRatio === 'string' ? body.aspectRatio : undefined,
        size: typeof body?.size === 'string' ? body.size : undefined,
      });
    }
    if (result.ok) invalidateGalleryCache();
    return c.json(result);
  });

  // Photo Studio EDIT (img2img) — upload a photo + an instruction and Nano Banana
  // Pro transforms it while keeping the subject ("make me half-wolf", "bionic",
  // "film-noir filter"). Multipart form: photo (file) + prompt + optional
  // model/aspectRatio/size. The result lands in the gallery "Generated" section
  // exactly like /generate, so it shows up in the Media & Gens view automatically.
  // This is the upload-from-phone path the Create page (text→image) can't do.
  app.post('/api/gallery/edit', async (c) => {
    let tmp = '';
    try {
      const form = await c.req.parseBody();
      const prompt = String(form?.prompt ?? '').trim();
      const photo = form?.photo;
      if (!prompt) return c.json({ ok: false, error: 'Describe the edit — e.g. "make me half-wolf with glowing amber eyes".' }, 400);
      if (!photo || typeof photo === 'string') return c.json({ ok: false, error: 'No photo uploaded.' }, 400);

      const buf = Buffer.from(await photo.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) return c.json({ ok: false, error: 'Photo too large (max 12 MB).' }, 400);
      if (buf.length < 64) return c.json({ ok: false, error: 'Photo is empty or unreadable.' }, 400);
      // Magic-byte sniff so a renamed non-image can't reach the generator.
      const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
                     buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
      if (!isJpg && !isPng && !isWebp) return c.json({ ok: false, error: 'Unsupported image — use JPG, PNG, or WebP.' }, 400);

      const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
      tmp = `/tmp/cc-studio-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      fs.writeFileSync(tmp, buf);

      // Default to Nano Banana PRO for edits — it holds the subject's likeness far
      // better than Flash, which matters for "turn ME into X" transforms.
      const model = typeof form?.model === 'string' && form.model ? String(form.model) : 'pro';
      const result = await generateImage({
        prompt,
        model,
        references: [tmp],
        aspectRatio: typeof form?.aspectRatio === 'string' ? String(form.aspectRatio) : undefined,
        // Default edits to 1K: Pro img2img at 2K can blow past the timeout (~145s
        // at 1K vs >180s at 2K). 1K is plenty for a phone-viewed transform.
        size: typeof form?.size === 'string' ? String(form.size) : '1K',
      });
      if (result.ok) {
        invalidateGalleryCache();
        notify(`✅ Photo edit ready: ${result.file}`);
      }
      return c.json(result);
    } catch (e) {
      return c.json({ ok: false, error: `Edit failed: ${String((e as Error)?.message || e).slice(0, 200)}` }, 500);
    } finally {
      if (tmp) { try { fs.unlinkSync(tmp); } catch { /* best-effort temp cleanup */ } }
    }
  });

  // Batch generation — generate N images in one call.
  // Banana: runs sequentially (Gemini rate-limited, up to 5).
  // Local: runs sequentially (single GPU, up to 3).
  app.post('/api/gallery/batch-generate', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const prompt = String(body?.prompt ?? '');
    const source = typeof body?.source === 'string' ? body.source : 'local';
    const rawCount = typeof body?.count === 'number' ? body.count : 1;

    const maxCounts: Record<string, number> = { banana: 5, local: 3 };
    const count = Math.max(1, Math.min(rawCount, maxCounts[source] || 5));

    const results = [];

    if (source === 'banana') {
      // sequential — Gemini rate-limited
      for (let i = 0; i < count; i++) {
        const r = await generateImage({
          prompt,
          model: typeof body?.model === 'string' ? body.model : undefined,
          aspectRatio: typeof body?.aspectRatio === 'string' ? body.aspectRatio : undefined,
          size: typeof body?.size === 'string' ? body.size : undefined,
        });
        results.push(r);
      }
    } else {
      // local — single GPU, serialize
      for (let i = 0; i < count; i++) {
        const r = await generateLocalImage({
          prompt,
          model: typeof body?.model === 'string' ? body.model : undefined,
          steps: typeof body?.steps === 'number' ? body.steps : undefined,
        });
        results.push(r);
      }
    }

    if (results.some((r) => r.ok)) invalidateGalleryCache();
    return c.json({ results });
  });

  // Move a gallery file between declared sections (rename with cross-fs copy+delete fallback).
  app.post('/api/gallery/move', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const result = moveGalleryFile(
      String(body?.srcRoot ?? ''), String(body?.srcSub ?? ''), String(body?.name ?? ''),
      String(body?.dstRoot ?? ''), String(body?.dstSub ?? ''),
    );
    return c.json(result, result.ok ? 200 : 400);
  });

  // Local FREE video (diffusers LTX-Video on the GPU) → renders/ = gallery video section.
  app.post('/api/gallery/generate-video', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    // Higgsfield is CLOUD — it never touches the local GPU, so skip the GPU
    // preflight gate (which only guards the local LTX subprocess).
    if (body?.source === 'higgsfield') {
      const result = await generateHiggsfield({
        kind: 'video',
        prompt: String(body?.prompt ?? ''),
        model: typeof body?.model === 'string' ? body.model : undefined,
        aspectRatio: typeof body?.aspectRatio === 'string' ? body.aspectRatio : undefined,
        resolution: typeof body?.resolution === 'string' ? body.resolution : undefined,
      });
      if (result.ok) invalidateGalleryCache();
      notify(result.ok ? `✅ Higgsfield video ready: ${result.file}` : `⚠️ Higgsfield video failed: ${result.error}`);
      return c.json(result);
    }
    // Safety gate BEFORE spawning the long (up to 20-min) LTX subprocess so the
    // phone gets an instant "blocked: <reason>" instead of waiting. LTX on the
    // 8GB GPU is the box-freeze vector — localgen.ts also gates + locks it.
    const gate = await preflightGate();
    if (!gate.ok) { notify(`🛑 Video gen blocked: ${gate.reason}`); return c.json({ ok: false, blocked: true, error: `blocked: ${gate.reason}` }, 429); }
    // LTX-Video RAM guard (verified 2026-06-14): the LTX model is ~13GB and is
    // RAM-BOUND at LOAD — below ~14GB free it swap-thrashes for minutes and gets
    // OOM-killed before reaching the GPU (util stays 0%). Fail fast with the truth
    // instead of freezing the box. (Cloud/Higgsfield video skips this — handled above.)
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const m = meminfo.match(/MemAvailable:\s+(\d+)\s*kB/);
      const freeMB = m ? Math.round(parseInt(m[1], 10) / 1024) : 99999;
      if (freeMB < 14000) {
        const msg = `Local video needs ~14GB free RAM (the LTX model is large) — only ${(freeMB / 1024).toFixed(1)}GB free right now. Close other gens / let ComfyUI idle-stop, then retry, or use cloud video.`;
        notify(`🛑 Video gen blocked: low RAM (${(freeMB / 1024).toFixed(1)}GB free)`);
        return c.json({ ok: false, blocked: true, error: msg }, 429);
      }
    } catch { /* if we can't read meminfo, fall through to the existing gates */ }
    const result = await generateLocalVideo({
      prompt: String(body?.prompt ?? ''),
      frames: typeof body?.frames === 'number' ? body.frames : undefined,
      steps: typeof body?.steps === 'number' ? body.steps : undefined,
      seed: typeof body?.seed === 'number' ? body.seed : undefined,
    });
    if (result.ok) invalidateGalleryCache();
    notify(result.ok ? `✅ Video ready: ${result.file}` : `⚠️ Video gen failed: ${result.error}`);
    return c.json(result);
  });

  // Higgsfield model catalogue for the Create-page dropdowns (cached 5 min).
  // Shells `higgsfield model list --json` (image + --video) via the CLI.
  app.get('/api/higgsfield/models', async (c) => {
    const r = await listHiggsfieldModels();
    return c.json(r, r.ok ? 200 : 503);
  });

  // ── Hermes Agent workspace ────────────────────────────────────────────────
  app.get('/api/hermes', async (c) => {
    try { return c.json(getHermesData()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/hermes/logs', (c) => {
    const n = parseInt(c.req.query('n') || '60', 10);
    try { return c.json({ lines: getHermesLogs(Math.min(n, 200)) }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post('/api/hermes/send', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const chatId = String(body?.chat_id ?? '7888676328');
    const message = String(body?.message ?? '');
    if (!message.trim()) return c.json({ ok: false, message: 'empty message' }, 400);
    return c.json(hermesSend(chatId, message));
  });

  app.post('/api/hermes/restart', async (c) => {
    return c.json(hermesRestartGateway());
  });

  app.get('/api/hermes/status', (c) => {
    try { return c.json(getHermesStatus()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/hermes/config', (c) => {
    // Redacted allowlist only — never emits .env/auth/token/key material.
    try { return c.json(getHermesConfigRedacted()); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/hermes/toolsets', (c) => {
    try { return c.json({ toolsets: getHermesToolsets() }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post('/api/hermes/oneshot', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const prompt = String(body?.prompt ?? '');
    if (!prompt.trim()) return c.json({ ok: false, output: '', message: 'empty prompt' }, 400);
    return c.json(hermesOneshot(prompt));
  });

  // ── RapidAPI search console ───────────────────────────────────────────────
  // Generic console over any RapidAPI the account subscribes to. Key is read
  // server-side (config.ts) and never sent to the browser.
  app.get('/api/rapidapi/apis', (c) => {
    try { return c.json({ apis: listRapidApis() }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get('/api/rapidapi/search', async (c) => {
    const api = c.req.query('api') || '';
    const q = c.req.query('q') || '';
    try {
      return c.json(await rapidApiSearch(api, q));
    } catch (e: any) {
      const status = (e && typeof e.status === 'number') ? e.status : 500;
      return c.json({ error: e?.message || String(e) }, status);
    }
  });

  // ── War Room meeting history & transcript persistence ──────────────
  app.post('/api/warroom/meeting/start', async (c) => {
    const body: { id?: string; mode?: string; agent?: string } = await c.req.json().catch(() => ({}));
    const id = body.id || crypto.randomUUID();
    createWarRoomMeeting(id, body.mode || 'direct', body.agent || 'main');
    return c.json({ ok: true, meetingId: id });
  });

  app.post('/api/warroom/meeting/end', async (c) => {
    const body: { id?: string; entryCount?: number } = await c.req.json().catch(() => ({}));
    if (body.id) endWarRoomMeeting(body.id, body.entryCount || 0);
    return c.json({ ok: true });
  });

  app.post('/api/warroom/meeting/transcript', async (c) => {
    const body: { meetingId?: string; speaker?: string; text?: string } = await c.req.json().catch(() => ({}));
    if (body.meetingId && body.speaker && body.text) {
      addWarRoomTranscript(body.meetingId, body.speaker, body.text);
    }
    return c.json({ ok: true });
  });

  app.get('/api/warroom/meetings', (c) => {
    const limit = parseInt(c.req.query('limit') || '20');
    return c.json({ meetings: getWarRoomMeetings(limit) });
  });

  app.get('/api/warroom/meeting/:id/transcript', (c) => {
    return c.json({ transcript: getWarRoomTranscript(c.req.param('id')) });
  });

  // ── War Room pin: route all voice utterances to a specific agent ──
  // Lives in store/tmp (WARROOM_TMP_DIR) so the Python Pipecat server (a
  // separate process) can read the state without needing an IPC bus. router.py
  // checks this file's mtime and reloads only when it changes. Spoken agent
  // prefixes (e.g. "research, find X") still take precedence over the pin.
  const WARROOM_PIN_PATH = path.join(WARROOM_TMP_DIR, 'warroom-pin.json');
  const VALID_PIN_MODES = new Set(['direct', 'auto']);
  // Recompute on every call so newly-created agents become pinnable
  // without a dashboard restart. listAgentIds() reads the agent-configs
  // directory which the agent-create flow writes to synchronously.
  const getValidPinAgents = (): Set<string> => new Set(['main', ...listAgentIds()]);

  // Read current pin state from disk. Returns normalized defaults for
  // missing fields so callers can rely on both agent and mode being set.
  function readPinState(): { agent: string | null; mode: string } {
    try {
      if (fs.existsSync(WARROOM_PIN_PATH)) {
        const raw = JSON.parse(fs.readFileSync(WARROOM_PIN_PATH, 'utf-8'));
        const valid = getValidPinAgents();
        const agent = (raw && typeof raw.agent === 'string' && valid.has(raw.agent)) ? raw.agent : null;
        const mode = (raw && typeof raw.mode === 'string' && VALID_PIN_MODES.has(raw.mode)) ? raw.mode : 'direct';
        return { agent, mode };
      }
    } catch { /* fall through to defaults */ }
    return { agent: null, mode: 'direct' };
  }

  app.get('/api/warroom/pin', (c) => {
    const { agent, mode } = readPinState();
    return c.json({ ok: true, agent, mode });
  });

  // Kill the warroom Python subprocess so main's respawn logic in
  // src/index.ts brings up a fresh one with whatever config files
  // (voices.json, pin file, etc.) we just wrote. Runs in the background
  // so the HTTP response doesn't block on the respawn.
  async function killWarroomAsync(reason: string): Promise<number[]> {
    try {
      const pids = await findProcessesByPattern('warroom/server.py');
      for (const pid of pids) killProcess(pid);
      if (pids.length > 0) {
        logger.info({ pids, reason }, 'Killed warroom subprocess for respawn');
      }
      return pids;
    } catch (err) {
      logger.warn({ err, reason }, 'killWarroomAsync failed');
      return [];
    }
  }

  app.post('/api/warroom/pin', async (c) => {
    let body: { agent?: string; mode?: string; restart?: boolean } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    // Pin can update agent, mode, or both. Missing fields preserve
    // the current pin file value. An empty body is a noop but still
    // respawns so the caller can force a reload.
    const current = readPinState();
    const nextAgent = body.agent !== undefined ? body.agent : (current.agent ?? 'main');
    const nextMode = body.mode !== undefined ? body.mode : current.mode;

    if (!getValidPinAgents().has(nextAgent)) {
      return c.json({ ok: false, error: 'invalid agent; must be one of main, research, comms, content, ops' }, 400);
    }
    if (!VALID_PIN_MODES.has(nextMode)) {
      return c.json({ ok: false, error: 'invalid mode; must be one of direct, auto' }, 400);
    }

    try {
      fs.mkdirSync(WARROOM_TMP_DIR, { recursive: true });
      fs.writeFileSync(
        WARROOM_PIN_PATH,
        JSON.stringify({ agent: nextAgent, mode: nextMode, pinnedAt: Date.now() }),
        'utf-8',
      );
      // Only respawn the server if the caller says a meeting is active.
      // When no meeting is active, the server picks up the new pin on
      // the next Start Meeting click (the health probe triggers it).
      const needsRestart = body.restart !== false;
      if (needsRestart) {
        killWarroomAsync(`pin changed to agent=${nextAgent} mode=${nextMode}`);
      }
      return c.json({ ok: true, agent: nextAgent, mode: nextMode, respawning: needsRestart });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  app.post('/api/warroom/unpin', async (c) => {
    try {
      if (fs.existsSync(WARROOM_PIN_PATH)) fs.unlinkSync(WARROOM_PIN_PATH);
      killWarroomAsync('unpin');
      return c.json({ ok: true, agent: null, mode: 'direct', respawning: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Text War Room
  //
  // Every route validates meetingId format before touching channels or
  // the DB, so a malformed id can't grow an unbounded channel map.
  // Dedup on clientMsgId happens inside handleTextTurn so retries from
  // a flaky network don't double-process.
  // ──────────────────────────────────────────────────────────────────

  // Recent text meetings, newest first. Used by the picker to surface
  // prior conversations so users can revisit them. Transcripts persist in
  // SQLite (warroom_transcript), so opening an ended meeting re-renders
  // the full conversation in read-only mode (composer disabled).
  app.get('/api/warroom/text/list', (c) => {
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10) || 20));
    // Optional chat-scope: if the picker passes its current chatId, return
    // only meetings for that chat. Picker without chatId (admin/debug or
    // legacy clients) sees everything.
    const chatIdRaw = c.req.query('chatId');
    const chatId = chatIdRaw !== undefined ? chatIdRaw : undefined;
    return c.json({ ok: true, meetings: getTextMeetings(limit, chatId) });
  });

  app.post('/api/warroom/text/new', async (c) => {
    let body: { chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const chatId = (body.chatId || '').trim();
    const id = `wr_${Math.floor(Date.now() / 1000).toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    createTextMeeting(id, chatId);
    // Prime the channel so the SSE emit for meeting_state has a target.
    getChannel(id);
    // Force-end any prior open text meetings IN THE SAME CHAT so a refresh
    // / new visit starts clean WITHOUT clobbering meetings from other
    // chats sharing the box. Fire-and-forget — DB update is synchronous,
    // only the SSE-emit + cancel-turns wait is async, and the response
    // shouldn't block on those.
    const stale = getOpenTextMeetingIds(id, chatId);
    if (stale.length > 0) {
      logger.info({ closing: stale, newMeetingId: id, chatId }, 'auto-ending stale text meetings on /new');
      for (const sid of stale) {
        void endTextMeeting(sid).catch((err) => {
          logger.warn({
            err: err instanceof Error ? err.message : err,
            staleMeetingId: sid,
          }, 'auto-end of stale meeting failed (non-fatal)');
        });
      }
    }
    return c.json({ ok: true, meetingId: id, autoEnded: stale });
  });

  // Pre-warm the selected provider path so the first user turn feels snappy.
  // The client calls this on page load in parallel with the intro animation.
  // Idempotent + fast: if warmup already ran, returns immediately.
  app.post('/api/warroom/text/warmup', async (c) => {
    if (isWarmupDone()) return c.json({ ok: true, already: true });
    // Don't await — the client doesn't need the result, it just wants
    // the server to have started. The promise resolves in the background.
    void warmupMeeting();
    return c.json({ ok: true, started: true });
  });

  app.get('/api/warroom/text/history', (c) => {
    const meetingId = (c.req.query('meetingId') || '').trim();
    const reqChatId = (c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const limit = Math.max(1, Math.min(500, parseInt(c.req.query('limit') || '200', 10) || 200));
    const beforeTsRaw = c.req.query('beforeTs');
    const beforeIdRaw = c.req.query('beforeId');
    const beforeTs = beforeTsRaw ? parseInt(beforeTsRaw, 10) : undefined;
    const beforeId = beforeIdRaw ? parseInt(beforeIdRaw, 10) : undefined;
    // Capture latestSeq BEFORE the transcript query. If a new row is
    // persisted + emits between these two reads, the transcript query
    // sees the row, and the client connects SSE from a seq that still
    // covers the emit — seenSeqs dedup takes care of duplicates.
    // Reverse order (seq-first, then rows) avoids the opposite race where
    // a row emits after the transcript read but before the seq read,
    // causing the client to advance past a row it never received.
    const latestSeq = getChannel(meetingId).latestSeq();
    const rows = getWarRoomTranscript(meetingId, { limit, beforeTs, beforeId }).reverse();
    return c.json({
      ok: true,
      meetingId,
      transcript: rows,
      pinnedAgent: meeting.pinned_agent,
      meetingStartedAt: meeting.started_at,
      endedAt: meeting.ended_at,
      agents: getRoster(),
      latestSeq,
    });
  });

  app.get('/api/warroom/text/stream', (c) => {
    const meetingId = (c.req.query('meetingId') || '').trim();
    const reqChatId = (c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    // Clients that reconnect to an already-ended meeting still get a
    // stream — we emit a meeting_ended event immediately then close. This
    // lets the UI show the ended state instead of silently hanging.
    const sinceSeq = Math.max(0, parseInt(c.req.query('sinceSeq') || '0', 10) || 0);

    return streamSSE(c, async (stream) => {
      const channel = getChannel(meetingId);

      // 1. Send meeting_state snapshot with the current roster + pin so
      //    the client can render without waiting for the next real event.
      const stateEvent = {
        type: 'meeting_state' as const,
        meetingId,
        pinnedAgent: meeting.pinned_agent,
        agents: getRoster(),
        isFresh: meeting.ended_at === null && meeting.entry_count === 0,
      };
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ seq: 0, event: stateEvent }),
      });

      // If the meeting already ended when the client connects, tell them
      // immediately so they can render the ended state instead of hanging.
      if (meeting.ended_at !== null) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({ seq: 0, event: { type: 'meeting_ended', meetingId, at: meeting.ended_at } }),
        });
        return;
      }

      // 2. Subscribe FIRST so events emitted concurrently with the replay
      //    drain aren't lost in the gap between since() and subscribe().
      //    Writes are serialized through a tiny async queue so rapid
      //    chunks can't reorder (EventEmitter.emit doesn't await our
      //    async handler otherwise).
      const seenSeqs = new Set<number>();
      let writeChain: Promise<void> = Promise.resolve();
      const writeOrdered = (seq: number, event: unknown) => {
        if (seenSeqs.has(seq)) return;
        seenSeqs.add(seq);
        writeChain = writeChain.then(async () => {
          try {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({ seq, event }),
            });
          } catch { /* client disconnected */ }
        });
      };

      const unsub = channel.subscribe((entry) => {
        writeOrdered(entry.seq, entry.event);
      });

      // 3. Detect replay gaps. If the client's sinceSeq is older than the
      //    oldest event we still have in the ring buffer, the replay
      //    would silently drop everything between (sinceSeq, oldestSeq).
      //    Tell the client so it can hard-reload the transcript via
      //    /history instead of rendering an inconsistent stream.
      const oldest = channel.oldestSeq();
      const latest = channel.latestSeq();
      if (sinceSeq > 0 && oldest > 0 && sinceSeq < oldest - 1) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({
            seq: 0,
            event: { type: 'replay_gap', sinceSeq, oldestSeq: oldest, latestSeq: latest },
          }),
        });
      }

      // 4. Drain the replay window AFTER subscribing. The seenSeqs dedup
      //    set guarantees we never duplicate an event that the live
      //    subscription also caught.
      const missed = channel.since(sinceSeq);
      for (const entry of missed) {
        writeOrdered(entry.seq, entry.event);
      }

      const ping = setInterval(async () => {
        try { await stream.writeSSE({ event: 'ping', data: '' }); }
        catch { clearInterval(ping); }
      }, 30_000);

      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // expected: client disconnected
      } finally {
        clearInterval(ping);
        unsub();
      }
    });
  });

  // Shared guard: 404 on unknown, 410 on ended. Returns the meeting row if OK.
  function requireOpenMeeting(meetingId: string) {
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return { error: 'meeting_not_found' as const, status: 404 as const };
    if (meeting.ended_at !== null) return { error: 'meeting_ended' as const, status: 410 as const };
    return { meeting };
  }

  // Strict chat-id guard. Every text-war-room endpoint validates that
  // the request's chatId matches the meeting's chat_id. Without this,
  // a stale or copied meetingId from chat A used in a session running
  // as chat B would happily proceed and leak across chat scopes.
  // Legacy meetings (chat_id === '') accept any chatId so existing
  // pre-migration meetings stay openable; new meetings always have a
  // populated chat_id.
  function requireChatMatches(
    meeting: { chat_id: string },
    requestChatId: string,
  ): { ok: true } | { ok: false; error: string; status: 403 } {
    if (meeting.chat_id === '') return { ok: true };
    if (meeting.chat_id === requestChatId) return { ok: true };
    return { ok: false, error: 'chat_mismatch', status: 403 };
  }

  app.post('/api/warroom/text/send', async (c) => {
    let body: { meetingId?: string; text?: string; clientMsgId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const text = (body.text || '').trim();
    const clientMsgId = (body.clientMsgId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    // DASHBOARD_MUTATIONS_ENABLED + LLM_SPAWN_ENABLED are enforced by
    // global middlewares (mutation middleware above; LLM-spawn refusal
    // happens inside runAgentTurn). Only WARROOM_TEXT_ENABLED is
    // feature-specific and remains here.
    if (!killSwitches.isEnabled('WARROOM_TEXT_ENABLED')) {
      return c.json({ error: 'text war room disabled' }, 503);
    }
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    if (!text) return c.json({ error: 'empty text' }, 400);
    if (text.length > 8000) return c.json({ error: 'text too long (max 8000 chars)' }, 400);
    if (!CLIENT_MSG_ID_RE.test(clientMsgId)) return c.json({ error: 'invalid clientMsgId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);

    // Fire-and-forget through the per-meeting queue. The client learns
    // about progress via SSE. The handleTextTurn call is wrapped in a
    // hard watchdog: if the whole turn takes longer than TURN_BUDGET_MS,
    // we force the queue to unblock so subsequent sends aren't held
    // hostage by a single hung SDK subprocess. The watchdog fires at
    // the queue level (not inside the orchestrator) so even if the
    // orchestrator never returns, the FIFO drains.
    //
    // Budget derivation:
    //   router (20s) + primary (75s)
    //   + 2 × ( intervention gate (25s) + intervener (45s) )
    //   = 235s of agent work,
    //   + ~30s for SDK cold-start + transcript I/O + queue overhead
    //   = ~265s realistic worst case for a healthy long turn.
    // Set TURN_BUDGET_MS to 300_000 so the budget actually clears the
    // worst case by a comfortable margin. The previous 240s was 5s over
    // the bare math, which meant healthy long turns were getting cut
    // off as "took too long".
    const TURN_BUDGET_MS = 300_000;
    messageQueue.enqueue(`warroom-text:${meetingId}`, async () => {
      let finished = false;
      const turnPromise = handleTextTurn(meetingId, text, clientMsgId).finally(() => { finished = true; });
      await Promise.race([
        turnPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (finished) return;
            // Timed out. Emit a user-visible error via the channel so the
            // UI unfreezes. Use turn_aborted scoped to the actual active
            // turnId(s) — turn_complete with a synthetic 'watchdog' id
            // can't drive turnId-scoped UI cleanup correctly.
            const ch = getChannel(meetingId);
            ch.emit({
              type: 'system_note',
              text: 'That turn took too long to complete and was interrupted. Send again, or end and restart the meeting if this keeps happening.',
              tone: 'warn',
              dismissable: true,
            });
            const activeTurns = getActiveTurnIds(meetingId);
            for (const tid of activeTurns) {
              ch.emit({ type: 'turn_aborted', turnId: tid, clearedAgents: [] });
              // Mark finalized AFTER emitting turn_aborted so the abort
              // event itself reaches the client. From here on, late SDK
              // chunks/agent_done/transcript writes for this turnId are
              // dropped by the channel — they can't leak into the next
              // queued turn's bubbles.
              ch.markTurnFinalized(tid);
            }
            cancelMeetingTurns(meetingId);
            resolve();
          }, TURN_BUDGET_MS);
        }),
      ]);
      // After the race settles (whether the turn finished cleanly or the
      // watchdog fired), give the orchestrator a brief grace window to
      // finish its async cleanup before we let the next queued turn run.
      // This prevents a half-aborted turn's late agent_done from racing
      // with a freshly-started turn's bubbles.
      if (!finished) {
        await Promise.race([
          turnPromise,
          new Promise<void>((r) => setTimeout(r, 2000)),
        ]);
      }
    });
    return c.json({ ok: true, queued: true });
  });

  app.post('/api/warroom/text/abort', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const count = cancelMeetingTurns(meetingId);
    return c.json({ ok: true, cancelled: count });
  });

  app.post('/api/warroom/text/pin', async (c) => {
    let body: { meetingId?: string; agentId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const agentId = (body.agentId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const rosterIds = new Set(getRoster().map((a) => a.id));
    if (!rosterIds.has(agentId)) return c.json({ error: 'unknown agent' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    setMeetingPin(meetingId, agentId);
    // Tell every connected tab so the pin indicator stays in sync
    // without a reload. Without this, tabs that didn't initiate the
    // pin click rendered the wrong roster state until they reconnected.
    getChannel(meetingId).emit({ type: 'meeting_state_update', pinnedAgent: agentId });
    return c.json({ ok: true, meetingId, pinnedAgent: agentId });
  });

  app.post('/api/warroom/text/unpin', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    setMeetingPin(meetingId, null);
    getChannel(meetingId).emit({ type: 'meeting_state_update', pinnedAgent: null });
    return c.json({ ok: true, meetingId, pinnedAgent: null });
  });

  app.post('/api/warroom/text/clear', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    // Cancel any in-flight turn FIRST and wait for it to exit before we
    // wipe sessions. Otherwise runAgentTurn's setSession() can land after
    // clearMeetingSessions() and resurrect the cleared session id, leaving
    // the user with "memory cleared" UX but the agent still resuming the
    // prior thread.
    if (getActiveTurnIds(meetingId).length > 0) {
      cancelMeetingTurns(meetingId);
      await waitForMeetingTurnsIdle(meetingId, 5000);
    }
    const agents = getRoster().map((a) => a.id);
    const cleared = clearMeetingSessions(meetingId, agents);
    // Persist the divider so reload still shows the marker. Speaker
    // __divider__ is handled client-side to render as a dashed divider.
    addWarRoomTranscript(meetingId, '__divider__', 'Memory cleared — agents start fresh from here');
    const channel = getChannel(meetingId);
    channel.emit({
      type: 'divider',
      kind: 'memory_cleared',
      text: 'Memory cleared — agents start fresh from here',
    });
    channel.emit({
      type: 'system_note',
      text: 'Sessions cleared. Next message starts fresh.',
      tone: 'info',
      dismissable: true,
    });
    return c.json({ ok: true, cleared });
  });

  // Internal helper: terminate a single text meeting (DB + SSE + channel
  // teardown). Used both by the /end endpoint and by /new when force-
  // ending stale meetings so a refresh becomes a clean slate.
  async function endTextMeeting(meetingId: string): Promise<{ alreadyEnded: boolean; entryCount: number }> {
    const meeting = getTextMeeting(meetingId);
    if (!meeting || meeting.ended_at !== null) {
      const rows = meeting ? getWarRoomTranscript(meetingId) : [];
      return { alreadyEnded: true, entryCount: rows.length };
    }
    const rows = getWarRoomTranscript(meetingId);
    endWarRoomMeeting(meetingId, rows.length);
    if (getActiveTurnIds(meetingId).length > 0) {
      cancelMeetingTurns(meetingId);
      await waitForMeetingTurnsIdle(meetingId, 3000);
    }
    // Clear the SDK sessions tied to this meeting. Without this, every
    // meeting leaves orphan rows in the `sessions` table keyed on
    // warroom-text:<meetingId>:<agentId>; the rows can't be looked up
    // again (UUID-fresh meetingIds) but they accumulate forever. Mirror
    // the /clear endpoint's behavior so /end is a true cleanup.
    try {
      const agents = getRoster().map((a) => a.id);
      clearMeetingSessions(meetingId, agents);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, meetingId },
        'clearMeetingSessions failed during endTextMeeting (non-fatal)',
      );
    }
    // Notify every connected tab BEFORE we close the channel so they can
    // disable their composers and show the "meeting ended" state.
    const channel = getChannel(meetingId);
    channel.emit({
      type: 'meeting_ended',
      meetingId,
      at: Math.floor(Date.now() / 1000),
    });
    // Close the channel after a short grace period so in-flight SSE
    // writes finish draining to clients.
    setTimeout(() => closeChannel(meetingId), 1500);
    return { alreadyEnded: false, entryCount: rows.length };
  }

  app.post('/api/warroom/text/end', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const result = await endTextMeeting(meetingId);
    if (result.alreadyEnded) {
      return c.json({ ok: true, meetingId, alreadyEnded: true });
    }
    return c.json({ ok: true, meetingId, entryCount: result.entryCount });
  });

  // ── War Room voice configuration ──
  // warroom/voices.json carries two voice identifiers per agent:
  //   - gemini_voice:     Gemini Live's built-in voice name (used in live mode)
  //   - voice_id:         Cartesia voice id (used in legacy stitched mode)
  // The Python server reads this file on startup. After editing via the
  // dashboard, POST /api/warroom/voices/apply kickstarts the main agent so
  // its child warroom process respawns with the new config.
  const WARROOM_VOICES_PATH = path.join(PROJECT_ROOT, 'warroom', 'voices.json');

  // Full Gemini Live voice catalog with one-word style descriptors. Matches
  // the 30 voices supported by the gemini-2.5-flash-native-audio-preview model
  // (and other Gemini TTS-capable models). Sourced from Google's docs.
  const GEMINI_VOICE_CATALOG: Array<{ name: string; style: string }> = [
    { name: 'Zephyr', style: 'Bright' },
    { name: 'Puck', style: 'Upbeat' },
    { name: 'Charon', style: 'Informative' },
    { name: 'Kore', style: 'Firm' },
    { name: 'Fenrir', style: 'Excitable' },
    { name: 'Leda', style: 'Youthful' },
    { name: 'Orus', style: 'Firm' },
    { name: 'Aoede', style: 'Breezy' },
    { name: 'Callirrhoe', style: 'Easy-going' },
    { name: 'Autonoe', style: 'Bright' },
    { name: 'Enceladus', style: 'Breathy' },
    { name: 'Iapetus', style: 'Clear' },
    { name: 'Umbriel', style: 'Easy-going' },
    { name: 'Algieba', style: 'Smooth' },
    { name: 'Despina', style: 'Smooth' },
    { name: 'Erinome', style: 'Clear' },
    { name: 'Algenib', style: 'Gravelly' },
    { name: 'Rasalgethi', style: 'Informative' },
    { name: 'Laomedeia', style: 'Upbeat' },
    { name: 'Achernar', style: 'Soft' },
    { name: 'Alnilam', style: 'Firm' },
    { name: 'Schedar', style: 'Even' },
    { name: 'Gacrux', style: 'Mature' },
    { name: 'Pulcherrima', style: 'Forward' },
    { name: 'Achird', style: 'Friendly' },
    { name: 'Zubenelgenubi', style: 'Casual' },
    { name: 'Vindemiatrix', style: 'Gentle' },
    { name: 'Sadachbia', style: 'Lively' },
    { name: 'Sadaltager', style: 'Knowledgeable' },
    { name: 'Sulafat', style: 'Warm' },
  ];
  const GEMINI_VOICE_NAMES = new Set(GEMINI_VOICE_CATALOG.map((v) => v.name));

  // Default voice assignments for agents that don't have an entry yet.
  // This is how a newly-spawned sub-agent gets a voice without any extra
  // setup. We skip Charon (reserved for main) so new agents always sound
  // distinct from the main voice.
  const NEW_AGENT_VOICE_POOL = [
    'Kore', 'Aoede', 'Leda', 'Alnilam', 'Puck',
    'Fenrir', 'Laomedeia', 'Achird', 'Sulafat', 'Vindemiatrix',
  ];

  function readVoicesFile(): Record<string, { voice_id?: string; gemini_voice?: string; name?: string }> {
    try {
      return JSON.parse(fs.readFileSync(WARROOM_VOICES_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  function writeVoicesFile(obj: Record<string, unknown>) {
    fs.writeFileSync(WARROOM_VOICES_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  }

  function pickDefaultGeminiVoice(used: Set<string>): string {
    for (const v of NEW_AGENT_VOICE_POOL) {
      if (!used.has(v)) return v;
    }
    return NEW_AGENT_VOICE_POOL[0];
  }

  app.get('/api/warroom/voices', (c) => {
    const configured = readVoicesFile();
    // Return one row per known agent. Agents missing from voices.json get
    // a default Gemini voice suggestion from the pool so the UI can show
    // something reasonable without requiring the user to save first.
    const knownAgents = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const usedGeminiVoices = new Set(
      Object.values(configured)
        .map((v) => v && typeof v === 'object' ? (v as { gemini_voice?: string }).gemini_voice : undefined)
        .filter((v): v is string => typeof v === 'string'),
    );
    const rows = knownAgents.map((agent) => {
      const entry = configured[agent] || {};
      let geminiVoice = entry.gemini_voice;
      let isDefault = false;
      if (!geminiVoice) {
        geminiVoice = agent === 'main' ? 'Charon' : pickDefaultGeminiVoice(usedGeminiVoices);
        usedGeminiVoices.add(geminiVoice);
        isDefault = true;
      }
      return {
        agent,
        display_name: resolveAgentDisplayName(agent),
        gemini_voice: geminiVoice,
        voice_id: entry.voice_id || '',
        name: entry.name || '',
        is_default: isDefault,
      };
    });
    return c.json({
      ok: true,
      voices: rows,
      gemini_catalog: GEMINI_VOICE_CATALOG,
    });
  });

  app.post('/api/warroom/voices', async (c) => {
    let body: { updates?: Array<{ agent: string; gemini_voice?: string; voice_id?: string; name?: string }> } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const updates = body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return c.json({ ok: false, error: 'updates must be a non-empty array of {agent, gemini_voice?, voice_id?, name?}' }, 400);
    }

    const configured = readVoicesFile();
    const errors: string[] = [];
    for (const u of updates) {
      if (!u.agent || typeof u.agent !== 'string') {
        errors.push('each update must have an agent id');
        continue;
      }
      const entry = configured[u.agent] || {};
      if (u.gemini_voice !== undefined) {
        if (typeof u.gemini_voice !== 'string' || !GEMINI_VOICE_NAMES.has(u.gemini_voice)) {
          errors.push(`${u.agent}: invalid gemini_voice '${u.gemini_voice}' (must be one of the 30 Gemini voices)`);
          continue;
        }
        entry.gemini_voice = u.gemini_voice;
      }
      if (u.voice_id !== undefined) {
        if (typeof u.voice_id !== 'string') {
          errors.push(`${u.agent}: voice_id must be a string`);
          continue;
        }
        entry.voice_id = u.voice_id;
      }
      if (u.name !== undefined) {
        if (typeof u.name !== 'string') {
          errors.push(`${u.agent}: name must be a string`);
          continue;
        }
        entry.name = u.name;
      }
      configured[u.agent] = entry;
    }
    if (errors.length > 0) {
      return c.json({ ok: false, error: errors.join('; ') }, 400);
    }
    try {
      writeVoicesFile(configured);
      return c.json({ ok: true, voices: configured, applied: false });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // Cooldown guard so rapid /apply hits can't pile up respawns. Each
  // apply kills the Python subprocess; main's respawner kicks in within
  // 300ms. Without a cooldown, three clicks in 400ms queue three
  // sequential SIGTERMs and reset the crash counter spuriously.
  let _lastVoicesApplyMs = 0;
  app.post('/api/warroom/voices/apply', async (c) => {
    const now = Date.now();
    if (now - _lastVoicesApplyMs < 3000) {
      return c.json({
        ok: false,
        error: 'voice config apply cooldown — wait 3s between reloads',
      }, 429);
    }
    _lastVoicesApplyMs = now;
    // Kill the warroom Python subprocess so main's respawn logic in
    // src/index.ts picks up a fresh one that re-reads voices.json.
    // IMPORTANT: we do NOT kickstart the main launchd service here,
    // because that would kill the dashboard process we're currently
    // running inside — the HTTP response would never be delivered.
    try {
      const pids = await findProcessesByPattern('warroom/server.py');
      if (pids.length === 0) {
        return c.json({ ok: false, error: 'no warroom server process found' }, 500);
      }
      for (const pid of pids) killProcess(pid);
      logger.info({ pids }, 'Killed warroom subprocess for voice config reload');
      return c.json({
        ok: true,
        applied: true,
        killed_pids: pids,
        note: 'warroom server will be respawned by the main agent in ~0.5s with fresh voices.json',
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // ── peon-ping sound pack switcher ────────────────────────────────
  const PEON_BIN = path.join(os.homedir(), '.local', 'bin', 'peon');

  function runPeon(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      import('child_process').then(({ execFile }) => {
        execFile(PEON_BIN, args, { timeout: 8000, env: process.env }, (err, stdout, stderr) => {
          resolve({ stdout: stdout || '', stderr: stderr || '', code: (err as any)?.code ?? 0 });
        });
      });
    });
  }

  function parsePeonPackList(raw: string): { name: string; label: string; active: boolean }[] {
    // Strip ANSI escape codes then parse "  name   N sounds   Display Name  [<-- active]"
    const stripped = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const packs: { name: string; label: string; active: boolean }[] = [];
    for (const line of stripped.split('\n')) {
      const m = line.match(/^\s{2}(\S+)\s+\d+ sounds\s{3}(.+?)(?:\s+<-- active)?\s*$/);
      if (!m) continue;
      packs.push({ name: m[1], label: m[2].trim(), active: line.includes('<-- active') });
    }
    return packs;
  }

  app.get('/api/peon/packs', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    const { stdout } = await runPeon(['packs', 'list']);
    const packs = parsePeonPackList(stdout);
    const active = packs.find((p) => p.active)?.name ?? null;
    return c.json({ ok: true, packs, active });
  });

  app.post('/api/peon/packs/use', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    let body: { name?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const name = (body.name || '').trim();
    if (!name || !/^[a-z0-9_-]+$/.test(name)) {
      return c.json({ ok: false, error: 'invalid pack name' }, 400);
    }
    const { stdout, code } = await runPeon(['packs', 'use', name]);
    if (code !== 0) return c.json({ ok: false, error: stdout.trim() || 'peon error' }, 500);
    return c.json({ ok: true, active: name });
  });

  app.get('/api/peon/status', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    const [statusRes, mobileRes, volRes] = await Promise.all([
      runPeon(['status']),
      runPeon(['mobile', 'status']),
      runPeon(['volume']),
    ]);
    const stripped = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const statusLine = stripped(statusRes.stdout);
    const mobileLine = stripped(mobileRes.stdout);
    const volLine = stripped(volRes.stdout);
    const paused = /paused/i.test(statusLine);
    const volMatch = volLine.match(/[\d.]+/);
    const volume = volMatch ? parseFloat(volMatch[0]) : null;

    // Parse mobile channels: look for "ntfy" and "telegram" lines
    const mobileLines = mobileLine.split('\n').map((l) => stripped(l));
    const ntfyLine = mobileLines.find((l) => /ntfy/i.test(l)) ?? null;
    const telegramLine = mobileLines.find((l) => /telegram/i.test(l)) ?? null;
    const mobileEnabled = !/disabled|off/i.test(mobileLine) && (ntfyLine !== null || telegramLine !== null);

    const ntfyTopic = ntfyLine ? (ntfyLine.match(/Topic:\s*(\S+)/i)?.[1] ?? ntfyLine) : null;
    const telegramConfigured = telegramLine !== null && !/not configured/i.test(telegramLine);

    return c.json({
      ok: true,
      paused,
      volume,
      mobileEnabled,
      ntfyTopic,
      telegramConfigured,
      raw: { status: statusLine, mobile: mobileLine, volume: volLine },
    });
  });

  app.post('/api/peon/pause', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    await runPeon(['pause']);
    return c.json({ ok: true, paused: true });
  });

  app.post('/api/peon/resume', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    await runPeon(['resume']);
    return c.json({ ok: true, paused: false });
  });

  app.post('/api/peon/volume', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    let body: { volume?: number } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const vol = body.volume;
    if (vol === undefined || vol < 0 || vol > 1) return c.json({ ok: false, error: 'volume must be 0.0–1.0' }, 400);
    await runPeon(['volume', String(vol)]);
    return c.json({ ok: true, volume: vol });
  });

  app.post('/api/peon/mobile/test', async (c) => {
    // peon mobile is off; relay script owns phone channels — call it directly
    const relayScript = path.join(os.homedir(), '.claude', 'hooks', 'mobile-relay.sh');
    const testPayload = JSON.stringify({ session_id: 'dashboard-test', message: 'Test from Mission Control — ntfy + Telegram relay live' });
    const { execFile } = await import('child_process');
    const err = await new Promise<Error | null>((resolve) => {
      const proc = execFile(relayScript, [], { timeout: 12000, env: process.env }, (e) => resolve(e));
      proc.stdin?.write(testPayload);
      proc.stdin?.end();
    });
    if (err && (err as any).code !== 0) return c.json({ ok: false, error: String(err.message) }, 500);
    return c.json({ ok: true });
  });

  app.post('/api/peon/mobile/toggle', async (c) => {
    if (!fs.existsSync(PEON_BIN)) return c.json({ ok: false, error: 'peon not installed' }, 404);
    let body: { enable?: boolean } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const cmd = body.enable ? 'on' : 'off';
    await runPeon(['mobile', cmd]);
    return c.json({ ok: true, mobileEnabled: body.enable });
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Delete a scheduled task
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Edit a scheduled task: prompt, schedule (cron), and/or agent_id.
  // Returns the updated next_run so the UI can reflect the new firing time
  // without waiting for the 30s poll.
  app.patch('/api/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as {
      prompt?: string;
      schedule?: string;
      agent_id?: string;
    };
    const all = getAllScheduledTasks();
    const existing = all.find((t) => t.id === id);
    if (!existing) return c.json({ ok: false, error: 'task not found' }, 404);

    const patch: { prompt?: string; schedule?: string; nextRun?: number; agentId?: string } = {};
    if (typeof body.prompt === 'string') {
      const trimmed = body.prompt.trim();
      if (!trimmed) return c.json({ ok: false, error: 'prompt cannot be empty' }, 400);
      patch.prompt = trimmed;
    }
    if (typeof body.schedule === 'string' && body.schedule.trim() !== existing.schedule) {
      const cron = body.schedule.trim();
      try {
        patch.nextRun = computeNextRun(cron);
        patch.schedule = cron;
      } catch (err: any) {
        return c.json({ ok: false, error: 'invalid cron: ' + (err?.message || String(err)) }, 400);
      }
    }
    if (typeof body.agent_id === 'string') {
      const agentId = body.agent_id.trim();
      if (!agentId) return c.json({ ok: false, error: 'agent_id cannot be empty' }, 400);
      patch.agentId = agentId;
    }

    updateScheduledTask(id, patch);
    const updated = getAllScheduledTasks().find((t) => t.id === id);
    return c.json({ ok: true, task: updated });
  });

  // Pause a scheduled task
  app.post('/api/tasks/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });

  // Resume a scheduled task
  app.post('/api/tasks/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
  });

  // ── Mission Control endpoints ────────────────────────────────────────

  app.get('/api/mission/tasks', (c) => {
    const agentId = c.req.query('agent') || undefined;
    const status = c.req.query('status') || undefined;
    const tasks = getMissionTasks(agentId, status);
    return c.json({ tasks });
  });

  app.get('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    return c.json({ task });
  });

  app.post('/api/mission/tasks', async (c) => {
    const body = await c.req.json<{
      title?: string;
      prompt?: string;
      assigned_agent?: string;
      priority?: number;
    }>();

    const title = body?.title?.trim();
    const prompt = body?.prompt?.trim();
    const assignedAgent = body?.assigned_agent?.trim() || null;
    const priority = Math.max(0, Math.min(10, body?.priority ?? 0));

    if (!title || title.length > 200) return c.json({ error: 'title required (max 200 chars)' }, 400);
    if (!prompt || prompt.length > 10000) return c.json({ error: 'prompt required (max 10000 chars)' }, 400);

    // Validate agent if provided
    if (assignedAgent) {
      const validAgents = ['main', ...listAgentIds()];
      if (!validAgents.includes(assignedAgent)) {
        return c.json({ error: `Unknown agent: ${assignedAgent}. Valid: ${validAgents.join(', ')}` }, 400);
      }
    }

    const id = crypto.randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, assignedAgent, 'dashboard', priority);

    const task = getMissionTask(id);
    return c.json({ task }, 201);
  });

  app.post('/api/mission/tasks/:id/cancel', (c) => {
    const id = c.req.param('id');
    const ok = cancelMissionTask(id);
    return c.json({ ok });
  });

  // Auto-assign all unassigned tasks. MUST register before /:id/auto-assign
  // so the static path is not captured by the parameterized route.
  app.post('/api/mission/tasks/auto-assign-all', async (c) => {
    const tasks = getUnassignedMissionTasks();
    if (tasks.length === 0) return c.json({ assigned: 0, results: [] });

    const CONCURRENCY = 5;
    const results: Array<{ id: string; agent: string }> = [];
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(batch.map(async (task) => {
        const agent = await classifyTaskAgent(task.prompt);
        if (agent && assignMissionTask(task.id, agent)) {
          return { id: task.id, agent };
        }
        return null;
      }));
      for (const r of settled) if (r) results.push(r);
    }
    return c.json({ assigned: results.length, results });
  });

  // Auto-assign a single task via Gemini classification
  app.post('/api/mission/tasks/:id/auto-assign', async (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    if (task.assigned_agent) return c.json({ error: 'Already assigned' }, 400);

    const agent = await classifyTaskAgent(task.prompt);
    if (!agent) return c.json({ error: 'Classification failed' }, 500);

    assignMissionTask(id, agent);
    return c.json({ ok: true, assigned_agent: agent });
  });

  app.patch('/api/mission/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ assigned_agent?: string }>();
    const newAgent = body?.assigned_agent?.trim();
    if (!newAgent) return c.json({ error: 'assigned_agent required' }, 400);
    const validAgents = ['main', ...listAgentIds()];
    if (!validAgents.includes(newAgent)) return c.json({ error: 'Unknown agent' }, 400);
    const ok = reassignMissionTask(id, newAgent);
    return c.json({ ok });
  });

  app.delete('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteMissionTask(id);
    return c.json({ ok });
  });

  app.get('/api/mission/history', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    return c.json(getMissionTaskHistory(limit, offset));
  });

  // ── Live Meetings (Pika meet-cli wrapper) ──────────────────────────
  // Three endpoints that shell out to dist/meet-cli.js. Actual join/leave
  // logic lives there so Telegram triggers and the dashboard go through
  // the same code path.

  const MEET_CLI = path.join(PROJECT_ROOT, 'dist', 'meet-cli.js');
  const MEET_URL_RE = /^https:\/\/meet\.google\.com\/[a-z0-9-]+/i;

  // Run meet-cli as a subprocess and parse its final JSON line from stdout.
  async function runMeetCli(args: string[], timeoutMs: number): Promise<{
    ok: boolean;
    data: Record<string, unknown>;
    stderr: string;
    code: number;
  }> {
    if (!fs.existsSync(MEET_CLI)) {
      return { ok: false, data: { error: 'meet-cli not built; run npm run build' }, stderr: '', code: -1 };
    }
    const { spawn } = await import('child_process');
    const proc = spawn(process.execPath, [MEET_CLI, ...args], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    return await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch { /* ok */ }
      }, timeoutMs);

      proc.on('close', (code: number | null) => {
        clearTimeout(killTimer);
        // meet-cli emits one JSON object on its final stdout line
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
            resolve({ ok: parsed.ok === true, data: parsed, stderr, code: code ?? 1 });
            return;
          } catch { /* try earlier line */ }
        }
        resolve({ ok: false, data: { error: 'no parseable output from meet-cli', stderr: stderr.slice(-400) }, stderr, code: code ?? 1 });
      });
    });
  }

  app.get('/api/meet/sessions', (c) => {
    const active = listActiveMeetSessions();
    const recent = listRecentMeetSessions(15).filter(
      (s: MeetSession) => s.status !== 'joining' && s.status !== 'live',
    );
    return c.json({ ok: true, active, recent });
  });

  app.post('/api/meet/join', async (c) => {
    let body: { agent?: string; meet_url?: string; auto_brief?: boolean; context?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const meetUrl = body.meet_url?.trim();
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (!meetUrl || !MEET_URL_RE.test(meetUrl)) {
      return c.json({ ok: false, error: 'invalid meet_url (must match https://meet.google.com/...)' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join', '--agent', agent, '--meet-url', meetUrl];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);

    // Budget: auto-brief (up to 75s) + Pika join (up to 120s) + slack = 220s
    const result = await runMeetCli(args, 220_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/join-daily', async (c) => {
    let body: { agent?: string; mode?: string; auto_brief?: boolean; context?: string; ttl_sec?: number } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const mode = body.mode?.trim() || 'direct';
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();
    const ttlSec = body.ttl_sec;

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (mode !== 'direct' && mode !== 'auto') {
      return c.json({ ok: false, error: 'mode must be direct or auto' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join-daily', '--agent', agent, '--mode', mode];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);
    if (typeof ttlSec === 'number' && ttlSec > 0) args.push('--ttl-sec', String(ttlSec));

    // Budget: briefing (~75s) + room creation (~2s) + agent spawn (~3s) = ~90s
    const result = await runMeetCli(args, 120_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/leave', async (c) => {
    let body: { session_id?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }
    const sessionId = body.session_id?.trim();
    if (!sessionId) return c.json({ ok: false, error: 'session_id required' }, 400);
    if (!getMeetSession(sessionId)) {
      return c.json({ ok: false, error: 'session not found' }, 404);
    }
    const result = await runMeetCli(['leave', '--session-id', sessionId], 45_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  // Memory stats
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    const consolidations = getDashboardConsolidations(chatId, 5);
    return c.json({ stats, fading, topAccessed, timeline, consolidations });
  });

  // Memory list (for drill-down drawer)
  app.get('/api/memories/pinned', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const memories = getDashboardPinnedMemories(chatId);
    return c.json({ memories });
  });

  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const sortBy = (c.req.query('sort') || 'importance') as 'importance' | 'salience' | 'recent';
    const result = getDashboardMemoriesList(chatId, limit, offset, sortBy);
    return c.json(result);
  });

  // System health
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let contextUsedTokens = 0;
    let contextWindowTokens = CONTEXT_LIMIT;
    let contextLeftTokens = CONTEXT_LIMIT;
    let contextUpdatedAt: number | null = null;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        contextUsedTokens = Math.max(0, summary.lastContextTokens || summary.lastCacheRead || 0);
        // Size the gauge against the model's real window when the SDK reported
        // one (e.g. Opus 4.8 = 1M, Sonnet 4.6 = 200k); fall back to CONTEXT_LIMIT.
        contextWindowTokens = summary.lastContextWindow || CONTEXT_LIMIT;
        contextLeftTokens = Math.max(0, contextWindowTokens - contextUsedTokens);
        contextPct = contextUsedTokens > 0 ? Math.round((contextUsedTokens / contextWindowTokens) * 100) : 0;
        contextUpdatedAt = summary.lastContextUpdatedAt;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    // War-room visibility: surface counters an operator needs to spot a
    // degraded system without using the dashboard. Cheap reads only —
    // /api/health gets hit on a polling interval from the UI.
    let warroomTextOpenMeetings = 0;
    try {
      warroomTextOpenMeetings = getOpenTextMeetingIds(undefined, undefined).length;
    } catch { /* DB read failure is non-fatal for health */ }
    // Voice subprocess liveness — best-effort process check. Not exposed
    // as a primary health metric until the subprocess module exports a
    // proper accessor.

    return c.json({
      contextPct,
      contextUsedTokens,
      contextWindowTokens,
      contextLeftTokens,
      contextUpdatedAt,
      healthRefreshedAt: Math.floor(Date.now() / 1000),
      turns,
      compactions,
      sessionAge,
      ...getProviderStatus(),
      telegramConnected: getTelegramConnected(),
      waConnected: WHATSAPP_ENABLED,
      slackConnected: !!SLACK_USER_TOKEN,
      // Surface kill-switch state so an operator who just flipped a flag
      // in .env can verify from outside the process that it took effect.
      killSwitches: killSwitches.snapshot(),
      // Counter of refusals since boot. Bumps every time a switch
      // intercepted an LLM spawn or a mutation — visible proof the gates
      // are actually firing during an incident.
      killSwitchRefusals: killSwitches.refusalCounts(),
      // War-room counters for incident triage.
      warroom: {
        textOpenMeetings: warroomTextOpenMeetings,
      },
      // Memory ingestion can pause itself when Gemini returns 429. Without
      // this surfaced, ingestion is silently dead and conversations stop
      // generating long-term memories with no visible signal.
      memoryIngestion: getIngestionQuotaStatus(),
    });
  });

  app.get('/api/provider/status', (c) => {
    return c.json(getProviderStatus());
  });

  // Token / cost stats
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', (c) => {
    const chatId = c.req.query('chatId') || '';
    const info = getBotInfo();
    return c.json({
      botName: info.name || 'ClaudeClaw',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: chatId || null,
    });
  });

  // ── Agent endpoints ──────────────────────────────────────────────────

  // List all configured agents with status
  app.get('/api/agents', (c) => {
    const agentIds = listAgentIds();
    const hasMain = agentIds.includes('main');
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file.
        // Main agent uses 'claudeclaw.pid'; others use 'agent-<id>.pid'.
        const pidFile = path.join(STORE_DIR, id === 'main' ? 'claudeclaw.pid' : `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            running = isProcessAlive(pid);
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        const mainOverride = id === 'main' ? getMainModelOverride() : undefined;
        const provider = id === 'main' ? getSelectedProviderConfig() : config.provider;
        const model = provider.type === 'claude'
          ? (mainOverride ?? provider.model ?? config.model ?? DEFAULT_CLAUDE_MODEL)
          : provider.model;
        return {
          id,
          name: config.name || resolveAgentDisplayName(id),
          description: id === 'main' ? getMainDescription() : config.description,
          model,
          provider,
          running,
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
          // Cache-bust token for <img> URLs across all surfaces. Derived
          // from filesystem mtime+size of the resolved avatar — changes
          // the moment a user upload or Telegram fetch lands.
          avatar_etag: avatarEtagForId(id),
        };
      } catch {
        const fallbackName = resolveAgentDisplayName(id);
        return { id, name: fallbackName, description: '', model: 'unknown', provider: { type: 'opencode' }, running: false, todayTurns: 0, todayCost: 0, avatar_etag: avatarEtagForId(id) };
      }
    });

    // Ensure main is always first and never duplicated.
    let allAgents;
    if (hasMain) {
      // main exists in agentIds — move it to the front
      allAgents = [
        ...agents.filter((a) => a.id === 'main'),
        ...agents.filter((a) => a.id !== 'main'),
      ];
    } else {
      // No agents/main/agent.yaml — build a main entry from env/defaults
      const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
      let mainRunning = false;
      if (fs.existsSync(mainPidFile)) {
        try {
          const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
          mainRunning = isProcessAlive(pid);
        } catch { /* not running */ }
      }
      const mainStats = getAgentTokenStats('main');
      const mainProvider = getMainProviderConfig();
      allAgents = [
        {
          id: 'main',
          name: resolveAgentDisplayName('main'),
          description: getMainDescription(),
          model: getProviderStatus().model,
          provider: mainProvider,
          running: mainRunning,
          todayTurns: mainStats.todayTurns,
          todayCost: mainStats.todayCost,
          avatar_etag: avatarEtagForId('main'),
        },
        ...agents,
      ];
    }

    return c.json({ agents: allAgents });
  });

  // Agent-specific recent conversation
  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Update ALL agent models at once. MUST be registered before the
  // parameterized /:id variant below: Hono matches routes first-win, so
  // if this came second, a PATCH /api/agents/model would match the
  // parameterized route with id="model" and the bulk endpoint would be
  // unreachable (the dashboard "Set all" button was silently a no-op).
  app.patch('/api/agents/model', async (c) => {
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = VALID_CLAUDE_MODELS;
    if (!validModels.includes(model)) return c.json({ error: `Invalid model` }, 400);

    const agentIds = listAgentIds();
    const updated: string[] = [];
    const restartRequired: string[] = [];
    for (const id of agentIds) {
      try {
        setAgentProvider(id, { type: 'claude', model });
        updated.push(id);
        if (id !== 'main') restartRequired.push(id);
      } catch {}
    }
    setMainProviderConfig({ type: 'claude', model });
    updated.unshift('main');
    return c.json({ ok: true, model, updated, restartRequired });
  });

  // Update agent model
  app.patch('/api/agents/:id/model', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = VALID_CLAUDE_MODELS;
    if (!validModels.includes(model)) return c.json({ error: `Invalid model. Valid: ${validModels.join(', ')}` }, 400);

    try {
      if (agentId === 'main') {
        // Main applies in-memory immediately — no restart needed.
        const { setMainModelOverride } = await import('./bot.js');
        setMainModelOverride(model);
        setMainProviderConfig({ type: 'claude', model });
        return c.json({ ok: true, agent: agentId, model, restartRequired: false });
      }
      // Sub-agents read agentDefaultModel into config.ts module state once
      // at process startup. Yaml change takes effect only after the agent
      // process restarts. We don't auto-restart because that would kill any
      // in-flight mission task or Telegram turn — surface the requirement
      // so the UI can prompt deliberately.
      setAgentProvider(agentId, { type: 'claude', model });
      return c.json({ ok: true, agent: agentId, model, restartRequired: true });
    } catch (err) {
      return c.json({ error: 'Failed to update model' }, 500);
    }
  });

  app.get('/api/providers/models', async (c) => {
    const provider = (c.req.query('provider') || '').toLowerCase();
    const current = getMainProviderConfig();
    if (!ENABLE_ACP && provider !== 'claude') {
      return c.json({ error: 'Provider selection is disabled. Set ENABLE_ACP=true in .env to enable (beta).' }, 403);
    }
    if (provider === 'claude') {
      return c.json({
        provider,
        models: CLAUDE_MODEL_OPTIONS,
        defaultModel: current.type === 'claude' ? (current.model ?? DEFAULT_CLAUDE_MODEL) : DEFAULT_CLAUDE_MODEL,
        selectable: true,
        allowCustom: true,
      });
    }
    if (provider === 'opencode') {
      const models = getOpenCodeModels();
      const configuredModel = getOpenCodeDefaultModel();
      const currentModel = current.type === 'opencode' ? current.model : undefined;
      return c.json({
        provider,
        models: models.length ? models : [{ id: 'opencode-default', label: 'OpenCode default' }],
        defaultModel: currentModel ?? (configuredModel && models.some((m) => m.id === configuredModel)
          ? configuredModel
          : models[0]?.id ?? configuredModel ?? 'opencode-default'),
        selectable: models.length > 0,
        allowCustom: true,
        note: 'OpenCode model selection is sent through ACP session/set_model when the provider supports it.',
      });
    }
    if (provider === 'gemini') {
      return c.json({
        provider,
        models: GEMINI_MODEL_OPTIONS,
        defaultModel: current.type === 'gemini' ? (current.model ?? GEMINI_MODEL_OPTIONS[0].id) : GEMINI_MODEL_OPTIONS[0].id,
        selectable: true,
        allowCustom: true,
        note: 'Gemini model selection is sent through ACP session/set_model when supported.',
      });
    }
    if (provider === 'codex') {
      return c.json({
        provider,
        models: CODEX_MODEL_OPTIONS,
        defaultModel: current.type === 'codex' ? (current.model ?? DEFAULT_CODEX_MODEL) : DEFAULT_CODEX_MODEL,
        selectable: true,
        allowCustom: true,
        note: 'Codex model selection is sent through the codex-acp adapter via ACP session/set_model when supported.',
      });
    }
    if (provider === 'acp') {
      return c.json({
        provider,
        models: CUSTOM_ACP_MODEL_OPTIONS,
        defaultModel: current.type === 'acp' ? (current.model ?? 'provider-default') : 'provider-default',
        selectable: true,
        allowCustom: true,
        note: 'Custom ACP model ids are provider-specific. Use provider-default to skip session/set_model.',
      });
    }
    if (provider === 'openrouter') {
      const models = await fetchOpenRouterModels();
      const fallback = [{ id: DEFAULT_OPENROUTER_MODEL, label: DEFAULT_OPENROUTER_MODEL }];
      const list = models.length > 0 ? models : fallback;
      const currentModel = current.type === 'openrouter' ? current.model : undefined;
      const defaultModel = currentModel && list.some((m) => m.id === currentModel)
        ? currentModel
        : list[0]?.id ?? DEFAULT_OPENROUTER_MODEL;
      return c.json({
        provider,
        models: list,
        defaultModel,
        selectable: true,
        allowCustom: true,
        note: 'Single-turn chat only — each message is an independent exchange with no prior-turn context (memory injection still applies). Free models (suffix :free) rotate and may be upstream-rate-limited; if one hangs or 429s, try another.',
      });
    }
    return c.json({ error: 'Invalid provider' }, 400);
  });

  app.get('/api/providers/runtime-options', async (c) => {
    const providerType = (c.req.query('provider') || '').toLowerCase();
    if (!ENABLE_ACP && providerType !== 'claude') {
      return c.json({ error: 'Provider selection is disabled. Set ENABLE_ACP=true in .env to enable (beta).' }, 403);
    }
    const current = getMainProviderConfig();
    const hasCommandOverride = c.req.query('command') !== undefined || c.req.query('args') !== undefined;
    const base: ProviderConfig = providerType === current.type && !hasCommandOverride
      ? current
      : normalizeProviderConfig({
        type: providerType,
        command: c.req.query('command'),
        args: parseProviderArgsQuery(c.req.query('args')),
      });

    if (base.type === 'claude') {
      return c.json({
        provider: base.type,
        modeOptions: CLAUDE_RUNTIME_OPTIONS,
        thinkingOptions: CLAUDE_THINKING_OPTIONS,
        rawConfigOptions: [],
        source: 'static',
      });
    }
    if (base.type === 'openrouter') {
      // OpenRouter is a plain OpenAI-compatible HTTP gateway — no ACP-style
      // session/configuration. No mode/thinking dropdowns to surface.
      return c.json({
        provider: base.type,
        modeOptions: [],
        thinkingOptions: [],
        rawConfigOptions: [],
        source: 'static',
      });
    }
    if (base.type !== 'opencode' && base.type !== 'gemini' && base.type !== 'codex' && base.type !== 'acp') {
      return c.json({ error: 'Invalid provider' }, 400);
    }
    if (base.type === 'acp' && !base.command?.trim()) {
      return c.json({ ...fallbackRuntimeOptions(base), error: 'Custom ACP provider requires a command' });
    }

    try {
      const inspected = await inspectAcpProviderRuntimeOptions(base, PROJECT_ROOT, 5000);
      if (inspected.modeOptions.length || inspected.thinkingOptions.length) return c.json(inspected);
      return c.json({
        ...fallbackRuntimeOptions(base),
        error: 'Provider did not advertise runtime options',
      });
    } catch (err) {
      const fallback = fallbackRuntimeOptions(base);
      return c.json({
        ...fallback,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.patch('/api/agents/:id/provider', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ provider?: ProviderConfig; type?: string; model?: string; command?: string; args?: string[] }>();
    const candidate = body.provider ?? {
      type: body.type,
      model: body.model,
      command: body.command,
      args: body.args,
    };
    const provider = normalizeProviderConfig(candidate);
    if (!ENABLE_ACP && provider.type !== 'claude') {
      return c.json({ error: 'Provider selection is disabled. Set ENABLE_ACP=true in .env to enable (beta).' }, 403);
    }
    const validationError = validateProviderConfig(provider);
    if (validationError) return c.json({ error: validationError }, 400);

    // Preflight: if the provider's CLI is not installed, fail fast with an
    // actionable response so the user can install it before the next chat
    // turn crashes with a spawn ENOENT they can't easily decode.
    const availability = checkProviderAvailability(provider);
    if (!availability.ok) {
      return c.json({
        error: availability.error,
        installCommand: availability.installCommand,
        setupHint: availability.setupHint,
        docsUrl: availability.docsUrl,
      }, 400);
    }

    try {
      if (agentId === 'main') {
        setMainProviderConfig(provider);
        updateAgentProvider(provider);
      } else {
        setAgentProvider(agentId, provider);
      }
      return c.json({ ok: true, agent: agentId, provider, restartRequired: agentId !== 'main' });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update provider' }, 500);
    }
  });

  // ── Agent file editor (CLAUDE.md + agent.yaml) ──────────────────────
  // Lets the dashboard edit each agent's persona (CLAUDE.md) and config
  // (agent.yaml) directly. CLAUDE.md hot-reloads per turn (the Agent SDK
  // re-reads it via settingSources: ['project']) so a save takes effect
  // on the very next turn without a restart. agent.yaml is loaded once
  // at process startup, so editing it returns restartRequired=true and
  // the UI surfaces a one-click restart.
  //
  // Sensitive fields in agent.yaml (notably the bot token) are redacted
  // to `***REDACTED***` on GET and restored from disk on PUT if the
  // client echoes the redacted value back. Means the UI can never leak
  // tokens to a screenshot, and editing other fields doesn't accidentally
  // wipe the token.

  // Lazily-imported to keep the module free of heavyweight YAML parsing
  // unless someone actually edits a file. Same lazy import pattern as the
  // setEnvKey usage at the bottom of this file.
  async function getAtomicWriter() {
    const { atomicEnvWrite } = await import('./env-write.js');
    return atomicEnvWrite;
  }

  // Snapshot the current on-disk content into agent_file_history BEFORE
  // overwriting. Result: every save leaves a versioned trail in SQLite
  // the user can browse and restore from. Pruned to 100 versions per
  // (agent, kind) so the table stays bounded.
  function snapshotPriorVersion(
    agentId: string,
    kind: AgentFileKind,
    diskPath: string,
  ): void {
    if (!fs.existsSync(diskPath)) return;
    try {
      const prior = fs.readFileSync(diskPath, 'utf-8');
      if (!prior) return;
      const sha = crypto.createHash('sha256').update(prior).digest('hex');
      // Skip if the most recent history row already matches this content
      // (prevents duplicate rows when the user clicks Save without making
      // any changes — which Monaco's onChange wouldn't catch if they
      // typed-and-deleted).
      const recent = listAgentFileHistory(agentId, kind, 1);
      if (recent.length > 0 && recent[0].sha256 === sha) return;
      appendAgentFileHistory(agentId, kind, prior, sha);
      pruneAgentFileHistory(agentId, kind, 100);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, agentId, kind }, 'failed to snapshot prior file version');
    }
  }

  function loadAgentFiles(agentDir: string): { claudeMd: string; agentYaml: string; agentYamlRedacted: string } {
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    const yamlPath = path.join(agentDir, 'agent.yaml');
    const claudeMd = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8') : '';
    const agentYaml = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, 'utf-8') : '';
    // Redact bot_token line so the dashboard never displays it. Most
    // agent.yaml files use telegram_bot_token_env to reference an env
    // var by name (not a literal token), so this is defense-in-depth
    // for any older agent.yaml that still inlines the token.
    const agentYamlRedacted = agentYaml.replace(
      /^(\s*bot_token\s*:\s*)([^\n#]+?)(\s*(?:#.*)?)$/m,
      '$1"***REDACTED***"$3',
    );
    return { claudeMd, agentYaml, agentYamlRedacted };
  }

  // Main is the host process — it has no agents/main/ directory and no
  // agent.yaml (its config lives in .env). Its CLAUDE.md is loaded from
  // CLAUDECLAW_CONFIG/CLAUDE.md (preferred) or PROJECT_ROOT/CLAUDE.md
  // (legacy fallback). The editor exposes only the persona for main.
  function resolveMainClaudeMdPath(): string {
    const external = path.join(CLAUDECLAW_CONFIG, 'CLAUDE.md');
    if (fs.existsSync(external)) return external;
    const repo = path.join(PROJECT_ROOT, 'CLAUDE.md');
    if (fs.existsSync(repo)) return repo;
    // Neither exists — write goes to the external path (the canonical
    // location). Read returns empty.
    return external;
  }

  app.get('/api/agents/:id/files', (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);

    if (agentId === 'main') {
      const mainClaude = resolveMainClaudeMdPath();
      const claudeMd = fs.existsSync(mainClaude) ? fs.readFileSync(mainClaude, 'utf-8') : '';
      return c.json({
        agent_id: 'main',
        claude_md: claudeMd,
        agent_yaml: '',
        bot_token_redacted: false,
        // Tells the UI to hide the Config tab — main has no agent.yaml.
        config_editable: false,
        claude_md_path: mainClaude,
      });
    }

    let agentDir: string;
    try { agentDir = resolveAgentDir(agentId); }
    catch { return c.json({ error: 'agent not found' }, 404); }
    const files = loadAgentFiles(agentDir);
    return c.json({
      agent_id: agentId,
      claude_md: files.claudeMd,
      agent_yaml: files.agentYamlRedacted,
      bot_token_redacted: files.agentYaml !== files.agentYamlRedacted,
      config_editable: true,
    });
  });

  app.put('/api/agents/:id/files/claudemd', async (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const body = await c.req.json().catch(() => null) as { content?: string } | null;
    if (!body || typeof body.content !== 'string') {
      return c.json({ error: 'expected { content: string }' }, 400);
    }
    if (body.content.length > 200_000) {
      return c.json({ error: 'CLAUDE.md exceeds 200KB' }, 400);
    }

    // Resolve target path — main's CLAUDE.md lives outside the agents/
    // tree. For sub-agents, the file goes into the agent's resolved dir
    // (which respects CLAUDECLAW_CONFIG override).
    let target: string;
    if (agentId === 'main') {
      target = resolveMainClaudeMdPath();
      // Make sure the parent dir exists — fresh installs may not have
      // created CLAUDECLAW_CONFIG yet.
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
    } else {
      let agentDir: string;
      try { agentDir = resolveAgentDir(agentId); }
      catch { return c.json({ error: 'agent not found' }, 404); }
      target = path.join(agentDir, 'CLAUDE.md');
    }
    try {
      snapshotPriorVersion(agentId, 'claudemd', target);
      const atomicEnvWrite = await getAtomicWriter();
      atomicEnvWrite(target, body.content);
      // Loosen perms — CLAUDE.md is not sensitive (no tokens), and 0600
      // would prevent an editor running as a different user from reading
      // it locally.
      try { fs.chmodSync(target, 0o644); } catch {}
      // For main, the persona is injected into NEW sessions via the
      // bot's agentSystemPrompt module variable (src/bot.ts). It's
      // captured at startup, so a CLAUDE.md edit wouldn't reach the
      // bot without this in-memory update. Sub-agents don't need this:
      // the Agent SDK re-reads CLAUDE.md from cwd via settingSources on
      // every turn, so saves are hot-loaded automatically.
      if (agentId === 'main') {
        try {
          const { updateAgentSystemPrompt } = await import('./config.js');
          updateAgentSystemPrompt(body.content);
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err }, 'failed to refresh main agentSystemPrompt');
        }
      }
      insertAuditLog(agentId, '', 'edit_claudemd', `${body.content.length} bytes`, false);
      return c.json({ ok: true, takes_effect: 'next-turn' });
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to write CLAUDE.md');
      return c.json({ error: 'Failed to write file' }, 500);
    }
  });

  app.put('/api/agents/:id/files/agent-yaml', async (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (agentId === 'main') {
      // Main is the host process — its config lives in .env, not yaml.
      return c.json({ error: 'main agent has no agent.yaml; edit .env directly' }, 400);
    }
    const body = await c.req.json().catch(() => null) as { content?: string } | null;
    if (!body || typeof body.content !== 'string') {
      return c.json({ error: 'expected { content: string }' }, 400);
    }
    if (body.content.length > 64 * 1024) {
      return c.json({ error: 'agent.yaml exceeds 64KB' }, 400);
    }
    let agentDir: string;
    try { agentDir = resolveAgentDir(agentId); }
    catch { return c.json({ error: 'agent not found' }, 404); }

    // Validate as YAML before writing — no point poisoning the file.
    let parsed: any;
    try {
      const yaml = await import('js-yaml');
      parsed = yaml.load(body.content);
    } catch (err: any) {
      return c.json({ error: 'YAML parse error: ' + (err?.message || err) }, 400);
    }
    if (!parsed || typeof parsed !== 'object') {
      return c.json({ error: 'agent.yaml must be a YAML object' }, 400);
    }
    // Canonical schema (src/agent-config.ts loadAgentConfig): name and
    // telegram_bot_token_env are required; description and model are
    // strongly recommended. id is derived from the directory name, NOT
    // a yaml field. Reject the save if either required field is missing
    // so we never poison the file and crash the agent on next start.
    if (!parsed.name || !parsed.telegram_bot_token_env) {
      return c.json({ error: 'agent.yaml requires name and telegram_bot_token_env fields' }, 400);
    }

    // If the client posted back the redacted token, splice in the real
    // value from the file currently on disk. Means partial edits don't
    // require the user to know the real token.
    let content = body.content;
    if (/bot_token\s*:\s*"?\*\*\*REDACTED\*\*\*"?/.test(content)) {
      const yamlPath = path.join(agentDir, 'agent.yaml');
      const onDisk = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, 'utf-8') : '';
      const tokenMatch = onDisk.match(/^\s*bot_token\s*:\s*([^\n#]+?)\s*(?:#.*)?$/m);
      const realToken = tokenMatch ? tokenMatch[1] : '';
      if (realToken && realToken !== '"***REDACTED***"') {
        content = content.replace(/^(\s*bot_token\s*:\s*)"?\*\*\*REDACTED\*\*\*"?(\s*(?:#.*)?)$/m, `$1${realToken}$2`);
      }
    }

    const target = path.join(agentDir, 'agent.yaml');
    try {
      snapshotPriorVersion(agentId, 'agent-yaml', target);
      const atomicEnvWrite = await getAtomicWriter();
      atomicEnvWrite(target, content);
      // Keep restrictive perms — file holds the bot token.
      try { fs.chmodSync(target, 0o600); } catch {}
      insertAuditLog(agentId, '', 'edit_agent_yaml', `${content.length} bytes`, false);
      return c.json({ ok: true, takes_effect: 'restart' });
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to write agent.yaml');
      return c.json({ error: 'Failed to write file' }, 500);
    }
  });

  // List versioned history for an agent file. Newest-first, no content
  // (callers fetch full content via the next endpoint to keep this list
  // payload small).
  app.get('/api/agents/:id/files/history', (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const kindParam = c.req.query('kind');
    if (kindParam !== 'claudemd' && kindParam !== 'agent-yaml') {
      return c.json({ error: 'kind must be "claudemd" or "agent-yaml"' }, 400);
    }
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const versions = listAgentFileHistory(agentId, kindParam as AgentFileKind, limit);
    return c.json({ versions });
  });

  // Fetch a specific version's full content. Used by the editor when the
  // user clicks a version in the history drawer to preview/restore.
  app.get('/api/agents/:id/files/history/:versionId', (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const versionId = parseInt(c.req.param('versionId'), 10);
    if (!Number.isFinite(versionId)) return c.json({ error: 'invalid version id' }, 400);
    const row = getAgentFileHistory(versionId);
    if (!row || row.agent_id !== agentId) return c.json({ error: 'version not found' }, 404);
    return c.json({ version: row });
  });

  // Restore a specific version: snapshots the current on-disk content
  // (so a restore is itself a versioned change), then writes the chosen
  // version back to disk. The user can always undo by restoring the
  // version that was just snapshotted.
  app.post('/api/agents/:id/files/history/:versionId/restore', async (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const versionId = parseInt(c.req.param('versionId'), 10);
    if (!Number.isFinite(versionId)) return c.json({ error: 'invalid version id' }, 400);
    const row = getAgentFileHistory(versionId);
    if (!row || row.agent_id !== agentId) return c.json({ error: 'version not found' }, 404);

    // Resolve target path with the same rules the GET/PUT endpoints use.
    let target: string;
    if (agentId === 'main') {
      if (row.file_kind !== 'claudemd') return c.json({ error: 'main has no agent.yaml' }, 400);
      target = resolveMainClaudeMdPath();
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
    } else {
      let agentDir: string;
      try { agentDir = resolveAgentDir(agentId); }
      catch { return c.json({ error: 'agent not found' }, 404); }
      target = path.join(agentDir, row.file_kind === 'claudemd' ? 'CLAUDE.md' : 'agent.yaml');
    }

    try {
      snapshotPriorVersion(agentId, row.file_kind as AgentFileKind, target);
      const atomicEnvWrite = await getAtomicWriter();
      atomicEnvWrite(target, row.content);
      try { fs.chmodSync(target, row.file_kind === 'agent-yaml' ? 0o600 : 0o644); } catch {}
      // Same in-memory refresh as the PUT path — main's bot caches the
      // CLAUDE.md content at startup and only sees disk changes via this
      // setter.
      if (agentId === 'main' && row.file_kind === 'claudemd') {
        try {
          const { updateAgentSystemPrompt } = await import('./config.js');
          updateAgentSystemPrompt(row.content);
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err }, 'failed to refresh main agentSystemPrompt');
        }
      }
      insertAuditLog(agentId, '', 'restore_' + row.file_kind, `version ${versionId} (${row.byte_size} bytes)`, false);
      return c.json({
        ok: true,
        takes_effect: row.file_kind === 'claudemd' ? 'next-turn' : 'restart',
        restored_version: versionId,
      });
    } catch (err) {
      logger.error({ err, agentId, versionId }, 'Failed to restore agent file');
      return c.json({ error: 'restore failed' }, 500);
    }
  });

  // ── Agent split suggestions ─────────────────────────────────────────
  // Scans hive_mind for the last 200 actions per agent, sends the bag
  // (agent description + their recent action summaries) to the selected provider, and
  // asks "is any one agent doing several distinct domains that warrant
  // a split?" Suggestions land in agent_suggestions and surface as a
  // lightbulb badge on the AgentCard. The user can dismiss (= "no
  // thanks") or act (= "open the wizard pre-filled"); both states stick
  // so re-running analysis doesn't keep re-suggesting the same split.

  app.get('/api/agents/suggestions', (c) => {
    return c.json({ suggestions: listActiveAgentSuggestions() });
  });

  app.post('/api/agents/suggestions/refresh', async (c) => {
    // Analysis logic lives in src/agent-suggestions.ts so the same code
    // path serves both this manual trigger and the 24h periodic job.
    const { refreshAgentSuggestions } = await import('./agent-suggestions.js');
    try {
      const result = await refreshAgentSuggestions();
      return c.json(result);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'agent suggestion analysis failed');
      return c.json({ error: 'analysis failed (selected provider unavailable)' }, 503);
    }
  });

  app.post('/api/agents/suggestions/:id/dismiss', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = dismissAgentSuggestion(id);
    if (!ok) return c.json({ error: 'not found or already dismissed' }, 404);
    insertAuditLog('main', '', 'agent_suggestion_dismiss', `id=${id}`, false);
    return c.json({ ok: true });
  });

  app.post('/api/agents/suggestions/:id/acted', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = markAgentSuggestionActed(id);
    if (!ok) return c.json({ error: 'not found or already acted' }, 404);
    insertAuditLog('main', '', 'agent_suggestion_acted', `id=${id}`, false);
    return c.json({ ok: true });
  });

  // ── Agent Creation & Management ──────────────────────────────────────

  // List available agent templates
  app.get('/api/agents/templates', (c) => {
    return c.json({ templates: listTemplates() });
  });

  // Validate an agent ID (before creation)
  app.get('/api/agents/validate-id', (c) => {
    const id = c.req.query('id') || '';
    const result = validateAgentId(id);
    const suggestions = id ? suggestBotNames(id) : null;
    return c.json({ ...result, suggestions });
  });

  // Validate a bot token
  app.post('/api/agents/validate-token', async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const token = body?.token?.trim();
    if (!token) return c.json({ ok: false, error: 'token required' }, 400);
    const result = await validateBotToken(token);
    return c.json(result);
  });

  // Create a new agent
  app.post('/api/agents/create', async (c) => {
    const body = await c.req.json<{
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      provider?: ProviderConfig;
      template?: string;
      botToken?: string;
    }>();

    const id = body?.id?.trim();
    const name = body?.name?.trim();
    const description = body?.description?.trim();
    const botToken = body?.botToken?.trim();

    if (!id) return c.json({ error: 'id required' }, 400);
    if (!name) return c.json({ error: 'name required' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    if (!botToken) return c.json({ error: 'botToken required' }, 400);

    try {
      const provider = body?.provider ? normalizeProviderConfig(body.provider, body?.model?.trim() || undefined) : undefined;
      if (provider) {
        if (!ENABLE_ACP && provider.type !== 'claude') {
          return c.json({ error: 'Provider selection is disabled. Set ENABLE_ACP=true in .env to enable (beta).' }, 403);
        }
        const validationError = validateProviderConfig(provider);
        if (validationError) return c.json({ error: validationError }, 400);
        const availability = checkProviderAvailability(provider);
        if (!availability.ok) {
          return c.json({
            error: availability.error,
            installCommand: availability.installCommand,
            setupHint: availability.setupHint,
            docsUrl: availability.docsUrl,
          }, 400);
        }
      }
      const result = await createAgent({
        id,
        name,
        description,
        model: body?.model?.trim() || undefined,
        provider,
        template: body?.template?.trim() || undefined,
        botToken,
      });
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // Activate an agent (install service + start)
  app.post('/api/agents/:id/activate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot activate main via this endpoint' }, 400);
    const result = activateAgent(agentId);
    return c.json(result);
  });

  // Deactivate an agent (stop + uninstall service)
  app.post('/api/agents/:id/deactivate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot deactivate main via this endpoint' }, 400);
    const result = deactivateAgent(agentId);
    return c.json(result);
  });

  // Restart an agent (kill + relaunch service)
  app.post('/api/agents/:id/restart', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot restart main via this endpoint. Restart the main process manually.' }, 400);
    const result = restartAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true, message: `Agent ${agentId} restarted` });
    }
    return c.json({ error: result.error }, 500);
  });

  // Delete an agent entirely
  app.delete('/api/agents/:id/full', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot delete main' }, 400);
    const result = deleteAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true });
    }
    return c.json({ error: result.error }, 500);
  });

  // Check if a specific agent is running
  app.get('/api/agents/:id/status', (c) => {
    const agentId = c.req.param('id');
    return c.json({ running: isAgentRunning(agentId) });
  });

  // Unified avatar resolver, used by Mission Control, both War Room
  // surfaces, and the Daily.co spawner. Source priority lives in
  // src/avatars.ts. ETag is mtime+size based, so the moment a user
  // upload or Telegram fetch lands on disk, the next request picks up
  // a new tag and the browser revalidates.
  app.get('/api/agents/:id/avatar', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);
    const ctxQ = c.req.query('context');
    const context: 'default' | 'meet' = ctxQ === 'meet' ? 'meet' : 'default';

    // Fast path: hit resolver, return file with ETag/304 support.
    const serve = (): Response | undefined => {
      const r = resolveAgentAvatar(agentId, { context });
      if (!r) return undefined;
      const etag = avatarEtag(r);
      const ifNoneMatch = c.req.header('if-none-match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'no-cache, must-revalidate',
          },
        });
      }
      const data = fs.readFileSync(r.absPath);
      // Sniff the magic bytes so JPEG/WebP uploads (PUT accepts both)
      // are served with the correct Content-Type. The on-disk filename
      // is always *.png by convention, but the bytes can be anything
      // we accepted at upload time. Browsers cope either way; strict
      // proxies and image processors do not.
      let contentType = 'image/png';
      if (data.length >= 12) {
        if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
          contentType = 'image/jpeg';
        } else if (
          data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
          data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
        ) {
          contentType = 'image/webp';
        }
      }
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, must-revalidate',
          'ETag': etag,
        },
      });
    };

    const fast = serve();
    if (fast) return fast;

    // No mutable file and no bundled fallback. For sub-agents we can
    // try Telegram once (writes to mutable path on success). Main has
    // no bot token of its own here, so we don't attempt.
    if (agentId !== 'main') {
      const fetched = await tryFetchTelegramAvatar(agentId);
      if (fetched) {
        const after = serve();
        if (after) return after;
      }
    }

    return c.body(null, 204);
  });

  // Upload a custom avatar from the dashboard. Always writes to the
  // mutable, runtime-owned location (resolveAgentDir(id)/avatar.png for
  // sub-agents, STORE_DIR/avatars/main.png for main). Never writes to
  // warroom/avatars/ — that namespace stays bundled, immutable art.
  // PNG / JPEG / WebP, 5 MB max.
  //
  // Telegram propagation is NOT possible via the Bot API — the bot's
  // profile picture can only be set by the bot owner through @BotFather
  // (/setuserpic). The frontend surfaces the manual step.
  app.put('/api/agents/:id/avatar', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);

    // Two upload modes — multipart/form-data with `image` field, or
    // application/octet-stream with the raw bytes (handier for CLI).
    let bytes: Buffer | null = null;
    const ct = c.req.header('content-type') || '';
    try {
      if (ct.startsWith('multipart/form-data')) {
        const form = await c.req.formData();
        const file = form.get('image');
        if (!file || typeof file === 'string') {
          return c.json({ error: 'missing "image" file field' }, 400);
        }
        bytes = Buffer.from(await (file as File).arrayBuffer());
      } else {
        const buf = await c.req.arrayBuffer();
        if (buf.byteLength === 0) return c.json({ error: 'empty body' }, 400);
        bytes = Buffer.from(buf);
      }
    } catch (err) {
      return c.json({ error: 'failed to read upload' }, 400);
    }

    if (!bytes || bytes.length === 0) return c.json({ error: 'empty upload' }, 400);
    if (bytes.length > 5 * 1024 * 1024) return c.json({ error: 'image too large (max 5 MB)' }, 400);

    try {
      const result = await writeUploadedAvatar(agentId, bytes);
      insertAuditLog(agentId, '', 'upload_avatar', `${bytes.length} bytes`, false);
      return c.json({
        ok: true,
        bytes: result.bytes,
        path: result.absPath,
        // Echo the new etag so the client can cache-bust render sites
        // immediately without waiting for a list refresh.
        avatar_etag: `${Math.floor(result.mtimeMs)}-${result.size}`,
      });
    } catch (err: any) {
      const msg = (err && err.message) || 'failed to save avatar';
      const code = msg.startsWith('image must be') ? 400 : 500;
      if (code === 500) logger.error({ err, agentId }, 'Failed to write avatar');
      return c.json({ error: msg }, code);
    }
  });

  app.delete('/api/agents/:id/avatar', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);
    try {
      await deleteUploadedAvatar(agentId);
      insertAuditLog(agentId, '', 'delete_avatar', '', false);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: 'failed to delete avatar' }, 500);
    }
  });

  // ── Dashboard personalization ────────────────────────────────────────
  // Tiny key/value store backed by the dashboard_settings table. Used by
  // the workspace name, hotkey mod choice, mission column order/widths,
  // and any future per-workspace personalization. Values are arbitrary
  // strings (the client encodes JSON for non-string payloads).
  //
  // Allowed keys are explicit so a typo on the client doesn't quietly
  // create a junk row, and so future migrations have a finite list to
  // reason about.
  const ALLOWED_SETTING_KEYS = new Set([
    'workspace_name',
    'hotkey_mod', // 'meta' | 'ctrl' | 'auto'
    'sidebar_collapsed_sections', // JSON array of section ids
    'mission_column_order', // JSON array of agent ids
    'mission_column_widths', // JSON object { id: px }
    // JSON {agents: [{id, enabled}], maxSpeakers}. Drives /standup
    // and /discuss in the text War Room — the user picks who's in,
    // their order, and the cap. Read by pickSlashRoster() in
    // src/warroom-text-orchestrator.ts. UI: web/src/pages/StandupConfig.tsx.
    'standup_config',
  ]);
  const SETTING_VALUE_MAX_BYTES = 4 * 1024;

  app.get('/api/dashboard/settings', (c) => {
    return c.json(getAllDashboardSettings());
  });

  // Per-key shape validators. The byte cap upstream of this catches a
  // hostile blob; per-key shape validation catches the case where a bug
  // in the UI saves a structurally wrong but small payload that would
  // then read back as defaults at /standup time.
  function validateStandupConfigJson(value: string): string | null {
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { return 'standup_config: value must be valid JSON'; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'standup_config: value must be a JSON object';
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.agents)) {
      return 'standup_config: agents must be an array';
    }
    for (const a of obj.agents) {
      if (!a || typeof a !== 'object' || typeof (a as { id?: unknown }).id !== 'string') {
        return 'standup_config: each agent entry must be { id: string, enabled?: boolean }';
      }
      const enabled = (a as { enabled?: unknown }).enabled;
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return 'standup_config: agent.enabled must be boolean when present';
      }
    }
    if (typeof obj.maxSpeakers !== 'number' || !Number.isFinite(obj.maxSpeakers)
        || !Number.isInteger(obj.maxSpeakers) || obj.maxSpeakers < 1 || obj.maxSpeakers > 8) {
      return 'standup_config: maxSpeakers must be an integer in [1, 8]';
    }
    return null;
  }

  app.patch('/api/dashboard/settings', async (c) => {
    const body = await c.req.json().catch(() => null) as { key?: string; value?: string } | null;
    if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
      return c.json({ error: 'expected { key: string, value: string }' }, 400);
    }
    if (!ALLOWED_SETTING_KEYS.has(body.key)) {
      return c.json({ error: `unknown setting key: ${body.key}` }, 400);
    }
    if (Buffer.byteLength(body.value, 'utf8') > SETTING_VALUE_MAX_BYTES) {
      return c.json({ error: `value exceeds ${SETTING_VALUE_MAX_BYTES} bytes` }, 400);
    }
    if (body.key === 'standup_config') {
      const err = validateStandupConfigJson(body.value);
      if (err) return c.json({ error: err }, 400);
    }
    // Workspace name has its own length cap so the sidebar layout stays
    // sane. Strip control chars + zero-width joiners; trim whitespace.
    let value = body.value;
    if (body.key === 'workspace_name') {
      value = value.replace(/[\u0000-\u001f\u200b-\u200d\ufeff]/g, '').trim();
      if (value.length > 32) value = value.slice(0, 32);
    }
    setDashboardSetting(body.key, value);
    insertAuditLog('main', '', 'dashboard_setting_change', `${body.key}=${value.slice(0, 80)}`, false);
    return c.json({ ok: true, key: body.key, value });
  });

  // ── Security & Audit ─────────────────────────────────────────────────

  app.get('/api/security/status', (c) => {
    return c.json(getSecurityStatus());
  });

  // Toggle a kill switch by name. Writes the flag to .env atomically;
  // kill-switches.ts re-reads .env every 1.5s so the change takes effect
  // without a process restart.
  const ALLOWED_KILL_SWITCHES = new Set([
    'WARROOM_TEXT_ENABLED',
    'WARROOM_VOICE_ENABLED',
    'LLM_SPAWN_ENABLED',
    'DASHBOARD_MUTATIONS_ENABLED',
    'MISSION_AUTO_ASSIGN_ENABLED',
    'SCHEDULER_ENABLED',
  ]);
  app.post('/api/security/kill-switch', async (c) => {
    const body = await c.req.json<{ key?: string; enabled?: boolean }>();
    const key = body?.key;
    const enabled = body?.enabled;
    if (!key || typeof enabled !== 'boolean') {
      return c.json({ error: 'key (string) and enabled (boolean) required' }, 400);
    }
    if (!ALLOWED_KILL_SWITCHES.has(key)) {
      return c.json({ error: 'unknown kill switch: ' + key }, 400);
    }
    try {
      const envPath = path.join(PROJECT_ROOT, '.env');
      const { setEnvKey } = await import('./env-write.js');
      // Capture the previous state so the audit row records old→new, which
      // is what an operator actually wants during incident reconstruction.
      const { isEnabled } = await import('./kill-switches.js');
      const prev = isEnabled(key as Parameters<typeof isEnabled>[0]);
      setEnvKey(envPath, key, enabled ? 'true' : 'false');
      logger.info({ key, enabled, prev }, 'Kill switch toggled via dashboard');
      // Pack 03 audit: flips are blocked=1 because they represent a
      // safety-relevant state change. The detail captures the transition.
      insertAuditLog('main', '', 'kill_switch_flip', `${key}: ${prev} -> ${enabled}`, true);
      return c.json({ ok: true, key, enabled });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Failed to write .env: ' + msg }, 500);
    }
  });

  app.get('/api/audit', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const agentId = c.req.query('agent') || undefined;
    const entries = getAuditLog(limit, offset, agentId);
    const total = getAuditLogCount(agentId);
    return c.json({ entries, total });
  });

  app.get('/api/audit/blocked', (c) => {
    const limit = parseInt(c.req.query('limit') || '10', 10);
    return c.json({ entries: getRecentBlockedActions(limit) });
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
  });

  // ── mc-kb proxy (laptop's RAG layer on localhost:8091) ─────────────
  // Sidesteps CORS by proxying server-side. mc-kb-server.service must be running locally.
  const MCKB_BASE = 'http://127.0.0.1:8091';

  app.get('/api/mckb/health', async (c) => {
    try {
      const r = await fetch(`${MCKB_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      const body = await r.json();
      return c.json(body, r.status as 200);
    } catch (e) {
      return c.json({ status: 'offline', error: String((e as Error).message || e) }, 503);
    }
  });

  // ── /journal — daily agent decision journal (Boba/Jazzy/stock/crypto) ──
  app.get('/api/journal/list', async (c) => {
    try {
      const dir = path.join(os.homedir(), 'mc-kb', 'notes', 'agent-journal');
      if (!fs.existsSync(dir)) return c.json({ days: [] });
      const days = fs.readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .map((f) => f.replace(/\.md$/, ''))
        .sort()
        .reverse();
      return c.json({ days });
    } catch (e) {
      return c.json({ days: [], error: String((e as Error).message || e) }, 500);
    }
  });

  app.get('/api/journal/get', async (c) => {
    const date = c.req.query('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
    }
    try {
      const filePath = path.join(os.homedir(), 'mc-kb', 'notes', 'agent-journal', `${date}.md`);
      if (!fs.existsSync(filePath)) {
        return c.json({ date, content: '', missing: true });
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const stat = fs.statSync(filePath);
      return c.json({ date, content, mtime: stat.mtime.toISOString(), bytes: stat.size });
    } catch (e) {
      return c.json({ error: String((e as Error).message || e) }, 500);
    }
  });

  app.get('/api/mckb/query', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'missing q' }, 400);
    const top = c.req.query('top') || '5';
    const tier = c.req.query('tier') || '';
    const params = new URLSearchParams({ q, top });
    if (tier) params.set('tier', tier);
    try {
      const r = await fetch(`${MCKB_BASE}/query?${params}`, { signal: AbortSignal.timeout(15_000) });
      const body = await r.json();
      return c.json(body, r.status as 200);
    } catch (e) {
      return c.json({ error: 'mc-kb server unreachable', detail: String((e as Error).message || e) }, 503);
    }
  });

  // ── Databases — read-only catalog + query surface (KB RAG, SQL DBs,
  //    RAG/FTS indexes, masked secrets). All local-only. ──
  app.get('/api/databases', async (c) => {
    try {
      return c.json(await getCatalog());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Prime all database caches on boot so the operator's first load is warm
  // (no cold catalog du-walk, no cold KB-sources subprocess). Fire-and-forget.
  void warmupDatabases();

  app.get('/api/databases/kb/:id/search', async (c) => {
    const id = c.req.param('id');
    const q = c.req.query('q') || '';
    const top = parseInt(c.req.query('top') || '8', 10);
    try {
      return c.json(await kbSearch(id, q, top));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/databases/kb/:id/sources', async (c) => {
    const id = c.req.param('id');
    try {
      return c.json(await kbSources(id));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/databases/kb/:id/anatomy', (c) => {
    try {
      return c.json(kbAnatomy(c.req.param('id')));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/databases/kb/:id/anatomy/img/:file', (c) => {
    const res = kbAnatomyImage(c.req.param('id'), c.req.param('file'));
    if ('error' in res) return c.json(res, res.error === 'not found' ? 404 : 400);
    const ab = res.data.buffer.slice(res.data.byteOffset, res.data.byteOffset + res.data.byteLength) as ArrayBuffer;
    return c.body(ab, 200, { 'Content-Type': res.mime, 'Cache-Control': 'public, max-age=86400' });
  });

  // Serve extracted DVD frames: /api/databases/kb/:id/anatomy/frames/:videoId/:file
  app.get('/api/databases/kb/:id/anatomy/frames/:videoId/:file', (c) => {
    const res = kbAnatomyFrame(c.req.param('id'), c.req.param('videoId'), c.req.param('file'));
    if ('error' in res) return c.json(res, res.error === 'not found' ? 404 : 400);
    const ab = res.data.buffer.slice(res.data.byteOffset, res.data.byteOffset + res.data.byteLength) as ArrayBuffer;
    return c.body(ab, 200, { 'Content-Type': res.mime, 'Cache-Control': 'public, max-age=86400' });
  });

  // Serve per-segment technique audio (Erik's real voice): /api/databases/kb/:id/anatomy/audio/:videoId/:file
  app.get('/api/databases/kb/:id/anatomy/audio/:videoId/:file', (c) => {
    const res = kbAnatomyAudio(c.req.param('id'), c.req.param('videoId'), c.req.param('file'));
    if ('error' in res) return c.json(res, res.error === 'not found' ? 404 : 400);
    const ab = res.data.buffer.slice(res.data.byteOffset, res.data.byteOffset + res.data.byteLength) as ArrayBuffer;
    return c.body(ab, 200, { 'Content-Type': res.mime, 'Cache-Control': 'public, max-age=86400' });
  });

  // Serve a curated quiz mini-clip (motion + Erik's voice): /api/databases/kb/:id/anatomy/clip/:file
  app.get('/api/databases/kb/:id/anatomy/clip/:file', (c) => {
    const res = kbAnatomyClip(c.req.param('id'), c.req.param('file'));
    if ('error' in res) return c.json(res, res.error === 'not found' ? 404 : 400);
    const ab = res.data.buffer.slice(res.data.byteOffset, res.data.byteOffset + res.data.byteLength) as ArrayBuffer;
    return c.body(ab, 200, { 'Content-Type': res.mime, 'Cache-Control': 'public, max-age=86400' });
  });

  // Curated quiz bank (vision-filtered hands-on moments) with media URLs rewritten.
  app.get('/api/databases/kb/:id/quiz-bank', (c) => {
    try {
      return c.json(kbQuizBank(c.req.param('id')));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Return the frames _index.json for a KB.
  app.get('/api/databases/kb/:id/frames-index', (c) => {
    try {
      return c.json(kbFramesIndex(c.req.param('id')));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Return a single video's frames.json.
  app.get('/api/databases/kb/:id/frames/:videoId', (c) => {
    try {
      const res = kbVideoFrames(c.req.param('id'), c.req.param('videoId'));
      if ('error' in res) return c.json(res, res.error === 'not found' ? 404 : 400);
      return c.json(res);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post('/api/databases/kb/:id/ask', async (c) => {
    const id = c.req.param('id');
    try {
      const body = await c.req.json().catch(() => ({} as { question?: string }));
      const question = (body as { question?: string }).question || '';
      const result = await kbAsk(id, question);
      if (result.error) return c.json(result, 400);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/databases/sql/:id/meta', async (c) => {
    const id = c.req.param('id');
    try {
      const result = await sqlMeta(id);
      if ('error' in result) return c.json(result, 404);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post('/api/databases/sql/:id/query', async (c) => {
    const id = c.req.param('id');
    try {
      const body = await c.req.json().catch(() => ({} as { sql?: string }));
      const sql = (body as { sql?: string }).sql || '';
      const result = sqlSelect(id, sql);
      if ('error' in result) return c.json(result, 400);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/databases/secrets', (c) => {
    try {
      return c.json(listSecrets());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get('/api/databases/secrets/reveal', (c) => {
    const source = c.req.query('source') || '';
    const name = c.req.query('name') || '';
    try {
      const result = revealSecret(source, name);
      if (result.error) return c.json(result, 403);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    // Default to the configured chat when the dashboard is opened
    // without ?chatId. Other endpoints already do this; previously this
    // route 400'd and the error landed in the user-facing UI.
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    if (!chatId) return c.json({ turns: [] });
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Send message from dashboard
  app.post('/api/chat/send', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    const body = await c.req.json<{ message?: string }>();
    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);

    // Reject if a turn is already in flight. Without this guard, rapid
    // clicks (or a scripted token holder) can stack N agent invocations,
    // each consuming context and Anthropic budget.
    if (getIsProcessing().processing) {
      return c.json({ error: 'busy', reason: 'already_processing' }, 429);
    }

    // Fire-and-forget: response comes via SSE
    void processMessageFromDashboard(botApi, message);
    return c.json({ ok: true });
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });

  // SPA catch-all — any unmatched GET to a non-/api/* path falls through
  // to here and serves the v2 SPA index.html. Wouter (the SPA's router)
  // then takes over client-side. This is what makes a hard-refresh of
  // /mission, /scheduled, /agents, /agents/:id/files, /chat, /memories,
  // /hive, /usage, /audit, /settings work without a token: the page
  // loads the SPA, which reads ?token= from the URL or sessionStorage
  // before making any API call.
  // Accounts — read-only cross-product user inventory (ARIES / MissionCtrl /
  // Massage). MUST be registered BEFORE the SPA catch-all below, or app.get('*')
  // swallows /accounts + /api/accounts. See src/accounts.ts.
  registerAccounts(app);

  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname;
    // /api/* would have been gated earlier, but if it slipped through
    // somehow (no handler matched), still don't serve the SPA.
    if (path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    if (!fs.existsSync(newDashboardIndex)) {
      return c.text('Dashboard not built. Run `npm run build`.', 503);
    }
    const html = fs.readFileSync(newDashboardIndex, 'utf-8');
    return c.html(html);
  });

  return app;
}

/**
 * Start the dashboard: build the Hono app, bind it to DASHBOARD_PORT, and
 * wire up the WebSocket proxy for the voice War Room.
 */
export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = buildDashboardApp(botApi);

  // Default to loopback. Anyone on the same LAN is otherwise one
  // dashboard-token leak away from full mutation access. Operators who
  // want Cloudflare-tunneled or LAN access opt in via DASHBOARD_BIND in
  // .env (e.g. `DASHBOARD_BIND=0.0.0.0`).
  const bindHost = (process.env.DASHBOARD_BIND || DASHBOARD_BIND || '127.0.0.1').trim() || '127.0.0.1';
  if (bindHost !== '127.0.0.1' && bindHost !== 'localhost') {
    logger.warn(
      { bindHost, port: DASHBOARD_PORT },
      'Dashboard binding to a non-loopback address — every host that can reach this port can hit the dashboard if the token leaks. Confirm DASHBOARD_BIND is intentional.',
    );
  }
  let server: ReturnType<typeof serve>;
  try {
    server = serve({ fetch: app.fetch, port: DASHBOARD_PORT, hostname: bindHost }, () => {
      logger.info({ port: DASHBOARD_PORT, host: bindHost }, 'Dashboard server running');
    });
    // Start the text War Room channel sweeper so abandoned meetings
    // don't accumulate MeetingChannel instances in memory.
    startChannelSweeper();
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      logger.error({ port: DASHBOARD_PORT }, 'Dashboard port already in use. Change DASHBOARD_PORT in .env or kill the process using port %d.', DASHBOARD_PORT);
    } else {
      logger.error({ err }, 'Dashboard server failed to start');
    }
    return;
  }

  // ── WebSocket proxy: /ws/warroom → localhost:WARROOM_PORT ──────────
  // Allows the War Room to work through a single Cloudflare tunnel on
  // the dashboard port. Without this, remote/mobile users can't reach
  // the Python WebSocket server on port 7860.
  if (WARROOM_ENABLED) {
    void import('ws').then((wsModule: any) => {
    const WS = wsModule.default?.WebSocket ?? wsModule.WebSocket;
    const WSServer = wsModule.default?.WebSocketServer ?? wsModule.WebSocketServer;

    if (WSServer) {
      const wss = new WSServer({ noServer: true });

      // Bound on the buffered queue used while the backend WS is still
      // opening. Without these, an unauthenticated or slow client could
      // flood the proxy and grow node memory unbounded. Numbers are
      // generous for real audio bursts (16kHz PCM16 @ ~50fps) during the
      // <1s backend open window but small enough to reject abuse.
      const MAX_BUFFERED_MESSAGES = 256;
      const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

      (server as unknown as import('http').Server).on('upgrade', (
        req: import('http').IncomingMessage,
        socket: import('stream').Duplex,
        head: Buffer,
      ) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname !== '/ws/warroom') return;

        // Enforce the same token gate Hono enforces on every other route.
        // Without this, anyone who can reach the dashboard port could
        // proxy into the local Pipecat War Room socket with no auth.
        const token = url.searchParams.get('token');
        if (!DASHBOARD_AUTH_DISABLED && !safeTokenEqual(token, DASHBOARD_TOKEN)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs: any) => {
          const remote = new WS(`ws://127.0.0.1:${WARROOM_PORT}`);
          let remoteReady = false;
          const buffered: (Buffer | ArrayBuffer | string)[] = [];
          let bufferedBytes = 0;

          remote.on('open', () => {
            remoteReady = true;
            for (const msg of buffered) remote.send(msg);
            buffered.length = 0;
            bufferedBytes = 0;
          });
          remote.on('message', (data: Buffer | ArrayBuffer | string) => {
            if (clientWs.readyState === 1) clientWs.send(data);
          });
          remote.on('close', () => clientWs.close());
          remote.on('error', (err: Error) => {
            logger.warn({ err }, 'War Room WS proxy: remote error');
            try { clientWs.close(1011, 'War Room server error'); } catch { /* ok */ }
          });

          clientWs.on('message', (data: Buffer | ArrayBuffer | string) => {
            if (remoteReady) { remote.send(data); return; }
            const size = typeof data === 'string'
              ? Buffer.byteLength(data)
              : (data as Buffer | ArrayBuffer).byteLength ?? 0;
            if (buffered.length >= MAX_BUFFERED_MESSAGES || bufferedBytes + size > MAX_BUFFERED_BYTES) {
              logger.warn({ buffered: buffered.length, bufferedBytes }, 'War Room WS proxy: buffer overflow, closing client');
              try { clientWs.close(1013, 'backend not ready'); } catch { /* ok */ }
              try { remote.close(); } catch { /* ok */ }
              return;
            }
            buffered.push(data);
            bufferedBytes += size;
          });
          clientWs.on('close', () => {
            if (remote.readyState <= 1) remote.close();
          });
        });
      });

      logger.info('War Room WebSocket proxy active at /ws/warroom');
    }
    }).catch((err: unknown) => {
      logger.warn({ err }, 'Could not set up War Room WS proxy');
    });
  }
}
