// RYO-CHAN MCP public envelope types + null-preserving accessors.
// Rule: a missing / null / "unavailable" measurement stays `null`. It is never coerced to 0.

export type RyoTool =
  | "market_overview"
  | "scan_market"
  | "analyze_token"
  | "deep_analysis"
  | "compare_tokens"
  | "monitor_market_sentiment_shift";

export interface RyoEnvelope {
  schema_version: string;
  tool: RyoTool;
  status: "ok" | "partial" | "unavailable";
  data_mode: "live" | "mixed" | "simulated" | "unknown";
  as_of: string;
  request: Record<string, unknown>;
  data: any;
  summary: { headline: string; key_points: string[] };
  availability: Record<string, string>;
  warnings: string[];
}

/** Where a result came from. Shown as a badge on every piece of evidence. */
export type Provenance =
  | "live" //            fresh call through our server proxy just now
  | "snapshot" //        real RYO response captured earlier (scripts/capture-ryo.mjs), replayed
  | "unavailable"; //    neither live nor a captured snapshot exists — evidence is missing, not zero

export interface RyoResult {
  tool: RyoTool;
  args: Record<string, unknown>;
  provenance: Provenance;
  envelope: RyoEnvelope | null;
  envelope_sha256: string | null;
  http_status: number;
  rate_limit: { limit: string | null; remaining: string | null; reset: string | null; retryAfter: string | null } | null;
  /** Why live failed, when we fell back (429, 503, timeout, chaos-injected, no key...). */
  fallback_reason: string | null;
  captured_at: string | null;
  latency_ms: number;
}

export type RyoFetcher = (tool: RyoTool, args: Record<string, unknown>) => Promise<RyoResult>;

/** Read a numeric path. Returns null for missing, null, NaN or non-number values. */
export function num(obj: unknown, path: string): number | null {
  let cur: any = obj;
  for (const k of path.split(".")) {
    if (cur == null) return null;
    cur = cur[k];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

export function str(obj: unknown, path: string): string | null {
  let cur: any = obj;
  for (const k of path.split(".")) {
    if (cur == null) return null;
    cur = cur[k];
  }
  return typeof cur === "string" ? cur : null;
}

export const fmt = (v: number | null, d = 2, suffix = "") => (v === null ? "unavailable" : `${v.toFixed(d)}${suffix}`);

export const fmtUsd = (v: number | null) => {
  if (v === null) return "unavailable";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
};

export const snapshotId = (tool: string, args: Record<string, unknown>) => `${tool}:${canonical(args)}`;

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Per-token evidence merged from analyze_token + deep_analysis + compare_tokens, nulls preserved. */
export interface TokenEvidence {
  symbol: string;
  name: string | null;
  price: number | null;
  mcap: number | null;
  volume24h: number | null;
  turnover: number | null;
  ch1h: number | null;
  ch24h: number | null;
  ch7d: number | null;
  ch30d: number | null;
  rsi14: number | null;
  atrPct: number | null;
  trend: string | null;
  analyzeVerdict: string | null;
  deepVerdict: string | null;
  confluence: number | null;
  confluenceState: string | null;
  confluenceGates: { name: string; passed: boolean }[];
  perp: {
    fundingBps: number | null;
    oiChange24h: number | null;
    squeezeRisk: string | null;
    liquidationPressure: string | null;
    veto: boolean | null;
  } | null;
  tradePlan: { entry: number; stop: number; targets: number[]; atrUsd: number | null; atrMult: number | null } | null;
  catalysts: string[];
  risks: string[];
  profileText: string | null;
  analyzeStatus: string | null;
  deepStatus: string | null;
  availability: Record<string, string>;
  warnings: string[];
  sources: { tool: RyoTool; provenance: Provenance; sha: string | null; as_of: string | null; status: string | null }[];
  scanRank: number | null;
  momentumScore: number | null;
}

export function buildTokenEvidence(
  symbol: string,
  analyze: RyoResult | undefined,
  deep: RyoResult | undefined,
  scanCandidate: any | undefined,
): TokenEvidence {
  const a = analyze?.envelope?.status !== "unavailable" ? analyze?.envelope?.data : undefined;
  const d = deep?.envelope?.status !== "unavailable" ? deep?.envelope?.data : undefined;
  const price = num(d, "market.price_usd") ?? num(a, "market.price_usd") ?? num(scanCandidate, "price_usd");
  const mcap = num(d, "market.mcap_usd") ?? num(a, "market.market_cap_usd") ?? num(scanCandidate, "market_cap_usd");
  const vol = num(d, "market.volume_24h_usd") ?? num(a, "market.volume_24h_usd") ?? num(scanCandidate, "volume_24h_usd");
  const tp = d?.trade_plan;
  const perp = d?.derivatives;
  let profileText: string | null = null;
  const prof = d?.token_profile?.data?.data?.decision_report;
  if (prof && typeof prof.analysis === "string") profileText = prof.analysis;
  const sources: TokenEvidence["sources"] = [];
  for (const r of [analyze, deep]) {
    if (r) sources.push({ tool: r.tool, provenance: r.provenance, sha: r.envelope_sha256, as_of: r.envelope?.as_of ?? null, status: r.envelope?.status ?? null });
  }
  return {
    symbol,
    name: str(d, "asset.name") ?? str(a, "asset.name") ?? str(scanCandidate, "name"),
    price,
    mcap,
    volume24h: vol,
    turnover: mcap && vol !== null ? vol / mcap : null,
    ch1h: num(d, "performance.h1") ?? num(a, "performance.change_1h_pct"),
    ch24h: num(d, "performance.h24") ?? num(a, "performance.change_24h_pct") ?? num(scanCandidate, "change_24h_pct"),
    ch7d: num(d, "performance.d7") ?? num(a, "performance.change_7d_pct"),
    ch30d: num(d, "performance.d30") ?? num(a, "performance.change_30d_pct"),
    rsi14: num(d, "technical_analysis.rsi_14") ?? num(a, "technical_analysis.rsi_14"),
    atrPct: num(d, "technical_analysis.atr_14_pct") ?? num(a, "technical_analysis.atr_14_pct"),
    trend: str(d, "technical_analysis.trend") ?? str(a, "technical_analysis.trend"),
    analyzeVerdict: str(a, "verdict"),
    deepVerdict: str(d, "verdict.call"),
    confluence: num(d, "confluence.score"),
    confluenceState: str(d, "confluence.state"),
    confluenceGates: Array.isArray(d?.confluence?.gates) ? d.confluence.gates.map((g: any) => ({ name: g.name, passed: !!g.passed })) : [],
    perp: perp
      ? {
          fundingBps: num(perp, "funding_rate_bps"),
          oiChange24h: num(perp, "open_interest_change_24h_pct"),
          squeezeRisk: str(perp, "squeeze_risk"),
          liquidationPressure: str(perp, "liquidation_pressure"),
          veto: typeof perp.veto === "boolean" ? perp.veto : null,
        }
      : null,
    tradePlan:
      tp && typeof tp.entry === "number" && typeof tp.stop === "number"
        ? { entry: tp.entry, stop: tp.stop, targets: (tp.targets ?? []).filter((x: unknown) => typeof x === "number"), atrUsd: num(tp, "atr_14_usd"), atrMult: num(tp, "atr_multiplier") }
        : null,
    catalysts: [...(a?.intelligence?.catalysts ?? []), ...(d?.intelligence?.catalysts ?? [])].filter((x, i, arr) => arr.indexOf(x) === i),
    risks: [...(a?.intelligence?.risks ?? []), ...(d?.intelligence?.risks ?? [])].filter((x, i, arr) => arr.indexOf(x) === i),
    profileText,
    analyzeStatus: analyze?.envelope?.status ?? (analyze ? "unavailable" : null),
    deepStatus: deep?.envelope?.status ?? (deep ? "unavailable" : null),
    availability: { ...(analyze?.envelope?.availability ?? {}), ...Object.fromEntries(Object.entries(deep?.envelope?.availability ?? {}).map(([k, v]) => [`deep.${k}`, v])) },
    warnings: [...(analyze?.envelope?.warnings ?? []), ...(deep?.envelope?.warnings ?? [])],
    sources,
    scanRank: num(scanCandidate, "rank"),
    momentumScore: num(scanCandidate, "momentum_score"),
  };
}
