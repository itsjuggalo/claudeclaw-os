import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto('https://www.skool.com/aianswers/classroom', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(6000);
for (let i = 0; i < 5; i++) {
  await p.evaluate(() => window.scrollBy(0, 2000));
  await p.waitForTimeout(900);
}
const info = await p.evaluate(() => {
  // All hrefs containing 'aianswers' anywhere
  const ahrefs = [...document.querySelectorAll('a[href*="aianswers"]')]
    .map(a => a.getAttribute('href'))
    .filter((v,i,arr) => arr.indexOf(v) === i);
  // Any clickable elements with role=link
  const roleLinks = [...document.querySelectorAll('[role="link"]')]
    .map(el => ({ href: el.getAttribute('href'), text: (el.innerText||'').slice(0, 80) }))
    .slice(0, 30);
  // Any cards/buttons that look like modules
  const cards = [...document.querySelectorAll('[class*="card" i], [class*="course" i], [class*="module" i]')]
    .slice(0, 20)
    .map(el => ({ tag: el.tagName, cls: el.className.slice(0,60), text: (el.innerText||'').slice(0,80) }));
  return { ahrefs, roleLinks, cards };
});
console.log('== a[href*aianswers]: ' + info.ahrefs.length + ' ==');
for (const h of info.ahrefs) console.log('  ', h);
console.log('\n== [role=link]: ' + info.roleLinks.length + ' ==');
for (const r of info.roleLinks) console.log('  ', r.href, '|', r.text);
console.log('\n== class~card/course/module: ' + info.cards.length + ' ==');
for (const c of info.cards) console.log('  ', c.tag, '|', c.cls, '|', c.text);
await b.close();
