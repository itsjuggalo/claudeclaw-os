import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { buildPhotoMessage, buildDocumentMessage, buildMediaGroupMessage, createMediaGroupBuffer, cleanupOldUploads, UPLOADS_DIR } from './media.js';

describe('createMediaGroupBuffer', () => {
  // Controllable fake timer so debounce behaviour is deterministic.
  function fakeClock() {
    let seq = 0;
    const timers = new Map<number, () => void>();
    const setTimer = (fn: () => void) => { const id = ++seq; timers.set(id, fn); return id as unknown as ReturnType<typeof setTimeout>; };
    const clearTimer = (t: ReturnType<typeof setTimeout>) => { timers.delete(t as unknown as number); };
    const fireAll = () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((fn) => fn()); };
    return { setTimer, clearTimer, fireAll, pending: () => timers.size };
  }

  it('flushes items sharing a key as one set with the caption', async () => {
    const clock = fakeClock();
    const flushes: Array<{ key: string; items: unknown[]; caption?: string }> = [];
    const buf = createMediaGroupBuffer({
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      onFlush: (key, items, caption) => flushes.push({ key, items, caption }),
    });
    buf.add('c:1', Promise.resolve({ path: '/tmp/a.jpg' }), 'compare');
    buf.add('c:1', Promise.resolve({ path: '/tmp/b.jpg' }));
    expect(clock.pending()).toBe(1); // second add reset, not stacked
    clock.fireAll();
    await new Promise((r) => setImmediate(r));
    expect(flushes).toHaveLength(1);
    expect(flushes[0].items).toHaveLength(2);
    expect(flushes[0].caption).toBe('compare');
  });

  it('keeps distinct group keys separate', async () => {
    const clock = fakeClock();
    const flushes: Array<{ key: string }> = [];
    const buf = createMediaGroupBuffer({
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      onFlush: (key) => flushes.push({ key }),
    });
    buf.add('c:1', Promise.resolve({ path: '/a' }));
    buf.add('c:2', Promise.resolve({ path: '/b' }));
    clock.fireAll();
    await new Promise((r) => setImmediate(r));
    expect(flushes.map((f) => f.key).sort()).toEqual(['c:1', 'c:2']);
  });

  it('drops items whose download rejects and skips an all-failed group', async () => {
    const clock = fakeClock();
    const flushes: Array<{ items: unknown[] }> = [];
    const buf = createMediaGroupBuffer({
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      onFlush: (_key, items) => flushes.push({ items }),
    });
    buf.add('c:1', Promise.resolve({ path: '/ok' }));
    buf.add('c:1', Promise.reject(new Error('download failed')));
    buf.add('c:2', Promise.reject(new Error('download failed')));
    clock.fireAll();
    await new Promise((r) => setImmediate(r));
    expect(flushes).toHaveLength(1); // c:2 all-failed → skipped
    expect(flushes[0].items).toHaveLength(1);
  });
});

describe('buildMediaGroupMessage', () => {
  it('lists every file path and the count', () => {
    const msg = buildMediaGroupMessage([{ path: '/tmp/a.jpg' }, { path: '/tmp/b.jpg' }]);
    expect(msg).toContain('/tmp/a.jpg');
    expect(msg).toContain('/tmp/b.jpg');
    expect(msg).toContain('2 files');
    expect(msg.toLowerCase()).toContain('all 2');
  });
  it('includes the single caption once', () => {
    const msg = buildMediaGroupMessage([{ path: '/tmp/a.jpg' }, { path: '/tmp/b.jpg' }], 'compare these');
    expect(msg).toContain('compare these');
    expect((msg.match(/Caption/g) || []).length).toBe(1);
  });
  it('includes labels for documents', () => {
    const msg = buildMediaGroupMessage([{ path: '/tmp/x.pdf', label: 'report.pdf' }]);
    expect(msg).toContain('report.pdf');
  });
});

describe('buildPhotoMessage', () => {
  it('returns string containing the file path', () => {
    const msg = buildPhotoMessage('/tmp/photo.jpg');
    expect(msg).toContain('/tmp/photo.jpg');
  });

  it('includes caption when provided', () => {
    const msg = buildPhotoMessage('/tmp/photo.jpg', 'My vacation');
    expect(msg).toContain('My vacation');
  });

  it('works without caption', () => {
    const msg = buildPhotoMessage('/tmp/photo.jpg');
    expect(msg).not.toContain('Caption');
  });

  it('output mentions "Photo" or "image"', () => {
    const msg = buildPhotoMessage('/tmp/photo.jpg');
    const lower = msg.toLowerCase();
    expect(lower.includes('photo') || lower.includes('image')).toBe(true);
  });
});

describe('buildDocumentMessage', () => {
  it('returns string containing the file path', () => {
    const msg = buildDocumentMessage('/tmp/doc.pdf', 'doc.pdf');
    expect(msg).toContain('/tmp/doc.pdf');
  });

  it('returns string containing the filename', () => {
    const msg = buildDocumentMessage('/tmp/doc.pdf', 'report.pdf');
    expect(msg).toContain('report.pdf');
  });

  it('includes caption when provided', () => {
    const msg = buildDocumentMessage('/tmp/doc.pdf', 'doc.pdf', 'Annual report');
    expect(msg).toContain('Annual report');
  });

  it('works without caption', () => {
    const msg = buildDocumentMessage('/tmp/doc.pdf', 'doc.pdf');
    expect(msg).not.toContain('Caption');
  });
});

describe('cleanupOldUploads', () => {
  it('does not throw when UPLOADS_DIR exists and is empty', () => {
    // UPLOADS_DIR is created on module load, so it exists
    expect(() => cleanupOldUploads()).not.toThrow();
  });

  it('does not throw when called with default maxAge', () => {
    expect(() => cleanupOldUploads()).not.toThrow();
  });

  it('deletes old files but keeps new files', () => {
    // Create a temp subdir inside UPLOADS_DIR for isolation
    const testDir = path.join(UPLOADS_DIR, 'cleanup-test');
    fs.mkdirSync(testDir, { recursive: true });

    const oldFile = path.join(UPLOADS_DIR, 'old-cleanup-test.txt');
    const newFile = path.join(UPLOADS_DIR, 'new-cleanup-test.txt');

    try {
      // Write both files
      fs.writeFileSync(oldFile, 'old content');
      fs.writeFileSync(newFile, 'new content');

      // Backdate the old file by 48 hours
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);

      cleanupOldUploads();

      // Old file should be deleted
      expect(fs.existsSync(oldFile)).toBe(false);
      // New file should remain
      expect(fs.existsSync(newFile)).toBe(true);
    } finally {
      // Cleanup
      try { fs.unlinkSync(newFile); } catch { /* ignore */ }
      try { fs.unlinkSync(oldFile); } catch { /* ignore */ }
      try { fs.rmdirSync(testDir); } catch { /* ignore */ }
    }
  });
});

describe('UPLOADS_DIR', () => {
  it('is an absolute path', () => {
    expect(path.isAbsolute(UPLOADS_DIR)).toBe(true);
  });

  it('ends with workspace/uploads', () => {
    expect(UPLOADS_DIR).toMatch(/workspace[/\\]uploads$/);
  });
});
