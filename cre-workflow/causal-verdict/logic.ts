// Pure, capability-free workflow logic shared by main.ts (WASM on the DON) and simulate.ts (Node harness).
// QuickJS-safe: no Node built-ins, no fetch, no timers.
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";

/** Flat observation each DON node produces from its own RYO reads; aggregated field-by-field. */
export interface Observation {
  symbol: string;
  asOf: string; // RYO deep_analysis as_of (identical across nodes)
  status: string; // worst of deep/sentiment status
  regime: string;
  verdict: string;
  // Numeric fields use -1 ONLY as a wire sentinel for "unavailable"; the *Available flags are authoritative.
  price: number;
  atrPct: number;
  atrAvailable: boolean;
  rsi14: number;
  rsiAvailable: boolean;
  confluence: number;
  confluenceAvailable: boolean;
  turnover: number;
  turnoverAvailable: boolean;
  perpVeto: boolean;
  planEntry: number;
  planStop: number;
  planT1: number;
  planT2: number;
  planAvailable: boolean;
  fearGreed: number;
}

/** Off-chain evidence digest submitted by the agent through the x402-gated HTTP trigger. */
export interface AgentEvidence {
  exitLiquidityTrap: boolean;
  toutingFlag: boolean;
  supportingPlanes: number;
  traceRoot: Hex; // root of the agent's hash-chained reasoning trace
}

export type MandateClause = { id: string; kind: string; [k: string]: unknown };

export interface Verdict {
  decision: 0 | 1; // 0 REJECT, 1 SELECT
  failedGateMask: number;
  failed: string[];
  entryE8: bigint;
  stopE8: bigint;
  t1E8: bigint;
  t2E8: bigint;
  sizeBps: number;
  confluenceBps: number;
}

const n = (c: MandateClause, k: string) => Number(c[k]);

export function evaluateMandate(obs: Observation, ev: AgentEvidence, clauses: MandateClause[], equityUsd: number): Verdict {
  const failed: string[] = [];
  let mask = 0;
  const fail = (i: number, c: MandateClause) => {
    failed.push(`${c.id}:${c.kind}`);
    mask |= 1 << i;
  };
  let riskPct = 1, maxPos = 10, atrMult = 1.5, maxStop = 8, scale = 1;
  clauses.forEach((c, i) => {
    switch (c.kind) {
      case "require_status":
        if (!(c.allowed as string[]).includes(obs.status)) fail(i, c);
        break;
      case "min_confluence":
        if (!obs.confluenceAvailable || obs.confluence < n(c, "min")) fail(i, c);
        break;
      case "min_turnover":
        if (!obs.turnoverAvailable || obs.turnover < n(c, "min")) fail(i, c);
        break;
      case "max_atr":
        if (obs.atrAvailable && obs.atrPct > n(c, "maxPct")) fail(i, c);
        break;
      case "require_measurement":
        if ((c.field === "rsi_14" && !obs.rsiAvailable) || (c.field === "atr_14_pct" && !obs.atrAvailable)) fail(i, c);
        break;
      case "reject_verdict":
        if ((c.verdicts as string[]).includes(obs.verdict)) fail(i, c);
        break;
      case "perp_veto":
        if (obs.perpVeto) fail(i, c);
        break;
      case "anti_exit_liquidity":
        if (ev.exitLiquidityTrap) fail(i, c);
        break;
      case "anti_touting":
        if (ev.toutingFlag) fail(i, c);
        break;
      case "min_planes":
        if (ev.supportingPlanes < n(c, "n")) fail(i, c);
        break;
      case "risk_per_trade": riskPct = n(c, "maxPct"); break;
      case "max_position": maxPos = n(c, "maxPct"); break;
      case "stop_rule": atrMult = n(c, "atrMult"); maxStop = n(c, "maxPct"); break;
      case "regime_scaling": if (obs.regime === c.regime) scale *= n(c, "factor"); break;
    }
  });
  const confluenceBps = obs.confluenceAvailable ? Math.round(obs.confluence * 10_000) : 65_535;
  if (failed.length || !obs.atrAvailable || !(obs.price > 0)) {
    return { decision: 0, failedGateMask: mask, failed, entryE8: 0n, stopE8: 0n, t1E8: 0n, t2E8: 0n, sizeBps: 0, confluenceBps };
  }
  const entry = obs.planAvailable ? obs.planEntry : obs.price;
  const atrUsd = (entry * obs.atrPct) / 100;
  const stop = Math.max(entry - atrMult * atrUsd, entry * (1 - maxStop / 100));
  const r = entry - stop;
  let notional = ((equityUsd * riskPct) / 100 / r) * entry * scale;
  notional = Math.min(notional, (equityUsd * maxPos) / 100);
  const t1 = obs.planAvailable ? obs.planT1 : entry + r;
  const t2 = obs.planAvailable ? obs.planT2 : entry + 2 * r;
  const e8 = (x: number) => BigInt(Math.round(x * 1e8));
  return { decision: 1, failedGateMask: 0, failed, entryE8: e8(entry), stopE8: e8(stop), t1E8: e8(t1), t2E8: e8(t2), sizeBps: Math.round((notional / equityUsd) * 10_000), confluenceBps };
}

export const VERDICT_TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "runId", type: "bytes32" },
      { name: "symbol", type: "string" },
      { name: "decision", type: "uint8" },
      { name: "entryE8", type: "int256" },
      { name: "stopE8", type: "int256" },
      { name: "target1E8", type: "int256" },
      { name: "target2E8", type: "int256" },
      { name: "sizeBps", type: "uint16" },
      { name: "confluenceBps", type: "uint16" },
      { name: "failedGateMask", type: "uint32" },
      { name: "mandateHash", type: "bytes32" },
      { name: "evidenceRoot", type: "bytes32" },
      { name: "observedAt", type: "uint64" },
      { name: "recordedAt", type: "uint64" },
    ],
  },
] as const;

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** ISO-8601 -> unix seconds without Date parsing quirks across runtimes. */
export function isoToUnix(iso: string): bigint {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0n;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const days = (yy: number, mm: number, dd: number) => {
    const a = Math.floor((14 - mm) / 12), y2 = yy + 4800 - a, m2 = mm + 12 * a - 3;
    return dd + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045 - 2440588;
  };
  return BigInt(days(y, mo, d) * 86400 + h * 3600 + mi * 60 + s);
}

export function encodeVerdictReport(obs: Observation, ev: AgentEvidence, v: Verdict, mandateHash: Hex): { report: Hex; runId: Hex; evidenceRoot: Hex } {
  const evidenceRoot = keccak256(stringToHex(stableJson({ obs, ev: { ...ev } })));
  const runId = keccak256(stringToHex(`${obs.symbol}|${obs.asOf}|${mandateHash}|${ev.traceRoot}`));
  const report = encodeAbiParameters(VERDICT_TUPLE, [
    {
      runId,
      symbol: obs.symbol,
      decision: v.decision,
      entryE8: v.entryE8,
      stopE8: v.stopE8,
      target1E8: v.t1E8,
      target2E8: v.t2E8,
      sizeBps: v.sizeBps,
      confluenceBps: v.confluenceBps,
      failedGateMask: v.failedGateMask,
      mandateHash,
      evidenceRoot,
      observedAt: isoToUnix(obs.asOf),
      recordedAt: 0n,
    },
  ]);
  return { report, runId, evidenceRoot };
}

/** Map a RYO deep_analysis + sentiment envelope pair to the flat observation. Never coerces null to 0. */
export function observe(symbol: string, deep: any, sentiment: any, overview: any): Observation {
  const d = deep?.data ?? {};
  const has = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const rsi = d.technical_analysis?.rsi_14, atr = d.technical_analysis?.atr_14_pct, conf = d.confluence?.score;
  const vol = d.market?.volume_24h_usd, mcap = d.market?.mcap_usd, tp = d.trade_plan;
  const statuses = [deep?.status, sentiment?.status].filter(Boolean);
  const worst = statuses.includes("unavailable") || statuses.length < 2 ? "unavailable" : statuses.includes("partial") ? "partial" : "ok";
  const planOk = tp && has(tp.entry) && has(tp.stop) && Array.isArray(tp.targets) && has(tp.targets[0]) && has(tp.targets[1]);
  return {
    symbol,
    asOf: String(deep?.as_of ?? ""),
    status: worst,
    regime: String(overview?.data?.regime ?? "unknown"),
    verdict: String(d.verdict?.call ?? "unknown"),
    price: has(d.market?.price_usd) ? d.market.price_usd : -1,
    atrPct: has(atr) ? atr : -1,
    atrAvailable: has(atr),
    rsi14: has(rsi) ? rsi : -1,
    rsiAvailable: has(rsi),
    confluence: has(conf) ? conf : -1,
    confluenceAvailable: has(conf),
    turnover: has(vol) && has(mcap) && mcap > 0 ? vol / mcap : -1,
    turnoverAvailable: has(vol) && has(mcap) && mcap > 0,
    perpVeto: d.derivatives?.veto === true,
    planEntry: planOk ? tp.entry : -1,
    planStop: planOk ? tp.stop : -1,
    planT1: planOk ? tp.targets[0] : -1,
    planT2: planOk ? tp.targets[1] : -1,
    planAvailable: !!planOk,
    fearGreed: has(sentiment?.data?.evidence?.fear_greed?.value) ? sentiment.data.evidence.fear_greed.value : -1,
  };
}

/** Minimal UTF-8 -> base64 (HTTP request bodies are bytes; QuickJS has no Buffer). */
export function toBase64(s: string): string {
  const bytes: number[] = [];
  for (const ch of unescape(encodeURIComponent(s))) bytes.push(ch.charCodeAt(0));
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const t = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += A[(t >> 18) & 63] + A[(t >> 12) & 63] + (b === undefined ? "=" : A[(t >> 6) & 63]) + (c === undefined ? "=" : A[t & 63]);
  }
  return out;
}
