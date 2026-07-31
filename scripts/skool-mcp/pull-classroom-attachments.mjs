// Visit every classroom module (?md=) and download its attachments.
// Usage: node pull-classroom-attachments.mjs <group-slug>
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const slug = process.argv[2] || "earlyaidopters";
const ATT = `${process.env.HOME}/mc-kb/notes/skool/${slug}-attachments`;
await mkdir(ATT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
const nextData = async () => JSON.parse(await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}"));
function collectAtt(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => collectAtt(n, out)); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === "attachmentsData" && typeof v === "string") {
      try { for (const a of JSON.parse(v)) { const md = a.metadata || {};
        if (md.file_name && md.read_url && !out.has(md.file_name)) out.set(md.file_name, md.read_url); } } catch {}
    } else collectAtt(v, out);
  }
}
function moduleIds(node, acc) {
  if (!node || typeof node !== "object") return;
  const co = node.course || node;
  if (co.id && co.metadata?.title) acc.push(co.id);
  for (const ch of node.children || co.children || []) moduleIds(ch, acc);
}

await page.goto(`https://www.skool.com/${slug}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
const d = await nextData();
const courses = (d.props.pageProps.allCourses || []).map(c => c.course || c);
const found = new Map();
for (const c of courses) {
  const title = c.metadata?.title || c.name;
  try {
    await page.goto(`https://www.skool.com/${slug}/classroom/${c.name}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const cd = await nextData();
    const ids = []; moduleIds(cd.props.pageProps.course, ids);
    console.error(`== ${title}: ${ids.length} modules`);
    for (const id of ids) {
      try {
        await page.goto(`https://www.skool.com/${slug}/classroom/${c.name}?md=${id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        const md = await nextData();
        const before = found.size;
        collectAtt(md.props.pageProps, found);
        if (found.size > before) console.error(`   +${found.size - before} attachments in module ${id}`);
      } catch {}
    }
  } catch (e) { console.error(`  ERR course ${title}`); }
}
console.error(`\nTOTAL ${found.size} unique attachments`);
let dl = 0;
for (const [name, rurl] of found) {
  const safe = name.replace(/[\/:*?"<>|]/g, "_");
  if (existsSync(`${ATT}/${safe}`)) continue;
  try {
    const resp = await ctx.request.get(rurl);
    if (!resp.ok()) { console.error(`  FAIL ${resp.status()} ${name}`); continue; }
    await writeFile(`${ATT}/${safe}`, await resp.body());
    dl++;
  } catch { console.error(`  ERR ${name}`); }
}
console.error(`downloaded ${dl} new files → ${ATT}`);
