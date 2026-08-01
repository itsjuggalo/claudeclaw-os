import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const ctx = await (await chromium.launch({ headless: true })).newContext({ storageState: STATE });
const fid = "d9aad908f27641e9a5b60fbb7736b9f6";
for (const [m, u, data] of [
  ["post", `https://api.skool.com/files/${fid}`, {}],
  ["post", `https://api.skool.com/files/${fid}/sign`, {}],
  ["post", `https://api.skool.com/files/${fid}/download`, {}],
  ["get",  `https://api.skool.com/files/${fid}/url`, null],
  ["get",  `https://api.skool.com/files/${fid}/signed-url`, null],
]) {
  try {
    const r = m === "post" ? await ctx.request.post(u, { data, timeout: 15000 }) : await ctx.request.get(u, { timeout: 15000 });
    console.log(m.toUpperCase(), r.status(), u, "|", (await r.text()).slice(0, 200).replace(/\n/g, " "));
  } catch (e) { console.log("ERR", u, e.message.slice(0, 60)); }
}
process.exit(0);
