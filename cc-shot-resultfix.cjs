// Prove the B1 display fix: a result whose image url 404s shows the friendly
// "image couldn't load — it's saved in the Gallery" placeholder, not a broken
// icon. We force a bad result by stubbing the comfy generate endpoints.
const { chromium } = require('playwright');
const fs = require('fs');
const TOKEN = process.env.CC_TOKEN;
const OUT = '/tmp/cc-create';
const BASE = 'http://localhost:3141';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = `${BASE}/create?token=${encodeURIComponent(TOKEN)}`;
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // Force the preflight gate "safe" so Generate is enabled regardless of real
  // GPU state (we're testing the display path, not the safety gate).
  await page.route('**/api/system/metrics', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      preflight: { ok: true }, stale: false, staleness: 0,
      metrics: { hw: { ram_free_mb: 9800, vram_used_mb: 1200, vram_free_mb: 6800, gpu_temp: 44 }, disk: { c_free_gb: 104 } },
    }) }));

  // Make the generated-image fetch 404 (real url = /api/gallery/file?...) — this
  // drives the result's <img> into SmartImg.onError -> ImageUnavailable, proving
  // the friendly "saved in the Gallery" fallback instead of a broken icon.
  await page.route('**/api/gallery/file?**', (route) =>
    route.fulfill({ status: 404, body: 'not found' }));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Pick the first Look (so comfy path is active), type a prompt, Generate.
  try {
    const firstLook = page.locator('button', { hasText: 'Realistic Photo' }).first();
    if (await firstLook.count()) { await firstLook.click(); await page.waitForTimeout(500); }
  } catch (e) { console.log('look click skipped', e.message); }
  try {
    const ta = page.locator('textarea').first();
    await ta.fill('a test subject standing on a beach');
    await page.waitForTimeout(300);
  } catch (e) { console.log('prompt skipped', e.message); }
  try {
    const gen = page.locator('button', { hasText: 'Generate' }).first();
    await gen.click();
  } catch (e) { console.log('gen skipped', e.message); }

  // Wait for the result header ("Saved ✓") then let the <img> 404 + swap.
  try {
    await page.locator('text=Saved').first().waitFor({ timeout: 20000 });
  } catch (e) { console.log('saved header not seen:', e.message); }
  try { const r = page.locator('text=Saved').first(); if (await r.count()) await r.scrollIntoViewIfNeeded(); } catch {}
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/create-after-resultfix.png`, fullPage: true });
  console.log('saved', `${OUT}/create-after-resultfix.png`);
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error('SHOT FAIL', e.message); process.exit(1); });
