// v2: also captures comment attachments (loaded via API) by sniffing JSON responses while scrolling.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const OUT = `${process.env.HOME}/mc-kb/notes/skool/earlyaidopters-attachments`;
await mkdir(OUT, { recursive: true });

function collect(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => collect(n, out)); return; }
  for (const [k, v] of Object.entries(node)) {
    if ((k === "attachmentsData" || k === "attachments_data") && typeof v === "string") {
      try { for (const att of JSON.parse(v)) { const md = att.metadata || {};
        if (md.file_name && md.read_url && !out.has(md.file_name)) out.set(md.file_name, md.read_url); } } catch {}
    } else collect(v, out);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
const found = new Map();

page.on("response", async r => {
  try {
    const ct = r.headers()["content-type"] || "";
    if (!ct.includes("json")) return;
    const body = await r.text();
    if (!body.includes("attachmentsData") && !body.includes("file_name")) return;
    collect(JSON.parse(body), found);
  } catch {}
});

for (const url of process.argv.slice(2)) {
  console.error(`\n== ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}");
  try { collect(JSON.parse(raw), found); } catch {}
  // expand comments: scroll + click any "View more" buttons
  for (let i = 0; i < 8; i++) {
    const more = page.locator("text=/View \d+ more|more repl|more comment/i").first();
    if (await more.count()) await more.click().catch(()=>{});
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }
}
console.error(`\nTOTAL unique attachments: ${found.size}`);
for (const [name, rurl] of found) {
  try {
    const resp = await ctx.request.get(rurl);
    if (!resp.ok()) { console.error(`  FAIL ${resp.status()} ${name}`); continue; }
    const buf = await resp.body();
    const safe = name.replace(/[/:*?"<>|]/g, "_");
    await writeFile(`${OUT}/${safe}`, buf);
    console.error(`  SAVED ${safe} (${buf.length}b)`);
  } catch (e) { console.error(`  ERR ${name}`); }
}
await browser.close();
