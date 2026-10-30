// SCENARIO FIXTURES — illustrative, NOT live data and NOT from RYO.
// RYO-CHAN MCP provides market research only; it has no KOL, whale-wallet or news feed.
// These fictional voices / wallets / headlines exercise the causal-forensics engine and are
// labelled "fixture" everywhere in the UI. Users can replace them with their own pasted evidence.
// Minutes are relative to the run's reference time (market_overview.as_of); negative = earlier.

export type Channel = "x" | "discord" | "telegram";

export interface KolVoice {
  handle: string;
  channel: Channel;
  followers: number | null; // null = not observed
  /** User-assigned trust weight 0..1 (the user selects and weights up to 20 voices). */
  weight: number;
}

export interface KolPost {
  id: string;
  handle: string;
  channel: Channel;
  minutes: number;
  text: string;
  /** URL of the original post (real feeds only). */
  source?: string;
}

export interface WhaleEvent {
  id: string;
  wallet: string;
  symbol: string;
  minutes: number;
  kind: "dex_buy" | "dex_sell" | "exchange_deposit" | "exchange_withdrawal";
  usd: number;
  /** Explorer / post URL (real feeds only). */
  source?: string;
  counterparty?: string;
}

export interface NewsItem {
  id: string;
  symbol: string;
  minutes: number;
  headline: string;
  sourceType: "primary" | "secondary" | "rumor";
  source: string;
  claimKeywords: string[];
}

export const KOL_VOICES: KolVoice[] = [
  { handle: "@fx_orbitdesk", channel: "x", followers: 412000, weight: 0.6 },
  { handle: "@fx_lumenwhale", channel: "x", followers: 233000, weight: 0.5 },
  { handle: "@fx_candlemonk", channel: "x", followers: 98000, weight: 0.8 },
  { handle: "@fx_gammagrid", channel: "x", followers: 61000, weight: 0.7 },
  { handle: "@fx_ledgerlark", channel: "x", followers: 145000, weight: 0.6 },
  { handle: "@fx_basisbear", channel: "x", followers: 52000, weight: 0.9 },
  { handle: "@fx_moonmaxi", channel: "x", followers: 880000, weight: 0.3 },
  { handle: "@fx_tickertide", channel: "x", followers: 120000, weight: 0.5 },
  { handle: "@fx_quietquant", channel: "x", followers: 34000, weight: 0.9 },
  { handle: "@fx_altalchemy", channel: "x", followers: 270000, weight: 0.4 },
  { handle: "@fx_onchainoak", channel: "x", followers: 77000, weight: 0.8 },
  { handle: "@fx_pumpprophet", channel: "x", followers: 510000, weight: 0.2 },
  { handle: "#fx-alpha-hall", channel: "discord", followers: 18000, weight: 0.5 },
  { handle: "#fx-degen-den", channel: "discord", followers: 26000, weight: 0.3 },
  { handle: "#fx-macro-room", channel: "discord", followers: 9000, weight: 0.8 },
  { handle: "#fx-gem-vault", channel: "discord", followers: 31000, weight: 0.3 },
  { handle: "t.me/fx_signalsdaily", channel: "telegram", followers: 64000, weight: 0.3 },
  { handle: "t.me/fx_whalewire", channel: "telegram", followers: 41000, weight: 0.5 },
  { handle: "t.me/fx_rotationroom", channel: "telegram", followers: 22000, weight: 0.6 },
  { handle: "t.me/fx_100xcalls", channel: "telegram", followers: 93000, weight: 0.2 },
];

const P = (id: string, handle: string, minutes: number, text: string): KolPost => ({
  id,
  handle,
  channel: KOL_VOICES.find((v) => v.handle === handle)!.channel,
  minutes,
  text,
});

export const KOL_POSTS: KolPost[] = [
  // BEAM — tight burst of promotion, part copypasta, rumor catalyst, no disclosure
  P("k1", "@fx_moonmaxi", -38, "🚨 $BEAM is about to send. Massive gaming studio partnership dropping this week. Loading now, last chance before the announcement 🚀"),
  P("k2", "@fx_pumpprophet", -35, "$BEAM breakout confirmed. Gaming studio partnership leaking. Don't miss this one, 10x setup, buy now"),
  P("k3", "t.me/fx_100xcalls", -34, "🚨 $BEAM is about to send. Massive gaming studio partnership dropping this week. Loading now, last chance 🚀"),
  P("k4", "#fx-gem-vault", -31, "$BEAM is about to send. Massive gaming studio partnership dropping this week. Loading now!!"),
  P("k5", "@fx_altalchemy", -29, "Gaming narrative rotating into $BEAM hard. Partnership rumors everywhere. I'm long, max conviction."),
  P("k6", "t.me/fx_signalsdaily", -27, "SIGNAL: BUY $BEAM now. Target +80%. Partnership incoming. Hurry"),
  P("k7", "@fx_tickertide", -25, "$BEAM volume exploding, gaming studio partnership supposedly next. Aping a bag here, send it"),
  P("k8", "#fx-degen-den", -22, "everyone in $BEAM?? partnership news before weekend, buy before it's too late"),
  // SOL — few, slower, independent voices; reference a verifiable integration; one disclosure
  P("k9", "@fx_quietquant", -170, "$SOL RSI(14) under 30 on the daily after -20% month. Long liquidations flushed. Scaling in slowly, small size. I hold SOL."),
  P("k10", "@fx_onchainoak", -120, "Solana x Polygon integration announced (Open Money Stack). Fundamentals fine, price oversold. Watching $SOL for a mean-reversion bounce."),
  P("k11", "#fx-macro-room", -75, "Fear at 35 and funding still long-crowded — $SOL dip could go lower first. Accumulate in tranches, keep stops tight."),
  // PEPE — echo chamber of identical posts + a bearish voice
  P("k12", "@fx_lumenwhale", -60, "$PEPE frogs never die. Meme season loading. Send it 🐸"),
  P("k13", "t.me/fx_100xcalls", -58, "$PEPE frogs never die. Meme season loading. Send it 🐸🐸"),
  P("k14", "#fx-degen-den", -57, "$PEPE frogs never die. Meme season loading. Send it"),
  P("k15", "@fx_moonmaxi", -55, "$PEPE frogs never die, meme season loading, send it"),
  P("k16", "@fx_basisbear", -50, "$PEPE: whale just moved a big bag to an exchange. Memes bleed hardest in risk-off. Avoid / would short."),
  // Q — unlock worries
  P("k17", "@fx_candlemonk", -240, "$Q down 56% on the week, ATR enormous. Token unlock overhang. Avoid until volatility settles."),
  P("k18", "t.me/fx_rotationroom", -200, "Quack AI ($Q) bounced 24% but it's a dead-cat into the unlock. Not touching it."),
  // GROW / MAGMA — sparse
  P("k19", "@fx_gammagrid", -300, "$GROW printing +26% on almost zero volume. Can't exit that size. Pass."),
  P("k20", "@fx_ledgerlark", -280, "$MAGMA up 30% but turnover 3%. Illiquid pump, careful."),
];

export const WHALE_EVENTS: WhaleEvent[] = [
  // BEAM: accumulate before the KOL burst, deposit to exchanges after it (exit-liquidity pattern)
  { id: "w1", wallet: "fixture-wallet-A", symbol: "BEAM", minutes: -95, kind: "dex_buy", usd: 1_850_000 },
  { id: "w2", wallet: "fixture-wallet-B", symbol: "BEAM", minutes: -88, kind: "dex_buy", usd: 1_240_000 },
  { id: "w3", wallet: "fixture-wallet-C", symbol: "BEAM", minutes: -80, kind: "exchange_withdrawal", usd: 960_000 },
  { id: "w4", wallet: "fixture-wallet-A", symbol: "BEAM", minutes: -12, kind: "exchange_deposit", usd: 1_900_000 },
  { id: "w5", wallet: "fixture-wallet-B", symbol: "BEAM", minutes: -6, kind: "exchange_deposit", usd: 1_310_000 },
  // SOL: whales absorbing the dip off exchanges, no deposits
  { id: "w6", wallet: "fixture-wallet-D", symbol: "SOL", minutes: -150, kind: "exchange_withdrawal", usd: 6_400_000 },
  { id: "w7", wallet: "fixture-wallet-E", symbol: "SOL", minutes: -90, kind: "exchange_withdrawal", usd: 3_100_000 },
  { id: "w8", wallet: "fixture-wallet-F", symbol: "SOL", minutes: -40, kind: "dex_buy", usd: 1_200_000 },
  // PEPE: distribution
  { id: "w9", wallet: "fixture-wallet-G", symbol: "PEPE", minutes: -52, kind: "exchange_deposit", usd: 4_800_000 },
  { id: "w10", wallet: "fixture-wallet-H", symbol: "PEPE", minutes: -30, kind: "dex_sell", usd: 900_000 },
  // Q
  { id: "w11", wallet: "fixture-wallet-I", symbol: "Q", minutes: -210, kind: "exchange_deposit", usd: 750_000 },
];

export const NEWS_ITEMS: NewsItem[] = [
  { id: "n1", symbol: "BEAM", minutes: -45, headline: "Unsourced post claims BEAM partnership with a 'major gaming studio'", sourceType: "rumor", source: "fixture: anonymous aggregator", claimKeywords: ["partnership", "gaming studio"] },
  { id: "n2", symbol: "SOL", minutes: -600, headline: "Polygon extends Open Money Stack support to Solana", sourceType: "secondary", source: "fixture: crypto news wire", claimKeywords: ["polygon", "integration", "open money stack"] },
  { id: "n3", symbol: "Q", minutes: -400, headline: "Forum thread speculates on upcoming Q token unlock", sourceType: "rumor", source: "fixture: community forum", claimKeywords: ["unlock"] },
];
