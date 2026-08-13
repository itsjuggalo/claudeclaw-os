import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const URL = 'https://www.skool.com/aianswers/classroom/7f13437e?md=fadc21e12d4f4c11b3bd5c2f26cda58a';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
// Scroll all the way down to ensure resources at the bottom load
for (let i = 0; i < 8; i++) {
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(800);
}
const info = await p.evaluate(() => {
  // Full body text
  const body = document.body.innerText;
  // All external links (non-skool)
  const extLinks = [...document.querySelectorAll('a[href]')]
    .map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim().slice(0, 100) }))
    .filter(l => l.href && !l.href.startsWith('#') && !l.href.includes('skool.com'));
  // All download-ish elements
  const dlElements = [...document.querySelectorAll('[class*="ttachment" i], [class*="esource" i], [class*="ownload" i], [class*="ile" i]')]
    .slice(0, 30)
    .map(el => ({ tag: el.tagName, cls: el.className.slice(0, 80), text: (el.innerText || '').slice(0, 100), href: el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') }));
  // Iframes (often video embeds)
  const iframes = [...document.querySelectorAll('iframe')]
    .map(f => ({ src: f.src, title: f.title }));
  return { bodyLen: body.length, body, extLinks, dlElements, iframes };
});
console.log('=== full body text ===');
console.log(info.body);
console.log('\n=== external links ===');
for (const l of info.extLinks) console.log('  ', l.href, '|', l.text);
console.log('\n=== download/resource/attachment elements ===');
for (const d of info.dlElements) console.log('  ', d.tag, '|', d.cls, '|', d.text, '|', d.href || '');
console.log('\n=== iframes ===');
for (const f of info.iframes) console.log('  ', f.src, '|', f.title);
await b.close();
