import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
await page.goto(process.argv[2], { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
const data = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "");
console.error("nextdata bytes:", data.length);
// show contexts around filenames
for (const name of ["war-game-prompt", "war-game.html", "attachment", "video_links"]) {
  const i = data.indexOf(name);
  console.error(`\n--- "${name}" @ ${i}`);
  if (i >= 0) console.error(data.slice(Math.max(0,i-300), i+500).replace(/\\/g,"\\"));
}
await browser.close();
