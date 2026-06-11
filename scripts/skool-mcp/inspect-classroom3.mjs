import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: STATE, viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
await p.goto('https://www.skool.com/aianswers/classroom', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(5000);
// Dump all CourseLinkWrapper attrs
const dump = await p.evaluate(() => {
  const wraps = [...document.querySelectorAll('[class*="CourseLinkWrapper"]')];
  return wraps.slice(0, 10).map(w => {
    const attrs = {};
    for (const a of w.attributes) attrs[a.name] = a.value.slice(0, 80);
    // Walk children for href
    const hrefChild = w.querySelector('[href], [data-href]');
    const title = (w.querySelector('[class*="CourseTitle"]')?.innerText || '').slice(0, 50);
    return { title, attrs, hrefInChild: hrefChild ? hrefChild.getAttribute('href') || hrefChild.getAttribute('data-href') : null };
  });
});
console.log('CourseLinkWrapper attrs + child hrefs:');
console.log(JSON.stringify(dump, null, 2));

// Now try clicking the first non-welcome course and see what URL it goes to
console.log('\n=== clicking 2nd CourseLinkWrapper (Agent Swarm Skill expected) ===');
const before = p.url();
const courses = await p.$$('[class*="CourseLinkWrapper"]');
if (courses.length >= 2) {
  await courses[1].click();
  await p.waitForTimeout(3500);
  console.log('before:', before);
  console.log('after :', p.url());
}
await b.close();
