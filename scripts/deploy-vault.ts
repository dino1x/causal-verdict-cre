// Deploy CausalVerdictVault to Sepolia. Reads SEPOLIA_PRIVATE_KEY from .env (never from argv or code).
//   npx tsx scripts/deploy-vault.ts              # dry run: address, balance, gas estimate
//   npx tsx scripts/deploy-vault.ts --broadcast  # actually deploy (testnet only)
// The forwarder is the address CRE delivers reports from; set CRE_FORWARDER to the Sepolia forwarder
// listed in the CRE docs for your target (simulation uses the mock forwarder).
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
// @ts-ignore — plain ESM helper
import { loadEnv } from "./ryoClient.mjs";

loadEnv();
const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
if (!pk) throw new Error("SEPOLIA_PRIVATE_KEY is not set in .env");
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
const rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const forwarder = (process.env.CRE_FORWARDER ?? "0x15fC6ae953E024d975e77382eEeC56A9101f9F88") as Hex;
const cfgPath = "cre-workflow/causal-verdict/config.staging.json";
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const artifact = JSON.parse(readFileSync("contracts/out/CausalVerdictVault.json", "utf8"));

const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const balance = await pub.getBalance({ address: account.address });
const gas = await pub.estimateGas({ account, data: (artifact.bytecode + (await import("viem")).encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [forwarder, cfg.mandate.hash]).slice(2)) as Hex });
const gasPrice = await pub.getGasPrice();
console.log(`deployer ${account.address} · balance ${formatEther(balance)} SepoliaETH`);
console.log(`forwarder ${forwarder} · mandate ${cfg.mandate.hash}`);
console.log(`estimated gas ${gas} · cost ≈ ${formatEther(gas * gasPrice)} SepoliaETH`);
if (!process.argv.includes("--broadcast")) {
  console.log("dry run only — re-run with --broadcast to deploy");
  process.exit(0);
}
if (balance < gas * gasPrice) throw new Error("insufficient Sepolia ETH for deployment");
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [forwarder, cfg.mandate.hash] });
console.log(`deploy tx ${hash} — https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deployment failed: ${receipt.status}`);
console.log(`CausalVerdictVault deployed at ${receipt.contractAddress} — https://sepolia.etherscan.io/address/${receipt.contractAddress}`);
cfg.evm.vaultAddress = receipt.contractAddress;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
writeFileSync("contracts/deployment.sepolia.json", JSON.stringify({ network: "sepolia", address: receipt.contractAddress, tx: hash, block: receipt.blockNumber.toString(), forwarder, mandateHash: cfg.mandate.hash, deployer: account.address }, null, 2) + "\n");
console.log(`updated ${cfgPath} and contracts/deployment.sepolia.json`);
