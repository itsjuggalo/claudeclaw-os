import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const URL = 'https://www.skool.com/ai-automation-society/classroom/076a1c6e?md=222faa3341824c4db7520c2b5e172aed';
const OUT = `${process.env.HOME}/mc-kb/notes/skool/ai-automation-society-classroom`;
await mkdir(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);

// Click all 3 collapsible group headers to expand
const groupNames = ['CLAUDE.md Files', 'Other Resources', 'Tutorials'];
for (const name of groupNames) {
  const expanded = await p.evaluate((n) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = w.nextNode())) {
      if ((node.innerText || '').trim() === n && node.children.length === 0) {
        node.click();
        return true;
      }
    }
    return false;
  }, name);
  console.log(`expanded "${name}": ${expanded}`);
  await p.waitForTimeout(1500);
}

// Now enumerate ALL md= links in the sidebar
const allLinks = await p.evaluate(() => {
  return [...new Set([...document.querySelectorAll('a[href*="md="]')].map(a => a.getAttribute('href')))];
});
console.log(`\ntotal module URLs after expansion: ${allLinks.length}`);

// Also extract the title + parent-group context for each link
const linksWithMeta = await p.evaluate(() => {
  return [...document.querySelectorAll('a[href*="md="]')].map(a => {
    const text = (a.innerText || '').trim().slice(0, 100);
    // Walk up to find the enclosing group header (the previous MenuItemWrapper that doesn't have an a child)
    let cur = a.parentElement;
    let group = '';
    while (cur && cur !== document.body) {
      const wrap = cur.matches('[class*="MenuItemWrapper"]') ? cur : cur.closest('[class*="MenuItemWrapper"]');
      if (wrap && wrap !== cur) {
        const titleEl = wrap.querySelector('[class*="MenuItemTitle"]');
        if (titleEl && !titleEl.querySelector('a')) { group = (titleEl.innerText || '').trim(); break; }
      }
      cur = cur.parentElement;
    }
    return { href: a.getAttribute('href'), text, group: group || '(top-level)' };
  });
});
for (const l of linksWithMeta) console.log(`  [${l.group}] ${l.text} → ${l.href}`);

// Now visit each URL we don't already have a file for and capture body
const haveAlready = new Set([
  '222faa3341824c4db7520c2b5e172aed',  // EA Initialize Prompt (already saved)
]);
const newModules = linksWithMeta.filter(l => {
  const m = l.href.match(/md=([a-f0-9]+)/);
  return m && !haveAlready.has(m[1]);
});
console.log(`\nfetching ${newModules.length} new modules...`);

let saved = 0;
for (const mod of newModules) {
  const url = `https://www.skool.com${mod.href.startsWith('/') ? mod.href : '/' + mod.href}`;
  try {
    const pp = await ctx.newPage();
    await pp.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pp.waitForTimeout(2500);
    const data = await pp.evaluate(() => {
      const title = (document.title || '').replace(/ · .*$/, '').replace(/ - .*$/, '').trim();
      let body = '';
      for (const sel of ['div[class*="EditorContentWrapper"]', 'div[class*="ModuleBody"]', 'div[class*="MainContent"]', 'main']) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.length > 50) { body = el.innerText; break; }
      }
      if (!body) body = document.body.innerText.slice(0, 3000);
      // Also extract any resource attachments (file names)
      const resources = [...document.querySelectorAll('[class*="ResourceWrapper"]')]
        .map(w => (w.querySelector('[class*="ResourceLabel"]')?.innerText || '').trim())
        .filter(Boolean);
      return { title, body, resources };
    });
    await pp.close();
    const safeName = `Claude_Code__${mod.text.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 80)}.md`;
    const md = `---
title: ${JSON.stringify(mod.text)}
course: "Claude Code"
group: ${JSON.stringify(mod.group)}
course_url: https://www.skool.com/ai-automation-society/classroom/076a1c6e
url: ${url}
group_slug: ai-automation-society
source: skool-classroom-harvest-deep
resources_listed: ${JSON.stringify(data.resources)}
ingested_at: ${new Date().toISOString()}
---

# Claude Code — ${mod.text} (in: ${mod.group})

${data.body.trim()}

${data.resources.length > 0 ? '\n## Resources (attachments — may be paywalled)\n' + data.resources.map(r => '- ' + r).join('\n') : ''}
`;
    await writeFile(`${OUT}/${safeName}`, md, 'utf-8');
    saved++;
    console.log(`  saved: ${safeName}`);
  } catch(e) { console.log(`  skip ${mod.text}: ${e.message.slice(0,60)}`); }
}
console.log(`\ndeep harvest: ${saved} new modules saved`);
await b.close();
