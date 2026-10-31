// Offline test of the autonomous loop's patient RYO mode against a local mock (no real RYO call).
// The mock answers 429 "6/min for mcp_fanout" with Retry-After: 1 once, then a live envelope.
//   npx tsx scripts/patient-test.ts
import { createServer } from "node:http";

let hits = 0;
const server = createServer((req, res) => {
  hits++;
  if (hits === 1) {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" });
    return res.end(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Rate limit exceeded (6/min for mcp_fanout)." } }));
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ schema_version: "mock", tool: "analyze_token", status: "ok", data_mode: "mock", as_of: "2026-10-31T00:00:00Z", data: {} }));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.RYO_MCP_URL = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.RYO_MCP_KEY = "mock-key";
const { proxyCall } = await import("../server/api");

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) fails++;
};
const fast = await proxyCall("analyze_token", { symbol: "SOL" }, null);
check("interactive call falls back on 429 instead of waiting", fast.provenance !== "live", fast.fallback_reason ?? "");
hits = 0;
const t0 = Date.now();
const patient = await proxyCall("analyze_token", { symbol: "SOL" }, null, { patient: true });
check("patient call waits out Retry-After and returns live", patient.provenance === "live" && hits === 2, `${hits} hits, ${Date.now() - t0} ms`);
check("patient call honoured Retry-After (≥1s)", Date.now() - t0 >= 1000);
server.close();
if (fails) process.exit(1);
console.log("patient-mode checks passed");
