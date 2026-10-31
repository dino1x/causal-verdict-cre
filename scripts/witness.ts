// Publish the current ledger head so it can be witnessed outside our control. Writes witness/heads/<time>.txt
// (one line: the head and what it covers) and appends to src/data/witnesses.json, which the Ledger tab reads.
// The caller then timestamps the file into Bitcoin (OpenTimestamps), signs it in Sigstore (GitHub Actions OIDC)
// and commits it to git; see .github/workflows/agent.yml.
//   npx tsx scripts/witness.ts [--ots=path/to/file.ots] [--sigstore=path/to/bundle]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ledgerHead, verifyLedger, type Ledger } from "../src/engine/ledger";

const INDEX = "src/data/witnesses.json";
const path = existsSync("data/ledger.json") ? "data/ledger.json" : "src/data/ledgerSnapshot.json";
const l: Ledger = JSON.parse(readFileSync(path, "utf8"));
if (!verifyLedger(l).ok) throw new Error(`${path} does not verify; refusing to witness a broken ledger`);
const head = ledgerHead(l);
const index: { at: string; head: string; runs: number; events: number; file: string }[] = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : [];
if (index.length && index[index.length - 1].head === head) {
  console.log(`head ${head} already witnessed in ${index[index.length - 1].file}`);
  process.exit(0);
}
const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
mkdirSync("witness/heads", { recursive: true });
const file = `witness/heads/${at.replace(/:/g, "-")}.txt`;
writeFileSync(file, `causal-verdict ledger head ${head} runs=${l.runs.length} events=${l.events.length} positions=${l.positions.length} at=${at}\n`);
index.push({ at, head, runs: l.runs.length, events: l.events.length, file });
writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");
console.log(file);
