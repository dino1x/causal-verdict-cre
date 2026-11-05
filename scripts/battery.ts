// Attack battery: tamper with copies of the ledger and of a reasoning trace in every way we could think of, and
// count what the verifier misses. Two verifiers are scored separately:
//   chain   — the hash chains alone (events, runs, sealed positions, trace steps)
//   witness — the chains plus a ledger head published outside the operator's control (git, Bitcoin, Sigstore)
// Truncating the tail or re-hashing the whole history produces a valid chain, so only the witnessed head catches it.
// That is the reason the head is published, and the report says so instead of hiding the misses.
//   npx tsx scripts/battery.ts            # writes src/data/batteryReport.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runPipeline, verifyTrace, hashHex, scenarioEvidence, type TraceStep } from "../src/engine/pipeline";
import { snapshotFetcher } from "../src/engine/snapshotFetcher";
import { DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import { canonical } from "../src/engine/ryo";
import { applyRun, emptyLedger, ledgerHead, sealLedger, verifyLedger, type Ledger } from "../src/engine/ledger";
import * as F from "../src/data/scenarioFixtures";

type Attack = { name: string; kind: string; mutate: (x: any) => void };
const ZERO = "0x" + "0".repeat(64);

// Re-hash everything after an edit, as a capable attacker with write access would.
function rehashLedger(l: Ledger) {
  let prev = ZERO;
  l.events.forEach((e, i) => {
    const { prev: _p, hash: _h, i: _i, ...body } = e;
    e.i = i;
    e.prev = prev;
    e.hash = hashHex(`${prev}|${i}|${canonical(body)}`);
    prev = e.hash;
  });
  let rprev = ZERO;
  l.runs.forEach((r, i) => {
    if (r.hash === undefined) return;
    if (i === l.runs.length - 1 && r.stateHash) r.stateHash = hashHex(canonical(l.positions));
    const { prev: _p, hash: _h, ...body } = r;
    r.prev = rprev;
    r.hash = hashHex(`${rprev}|${i}|${canonical(body)}`);
    rprev = r.hash;
  });
}

function ledgerAttacks(l: Ledger): Attack[] {
  const a: Attack[] = [];
  l.events.forEach((_, i) => {
    a.push({ name: `event ${i}: edit detail`, kind: "edit", mutate: (x: Ledger) => (x.events[i].detail += " (edited)") });
    a.push({ name: `event ${i}: change time`, kind: "edit", mutate: (x: Ledger) => (x.events[i].at = "2020-01-01T00:00:00Z") });
    a.push({ name: `event ${i}: delete`, kind: i === l.events.length - 1 ? "truncate" : "delete", mutate: (x: Ledger) => x.events.splice(i, 1) });
    if (i + 1 < l.events.length) a.push({ name: `event ${i}: swap with next`, kind: "swap", mutate: (x: Ledger) => ([x.events[i], x.events[i + 1]] = [x.events[i + 1], x.events[i]]) });
  });
  l.runs.forEach((r, i) => {
    a.push({ name: `run ${i}: flip decision`, kind: "edit", mutate: (x: Ledger) => (x.runs[i].decision = x.runs[i].decision === "NO TRADE" ? "SELECT SOL" : "NO TRADE") });
    a.push({ name: `run ${i}: rewrite provenance`, kind: "edit", mutate: (x: Ledger) => (x.runs[i].provenance = { live: 99 }) });
    // Target a rejected candidate: a selected one has no reasons to erase, so "erasing" them would change nothing.
    const rejected = r.candidates?.findIndex((c) => c.failed?.length) ?? -1;
    if (rejected >= 0) a.push({ name: `run ${i}: erase a rejection reason`, kind: "edit", mutate: (x: Ledger) => (x.runs[i].candidates![rejected].failed = []) });
    a.push({ name: `run ${i}: delete`, kind: i === l.runs.length - 1 ? "truncate" : "delete", mutate: (x: Ledger) => x.runs.splice(i, 1) });
    if (i + 1 < l.runs.length) a.push({ name: `run ${i}: swap with next`, kind: "swap", mutate: (x: Ledger) => ([x.runs[i], x.runs[i + 1]] = [x.runs[i + 1], x.runs[i]]) });
  });
  l.positions.forEach((_, i) => {
    a.push({ name: `position ${i}: turn loss into profit`, kind: "edit", mutate: (x: Ledger) => (x.positions[i].realizedPnlUsd = Math.abs(x.positions[i].realizedPnlUsd) + 1000) });
    a.push({ name: `position ${i}: move the stop`, kind: "edit", mutate: (x: Ledger) => (x.positions[i].stopNow = x.positions[i].stopNow * 0.5) });
    a.push({ name: `position ${i}: delete`, kind: "delete", mutate: (x: Ledger) => x.positions.splice(i, 1) });
  });
  if (l.events.length) a.push({ name: "truncate the last event", kind: "truncate", mutate: (x: Ledger) => x.events.pop() });
  if (l.runs.length) a.push({ name: "truncate the last run", kind: "truncate", mutate: (x: Ledger) => x.runs.pop() });
  // Every edit again, followed by a full re-hash of the history.
  for (const base of a.filter((x) => x.kind !== "truncate"))
    a.push({ name: `${base.name}, then re-hash all history`, kind: "rehash", mutate: (x: Ledger) => (base.mutate(x), rehashLedger(x)) });
  return a;
}

function scoreLedger(label: string, l: Ledger) {
  const head = ledgerHead(l);
  if (!verifyLedger(l).ok) throw new Error(`${label}: ledger does not verify before the attacks`);
  const missed = { chain: [] as string[], witness: [] as string[] };
  const byKind: Record<string, { attacks: number; missedByChain: number; missedWithWitness: number }> = {};
  const attacks = ledgerAttacks(l);
  for (const at of attacks) {
    const x = structuredClone(l);
    at.mutate(x);
    const chainCaught = !verifyLedger(x).ok;
    const witnessCaught = chainCaught || ledgerHead(x) !== head;
    const k = (byKind[at.kind] ??= { attacks: 0, missedByChain: 0, missedWithWitness: 0 });
    k.attacks++;
    if (!chainCaught) (missed.chain.push(at.name), k.missedByChain++);
    if (!witnessCaught) (missed.witness.push(at.name), k.missedWithWitness++);
  }
  return { label, head, attacks: attacks.length, missedByChain: missed.chain.length, missedWithWitness: missed.witness.length, byKind, witnessMisses: missed.witness };
}

function scoreTrace(steps: TraceStep[]) {
  const root = steps[steps.length - 1].hash;
  const attacks: Attack[] = [];
  steps.forEach((s, i) => {
    attacks.push({ name: `step ${i}: edit payload`, kind: "edit", mutate: (x: TraceStep[]) => ((x[i].payload as any) = { ...(x[i].payload as any), tampered: true }) });
    attacks.push({ name: `step ${i}: relabel`, kind: "edit", mutate: (x: TraceStep[]) => (x[i].label += "-x") });
    attacks.push({ name: `step ${i}: delete`, kind: i === steps.length - 1 ? "truncate" : "delete", mutate: (x: TraceStep[]) => x.splice(i, 1) });
    if (i + 1 < steps.length) attacks.push({ name: `step ${i}: swap with next`, kind: "swap", mutate: (x: TraceStep[]) => ([x[i], x[i + 1]] = [x[i + 1], x[i]]) });
  });
  attacks.push({ name: "truncate the last step", kind: "truncate", mutate: (x: TraceStep[]) => x.pop() });
  let chain = 0, withRoot = 0;
  const byKind: Record<string, { attacks: number; missedByChain: number; missedWithWitness: number }> = {};
  for (const at of attacks) {
    const x = structuredClone(steps);
    at.mutate(x);
    const c = !verifyTrace(x).ok;
    const k = (byKind[at.kind] ??= { attacks: 0, missedByChain: 0, missedWithWitness: 0 });
    k.attacks++;
    if (!c) (chain++, k.missedByChain++);
    if (!c && x[x.length - 1]?.hash === root) (withRoot++, k.missedWithWitness++);
  }
  return { label: "reasoning trace (scenario run)", root, attacks: attacks.length, missedByChain: chain, missedWithWitness: withRoot, byKind };
}

// 1. The live ledger, as recorded by the autonomous loop.
const livePath = existsSync("data/ledger.json") ? "data/ledger.json" : "src/data/ledgerSnapshot.json";
const live: Ledger = sealLedger(JSON.parse(readFileSync(livePath, "utf8")));

// 2. A synthetic ledger with an opened, partly filled and closed position, so position attacks are exercised.
//    Built from the scenario run and three price observations; labelled synthetic in the report.
const snaps = JSON.parse(readFileSync("src/data/ryoLiveSnapshots.json", "utf8"));
const run = await runPipeline({ fetcher: snapshotFetcher(snaps), mandateProse: DEFAULT_MANDATE, equityUsd: 100_000, evidence: scenarioEvidence({ voices: F.KOL_VOICES, posts: F.KOL_POSTS, whales: F.WHALE_EVENTS, news: F.NEWS_ITEMS }) });
const fake = (at: string, price: number, root: string) => ({ referenceTime: at, trace: { root }, practiceTrade: null, provenanceMix: { live: 1 }, evidenceMode: "real", mandateHash: "0x", dossiers: [], calls: [{ tool: "analyze_token", args: { symbol: "SOL" }, provenance: "live", envelope_sha256: "ab", envelope: { as_of: at, data: { market: { price_usd: price } } } }] }) as any;
let syn = applyRun(emptyLedger(), run);
const p0 = syn.positions[0];
const t0 = Date.parse(run.referenceTime!);
const iso = (h: number) => new Date(t0 + h * 3_600_000).toISOString();
syn = applyRun(syn, fake(iso(1), p0.targets[0].price + 0.01, "0xr2"));
syn = applyRun(syn, fake(iso(2), p0.entry - 0.5, "0xr3"));

const report = {
  note: "chain = hash chains alone; witness = chains plus a ledger head published where the operator cannot rewrite it. Truncation and full re-hashing yield a valid chain by construction, so only the witnessed head catches them.",
  results: [scoreLedger(`live ledger (${livePath}, ${live.runs.length} runs)`, live), scoreLedger("synthetic ledger (scenario run + 2 price observations)", syn), scoreTrace(run.trace.steps)],
};
const total = report.results.reduce((n, r) => n + r.attacks, 0);
const missed = report.results.reduce((n, r) => n + r.missedWithWitness, 0);
const chainMissed = report.results.reduce((n, r) => n + r.missedByChain, 0);
for (const r of report.results) console.log(`${r.label}: ${r.attacks} attacks · with witnessed head missed ${r.missedWithWitness} · chain alone missed ${r.missedByChain} [${Object.entries(r.byKind).filter(([, v]) => v.missedByChain).map(([k, v]) => `${k} ${v.missedByChain}/${v.attacks}`).join(", ")}]`);
console.log(`TOTAL ${total} attacks · chain alone missed ${chainMissed} (truncations and full re-hashes) · with witnessed head missed ${missed}`);
writeFileSync("src/data/batteryReport.json", JSON.stringify({ ...report, total, missedByChain: chainMissed, missedWithWitness: missed }, null, 2) + "\n");
if (missed) process.exit(1);
