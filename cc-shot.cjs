// Screenshot the ClaudeClaw Create page at phone + desktop viewports.
// Usage: node /tmp/cc-shot.js <label>  (e.g. "before" / "after")
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = process.env.CC_TOKEN;
const LABEL = process.argv[2] || 'shot';
const OUT = '/tmp/cc-create';
const BASE = 'http://localhost:3141';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  // Token via query param (the dashboard accepts token from query OR cookie).
  // wouter-preact = path routing, so the page lives at /create (not a hash).
  const url = `${BASE}/create?token=${encodeURIComponent(TOKEN)}`;

  const shots = [
    { name: 'phone',   width: 390,  height: 844,  dpr: 2 },
    { name: 'desktop', width: 1440, height: 900,  dpr: 1 },
  ];

  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: s.dpr,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Let the Create page mount + fetch Looks/models, then settle.
    await page.waitForTimeout(4000);
    const path = `${OUT}/create-${LABEL}-${s.name}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log('saved', path);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error('SHOT FAIL', e.message); process.exit(1); });
