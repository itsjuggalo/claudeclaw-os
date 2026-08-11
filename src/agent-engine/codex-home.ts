import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from '../logger.js';

/**
 * The isolated `CODEX_HOME` and its authentication state, shared by both Codex engines.
 *
 * Extracted because the two paths had drifted on exactly the thing they must agree about.
 * The SDK adapter created the isolated home AND prepared its credentials; the App Server
 * adapter created the home and stopped there — so a subscription-mode App Server turn
 * could start without the operator's current login, and an API-key turn could keep reading
 * a subscription credential copied in by an earlier one.
 *
 * The split between DETECT and APPLY is the other half of the reason this is its own
 * module. The App Server path holds one warm child per process, so mutating the shared home
 * while that child is alive would change the credentials underneath running turns. Detection
 * is therefore read-only and produces a non-secret identity for the launch fingerprint;
 * the mutation happens later, once the outgoing child has exited and before the replacement
 * starts. The SDK path spawns per turn and simply runs the two back to back.
 *
 * ## Pinned 0.144.6 credential storage
 *
 * The binary exposes `auth_credentials_store_mode` over `AutoAuthStorage` /
 * `keyring_storage` / `file_storage`, and in the Auto default it reads the OS keyring
 * FIRST — "failed to load CLI auth from keyring, falling back to file storage" — before
 * `<CODEX_HOME>/auth.json`. Keyring entries are keyed by the service name `Codex Auth`, not
 * by `CODEX_HOME`, so a keyring-backed login already reaches an isolated home with nothing
 * copied. That is why a missing `auth.json` is NOT an error here: see `detectCodexAuth`.
 */

/**
 * A credential could not be prepared, so the turn must not run.
 *
 * Its own class because these messages are already the right advice — "the login at X could
 * not be read (EACCES)", "fix the permissions on that file". Both adapters wrap generic
 * failures in guidance of their own ("run `codex login`", "check that directory is
 * writable"), and applying that to a permissions problem points the operator at the wrong
 * thing entirely. This type is what lets them pass the message through untouched.
 */
export class CodexAuthPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexAuthPreparationError';
  }
}

/** How the isolated home will be authenticated — limited to what can be observed. */
export type CodexAuthMode =
  /** OPENAI_API_KEY is in force. Any file credential is REMOVED before launch. */
  | 'api-key'
  /** A file-backed operator login exists and is mirrored into the isolated home. */
  | 'file'
  /**
   * Neither. The child must authenticate through the platform credential store, or fail
   * its handshake. Nothing is copied and any stale file is removed.
   */
  | 'delegated';

export interface CodexAuthPlan {
  mode: CodexAuthMode;
  /** The isolated `auth.json` this plan governs. */
  dest: string;
  /** The operator credential to mirror. Null unless `mode` is 'file'. */
  source: string | null;
  /**
   * SHA-256 of the operator credential, or '' when there is none.
   *
   * The OPERATOR's file, deliberately, and not the copy in the isolated home. Codex writes
   * refreshed tokens back to `<CODEX_HOME>/auth.json`, so digesting our copy would make
   * every routine token refresh look like a credential rotation and drain every turn in
   * flight to apply it. The source only changes when the operator's LOGIN does, which is
   * exactly the event that needs a new child.
   */
  digest: string;
  /**
   * Exactly what apply() will do to the isolated home, decided here and not re-derived
   * later. 'none' covers both nothing-to-do and the case where the isolated copy is NEWER
   * than the source: it holds tokens refreshed from the same login, and overwriting them
   * with the older file would throw away a live session.
   */
  action: 'copy' | 'remove' | 'none';
  /**
   * Non-secret identity for the launch fingerprint. Mode plus digest, so a rotated login,
   * a switch between API-key and subscription auth, and a logout are each a different
   * launch environment. Safe to log; contains no credential material.
   */
  identity: string;
}

/** Where the OPERATOR's Codex credentials live — never where the child's do. */
export function operatorCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
}

/**
 * Ensure and return the canonical isolated `CODEX_HOME`.
 *
 * The point is that the Codex child must NOT load the operator's global
 * `~/.codex/config.toml`, whose MCP servers and sandbox/network settings would otherwise
 * bleed into every turn past ClaudeClaw's own allowlist and policy. The isolated home has
 * no `config.toml` at all — absence means defaults, and ClaudeClaw supplies its own
 * settings per thread — so nothing from the user config is inherited.
 *
 * It must also live OUTSIDE every writable root. Canonicalized before the comparison so a
 * symlinked `configDir` cannot smuggle the home back inside the workspace: if it resolved
 * inside one, a workspace-write turn could plant a `config.toml` in the "isolated" home and
 * defeat the boundary on a later turn.
 *
 * Throws on either failure, and the caller must fail the turn CLOSED rather than fall back
 * to the operator's real home. Returns the CANONICAL path, which the App Server policy
 * verifier compares against and cannot resolve itself.
 */
export function ensureIsolatedCodexHome(configDir: string, projectRoot: string, cwd: string): string {
  const home = path.join(configDir, 'codex-home');
  // Restrictive from creation: this directory holds a mirrored credential. Advisory on
  // Windows, where the mode is largely ignored and the inherited ACL governs instead.
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const homeReal = canonicalize(home);
  const isInside = (root: string): boolean => {
    const rel = path.relative(canonicalize(root), homeReal);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (isInside(projectRoot) || isInside(cwd)) {
    // A plain Error, NOT CodexAuthPreparationError: this is an isolation failure, and each
    // adapter's own "could not set up the isolated Codex config directory" guidance is
    // exactly the right advice for it.
    throw new Error(
      `Isolated CODEX_HOME (${homeReal}) resolves inside a writable root; set CLAUDECLAW_CONFIG to a path `
      + 'outside the project (e.g. ~/.claudeclaw).',
    );
  }
  return homeReal;
}

/**
 * Work out — WITHOUT touching anything — what the isolated home's credentials should be.
 *
 * Read-only by contract. The App Server path calls this before it asks for a manager, so
 * the answer can enter the launch fingerprint and decide whether a rotation is needed; the
 * mutation cannot happen until that rotation has drained the old turns and seen the old
 * child exit. Detecting and mutating in one step is precisely how credentials get swapped
 * out from under a running turn.
 *
 * A missing `auth.json` is NOT a failure. Under the pinned Auto storage mode the child
 * reads the OS keyring first, and keyring entries are keyed by service rather than by
 * `CODEX_HOME`, so a keyring-backed login authenticates an isolated home with nothing
 * copied. Treating absence as an error would refuse turns that are perfectly able to run.
 */
export function detectCodexAuth(home: string, hasApiKey: boolean): CodexAuthPlan {
  const dest = path.join(home, 'auth.json');

  if (hasApiKey) {
    // API-key mode must not leave a previously-mirrored subscription credential readable in
    // the isolated home — that is the very credential this mode exists to avoid exposing.
    return {
      mode: 'api-key',
      dest,
      source: null,
      digest: '',
      action: credentialFileExists(dest) ? 'remove' : 'none',
      identity: 'api-key:',
    };
  }

  const source = path.join(operatorCodexHome(), 'auth.json');

  // An operator who exports CODEX_HOME at the isolated home has made it their real home:
  // there is nothing to mirror, copying a file onto itself would truncate it, and removing
  // it would be deleting their own login. Its own contents are the identity — which does
  // mean a token the child refreshes counts as a rotation in this configuration, the one
  // case where that cannot be avoided.
  if (path.resolve(source) === path.resolve(dest)) {
    // Digested ONCE and reused for both fields. Reading it twice left a window in which the
    // file could change between the two, publishing a `digest` and an `identity` that
    // disagreed about which credential the home holds.
    const digest = credentialFileExists(dest) ? digestOfFile(dest) : '';
    return {
      mode: digest ? 'file' : 'delegated',
      dest,
      source: null,
      digest,
      action: 'none',
      identity: digest ? `file:${digest}` : 'delegated:',
    };
  }

  if (!credentialFileExists(source)) {
    // No API key and no file-backed login. Under the pinned Auto storage mode the child
    // will read the OS keyring, so this is a normal state and not an error. Any credential
    // WE mirrored earlier is removed: the operator's file login is gone, so keeping a copy
    // would authenticate as something they may have revoked.
    return {
      mode: 'delegated',
      dest,
      source: null,
      digest: '',
      action: credentialFileExists(dest) ? 'remove' : 'none',
      identity: 'delegated:',
    };
  }

  const digest = digestOfFile(source);
  // mtime-guarded: a fresh `codex login` rewrites the source and propagates, while tokens
  // the child refreshed into its own copy are left alone.
  const stale = !credentialFileExists(dest) || fs.statSync(source).mtimeMs > fs.statSync(dest).mtimeMs;
  return { mode: 'file', dest, source, digest, action: stale ? 'copy' : 'none', identity: `file:${digest}` };
}

/**
 * Bring the isolated home into the state `plan` describes.
 *
 * Fails CLOSED, unlike the warn-and-continue this replaces. A failed removal in API-key
 * mode leaves the turn reading the subscription credential the mode exists to keep away
 * from it, and a failed copy leaves the child to fail its handshake with a far less
 * actionable message — so both raise, and the caller refuses the turn.
 *
 * Nothing here logs or embeds a token, a file's contents, or a digest of a live credential:
 * messages carry paths and byte counts only.
 */
export function applyCodexAuth(plan: CodexAuthPlan): void {
  if (plan.action === 'none') return;

  if (plan.action === 'remove') {
    try {
      fs.rmSync(plan.dest, { force: true });
    } catch (err) {
      throw new CodexAuthPreparationError(
        `Could not remove the stale Codex credential at ${plan.dest} (${reason(err)}). `
        + 'ClaudeClaw will not start a Codex turn that could still read it; fix the permissions on that file, '
        + 'then retry.',
      );
    }
    logger.info({ authMode: plan.mode }, 'codex_auth_stale_credential_removed');
    return;
  }

  // 'copy'. `source` is non-null for this action by construction, but the check keeps the
  // narrowing honest rather than asserting it.
  if (!plan.source) throw new CodexAuthPreparationError('codex auth plan asked for a copy with no source');
  let contents: Buffer;
  try {
    contents = fs.readFileSync(plan.source);
  } catch (err) {
    throw new CodexAuthPreparationError(
      `Could not read the Codex login at ${plan.source} (${reason(err)}). `
      + 'Run `codex login` on the host, or set OPENAI_API_KEY, then retry.',
    );
  }
  // The plan's digest is already in the published launch fingerprint. If the operator logged
  // in again between detection and here, writing the new credential would leave the manager
  // claiming an auth state its home does not hold — so refuse, and let the next invocation
  // detect the new login and rotate to it properly.
  if (crypto.createHash('sha256').update(contents).digest('hex') !== plan.digest) {
    throw new CodexAuthPreparationError(
      'The Codex login changed while ClaudeClaw was preparing its App Server; send the message again to '
      + 'pick up the new credentials.',
    );
  }
  writeAtomically(plan.dest, contents);
  logger.info({ authMode: plan.mode, bytes: contents.byteLength }, 'codex_auth_mirrored');
}

/**
 * Replace `dest` in one step, via a temp file in the same directory.
 *
 * A partial credential file is worse than none: the child would read it, fail to parse it,
 * and report an authentication problem that looks nothing like the truncated write that
 * caused it. `rename` within a directory is atomic, so a reader sees either the old file or
 * the whole new one. The temp name carries the pid so two ClaudeClaw processes sharing a
 * config directory cannot land on the same one.
 */
function writeAtomically(dest: string, contents: Buffer): void {
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    // Owner-only, set at creation rather than chmod'd afterwards so the credential is never
    // briefly world-readable. Advisory on Windows.
    fs.writeFileSync(tmp, contents, { mode: 0o600 });
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing better to do */ }
    throw new CodexAuthPreparationError(
      `Could not install the Codex credential at ${dest} (${reason(err)}). `
      + `Check that ${path.dirname(dest)} is writable, then retry.`,
    );
  }
}

/**
 * SHA-256 of a credential file.
 *
 * Reached only for a path that has just been stat'd as a file, so a failure here means it
 * is unreadable rather than absent — a permissions problem worth naming, not a reason to
 * silently treat the operator as logged out.
 */
function digestOfFile(file: string): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (err) {
    throw new CodexAuthPreparationError(
      `Could not read the Codex credential at ${file} (${reason(err)}). `
      + 'ClaudeClaw cannot tell which credentials a turn would run under; fix the permissions on that file, '
      + 'or set OPENAI_API_KEY, then retry.',
    );
  }
}

/**
 * Whether a credential file is there — distinguishing ABSENT from UNREADABLE.
 *
 * Swallowing every `statSync` failure as "absent" is a fail-OPEN bug, and the API-key path
 * is where it bites hardest: a mirrored subscription credential we cannot stat because of an
 * EACCES turns into `action: 'none'`, the removal silently becomes a no-op, and the turn runs
 * with exactly the credential that mode exists to keep away from it. A missing file and a
 * file we are not allowed to look at are entirely different facts and must not collapse.
 *
 * Absent means ENOENT, or ENOTDIR for a path whose parent is not a directory — in both cases
 * the file provably is not there. A path that exists but is not a regular file (a directory
 * named `auth.json`) also reads as absent: there is no credential to mirror or remove, and
 * nothing can be leaked by saying so. Everything else — EACCES, EPERM, EIO, ELOOP — throws.
 */
function credentialFileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw new CodexAuthPreparationError(
      `Could not determine whether a Codex credential exists at ${file} (${reason(err)}). `
      + 'ClaudeClaw will not start a Codex turn without knowing which credentials it would run under; '
      + 'fix the permissions on that path, then retry.',
    );
  }
}

function canonicalize(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

/**
 * The reportable cause of a failure, with no way for it to carry file contents.
 *
 * An errno (`EACCES`, `EPERM`, `ENOENT`) is what actually helps here, and Node's fs errors
 * carry a code plus a path and nothing else. The error's own MESSAGE is deliberately never
 * used: every call site in this module is handling a file whose contents are a credential,
 * and a message from anywhere other than Node's fs layer could quote them. A class name is
 * enough to tell "not an fs error" from a code, and it cannot leak a token to do it.
 */
function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string' && code) return code;
  return err instanceof Error ? err.name : 'unknown error';
}
