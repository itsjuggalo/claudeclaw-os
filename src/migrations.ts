import fs from 'fs';
import path from 'path';

import yaml from 'js-yaml';

interface VersionRegistry {
  migrations: Record<string, string[]>;
}

// Kept in sync with agent-config.ts DEFAULT_MAIN_DESCRIPTION. Duplicated (not
// imported) to keep this module — loaded early on every boot — free of the
// agent-config/config/provider import chain.
const DEFAULT_MAIN_DESCRIPTION = 'Primary ClaudeClaw bot';

export interface MainBackfillPaths {
  /** CLAUDECLAW_CONFIG — where agents/main/{agent.yaml,CLAUDE.md} live. */
  configDir: string;
  /** STORE_DIR — where the legacy store/main-config.json lives. */
  storeDir: string;
  /** PROJECT_ROOT — checked for a legacy agents/main/agent.yaml to fold forward. */
  projectRoot: string;
}

function readJsonSafe(p: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(p)) return {};
    return (JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Idempotent startup backfill that heals a pre-scaffolding install's `main`
 * layout into the standard per-agent shape (RFC "Agent Identity
 * Reconciliation" — Existing-user upgrade). For `main`:
 *
 *  - Synthesize agents/main/agent.yaml if absent (from a legacy
 *    PROJECT_ROOT/agents/main/agent.yaml, the legacy store/main-config.json,
 *    and defaults: name, description, telegram_bot_token_env, provider/model).
 *  - Fold the legacy main-config.json (provider/model + description) into the
 *    yaml, filling only ABSENT fields, then retire the json by renaming it to
 *    main-config.json.bak (never deleted).
 *  - Copy a legacy CLAUDECLAW_CONFIG/CLAUDE.md persona into
 *    agents/main/CLAUDE.md when the standard location is absent.
 *
 * NEVER overwrites a user-edited value: existing yaml fields are preserved, and
 * a malformed yaml is treated as "leave untouched" (its bad file is not
 * clobbered and the legacy json is kept so nothing is lost). Safe to run on
 * every boot; a second run is a no-op. Returns the list of changes made (for
 * logging / tests).
 */
export function backfillMainAgent(paths: MainBackfillPaths): { changed: string[] } {
  const { configDir, storeDir, projectRoot } = paths;
  const changed: string[] = [];

  const mainDir = path.join(configDir, 'agents', 'main');
  const yamlPath = path.join(mainDir, 'agent.yaml');
  const jsonPath = path.join(storeDir, 'main-config.json');

  const json = readJsonSafe(jsonPath);

  // Load the yaml if it exists (never discard user edits); a parse error means
  // "treat as missing for fallback, but leave the bad file untouched".
  const yamlExisted = fs.existsSync(yamlPath);
  let yamlObj: Record<string, unknown> | null = null;
  let malformed = false;
  if (yamlExisted) {
    try {
      yamlObj = (yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>) ?? {};
    } catch {
      malformed = true;
    }
  } else {
    // Synthesize — prefer a legacy PROJECT_ROOT/agents/main/agent.yaml.
    const legacyRoot = path.join(projectRoot, 'agents', 'main', 'agent.yaml');
    if (fs.existsSync(legacyRoot)) {
      try {
        yamlObj = (yaml.load(fs.readFileSync(legacyRoot, 'utf-8')) as Record<string, unknown>) ?? {};
      } catch {
        yamlObj = {};
      }
    } else {
      yamlObj = {};
    }
  }

  if (!malformed && yamlObj) {
    let mutated = !yamlExisted; // a freshly-synthesized file is always written
    const isBlank = (v: unknown) => v === undefined || (typeof v === 'string' && !v.trim());
    const fill = (key: string, val: unknown) => {
      if (val === undefined) return;
      if (isBlank(yamlObj![key])) { yamlObj![key] = val; mutated = true; }
    };

    fill('name', typeof json.name === 'string' && json.name.trim() ? json.name.trim() : undefined);
    if (isBlank(yamlObj.name)) { yamlObj.name = 'Main'; mutated = true; }
    fill('description', typeof json.description === 'string' && json.description.trim() ? json.description.trim() : undefined);
    if (isBlank(yamlObj.description)) { yamlObj.description = DEFAULT_MAIN_DESCRIPTION; mutated = true; }
    fill('telegram_bot_token_env', 'TELEGRAM_BOT_TOKEN');
    // provider/model — only when the yaml doesn't already carry a provider.
    if (yamlObj.provider === undefined) {
      if (json.provider !== undefined) { yamlObj.provider = json.provider; mutated = true; }
      else if (typeof json.model === 'string') { yamlObj.provider = { type: 'claude', model: json.model }; mutated = true; }
    }

    if (mutated) {
      fs.mkdirSync(mainDir, { recursive: true });
      fs.writeFileSync(yamlPath, yaml.dump(yamlObj, { lineWidth: -1 }), 'utf-8');
      changed.push(yamlExisted ? 'updated agents/main/agent.yaml' : 'created agents/main/agent.yaml');
    }
  }

  // Retire main-config.json once its data has been folded in. Skip while the
  // yaml is malformed so the legacy source isn't lost with no valid target.
  if (fs.existsSync(jsonPath) && !malformed) {
    const bak = jsonPath + '.bak';
    try {
      if (fs.existsSync(bak)) fs.rmSync(bak);
      fs.renameSync(jsonPath, bak);
      changed.push('retired main-config.json -> main-config.json.bak');
    } catch {
      // Leave the json in place if the rename fails (read-only fs, etc.).
    }
  }

  // Copy a legacy persona into the standard location if absent, then retire
  // the original to .bak — symmetric with main-config.json above — so the
  // parent-config CLAUDE.md can't linger as a live duplicate the runtime no
  // longer reads (a stale-edit trap). The .bak preserves it; nothing is lost.
  const mainClaude = path.join(mainDir, 'CLAUDE.md');
  const legacyPersona = path.join(configDir, 'CLAUDE.md');
  if (!fs.existsSync(mainClaude) && fs.existsSync(legacyPersona)) {
    try {
      fs.mkdirSync(mainDir, { recursive: true });
      fs.copyFileSync(legacyPersona, mainClaude);
      changed.push('copied legacy persona -> agents/main/CLAUDE.md');
      const personaBak = legacyPersona + '.bak';
      if (!fs.existsSync(personaBak)) {
        fs.renameSync(legacyPersona, personaBak);
        changed.push('retired legacy CLAUDE.md -> CLAUDE.md.bak');
      }
    } catch {
      // Non-fatal — persona load has its own legacy fallback.
    }
  }

  return { changed };
}

interface AppliedState {
  lastApplied: string | null;
}

function parseSemver(v: string): [number, number, number] {
  const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: ${v}`);
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

export function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

export function checkPendingMigrations(projectRoot: string): void {
  const migrationsDir = path.join(projectRoot, 'migrations');
  const versionFile = path.join(migrationsDir, 'version.json');
  const appliedFile = path.join(migrationsDir, '.applied.json');
  const storeDir = path.join(projectRoot, 'store');

  // version.json ABSENT -> nothing to verify yet (legitimate skip).
  // version.json PRESENT but unreadable/corrupt -> fail CLOSED: refuse to start
  // rather than silently disabling the guard against a possibly unmigrated store.
  let registry: VersionRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error(
      `\n⚠️  ClaudeClaw cannot verify migrations: migrations/version.json is present but unreadable or not valid JSON.\n` +
        `    Refusing to start to avoid running against an unmigrated store. Fix or restore the file, then restart.\n`,
    );
    process.exit(1);
    return;
  }

  const versions = Object.keys(registry.migrations).sort(compareSemver);
  if (versions.length === 0) return;

  const latest = versions[versions.length - 1];

  let lastApplied: string | null = null;
  if (fs.existsSync(appliedFile)) {
    try {
      const state: AppliedState = JSON.parse(fs.readFileSync(appliedFile, 'utf-8'));
      lastApplied = state.lastApplied;
    } catch {
      // .applied.json present but unreadable/corrupt: fail CLOSED as well.
      console.error(
        `\n⚠️  ClaudeClaw cannot verify migrations: migrations/.applied.json is present but unreadable or not valid JSON.\n` +
          `    Refusing to start to avoid running against an unmigrated store. Fix or restore the file, then restart.\n`,
      );
      process.exit(1);
      return;
    }
  } else if (!fs.existsSync(storeDir)) {
    // Fresh clone — store/ hasn't been created yet, so the bot has never run.
    // Write .applied.json now so subsequent starts (after store/ is created) don't
    // mistake this for a pre-migration install.
    fs.writeFileSync(appliedFile, JSON.stringify({ lastApplied: latest }, null, 2) + '\n');
    return;
  }
  // If .applied.json is absent but store/ exists, this is a pre-migration install.
  // Fall through with lastApplied = null so the guard fires.

  const hasPending =
    lastApplied === null || compareSemver(lastApplied, latest) < 0;

  if (hasPending) {
    console.error(
      `\n⚠️  ClaudeClaw has pending migrations (applied: ${lastApplied ?? 'none'}, latest: ${latest}).\n` +
        `    Run \`npm run migrate\` to update, then restart.\n`,
    );
    process.exit(1);
  }
}
