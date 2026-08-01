import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const slug = "earlyaidopters";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE });
const page = await ctx.newPage();
const nextData = async () => JSON.parse(await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || "{}"));
await page.goto(`https://www.skool.com/${slug}/classroom`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
const d = await nextData();
const courses = (d.props?.pageProps?.allCourses || []).map(c => c.course || c);
let out = "# Classroom link-resources (non-file) — earlyaidopters\n";
for (const c of courses) {
  const ctitle = c.metadata?.title || c.name;
  try {
    await page.goto(`https://www.skool.com/${slug}/classroom/${c.name}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const cd = await nextData();
    const rows = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const co = n.course || n;
      if (typeof co.metadata?.resources === "string") {
        try { for (const r of JSON.parse(co.metadata.resources)) if (!r.file_name)
          rows.push(`- [${r.title || "link"}](${r.url || r.link || JSON.stringify(r)}) — lesson: ${co.metadata.title || ""}`); } catch {}
      }
      for (const ch of n.children || co.children || []) walk(ch);
    })(cd.props.pageProps.course);
    if (rows.length) out += `\n## ${ctitle}\n` + rows.join("\n") + "\n";
  } catch {}
}
await writeFile(`${process.env.HOME}/mc-kb/notes/skool/${slug}-attachments/classroom/_link-resources.md`, out);
console.error("link resources written:", out.split("\n- ").length - 1);
process.exit(0);
