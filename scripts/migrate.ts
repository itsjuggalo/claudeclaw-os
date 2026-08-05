#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'migrations');
const VERSION_FILE = path.join(MIGRATIONS_DIR, 'version.json');
const APPLIED_FILE = path.join(MIGRATIONS_DIR, '.applied.json');
const STORE_DIR = path.join(PROJECT_ROOT, 'store');

interface VersionRegistry {
  migrations: Record<string, string[]>;
}

interface AppliedState {
  lastApplied: string | null;
}

interface MigrationModule {
  description: string;
  run: () => Promise<void>;
}

interface PathWarning {
  line: number;
  text: string;
}

function parseSemver(v: string): [number, number, number] {
  const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: ${v}`);
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

const PATH_SCAN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\/(?:etc|var|usr|tmp|home|Users)\b/, label: 'common out-of-repo root' },
  { pattern: /(?:^|[\s=,(["'`])\/[A-Za-z]/, label: 'absolute path' },
  { pattern: /~\//, label: 'home-relative path' },
  { pattern: /[A-Za-z]:\\/, label: 'Windows absolute path' },
  { pattern: /(?:\.\.\/){2,}/, label: 'parent traversal (2+ levels)' },
  { pattern: /process\.chdir\s*\(/, label: 'process.chdir()' },
  { pattern: /os\.homedir\s*\(\)/, label: 'os.homedir()' },
  { pattern: /os\.tmpdir\s*\(\)/, label: 'os.tmpdir()' },
  { pattern: /__dirname/, label: '__dirname' },
];

function scanForPathWarnings(filePath: string): PathWarning[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const warnings: PathWarning[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern } of PATH_SCAN_PATTERNS) {
      if (pattern.test(line)) {
        warnings.push({ line: i + 1, text: line.trim() });
        break;
      }
    }
  }
  return warnings;
}

// Non-interactive mode for installers and CI. Approves the apply prompt without
// reading stdin at all; every other decision point that would have asked a human
// becomes a hard failure rather than a silent assumption.
const ASSUME_YES = process.argv.slice(2).some((a) => a === '--yes' || a === '-y');

function isAffirmative(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    // Guard against stdin already being at EOF — the case a piped `printf 'y\n'`
    // creates for every prompt after the first. readline never invokes the
    // question callback then, so without this the promise never settles, the
    // event loop drains, and node exits 0. That reads to the caller as a
    // successful migration when nothing ran at all. Resolving empty routes EOF
    // into the same branch as an explicit "no": abort rather than assume.
    rl.on('close', () => {
      if (!answered) resolve('');
    });
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(VERSION_FILE)) {
    console.error('migrations/version.json not found.');
    process.exit(1);
  }

  const registry: VersionRegistry = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));

  const allVersions = Object.keys(registry.migrations).sort(compareSemver);
  const latest = allVersions[allVersions.length - 1];

  let lastApplied: string | null = null;
  if (fs.existsSync(APPLIED_FILE)) {
    const state: AppliedState = JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf-8'));
    lastApplied = state.lastApplied;
  } else if (!fs.existsSync(STORE_DIR)) {
    // Fresh clone — store/ has never been created, bot has never run.
    // Auto-initialise .applied.json to the latest version; nothing to migrate.
    if (latest) {
      fs.writeFileSync(APPLIED_FILE, JSON.stringify({ lastApplied: latest }, null, 2) + '\n');
    }
    console.log(`Fresh install detected. Initialised migrations at ${latest ?? 'none'}.`);
    process.exit(0);
  }
  // If .applied.json is absent but store/ exists, this is a pre-migration install.
  // Fall through with lastApplied = null so all migrations are treated as pending.
  const pendingVersions =
    lastApplied === null
      ? allVersions
      : allVersions.filter((v) => compareSemver(v, lastApplied!) > 0);

  if (pendingVersions.length === 0) {
    console.log(`No pending migrations (current: ${lastApplied ?? 'none'}).`);
    process.exit(0);
  }

  // Load descriptions and scan for path warnings up front
  interface MigrationInfo {
    version: string;
    filename: string;
    description: string;
    warnings: PathWarning[];
  }

  const migrationInfos: MigrationInfo[] = [];
  let hasWarnings = false;

  for (const version of pendingVersions) {
    const filenames = registry.migrations[version];
    for (const filename of filenames) {
      const filePath = path.join(MIGRATIONS_DIR, version, `${filename}.ts`);
      if (!fs.existsSync(filePath)) {
        console.error(`Migration file not found: ${filePath}`);
        process.exit(1);
      }

      let description = '(no description)';
      try {
        const mod = (await import(pathToFileURL(filePath).href)) as MigrationModule;
        description = mod.description ?? description;
      } catch (e) {
        console.error(`Failed to load migration ${filePath}: ${e}`);
        process.exit(1);
      }

      const warnings = scanForPathWarnings(filePath);
      if (warnings.length > 0) hasWarnings = true;

      migrationInfos.push({ version, filename, description, warnings });
    }
  }

  // Print dry-run summary
  const totalMigrations = migrationInfos.length;
  console.log(
    `\nPending migrations (current: ${lastApplied ?? 'none'} → latest: ${latest}):\n`,
  );

  let currentVersionHeader = '';
  for (const { version, filename, description, warnings } of migrationInfos) {
    if (version !== currentVersionHeader) {
      console.log(`  ${version}:`);
      currentVersionHeader = version;
    }
    console.log(`    • ${description} (${filename})`);
    if (warnings.length > 0) {
      console.log(`      ⚠️  Possible out-of-repo path access detected:`);
      for (const w of warnings) {
        console.log(`          line ${w.line}: ${w.text}`);
      }
      console.log(`          Inspect migrations/${version}/${filename}.ts before proceeding.`);
    }
  }

  console.log('');
  if (hasWarnings) {
    console.log(`⚠️  Review each migration and check your project before proceeding.`);
    console.log(`    Inspect migrations/<version>/<name>.ts if unsure.\n`);
  }

  const versionWord = pendingVersions.length === 1 ? 'version' : 'versions';
  const migrationWord = totalMigrations === 1 ? 'migration' : 'migrations';
  const applyQuestion = `Apply ${pendingVersions.length} ${versionWord} (${totalMigrations} ${migrationWord})? [y/N] `;

  if (ASSUME_YES) {
    console.log(`${applyQuestion}y  (--yes)`);
  } else {
    const answer = await prompt(applyQuestion);
    if (!isAffirmative(answer)) {
      console.log('Migration cancelled.');
      process.exit(0);
    }
  }

  // Pre-migration backup. A migration that crashes mid-run leaves a
  // half-applied schema; without a backup the operator's only recovery
  // path is restoring from whatever stale dump they happen to have.
  // Snapshot store/claudeclaw.db to store/claudeclaw.db.pre-{version}.bak
  // with chmod 0600 (it's plaintext from the encrypted DB's POV but the
  // file itself is still secret). Rotation keeps the last 3 backups so
  // disk doesn't grow unbounded.
  const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
  if (fs.existsSync(dbPath)) {
    const targetVersion = pendingVersions[0] ?? 'unknown';
    const backupPath = path.join(STORE_DIR, `claudeclaw.db.pre-${targetVersion}.bak`);
    try {
      fs.copyFileSync(dbPath, backupPath);
      fs.chmodSync(backupPath, 0o600);
      // Also copy the WAL file if present so the backup represents a
      // consistent snapshot of recent writes.
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, `${backupPath}-wal`);
        fs.chmodSync(`${backupPath}-wal`, 0o600);
      }
      console.log(`Pre-migration backup → ${path.relative(PROJECT_ROOT, backupPath)} (chmod 0600)`);
    } catch (e) {
      console.log(`⚠️  Could not create pre-migration backup: ${e instanceof Error ? e.message : e}`);
      // Unattended runs must never migrate data they could not snapshot first:
      // there would be no recovery path if a migration then failed half-way.
      // Fail loudly so the installer stops here instead of reporting success and
      // starting a service that trips the pending-migration guard.
      if (ASSUME_YES) {
        console.error('Refusing to migrate without a backup in --yes mode. Aborting.');
        console.error('Free up disk space or fix store/ permissions, then re-run.');
        process.exit(1);
      }
      const ok = await prompt('Proceed without backup? [y/N] ');
      if (!isAffirmative(ok)) {
        console.log('Aborting.');
        process.exit(1);
      }
    }
    // Rotation: keep the 3 most recent .bak files, remove older.
    try {
      const baks = fs.readdirSync(STORE_DIR)
        .filter((f) => f.startsWith('claudeclaw.db.pre-') && f.endsWith('.bak'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(STORE_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of baks.slice(3)) {
        fs.rmSync(path.join(STORE_DIR, old.f), { force: true });
        fs.rmSync(path.join(STORE_DIR, `${old.f}-wal`), { force: true });
      }
    } catch { /* rotation failure is non-fatal */ }
  }

  // Run migrations in order
  for (const version of pendingVersions) {
    const filenames = registry.migrations[version];
    for (const filename of filenames) {
      const filePath = path.join(MIGRATIONS_DIR, version, `${filename}.ts`);
      console.log(`[ ${filename} ] running...`);
      try {
        const mod = (await import(pathToFileURL(filePath).href)) as MigrationModule;
        await mod.run();
        console.log(`[ ${filename} ] ✓`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[ ${filename} ] ✗  ${msg}`);
        console.log('\nMigration failed. To recover:');
        console.log('  1. Investigate the error above and identify the root cause.');
        console.log('  2. Restore the pre-migration backup if needed:');
        console.log(`       cp store/claudeclaw.db.pre-*.bak store/claudeclaw.db`);
        console.log('  3. Reset your working directory to a clean state:');
        console.log('       git reset --hard && git clean -fd');
        console.log('  4. Apply the necessary fix (to the migration script or your environment).');
        console.log('  5. Run `npm run migrate` again.');
        process.exit(1);
      }
    }

    // Write lastApplied after each version fully succeeds
    const state: AppliedState = { lastApplied: version };
    fs.writeFileSync(APPLIED_FILE, JSON.stringify(state, null, 2) + '\n');
  }

  const finalVersion = pendingVersions[pendingVersions.length - 1];

  // Postcondition: re-read the state we just wrote and confirm it actually
  // records the version we believe we applied. Any future path that exits this
  // function without migrating — or that fails to persist .applied.json — turns
  // into a non-zero exit here rather than a false "success" the installer
  // faithfully reports before starting a service that cannot boot.
  let recorded: string | null = null;
  try {
    const state: AppliedState = JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf-8'));
    recorded = state.lastApplied;
  } catch (e) {
    console.error(`\nPostcondition failed: could not read ${APPLIED_FILE}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  if (recorded !== finalVersion) {
    console.error(
      `\nPostcondition failed: expected migrations recorded at ${finalVersion}, found ${recorded ?? 'none'}.`,
    );
    console.error('The database may be partially migrated. Do not start the service; investigate first.');
    process.exit(1);
  }

  console.log(`\nMigration complete. Applied: ${lastApplied ?? 'none'} → ${finalVersion}`);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
