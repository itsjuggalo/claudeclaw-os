import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const COURSE_ID = '076a1c6e';
const URL = `https://www.skool.com/ai-automation-society/classroom/${COURSE_ID}?md=222faa3341824c4db7520c2b5e172aed`;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
// Heavy scrolling to load all sidebar items
for (let i = 0; i < 8; i++) {
  await p.evaluate(() => window.scrollBy(0, 1500));
  await p.waitForTimeout(700);
}
// Look at sidebar links comprehensively — try MULTIPLE patterns
const allLinks = await p.evaluate(() => {
  const out = new Set();
  // Pattern 1: a[href*="md="]
  document.querySelectorAll('a[href*="md="]').forEach(a => out.add(a.getAttribute('href')));
  // Pattern 2: any href containing this course id
  document.querySelectorAll('a[href*="076a1c6e"]').forEach(a => out.add(a.getAttribute('href')));
  // Pattern 3: clickable role=button divs that might be sidebar headers
  return [...out];
});
console.log(`raw links found: ${allLinks.length}`);
for (const l of allLinks) console.log('  ', l);

// Now look at the full sidebar text to see headers/expandable sections
const sidebar = await p.evaluate(() => {
  const aside = document.querySelector('aside, nav, [class*="idebar" i], [class*="ourseSidebar" i]');
  return aside ? aside.innerText.slice(0, 2000) : 'no sidebar found';
});
console.log('\n=== sidebar text ===');
console.log(sidebar);

// Also look for clickable section headers (CLAUDE.md Files might be a collapsed group)
const sectionHeaders = await p.evaluate(() => {
  return [...document.querySelectorAll('[class*="Section" i], [class*="Group" i], [role="button"]')]
    .slice(0, 30)
    .map(el => ({
      tag: el.tagName,
      cls: (el.className || '').slice(0, 60),
      text: (el.innerText || '').trim().slice(0, 80),
    }))
    .filter(x => x.text);
});
console.log('\n=== section headers / role=button elements ===');
for (const s of sectionHeaders) console.log('  ', s.tag, '|', s.cls, '|', s.text);

await b.close();
