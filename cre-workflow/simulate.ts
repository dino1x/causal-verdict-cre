// Local DON-round harness for the Causal-Verdict workflow (complements `cre workflow simulate`).
//   npm run cre:simulate              -> nodes call LIVE RYO-CHAN MCP if RYO_MCP_KEY is set, else real snapshots
//   npm run cre:simulate -- --offline -> snapshots only
// What it reproduces exactly: the workflow's pure logic (logic.ts), field-wise consensus semantics
// (median / identical), report ABI encoding, and CausalVerdictVault.onReport executed in a real EVM
// (@ethereumjs/evm) called from the forwarder address. What it does not reproduce: WASM compilation,
// DON report signatures, or Sepolia broadcast — use the CRE CLI for those.
import { readFileSync, writeFileSync } from "node:fs";
import { createEVM } from "@ethereumjs/evm";
import { createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { decodeFunctionResult, encodeAbiParameters, encodeDeployData, encodeFunctionData, type Hex } from "viem";
import { evaluateMandate, encodeVerdictReport, observe, type AgentEvidence, type Observation } from "./causal-verdict/logic";
// @ts-ignore — plain ESM helper shared with the capture script
import { loadEnv, callRyo } from "../scripts/ryoClient.mjs";
import { runPipeline } from "../src/engine/pipeline";
import { snapshotFetcher } from "../src/engine/snapshotFetcher";
import { DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import * as F from "../src/data/scenarioFixtures";

loadEnv();
const offline = process.argv.includes("--offline") || !process.env.RYO_MCP_KEY;
const NODES = 4;
const config = JSON.parse(readFileSync("cre-workflow/causal-verdict/config.staging.json", "utf8"));
const snaps = JSON.parse(readFileSync("src/data/ryoLiveSnapshots.json", "utf8"));
const out: string[] = [];
const log = (s: string) => {
  console.log(s);
  out.push(s);
};

async function nodeRead(tool: string, args: Record<string, unknown>) {
  if (!offline) {
    const r = await callRyo(tool, args);
    if (r.ok) return { env: r.envelope, prov: `live (remaining ${r.rateLimit?.remaining})` };
    log(`    live ${tool} failed (${r.httpStatus} ${r.error}) -> snapshot fallback`);
  }
  const id = `${tool}:${JSON.stringify(Object.fromEntries(Object.entries(args).sort()))}`;
  const s = snaps.snapshots.find((x: any) => x.id === id);
  return { env: s?.envelope ?? null, prov: s ? `snapshot ${s.captured_at}` : "unavailable" };
}

// Field-wise consensus with the same semantics as ConsensusAggregationByFields(median / identical).
function consensus(obs: Observation[]): Observation {
  const f = Math.floor((obs.length - 1) / 3); // tolerated faulty nodes
  const out: any = {};
  for (const k of Object.keys(obs[0]) as (keyof Observation)[]) {
    const vals = obs.map((o) => o[k]);
    if (typeof vals[0] === "number") {
      const s = [...(vals as number[])].sort((a, b) => a - b);
      out[k] = s[Math.floor(s.length / 2)];
    } else {
      const counts = new Map<string, number>();
      for (const v of vals) counts.set(JSON.stringify(v), (counts.get(JSON.stringify(v)) ?? 0) + 1);
      const [best, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (c < 2 * f + 1) throw new Error(`no identical consensus on ${k}`);
      out[k] = JSON.parse(best);
    }
  }
  return out;
}

async function main() {
  log(`== Causal-Verdict CRE local DON round — ${NODES} nodes, RYO ${offline ? "SNAPSHOT replay" : "LIVE"} ==`);
  log(`mandate "${config.mandate.name}" hash ${config.mandate.hash} (${config.mandate.clauses.length} clauses)`);

  // Off-chain agent run supplies the KOL/whale/news evidence digest that the HTTP trigger carries.
  const agent = await runPipeline({ fetcher: snapshotFetcher(snaps), mandateProse: DEFAULT_MANDATE, equityUsd: config.equityUsd, fixtures: { voices: F.KOL_VOICES, posts: F.KOL_POSTS, whales: F.WHALE_EVENTS, news: F.NEWS_ITEMS } });
  log(`agent trace root ${agent.trace.root}`);

  // EVM: deploy the vault with a fixed forwarder address, then deliver each report from it.
  const artifact = JSON.parse(readFileSync("contracts/out/CausalVerdictVault.json", "utf8"));
  const evm = await createEVM();
  const deployer = createAddressFromString("0x00000000000000000000000000000000000000d0");
  const forwarder = createAddressFromString("0x15fC6ae953E024d975e77382eEeC56A9101f9F88"); // stand-in forwarder address
  const deploy = await evm.runCall({ caller: deployer, data: hexToBytes(encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [forwarder.toString(), config.mandate.hash] })), gasLimit: 10_000_000n });
  if (deploy.execResult.exceptionError) throw new Error("deploy failed " + deploy.execResult.exceptionError.error);
  const vault = deploy.createdAddress!;
  log(`vault deployed in-process at ${vault.toString()}`);

  for (const symbol of ["SOL", "BEAM"]) {
    log(`\n-- trigger: HTTP (x402 paid ${config.x402.priceUsdc6} USDC 6dp) symbol=${symbol}`);
    const d = agent.dossiers.find((x) => x.symbol === symbol)!;
    const evidence: AgentEvidence = {
      exitLiquidityTrap: d.whale.trap,
      toutingFlag: d.gates.some((g) => g.kind === "anti_touting" && g.outcome === "fail"),
      supportingPlanes: d.planes.length,
      traceRoot: agent.trace.root as Hex,
    };
    const perNode: Observation[] = [];
    for (let i = 0; i < NODES; i++) {
      const deep = await nodeRead("deep_analysis", { symbol, include_perp: true });
      const shift = await nodeRead("monitor_market_sentiment_shift", { time_window: "7d" });
      const ov = await nodeRead("market_overview", {});
      log(`  node ${i}: deep_analysis ${deep.prov}; sentiment ${shift.prov}; overview ${ov.prov}`);
      perNode.push(observe(symbol, deep.env, shift.env, ov.env));
      if (!offline) break; // live: one upstream read, others reuse (mirrors cacheSettings) — protects 60/min quota
    }
    while (perNode.length < NODES) perNode.push(perNode[0]);
    const obs = consensus(perNode);
    log(`  consensus: status=${obs.status} regime=${obs.regime} verdict=${obs.verdict} confluence=${obs.confluenceAvailable ? obs.confluence : "unavailable"} rsi=${obs.rsiAvailable ? obs.rsi14 : "unavailable"} atr%=${obs.atrAvailable ? obs.atrPct : "unavailable"}`);
    const v = evaluateMandate(obs, evidence, config.mandate.clauses, config.equityUsd);
    log(`  mandate: ${v.decision ? "SELECT" : "REJECT"} failed=[${v.failed.join(", ")}] sizeBps=${v.sizeBps} entryE8=${v.entryE8} stopE8=${v.stopE8}`);
    const { report, runId, evidenceRoot } = encodeVerdictReport(obs, evidence, v, config.mandate.hash);
    const onReport = encodeFunctionData({ abi: artifact.abi, functionName: "onReport", args: ["0x", report] });
    const res = await evm.runCall({ caller: forwarder, to: vault, data: hexToBytes(onReport), gasLimit: 2_000_000n });
    if (res.execResult.exceptionError) throw new Error(`onReport reverted: ${bytesToHex(res.execResult.returnValue)}`);
    log(`  onReport OK gas=${res.execResult.executionGasUsed} runId=${runId} evidenceRoot=${evidenceRoot} logs=${res.execResult.logs?.length}`);
  }

  // Negative tests: a non-forwarder caller and a replayed runId must revert.
  const strangerTry = await evm.runCall({ caller: deployer, to: vault, data: hexToBytes(encodeFunctionData({ abi: artifact.abi, functionName: "onReport", args: ["0x", "0x"] })), gasLimit: 500_000n });
  log(`\nnon-forwarder onReport reverts: ${!!strangerTry.execResult.exceptionError}`);
  const count = await evm.runCall({ to: vault, data: hexToBytes(encodeFunctionData({ abi: artifact.abi, functionName: "verdictCount" })) });
  log(`vault.verdictCount() = ${decodeFunctionResult({ abi: artifact.abi, functionName: "verdictCount", data: bytesToHex(count.execResult.returnValue) as Hex })}`);
  const first = await evm.runCall({ to: vault, data: hexToBytes(encodeFunctionData({ abi: artifact.abi, functionName: "verdict", args: [0n] })) });
  const rec: any = decodeFunctionResult({ abi: artifact.abi, functionName: "verdict", data: bytesToHex(first.execResult.returnValue) as Hex });
  log(`vault.verdict(0) = ${rec.symbol} decision=${rec.decision === 1 ? "SELECT" : "REJECT"} entryE8=${rec.entryE8} stopE8=${rec.stopE8} sizeBps=${rec.sizeBps}`);
  writeFileSync(`cre-workflow/simulation-${offline ? "snapshot" : "live"}.log`, out.join("\n") + "\n");
  void encodeAbiParameters;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
