// Multi-KOL narrative radar, echo collapse, news checker, whale lead-lag forensics.
// Pure + deterministic: same inputs -> same outputs (no clock, no randomness).
import type { KolPost, KolVoice, NewsItem, WhaleEvent } from "../data/scenarioFixtures";

export interface ScoredPost extends KolPost {
  tokens: string[];
  sentiment: number; // -1..1
  conviction: number; // 0..1
  urgency: number; // 0..1
  disclosed: boolean; // "#ad", "sponsored", "I hold" ...
  claims: string[];
  cluster: number; // echo cluster id (near-duplicate text)
}

const BULL = ["send", "moon", "breakout", "long", "buy", "loading", "load", "accumulate", "bounce", "undervalued", "10x", "100x", "aping", "ape", "gem", "rotating", "printing", "never die", "target", "scaling in"];
const BEAR = ["dump", "rug", "exit", "unlock", "short", "avoid", "pass", "careful", "bleed", "dead-cat", "not touching", "overhang", "lower", "can't exit", "illiquid"];
const CONVICTION = ["max conviction", "all in", "loading", "i'm long", "aping", "bag", "i hold", "scaling in"];
const URGENCY = ["now", "last chance", "don't miss", "hurry", "too late", "before", "🚨", "this week", "incoming", "about to"];
const DISCLOSURE = ["#ad", "sponsored", "paid", "i hold", "disclosure"];
export const CLAIMS = ["partnership", "gaming studio", "integration", "polygon", "open money stack", "listing", "unlock", "etf", "hack"];

const has = (t: string, w: string) => t.includes(w);
const score = (t: string, list: string[]) => list.filter((w) => has(t, w)).length;

export function extractTokens(text: string, universe: string[]): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9]{0,9})/g)) out.add(m[1].toUpperCase());
  for (const s of universe) if (new RegExp(`\\(\\$?${s}\\)`).test(text)) out.add(s);
  return [...out];
}

function shingles(t: string): Set<string> {
  const w = t.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(" "));
  return s;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  const u = a.size + b.size - i;
  return u === 0 ? 0 : i / u;
};

export const ECHO_THRESHOLD = 0.5;

export function scorePosts(posts: KolPost[], universe: string[]): ScoredPost[] {
  const sh = posts.map((p) => shingles(p.text));
  const cluster: number[] = posts.map((_, i) => i);
  for (let i = 0; i < posts.length; i++)
    for (let j = 0; j < i; j++)
      if (jaccard(sh[i], sh[j]) >= ECHO_THRESHOLD) {
        cluster[i] = cluster[j];
        break;
      }
  return posts.map((p, i) => {
    const t = p.text.toLowerCase();
    const b = score(t, BULL);
    const r = score(t, BEAR);
    return {
      ...p,
      tokens: extractTokens(p.text, universe),
      sentiment: b + r === 0 ? 0 : +((b - r) / (b + r)).toFixed(3),
      conviction: Math.min(1, score(t, CONVICTION) / 2),
      urgency: Math.min(1, score(t, URGENCY) / 3),
      disclosed: DISCLOSURE.some((w) => has(t, w)),
      claims: CLAIMS.filter((w) => has(t, w)),
      cluster: cluster[i],
    };
  });
}

export interface Narrative {
  symbol: string;
  posts: ScoredPost[];
  voices: number; // distinct handles
  independentVoices: number; // distinct echo clusters
  echoRatio: number; // share of posts that are near-duplicates
  weightedSentiment: number | null;
  avgConviction: number | null;
  avgUrgency: number | null;
  undisclosedShare: number | null;
  channels: string[];
  /** Earliest time a sliding window of `windowMin` contains >= minVoices independent voices. */
  convergenceAt: number | null;
  burstWindowMin: number | null; // tightest window containing all independent voices in the burst
  claims: string[];
}

export function buildNarrative(symbol: string, scored: ScoredPost[], voices: KolVoice[], windowMin = 30, minVoices = 3): Narrative {
  const posts = scored.filter((p) => p.tokens.includes(symbol)).sort((a, b) => a.minutes - b.minutes);
  const wOf = (h: string) => voices.find((v) => v.handle === h)?.weight ?? 0.5;
  if (!posts.length)
    return { symbol, posts, voices: 0, independentVoices: 0, echoRatio: 0, weightedSentiment: null, avgConviction: null, avgUrgency: null, undisclosedShare: null, channels: [], convergenceAt: null, burstWindowMin: null, claims: [] };
  const clusters = new Set(posts.map((p) => p.cluster));
  let convergenceAt: number | null = null;
  let burstWindowMin: number | null = null;
  for (let i = 0; i < posts.length && convergenceAt === null; i++) {
    const win = posts.filter((p) => p.minutes >= posts[i].minutes && p.minutes <= posts[i].minutes + windowMin);
    const indep = new Set(win.map((p) => p.cluster));
    if (indep.size >= minVoices) {
      // convergence is reached at the post that brought the window to minVoices independent clusters
      const seen = new Set<number>();
      for (const p of win) {
        seen.add(p.cluster);
        if (seen.size >= minVoices) {
          convergenceAt = p.minutes;
          break;
        }
      }
      burstWindowMin = win[win.length - 1].minutes - win[0].minutes;
    }
  }
  // Weighted sentiment counts each echo cluster once (copies add no information).
  const firstOfCluster = [...clusters].map((c) => posts.find((p) => p.cluster === c)!);
  const wsum = firstOfCluster.reduce((s, p) => s + wOf(p.handle), 0);
  const avg = (f: (p: ScoredPost) => number) => +(posts.reduce((s, p) => s + f(p), 0) / posts.length).toFixed(3);
  return {
    symbol,
    posts,
    voices: new Set(posts.map((p) => p.handle)).size,
    independentVoices: clusters.size,
    echoRatio: +(1 - clusters.size / posts.length).toFixed(3),
    weightedSentiment: wsum ? +(firstOfCluster.reduce((s, p) => s + p.sentiment * wOf(p.handle), 0) / wsum).toFixed(3) : null,
    avgConviction: avg((p) => p.conviction),
    avgUrgency: avg((p) => p.urgency),
    undisclosedShare: avg((p) => (p.disclosed ? 0 : 1)),
    channels: [...new Set(posts.map((p) => p.channel))],
    convergenceAt,
    burstWindowMin,
    claims: [...new Set(posts.flatMap((p) => p.claims))],
  };
}

export interface NewsCheck {
  symbol: string;
  claims: { claim: string; verdict: "verified_primary" | "corroborated_by_ryo" | "secondary_only" | "rumor_only" | "unsupported"; basis: string }[];
  verifiedCatalyst: boolean;
}

/**
 * A claim is verified when a primary source states it, or when RYO's own token-profile /
 * catalyst text (live research evidence) independently mentions it.
 */
export function checkNews(symbol: string, narrative: Narrative, news: NewsItem[], ryoText: string | null): NewsCheck {
  const items = news.filter((n) => n.symbol === symbol);
  const ryo = (ryoText ?? "").toLowerCase();
  // Claims come from KOL posts and from the news items themselves: a catalyst is checked whether or not a KOL repeated it.
  const allClaims = [...new Set([...narrative.claims, ...items.flatMap((n) => n.claimKeywords)])];
  const claims = allClaims.map((claim) => {
    const hits = items.filter((n) => n.claimKeywords.some((k) => k.includes(claim) || claim.includes(k)));
    if (hits.some((h) => h.sourceType === "primary")) return { claim, verdict: "verified_primary" as const, basis: hits.find((h) => h.sourceType === "primary")!.source };
    if (ryo && ryo.includes(claim)) return { claim, verdict: "corroborated_by_ryo" as const, basis: "RYO deep_analysis token_profile public-content text" };
    if (hits.some((h) => h.sourceType === "secondary")) return { claim, verdict: "secondary_only" as const, basis: hits.find((h) => h.sourceType === "secondary")!.source };
    if (hits.length) return { claim, verdict: "rumor_only" as const, basis: hits[0].source };
    return { claim, verdict: "unsupported" as const, basis: "no source found" };
  });
  return { symbol, claims, verifiedCatalyst: claims.some((c) => c.verdict === "verified_primary" || c.verdict === "corroborated_by_ryo") };
}

export interface WhaleForensics {
  symbol: string;
  events: WhaleEvent[];
  netExchangeFlowUsd: number | null; // + = deposits (sell pressure), - = withdrawals (accumulation)
  preConvergenceAccumulators: { wallet: string; firstMinutes: number; usd: number }[];
  postConvergenceDeposits: { wallet: string; minutes: number; usd: number }[];
  leadMin: number | null; // T0 - first accumulation
  lagMin: number | null; // first post-T0 deposit by an accumulator - T0
  trap: boolean;
  detail: string;
}

const ACCUM = new Set(["dex_buy", "exchange_withdrawal"]);

export function whaleForensics(symbol: string, events: WhaleEvent[], convergenceAt: number | null, windowMin: number, minLeadMin = 15): WhaleForensics {
  const ev = events.filter((e) => e.symbol === symbol).sort((a, b) => a.minutes - b.minutes);
  if (!ev.length)
    return { symbol, events: ev, netExchangeFlowUsd: null, preConvergenceAccumulators: [], postConvergenceDeposits: [], leadMin: null, lagMin: null, trap: false, detail: "no whale-flow evidence" };
  const net = ev.reduce((s, e) => s + (e.kind === "exchange_deposit" || e.kind === "dex_sell" ? e.usd : -e.usd), 0);
  if (convergenceAt === null)
    return { symbol, events: ev, netExchangeFlowUsd: net, preConvergenceAccumulators: [], postConvergenceDeposits: [], leadMin: null, lagMin: null, trap: false, detail: `no KOL convergence; net flow ${net > 0 ? "to" : "from"} exchanges $${Math.abs(net / 1e6).toFixed(2)}M` };
  const acc = new Map<string, { wallet: string; firstMinutes: number; usd: number }>();
  for (const e of ev)
    if (ACCUM.has(e.kind) && e.minutes <= convergenceAt - minLeadMin) {
      const cur = acc.get(e.wallet) ?? { wallet: e.wallet, firstMinutes: e.minutes, usd: 0 };
      cur.usd += e.usd;
      acc.set(e.wallet, cur);
    }
  const deposits = ev
    .filter((e) => e.kind === "exchange_deposit" && acc.has(e.wallet) && e.minutes > convergenceAt && e.minutes <= convergenceAt + windowMin)
    .map((e) => ({ wallet: e.wallet, minutes: e.minutes, usd: e.usd }));
  const accumulators = [...acc.values()];
  const leadMin = accumulators.length ? convergenceAt - Math.min(...accumulators.map((a) => a.firstMinutes)) : null;
  const lagMin = deposits.length ? deposits[0].minutes - convergenceAt : null;
  const trap = deposits.length > 0;
  const detail = trap
    ? `${accumulators.length} wallet(s) accumulated $${(accumulators.reduce((s, a) => s + a.usd, 0) / 1e6).toFixed(2)}M ${leadMin}m BEFORE KOL convergence, then ${deposits.length} sent $${(deposits.reduce((s, d) => s + d.usd, 0) / 1e6).toFixed(2)}M to exchanges ${lagMin}m AFTER it`
    : accumulators.length
      ? `${accumulators.length} wallet(s) accumulated ahead of convergence with no exchange deposits after it (holding)`
      : `no pre-convergence accumulation; net flow ${net > 0 ? "to" : "from"} exchanges $${Math.abs(net / 1e6).toFixed(2)}M`;
  return { symbol, events: ev, netExchangeFlowUsd: net, preConvergenceAccumulators: accumulators, postConvergenceDeposits: deposits, leadMin, lagMin, trap, detail };
}
