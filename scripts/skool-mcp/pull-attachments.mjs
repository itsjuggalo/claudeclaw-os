// Download all file attachments (post + comments) from skool post URLs via __NEXT_DATA__.
// Usage: node pull-attachments.mjs <post-url> [...more]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const OUT = `${process.env.HOME}/mc-kb/notes/skool/earlyaidopters-attachments`;
await mkdir(OUT, { recursive: true });

function collect(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => collect(n, out)); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === "attachmentsData" && typeof v === "string") {
      try {
        for (const att of JSON.parse(v)) {
          const md = att.metadata || {};
          if (md.file_name && md.read_url && !out.has(md.file_name)) out.set(md.file_name, md.read_url);
        }
      } catch {}
    } else collect(v, out);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();

for (const url of process.argv.slice(2)) {
  console.error(`\n== ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}");
  const found = new Map();
  try { collect(JSON.parse(raw), found); } catch (e) { console.error("  parse-err", e.message); }
  console.error(`  ${found.size} attachments`);
  for (const [name, rurl] of found) {
    try {
      const resp = await ctx.request.get(rurl);
      if (!resp.ok()) { console.error(`  FAIL ${resp.status()} ${name}`); continue; }
      const buf = await resp.body();
      const safe = name.replace(/[/:*?"<>|]/g, "_");
      await writeFile(`${OUT}/${safe}`, buf);
      console.error(`  SAVED ${safe} (${buf.length}b)`);
    } catch (e) { console.error(`  ERR ${name} :: ${e.message.split(String.fromCharCode(10))[0]}`); }
  }
}
await browser.close();
