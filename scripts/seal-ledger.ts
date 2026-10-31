// One-off migration: seal run records written before the run chain existed. Prints the head before and after.
//   npx tsx scripts/seal-ledger.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ledgerHead, sealLedger, verifyLedger } from "../src/engine/ledger";

for (const path of ["data/ledger.json", "src/data/ledgerSnapshot.json"]) {
  if (!existsSync(path)) continue;
  const before = JSON.parse(readFileSync(path, "utf8"));
  const after = sealLedger(before);
  const sealed = after.runs.filter((r: any, i: number) => before.runs[i]?.hash === undefined).length;
  writeFileSync(path, JSON.stringify(after, null, 2));
  console.log(`${path}: sealed ${sealed} legacy run(s) · verifies=${verifyLedger(after).ok} · head ${ledgerHead(after)}`);
}
