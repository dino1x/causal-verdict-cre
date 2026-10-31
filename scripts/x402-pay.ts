// An agent pays for one verdict over x402 with a real wallet (SEPOLIA_PRIVATE_KEY from .env, used on Base Sepolia).
// With the server started as X402_SETTLE=1, the facilitator settles the USDC transfer on-chain and the receipt
// carries the Base Sepolia transaction. The wallet needs ≥ 0.01 test USDC (https://faucet.circle.com, Base Sepolia).
//   npx tsx scripts/x402-pay.ts [http://localhost:5173] [SYMBOL]
import { randomBytes } from "node:crypto";
import { createPublicClient, erc20Abi, http, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
// @ts-ignore — plain ESM helper
import { loadEnv } from "./ryoClient.mjs";

loadEnv();
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const symbol = process.argv[3] ?? "SOL";
const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
if (!pk) throw new Error("SEPOLIA_PRIVATE_KEY is not set in .env");
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);

const url = `${base}/api/agent/verdict`;
const body = JSON.stringify({ symbol });
const r1 = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
if (r1.status !== 402) throw new Error(`expected 402 Payment Required, got ${r1.status}`);
const a = (await r1.json()).accepts[0];
console.log(`1 · 402: pay ${Number(a.maxAmountRequired) / 1e6} USDC to ${a.payTo} on ${a.network}`);

const pub = createPublicClient({ chain: baseSepolia, transport: http() });
const bal = await pub.readContract({ address: a.asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
console.log(`  payer ${account.address} holds ${Number(bal) / 1e6} USDC on Base Sepolia`);
if (bal < BigInt(a.maxAmountRequired)) console.log("  (not enough to settle — fund it at https://faucet.circle.com; a server without X402_SETTLE=1 still accepts the signed authorization)");

const now = Math.floor(Date.now() / 1000);
const authorization = { from: account.address, to: a.payTo as Hex, value: a.maxAmountRequired, validAfter: String(now - 5), validBefore: String(now + a.maxTimeoutSeconds), nonce: toHex(randomBytes(32)) };
const signature = await account.signTypedData({
  domain: { name: a.extra.name, version: a.extra.version, chainId: baseSepolia.id, verifyingContract: a.asset },
  types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "TransferWithAuthorization",
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});
const payment = { x402Version: 1, scheme: "exact", network: a.network, payload: { signature, authorization } };
const r2 = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-PAYMENT": Buffer.from(JSON.stringify(payment)).toString("base64") }, body });
const out = await r2.json();
console.log(`2 · paid retry → HTTP ${r2.status}`, r2.ok ? `${out.symbol} ${out.decision} · trace ${out.traceRoot}` : out.error);
const receipt = r2.headers.get("x-payment-response");
if (receipt) console.log("3 · receipt", JSON.parse(Buffer.from(receipt, "base64").toString("utf8")));
