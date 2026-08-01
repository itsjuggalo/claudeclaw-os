import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const ctx = await (await chromium.launch({ headless: true })).newContext({ storageState: STATE });
const fid = "d9aad908f27641e9a5b60fbb7736b9f6";
const gid = "bfa7fd344ca145308ad35b97744b807c";
for (const u of [
  `https://www.skool.com/api/files/${fid}`,
  `https://www.skool.com/api/files/${fid}/download`,
  `https://api.skool.com/files/${fid}`,
  `https://assets.skool.com/f/${gid}/${fid}`,
  `https://www.skool.com/api/file/${fid}`,
]) {
  try {
    const r = await ctx.request.get(u, { timeout: 15000, maxRedirects: 2 });
    const ct = r.headers()["content-type"] || "";
    const body = await r.text().catch(() => "");
    console.log(r.status(), ct.slice(0, 40), u, "|", body.slice(0, 120).replace(/\n/g, " "));
  } catch (e) { console.log("ERR", u, e.message.slice(0, 60)); }
}
process.exit(0);
