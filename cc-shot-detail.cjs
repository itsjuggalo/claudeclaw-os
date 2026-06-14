// Focused screenshots: scroll to the Generate area to show the Detailer toggle,
// after selecting a feet Look (so the default-from-Look value is visible).
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = process.env.CC_TOKEN;
const OUT = '/tmp/cc-create';
const BASE = 'http://localhost:3141';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const url = `${BASE}/create?token=${encodeURIComponent(TOKEN)}`;

  // PHONE — select the first available Look, then scroll to the Generate area.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Click a Look card so the Detailer default-from-Look kicks in. The feet Looks
  // default detailer=true once the JSON carries it; here we just prove the toggle.
  try {
    // The "Real Feet" chip is the clearest feet category.
    const feetChip = page.locator('button', { hasText: 'Real Feet' }).first();
    if (await feetChip.count()) { await feetChip.click(); await page.waitForTimeout(800); }
  } catch (e) { console.log('chip click skipped:', e.message); }

  // Scroll the textarea/Generate region into view.
  try {
    const gen = page.locator('button', { hasText: 'Fix feet' }).first();
    if (await gen.count()) { await gen.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); }
  } catch (e) { console.log('scroll skipped:', e.message); }
  await page.screenshot({ path: `${OUT}/create-after-phone-detailer.png` });
  console.log('saved', `${OUT}/create-after-phone-detailer.png`);

  // Toggle the detailer ON and re-shot to prove the ON state.
  try {
    const tg = page.locator('button[role="switch"]').first();
    if (await tg.count()) { await tg.click(); await page.waitForTimeout(400); }
  } catch (e) { console.log('toggle skipped:', e.message); }
  await page.screenshot({ path: `${OUT}/create-after-phone-detailer-on.png` });
  console.log('saved', `${OUT}/create-after-phone-detailer-on.png`);
  await ctx.close();

  // DESKTOP — Advanced mode to show the toggle there too (ComfyUI engine).
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const page2 = await ctx2.newPage();
  await page2.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForTimeout(4000);
  try {
    const adv = page2.locator('button', { hasText: 'Advanced options' }).first();
    if (await adv.count()) { await adv.click(); await page2.waitForTimeout(1200); }
  } catch (e) { console.log('adv skipped:', e.message); }
  await page2.screenshot({ path: `${OUT}/create-after-desktop-advanced.png`, fullPage: true });
  console.log('saved', `${OUT}/create-after-desktop-advanced.png`);
  await ctx2.close();

  await browser.close();
})().catch((e) => { console.error('SHOT FAIL', e.message); process.exit(1); });
