// v2 FAST: plain HTTP fetch of each module page, parse __NEXT_DATA__ from HTML.
// No browser rendering. Hard watchdog. Incremental downloads.
// Usage: node pull-classroom-attachments.mjs <group-slug>
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

setTimeout(() => { console.error("WATCHDOG: 15min deadline hit, exiting"); process.exit(2); }, 15 * 60 * 1000);

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const slug = process.argv[2] || "earlyaidopters";
const ATT = `${process.env.HOME}/mc-kb/notes/skool/${slug}-attachments`;
await mkdir(ATT, { recursive: true });

// request-only context (no pages, no rendering)
const ctx = await (await chromium.launch({ headless: true })).newContext({ storageState: STATE });

async function nextData(url) {
  const r = await ctx.request.get(url, { timeout: 20000 });
  if (!r.ok()) return null;
  const html = await r.text();
  const i = html.indexOf("__NEXT_DATA__");
  if (i < 0) return null;
  const s = html.indexOf(">", i) + 1;
  const e = html.indexOf("</script>", s);
  try { return JSON.parse(html.slice(s, e)); } catch { return null; }
}
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
async function download(found) {
  for (const [name, rurl] of found) {
    const safe = name.replace(/[\/:*?"<>|]/g, "_");
    if (existsSync(`${ATT}/${safe}`)) continue;
    try {
      const resp = await ctx.request.get(rurl, { timeout: 30000 });
      if (!resp.ok()) { console.error(`  FAIL ${resp.status()} ${name}`); continue; }
      await writeFile(`${ATT}/${safe}`, await resp.body());
      console.error(`  SAVED ${safe}`);
    } catch { console.error(`  ERR ${name}`); }
  }
}

const d = await nextData(`https://www.skool.com/${slug}/classroom`);
const courses = (d?.props?.pageProps?.allCourses || []).map(c => c.course || c);
console.error(`${courses.length} courses`);
for (const c of courses) {
  const title = c.metadata?.title || c.name;
  const cd = await nextData(`https://www.skool.com/${slug}/classroom/${c.name}`);
  if (!cd) { console.error(`== ${title}: page fetch failed`); continue; }
  const ids = []; moduleIds(cd.props.pageProps.course, ids);
  console.error(`== ${title}: ${ids.length} modules`);
  const found = new Map();
  collectAtt(cd.props.pageProps, found);
  for (const id of ids) {
    const md = await nextData(`https://www.skool.com/${slug}/classroom/${c.name}?md=${id}`);
    if (md) collectAtt(md.props.pageProps, found);
  }
  if (found.size) { console.error(`  ${found.size} attachments in ${title}`); await download(found); }
}
console.error("SWEEP COMPLETE");
process.exit(0);
