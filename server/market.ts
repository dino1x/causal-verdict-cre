// Independent market data, keyless and server-side, as of the run's reference time (no look-ahead):
//   • exchange candles (1h, the 24 that closed before the reference time), perpetual funding and 24h open-interest
//     change: Binance first, then OKX, then Bybit (Binance refuses some regions, e.g. US-hosted servers)
//   • Chainlink Data Feeds on Ethereum mainnet: the round that was current at the reference time. Each feed address
//     is checked at runtime by its own description() ("SOL / USD"), so a wrong address can never pass as a price.
// Anything that fails is reported as unavailable with its reason; nothing is filled in.
import { createPublicClient, fallback, http, parseAbi, type Hex } from "viem";
import { mainnet } from "viem/chains";
import type { FeedSource, MarketSnap } from "../src/engine/pipeline";
import { CHAINLINK_FEED_ADDRESSES } from "../src/engine/creCodegen";

// Verified on-chain on 2026-10-31 by description(); re-verified on every read. Shared with the CRE config.
export const CHAINLINK_FEEDS = CHAINLINK_FEED_ADDRESSES as Record<string, Hex>;
const FEED_ABI = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const eth = createPublicClient({
  chain: mainnet,
  transport: fallback(["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://1rpc.io/eth"].map((u) => http(u, { timeout: 12_000, retryCount: 1 }))),
});

async function getJson(url: string, timeoutMs = 12_000): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return await r.json();
      last = new Error(`HTTP ${r.status}`);
      if (r.status < 500 && r.status !== 429) break; // unsupported pair or region: do not hammer
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 1200));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

type Candle = MarketSnap["candles"][number];

// A pair whose last candle closed long before the reference time is delisted or a different asset that shares the
// ticker (e.g. Binance's old BEAMUSDT); it must not be compared with RYO's token.
function fresh(candles: Candle[], refMs: number) {
  if (!candles.length) throw new Error("no candles");
  const lastClose = candles[candles.length - 1].t + 3_600_000;
  if (refMs - lastClose > 2 * 3_600_000) throw new Error(`stale pair: last candle closed ${new Date(lastClose).toISOString()} (delisted or a different asset)`);
  return candles;
}

async function binance(sym: string, refMs: number) {
  const pair = `${sym}USDT`;
  const k = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1h&endTime=${refMs - 1}&limit=25`);
  const candles = fresh((k as any[]).filter((r) => r[6] < refMs).slice(-24).map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] })), refMs);
  let fundingRate: number | null = null, oiChange24hPct: number | null = null, derivVenue: string | null = null;
  try {
    const f = await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&endTime=${refMs}&limit=1`);
    if (f[0]) (fundingRate = +f[0].fundingRate), (derivVenue = "binance");
    const oi = await getJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${pair}&period=1h&endTime=${refMs}&limit=25`);
    if (oi.length >= 2) oiChange24hPct = ((+oi[oi.length - 1].sumOpenInterestValue - +oi[0].sumOpenInterestValue) / +oi[0].sumOpenInterestValue) * 100;
  } catch {}
  return { venue: "binance", candles, fundingRate, oiChange24hPct, derivVenue, url: `https://www.binance.com/en/trade/${sym}_USDT` };
}

async function okx(sym: string, refMs: number) {
  const inst = `${sym}-USDT`;
  const k = await getJson(`https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=1H&after=${refMs}&limit=25`);
  if (k.code !== "0") throw new Error(k.msg || "okx error");
  const candles = fresh((k.data as any[]).filter((r) => r[8] === "1" && +r[0] + 3_600_000 <= refMs).reverse().slice(-24).map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] })), refMs);
  let fundingRate: number | null = null, oiChange24hPct: number | null = null, derivVenue: string | null = null;
  try {
    const f = await getJson(`https://www.okx.com/api/v5/public/funding-rate-history?instId=${inst}-SWAP&after=${refMs}&limit=1`);
    if (f.data?.[0]) (fundingRate = +f.data[0].realizedRate || +f.data[0].fundingRate), (derivVenue = "okx");
    const oi = await getJson(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${inst}-SWAP&period=1H&end=${refMs}&limit=25`);
    const rows = (oi.data ?? []) as any[]; // newest first: [ts, oi, oiCcy, oiUsd]
    if (rows.length >= 2) oiChange24hPct = ((+rows[0][3] - +rows[rows.length - 1][3]) / +rows[rows.length - 1][3]) * 100;
  } catch {}
  return { venue: "okx", candles, fundingRate, oiChange24hPct, derivVenue, url: `https://www.okx.com/trade-spot/${sym.toLowerCase()}-usdt` };
}

async function bybit(sym: string, refMs: number) {
  const pair = `${sym}USDT`;
  const k = await getJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair}&interval=60&end=${refMs - 1}&limit=25`);
  if (k.retCode !== 0) throw new Error(k.retMsg || "bybit error");
  const candles = fresh((k.result.list as any[]).filter((r) => +r[0] + 3_600_000 <= refMs).reverse().slice(-24).map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] })), refMs);
  let fundingRate: number | null = null, oiChange24hPct: number | null = null, derivVenue: string | null = null;
  try {
    const f = await getJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${pair}&endTime=${refMs}&limit=1`);
    if (f.result?.list?.[0]) (fundingRate = +f.result.list[0].fundingRate), (derivVenue = "bybit");
    const oi = await getJson(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${pair}&intervalTime=1h&endTime=${refMs}&limit=25`);
    const rows = (oi.result?.list ?? []) as any[]; // newest first
    if (rows.length >= 2) oiChange24hPct = ((+rows[0].openInterest - +rows[rows.length - 1].openInterest) / +rows[rows.length - 1].openInterest) * 100;
  } catch {}
  return { venue: "bybit", candles, fundingRate, oiChange24hPct, derivVenue, url: `https://www.bybit.com/en/trade/spot/${sym}/USDT` };
}

async function chainlinkAt(sym: string, refSec: number): Promise<{ price: number; updatedAt: number; feed: Hex } | { error: string }> {
  const feed = CHAINLINK_FEEDS[sym];
  if (!feed) return { error: "no Chainlink Data Feed on Ethereum mainnet for this token" };
  try {
    const desc = await eth.readContract({ address: feed, abi: FEED_ABI, functionName: "description" });
    if (desc.replace(/\s/g, "") !== `${sym}/USD`) return { error: `feed ${feed} describes itself as "${desc}", not ${sym} / USD` };
    const dec = await eth.readContract({ address: feed, abi: FEED_ABI, functionName: "decimals" });
    let [roundId, answer, , updatedAt] = await eth.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" });
    // Walk back within the current phase to the round that was current at the reference time.
    for (let i = 0; i < 60 && Number(updatedAt) > refSec; i++) {
      roundId -= 1n;
      [, answer, , updatedAt] = await eth.readContract({ address: feed, abi: FEED_ABI, functionName: "getRoundData", args: [roundId] });
    }
    if (Number(updatedAt) > refSec) return { error: "no round at or before the reference time within 60 rounds" };
    return { price: Number(answer) / 10 ** dec, updatedAt: Number(updatedAt), feed };
  } catch (e) {
    return { error: `RPC: ${(e as Error).message.split("\n")[0].slice(0, 100)}` };
  }
}

export async function collectMarkets(symbols: string[], referenceTime: string, sources: FeedSource[]): Promise<MarketSnap[]> {
  const refMs = Date.parse(referenceTime);
  const out: MarketSnap[] = [];
  for (const sym of symbols) {
    let ex: Awaited<ReturnType<typeof binance>> | null = null;
    const errors: string[] = [];
    for (const venue of [binance, okx, bybit]) {
      try {
        ex = await venue(sym, refMs);
        break;
      } catch (e) {
        errors.push(`${venue.name}: ${(e as Error).message.slice(0, 60)}`);
      }
    }
    const cl = await chainlinkAt(sym, Math.floor(refMs / 1000));
    sources.push(ex ? { feed: "exchange", target: `${sym} ${ex.venue}`, ok: true, items: ex.candles.length, detail: `${ex.candles.length} 1h candles before ${referenceTime}; funding ${ex.fundingRate ?? "unavailable"}; OI 24h ${ex.oiChange24hPct === null ? "unavailable" : `${ex.oiChange24hPct.toFixed(1)}%`} (${ex.derivVenue ?? "no perp"})` } : { feed: "exchange", target: sym, ok: false, items: 0, detail: `unavailable: ${errors.join("; ")}` });
    sources.push("error" in cl ? { feed: "chainlink", target: sym, ok: false, items: 0, detail: cl.error } : { feed: "chainlink", target: `${sym} / USD`, ok: true, items: 1, detail: `round updated ${new Date(cl.updatedAt * 1000).toISOString()} at ${cl.price}` });
    if (!ex && "error" in cl) continue;
    const last = ex?.candles[ex.candles.length - 1];
    const priceRef =
      !("error" in cl) && refMs / 1000 - cl.updatedAt <= 86_400
        ? { price: cl.price, source: `Chainlink ${sym}/USD`, updatedAt: new Date(cl.updatedAt * 1000).toISOString(), url: `https://etherscan.io/address/${cl.feed}` }
        : last
          ? { price: last.c, source: `${ex!.venue} ${sym}/USDT 1h close`, updatedAt: new Date(last.t + 3_600_000).toISOString(), url: ex!.url }
          : null;
    out.push({ symbol: sym, venue: ex?.venue ?? null, candles: ex?.candles ?? [], fundingRate: ex?.fundingRate ?? null, oiChange24hPct: ex?.oiChange24hPct === undefined || ex?.oiChange24hPct === null ? null : +ex.oiChange24hPct.toFixed(2), priceRef, source: ex?.url ?? null });
  }
  return out;
}
