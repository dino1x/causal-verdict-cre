// The full autonomous funnel. Every step is hash-chained so the run can be replayed bit-for-bit.
//   market_overview + monitor_market_sentiment_shift  -> regime context
//   scan_market (momentum / dip / meme)                -> candidate pool
//   compare_tokens                                     -> relative factor winners
//   analyze_token (universe) + deep_analysis (finalists)
//   KOL radar + news check + whale lead-lag (scenario fixtures or real feeds) -> causal evidence
//   mandate gates -> Bull/Bear -> Judge -> atomic position -> hash-chained trace
import { sha256, stringToBytes } from "viem";
import { buildTokenEvidence, canonical, num, str, type RyoFetcher, type RyoResult, type RyoTool, type TokenEvidence } from "./ryo";
import { buildNarrative, checkNews, scorePosts, whaleForensics, type Narrative, type NewsCheck, type WhaleForensics } from "./evidence";
import { clauseOf, compile, evaluate, type GateResult, type MandateAST } from "./legalAstCompiler";
import { argue, judge, sizePosition, supportingPlanes, type Argument, type Judgment, type MarketContext, type Position } from "./decision";
import type { KolPost, KolVoice, NewsItem, WhaleEvent } from "../data/scenarioFixtures";

export const hashHex = (s: string) => sha256(stringToBytes(s));

export interface TraceStep {
  i: number;
  label: string;
  payload: unknown;
  payload_sha256: string;
  prev: string;
  hash: string;
}

export class Trace {
  steps: TraceStep[] = [];
  private head = "0x" + "0".repeat(64);
  add(label: string, payload: unknown) {
    const payload_sha256 = hashHex(canonical(payload));
    const hash = hashHex(`${this.head}|${this.steps.length}|${label}|${payload_sha256}`);
    this.steps.push({ i: this.steps.length, label, payload, payload_sha256, prev: this.head, hash });
    this.head = hash;
  }
  get root() {
    return this.head;
  }
}

export function verifyTrace(steps: TraceStep[]): { ok: boolean; brokenAt: number | null } {
  let head = "0x" + "0".repeat(64);
  for (const s of steps) {
    const ph = hashHex(canonical(s.payload));
    const h = hashHex(`${head}|${s.i}|${s.label}|${ph}`);
    if (ph !== s.payload_sha256 || s.prev !== head || h !== s.hash) return { ok: false, brokenAt: s.i };
    head = h;
  }
  return { ok: true, brokenAt: null };
}

export interface Fixtures {
  voices: KolVoice[];
  posts: KolPost[];
  whales: WhaleEvent[];
  news: NewsItem[];
  markets?: MarketSnap[];
}

/** Independent market data for one token as of the reference time (exchange candles and perps, Chainlink price). */
export interface MarketSnap {
  symbol: string;
  venue: string | null;
  candles: { t: number; o: number; h: number; l: number; c: number }[]; // 1h, closed before the reference time
  fundingRate: number | null; // per 8h funding interval
  oiChange24hPct: number | null;
  priceRef: { price: number; source: string; updatedAt: string; url: string } | null;
  source: string | null;
}

export interface TokenDossier {
  symbol: string;
  stage: "deep" | "analyze";
  evidence: TokenEvidence;
  narrative: Narrative;
  news: NewsCheck;
  whale: WhaleForensics;
  market: MarketSnap | null;
  args: Argument[];
  planes: string[];
  gates: GateResult[];
  position: Position | null;
  judgment: Judgment;
}

export interface FeedSource {
  feed: "onchain" | "whale_alert" | "rss" | "telegram" | "fixture" | "user" | "exchange" | "chainlink" | "tavily";
  target: string;
  ok: boolean;
  items: number;
  detail: string;
}

export interface EvidenceToken {
  symbol: string;
  name: string | null;
  contract: string | null;
  priceUsd: number | null;
}

/** Supplies KOL / whale / news evidence once the candidate universe is known. */
export type EvidenceProvider = (tokens: EvidenceToken[], referenceTime: string | null) => Promise<{ mode: "scenario" | "real"; fixtures: Fixtures; sources: FeedSource[] }>;

export const scenarioEvidence = (fixtures: Fixtures): EvidenceProvider => async () => ({
  mode: "scenario",
  fixtures,
  sources: [{ feed: "fixture", target: "scenarioFixtures.ts", ok: true, items: fixtures.posts.length + fixtures.whales.length + fixtures.news.length, detail: "illustrative scenario — not live data" }],
});

export interface RunResult {
  referenceTime: string | null;
  calls: RyoResult[];
  market: MarketContext;
  scans: { momentum: any[]; dip: any[]; meme: any[] };
  comparisons: RyoResult[];
  shortlist: string[];
  universe: string[];
  dossiers: TokenDossier[];
  practiceTrade: { dossier: TokenDossier; position: Position } | null;
  mandate: MandateAST;
  mandateHash: string;
  trace: Trace;
  provenanceMix: Record<string, number>;
  evidenceMode: "scenario" | "real";
  evidenceUsed: Fixtures;
  feedSources: FeedSource[];
}

const isStable = (c: any) => /USD|DAI|FDUSD|TUSD/.test(c.symbol) || (Math.abs((c.price_usd ?? 0) - 1) < 0.02 && Math.abs(c.change_24h_pct ?? 0) < 0.5);
export const ANCHORS = ["SOL", "PEPE"];

export async function runPipeline(opts: {
  fetcher: RyoFetcher;
  mandateProse: string;
  equityUsd: number;
  fixtures?: Fixtures;
  evidence?: EvidenceProvider;
  onProgress?: (msg: string, call?: RyoResult) => void;
}): Promise<RunResult> {
  const { fetcher, equityUsd } = opts;
  const provider = opts.evidence ?? scenarioEvidence(opts.fixtures ?? { voices: [], posts: [], whales: [], news: [] });
  const { ast } = compile(opts.mandateProse);
  if (!ast) throw new Error("Mandate does not compile — fix the mandate before running the agent.");
  const trace = new Trace();
  const calls: RyoResult[] = [];
  const call = async (tool: RyoTool, args: Record<string, unknown>) => {
    opts.onProgress?.(`→ ${tool} ${JSON.stringify(args)}`);
    const r = await fetcher(tool, args);
    calls.push(r);
    opts.onProgress?.(`← ${tool} ${r.provenance}${r.envelope ? ` status=${r.envelope.status}` : ""}${r.fallback_reason ? ` (${r.fallback_reason})` : ""}`, r);
    return r;
  };
  const pool = async <T,>(items: T[], n: number, fn: (x: T) => Promise<RyoResult>) => {
    const out: RyoResult[] = new Array(items.length);
    let k = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) {
        const i = k++;
        out[i] = await fn(items[i]);
      }
    }));
    return out;
  };

  const mandateHash = hashHex(canonical(ast.clauses.map((c) => c.clause)));
  trace.add("mandate.compiled", { name: ast.name, mandateHash, clauses: ast.clauses.map((c) => ({ id: c.id, clause: c.clause, anchor: c.anchor.code })) });

  // 1. regime context
  const [ov, shift] = await Promise.all([call("market_overview", {}), call("monitor_market_sentiment_shift", { time_window: "7d" })]);
  const od = ov.envelope?.data;
  const sd = shift.envelope?.data?.evidence;
  const market: MarketContext = {
    regime: str(od, "regime"),
    fearGreed: num(sd, "fear_greed.value") ?? num(od, "sentiment.fear_greed_index"),
    fearGreedChange7d: num(sd, "fear_greed.change_7d_points"),
    fundingCrowding: str(sd, "funding.crowding_state"),
    liquidationPressure: str(sd, "liquidation.pressure_state"),
    liquidationLongShare: num(sd, "liquidation.long_share_pct"),
    altseasonPhase: str(sd, "altseason.phase"),
    breadth: num(od, "market.breadth"),
  };
  const referenceTime = ov.envelope?.as_of ?? shift.envelope?.as_of ?? null;
  trace.add("ryo.regime", { market, sources: [ov, shift].map(src) });

  // 2. candidate pool
  const [scan, dip, meme] = await Promise.all([
    call("scan_market", { top_n: 10, filter_direction: "all" }),
    call("scan_market", { top_n: 8, filter_direction: "negative" }),
    call("scan_market", { top_n: 6, theme: "meme" }),
  ]);
  const cands = (r: RyoResult) => (Array.isArray(r.envelope?.data?.candidates) ? r.envelope!.data.candidates : []);
  const momentum = cands(scan);
  const shortlist = momentum.filter((c: any) => !isStable(c)).slice(0, 4).map((c: any) => c.symbol as string);
  const universe = [...new Set([...shortlist, ...ANCHORS])];
  trace.add("ryo.scan", { shortlist, universe, excludedStable: momentum.filter(isStable).map((c: any) => c.symbol), sources: [scan, dip, meme].map(src) });

  // 3. relative comparison
  const comparisons: RyoResult[] = [];
  if (shortlist.length >= 2) comparisons.push(await call("compare_tokens", { symbols: shortlist.join(", "), intent: "swing" }));
  comparisons.push(await call("compare_tokens", { symbols: "SOL, PEPE, " + (shortlist[0] ?? "ETH"), intent: "swing" }));
  trace.add("ryo.compare", comparisons.map((c) => ({ ...src(c), pick: c.envelope?.data?.conclusion?.pick ?? null, confidence: c.envelope?.data?.conclusion?.confidence ?? null })));

  // 4. token reads
  const finalists = [...new Set([...shortlist.slice(0, 2), ...ANCHORS])];
  const analyzes = await pool(universe, 3, (s) => call("analyze_token", { symbol: s }));
  const deeps = await pool(finalists, 3, (s) => call("deep_analysis", { symbol: s, include_perp: true }));
  trace.add("ryo.tokens", { analyze: analyzes.map(src), deep: deeps.map(src) });

  // 5. external evidence for the universe (scenario fixtures or real feeds), frozen into the trace
  const evTokens: EvidenceToken[] = universe.map((symbol, i) => {
    const c = momentum.find((x: any) => x.symbol === symbol);
    const a = analyzes[i]?.envelope?.data;
    return { symbol, name: str(a, "asset.name") ?? str(c, "name"), contract: str(c, "contract") ?? str(a, "asset.contract"), priceUsd: num(a, "market.price_usd") ?? num(c, "price_usd") };
  });
  opts.onProgress?.("→ evidence feeds (KOL / whale / news)");
  const ev = await provider(evTokens, referenceTime);
  const fixtures = ev.fixtures;
  opts.onProgress?.(`← evidence ${ev.mode}: ${fixtures.posts.length} posts, ${fixtures.whales.length} whale events, ${fixtures.news.length} news items`);
  trace.add("evidence.inputs", {
    mode: ev.mode,
    posts_sha256: hashHex(canonical(fixtures.posts)),
    whales_sha256: hashHex(canonical(fixtures.whales)),
    news_sha256: hashHex(canonical(fixtures.news)),
    voices_sha256: hashHex(canonical(fixtures.voices)),
    markets_sha256: hashHex(canonical(fixtures.markets ?? [])),
    counts: { posts: fixtures.posts.length, whales: fixtures.whales.length, news: fixtures.news.length },
    sources: ev.sources.map((s) => `${s.ok ? "ok" : "fail"} ${s.feed} ${s.target} (${s.items})`),
  });

  // 6. evidence + decision per token
  const scored = scorePosts(fixtures.posts, universe);
  const touting = clauseOf(ast, "anti_touting");
  const exitLiq = clauseOf(ast, "anti_exit_liquidity");
  const winMin = touting?.windowMin ?? 30;
  const dossiers: TokenDossier[] = universe.map((symbol, i) => {
    const deep = deeps[finalists.indexOf(symbol)];
    const evidence = buildTokenEvidence(symbol, analyzes[i], deep, momentum.find((c: any) => c.symbol === symbol));
    const narrative = buildNarrative(symbol, scored, fixtures.voices, winMin, 3);
    const ryoText = [evidence.profileText, ...evidence.catalysts].filter(Boolean).join(" ");
    const news = checkNews(symbol, narrative, fixtures.news, ryoText || null);
    const whale = whaleForensics(symbol, fixtures.whales, narrative.convergenceAt, exitLiq?.windowMin ?? 90);
    const mk = fixtures.markets?.find((x) => x.symbol === symbol) ?? null;
    const args = argue(evidence, market, narrative, news, whale, ev.mode === "scenario", mk);
    const priceCheck = mk?.priceRef && evidence.price !== null
      ? { ryo: +evidence.price.toPrecision(6), ref: +mk.priceRef.price.toPrecision(6), source: mk.priceRef.source, deviationPct: +((Math.abs(evidence.price - mk.priceRef.price) / mk.priceRef.price) * 100).toFixed(3), ageMin: referenceTime ? Math.round((Date.parse(referenceTime) - Date.parse(mk.priceRef.updatedAt)) / 60000) : null }
      : null;
    const planes = supportingPlanes(args);
    const burst = narrative.convergenceAt !== null ? narrative.posts.filter((p) => p.minutes >= narrative.convergenceAt! - winMin && p.minutes <= narrative.convergenceAt! + winMin) : [];
    const statuses = [evidence.analyzeStatus, evidence.deepStatus].filter((s): s is string => s !== null);
    const worst = statuses.includes("unavailable") || !statuses.length ? (statuses.length ? "unavailable" : null) : statuses.includes("partial") ? "partial" : "ok";
    const gates = evaluate(
      ast,
      {
        symbol,
        status: worst,
        confluence: evidence.confluence,
        turnover: evidence.turnover,
        atrPct: evidence.atrPct,
        rsi14: evidence.rsi14,
        deepVerdict: evidence.deepVerdict,
        perpVeto: evidence.perp?.veto ?? null,
        exitLiquidityTrap: whale.events.length ? { detected: whale.trap, detail: whale.detail } : null,
        touting: narrative.posts.length
          ? {
              independentKols: new Set(burst.map((p) => p.cluster)).size,
              windowMin: burst.length ? burst[burst.length - 1].minutes - burst[0].minutes : 0,
              verifiedCatalyst: news.verifiedCatalyst,
              detail: `${new Set(burst.map((p) => p.cluster)).size} independent of ${narrative.voices} voices in burst; catalyst ${news.verifiedCatalyst ? "verified" : "unverified"}`,
            }
          : null,
        supportingPlanes: planes,
        priceCheck,
      },
      market.regime,
    );
    const failed = gates.some((g) => g.outcome === "fail");
    const position = failed ? null : sizePosition(evidence, ast, market.regime, equityUsd);
    const judgment = judge(symbol, args, gates, position);
    return { symbol, stage: finalists.includes(symbol) ? "deep" : "analyze", evidence, narrative, news, whale, market: mk, args, planes, gates, position, judgment };
  });
  for (const d of dossiers)
    trace.add(`judge.${d.symbol}`, {
      decision: d.judgment.decision,
      failed: d.judgment.failedGates.map((g) => g.id),
      bull: d.judgment.bullScore,
      bear: d.judgment.bearScore,
      planes: d.planes,
      whaleTrap: d.whale.trap,
      echoRatio: d.narrative.echoRatio,
      verifiedCatalyst: d.news.verifiedCatalyst,
    });

  // 6. one practice trade: highest bull-bear margin among SELECTs
  const sel = dossiers.filter((d) => d.judgment.decision === "SELECT" && d.position).sort((a, b) => b.judgment.bullScore - b.judgment.bearScore - (a.judgment.bullScore - a.judgment.bearScore) || a.symbol.localeCompare(b.symbol));
  const practiceTrade = sel[0] ? { dossier: sel[0], position: sel[0].position! } : null;
  trace.add("practice_trade", practiceTrade ? practiceTrade.position : { symbol: null, reason: "no candidate satisfied the mandate" });

  const provenanceMix: Record<string, number> = {};
  for (const c of calls) provenanceMix[c.provenance] = (provenanceMix[c.provenance] ?? 0) + 1;
  // Calls are logged in completion order; sort for a deterministic record.
  calls.sort((a, b) => (a.tool + canonical(a.args)).localeCompare(b.tool + canonical(b.args)));
  return { referenceTime, calls, market, scans: { momentum, dip: cands(dip), meme: cands(meme) }, comparisons, shortlist, universe, dossiers, practiceTrade, mandate: ast, mandateHash, trace, provenanceMix, evidenceMode: ev.mode, evidenceUsed: fixtures, feedSources: ev.sources };
}

function src(r: RyoResult) {
  return { tool: r.tool, args: r.args, provenance: r.provenance, status: r.envelope?.status ?? "unavailable", as_of: r.envelope?.as_of ?? null, sha256: r.envelope_sha256 };
}

/** Replay fetcher: serves exactly the recorded results of a previous run. */
export function recordedFetcher(calls: RyoResult[]): RyoFetcher {
  return async (tool, args) => {
    const hit = calls.find((c) => c.tool === tool && canonical(c.args) === canonical(args));
    if (hit) return hit;
    return { tool, args, provenance: "unavailable", envelope: null, envelope_sha256: null, http_status: 0, rate_limit: null, fallback_reason: "not in recorded run", captured_at: null, latency_ms: 0 };
  };
}
