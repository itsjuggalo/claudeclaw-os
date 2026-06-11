#!/usr/bin/env node
// Click-based classroom scraper for Skool groups using CourseLinkWrapper (no <a href>) (Skool uses divs+JS, not <a href>).
// Usage: node pull-classroom-click.mjs <slug> [--limit N]. Writes to ~/mc-kb/notes/skool/<slug>-classroom/.
// Captures: course title, course URL, module list, module body (paywall preview if gated).
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
if (process.argv.length < 3) { console.error('Usage: node pull-classroom-click.mjs <slug> [--limit N]'); process.exit(1); }
const SLUG = process.argv[2];
const OUT = `${process.env.HOME}/mc-kb/notes/skool/${SLUG}-classroom`;
await mkdir(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();

console.log('[harvest] loading classroom landing');
await p.goto(`https://www.skool.com/${SLUG}/classroom`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);

// Collect course metadata (title + description) BEFORE clicking
const courses = await p.evaluate(() => {
  return [...document.querySelectorAll('[class*="CourseLinkWrapper"]')].map((w, i) => ({
    idx: i,
    title: (w.querySelector('[class*="CourseTitle"]')?.innerText || '').trim(),
    desc: (w.querySelector('[class*="CourseDescription"]')?.innerText || '').trim(),
  }));
});
console.log(`[harvest] found ${courses.length} course cards on landing`);
for (const c of courses) console.log(`  [${c.idx}] ${c.title}`);

// For each course: click → capture URL → enumerate modules in sidebar → capture each module body
const allRecords = [];
for (const course of courses) {
  // Re-navigate to classroom landing each time (clicks change DOM)
  await p.goto(`https://www.skool.com/${SLUG}/classroom`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3500);
  const wraps = await p.$$('[class*="CourseLinkWrapper"]');
  if (!wraps[course.idx]) { console.log(`  [${course.idx}] vanished after re-load, skip`); continue; }
  try {
    await wraps[course.idx].click({ timeout: 4000, force: true });
  } catch(e) { console.log(`  [${course.idx}] click fail: ${e.message.slice(0,60)}`); continue; }
  await p.waitForTimeout(3500);
  const courseUrl = p.url();
  console.log(`  [${course.idx}] ${course.title} → ${courseUrl}`);
  if (!courseUrl.includes('/classroom/')) { console.log('    (did not navigate to /classroom/, skip)'); continue; }

  // Enumerate modules in the sidebar (these DO use ?md= hrefs)
  for (let s = 0; s < 3; s++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(600);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
  }
  const modules = await p.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="md="]').forEach(a => {
      const href = a.getAttribute('href') || '';
      try {
        const u = new URL('https://x' + href);
        const md = u.searchParams.get('md');
        if (md && !seen.has(md)) {
          seen.add(md);
          out.push({ md, label: (a.innerText || '').trim().slice(0, 100), href });
        }
      } catch {}
    });
    return out;
  });
  console.log(`    ${modules.length} modules in sidebar`);

  // Capture body for each module
  for (const mod of modules) {
    const url = `https://www.skool.com${mod.href.startsWith('/') ? mod.href : '/' + mod.href}`;
    try {
      const pp = await ctx.newPage();
      await pp.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pp.waitForTimeout(2500);
      const body = await pp.evaluate(() => {
        for (const sel of ['div[class*="EditorContentWrapper"]', 'div[class*="ModuleBody"]', 'div[class*="MainContent"]', 'main']) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.length > 80) return el.innerText;
        }
        return document.body.innerText.slice(0, 2000);
      });
      await pp.close();
      allRecords.push({ course: course.title, courseUrl, courseDesc: course.desc, module: mod.label || mod.md, moduleUrl: url, body });
    } catch(e) {
      console.log(`    skip ${mod.md}: ${e.message.slice(0,60)}`);
    }
  }
}

console.log(`\n[harvest] total ${allRecords.length} module records`);
// Write one markdown per record
let written = 0;
for (const r of allRecords) {
  const safeCourse = r.course.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60);
  const safeMod = r.module.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 80);
  const fname = `${safeCourse}__${safeMod || 'module'}.md`;
  const md = `---
title: ${JSON.stringify(r.module)}
course: ${JSON.stringify(r.course)}
course_url: ${r.courseUrl}
url: ${r.moduleUrl}
group_slug: ${SLUG}
source: skool-classroom-harvest
ingested_at: ${new Date().toISOString()}
---

# ${r.course} — ${r.module}

${r.courseDesc ? `**Course description:** ${r.courseDesc}\n\n` : ''}${r.body.trim()}
`;
  await writeFile(`${OUT}/${fname}`, md, 'utf-8');
  written++;
}
console.log(`[harvest] wrote ${written} files → ${OUT}`);
await b.close();
