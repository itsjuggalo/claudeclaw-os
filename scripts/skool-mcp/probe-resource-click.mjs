import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE, acceptDownloads: true });
const page = await ctx.newPage();
page.on("request", r => { const u = r.url(); if (u.includes("api.skool.com") || (u.includes("assets.skool") && !/(jpg|png|webp|css|js|woff)/.test(u))) console.log(r.method(), "REQ:", u.slice(0, 200)); });
page.on("download", d => console.log("DOWNLOAD:", d.url().slice(0, 200), "->", d.suggestedFilename()));
await page.goto("https://www.skool.com/earlyaidopters/classroom/205bbe56", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
// The auto-selected module is "Course Wrap Up"; navigate to first lesson which has resources
const lesson = page.locator("text=Live in the Future").first();
if (await lesson.count()) { await lesson.click(); await page.waitForTimeout(3000); }
const txt = await page.evaluate(() => document.body.innerText);
const ri = txt.indexOf("Transcript");
console.log("body has Transcript @", ri, "| context:", txt.slice(Math.max(0, ri - 120), ri + 160).replace(/\n/g, " | "));
// click anything labeled Transcript / Learning Guide
for (const q of ["text=Transcript", "text=Learning Guide"]) {
  const el = page.locator(q).first();
  if (await el.count()) { console.log("clicking", q); await el.click().catch(() => {}); await page.waitForTimeout(3000); }
}
await browser.close();
