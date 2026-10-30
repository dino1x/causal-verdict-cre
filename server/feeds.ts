// Real external evidence feeds (server-side, keyless). Everything returned here is observed data
// with a source URL / tx hash; nothing is synthesized. Missing coverage is reported, not filled in.
//   • On-chain whales: ERC-20 Transfer logs from public Ethereum + BSC RPCs for the contract RYO returned
//   • Whale Alert:     large transfers posted on its public Telegram channel (covers non-EVM assets like SOL)
//   • News:            Cointelegraph / Decrypt / CoinDesk RSS
//   • KOL voices:      public Telegram channel previews (t.me/s/<channel>)
// To avoid look-ahead bias, items timestamped after the run's reference time are dropped.
import type { KolPost, KolVoice, NewsItem, WhaleEvent } from "../src/data/scenarioFixtures";
import { CLAIMS } from "../src/engine/evidence";

export interface FeedToken {
  symbol: string;
  name: string | null;
  contract: string | null;
  priceUsd: number | null;
}

export interface FeedSource {
  feed: "onchain" | "whale_alert" | "rss" | "telegram";
  target: string;
  ok: boolean;
  items: number;
  detail: string;
}

export interface FeedBundle {
  referenceTime: string;
  voices: KolVoice[];
  posts: KolPost[];
  whales: WhaleEvent[];
  news: NewsItem[];
  sources: FeedSource[];
}

const CHAINS = [
  { id: "ethereum", rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io/tx/" },
  { id: "bsc", rpc: "https://bsc-rpc.publicnode.com", explorer: "https://bscscan.com/tx/" },
] as const;

// Best-effort public exchange labels (well-known hot/cold wallets). Anything not listed is "unlabelled".
const CEX: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance 14",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance 15",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance 16",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance 17",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance 8",
  "0x8894e0a0c962cb723c1976a4421c95949be2d4e3": "Binance (BSC hot)",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase 1",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase 2",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase 10",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
  "0xd6216fc19db775df9774a6e33526131da7d19a2c": "KuCoin",
};
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WINDOW_MIN = 180;
const MIN_WHALE_USD = 25_000;
const UA = { "User-Agent": "Mozilla/5.0 (causal-verdict research agent)" };

async function rpc(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  return r.json();
}
const call1 = async (url: string, method: string, params: unknown[]) => {
  const j = await rpc(url, { jsonrpc: "2.0", id: 1, method, params });
  if (j.error) throw new Error(j.error.message);
  return j.result;
};
const batch = async (url: string, reqs: { method: string; params: unknown[] }[]) => {
  const out: any[] = [];
  for (let i = 0; i < reqs.length; i += 40) {
    const j = await rpc(url, reqs.slice(i, i + 40).map((r, k) => ({ jsonrpc: "2.0", id: i + k, ...r })));
    for (const x of j as any[]) out[x.id] = x.result;
  }
  return out;
};
const hexN = (h: string) => Number(BigInt(h));

async function blockAt(url: string, refSec: number): Promise<{ ref: number; secPerBlock: number }> {
  const latest = hexN(await call1(url, "eth_blockNumber", []));
  const [a, b] = await batch(url, [
    { method: "eth_getBlockByNumber", params: ["0x" + latest.toString(16), false] },
    { method: "eth_getBlockByNumber", params: ["0x" + (latest - 20000).toString(16), false] },
  ]);
  const tA = hexN(a.timestamp), tB = hexN(b.timestamp);
  const spb = (tA - tB) / 20000;
  let ref = Math.min(latest, Math.round(latest - (tA - refSec) / spb));
  // one correction step against the actual timestamp of the estimate
  const est = await call1(url, "eth_getBlockByNumber", ["0x" + ref.toString(16), false]);
  ref = Math.min(latest, Math.round(ref - (hexN(est.timestamp) - refSec) / spb));
  return { ref, secPerBlock: spb };
}

async function onchainWhales(t: FeedToken, refSec: number, sources: FeedSource[]): Promise<WhaleEvent[]> {
  if (!t.contract || !/^0x[0-9a-fA-F]{40}$/.test(t.contract)) {
    sources.push({ feed: "onchain", target: t.symbol, ok: false, items: 0, detail: t.contract ? "non-EVM contract (no public EVM log source)" : "no contract address from RYO (native asset)" });
    return [];
  }
  if (t.priceUsd === null) {
    sources.push({ feed: "onchain", target: t.symbol, ok: false, items: 0, detail: "no RYO price — cannot value transfers" });
    return [];
  }
  const out: WhaleEvent[] = [];
  for (const ch of CHAINS) {
    try {
      const code = await call1(ch.rpc, "eth_getCode", [t.contract, "latest"]);
      if (!code || code === "0x") continue;
      const dec = hexN(await call1(ch.rpc, "eth_call", [{ to: t.contract, data: "0x313ce567" }, "latest"]));
      const { ref, secPerBlock } = await blockAt(ch.rpc, refSec);
      const span = Math.ceil((WINDOW_MIN * 60) / secPerBlock);
      const logs: any[] = [];
      let step = ch.id === "ethereum" ? 2000 : 5000;
      for (let from = ref - span; from <= ref; ) {
        const to = Math.min(ref, from + step - 1);
        try {
          logs.push(...(await call1(ch.rpc, "eth_getLogs", [{ address: t.contract, topics: [TRANSFER], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) }])));
          from = to + 1;
        } catch (e) {
          if (step <= 250) throw e;
          step = Math.floor(step / 2);
        }
      }
      const scale = 10 ** dec;
      const big = logs
        .map((l) => ({ l, usd: (Number(BigInt(l.data === "0x" ? "0x0" : l.data)) / scale) * t.priceUsd! }))
        .filter((x) => x.usd >= MIN_WHALE_USD)
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 30);
      const addr = (topic: string) => "0x" + topic.slice(26).toLowerCase();
      const parties = [...new Set(big.flatMap((x) => [addr(x.l.topics[1]), addr(x.l.topics[2])]))];
      const codes = await batch(ch.rpc, parties.map((p) => ({ method: "eth_getCode", params: [p, "latest"] })));
      const isContract = new Map(parties.map((p, i) => [p, !!codes[i] && codes[i] !== "0x"]));
      const blocks = [...new Set(big.map((x) => x.l.blockNumber as string))];
      const bts = await batch(ch.rpc, blocks.map((b) => ({ method: "eth_getBlockByNumber", params: [b, false] })));
      const tsOf = new Map(blocks.map((b, i) => [b, bts[i] ? hexN(bts[i].timestamp) : null]));
      let n = 0;
      for (const { l, usd } of big) {
        const from = addr(l.topics[1]), to = addr(l.topics[2]);
        const ts = tsOf.get(l.blockNumber);
        if (ts == null || ts > refSec) continue;
        let kind: WhaleEvent["kind"] | null = null, wallet = "";
        if (CEX[to] && !CEX[from]) [kind, wallet] = ["exchange_deposit", from];
        else if (CEX[from] && !CEX[to]) [kind, wallet] = ["exchange_withdrawal", to];
        else if (isContract.get(from) && !isContract.get(to)) [kind, wallet] = ["dex_buy", to];
        else if (!isContract.get(from) && isContract.get(to)) [kind, wallet] = ["dex_sell", from];
        if (!kind) continue; // EOA→EOA or router hops: not attributable
        out.push({
          id: `${ch.id}:${l.transactionHash}:${hexN(l.logIndex)}`,
          wallet: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
          symbol: t.symbol,
          minutes: Math.round((ts - refSec) / 60),
          kind,
          usd: Math.round(usd),
          source: `${ch.explorer}${l.transactionHash}`,
          counterparty: CEX[to] ?? CEX[from] ?? (kind.startsWith("dex") ? "contract (DEX/router)" : "unlabelled"),
        });
        n++;
      }
      sources.push({ feed: "onchain", target: `${t.symbol}@${ch.id}`, ok: true, items: n, detail: `${logs.length} Transfer logs in ${WINDOW_MIN}m before ref (blocks ${ref - span}–${ref}); ${big.length} ≥ $${MIN_WHALE_USD / 1000}k; ${n} attributable` });
    } catch (e) {
      sources.push({ feed: "onchain", target: `${t.symbol}@${ch.id}`, ok: false, items: 0, detail: String((e as Error).message).slice(0, 120) });
    }
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function telegram(channel: string, pages = 2): Promise<{ id: string; time: number; text: string }[]> {
  const out: { id: string; time: number; text: string }[] = [];
  let before = "";
  for (let p = 0; p < pages; p++) {
    const r = await fetch(`https://t.me/s/${channel}${before ? `?before=${before}` : ""}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const blocks = html.split('<div class="tgme_widget_message_wrap').slice(1);
    for (const b of blocks) {
      const id = b.match(/data-post="[^/]+\/(\d+)"/)?.[1];
      const time = b.match(/<time datetime="([^"]+)"/)?.[1];
      const text = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      if (id && time && text) out.push({ id, time: Date.parse(time) / 1000, text: decode(text) });
    }
    const ids = out.map((m) => Number(m.id));
    if (!ids.length) break;
    before = String(Math.min(...ids));
  }
  return out;
}

const WA_CEX = /binance|coinbase|kraken|okx|okex|bybit|bitfinex|huobi|htx|kucoin|gate|bitstamp|gemini|upbit|bithumb|crypto\.com|robinhood|bitget|mexc/i;

async function whaleAlert(symbols: string[], refSec: number, sources: FeedSource[]): Promise<WhaleEvent[]> {
  try {
    const msgs = await telegram("whale_alert_io", 3);
    const out: WhaleEvent[] = [];
    for (const m of msgs) {
      const x = m.text.match(/([\d,.]+)\s+[$#](\w+)\s+\(([\d,]+)\s+USD\)\s+transferred from (.+?) to (.+?)(?:Details|$)/i);
      if (!x || m.time > refSec) continue;
      const sym = x[2].toUpperCase();
      if (!symbols.includes(sym)) continue;
      const from = x[4].replace("#", "").trim(), to = x[5].replace("#", "").trim();
      const kind = WA_CEX.test(to) && !WA_CEX.test(from) ? "exchange_deposit" : WA_CEX.test(from) && !WA_CEX.test(to) ? "exchange_withdrawal" : null;
      if (!kind) continue;
      out.push({ id: `wa:${m.id}`, wallet: `whale-alert#${m.id}`, symbol: sym, minutes: Math.round((m.time - refSec) / 60), kind, usd: Number(x[3].replace(/,/g, "")), source: `https://t.me/whale_alert_io/${m.id}`, counterparty: kind === "exchange_deposit" ? to : from });
    }
    sources.push({ feed: "whale_alert", target: "t.me/whale_alert_io", ok: true, items: out.length, detail: `${msgs.length} recent posts scanned; ${out.length} exchange flows for ${symbols.join(", ")}` });
    return out;
  } catch (e) {
    sources.push({ feed: "whale_alert", target: "t.me/whale_alert_io", ok: false, items: 0, detail: String((e as Error).message) });
    return [];
  }
}

const RSS = [
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
];

function mentions(text: string, t: FeedToken): boolean {
  if (new RegExp(`[$#]${t.symbol}\\b`).test(text)) return true;
  if (t.symbol.length >= 3 && new RegExp(`\\b${t.symbol}\\b`).test(text)) return true;
  return !!t.name && t.name.length >= 4 && new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

async function news(tokens: FeedToken[], refSec: number, sources: FeedSource[]): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const feed of RSS) {
    try {
      const r = await fetch(feed.url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      const items = xml.split(/<item[\s>]/).slice(1);
      let n = 0;
      for (const it of items) {
        const title = decode(it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "");
        const link = decode(it.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1] ?? "");
        const desc = decode(it.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? "");
        const ts = Date.parse(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "") / 1000;
        if (!title || !Number.isFinite(ts) || ts > refSec || refSec - ts > 72 * 3600) continue;
        const text = `${title} ${desc}`;
        for (const t of tokens)
          if (mentions(text, t)) {
            out.push({ id: `${feed.name}:${link}:${t.symbol}`, symbol: t.symbol, minutes: Math.round((ts - refSec) / 60), headline: title, sourceType: "secondary", source: `${feed.name} — ${link}`, claimKeywords: CLAIMS.filter((c) => text.toLowerCase().includes(c)) });
            n++;
          }
      }
      sources.push({ feed: "rss", target: feed.name, ok: true, items: n, detail: `${items.length} items in feed; ${n} token mentions in the 72h before ref` });
    } catch (e) {
      sources.push({ feed: "rss", target: feed.name, ok: false, items: 0, detail: String((e as Error).message) });
    }
  }
  return out;
}

export const DEFAULT_TG_VOICES = (process.env.FEED_TG_CHANNELS ?? "WatcherGuru,cointelegraph,whale_alert_io").split(",").map((s) => s.trim()).filter(Boolean);

async function telegramVoices(channels: string[], tokens: FeedToken[], refSec: number, sources: FeedSource[]): Promise<{ voices: KolVoice[]; posts: KolPost[] }> {
  const voices: KolVoice[] = [];
  const posts: KolPost[] = [];
  for (const ch of channels.slice(0, 20)) {
    try {
      const msgs = await telegram(ch, 2);
      const handle = `t.me/${ch}`;
      voices.push({ handle, channel: "telegram", followers: null, weight: 0.5 });
      let n = 0;
      for (const m of msgs) {
        if (m.time > refSec || refSec - m.time > 24 * 3600) continue;
        const hit = tokens.filter((t) => mentions(m.text, t));
        if (!hit.length) continue;
        // Make the matched tickers explicit so the radar's cashtag extractor sees them.
        posts.push({ id: `tg:${ch}:${m.id}`, handle, channel: "telegram", minutes: Math.round((m.time - refSec) / 60), text: `${m.text} ${hit.map((t) => `$${t.symbol}`).join(" ")}`, source: `https://t.me/${ch}/${m.id}` });
        n++;
      }
      sources.push({ feed: "telegram", target: handle, ok: true, items: n, detail: `${msgs.length} recent posts; ${n} mention the universe in the 24h before ref` });
    } catch (e) {
      sources.push({ feed: "telegram", target: `t.me/${ch}`, ok: false, items: 0, detail: String((e as Error).message) });
    }
  }
  return { voices, posts };
}

export async function collectFeeds(tokens: FeedToken[], referenceTime: string, channels: string[] = DEFAULT_TG_VOICES): Promise<FeedBundle> {
  const refSec = Math.floor(Date.parse(referenceTime) / 1000);
  const sources: FeedSource[] = [];
  const [onchain, wa, nw, tg] = await Promise.all([
    Promise.all(tokens.map((t) => onchainWhales(t, refSec, sources))).then((x) => x.flat()),
    whaleAlert(tokens.map((t) => t.symbol), refSec, sources),
    news(tokens, refSec, sources),
    telegramVoices(channels, tokens, refSec, sources),
  ]);
  const byKey = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  sources.sort((a, b) => (a.feed + a.target).localeCompare(b.feed + b.target));
  return { referenceTime, voices: tg.voices, posts: tg.posts.sort(byKey), whales: [...onchain, ...wa].sort(byKey), news: nw.sort(byKey), sources };
}
