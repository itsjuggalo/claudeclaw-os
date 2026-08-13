import { chromium } from 'playwright';
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const URL = 'https://www.skool.com/aianswers/classroom/7f13437e?md=fadc21e12d4f4c11b3bd5c2f26cda58a';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ 
  storageState: STATE, 
  viewport: { width: 1500, height: 1100 },
  acceptDownloads: true,
});
const p = await ctx.newPage();
// Listen for popups + downloads + new requests
ctx.on('page', pg => console.log('[POPUP]', pg.url()));
ctx.on('download', dl => console.log('[DOWNLOAD]', dl.url(), '|', dl.suggestedFilename()));
p.on('request', req => {
  const u = req.url();
  if (u.includes('skool.com') || u.includes('googleapis') || u.includes('amazonaws') || u.includes('cloudfront') || u.includes('drive.google') || u.includes('dropbox') || u.includes('zip') || u.includes('attachment') || u.includes('resource')) {
    if (!u.includes('stripe') && !u.includes('fonts') && !u.includes('static')) {
      console.log('[REQ]', req.method(), u.slice(0, 200));
    }
  }
});

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(700);
}

console.log('\n=== clicking ResourceWrapper ===');
const wrap = await p.$('[class*="ResourceWrapper"]');
if (!wrap) { console.log('NO WRAPPER'); process.exit(1); }
// Capture any new page that opens
const newPagePromise = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
// And any download
const downloadPromise = p.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await wrap.click({ force: true });
const np = await newPagePromise;
const dl = await downloadPromise;
if (np) {
  await np.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  console.log('[NEW PAGE]', np.url());
}
if (dl) {
  console.log('[DOWNLOAD]', dl.url(), 'name:', dl.suggestedFilename());
  await dl.saveAs(`/tmp/${dl.suggestedFilename()}`);
  console.log('saved to /tmp/' + dl.suggestedFilename());
}
await p.waitForTimeout(3000);
await b.close();
