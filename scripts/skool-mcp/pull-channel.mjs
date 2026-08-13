#!/usr/bin/env node
// Pull posts from a skool community into ~/mc-kb/notes/skool/<slug>/.
// Usage: node pull-channel.mjs <group-slug> [--limit N]

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const STATE_PATH = `${process.env.HOME}/skool-mcp/storageState.json`;
const KB_NOTES = `${process.env.HOME}/mc-kb/notes/skool`;

if (process.argv.length < 3) {
  console.error('Usage: node pull-channel.mjs <slug> [--limit N]');
  process.exit(1);
}
const slug = process.argv[2];
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx > 0 ? parseInt(process.argv[limitIdx + 1], 10) : 100;

if (!existsSync(STATE_PATH)) {
  console.error('Run `node login.mjs` first.');
  process.exit(1);
}

// Reserved skool sub-paths that aren't posts.
const RESERVED = new Set([
  'classroom', 'calendar', 'about', 'leaderboards', 'members', 'map',
  '-', 'founders-special-10-spots', // tier-specific marketing pages
]);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: STATE_PATH });
const page = await context.newPage();

const groupUrl = `https://www.skool.com/${slug}`;
console.error(`Loading ${groupUrl} (to discover categories) ...`);
await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// Enumerate categories so we can sweep each (skool's "All" view shows only ~30 recent).
const categoryIds = await page.evaluate(() => {
  const ids = new Set();
  document.querySelectorAll('a[href*="?c="]').forEach(a => {
    try {
      const u = new URL(a.href);
      const c = u.searchParams.get('c');
      if (c) ids.add(c);
    } catch {}
  });
  return [...ids];
});
console.error(`Found ${categoryIds.length} categories. Will sweep: All + each category.`);

const feedsToVisit = [
  groupUrl,
  ...categoryIds.map(c => `${groupUrl}?c=${c}`),
];

const postPathRe = new RegExp(`^/${slug}/([a-z0-9][a-z0-9-]+)(?:\\?.*)?$`, 'i');

// Scroll-load each feed to collect post URLs. Dedupes globally across categories.
const seen = new Map(); // path → full URL
const MAX_STAGNANT = 5;
const MAX_ITER_PER_FEED = 100;

for (const feedUrl of feedsToVisit) {
  const sizeAtFeedStart = seen.size;
  if (feedUrl !== groupUrl) {
    console.error(`\nSwitching feed → ${feedUrl}`);
    await page.goto(feedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
  }

  let stagnantRounds = 0;
  for (let i = 0; i < MAX_ITER_PER_FEED; i++) {
    const sizeBefore = seen.size;
    const links = await page.$$eval('a[href]', els =>
      els.map(a => a.getAttribute('href')).filter(Boolean));
    for (const href of links) {
      const m = href.match(postPathRe);
      if (!m) continue;
      const postSlug = m[1];
      if (RESERVED.has(postSlug)) continue;
      if (postSlug.startsWith('-')) continue;
      const cleanPath = `/${slug}/${postSlug}`;
      if (!seen.has(cleanPath)) {
        seen.set(cleanPath, `https://www.skool.com${cleanPath}`);
      }
    }
    if (seen.size >= limit) {
      console.error(`Reached global limit ${limit}`);
      break;
    }
    if (seen.size === sizeBefore) {
      stagnantRounds++;
      if (stagnantRounds >= MAX_STAGNANT) {
        console.error(`  feed bottom: ${seen.size - sizeAtFeedStart} new (total ${seen.size})`);
        break;
      }
    } else {
      stagnantRounds = 0;
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
  if (seen.size >= limit) break;
}

console.error(`Discovered ${seen.size} post URLs (limit ${limit})`);
const postUrls = [...seen.values()].slice(0, limit);

const outDir = `${KB_NOTES}/${slug}`;
await mkdir(outDir, { recursive: true });

let saved = 0;
let skipped = 0;
for (const postUrl of postUrls) {
  try {
    const pp = await context.newPage();
    await pp.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pp.waitForTimeout(800);

    const data = await pp.evaluate(() => {
      const t = (document.title || '').replace(/ \| Skool$/, '').trim();
      // Skool post body: try multiple selector strategies in order
      let body = '';
      for (const sel of [
        'div[class*="PostContent"]',
        'article',
        '[role="article"]',
        'main',
      ]) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.length > 100) {
          body = el.innerText;
          break;
        }
      }
      if (!body) body = document.body.innerText;
      // Author: typically a link to /@<username>
      const authorEl = document.querySelector('a[href^="/@"]');
      const author = authorEl ? (authorEl.textContent || '').trim() : 'unknown';
      // Time
      const timeEl = document.querySelector('time');
      const posted_at = timeEl
        ? (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim()
        : '';
      return { title: t, body, author, posted_at };
    });
    await pp.close();

    if (!data.body || data.body.length < 50) {
      skipped++;
      continue;
    }

    const titleClean = (data.title || 'post')
      .replace(/[\\/:*?"<>|\n]/g, '')
      .slice(0, 80)
      .trim();
    const datePrefix = data.posted_at && data.posted_at.match(/\d{4}-\d{2}-\d{2}/)
      ? data.posted_at.slice(0, 10)
      : 'undated';
    const safeName = (titleClean || 'post').replace(/\s+/g, '_');
    const fname = `${datePrefix}_${safeName}.md`;

    const md = `---
title: ${JSON.stringify(data.title)}
author: ${JSON.stringify(data.author)}
group_slug: ${slug}
url: ${postUrl}
posted_at: ${JSON.stringify(data.posted_at)}
source: skool
ingested_at: ${new Date().toISOString()}
---

${data.body.trim()}
`;
    const outPath = `${outDir}/${fname}`;
    // Idempotent: skip if file exists and is similar size (avoid re-writing on every run)
    if (existsSync(outPath)) {
      const { size } = await import('node:fs').then(m => m.promises.stat(outPath));
      if (Math.abs(size - md.length) < 200) {
        skipped++;
        continue;
      }
    }
    await writeFile(outPath, md, 'utf-8');
    saved++;
    if (saved % 10 === 0) console.error(`...saved ${saved}/${postUrls.length}`);
  } catch (e) {
    console.error(`Skipped ${postUrl} — ${e.message}`);
    skipped++;
  }
}

console.error(`\nSaved ${saved} posts (${skipped} skipped) → ${outDir}`);
console.error('Run: ~/mc-kb/.venv/bin/python ~/mc-kb/sync.py --reindex');

await browser.close();
