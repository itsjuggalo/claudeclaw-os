#!/usr/bin/env node
// Interactive skool.com login with auto-detect via cookie-baseline-diff.
// Opens Chromium → settles anonymous cookies → waits for NEW cookies (= login).

import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

const STATE_PATH = `${process.env.HOME}/skool-mcp/storageState.json`;
const TIMEOUT_MS = 10 * 60 * 1000;

await mkdir(dirname(STATE_PATH), { recursive: true });
// Wipe any stale unauthenticated state.
if (existsSync(STATE_PATH)) await rm(STATE_PATH);

console.log('Launching Chromium...');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://www.skool.com', { waitUntil: 'domcontentloaded' });

// Let anonymous cookies (AWS WAF, ALB, _fbp, etc) settle for 5s before baseline.
console.log('Establishing anonymous-cookie baseline (5s)...');
await new Promise(r => setTimeout(r, 5000));

const baseline = new Set(
  (await context.cookies()).map(c => `${c.domain}|${c.name}`)
);
console.log(`Baseline: ${baseline.size} anonymous cookies. Now waiting for login.`);

console.log('\n=== Log in to skool.com in the Chromium window. ===');
console.log('Once you reach your feed, this script auto-saves and exits.\n');

const start = Date.now();
let saved = false;

while (Date.now() - start < TIMEOUT_MS) {
  await new Promise(r => setTimeout(r, 2000));

  const cookies = await context.cookies();
  const newOnes = cookies.filter(c =>
    !baseline.has(`${c.domain}|${c.name}`) &&
    /(\.skool\.com|www\.skool\.com|skool\.com)$/.test(c.domain) &&
    c.value.length >= 32 &&
    // Exclude analytics/tracking cookies that might appear post-load
    !/^(_ga|_gid|_gat|_fbp|_fbc|_hj|_uet|_pin)/i.test(c.name)
  );
  const url = page.url();
  const onAuthPage = /\/login|\/signup|\/welcome|\/sign-up|\/sign-in/i.test(url);

  if (newOnes.length > 0 && !onAuthPage) {
    console.log(`✓ New skool cookies detected (${newOnes.length}):`);
    for (const c of newOnes.slice(0, 5)) {
      console.log(`  - ${c.name} (${c.domain}, ${c.value.length} chars)`);
    }
    console.log(`✓ URL: ${url}`);
    // Settle for 3s more in case more cookies arrive
    await new Promise(r => setTimeout(r, 3000));
    await context.storageState({ path: STATE_PATH });
    console.log(`✓ Session saved → ${STATE_PATH}`);
    saved = true;
    break;
  }
}

if (!saved) {
  console.error('⚠ Timed out — no login detected. Re-run the script.');
}

await browser.close();
process.exit(saved ? 0 : 1);
