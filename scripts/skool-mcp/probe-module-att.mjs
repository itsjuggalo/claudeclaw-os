import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const ctx = await (await chromium.launch({ headless: true })).newContext({ storageState: STATE });
const r = await ctx.request.get(process.argv[2]);
const html = await r.text();
const i = html.indexOf("__NEXT_DATA__");
const s = html.indexOf(">", i) + 1, e = html.indexOf("</script>", s);
const data = html.slice(s, e);
console.log("bytes:", data.length);
for (const kw of ["attachment", "file_name", "read_url", "Text •", "\\\"files\\\""]) {
  const idx = data.indexOf(kw);
  console.log(kw, "@", idx);
  if (idx > 0) console.log("  ctx:", data.slice(Math.max(0,idx-150), idx+250));
}
process.exit(0);
