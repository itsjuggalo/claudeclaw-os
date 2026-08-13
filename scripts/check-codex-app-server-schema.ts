#!/usr/bin/env tsx
/**
 * Schema drift check for the pinned Codex App Server protocol.
 *
 * Thin CLI: resolve the pinned launcher, regenerate the bindings, hand them to
 * `auditBindings()`, print, exit. Every assertion lives in
 * `src/agent-engine/codex-app-server-schema-audit.ts` — under `src/` so it is
 * typechecked and unit-tested (`codex-app-server-schema-audit.test.ts` proves it
 * fails on drift, including widened field types).
 *
 * Run: `npm run codex:schema-check`
 * A Codex dependency upgrade is blocked until this passes (RFC §"Protocol baseline
 * and versioning").
 *
 * Exit codes: 0 = the pinned schema still matches; 1 = drift, or the generator could
 * not run.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

import { auditBindings } from '../src/agent-engine/codex-app-server-schema-audit.js';

/**
 * Resolve the pinned launcher from OUR dependency graph.
 *
 * Deliberately re-derived here rather than imported from the client: importing it
 * would pull the runtime graph (logger → config → .env) into a check that must run
 * anywhere, including a clean CI box with no configuration. What we CONSUME is
 * imported from the protocol module, so the thing most likely to drift has a single
 * source of truth.
 */
function resolveLauncher(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve('@openai/codex/package.json')), 'bin', 'codex.js');
}

function pinnedVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(require.resolve('@openai/codex/package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? 'unknown';
}

function generateBindings(launcher: string, outDir: string): void {
  const result = spawnSync(
    process.execPath,
    [launcher, 'app-server', 'generate-ts', '--experimental', '--out', outDir],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`codex app-server generate-ts failed (status ${result.status ?? 'null'}): ${detail || 'no output'}`);
  }
}

function main(): number {
  const version = pinnedVersion();
  const launcher = resolveLauncher();

  // Test seam / offline mode: audit an already-generated bindings directory instead
  // of invoking the binary.
  const fixtureDir = process.env.CODEX_SCHEMA_FIXTURE_DIR;
  if (!fixtureDir && !fs.existsSync(launcher)) {
    console.error(`FATAL: pinned @openai/codex launcher not found at ${launcher}. Run npm install.`);
    return 1;
  }

  const outDir = fixtureDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-appserver-schema-'));
  let result;
  try {
    if (fixtureDir) {
      console.warn(`(using CODEX_SCHEMA_FIXTURE_DIR=${fixtureDir}; not generating from the binary)`);
    } else {
      generateBindings(launcher, outDir);
    }
    // Names may carry a `v2/` prefix: generate-ts writes the v2 thread/turn surface
    // into a subdirectory.
    result = auditBindings((typeName) => {
      const file = path.join(outDir, `${typeName}.ts`);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    });
  } catch (err) {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    // Never delete a caller-supplied fixture directory.
    if (!fixtureDir) fs.rmSync(outDir, { recursive: true, force: true });
  }

  console.log(`Codex App Server schema check — @openai/codex ${version}\n`);
  for (const check of result.checks) console.log(`  ok    ${check}`);
  if (result.failures.length === 0) {
    console.log(`\n${result.checks.length} checks passed. The pinned protocol surface is unchanged.`);
    return 0;
  }
  console.error(`\n${result.failures.length} DRIFT FAILURE(S):\n`);
  for (const failure of result.failures) console.error(`  ✗ ${failure}\n`);
  console.error(
    'The hand-written surface in src/agent-engine/codex-app-server-protocol.ts no longer\n'
    + 'matches the pinned binary. Update it (and the RFC handshake section) before\n'
    + 'shipping this Codex version — do not silence this check.',
  );
  return 1;
}

process.exit(main());
