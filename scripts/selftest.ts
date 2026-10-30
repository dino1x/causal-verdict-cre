// Offline self-test: runs the full agent on captured RYO snapshots and checks invariants.
//   npm test
import { readFileSync } from "node:fs";
import { runPipeline, recordedFetcher, verifyTrace, hashHex } from "../src/engine/pipeline";
import { snapshotFetcher } from "../src/engine/snapshotFetcher";
import { compile, decompile, roundTrip, DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import { canonical } from "../src/engine/ryo";
import * as F from "../src/data/scenarioFixtures";

const snaps = JSON.parse(readFileSync("src/data/ryoLiveSnapshots.json", "utf8"));
const fixtures = { voices: F.KOL_VOICES, posts: F.KOL_POSTS, whales: F.WHALE_EVENTS, news: F.NEWS_ITEMS };
let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) fails++;
};

// 1. snapshot integrity
for (const s of snaps.snapshots) check(`snapshot sha256 ${s.id}`, hashHex(canonical(s.envelope)).slice(2) === s.envelope_sha256);

// 2. compiler round trip
const rt = roundTrip(DEFAULT_MANDATE);
check("mandate prose → AST → prose → AST is a fixpoint", rt.ok);
check("decompile(compile(canonical)) === canonical", decompile(compile(rt.canonicalProse!).ast!) === rt.canonicalProse);
check("ambiguous prose is rejected with a line number", compile("MANDATE \"x\"\n1. Buy whatever looks good.").errors[0]?.line === 2);

// 3. full run + deterministic replay
const run = await runPipeline({ fetcher: snapshotFetcher(snaps), mandateProse: DEFAULT_MANDATE, equityUsd: 100_000, fixtures });
check("all calls served from real snapshots", run.calls.every((c) => c.provenance === "snapshot"), JSON.stringify(run.provenanceMix));
check("trace verifies", verifyTrace(run.trace.steps).ok);
const replay = await runPipeline({ fetcher: recordedFetcher(run.calls), mandateProse: DEFAULT_MANDATE, equityUsd: 100_000, fixtures });
check("replay reproduces identical trace root", replay.trace.root === run.trace.root, run.trace.root);
const tampered = structuredClone(run.trace.steps);
(tampered[1].payload as any).market.regime = "risk_on";
check("tampering a step breaks the chain", !verifyTrace(tampered).ok);

for (const d of run.dossiers)
  console.log(`  ${d.symbol.padEnd(6)} ${d.judgment.decision.padEnd(7)} bull=${d.judgment.bullScore} bear=${d.judgment.bearScore} planes=[${d.planes}] failed=[${d.judgment.failedGates.map((g) => `${g.id}:${g.kind}`).join(" ")}]`);
const beam = run.dossiers.find((d) => d.symbol === "BEAM");
check("BEAM exit-liquidity trap detected", !!beam?.whale.trap, beam?.whale.detail);
check("BEAM null RSI is a failed gate, not 0", !!beam?.gates.find((g) => g.kind === "require_measurement" && g.outcome === "fail"));
console.log("practice trade:", run.practiceTrade ? JSON.stringify(run.practiceTrade.position, null, 1) : "none");
console.log(`trace root ${run.trace.root}`);
console.log(fails ? `${fails} check(s) failed` : "scenario checks passed");

// 4. real-feed evidence (bundled capture): deterministic, provenance-tagged
const { realFeedProvider, FEED_SNAPSHOT } = await import("../src/client/evidence");
const realRun = await runPipeline({ fetcher: snapshotFetcher(snaps), mandateProse: DEFAULT_MANDATE, equityUsd: 100_000, evidence: realFeedProvider(false, [], []) });
check("real-feed run uses the bundled capture for this reference time", realRun.evidenceMode === "real" && realRun.evidenceUsed.whales.length === FEED_SNAPSHOT.whales.length, `${realRun.evidenceUsed.whales.length} whale events, ${realRun.evidenceUsed.news.length} news`);
check("every real whale event links to an explorer or post", realRun.evidenceUsed.whales.every((w) => /^https:\/\/(etherscan\.io|bscscan\.com|t\.me)\//.test(w.source ?? "")));
check("no real evidence is timestamped after the reference time", [...realRun.evidenceUsed.whales, ...realRun.evidenceUsed.news, ...realRun.evidenceUsed.posts].every((x) => x.minutes <= 0));
const realReplay = await runPipeline({ fetcher: recordedFetcher(realRun.calls), mandateProse: DEFAULT_MANDATE, equityUsd: 100_000, evidence: async () => ({ mode: "real", fixtures: realRun.evidenceUsed, sources: realRun.feedSources }) });
check("real-feed run replays to an identical root", realReplay.trace.root === realRun.trace.root, realRun.trace.root);
for (const d of realRun.dossiers)
  console.log(`  [real] ${d.symbol.padEnd(6)} ${d.judgment.decision.padEnd(7)} bull=${d.judgment.bullScore} bear=${d.judgment.bearScore} planes=[${d.planes}] whale=${d.whale.events.length} failed=[${d.judgment.failedGates.map((g) => `${g.id}:${g.kind}`).join(" ")}]`);
console.log(fails ? `${fails} check(s) failed` : "real-feed checks passed");
if (fails) process.exit(1);
