import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const URL = 'https://www.skool.com/aianswers/classroom/7f13437e?md=fadc21e12d4f4c11b3bd5c2f26cda58a';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
for (let i = 0; i < 3; i++) { await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(700); }

const info = await p.evaluate(() => {
  const wrap = document.querySelector('[class*="ResourceWrapper"]');
  if (!wrap) return { found: false };
  const attrs = {};
  for (const a of wrap.attributes) attrs[a.name] = a.value;
  // Full outerHTML
  const html = wrap.outerHTML;
  // Walk the parent chain looking for an <a href>
  let cur = wrap;
  let parentHref = null;
  while (cur && cur !== document.body) {
    if (cur.tagName === 'A' && cur.getAttribute('href')) { parentHref = cur.getAttribute('href'); break; }
    cur = cur.parentElement;
  }
  // Look for any nested <a> too
  const nestedA = wrap.querySelector('a[href]');
  return { found: true, attrs, html: html.slice(0, 2000), parentHref, nestedHref: nestedA?.getAttribute('href') };
});
console.log(JSON.stringify(info, null, 2));

// Also try right-click / context menu to see if "open in new tab" reveals URL
console.log('\n=== trying click on label SPAN ===');
const span = await p.$('[class*="ResourceLabel"]');
if (span) {
  ctx.on('page', pg => console.log('[NEW PAGE FROM SPAN CLICK]', pg.url()));
  await span.click({ force: true });
  await p.waitForTimeout(4000);
  console.log('current URL after span click:', p.url());
  // Modal might have opened — check
  const modalText = await p.evaluate(() => {
    const m = document.querySelector('[class*="odal" i], [role="dialog"]');
    return m ? m.innerText.slice(0, 400) : null;
  });
  console.log('modal text:', modalText);
}
await b.close();
