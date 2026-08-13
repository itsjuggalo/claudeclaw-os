// FINAL: classroom resource downloader.
// Course pages (browser-rendered) → NEXT_DATA "resources" [{title,file_id,file_name}] per lesson
// → POST api2.skool.com/files/<id>/download-url → download signed URL.
// Throttled, resumable (skips existing), 20-min watchdog.
// Usage: node pull-classroom-resources.mjs <group-slug>
import { chromium } from "playwright";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";

setTimeout(() => { console.error("WATCHDOG 20min — exiting"); process.exit(2); }, 20 * 60 * 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const slug = process.argv[2] || "earlyaidopters";
const ATT = `${process.env.HOME}/mc-kb/notes/skool/${slug}-attachments/classroom`;
await mkdir(ATT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
const nextData = async () => JSON.parse(await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}"));

await page.goto(`https://www.skool.com/${slug}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
const d = await nextData();
const courses = (d.props?.pageProps?.allCourses || []).map(c => c.course || c);
console.error(`${courses.length} courses`);

// gather resources from every course tree
const files = []; // {course, lesson, title, file_id, file_name}
for (const c of courses) {
  const ctitle = c.metadata?.title || c.name;
  try {
    await page.goto(`https://www.skool.com/${slug}/classroom/${c.name}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const cd = await nextData();
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const co = n.course || n;
      if (typeof co.metadata?.resources === "string") {
        try { for (const res of JSON.parse(co.metadata.resources))
          files.push({ course: ctitle, lesson: co.metadata.title || "", title: res.title, file_id: res.file_id, file_name: res.file_name }); } catch {}
      }
      for (const ch of n.children || co.children || []) walk(ch);
    })(cd.props.pageProps.course);
    console.error(`== ${ctitle}: cumulative resources ${files.length}`);
    await sleep(1500);
  } catch (e) { console.error(`== ${ctitle}: ERR ${e.message.split(String.fromCharCode(10))[0]}`); }
}
console.error(`TOTAL resource files: ${files.length}`);

let dl = 0, skip = 0, fail = 0;
for (const f of files) {
  const safe = `${f.course}__${f.file_name}`.replace(/[\/:*?"<>|\n]/g, "_").replace(/\s+/g, "_").slice(0, 150);
  const dest = `${ATT}/${safe}`;
  if (existsSync(dest)) { skip++; continue; }
  try {
    const ur = await ctx.request.post(`https://api2.skool.com/files/${f.file_id}/download-url?expire=28800`, { timeout: 20000 });
    if (!ur.ok()) { fail++; console.error(`  FAIL-url ${ur.status()} ${f.file_name}`); await sleep(700); continue; }
    const signed = (await ur.text()).trim();
    const fr = await ctx.request.get(signed, { timeout: 60000 });
    if (!fr.ok()) { fail++; console.error(`  FAIL-dl ${fr.status()} ${f.file_name}`); await sleep(700); continue; }
    await writeFile(dest, await fr.body());
    dl++;
    if (dl % 20 === 0) console.error(`  ...${dl} downloaded`);
    await sleep(500);
  } catch (e) { fail++; console.error(`  ERR ${f.file_name}`); await sleep(700); }
}
await appendFile(`${ATT}/_manifest.jsonl`, files.map(f => JSON.stringify(f)).join("\n") + "\n");
console.error(`DONE: ${dl} downloaded, ${skip} skipped, ${fail} failed → ${ATT}`);
process.exit(0);
