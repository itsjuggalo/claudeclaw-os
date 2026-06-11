import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
console.log('--- visiting /aianswers/classroom ---');
await p.goto('https://www.skool.com/aianswers/classroom', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(5000);
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => window.scrollBy(0, 1500));
  await p.waitForTimeout(800);
}
const info = await p.evaluate(() => {
  const title = document.title;
  const allLinks = [...document.querySelectorAll('a[href]')]
    .map(a => a.getAttribute('href'))
    .filter(h => h && (h.includes('classroom') || h.includes('aianswers')))
    .filter((v,i,arr) => arr.indexOf(v) === i)
    .slice(0, 60);
  const headings = [...document.querySelectorAll('h1,h2,h3')]
    .map(h => h.innerText.trim())
    .filter(Boolean)
    .slice(0, 30);
  const bodySnippet = document.body.innerText.slice(0, 800);
  return { title, allLinks, headings, bodySnippet };
});
console.log('title:', info.title);
console.log('\nheadings:', JSON.stringify(info.headings, null, 2));
console.log('\nclassroom/aianswers links:');
for (const l of info.allLinks) console.log('  ', l);
console.log('\nbody snippet:\n', info.bodySnippet);
await b.close();
