import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { STORE_DIR } from './config.js';

export type ProviderType = 'claude' | 'acp' | 'opencode' | 'gemini' | 'codex';
export type ProviderRuntimeMode = string;
export type ProviderThinkingMode = string;

export interface ProviderConfig {
  type: ProviderType;
  /** Optional model override. ACP providers receive this via session/set_model when supported. */
  model?: string;
  /** Provider-specific latency/depth preference. Claude maps known values to effort; ACP uses exact config values. */
  runtimeMode?: ProviderRuntimeMode;
  /** Provider-specific thinking preference. Claude maps known values to thinking; ACP uses exact config values. */
  thinkingMode?: ProviderThinkingMode;
  /** Generic ACP command. Built-in ACP presets supply their own commands. */
  command?: string;
  args?: string[];
}

export const DEFAULT_PROVIDER: ProviderConfig = { type: 'claude', model: 'claude-opus-4-6' };
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-6';
export const DEFAULT_CODEX_MODEL = 'gpt-5.5';

export function normalizeProviderConfig(input: unknown, legacyModel?: string): ProviderConfig {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const typeRaw = typeof raw.type === 'string' ? raw.type.toLowerCase() : undefined;

  if (typeRaw === 'claude' || typeRaw === 'acp' || typeRaw === 'opencode' || typeRaw === 'gemini' || typeRaw === 'codex') {
    const cfg: ProviderConfig = { type: typeRaw };
    if (typeof raw.model === 'string' && raw.model.trim()) cfg.model = raw.model.trim();
    if (typeof raw.runtimeMode === 'string' && raw.runtimeMode.trim()) cfg.runtimeMode = raw.runtimeMode.trim();
    if (typeof raw.thinkingMode === 'string' && raw.thinkingMode.trim()) cfg.thinkingMode = raw.thinkingMode.trim();
    if (typeof raw.command === 'string' && raw.command.trim()) cfg.command = raw.command.trim();
    if (Array.isArray(raw.args)) cfg.args = raw.args.filter((v): v is string => typeof v === 'string');
    return cfg;
  }

  if (legacyModel?.startsWith('claude-')) {
    return { type: 'claude', model: legacyModel };
  }

  return { ...DEFAULT_PROVIDER };
}

export function providerToYaml(provider: ProviderConfig): Record<string, unknown> {
  const raw: Record<string, unknown> = { type: provider.type };
  if (provider.model) raw.model = provider.model;
  if (provider.runtimeMode) raw.runtimeMode = provider.runtimeMode;
  if (provider.thinkingMode) raw.thinkingMode = provider.thinkingMode;
  if (provider.type === 'acp') {
    if (provider.command) raw.command = provider.command;
    if (provider.args) raw.args = provider.args;
  }
  return raw;
}

function mainConfigPath(): string {
  return path.join(STORE_DIR, 'main-config.json');
}

function readMainConfig(): Record<string, unknown> {
  try {
    const configPath = mainConfigPath();
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeMainConfig(raw: Record<string, unknown>): void {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(mainConfigPath(), JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}

export function getMainProviderConfig(): ProviderConfig {
  const raw = readMainConfig();
  return normalizeProviderConfig(raw.provider, typeof raw.model === 'string' ? raw.model : undefined);
}

export function setMainProviderConfig(provider: ProviderConfig): void {
  const raw = readMainConfig();
  raw.provider = providerToYaml(provider);
  delete raw.model;
  writeMainConfig(raw);
}

export function getProviderDisplay(provider: ProviderConfig): string {
  const suffix = [
    provider.model,
    provider.runtimeMode,
    provider.thinkingMode && provider.thinkingMode !== 'auto' ? `thinking ${provider.thinkingMode}` : undefined,
  ].filter(Boolean).join(', ');
  if (provider.type === 'claude') return `Claude${suffix ? ` (${suffix})` : ''}`;
  if (provider.type === 'opencode') return `OpenCode${suffix ? ` (${suffix})` : ' (model from OpenCode config)'}`;
  if (provider.type === 'gemini') return `Gemini CLI${suffix ? ` (${suffix})` : ' (ACP)'}`;
  if (provider.type === 'codex') return `Codex${suffix ? ` (${suffix})` : ' (codex-acp adapter)'}`;
  return `ACP (${provider.command ?? 'custom command'}${provider.args?.length ? ` ${provider.args.join(' ')}` : ''}${suffix ? `; ${suffix}` : ''})`;
}

export function sessionBelongsToProvider(sessionId: string | undefined, provider: ProviderConfig): boolean {
  if (!sessionId) return false;
  if (!sessionId.includes(':')) return provider.type === 'claude';
  return sessionId.startsWith(`${provider.type}:`);
}

export function encodeProviderSession(provider: ProviderConfig, sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  return `${provider.type}:${sessionId}`;
}

export function decodeProviderSession(provider: ProviderConfig, sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  const prefix = `${provider.type}:`;
  if (sessionId.startsWith(prefix)) return sessionId.slice(prefix.length);
  if (!sessionId.includes(':') && provider.type === 'claude') return sessionId;
  return undefined;
}

export function readProviderFromYaml(raw: Record<string, unknown>): ProviderConfig {
  const legacyModel = typeof raw.model === 'string' ? raw.model : undefined;
  return normalizeProviderConfig(raw.provider, legacyModel);
}

export function writeProviderToYaml(raw: Record<string, unknown>, provider: ProviderConfig): Record<string, unknown> {
  raw.provider = providerToYaml(provider);
  delete raw.model;
  return raw;
}

export function parseYamlProvider(filePath: string): ProviderConfig {
  const raw = yaml.load(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  return readProviderFromYaml(raw);
}
