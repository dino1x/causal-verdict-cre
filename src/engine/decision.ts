// Bull vs Bear debate over the same structured evidence, a fiduciary Judge bound by the
// compiled mandate, and the atomic Buy-the-Dip position (entry + size + stop + exits as one object).
import type { TokenEvidence } from "./ryo";
import type { Narrative, NewsCheck, WhaleForensics } from "./evidence";
import type { MarketSnap } from "./pipeline";
import { clauseOf, type GateResult, type MandateAST } from "./legalAstCompiler";

export interface Argument {
  side: "bull" | "bear";
  plane: "ryo_market" | "ryo_sentiment" | "kol" | "whale" | "news" | "exchange";
  claim: string;
  /** Exact evidence path the argument rests on, e.g. deep_analysis(SOL).data.technical_analysis.rsi_14 */
  cite: string;
  value: string;
  weight: number; // 0..1
  fixture: boolean; // true when the evidence is a scenario fixture, not RYO
}

export interface MarketContext {
  regime: string | null;
  fearGreed: number | null;
  fearGreedChange7d: number | null;
  fundingCrowding: string | null;
  liquidationPressure: string | null;
  liquidationLongShare: number | null;
  altseasonPhase: string | null;
  breadth: number | null;
}

/** `fixture` marks KOL / whale / news arguments as scenario evidence (false when they come from real feeds). */
export function argue(t: TokenEvidence, m: MarketContext, n: Narrative, news: NewsCheck, w: WhaleForensics, fixture = true, mk: MarketSnap | null = null): Argument[] {
  const A: Argument[] = [];
  const s = t.symbol;
  const add = (a: Argument) => A.push(a);
  // ---- RYO market / technical plane
  if (t.rsi14 !== null && t.rsi14 <= 32) add({ side: "bull", plane: "ryo_market", claim: "Oversold on RSI(14): dip is stretched, mean-reversion odds improve.", cite: `analyze_token(${s}).data.technical_analysis.rsi_14`, value: String(t.rsi14), weight: 0.6, fixture: false });
  if (t.rsi14 !== null && t.rsi14 >= 70) add({ side: "bear", plane: "ryo_market", claim: "Overbought on RSI(14): chasing late momentum.", cite: `analyze_token(${s}).data.technical_analysis.rsi_14`, value: String(t.rsi14), weight: 0.5, fixture: false });
  if (t.rsi14 === null) add({ side: "bear", plane: "ryo_market", claim: "RSI(14) is unavailable — the dip/chase question cannot be measured.", cite: `analyze_token(${s}).data.technical_analysis.rsi_14`, value: "null", weight: 0.4, fixture: false });
  if (t.trend === "down") add({ side: "bear", plane: "ryo_market", claim: "Daily technical trend is down; a falling knife until it turns.", cite: `deep_analysis(${s}).data.technical_analysis.trend`, value: "down", weight: 0.5, fixture: false });
  if (t.trend === "up") add({ side: "bull", plane: "ryo_market", claim: "Daily technical trend is up.", cite: `deep_analysis(${s}).data.technical_analysis.trend`, value: "up", weight: 0.4, fixture: false });
  if (t.confluence !== null) add({ side: t.confluence >= 0.6 ? "bull" : "bear", plane: "ryo_market", claim: `RYO confluence ${t.confluenceState ?? ""} at ${t.confluence} (${t.confluenceGates.filter((g) => g.passed).map((g) => g.name).join(", ") || "no gates"} passed).`, cite: `deep_analysis(${s}).data.confluence.score`, value: String(t.confluence), weight: 0.6, fixture: false });
  if (t.turnover !== null) add({ side: t.turnover >= 0.05 ? "bull" : "bear", plane: "ryo_market", claim: t.turnover >= 0.05 ? `Liquid: 24h turnover ${(t.turnover * 100).toFixed(1)}% of market cap — stops are fillable.` : `Illiquid: 24h turnover only ${(t.turnover * 100).toFixed(2)}% of market cap.`, cite: `analyze_token(${s}).data.market.volume_24h_usd / market_cap_usd`, value: t.turnover.toFixed(4), weight: t.turnover >= 0.05 ? 0.4 : 0.7, fixture: false });
  if (t.atrPct !== null && t.atrPct > 15) add({ side: "bear", plane: "ryo_market", claim: `Measured volatility ATR(14) ${t.atrPct}% of price — stop distance explodes.`, cite: `analyze_token(${s}).data.technical_analysis.atr_14_pct`, value: String(t.atrPct), weight: 0.7, fixture: false });
  if (t.ch30d !== null && t.ch30d > 80) add({ side: "bear", plane: "ryo_market", claim: `Already +${t.ch30d.toFixed(0)}% over 30d — late entry risk.`, cite: `analyze_token(${s}).data.performance.change_30d_pct`, value: t.ch30d.toFixed(2), weight: 0.4, fixture: false });
  if (t.deepVerdict) add({ side: ["constructive", "bullish", "accumulate"].includes(t.deepVerdict) ? "bull" : "bear", plane: "ryo_market", claim: `RYO deep_analysis verdict: ${t.deepVerdict}.`, cite: `deep_analysis(${s}).data.verdict.call`, value: t.deepVerdict, weight: 0.5, fixture: false });
  if (t.perp && t.perp.oiChange24h !== null && t.perp.oiChange24h > 15 && t.ch24h !== null && t.ch24h < 0) add({ side: "bear", plane: "ryo_market", claim: `Open interest +${t.perp.oiChange24h}% into a falling price: fresh shorts or trapped longs.`, cite: `deep_analysis(${s}).data.derivatives.open_interest_change_24h_pct`, value: String(t.perp.oiChange24h), weight: 0.3, fixture: false });
  if (t.mcap !== null && t.mcap > 1e10) add({ side: "bull", plane: "ryo_market", claim: "Large-cap with deep liquidity; manipulation by a few wallets is costly.", cite: `deep_analysis(${s}).data.market.mcap_usd`, value: t.mcap.toFixed(0), weight: 0.3, fixture: false });
  // ---- RYO sentiment plane (market-wide)
  if (m.liquidationPressure === "extreme" && m.liquidationLongShare !== null && m.liquidationLongShare > 70) add({ side: "bull", plane: "ryo_sentiment", claim: `Extreme BTC long liquidations (${m.liquidationLongShare.toFixed(0)}% longs): leverage has been flushed — classic dip-buy precondition.`, cite: "monitor_market_sentiment_shift.data.evidence.liquidation", value: `${m.liquidationPressure}/${m.liquidationLongShare.toFixed(1)}%`, weight: 0.4, fixture: false });
  if (m.fundingCrowding === "long_crowding") add({ side: "bear", plane: "ryo_sentiment", claim: "BTC funding still long-crowded: the flush may not be finished.", cite: "monitor_market_sentiment_shift.data.evidence.funding.crowding_state", value: m.fundingCrowding, weight: 0.4, fixture: false });
  if (m.fearGreed !== null && m.fearGreed <= 40) add({ side: "bull", plane: "ryo_sentiment", claim: `Fear & Greed ${m.fearGreed} (${m.fearGreedChange7d ?? "?"} pts 7d): contrarian entries are priced better in fear.`, cite: "monitor_market_sentiment_shift.data.evidence.fear_greed.value", value: String(m.fearGreed), weight: 0.3, fixture: false });
  if (m.regime === "risk_off") add({ side: "bear", plane: "ryo_sentiment", claim: `Market regime risk_off with breadth ${m.breadth ?? "?"}: most assets declining together.`, cite: "market_overview.data.regime", value: m.regime, weight: 0.4, fixture: false });
  // ---- KOL plane (fixture)
  if (n.posts.length) {
    if (n.weightedSentiment !== null && n.weightedSentiment > 0.2 && n.echoRatio < 0.4) add({ side: "bull", plane: "kol", claim: `${n.independentVoices} independent voices lean positive (weighted ${n.weightedSentiment}).`, cite: `kol_radar(${s}).weightedSentiment`, value: String(n.weightedSentiment), weight: 0.3, fixture });
    if (n.echoRatio >= 0.4) add({ side: "bear", plane: "kol", claim: `Echo chamber: ${(n.echoRatio * 100).toFixed(0)}% of posts are near-duplicates — ${n.posts.length} posts collapse to ${n.independentVoices} voices.`, cite: `kol_radar(${s}).echoRatio`, value: String(n.echoRatio), weight: 0.5, fixture });
    if (n.avgUrgency !== null && n.avgUrgency > 0.4) add({ side: "bear", plane: "kol", claim: `High urgency language (${n.avgUrgency}) — 'last chance' framing is a pressure tactic.`, cite: `kol_radar(${s}).avgUrgency`, value: String(n.avgUrgency), weight: 0.4, fixture });
    if (n.weightedSentiment !== null && n.weightedSentiment < -0.2) add({ side: "bear", plane: "kol", claim: `Trusted voices lean negative (weighted ${n.weightedSentiment}).`, cite: `kol_radar(${s}).weightedSentiment`, value: String(n.weightedSentiment), weight: 0.4, fixture });
  }
  // ---- Whale plane (fixture)
  if (w.events.length) {
    if (w.trap) add({ side: "bear", plane: "whale", claim: `Exit-liquidity pattern: ${w.detail}.`, cite: `whale_forensics(${s}).trap`, value: `lead ${w.leadMin}m / lag ${w.lagMin}m`, weight: 1, fixture });
    else if (w.netExchangeFlowUsd !== null && w.netExchangeFlowUsd < 0) add({ side: "bull", plane: "whale", claim: `Whales absorbing: net $${(-w.netExchangeFlowUsd / 1e6).toFixed(2)}M withdrawn from exchanges.`, cite: `whale_forensics(${s}).netExchangeFlowUsd`, value: w.netExchangeFlowUsd.toFixed(0), weight: 0.5, fixture });
    else if (w.netExchangeFlowUsd !== null && w.netExchangeFlowUsd > 0) add({ side: "bear", plane: "whale", claim: `Distribution: net $${(w.netExchangeFlowUsd / 1e6).toFixed(2)}M sent to exchanges.`, cite: `whale_forensics(${s}).netExchangeFlowUsd`, value: w.netExchangeFlowUsd.toFixed(0), weight: 0.6, fixture });
  }
  // ---- News plane
  for (const c of news.claims) {
    if (c.verdict === "verified_primary" || c.verdict === "corroborated_by_ryo") add({ side: "bull", plane: "news", claim: `Catalyst '${c.claim}' is verified (${c.basis}).`, cite: `news_check(${s}).${c.claim}`, value: c.verdict, weight: 0.4, fixture: fixture && c.verdict !== "corroborated_by_ryo" });
    else if (c.verdict === "rumor_only" || c.verdict === "unsupported") add({ side: "bear", plane: "news", claim: `Catalyst '${c.claim}' is ${c.verdict.replace("_", " ")} — narrative without a primary source.`, cite: `news_check(${s}).${c.claim}`, value: c.verdict, weight: 0.5, fixture });
  }
  // ---- Exchange plane: price action and perpetual positioning read from the exchange itself, independent of RYO.
  // Scored symmetrically: it can corroborate RYO or contradict it.
  if (mk && mk.candles.length >= 2) {
    const first = mk.candles[0], last = mk.candles[mk.candles.length - 1];
    const ch = ((last.c - first.o) / first.o) * 100;
    const venue = mk.venue ?? "exchange";
    if (mk.oiChange24hPct !== null && Math.abs(mk.oiChange24hPct) >= 5) {
      const oi = mk.oiChange24hPct, up = ch >= 0;
      const [side, claim, weight]: [Argument["side"], string, number] =
        oi > 0 && !up ? ["bear", `Open interest +${oi.toFixed(1)}% while price fell ${ch.toFixed(1)}%: new shorts are pressing the move.`, 0.4]
        : oi > 0 && up ? ["bull", `Open interest +${oi.toFixed(1)}% with price +${ch.toFixed(1)}%: new positions are backing the move.`, 0.4]
        : !up ? ["bull", `Open interest ${oi.toFixed(1)}% while price fell ${ch.toFixed(1)}%: leverage is being flushed, not added.`, 0.3]
        : ["bear", `Open interest ${oi.toFixed(1)}% while price rose ${ch.toFixed(1)}%: a short-covering rally without new buyers.`, 0.3];
      add({ side, plane: "exchange", claim, cite: `exchange(${s}).oiChange24hPct`, value: `${oi.toFixed(2)}% (${venue})`, weight, fixture: false });
    }
    if (mk.fundingRate !== null) {
      const ann = mk.fundingRate * 3 * 365 * 100;
      if (ann > 30) add({ side: "bear", plane: "exchange", claim: `Perp funding ${ann.toFixed(0)}% annualised: longs are crowded and paying to stay in.`, cite: `exchange(${s}).fundingRate`, value: `${mk.fundingRate} (${venue})`, weight: 0.4, fixture: false });
      else if (ann < -10) add({ side: "bull", plane: "exchange", claim: `Perp funding ${ann.toFixed(0)}% annualised: shorts are paying, so the crowd is leaning the other way.`, cite: `exchange(${s}).fundingRate`, value: `${mk.fundingRate} (${venue})`, weight: 0.3, fixture: false });
    }
    const lo = Math.min(...mk.candles.map((c) => c.l)), hi = Math.max(...mk.candles.map((c) => c.h));
    if (hi > lo) {
      const pos = (last.c - lo) / (hi - lo);
      if (pos <= 0.15 && ch < 0) add({ side: "bear", plane: "exchange", claim: `Closing at the bottom of its 24h range (${(pos * 100).toFixed(0)}%) after a ${ch.toFixed(1)}% day: no sign of a bounce yet.`, cite: `exchange(${s}).candles_1h`, value: `${last.c} in ${lo}–${hi}`, weight: 0.3, fixture: false });
      else if (pos >= 0.6 && ch < 0) add({ side: "bull", plane: "exchange", claim: `Recovered to ${(pos * 100).toFixed(0)}% of its 24h range after the drop: buyers stepped in.`, cite: `exchange(${s}).candles_1h`, value: `${last.c} in ${lo}–${hi}`, weight: 0.3, fixture: false });
    }
  }
  return A;
}

/** Planes that support entry — used by the min_planes mandate clause. */
export function supportingPlanes(args: Argument[]): string[] {
  const planes = new Map<string, number>();
  for (const a of args) planes.set(a.plane, (planes.get(a.plane) ?? 0) + (a.side === "bull" ? a.weight : -a.weight));
  // ryo_sentiment is market-wide and cannot by itself corroborate a specific token
  return [...planes.entries()].filter(([p, v]) => v > 0 && p !== "ryo_sentiment").map(([p]) => p).sort();
}

export interface Position {
  symbol: string;
  side: "long";
  equityUsd: number;
  entry: number;
  tranches: { pct: number; price: number }[];
  stop: number;
  stopBasis: string;
  targets: { price: number; r: number; closePct: number }[];
  riskUsd: number;
  units: number;
  notionalUsd: number;
  portfolioPct: number;
  sizeScale: number;
  sizeBasis: string[];
  invalidation: string;
  timeStopHours: number;
}

export function sizePosition(t: TokenEvidence, ast: MandateAST, regime: string | null, equityUsd: number): Position | null {
  const entry = t.tradePlan?.entry ?? t.price;
  if (entry === null || t.atrPct === null) return null;
  const atrUsd = t.tradePlan?.atrUsd ?? (entry * t.atrPct) / 100;
  const stopRule = clauseOf(ast, "stop_rule") ?? { atrMult: 1.5, maxPct: 8 };
  const atrStop = entry - stopRule.atrMult * atrUsd;
  const capStop = entry * (1 - stopRule.maxPct / 100);
  const stop = Math.max(atrStop, capStop);
  const stopBasis = stop === atrStop ? `${stopRule.atrMult} × ATR(14) $${atrUsd.toFixed(4)} below entry` : `capped at ${stopRule.maxPct}% (ATR stop would be wider)`;
  const riskPct = clauseOf(ast, "risk_per_trade")?.maxPct ?? 1;
  const maxPos = clauseOf(ast, "max_position")?.maxPct ?? 10;
  const sizeBasis: string[] = [];
  let scale = 1;
  for (const c of ast.clauses)
    if (c.clause.kind === "regime_scaling" && c.clause.regime === regime) {
      scale *= c.clause.factor;
      sizeBasis.push(`${c.id}: regime ${regime} → × ${c.clause.factor}`);
    }
  const perUnitRisk = entry - stop;
  let units = ((equityUsd * riskPct) / 100 / perUnitRisk) * scale;
  sizeBasis.unshift(`risk ${riskPct}% of $${equityUsd.toLocaleString()} ÷ $${perUnitRisk.toFixed(4)} per-unit risk`);
  if (units * entry > (equityUsd * maxPos) / 100) {
    units = (equityUsd * maxPos) / 100 / entry;
    sizeBasis.push(`capped by max position ${maxPos}%`);
  }
  const R = perUnitRisk;
  const ryoTargets = t.tradePlan?.targets ?? [];
  const targets = (ryoTargets.length ? ryoTargets.slice(0, 2) : [entry + R, entry + 2 * R]).map((p, i) => ({ price: p, r: +((p - entry) / R).toFixed(2), closePct: i === 0 ? 50 : 50 }));
  return {
    symbol: t.symbol,
    side: "long",
    equityUsd,
    entry,
    // Buy-the-dip: 60% at entry, 40% resting half an ATR lower — still one atomic decision.
    tranches: [
      { pct: 60, price: entry },
      { pct: 40, price: +(entry - 0.5 * atrUsd).toPrecision(8) },
    ],
    stop,
    stopBasis,
    targets,
    riskUsd: +(units * perUnitRisk).toFixed(2),
    units: +units.toPrecision(6),
    notionalUsd: +(units * entry).toFixed(2),
    portfolioPct: +(((units * entry) / equityUsd) * 100).toFixed(3),
    sizeScale: scale,
    sizeBasis,
    invalidation: `Daily close below $${stop.toPrecision(6)} or any mandate gate flipping to fail on re-run.`,
    timeStopHours: 72,
  };
}

export interface Judgment {
  symbol: string;
  decision: "SELECT" | "REJECT";
  bullScore: number;
  bearScore: number;
  failedGates: GateResult[];
  reasoning: string[];
  whatChangesIt: string[];
}

/** The Judge: mandate gates are binding; argument balance only decides among gate-compliant candidates. */
export function judge(symbol: string, args: Argument[], gates: GateResult[], position: Position | null): Judgment {
  const bull = +args.filter((a) => a.side === "bull").reduce((s, a) => s + a.weight, 0).toFixed(2);
  const bear = +args.filter((a) => a.side === "bear").reduce((s, a) => s + a.weight, 0).toFixed(2);
  const failed = gates.filter((g) => g.outcome === "fail");
  const reasoning: string[] = [];
  const whatChangesIt: string[] = [];
  if (failed.length) {
    reasoning.push(`${failed.length} binding mandate clause(s) failed: ${failed.map((g) => g.id).join(", ")}. The debate cannot override the mandate.`);
    for (const g of failed) {
      reasoning.push(`${g.id} [${g.anchor.code}] ${g.counterexample}`);
      whatChangesIt.push(`${g.id}: ${g.prose}`);
    }
  } else if (!position) {
    reasoning.push("All gates pass but no position can be sized (entry or ATR unavailable).");
  } else if (bull <= bear) {
    reasoning.push(`Gates pass, but the bear case (${bear}) outweighs the bull case (${bull}); the Judge declines a marginal trade.`);
    whatChangesIt.push(`Bull evidence must exceed bear evidence (currently ${bull} vs ${bear}).`);
  } else {
    reasoning.push(`All ${gates.filter((g) => g.outcome === "pass").length} testable clauses pass and the bull case (${bull}) outweighs the bear case (${bear}).`);
    const topBear = args.filter((a) => a.side === "bear").sort((a, b) => b.weight - a.weight)[0];
    if (topBear) reasoning.push(`Strongest bear point accepted as risk, handled by sizing: "${topBear.claim}"`);
    whatChangesIt.push("Any gate failing on a fresh RYO read, or the stop being hit.");
  }
  const decision = !failed.length && position && bull > bear ? "SELECT" : "REJECT";
  return { symbol, decision, bullScore: bull, bearScore: bear, failedGates: failed, reasoning, whatChangesIt };
}
