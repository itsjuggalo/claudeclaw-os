import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const st = JSON.parse(readFileSync(STATE, "utf-8"));
const tok = st.cookies.find(c => c.name === "auth_token")?.value;
const ctx = await (await chromium.launch({ headless: true })).newContext({ storageState: STATE });
const fid = "d9aad908f27641e9a5b60fbb7736b9f6";
for (const [label, opts] of [
  ["bearer", { headers: { authorization: `Bearer ${tok}` } }],
  ["options-probe", { method: "OPTIONS" }],
]) {
  try {
    const r = label === "options-probe"
      ? await ctx.request.fetch(`https://api.skool.com/files/${fid}`, { method: "OPTIONS", timeout: 15000 })
      : await ctx.request.get(`https://api.skool.com/files/${fid}`, { ...opts, timeout: 15000 });
    console.log(label, r.status(), JSON.stringify(r.headers()).slice(0, 300));
    console.log("  body:", (await r.text()).slice(0, 300).replace(/\n/g, " "));
  } catch (e) { console.log(label, "ERR", e.message.slice(0, 80)); }
}
process.exit(0);
