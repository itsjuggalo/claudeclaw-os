#!/usr/bin/env node
// Pull skool classroom modules from a group into ~/mc-kb/notes/skool/<slug>-classroom/.
// Usage: node pull-classroom.mjs <group-slug> [--limit N]
//
// Strategy:
//   1. Visit each known course-landing (or a single module) → sidebar lists all module links
//   2. For each module page: extract title + lesson description from
//      div[class*="EditorContentWrapper"] (skool's lesson-body container)
//   3. Save as markdown with frontmatter (title, course_id, module_id, url, position)
//
// Classroom URLs look like:  /<group>/classroom/<course-id>?md=<module-id>
// Description content (the gold for RAG) lives in div[class*="EditorContentWrapper"].

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const STATE_PATH = `${process.env.HOME}/skool-mcp/storageState.json`;
const KB_NOTES = `${process.env.HOME}/mc-kb/notes/skool`;

if (process.argv.length < 3) {
  console.error('Usage: node pull-classroom.mjs <group-slug> [--limit N]');
  process.exit(1);
}
const slug = process.argv[2];
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx > 0 ? parseInt(process.argv[limitIdx + 1], 10) : 500;

if (!existsSync(STATE_PATH)) {
  console.error('Run `node login.mjs` first.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE_PATH, viewport: { width: 1500, height: 1100 } });
const page = await ctx.newPage();

// Step 1 — visit the classroom landing to discover course IDs.
console.error(`[classroom] discovering courses for ${slug}...`);
await page.goto(`https://www.skool.com/${slug}/classroom`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
// Scroll the page to trigger lazy-loaded course cards
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.scrollBy(0, 1500));
  await page.waitForTimeout(800);
}

const courseIds = await page.evaluate((s) => {
  const ids = new Set();
  document.querySelectorAll(`a[href*="/${s}/classroom/"]`).forEach(a => {
    const m = a.getAttribute('href').match(new RegExp(`^/${s}/classroom/([a-z0-9]+)(?:[?/]|$)`, 'i'));
    if (m) ids.add(m[1]);
  });
  return [...ids];
}, slug);

console.error(`[classroom] courses found: ${courseIds.length} (${courseIds.slice(0,5).join(', ')}${courseIds.length>5?'...':''})`);

if (courseIds.length === 0) {
  // Fallback: hard-code the course ID Mark linked to (Claude Code Zero-to-Hero).
  courseIds.push('205bbe56');
  console.error('[classroom] using fallback course id 205bbe56');
}

// Step 2 — for each course, visit its first module URL → enumerate all module IDs from sidebar.
const allModules = []; // [{course_id, module_id, label, position}, ...]
const seenModules = new Set();
for (const courseId of courseIds) {
  console.error(`[classroom] enumerating course ${courseId} ...`);
  await page.goto(`https://www.skool.com/${slug}/classroom/${courseId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);
  // Scroll the sidebar/page to make sure all modules are in the DOM.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
  }
  const modules = await page.evaluate((args) => {
    const out = [];
    const seen = new Set();
    let position = 0;
    document.querySelectorAll('a[href*="md="]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href.includes(`/${args.slug}/classroom/${args.courseId}`)) return;
      const md = new URL('https://x' + href).searchParams.get('md');
      if (!md || seen.has(md)) return;
      seen.add(md);
      const label = (a.textContent || '').trim().slice(0, 120);
      out.push({ module_id: md, label, position: ++position });
    });
    return out;
  }, { slug, courseId });
  console.error(`  course ${courseId}: ${modules.length} modules`);
  for (const m of modules) {
    if (!seenModules.has(m.module_id)) {
      seenModules.add(m.module_id);
      allModules.push({ course_id: courseId, ...m });
    }
  }
}

console.error(`[classroom] total unique modules to fetch: ${allModules.length}`);

// Step 3 — fetch each module's body content.
const outDir = `${KB_NOTES}/${slug}-classroom`;
await mkdir(outDir, { recursive: true });

let saved = 0;
let skipped = 0;
for (const mod of allModules.slice(0, limit)) {
  const url = `https://www.skool.com/${slug}/classroom/${mod.course_id}?md=${mod.module_id}`;
  try {
    const pp = await ctx.newPage();
    await pp.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pp.waitForTimeout(2500);

    const data = await pp.evaluate(() => {
      const title = (document.title || '').replace(/ · .*$/, '').replace(/ - .*$/, '').trim();
      // Lesson description — fall through selectors in priority order
      const selectors = [
        'div[class*="EditorContentWrapper"]',
        'div[class*="ModuleBody"]',
        'div[class*="MainContent"]',
      ];
      let body = '';
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.length > 100) { body = el.innerText; break; }
      }
      // Try to find a duration (e.g. "15:23")
      let duration = '';
      const text = document.body.innerText.slice(0, 500);
      const m = text.match(/(\d{1,2}:\d{2})/);
      if (m) duration = m[1];
      return { title, body, duration };
    });
    await pp.close();

    if (!data.body || data.body.length < 80) {
      skipped++;
      continue;
    }

    const safeTitle = (data.title || mod.label || 'module')
      .replace(/[\\/:*?"<>|\n]/g, '')
      .slice(0, 100)
      .trim()
      .replace(/\s+/g, '_');
    const fname = `${String(mod.position).padStart(3, '0')}_${safeTitle}.md`;
    const md = `---
title: ${JSON.stringify(data.title || mod.label)}
course_id: ${mod.course_id}
module_id: ${mod.module_id}
group_slug: ${slug}
position: ${mod.position}
url: ${url}
duration: ${JSON.stringify(data.duration)}
source: skool-classroom
ingested_at: ${new Date().toISOString()}
---

# ${data.title || mod.label}

${data.body.trim()}
`;
    await writeFile(`${outDir}/${fname}`, md, 'utf-8');
    saved++;
    if (saved % 5 === 0) console.error(`  ...saved ${saved}/${allModules.length}`);
  } catch (e) {
    console.error(`  skipped ${url} — ${e.message.slice(0, 80)}`);
    skipped++;
  }
}

console.error(`\n[classroom] saved ${saved} modules (${skipped} skipped) → ${outDir}`);
console.error('Run: ~/mc-kb/.venv/bin/python ~/mc-kb/sync.py --reindex');
await browser.close();
