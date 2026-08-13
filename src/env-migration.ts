import fs from 'fs';
import path from 'path';

export type QuoteClaudeclawConfigResult = 'missing' | 'unchanged' | 'updated';

function quoteWindowsConfigValue(value: string): string {
  if (value.includes("'")) return `"${value}"`;
  return `'${value}'`;
}

/**
 * Quote unquoted native-Windows CLAUDECLAW_CONFIG values so both ClaudeClaw's
 * dotenv reader and shells that source `.env` preserve every backslash.
 *
 * Already-quoted values and POSIX paths are intentionally left untouched.
 */
export function quoteWindowsClaudeclawConfig(
  envFile: string,
  backupSuffix = '.pre-v1.8.0.bak',
): QuoteClaudeclawConfigResult {
  if (!fs.existsSync(envFile)) return 'missing';

  const original = fs.readFileSync(envFile, 'utf8');
  const hadFinalNewline = original.endsWith('\n');
  let changed = false;

  const lines = original.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();

  const migrated = lines.map((line) => {
    if (/^\s*#/.test(line)) return line;

    const match = line.match(/^(\s*CLAUDECLAW_CONFIG\s*=\s*)(.*?)(\s*)$/);
    if (!match) return line;

    const [, prefix, rawValue, trailing] = match;
    const value = rawValue.trim();
    if (!value) return line;

    const quoted =
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'));
    if (quoted) return line;

    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
    if (!isWindowsAbsolute) return line;

    changed = true;
    return `${prefix}${quoteWindowsConfigValue(value)}${trailing}`;
  }).join('\n') + (hadFinalNewline ? '\n' : '');

  if (!changed) return 'unchanged';

  const backupPath = `${envFile}${backupSuffix}`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(envFile, backupPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backupPath, 0o600);
  }

  const tempPath = path.join(
    path.dirname(envFile),
    `.${path.basename(envFile)}.migrate-${process.pid}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, migrated, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, envFile);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  return 'updated';
}

