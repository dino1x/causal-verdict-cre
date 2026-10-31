// Server-side API shared by the Vite dev server (vite.config.ts) and the production server (serve.ts).
// RYO_MCP_KEY is read from process.env here and never sent to the browser.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toHex, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
// @ts-ignore — plain ESM helper
import { callRyo, loadEnv, TOOLS } from "../scripts/ryoClient.mjs";
import { snapshotLookup, snapshotFetcher, type SnapshotFile } from "../src/engine/snapshotFetcher";
import type { RyoResult, RyoTool } from "../src/engine/ryo";
import { sha256Hex } from "./hash";
import { collectFeeds, DEFAULT_TG_VOICES } from "./feeds";
import { claudeDebate } from "./llmDebate";
import { canonical } from "../src/engine/ryo";
import { runPipeline, type EvidenceProvider, type Fixtures, type FeedSource } from "../src/engine/pipeline";
import { DEFAULT_MANDATE, compile } from "../src/engine/legalAstCompiler";

loadEnv();
const SNAP: SnapshotFile = JSON.parse(readFileSync(join(process.cwd(), "src/data/ryoLiveSnapshots.json"), "utf8"));
const FEED_SNAP: Fixtures & { referenceTime: string; captured_at: string; sources: FeedSource[] } = JSON.parse(readFileSync(join(process.cwd(), "src/data/feedSnapshots.json"), "utf8"));

// Paid verdicts use real evidence only: live feeds on a live run, otherwise the bundled real capture taken for the
// snapshot's reference time. A run at any other reference time gets no external evidence, never scenario fixtures.
function realEvidence(live: boolean): EvidenceProvider {
  return async (tokens, ref) => {
    if (live) {
      const b = await collectFeeds(tokens, ref ?? new Date().toISOString(), DEFAULT_TG_VOICES, 25_000);
      return { mode: "real", fixtures: b, sources: b.sources };
    }
    if (FEED_SNAP.referenceTime === ref) return { mode: "real", fixtures: FEED_SNAP, sources: FEED_SNAP.sources.map((x) => ({ ...x, detail: `${x.detail} [captured ${FEED_SNAP.captured_at}]` })) };
    return { mode: "real", fixtures: { voices: [], posts: [], whales: [], news: [] }, sources: [{ feed: "onchain", target: "all feeds", ok: false, items: 0, detail: `bundled feed capture is for ${FEED_SNAP.referenceTime}, this run is ${ref}; evidence unavailable, not invented` }] };
  };
}
const lastRate: { limit: string | null; remaining: string | null; reset: string | null; at: string | null } = { limit: null, remaining: null, reset: null, at: null };

// ---------------------------------------------------------------- x402 (exact scheme, EIP-3009 authorization)
export const X402 = {
  network: "base-sepolia",
  chainId: 84532,
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex, // USDC on Base Sepolia
  payTo: (process.env.X402_PAY_TO ?? "0x5ce1a1beef000000000000000000000000000402") as Hex,
  priceUsdc6: 10000n, // 0.01 USDC
};
const usedNonces = new Set<string>();

// Demo agent wallet (X402_DEMO_PAYER_KEY): a testnet-only wallet holding a little test USDC, so a visitor can watch a
// real x402 payment settle on Base Sepolia. It signs only this gateway's own payment (payee, asset, price, network)
// and is rate-limited, so it cannot be used to sign anything else or be drained quickly.
const demoKey = process.env.X402_DEMO_PAYER_KEY?.trim();
const demoPayer = demoKey ? privateKeyToAccount((demoKey.startsWith("0x") ? demoKey : `0x${demoKey}`) as Hex) : null;
const demoSigns: number[] = [];
async function demoSign(): Promise<{ ok: true; payment: unknown } | { ok: false; status: number; reason: string }> {
  if (!demoPayer) return { ok: false, status: 404, reason: "no demo agent wallet on this server" };
  const now = Date.now();
  while (demoSigns.length && now - demoSigns[0] > 60_000) demoSigns.shift();
  if (demoSigns.length >= 4) return { ok: false, status: 429, reason: "demo wallet rate limit: 4 payments a minute" };
  demoSigns.push(now);
  const t = Math.floor(now / 1000);
  const authorization = { from: demoPayer.address, to: X402.payTo, value: X402.priceUsdc6.toString(), validAfter: String(t - 5), validBefore: String(t + 120), nonce: toHex(randomBytes(32)) };
  const signature = await demoPayer.signTypedData({
    domain: { name: "USDC", version: "2", chainId: X402.chainId, verifyingContract: X402.asset },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  return { ok: true, payment: { x402Version: 1, scheme: "exact", network: X402.network, payload: { signature, authorization } } };
}

function requirements(resource: string) {
  return {
    x402Version: 1,
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "exact",
        network: X402.network,
        maxAmountRequired: X402.priceUsdc6.toString(),
        resource,
        description: "One Causal-Verdict fiduciary verdict (RYO evidence + mandate gates + CRE report payload)",
        mimeType: "application/json",
        payTo: X402.payTo,
        maxTimeoutSeconds: 120,
        asset: X402.asset,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

async function verifyPayment(header: string): Promise<{ ok: true; payer: Hex; value: bigint; nonce: Hex; payload: any } | { ok: false; reason: string }> {
  let p: any;
  try {
    p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "X-PAYMENT is not base64 JSON" };
  }
  const a = p?.payload?.authorization;
  if (p?.scheme !== "exact" || p?.network !== X402.network || !a) return { ok: false, reason: "unsupported scheme/network" };
  if (a.to?.toLowerCase() !== X402.payTo.toLowerCase()) return { ok: false, reason: "payTo mismatch" };
  if (BigInt(a.value) < X402.priceUsdc6) return { ok: false, reason: "amount below price" };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < BigInt(a.validAfter) || now > BigInt(a.validBefore)) return { ok: false, reason: "authorization outside validity window" };
  if (usedNonces.has(a.nonce)) return { ok: false, reason: "nonce already used (replay)" };
  const valid = await verifyTypedData({
    address: a.from,
    domain: { name: "USDC", version: "2", chainId: X402.chainId, verifyingContract: X402.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: p.payload.signature,
  });
  if (!valid) return { ok: false, reason: "EIP-712 signature does not recover to payer" };
  usedNonces.add(a.nonce);
  return { ok: true, payer: a.from, value: BigInt(a.value), nonce: a.nonce, payload: p };
}

// Optional real settlement (X402_SETTLE=1): after the local EIP-712 check, the public x402 facilitator submits the
// EIP-3009 transferWithAuthorization on Base Sepolia and pays the gas. The verdict is served only if settlement succeeds.
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
async function settlePayment(payload: any, resource: string): Promise<{ ok: true; transaction: Hex } | { ok: false; reason: string }> {
  try {
    const r = await fetch(`${FACILITATOR}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload: payload, paymentRequirements: requirements(resource).accepts[0] }),
      signal: AbortSignal.timeout(60_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j.success && j.transaction) return { ok: true, transaction: j.transaction };
    return { ok: false, reason: `settlement failed: ${j.errorReason ?? j.error ?? r.status}` };
  } catch (e) {
    return { ok: false, reason: `facilitator unreachable: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------- RYO proxy
const CHAOS = new Set(["429", "503", "timeout", "offline"]);
const breaker = { openUntil: 0, reason: "", consecutive: 0 };

// Patient mode (the autonomous loop): RYO also enforces "6/min for mcp_fanout", so a 17-call run burst into 429s
// and the breaker sent the rest to snapshots. Patient callers queue behind a sliding 6-per-minute window and wait out
// a 429's Retry-After instead of falling back. The interactive UI stays fast and keeps the snapshot fallback.
const FANOUT_PER_MIN = 6;
const fanoutStarts: number[] = [];
let fanoutQueue: Promise<void> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fanoutSlot(): Promise<void> {
  const next = fanoutQueue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (fanoutStarts.length && now - fanoutStarts[0] > 61_000) fanoutStarts.shift();
      if (fanoutStarts.length < FANOUT_PER_MIN) break;
      await sleep(61_000 - (now - fanoutStarts[0]) + 50);
    }
    fanoutStarts.push(Date.now());
  });
  fanoutQueue = next;
  return next;
}

export async function proxyCall(tool: RyoTool, args: Record<string, unknown>, chaos: string | null, opts: { patient?: boolean } = {}): Promise<RyoResult> {
  if (opts.patient && !chaos && process.env.RYO_MCP_KEY) {
    let res: RyoResult | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await fanoutSlot();
      breaker.openUntil = 0; // patient callers pace themselves instead of tripping over the breaker
      res = await proxyCall(tool, args, null);
      if (res.provenance === "live") return res;
      const retryAfter = Number((res.rate_limit as any)?.retryAfter);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000 * attempt);
    }
    return res!;
  }
  const t0 = Date.now();
  if (chaos && CHAOS.has(chaos)) return snapshotLookup(SNAP, tool, args, `chaos-injected ${chaos} (RYO was not called)`);
  if (!process.env.RYO_MCP_KEY) return snapshotLookup(SNAP, tool, args, "server has no RYO_MCP_KEY");
  // Circuit breaker: after a network failure or 429, stop hammering RYO until the cool-down ends.
  if (Date.now() < breaker.openUntil) return snapshotLookup(SNAP, tool, args, `circuit open ${Math.ceil((breaker.openUntil - Date.now()) / 1000)}s after: ${breaker.reason}`);
  // deep_analysis builds a token profile upstream (~30s); other tools answer in a few seconds.
  const r: any = await callRyo(tool, args, { retries: 0, timeoutMs: tool === "deep_analysis" ? 60000 : 35000 });
  if (r.rateLimit?.remaining != null) Object.assign(lastRate, { ...r.rateLimit, at: new Date().toISOString() });
  if (r.ok) breaker.consecutive = 0;
  else if (r.httpStatus === 0 || r.httpStatus === 429 || r.httpStatus === 503) breaker.consecutive++;
  // Open on an explicit 429/503, or after two consecutive network/timeout failures (one slow call is not an outage).
  if (!r.ok && (r.httpStatus === 429 || r.httpStatus === 503 || breaker.consecutive >= 2)) {
    const wait = r.httpStatus === 429 && r.rateLimit?.retryAfter ? Number(r.rateLimit.retryAfter) * 1000 : 60000;
    breaker.openUntil = Date.now() + wait;
    breaker.reason = `${r.httpStatus || "network"} ${String(r.error ?? "").slice(0, 80)}`;
  }
  if (r.ok && r.envelope?.schema_version) {
    return {
      tool,
      args,
      provenance: "live",
      envelope: r.envelope,
      envelope_sha256: sha256Hex(canonical(r.envelope)),
      http_status: r.httpStatus,
      rate_limit: r.rateLimit,
      fallback_reason: null,
      captured_at: new Date().toISOString(),
      latency_ms: Date.now() - t0,
    };
  }
  return { ...snapshotLookup(SNAP, tool, args, `live ${r.httpStatus || "network"} ${r.code ?? ""} ${String(r.error ?? "").slice(0, 120)}`.trim()), rate_limit: r.rateLimit ?? null, latency_ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- HTTP plumbing
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

/** For slow work (Claude, feed collection): send headers now and a space every 10 s so proxies never cut an idle
 *  connection, then the JSON. Leading whitespace is valid JSON; errors arrive in the body, since the status is already 200. */
async function sendSlow(res: ServerResponse, work: () => Promise<unknown>, onError: (e: any) => unknown, headers: Record<string, string> = {}) {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Accel-Buffering": "no", ...headers });
  res.write(" ");
  const beat = setInterval(() => res.write(" "), 10_000);
  let body: unknown;
  try {
    body = await work();
  } catch (e) {
    body = onError(e);
  }
  clearInterval(beat);
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Returns true when the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) return false;
  try {
    if (url.pathname === "/api/ryo/status" && req.method === "GET") {
      const configured = !!process.env.RYO_MCP_KEY;
      let whoami: any = null;
      if (configured) {
        try {
          const r = await fetch(`${process.env.RYO_MCP_URL!.replace(/\/$/, "")}/whoami`, { headers: { Authorization: `Bearer ${process.env.RYO_MCP_KEY}` }, signal: AbortSignal.timeout(8000) });
          const j = await r.json();
          whoami = { key_id: j.key_id, label: j.label, rate_limit_per_min: j.rate_limit_per_min, rate_limit_remaining: j.rate_limit_remaining, expires_at: j.expires_at, tools: j.tools, allowed: j.call_allowance?.allowed };
        } catch (e) {
          whoami = { error: String(e) };
        }
      }
      send(res, 200, { configured, endpoint: process.env.RYO_MCP_URL ?? null, whoami, lastRate, breaker: { open: Date.now() < breaker.openUntil, reason: breaker.reason }, snapshot: { captured_at: SNAP.captured_at, count: SNAP.snapshots.length, bundle_sha256: SNAP.bundle_sha256 } });
      return true;
    }
    if (url.pathname === "/api/ryo/call" && req.method === "POST") {
      const { tool, args, chaos } = await readBody(req);
      if (!TOOLS.includes(tool)) return send(res, 400, { error: `unknown tool ${tool}` }), true;
      send(res, 200, await proxyCall(tool, args ?? {}, chaos ?? null));
      return true;
    }
    if (url.pathname === "/api/agent/verdict" && req.method === "POST") {
      const header = req.headers["x-payment"];
      const resource = `http://${req.headers.host ?? "localhost"}/api/agent/verdict`;
      if (!header || Array.isArray(header)) return send(res, 402, requirements(resource)), true;
      const pay = await verifyPayment(header);
      if (!pay.ok) return send(res, 402, { ...requirements(resource), error: pay.reason }), true;
      const settle = process.env.X402_SETTLE === "1" ? await settlePayment(pay.payload, resource) : null;
      if (settle && !settle.ok) {
        usedNonces.delete(pay.nonce); // nothing moved on-chain, so the same authorization may be retried
        return send(res, 402, { ...requirements(resource), error: settle.reason }), true;
      }
      const body = await readBody(req);
      const symbol = String(body.symbol ?? "SOL").toUpperCase();
      const { ast } = compile(body.mandate ?? DEFAULT_MANDATE);
      if (!ast) return send(res, 422, { error: "mandate does not compile" }), true;
      const receipt = settle?.ok
        ? { success: true, settled: true, transaction: settle.transaction, network: X402.network, payer: pay.payer, amountUsdc6: pay.value.toString(), nonce: pay.nonce, explorer: `https://sepolia.basescan.org/tx/${settle.transaction}` }
        : { success: true, settled: false, network: X402.network, payer: pay.payer, amountUsdc6: pay.value.toString(), nonce: pay.nonce, note: "EIP-712 authorization verified; settlement is off (set X402_SETTLE=1 to settle through the facilitator)." };
      const live = !!(body.live && process.env.RYO_MCP_KEY);
      await sendSlow(res, async () => {
        const run = await runPipeline({
          fetcher: live ? (t, a) => proxyCall(t, a, null) : snapshotFetcher(SNAP),
          mandateProse: body.mandate ?? DEFAULT_MANDATE,
          equityUsd: Number(body.equityUsd ?? 100000),
          evidence: realEvidence(live),
        });
        const d = run.dossiers.find((x) => x.symbol === symbol);
        return {
          symbol,
          decision: d?.judgment.decision ?? "REJECT",
          reason: d ? d.judgment.reasoning : [`${symbol} is not in this run's candidate universe (${run.universe.join(", ")})`],
          position: d?.position ?? null,
          traceRoot: run.trace.root,
          mandateHash: run.mandateHash,
          provenance: run.provenanceMix,
          referenceTime: run.referenceTime,
          evidenceMode: run.evidenceMode,
          feeds: run.feedSources.map((f) => ({ feed: f.feed, target: f.target, ok: f.ok, items: f.items })),
          creHttpTriggerPayload: d
              ? { symbol, evidence: { exitLiquidityTrap: d.whale.trap, toutingFlag: d.gates.some((g) => g.kind === "anti_touting" && g.outcome === "fail"), supportingPlanes: d.planes.length, traceRoot: run.trace.root }, x402: { payer: pay.payer, amountUsdc6: pay.value.toString(), nonce: pay.nonce, verified: true } }
              : null,
          };
      }, (e) => ({ error: `verdict failed after payment: ${String(e?.message ?? e).slice(0, 200)}`, receipt }), { "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") });
      return true;
    }
    if (url.pathname === "/api/feeds" && req.method === "POST") {
      const { tokens, referenceTime, channels } = await readBody(req);
      if (!Array.isArray(tokens) || !tokens.length || tokens.length > 12) return send(res, 400, { error: "tokens[] (1-12) required" }), true;
      const ref = typeof referenceTime === "string" && Number.isFinite(Date.parse(referenceTime)) ? referenceTime : new Date().toISOString();
      const ch = Array.isArray(channels) ? channels.filter((c: unknown) => typeof c === "string" && /^[A-Za-z0-9_]{4,32}$/.test(c)).slice(0, 20) : undefined;
      await sendSlow(res, () => collectFeeds(tokens, ref, ch, 25_000), (e) => ({ error: String(e?.message ?? e).slice(0, 300) }));
      return true;
    }
    if (url.pathname === "/api/ai/debate" && req.method === "GET") {
      send(res, 200, { configured: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
      return true;
    }
    if (url.pathname === "/api/ai/debate" && req.method === "POST") {
      if (!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return send(res, 503, { ok: false, error: "Claude analyst not configured: set ANTHROPIC_API_KEY in the server's .env" }), true;
      const body = await readBody(req);
      if (typeof body.symbol !== "string" || !Array.isArray(body.deterministicArgs) || !Array.isArray(body.gates)) return send(res, 400, { ok: false, error: "bad debate payload" }), true;
      await sendSlow(res, () => claudeDebate(body), (e) => ({ ok: false, error: `${e?.status ? `HTTP ${e.status}: ` : ""}${String(e?.message ?? e).slice(0, 300)}` }));
      return true;
    }
    if (url.pathname === "/api/ledger" && req.method === "GET") {
      const path = join(process.cwd(), "data/ledger.json");
      try {
        send(res, 200, { source: "live ledger (data/ledger.json)", ledger: JSON.parse(readFileSync(path, "utf8")) });
      } catch {
        send(res, 404, { error: "no live ledger yet — run scripts/run-agent.ts" });
      }
      return true;
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      send(res, 200, { ok: true, uptime_s: Math.round(process.uptime()), rss_mb: Math.round(process.memoryUsage().rss / 2 ** 20) });
      return true;
    }
    if (url.pathname === "/api/agent/x402-info" && req.method === "GET") {
      send(res, 200, { ...X402, priceUsdc6: X402.priceUsdc6.toString(), settles: process.env.X402_SETTLE === "1", demoPayer: demoPayer?.address ?? null });
      return true;
    }
    if (url.pathname === "/api/agent/demo-sign" && req.method === "POST") {
      const r = await demoSign();
      return r.ok ? send(res, 200, r.payment) : send(res, r.status, { error: r.reason }), true;
    }
    send(res, 404, { error: "not found" });
    return true;
  } catch (e: any) {
    send(res, 500, { error: String(e?.message ?? e) });
    return true;
  }
}
