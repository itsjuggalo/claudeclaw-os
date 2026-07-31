// 2026 classroom scraper: courses come from __NEXT_DATA__ allCourses; each course page
// carries the full module tree in NEXT_DATA. Saves lessons as md + downloads attachments.
// Usage: node pull-classroom-2026.mjs <group-slug>
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const slug = process.argv[2] || "earlyaidopters";
const OUT = `${process.env.HOME}/mc-kb/notes/skool/${slug}-classroom`;
const ATT = `${process.env.HOME}/mc-kb/notes/skool/${slug}-attachments`;
await mkdir(OUT, { recursive: true });
await mkdir(ATT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();

async function nextData() {
  const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}");
  return JSON.parse(raw);
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
function walkModules(node, courseTitle, acc, depth) {
  if (!node || typeof node !== "object") return;
  const co = node.course || node;
  const md = co.metadata || {};
  if (md.title && (md.description || md.videoLink || md.videoLinksData)) {
    acc.push({ course: courseTitle, title: md.title, desc: md.description || "", video: md.videoLink || "", id: co.id });
  }
  for (const ch of node.children || co.children || []) walkModules(ch, courseTitle, acc, depth+1);
}

await page.goto(`https://www.skool.com/${slug}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
const d = await nextData();
const courses = (d.props.pageProps.allCourses || []).map(c => c.course || c);
console.error(`${courses.length} courses`);

let saved = 0; const allAtt = new Map();
for (const c of courses) {
  const title = c.metadata?.title || c.name;
  console.error(`\n== ${title} (${c.name})`);
  try {
    await page.goto(`https://www.skool.com/${slug}/classroom/${c.name}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const cd = await nextData();
    const courseTree = cd.props.pageProps.course;
    const lessons = [];
    walkModules(courseTree, title, lessons, 0);
    collectAtt(cd.props.pageProps, allAtt);
    console.error(`  ${lessons.length} lessons w/ content`);
    for (const l of lessons) {
      const safe = `${title}__${l.title}`.replace(/[\/:*?"<>|\n]/g, "").replace(/\s+/g, "_").slice(0, 120);
      const body = `---\ncourse: ${JSON.stringify(title)}\nlesson: ${JSON.stringify(l.title)}\ngroup_slug: ${slug}\nsource: skool-classroom\nvideo: ${JSON.stringify(l.video)}\ningested_at: ${new Date().toISOString()}\n---\n\n# ${l.title}\n\n${l.desc}\n`;
      await writeFile(`${OUT}/${safe}.md`, body);
      saved++;
    }
  } catch (e) { console.error(`  ERR ${e.message.split(String.fromCharCode(10))[0]}`); }
}
console.error(`\nlessons saved: ${saved}; attachments discovered: ${allAtt.size}`);
for (const [name, rurl] of allAtt) {
  try {
    const resp = await ctx.request.get(rurl);
    if (!resp.ok()) { console.error(`  FAIL ${resp.status()} ${name}`); continue; }
    const buf = await resp.body();
    await writeFile(`${ATT}/${name.replace(/[\/:*?"<>|]/g, "_")}`, buf);
    console.error(`  SAVED ${name} (${buf.length}b)`);
  } catch { console.error(`  ERR ${name}`); }
}
await browser.close();
