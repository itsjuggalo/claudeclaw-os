import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const URL = 'https://www.skool.com/ai-automation-society/classroom/076a1c6e?md=222faa3341824c4db7520c2b5e172aed';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);

// First: dump all elements containing "CLAUDE.md" and "Other Resources" text
const found = await p.evaluate(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const txt = (node.innerText || '').trim();
    if (txt && txt.length < 80 && /CLAUDE\.md|Other Resources|Tutorials|EA Initialize/.test(txt) && txt.split('\n').length < 5) {
      out.push({
        tag: node.tagName,
        cls: (node.className || '').toString().slice(0, 50),
        text: txt.slice(0, 60),
        hasHref: node.tagName === 'A' || node.querySelector('a') !== null,
      });
    }
  }
  return out.slice(0, 30);
});
console.log('=== elements with CLAUDE.md / Other Resources / Tutorials text ===');
for (const f of found) console.log('  ', f.tag, '|', f.cls, '|', f.text, '|hasAnchor:', f.hasHref);

// Now try clicking the "CLAUDE.md Files" text element
console.log('\n=== trying to click "CLAUDE.md Files" text ===');
const clicked = await p.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if ((node.innerText || '').trim() === 'CLAUDE.md Files' && node.children.length === 0) {
      node.click();
      return { found: true, tag: node.tagName, parent: node.parentElement?.tagName, parentCls: (node.parentElement?.className || '').toString().slice(0,60) };
    }
  }
  return { found: false };
});
console.log('clicked:', JSON.stringify(clicked));
await p.waitForTimeout(3000);

// Re-scan for md= links after clicking
const linksAfter = await p.evaluate(() => {
  return [...document.querySelectorAll('a[href*="md="]')].map(a => a.getAttribute('href'));
});
console.log('\n=== links after click ===');
for (const l of linksAfter) console.log('  ', l);
console.log('url after click:', p.url());

await b.close();
