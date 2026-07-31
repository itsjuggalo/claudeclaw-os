import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
await page.goto("https://www.skool.com/earlyaidopters/classroom", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);
const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}");
const d = JSON.parse(raw);
// walk for objects with name+id that look like courses
const out = [];
(function walk(n, path) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach((x,i) => walk(x, path));
  if (n.id && (n.metadata?.title || n.name) && (path.includes("course") || n.post_type === 4 || n.metadata?.courseType !== undefined)) {
    out.push({ id: n.id, name: n.name, title: n.metadata?.title, path });
  }
  for (const [k,v] of Object.entries(n)) walk(v, path + "." + k);
})(d, "");
console.log(JSON.stringify(out.slice(0, 40), null, 1));
const keys = Object.keys(d.props?.pageProps || {});
console.log("pageProps keys:", keys);
await browser.close();
