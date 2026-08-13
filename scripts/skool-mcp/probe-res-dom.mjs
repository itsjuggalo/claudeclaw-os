import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
await page.goto("https://www.skool.com/earlyaidopters/classroom/205bbe56?md=4a8f9c4f4b424bc48dc5a7a0bb78ce8d", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
const html = await page.evaluate(() => {
  const idx = document.body.innerHTML.indexOf("Transcript");
  return document.body.innerHTML.slice(Math.max(0, idx - 1500), idx + 500);
});
console.log(html);
await browser.close();
