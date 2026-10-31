// Causal-Verdict CRE workflow (@chainlink/cre-sdk, TypeScript -> WASM).
//
// Triggers
//   • Cron  — re-verifies every watchlist symbol on a schedule (automated risk monitoring).
//   • HTTP  — an AI agent that has paid via x402 at our gateway submits {symbol, evidence};
//             only the gateway's key (config.authorizedGatewayKey) may fire this trigger.
// Each run
//   1. RYO-CHAN MCP is read (deep_analysis + monitor_market_sentiment_shift + market_overview) and reduced
//      to a flat Observation. Two transports (config.ryoTransport):
//        "confidential" (default) — ConfidentialHTTPClient: the RYO_MCP_KEY Vault-DON secret is templated into
//          the Authorization header inside the enclave, so no node operator sees it, and the 90s Confidential HTTP
//          limit covers deep_analysis (~30s; the standard HTTP capability is capped at 10s).
//        "http" — HTTPClient in node mode: every node reads RYO and the DON agrees field-by-field
//          (ConsensusAggregationByFields: median over numbers, identical over strings/flags).
//   3. The compiled fiduciary mandate AST (from config) is evaluated deterministically.
//   4. The verdict is ABI-encoded, signed as a DON report and written to CausalVerdictVault.onReport.
import {
  ConsensusAggregationByFields,
  cre,
  decodeJson,
  getNetwork,
  identical,
  median,
  ok,
  prepareReportRequest,
  encodeCallMsg,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  text,
  type HTTPPayload,
  type HTTPSendRequester,
  type Runtime,
  type CronPayload,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import { decodeAbiParameters, toHex } from "viem";
import { encodeVerdictReport, evaluateMandate, observe, toBase64, type AgentEvidence, type Observation } from "./logic";

const configSchema = z.object({
  schedule: z.string(),
  ryoMcpUrl: z.string(),
  ryoTransport: z.enum(["confidential", "http"]),
  watchlist: z.array(z.string()).min(1),
  equityUsd: z.number().positive(),
  x402: z.object({ priceUsdc6: z.number().int().positive(), payTo: z.string() }),
  authorizedGatewayKey: z.string(),
  mandate: z.object({
    name: z.string(),
    hash: z.string().regex(/^0x[0-9a-f]{64}$/),
    clauses: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  }),
  evm: z.object({ chainSelectorName: z.string(), vaultAddress: z.string(), gasLimit: z.string() }),
  priceFeeds: z.object({ chainSelectorName: z.string(), feeds: z.record(z.string(), z.string()) }),
});
type Config = z.infer<typeof configSchema>;

const NO_EVIDENCE: AgentEvidence = {
  exitLiquidityTrap: false,
  toutingFlag: false,
  supportingPlanes: 1, // cron path: RYO market plane only — min_planes will reject unless the mandate allows 1
  traceRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

function ryoCall(send: HTTPSendRequester, url: string, key: string, tool: string, args: Record<string, unknown>): any {
  const res = send
    .sendRequest({
      url: `${url.replace(/\/$/, "")}/tools/${tool}/call`,
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: toBase64(JSON.stringify(args)),
      // one upstream read per DON round; other nodes reuse it (protects RYO's 60/min limit)
      cacheSettings: { store: true, maxAge: "60s" },
    })
    .result();
  if (!ok(res)) throw new Error(`RYO ${tool} HTTP ${res.statusCode}: ${text(res).slice(0, 200)}`);
  const body = JSON.parse(text(res));
  return body.result ?? body;
}

/** Runs on every node independently. */
const fetchObservation = (send: HTTPSendRequester, config: Config, key: string, symbol: string): Observation => {
  const deep = ryoCall(send, config.ryoMcpUrl, key, "deep_analysis", { symbol, include_perp: true });
  const shift = ryoCall(send, config.ryoMcpUrl, key, "monitor_market_sentiment_shift", { time_window: "7d" });
  const overview = ryoCall(send, config.ryoMcpUrl, key, "market_overview", {});
  return observe(symbol, deep, shift, overview);
};

/** Enclave path: the key is a template placeholder resolved inside the TEE from the Vault DON. */
function fetchObservationConfidential(runtime: Runtime<Config>, symbol: string): Observation {
  const conf = new cre.capabilities.ConfidentialHTTPClient();
  const base = runtime.config.ryoMcpUrl.replace(/\/$/, "");
  const call = (tool: string, args: Record<string, unknown>) => {
    const res = conf
      .sendRequest(runtime, {
        vaultDonSecrets: [{ key: "RYO_MCP_KEY" }],
        request: {
          url: `${base}/tools/${tool}/call`,
          method: "POST",
          bodyString: JSON.stringify(args),
          multiHeaders: { Authorization: { values: ["Bearer {{.RYO_MCP_KEY}}"] }, "Content-Type": { values: ["application/json"] } },
          timeout: "80s",
        },
      })
      .result();
    if (!ok(res)) throw new Error(`RYO ${tool} HTTP ${res.statusCode}: ${text(res).slice(0, 200)}`);
    const body = JSON.parse(text(res));
    return body.result ?? body;
  };
  // Each read degrades independently: a failed lane becomes "unavailable" evidence, never invented values.
  const attempt = (tool: string, args: Record<string, unknown>) => {
    try {
      return call(tool, args);
    } catch (e) {
      runtime.log(`[${symbol}] ${tool} failed: ${String((e as Error).message ?? e).slice(0, 160)}`);
      return null;
    }
  };
  let deep = attempt("deep_analysis", { symbol, include_perp: true });
  if (!deep) {
    const quick = attempt("analyze_token", { symbol });
    if (quick) {
      runtime.log(`[${symbol}] using analyze_token fallback: confluence, derivatives and trade_plan lanes are unavailable`);
      deep = analyzeAsPartialDeep(quick);
    }
  }
  return observe(symbol, deep, attempt("monitor_market_sentiment_shift", { time_window: "7d" }), attempt("market_overview", {}));
}

/** Re-shape an analyze_token envelope into the deep_analysis fields observe() reads; deep-only lanes stay absent. */
function analyzeAsPartialDeep(a: any): any {
  const d = a?.data ?? {};
  return {
    status: a?.status === "unavailable" ? "unavailable" : "partial",
    as_of: a?.as_of,
    data: {
      market: { price_usd: d.market?.price_usd, mcap_usd: d.market?.market_cap_usd, volume_24h_usd: d.market?.volume_24h_usd },
      technical_analysis: d.technical_analysis,
      verdict: { call: "unknown" }, // analyze_token's verdict is a different instrument; not substituted
    },
  };
}

const observationConsensus = ConsensusAggregationByFields<Observation>({
  symbol: identical,
  asOf: identical,
  status: identical,
  regime: identical,
  verdict: identical,
  price: median,
  atrPct: median,
  atrAvailable: identical,
  rsi14: median,
  rsiAvailable: identical,
  confluence: median,
  confluenceAvailable: identical,
  turnover: median,
  turnoverAvailable: identical,
  perpVeto: identical,
  planEntry: median,
  planStop: median,
  planT1: median,
  planT2: median,
  planAvailable: identical,
  fearGreed: median,
});

// Read the Chainlink Data Feed for this symbol through the EVM capability (Ethereum mainnet, last finalized block).
// The price_agreement clause then refuses to act on a RYO price that the feed does not confirm.
function readChainlinkPrice(runtime: Runtime<Config>, symbol: string, obs: Observation) {
  obs.refPrice = -1;
  obs.refPriceAvailable = false;
  const feed = runtime.config.priceFeeds.feeds[symbol];
  if (!feed) {
    runtime.log(`[${symbol}] no Chainlink Data Feed configured — price agreement not applicable`);
    return;
  }
  const net = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.priceFeeds.chainSelectorName, isTestnet: false });
  if (!net) throw new Error(`unknown chain ${runtime.config.priceFeeds.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(net.chainSelector.selector);
  const call = (data: `0x${string}`) =>
    evm.callContract(runtime, { call: encodeCallMsg({ from: "0x0000000000000000000000000000000000000000", to: feed as `0x${string}`, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER }).result().data;
  try {
    const dec = decodeAbiParameters([{ type: "uint8" }], toHex(call("0x313ce567")))[0]; // decimals()
    const [, answer, , updatedAt] = decodeAbiParameters([{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }], toHex(call("0xfeaf968c"))); // latestRoundData()
    obs.refPrice = Number(answer) / 10 ** dec;
    obs.refPriceAvailable = obs.refPrice > 0;
    const at = new Date(Number(updatedAt) * 1000).toISOString();
    runtime.log(obs.price > 0
      ? `[${symbol}] Chainlink ${symbol}/USD ${obs.refPrice} (round updated ${at}) vs RYO ${obs.price}: ${((Math.abs(obs.price - obs.refPrice) / obs.refPrice) * 100).toFixed(2)}% apart`
      : `[${symbol}] Chainlink ${symbol}/USD ${obs.refPrice} (round updated ${at}); RYO price unavailable, so there is nothing to compare`);
  } catch (e) {
    runtime.log(`[${symbol}] Chainlink read failed (${(e as Error).message}) — price agreement not applicable`);
  }
}

function verifyAndAnchor(runtime: Runtime<Config>, symbol: string, evidence: AgentEvidence): string {
  const config = runtime.config;
  let obs: Observation;
  if (config.ryoTransport === "confidential") {
    obs = fetchObservationConfidential(runtime, symbol);
  } else {
    const key = runtime.getSecret({ id: "RYO_MCP_KEY" }).result().value;
    const http = new cre.capabilities.HTTPClient();
    obs = http.sendRequest(runtime, fetchObservation, observationConsensus)(config, key, symbol).result();
  }
  readChainlinkPrice(runtime, symbol, obs);
  runtime.log(`[${symbol}] ${config.ryoTransport} observation: status=${obs.status} regime=${obs.regime} verdict=${obs.verdict} confluence=${obs.confluenceAvailable ? obs.confluence : "unavailable"} rsi=${obs.rsiAvailable ? obs.rsi14 : "unavailable"} atr%=${obs.atrAvailable ? obs.atrPct : "unavailable"}`);

  const verdict = evaluateMandate(obs, evidence, config.mandate.clauses, config.equityUsd);
  runtime.log(`[${symbol}] mandate ${config.mandate.name}: ${verdict.decision ? "SELECT" : "REJECT"} failed=[${verdict.failed.join(", ")}] sizeBps=${verdict.sizeBps}`);

  const { report: payload, runId, evidenceRoot } = encodeVerdictReport(obs, evidence, verdict, config.mandate.hash as `0x${string}`);
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.evm.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`unknown chain ${config.evm.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const report = runtime.report(prepareReportRequest(payload)).result();
  const write = evm.writeReport(runtime, { receiver: config.evm.vaultAddress, report, gasConfig: { gasLimit: config.evm.gasLimit } }).result();
  runtime.log(`[${symbol}] report written runId=${runId} evidenceRoot=${evidenceRoot} txStatus=${write.txStatus}`);
  return JSON.stringify({ symbol, decision: verdict.decision ? "SELECT" : "REJECT", failed: verdict.failed, runId, evidenceRoot });
}

const onCron = (runtime: Runtime<Config>, _p: CronPayload): string =>
  runtime.config.watchlist.map((s) => verifyAndAnchor(runtime, s, NO_EVIDENCE)).join("\n");

/**
 * HTTP trigger body (sent by our x402 gateway after it verified the agent's payment):
 * { symbol, evidence: AgentEvidence, x402: { payer, amountUsdc6, nonce, verified: true } }
 */
const onHttp = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const body = decodeJson(payload.input);
  const paid = body?.x402;
  if (!paid?.verified || Number(paid.amountUsdc6) < runtime.config.x402.priceUsdc6) throw new Error("x402 payment receipt missing or below price");
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) throw new Error("invalid symbol");
  runtime.log(`[x402] paid ${paid.amountUsdc6} USDC(6dp) by ${paid.payer} nonce=${paid.nonce}`);
  return verifyAndAnchor(runtime, symbol, body.evidence as AgentEvidence);
};

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability();
  const http = new cre.capabilities.HTTPCapability();
  return [
    cre.handler(cron.trigger({ schedule: config.schedule }), onCron),
    cre.handler(http.trigger({ authorizedKeys: [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: config.authorizedGatewayKey }] }), onHttp),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
