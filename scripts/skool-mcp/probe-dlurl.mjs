import { chromium } from "playwright";
const STATE = `${process.env.HOME}/skool-mcp/storageState.json`;
const ctx = await (await chromium.launch({ headless: true })).newContext({ storageState: STATE });
const r = await ctx.request.post("https://api2.skool.com/files/d9aad908f27641e9a5b60fbb7736b9f6/download-url?expire=28800", { timeout: 15000 });
console.log(r.status(), (await r.text()).slice(0, 400));
process.exit(0);
