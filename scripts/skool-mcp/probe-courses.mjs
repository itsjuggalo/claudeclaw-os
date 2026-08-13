import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
await page.goto("https://www.skool.com/earlyaidopters/classroom", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);
const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}");
const d = JSON.parse(raw);
const ac = d.props.pageProps.allCourses;
console.log("allCourses type:", Array.isArray(ac) ? "array "+ac.length : typeof ac);
if (Array.isArray(ac)) for (const c of ac) {
  const co = c.course || c;
  console.log(co.id, "|", co.name, "|", co.metadata?.title);
}
await browser.close();
