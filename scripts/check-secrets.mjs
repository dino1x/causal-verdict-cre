// Fails if the RYO key (or any ryo_mcp_* credential) appears in a file that could be committed or shipped.
//   npm run check:secrets
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./ryoClient.mjs";

loadEnv();
const key = process.env.RYO_MCP_KEY ?? "";
const SKIP = new Set(["node_modules", ".git", ".env", ".env.local"]);
const needles = [/ryo_mcp_[A-Za-z0-9]{6,}_[A-Za-z0-9_-]{8,}/];
if (key.length > 12) needles.push(new RegExp(key.slice(-16).replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")));

const hits = [];
let scanned = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.size < 5_000_000) {
      scanned++;
      const text = readFileSync(p, "utf8");
      for (const re of needles) if (re.test(text)) hits.push(p);
    }
  }
}
walk(".");
if (hits.length) {
  console.error("SECRET FOUND in:\n  " + [...new Set(hits)].join("\n  "));
  process.exit(1);
}
console.log(`ok — scanned ${scanned} files (incl. dist/ if built); no RYO credential outside .env`);
