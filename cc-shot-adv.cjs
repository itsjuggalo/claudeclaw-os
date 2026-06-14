// Desktop Advanced (ComfyUI) — scroll to the Generate area to prove the
// Detailer toggle renders there too.
const { chromium } = require('playwright');
const fs = require('fs');
const TOKEN = process.env.CC_TOKEN;
const OUT = '/tmp/cc-create';
const BASE = 'http://localhost:3141';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = `${BASE}/create?token=${encodeURIComponent(TOKEN)}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  // Go Advanced
  try { const adv = page.locator('button', { hasText: 'Advanced options' }).first(); if (await adv.count()) { await adv.click(); await page.waitForTimeout(1000); } } catch {}
  // Scroll to the Fix-feet toggle (ComfyUI is default engine in Advanced)
  try { const t = page.locator('button', { hasText: 'Fix feet' }).first(); if (await t.count()) { await t.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); } } catch (e) { console.log('no toggle found:', e.message); }
  await page.screenshot({ path: `${OUT}/create-after-desktop-detailer.png` });
  console.log('saved', `${OUT}/create-after-desktop-detailer.png`);
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error('SHOT FAIL', e.message); process.exit(1); });
