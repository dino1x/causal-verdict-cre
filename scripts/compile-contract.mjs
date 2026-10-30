// Compiles contracts/CausalVerdictVault.sol with solc-js and writes ABI + bytecode.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import solc from "solc";

const source = readFileSync("contracts/CausalVerdictVault.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "CausalVerdictVault.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.log(e.formattedMessage);
if (errs.length) process.exit(1);
const c = out.contracts["CausalVerdictVault.sol"].CausalVerdictVault;
mkdirSync("contracts/out", { recursive: true });
writeFileSync("contracts/out/CausalVerdictVault.json", JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
console.log(`compiled with solc ${solc.version()} — bytecode ${c.evm.bytecode.object.length / 2} bytes, ${c.abi.length} ABI entries`);
