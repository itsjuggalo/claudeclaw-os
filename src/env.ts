import fs from 'fs';
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

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  let content: string | undefined;
  for (const envFile of envFileCandidates()) {
    try {
      content = fs.readFileSync(envFile, 'utf-8');
      break;
    } catch {
      // Missing or unreadable. Try the canonical checkout .env next.
    }
  }
  if (content === undefined) {
    return {};
  }

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
