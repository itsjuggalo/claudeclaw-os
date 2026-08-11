import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Resolve the checkout's canonical .env independently of process.cwd().
 * env.ts is one directory below the checkout root in both supported layouts:
 * src/env.ts during development and dist/env.js after compilation.
 */
export const REPO_ROOT_ENV = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.env',
);

/**
 * Preserve cwd-local overrides while allowing CLIs launched from agent config
 * directories to fall back to the checkout's canonical .env.
 */
export function envFileCandidates(cwd: string = process.cwd()): string[] {
  const cwdEnv = path.resolve(cwd, '.env');
  return cwdEnv === REPO_ROOT_ENV ? [cwdEnv] : [cwdEnv, REPO_ROOT_ENV];
}

let storeMismatchWarned = false;

function parseEnvFile(content: string, keys: Iterable<string>): Record<string, string> {
  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}

function resolvedStoreDir(rawStoreDir: string | undefined): string {
  if (!rawStoreDir) {
    return path.resolve(path.dirname(REPO_ROOT_ENV), 'store');
  }

  const expanded = rawStoreDir.startsWith('~/') || rawStoreDir === '~'
    ? path.join(os.homedir(), rawStoreDir.slice(1))
    : rawStoreDir;
  return path.resolve(expanded);
}

function comparablePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function warnIfStoreMismatch(
  chosenFile: string,
  chosenContent: string,
  cwdEnv: string,
): void {
  // A process-level override wins over both files, so neither file determines
  // the active store in that case.
  if (
    storeMismatchWarned ||
    chosenFile !== cwdEnv ||
    cwdEnv === REPO_ROOT_ENV ||
    process.env.CLAUDECLAW_STORE_DIR
  ) {
    return;
  }

  let rootContent: string;
  try {
    rootContent = fs.readFileSync(REPO_ROOT_ENV, 'utf-8');
  } catch {
    return;
  }

  const cwdStore = resolvedStoreDir(
    parseEnvFile(chosenContent, ['CLAUDECLAW_STORE_DIR']).CLAUDECLAW_STORE_DIR,
  );
  const rootStore = resolvedStoreDir(
    parseEnvFile(rootContent, ['CLAUDECLAW_STORE_DIR']).CLAUDECLAW_STORE_DIR,
  );
  if (comparablePath(cwdStore) === comparablePath(rootStore)) return;

  storeMismatchWarned = true;
  console.error(
    `[claudeclaw] Loaded .env from ${cwdEnv} (CLAUDECLAW_STORE_DIR=${cwdStore}). ` +
      `This binary's own .env at ${REPO_ROOT_ENV} would use ${rootStore}. ` +
      `You are operating on the cwd store, not the binary's.`,
  );
}

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  let content: string | undefined;
  let chosenFile: string | undefined;
  const candidates = envFileCandidates();
  for (const envFile of candidates) {
    try {
      content = fs.readFileSync(envFile, 'utf-8');
      chosenFile = envFile;
      break;
    } catch {
      // Missing or unreadable. Try the canonical checkout .env next.
    }
  }
  if (content === undefined || chosenFile === undefined) {
    return {};
  }

  warnIfStoreMismatch(chosenFile, content, candidates[0]);
  return parseEnvFile(content, keys);
}
