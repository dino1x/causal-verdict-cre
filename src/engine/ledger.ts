// Practice-trade ledger: every run's practice trade is recorded, and later runs mark open positions
// to market with RYO prices and close them at stop / targets / time stop. Pure and deterministic;
// persistence lives in the caller. Each event is hash-chained like the reasoning trace.
import { canonical } from "./ryo";
import { hashHex, type RunResult } from "./pipeline";

export interface LedgerPosition {
  id: string; // runId-derived
  symbol: string;
  openedAt: string; // run reference time (RYO as_of)
  openTraceRoot: string;
  mandateHash: string;
  entry: number;
  stop: number;
  targets: { price: number; r: number; closePct: number }[];
  units: number;
  riskUsd: number;
  timeStopHours: number;
  status: "open" | "closed";
  remainingPct: number;
  stopNow: number; // moves to entry after target 1 (risk-free runner)
  fills: { at: string; price: number; pct: number; reason: "target1" | "target2" | "stop" | "time_stop"; pnlUsd: number }[];
  marks: { at: string; price: number; source: string }[];
  realizedPnlUsd: number;
  realizedR: number | null;
}

export interface LedgerEvent {
  i: number;
  at: string;
  kind: "open" | "mark" | "fill" | "close" | "no_trade";
  symbol: string | null;
  detail: string;
  traceRoot: string;
  prev: string;
  hash: string;
}

export interface Ledger {
  version: 1;
  positions: LedgerPosition[];
  events: LedgerEvent[];
  runs: { at: string; traceRoot: string; provenance: Record<string, number>; evidenceMode: string; decision: string }[];
}

export const emptyLedger = (): Ledger => ({ version: 1, positions: [], events: [], runs: [] });

const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

function addEvent(l: Ledger, e: Omit<LedgerEvent, "i" | "prev" | "hash">) {
  const prev = l.events.length ? l.events[l.events.length - 1].hash : "0x" + "0".repeat(64);
  const i = l.events.length;
  const hash = hashHex(`${prev}|${i}|${canonical(e)}`);
  l.events.push({ ...e, i, prev, hash });
}

export function verifyLedger(l: Ledger): { ok: boolean; brokenAt: number | null } {
  let prev = "0x" + "0".repeat(64);
  for (const e of l.events) {
    const { i, prev: p, hash, ...body } = e;
    if (p !== prev || hashHex(`${prev}|${i}|${canonical(body)}`) !== hash) return { ok: false, brokenAt: i };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}

/** Latest observed price per symbol from this run's RYO envelopes (analyze_token preferred). */
export function runPrices(run: RunResult): Map<string, { price: number; source: string; asOf: string }> {
  const m = new Map<string, { price: number; source: string; asOf: string }>();
  for (const c of run.calls) {
    const sym = c.args.symbol as string | undefined;
    const p = c.envelope?.data?.market?.price_usd;
    if (sym && typeof p === "number" && Number.isFinite(p) && (!m.has(sym) || c.tool === "analyze_token"))
      m.set(sym, { price: p, asOf: c.envelope!.as_of, source: `${c.tool}(${sym}) ${c.provenance} as_of ${c.envelope!.as_of} sha ${c.envelope_sha256?.slice(0, 12)}` });
  }
  return m;
}

/**
 * Apply one run: mark/close open positions with this run's prices, then record its practice trade.
 * Positions are only marked at observation points — intra-period highs/lows are not observed,
 * so a stop or target counts as hit only if an observed price is beyond it.
 */
export function applyRun(prev: Ledger, run: RunResult, extraPrices: Map<string, { price: number; source: string; asOf: string }> = new Map()): Ledger {
  const l: Ledger = structuredClone(prev);
  const at = run.referenceTime ?? new Date(0).toISOString();
  if (l.runs.some((r) => r.traceRoot === run.trace.root)) return l; // idempotent
  // A run whose reference time is not newer than the last recorded run (e.g. snapshot fallback) is stale.
  if (l.runs.length && Date.parse(at) <= Date.parse(l.runs[l.runs.length - 1].at)) return l;
  const prices = new Map([...extraPrices, ...runPrices(run)]);

  for (const p of l.positions.filter((x) => x.status === "open")) {
    if (Date.parse(at) <= Date.parse(p.openedAt)) continue;
    const obs = prices.get(p.symbol);
    // Only a price observed after the position was opened may mark it.
    if (!obs || Date.parse(obs.asOf) <= Date.parse(p.openedAt)) {
      addEvent(l, { at, kind: "mark", symbol: p.symbol, detail: "no RYO price this run — position not marked (missing, not assumed)", traceRoot: run.trace.root });
      continue;
    }
    p.marks.push({ at, price: obs.price, source: obs.source });
    const fill = (pct: number, price: number, reason: LedgerPosition["fills"][number]["reason"]) => {
      const usd = (price - p.entry) * p.units * (pct / 100);
      p.fills.push({ at, price, pct, reason, pnlUsd: +usd.toFixed(2) });
      p.remainingPct -= pct;
      p.realizedPnlUsd = +(p.realizedPnlUsd + usd).toFixed(2);
      addEvent(l, { at, kind: "fill", symbol: p.symbol, detail: `${reason}: ${pct}% at ${price} (${usd >= 0 ? "+" : ""}${usd.toFixed(2)} USD)`, traceRoot: run.trace.root });
    };
    if (obs.price <= p.stopNow) fill(p.remainingPct, p.stopNow, "stop");
    else {
      const [t1, t2] = p.targets;
      if (t1 && p.fills.every((f) => f.reason !== "target1") && obs.price >= t1.price) {
        fill(t1.closePct, t1.price, "target1");
        p.stopNow = p.entry; // runner is now risk-free
      }
      if (t2 && p.remainingPct > 0 && obs.price >= t2.price) fill(p.remainingPct, t2.price, "target2");
      if (p.remainingPct > 0 && hoursBetween(p.openedAt, at) >= p.timeStopHours) fill(p.remainingPct, obs.price, "time_stop");
    }
    if (p.remainingPct <= 0) {
      p.status = "closed";
      p.realizedR = p.riskUsd ? +(p.realizedPnlUsd / p.riskUsd).toFixed(3) : null;
      addEvent(l, { at, kind: "close", symbol: p.symbol, detail: `closed: ${p.realizedPnlUsd >= 0 ? "+" : ""}${p.realizedPnlUsd} USD (${p.realizedR}R)`, traceRoot: run.trace.root });
    } else addEvent(l, { at, kind: "mark", symbol: p.symbol, detail: `marked at ${obs.price} (unrealized ${((obs.price - p.entry) * p.units * (p.remainingPct / 100)).toFixed(2)} USD)`, traceRoot: run.trace.root });
  }

  const t = run.practiceTrade;
  // One open position per symbol: a repeat SELECT on an already-open symbol is logged, not doubled.
  if (t && !l.positions.some((p) => p.status === "open" && p.symbol === t.position.symbol)) {
    const pos = t.position;
    l.positions.push({
      id: run.trace.root.slice(0, 18),
      symbol: pos.symbol,
      openedAt: at,
      openTraceRoot: run.trace.root,
      mandateHash: run.mandateHash,
      entry: pos.entry,
      stop: pos.stop,
      targets: pos.targets,
      units: pos.units,
      riskUsd: pos.riskUsd,
      timeStopHours: pos.timeStopHours,
      status: "open",
      remainingPct: 100,
      stopNow: pos.stop,
      fills: [],
      marks: [{ at, price: pos.entry, source: "entry (RYO deep_analysis.trade_plan.entry)" }],
      realizedPnlUsd: 0,
      realizedR: null,
    });
    addEvent(l, { at, kind: "open", symbol: pos.symbol, detail: `open ${pos.units} @ ${pos.entry}, stop ${pos.stop.toPrecision(6)}, targets ${pos.targets.map((x) => x.price).join("/")}, risk ${pos.riskUsd} USD`, traceRoot: run.trace.root });
  } else if (t) {
    addEvent(l, { at, kind: "no_trade", symbol: t.position.symbol, detail: `SELECT ${t.position.symbol} again — already open, not doubled`, traceRoot: run.trace.root });
  } else {
    addEvent(l, { at, kind: "no_trade", symbol: null, detail: "no candidate satisfied the mandate", traceRoot: run.trace.root });
  }
  l.runs.push({ at, traceRoot: run.trace.root, provenance: run.provenanceMix, evidenceMode: run.evidenceMode, decision: t ? `SELECT ${t.position.symbol}` : "NO TRADE" });
  return l;
}

export function ledgerStats(l: Ledger) {
  const closed = l.positions.filter((p) => p.status === "closed");
  const wins = closed.filter((p) => p.realizedPnlUsd > 0).length;
  return {
    runs: l.runs.length,
    open: l.positions.filter((p) => p.status === "open").length,
    closed: closed.length,
    winRate: closed.length ? wins / closed.length : null,
    realizedPnlUsd: +closed.reduce((s, p) => s + p.realizedPnlUsd, 0).toFixed(2),
    avgR: closed.length && closed.every((p) => p.realizedR !== null) ? +(closed.reduce((s, p) => s + p.realizedR!, 0) / closed.length).toFixed(3) : null,
  };
}
