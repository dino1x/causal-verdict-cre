// Captures REAL RYO-CHAN MCP responses from all 6 tools into src/data/ryoLiveSnapshots.json.
// Each snapshot keeps RYO's envelope verbatim plus our own capture metadata
// (HTTP status, rate-limit headers, SHA-256 of the canonical envelope). We hash; RYO does not sign.
//   node scripts/capture-ryo.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { loadEnv, callRyo, sha256, canonical } from "./ryoClient.mjs";

loadEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snapshots = [];
const log = [];

async function capture(tool, args) {
  const r = await callRyo(tool, args);
  const entry = {
    id: `${tool}:${canonical(args)}`,
    tool,
    args,
    captured_at: new Date().toISOString(),
    http_status: r.httpStatus,
    rate_limit: r.rateLimit ?? null,
    attempts: r.attempts,
    ok: r.ok,
    error: r.ok ? null : r.error,
    envelope: r.ok ? r.envelope : null,
    envelope_sha256: r.ok ? sha256(canonical(r.envelope)) : null,
  };
  snapshots.push(entry);
  log.push(`${r.ok ? "OK " : "ERR"} ${r.httpStatus} ${tool} ${JSON.stringify(args)} status=${r.envelope?.status ?? "-"} remaining=${r.rateLimit?.remaining ?? "-"}${r.ok ? "" : " " + r.error}`);
  console.log(log.at(-1));
  await sleep(1200); // stay well under 60/min
  return r.ok ? r.envelope : null;
}

const isStable = (c) => /USD|DAI|FDUSD|TUSD/.test(c.symbol) || (Math.abs((c.price_usd ?? 0) - 1) < 0.02 && Math.abs(c.change_24h_pct ?? 0) < 0.5);

await capture("market_overview", {});
await capture("monitor_market_sentiment_shift", { time_window: "7d" });
const scan = await capture("scan_market", { top_n: 10, filter_direction: "all" });
await capture("scan_market", { top_n: 8, filter_direction: "negative" });
await capture("scan_market", { top_n: 6, theme: "meme" });

// Deterministic shortlist: top-4 non-stable momentum names from the live scan.
const shortlist = (scan?.data?.candidates ?? []).filter((c) => !isStable(c)).slice(0, 4).map((c) => c.symbol);
const anchors = ["SOL", "PEPE"];
const universe = [...new Set([...shortlist, ...anchors])];
console.log("shortlist:", shortlist, "universe:", universe);

if (shortlist.length >= 2) await capture("compare_tokens", { symbols: shortlist.join(", "), intent: "swing" });
await capture("compare_tokens", { symbols: "SOL, PEPE, " + (shortlist[0] ?? "ETH"), intent: "swing" });
for (const s of universe) await capture("analyze_token", { symbol: s });
for (const s of [...new Set([...shortlist.slice(0, 2), ...anchors])]) await capture("deep_analysis", { symbol: s, include_perp: true });

mkdirSync("src/data", { recursive: true });
const out = {
  source: "RYO-CHAN MCP (https://app-ryochan.com/api/mcp) — REST /tools/<tool>/call",
  note: "Envelopes are verbatim RYO responses. envelope_sha256 = SHA-256 of key-sorted JSON, computed by Causal-Verdict at capture time.",
  captured_at: new Date().toISOString(),
  shortlist,
  universe,
  snapshots,
};
out.bundle_sha256 = sha256(canonical(snapshots.map((s) => s.envelope_sha256)));
writeFileSync("src/data/ryoLiveSnapshots.json", JSON.stringify(out, null, 2));
writeFileSync("src/data/ryoCaptureLog.txt", log.join("\n") + "\n");
console.log(`saved ${snapshots.length} snapshots, ${snapshots.filter((s) => s.ok).length} ok, bundle ${out.bundle_sha256}`);
