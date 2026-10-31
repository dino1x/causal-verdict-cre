// Regenerate the sample regulatory documents in examples/ from the bundled real RYO snapshots.
// BEAM's STOR is built on the scenario fixtures (the trap pattern), and the file name says so.
//   npx tsx scripts/gen-examples.ts
import { readFileSync, writeFileSync } from "node:fs";
import { runPipeline, scenarioEvidence } from "../src/engine/pipeline";
import { snapshotFetcher } from "../src/engine/snapshotFetcher";
import { DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import { complianceMemo, draftStor } from "../src/engine/regulatory";
import * as F from "../src/data/scenarioFixtures";

const snaps = JSON.parse(readFileSync("src/data/ryoLiveSnapshots.json", "utf8"));
const run = await runPipeline({ fetcher: snapshotFetcher(snaps), mandateProse: DEFAULT_MANDATE, equityUsd: 100_000, evidence: scenarioEvidence({ voices: F.KOL_VOICES, posts: F.KOL_POSTS, whales: F.WHALE_EVENTS, news: F.NEWS_ITEMS }) });
const pick = (s: string) => run.dossiers.find((d) => d.symbol === s)!;
writeFileSync("examples/draft-STOR-BEAM-scenario.html", draftStor(run, pick("BEAM")));
writeFileSync("examples/compliance-memo-SOL.html", complianceMemo(run, pick("SOL")));
console.log("examples/ regenerated");
