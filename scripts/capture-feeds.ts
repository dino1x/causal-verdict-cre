// Captures REAL external evidence (on-chain transfers, Whale Alert, RSS news, Telegram posts) for the
// universe and reference time of the bundled RYO snapshots -> src/data/feedSnapshots.json.
//   npx tsx scripts/capture-feeds.ts        (run right after `npm run capture`)
import { readFileSync, writeFileSync } from "node:fs";
import { runPipeline, type EvidenceToken } from "../src/engine/pipeline";
import { snapshotFetcher } from "../src/engine/snapshotFetcher";
import { DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import { canonical } from "../src/engine/ryo";
import { collectFeeds, DEFAULT_TG_VOICES } from "../server/feeds";
import { sha256Hex } from "../server/hash";

const snaps = JSON.parse(readFileSync("src/data/ryoLiveSnapshots.json", "utf8"));
let captured: any = null;
await runPipeline({
  fetcher: snapshotFetcher(snaps),
  mandateProse: DEFAULT_MANDATE,
  equityUsd: 100000,
  evidence: async (tokens: EvidenceToken[], ref) => {
    const bundle = await collectFeeds(tokens, ref ?? new Date().toISOString(), DEFAULT_TG_VOICES);
    captured = { tokens, channels: DEFAULT_TG_VOICES, captured_at: new Date().toISOString(), ...bundle };
    return { mode: "real", fixtures: bundle, sources: bundle.sources };
  },
});
captured.bundle_sha256 = sha256Hex(canonical({ posts: captured.posts, whales: captured.whales, news: captured.news }));
writeFileSync("src/data/feedSnapshots.json", JSON.stringify(captured, null, 2));
for (const s of captured.sources) console.log(s.ok ? "ok " : "ERR", s.feed, s.target, s.items, s.detail);
console.log(`ref ${captured.referenceTime}: ${captured.whales.length} whale events, ${captured.news.length} news, ${captured.posts.length} posts → src/data/feedSnapshots.json`);
