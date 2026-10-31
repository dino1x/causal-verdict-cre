// Activate the current mandate hash on the deployed CausalVerdictVault (owner only, Sepolia). A new mandate takes
// effect on-chain only through this explicit owner action, and the event is public.
//   npx tsx scripts/activate-mandate.ts            # dry run: shows the active and the new hash
//   npx tsx scripts/activate-mandate.ts --broadcast
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, fallback, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
// @ts-ignore — plain ESM helper
import { loadEnv } from "./ryoClient.mjs";

loadEnv();
const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
if (!pk) throw new Error("SEPOLIA_PRIVATE_KEY is not set in .env");
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
const dep = JSON.parse(readFileSync("contracts/deployment.sepolia.json", "utf8"));
const cfg = JSON.parse(readFileSync("cre-workflow/causal-verdict/config.staging.json", "utf8"));
const abi = JSON.parse(readFileSync("contracts/out/CausalVerdictVault.json", "utf8")).abi;
const transport = fallback([process.env.SEPOLIA_RPC_URL, "https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"].filter(Boolean).map((u) => http(u as string, { timeout: 20_000 })));
const pub = createPublicClient({ chain: sepolia, transport });
const active = await pub.readContract({ address: dep.address, abi, functionName: "activeMandateHash" });
console.log(`vault ${dep.address}\nactive mandate ${active}\nnew mandate    ${cfg.mandate.hash} (${cfg.mandate.name}, ${cfg.mandate.clauses.length} clauses)`);
if (active === cfg.mandate.hash) process.exit(console.log("already active") ?? 0);
if (!process.argv.includes("--broadcast")) process.exit(console.log("dry run only — re-run with --broadcast") ?? 0);
const wallet = createWalletClient({ account, chain: sepolia, transport });
const hash = await wallet.writeContract({ address: dep.address, abi, functionName: "activateMandate", args: [cfg.mandate.hash] });
const r = await pub.waitForTransactionReceipt({ hash });
console.log(`activateMandate tx ${hash} (${r.status}) — https://sepolia.etherscan.io/tx/${hash}`);
dep.mandateActivations = [...(dep.mandateActivations ?? []), { tx: hash, block: r.blockNumber.toString(), mandateHash: cfg.mandate.hash }];
writeFileSync("contracts/deployment.sepolia.json", JSON.stringify(dep, null, 2) + "\n");
