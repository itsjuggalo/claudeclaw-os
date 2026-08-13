import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE, acceptDownloads: true });
const page = await ctx.newPage();
page.on("request", r => { const u = r.url(); if (u.includes("api.skool.com") || (u.includes("assets.skool") && !/\.(jpg|png|webp|css|js|woff|svg)/.test(u))) console.log(r.method(), "REQ:", u.slice(0, 220)); });
page.on("download", d => console.log("DOWNLOAD:", d.url().slice(0, 220), "->", d.suggestedFilename()));

await page.goto("https://www.skool.com/earlyaidopters/classroom/205bbe56", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}");
const d = JSON.parse(raw);
let target = null;
(function walk(n) {
  if (!n || typeof n !== "object" || target) return;
  if (Array.isArray(n)) return n.forEach(walk);
  const co = n.course || n;
  if (co.metadata?.resources && co.metadata.resources.includes("d9aad908")) target = co;
  for (const ch of n.children || co.children || []) walk(ch);
})(d.props.pageProps.course);
if (!target) { console.log("lesson not found"); process.exit(1); }
console.log("LESSON:", target.metadata.title, target.id);
await page.goto(`https://www.skool.com/earlyaidopters/classroom/205bbe56?md=${target.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
const txt = await page.evaluate(() => document.body.innerText);
const i = txt.indexOf("Transcript");
console.log("Transcript visible @", i, txt.slice(Math.max(0,i-80), i+120).replace(/\n/g," | "));
const el = page.locator("text=Transcript").first();
if (await el.count()) { await el.click().catch(()=>{}); await page.waitForTimeout(3500); }
await browser.close();
