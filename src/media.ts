import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory where all Telegram media is saved
export const UPLOADS_DIR = path.resolve(__dirname, '..', 'workspace', 'uploads');

// Ensure uploads dir exists on module load
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/**
 * Make an HTTPS GET request and return the response body as a string.
 */
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Download a file via HTTPS and save it to disk.
 */
function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsDownload(res.headers.location, dest).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }

      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', (err) => {
        fs.unlink(dest, () => { /* ignore cleanup error */ });
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Sanitize a filename: replace non-alphanumeric chars (except . and -) with _.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-]/g, '_');
}

/**
 * Download a file from Telegram and save it to workspace/uploads/.
 * Returns the local file path.
 *
 * Steps:
 * 1. GET https://api.telegram.org/bot{TOKEN}/getFile?file_id={fileId}
 *    -> response: { ok: true, result: { file_path: "photos/file_123.jpg" } }
 * 2. Download from https://api.telegram.org/file/bot{TOKEN}/{file_path}
 * 3. Save to UPLOADS_DIR/{timestamp}_{sanitized_filename}
 * 4. Return the local path
 */
export async function downloadMedia(
  botToken: string,
  fileId: string,
  originalFilename?: string,
): Promise<string> {
  // Step 1: Get the file path from Telegram
  const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const responseBody = await httpsGet(getFileUrl);
  const parsed = JSON.parse(responseBody) as { ok: boolean; result?: { file_path?: string } };

  if (!parsed.ok || !parsed.result?.file_path) {
    throw new Error(`Telegram getFile failed for file_id=${fileId}: ${responseBody}`);
  }

  const telegramFilePath = parsed.result.file_path;

  // Determine the local filename
  let filename: string;
  if (originalFilename) {
    filename = sanitizeFilename(originalFilename);
  } else {
    // Infer from the Telegram file_path (e.g. "photos/file_123.jpg" -> "file_123.jpg")
    const basename = path.basename(telegramFilePath);
    filename = sanitizeFilename(basename);
  }

  const localFilename = `${Date.now()}_${filename}`;
  const localPath = path.join(UPLOADS_DIR, localFilename);

  // Step 2: Download the file
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${telegramFilePath}`;
  await httpsDownload(downloadUrl, localPath);

  return localPath;
}

/**
 * Build the message text to send to Claude when a photo is received.
 * Claude Code's Read tool can open image files -- just give it the path.
 */
export function buildPhotoMessage(localPath: string, caption?: string): string {
  let msg = `Photo received. File saved at: ${localPath}`;
  if (caption) {
    msg += `\nCaption: "${caption}"`;
  }
  msg += '\nPlease analyze this image.';
  return msg;
}

/**
 * Build the message text to send to Claude when a document is received.
 */
export function buildDocumentMessage(localPath: string, filename: string, caption?: string): string {
  let msg = `Document received: ${filename}\nFile saved at: ${localPath}`;
  if (caption) {
    msg += `\nCaption: "${caption}"`;
  }
  msg += '\nPlease read and process this file.';
  return msg;
}

/**
 * Build the message for a Telegram album (media group): several files sent
 * together with one caption. Lists every saved path so the agent reads them all
 * in a single turn, and tells it to treat them as one set.
 *
 * NOTE: photos and documents only. Videos in an album are NOT grouped — each
 * still routes through buildVideoMessage as its own turn (known limitation).
 */
export function buildMediaGroupMessage(items: Array<{ path: string; label?: string }>, caption?: string): string {
  const n = items.length;
  let msg = `${n} files received together (one album). Saved at:\n` +
    items.map((it, i) => `  ${i + 1}. ${it.label ? it.label + ': ' : ''}${it.path}`).join('\n');
  if (caption) {
    msg += `\nCaption: "${caption}"`;
  }
  msg += `\nPlease consider ALL ${n} files together as one set when answering.`;
  return msg;
}

export interface MediaGroupItem { path: string; label?: string }

export interface MediaGroupBufferDeps {
  /** Debounce window in ms (default 1400). Measured from the last item ARRIVAL. */
  debounceMs?: number;
  /** Called once per group after the debounce settles and downloads resolve. */
  onFlush: (key: string, items: MediaGroupItem[], caption: string | undefined) => void;
  /** Injectable for tests. Defaults to global setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

/**
 * Buffers Telegram album items that share a media_group_id and flushes them as
 * one set once no new item has arrived for `debounceMs`.
 *
 * Key design point (fixes the large-file split): membership is registered at
 * message ARRIVAL via add(), which resets the debounce timer immediately. The
 * actual download is passed in as a promise and awaited only at flush time, so
 * a slow sequential download can never push the next item past the debounce
 * window and split one album into multiple turns. Items whose download rejects
 * are dropped; a group that ends up empty is not flushed.
 */
export function createMediaGroupBuffer(deps: MediaGroupBufferDeps) {
  const debounceMs = deps.debounceMs ?? 1400;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  interface Group {
    pending: Array<Promise<MediaGroupItem>>;
    caption?: string;
    timer?: ReturnType<typeof setTimeout>;
  }
  const groups = new Map<string, Group>();

  function add(key: string, item: Promise<MediaGroupItem>, caption?: string): void {
    let g = groups.get(key);
    if (!g) { g = { pending: [] }; groups.set(key, g); }
    g.pending.push(item);
    if (caption && !g.caption) g.caption = caption;
    if (g.timer) clearTimer(g.timer);
    g.timer = setTimer(() => { void flush(key); }, debounceMs);
  }

  async function flush(key: string): Promise<void> {
    const g = groups.get(key);
    if (!g) return;
    groups.delete(key);
    const settled = await Promise.allSettled(g.pending);
    const items = settled
      .filter((r): r is PromiseFulfilledResult<MediaGroupItem> => r.status === 'fulfilled')
      .map((r) => r.value);
    if (items.length === 0) return;
    deps.onFlush(key, items, g.caption);
  }

  return { add, flush, get size() { return groups.size; } };
}

/**
 * Build the message text to send to Claude when a video is received.
 * Instructs Claude to use the gemini-api-dev skill for video understanding.
 */
export function buildVideoMessage(localPath: string, caption?: string): string {
  let msg = `Video received. File saved at: ${localPath}`;
  if (caption) {
    msg += `\nCaption: "${caption}"`;
  }
  msg += '\nUse the gemini-api-dev skill with the GOOGLE_API_KEY from .env to analyze this video. Summarize what is in it and transcribe any spoken content.';
  return msg;
}

/**
 * Clean up old files from workspace/uploads/.
 * Deletes files older than maxAgeMs (default: 24 hours).
 */
export function cleanupOldUploads(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(UPLOADS_DIR);
  } catch {
    return;
  }

  const now = Date.now();
  let deleted = 0;

  for (const entry of entries) {
    const fullPath = path.join(UPLOADS_DIR, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    } catch {
      // Skip files we can't stat or delete
    }
  }

  if (deleted > 0) {
    logger.info({ deleted, dir: UPLOADS_DIR }, 'Cleaned up old uploads');
  }
}
