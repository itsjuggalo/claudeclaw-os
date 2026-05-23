import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
// Welcome module: fa56d5d5 / 9795bd18f8514e61adee3a298b7fcfc8
const URL = 'https://www.skool.com/aianswers/classroom/fa56d5d5?md=9795bd18f8514e61adee3a298b7fcfc8';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
const p = await ctx.newPage();
ctx.on('page', pg => console.log('[POPUP]', pg.url()));
ctx.on('download', dl => console.log('[DOWNLOAD]', dl.url()));
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
for (let i = 0; i < 4; i++) { await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(700); }

const info = await p.evaluate(() => {
  const body = document.body.innerText;
  const wraps = [...document.querySelectorAll('[class*="ResourceWrapper"]')].map(w => ({
    label: (w.querySelector('[class*="ResourceLabel"]')?.innerText || '').trim(),
    html: w.outerHTML.slice(0, 300),
  }));
  // Look for anchor tags with PDF, ZIP, txt, md, etc
  const fileLinks = [...document.querySelectorAll('a[href]')]
    .map(a => a.getAttribute('href'))
    .filter(h => h && /\.(pdf|zip|md|txt|csv|json|py|js|sh)(\?|$)/i.test(h));
  return { bodyTail: body.slice(-1500), resources: wraps, fileLinks };
});
console.log('=== body tail (last 1500) ===');
console.log(info.bodyTail);
console.log('\n=== resource wrappers ===');
console.log(JSON.stringify(info.resources, null, 2));
console.log('\n=== file-extension links ===');
for (const l of info.fileLinks) console.log('  ', l);

// Click any resource wrapper to see if Welcome has working downloads
const rw = await p.$('[class*="ResourceWrapper"]');
if (rw) {
  console.log('\n=== clicking welcome resource ===');
  const dlPromise = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  await rw.click({ force: true });
  await p.waitForTimeout(4000);
  const dl = await dlPromise;
  if (dl) { console.log('DOWNLOAD!', dl.url(), dl.suggestedFilename()); }
  else console.log('no download fired');
}
await b.close();
