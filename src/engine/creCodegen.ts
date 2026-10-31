// Mandate -> CRE artifacts. The compiled AST is the single source of truth; the generated
// config.staging.json is what cre-workflow/causal-verdict/main.ts evaluates on the DON.
import { sha256, stringToBytes } from "viem";
import { canonical } from "./ryo";
import type { MandateAST } from "./legalAstCompiler";

export function mandateHash(ast: MandateAST): `0x${string}` {
  return sha256(stringToBytes(canonical(ast.clauses.map((c) => c.clause))));
}

export interface CreGenOptions {
  watchlist: string[];
  schedule: string;
  equityUsd: number;
  priceUsdc6: number;
  vaultAddress: string;
  payTo: string;
  gatewayKey: string;
}

export const DEFAULT_GEN: CreGenOptions = {
  watchlist: ["SOL"],
  schedule: "0 */15 * * * *",
  equityUsd: 100000,
  priceUsdc6: 10000, // 0.01 USDC per verdict
  vaultAddress: "0x0000000000000000000000000000000000000000",
  payTo: "0x0000000000000000000000000000000000000000",
  gatewayKey: "0x0000000000000000000000000000000000000000",
};

export function generateCreConfig(ast: MandateAST, o: CreGenOptions = DEFAULT_GEN) {
  return {
    schedule: o.schedule,
    ryoMcpUrl: "https://app-ryochan.com/api/mcp",
    ryoTransport: "confidential" as const,
    watchlist: o.watchlist,
    equityUsd: o.equityUsd,
    x402: { priceUsdc6: o.priceUsdc6, payTo: o.payTo },
    authorizedGatewayKey: o.gatewayKey,
    mandate: {
      name: ast.name,
      hash: mandateHash(ast),
      clauses: ast.clauses.map((c) => ({ id: c.id, ...c.clause })),
    },
    evm: { chainSelectorName: "ethereum-testnet-sepolia", vaultAddress: o.vaultAddress, gasLimit: "1500000" },
  };
}

/** Human-readable TypeScript the mandate compiles to — shown in the generator tab and diffable in review. */
export function generateGateSource(ast: MandateAST): string {
  const lines: string[] = [
    `// AUTO-GENERATED from mandate "${ast.name}" — hash ${mandateHash(ast)}`,
    `// Do not edit: change the mandate prose and recompile.`,
    `export function gates(obs: Observation, ev: AgentEvidence): string[] {`,
    `  const failed: string[] = [];`,
  ];
  for (const { id, clause: c, anchor } of ast.clauses) {
    const cite = `  // ${id} — ${anchor.code}`;
    switch (c.kind) {
      case "require_status": lines.push(cite, `  if (!${JSON.stringify(c.allowed)}.includes(obs.status)) failed.push("${id}");`); break;
      case "min_confluence": lines.push(cite, `  if (!obs.confluenceAvailable || obs.confluence < ${c.min}) failed.push("${id}");`); break;
      case "min_turnover": lines.push(cite, `  if (!obs.turnoverAvailable || obs.turnover < ${c.min}) failed.push("${id}");`); break;
      case "max_atr": lines.push(cite, `  if (obs.atrAvailable && obs.atrPct > ${c.maxPct}) failed.push("${id}");`); break;
      case "require_measurement": lines.push(cite, `  if (!obs.${c.field === "rsi_14" ? "rsiAvailable" : "atrAvailable"}) failed.push("${id}");`); break;
      case "reject_verdict": lines.push(cite, `  if (${JSON.stringify(c.verdicts)}.includes(obs.verdict)) failed.push("${id}");`); break;
      case "perp_veto": lines.push(cite, `  if (obs.perpVeto) failed.push("${id}");`); break;
      case "anti_exit_liquidity": lines.push(cite, `  if (ev.exitLiquidityTrap) failed.push("${id}"); // window ${c.windowMin}m, computed off-chain`); break;
      case "anti_touting": lines.push(cite, `  if (ev.toutingFlag) failed.push("${id}"); // >=${c.minKols} KOLs / ${c.windowMin}m, computed off-chain`); break;
      case "min_planes": lines.push(cite, `  if (ev.supportingPlanes < ${c.n}) failed.push("${id}");`); break;
      case "regime_scaling": lines.push(`  // ${id} sizing: × ${c.factor} when regime == "${c.regime}"`); break;
      case "risk_per_trade": lines.push(`  // ${id} sizing: risk ${c.maxPct}% equity per position`); break;
      case "max_position": lines.push(`  // ${id} sizing: cap notional at ${c.maxPct}% equity`); break;
      case "stop_rule": lines.push(`  // ${id} stop: max(entry - ${c.atrMult}×ATR, entry × ${1 - c.maxPct / 100})`); break;
    }
  }
  lines.push(`  return failed;`, `}`);
  return lines.join("\n");
}
