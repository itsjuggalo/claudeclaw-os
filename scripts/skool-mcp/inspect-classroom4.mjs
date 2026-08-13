import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto('https://www.skool.com/aianswers/classroom', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(5000);
const cards = await p.$$('[class*="CourseLinkWrapper"]');
console.log(`Found ${cards.length} cards`);
// Click 2nd (Agent Swarm Skill) — first is Welcome which is enabled
const before = p.url();
try {
  await cards[1].click({ timeout: 4000, force: true });
  await p.waitForTimeout(4000);
  console.log('before:', before);
  console.log('after :', p.url());
  // Snapshot what's visible after click
  const snip = await p.evaluate(() => document.body.innerText.slice(0, 600));
  console.log('after body snippet:', snip);
} catch(e) {
  console.log('click failed:', e.message);
}
// Also dump ALL course titles + descriptions as a metadata harvest
const meta = await p.evaluate(() => {
  return [...document.querySelectorAll('[class*="CourseLinkWrapper"]')].map(w => ({
    title: (w.querySelector('[class*="CourseTitle"]')?.innerText || '').trim(),
    desc: (w.querySelector('[class*="CourseDescription"]')?.innerText || '').trim(),
    disabled: w.getAttribute('aria-disabled'),
  }));
});
console.log('\n=== ALL MODULE METADATA (' + meta.length + ' total) ===');
for (const m of meta) console.log(`[${m.disabled === 'true' ? 'LOCKED' : 'OPEN  '}] ${m.title}\n        ${m.desc.slice(0,120)}`);
await b.close();
