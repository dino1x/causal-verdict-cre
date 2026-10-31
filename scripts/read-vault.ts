// Read the deployed CausalVerdictVault on Sepolia: verdict count, latest verdict, and the transactions that wrote them.
//   npx tsx scripts/read-vault.ts
import { readFileSync } from "node:fs";
import { createPublicClient, fallback, http, type Hex } from "viem";
import { sepolia } from "viem/chains";

const dep = JSON.parse(readFileSync("contracts/deployment.sepolia.json", "utf8"));
const abi = JSON.parse(readFileSync("contracts/out/CausalVerdictVault.json", "utf8")).abi;
// Public RPCs are flaky; try several before giving up.
const rpcs = [process.env.SEPOLIA_RPC_URL, "https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org", "https://1rpc.io/sepolia"].filter(Boolean) as string[];
const pub = createPublicClient({ chain: sepolia, transport: fallback(rpcs.map((u) => http(u, { timeout: 15_000, retryCount: 2 }))) });
const address = dep.address as Hex;

const n = (await pub.readContract({ address, abi, functionName: "verdictCount" })) as bigint;
console.log(`vault ${address} · ${n} verdict(s) · https://sepolia.etherscan.io/address/${address}`);
for (let i = 0n; i < n; i++) console.log(i, await pub.readContract({ address, abi, functionName: "verdict", args: [i] }));
const logs = await pub.getLogs({ address, fromBlock: BigInt(dep.block) });
const activations = new Set((dep.mandateActivations ?? []).map((a: { tx: string }) => a.tx));
for (const l of logs) console.log(`${l.transactionHash === dep.tx ? "deploy" : activations.has(l.transactionHash) ? "mandate activation" : "report"} tx ${l.transactionHash} (block ${l.blockNumber}) — https://sepolia.etherscan.io/tx/${l.transactionHash}`);
