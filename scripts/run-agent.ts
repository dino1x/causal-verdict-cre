// Autonomous loop: runs the full agent on LIVE RYO + real feeds every N minutes and records the result
// in the practice-trade ledger (data/ledger.json, mirrored to src/data/ledgerSnapshot.json for the UI).
//   npx tsx scripts/run-agent.ts            # every 60 min until stopped
//   npx tsx scripts/run-agent.ts --once
// Calls are paced to RYO's 6/min fanout limit, so one run takes ~3-4 minutes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runPipeline } from "../src/engine/pipeline";
import { DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import { applyRun, emptyLedger, ledgerStats, verifyLedger, type Ledger } from "../src/engine/ledger";
import { proxyCall } from "../server/api";
import { collectFeeds, DEFAULT_TG_VOICES } from "../server/feeds";

const once = process.argv.includes("--once");
const minutes = Number(process.argv.find((a) => a.startsWith("--every="))?.split("=")[1] ?? 60);
const PATH = "data/ledger.json";
mkdirSync("data/runs", { recursive: true });
const load = (): Ledger => (existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : emptyLedger());

async function tick(): Promise<boolean> {
  const started = new Date().toISOString();
  const run = await runPipeline({
    fetcher: (t, a) => proxyCall(t, a, null, { patient: true }),
    mandateProse: DEFAULT_MANDATE,
    equityUsd: 100000,
    evidence: async (tokens, ref) => {
      const b = await collectFeeds(tokens, ref ?? started, DEFAULT_TG_VOICES);
      return { mode: "real", fixtures: b, sources: b.sources };
    },
  });
  const live = run.provenanceMix.live ?? 0;
  const isLive = (tool: string, sym?: string) => run.calls.some((c) => c.tool === tool && (sym === undefined || c.args.symbol === sym) && c.provenance === "live");
  // Only live RYO evidence may enter the ledger: the reference time comes from market_overview,
  // and a trade may open only if its own token reads were live (never from a replayed snapshot).
  const sym = run.practiceTrade?.position.symbol;
  const why = !isLive("market_overview") ? "market_overview not live" : sym && !(isLive("deep_analysis", sym) && isLive("analyze_token", sym)) ? `${sym} token reads not live` : null;
  const before = load();
  const after = why ? before : applyRun(before, run);
  const recorded = after.runs.length > before.runs.length;
  if (recorded) {
    writeFileSync(PATH, JSON.stringify(after, null, 2));
    writeFileSync("src/data/ledgerSnapshot.json", JSON.stringify(after, null, 2));
  }
  writeFileSync(`data/runs/${(run.referenceTime ?? started).replace(/[:.]/g, "-")}.json`, JSON.stringify({ referenceTime: run.referenceTime, traceRoot: run.trace.root, provenance: run.provenanceMix, decision: run.practiceTrade?.position.symbol ?? null, calls: run.calls.map((c) => ({ tool: c.tool, args: c.args, provenance: c.provenance, sha256: c.envelope_sha256, fallback: c.fallback_reason })), feeds: run.feedSources }, null, 2));
  console.log(`[${started}] ref=${run.referenceTime} live=${live}/${run.calls.length} decision=${run.practiceTrade?.position.symbol ?? "none"} ${recorded ? "RECORDED" : `NOT RECORDED (${why ?? "stale reference time"})`} ledger=${JSON.stringify(ledgerStats(after))} chain=${verifyLedger(after).ok ? "ok" : "BROKEN"}`);
  return recorded || !why; // retry soon only when live evidence was missing
}

for (;;) {
  let ok = false;
  try {
    ok = await tick();
  } catch (e) {
    console.log(`[${new Date().toISOString()}] run failed: ${(e as Error).message}`);
  }
  if (once) break;
  // A run without live evidence is retried after 5 minutes rather than waiting a full interval.
  await new Promise((r) => setTimeout(r, (ok ? minutes : Math.min(5, minutes)) * 60_000));
}
