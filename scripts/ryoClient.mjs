// Server-side RYO-CHAN MCP client. Reads RYO_MCP_KEY from process.env only — never import from browser code.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

export function loadEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const TOOLS = [
  "market_overview",
  "scan_market",
  "analyze_token",
  "deep_analysis",
  "compare_tokens",
  "monitor_market_sentiment_shift",
];

export function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

/** Stable JSON (sorted keys) so content hashes are reproducible across runs. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call one RYO tool over REST with exponential backoff + jitter on 429/503/network errors.
 * Returns { ok, httpStatus, envelope, rateLimit, traceId, error, attempts }.
 * The envelope is returned exactly as RYO sent it — nothing is coerced.
 */
export async function callRyo(tool, args = {}, { retries = 3, timeoutMs = 60000 } = {}) {
  const base = (process.env.RYO_MCP_URL || "").replace(/\/$/, "");
  const key = process.env.RYO_MCP_KEY;
  if (!base || !key) return { ok: false, httpStatus: 0, error: "RYO_MCP_URL / RYO_MCP_KEY not configured on server", attempts: 0 };
  if (!TOOLS.includes(tool)) return { ok: false, httpStatus: 400, error: `unknown tool ${tool}`, attempts: 0 };

  let last;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(`${base}/tools/${tool}/call`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const rateLimit = {
        limit: res.headers.get("x-ratelimit-limit"),
        remaining: res.headers.get("x-ratelimit-remaining"),
        reset: res.headers.get("x-ratelimit-reset"),
        retryAfter: res.headers.get("retry-after"),
      };
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      if (res.ok) {
        const envelope = body.result ?? body;
        return { ok: true, httpStatus: res.status, envelope, rateLimit, traceId: body.trace_id ?? envelope?.trace_id ?? null, attempts: attempt };
      }
      last = { ok: false, httpStatus: res.status, error: body?.error?.message ?? body?.message ?? text.slice(0, 300), code: body?.error?.code ?? body?.code, rateLimit, traceId: body?.trace_id ?? body?.error?.trace_id ?? null, attempts: attempt };
      if (res.status !== 429 && res.status !== 503 && res.status < 500) return last; // do not retry bad args
      const wait = rateLimit.retryAfter ? Number(rateLimit.retryAfter) * 1000 : 2 ** attempt * 500 + Math.random() * 400;
      await sleep(Math.min(wait, 20000));
    } catch (e) {
      last = { ok: false, httpStatus: 0, error: String(e?.message ?? e), attempts: attempt };
      await sleep(2 ** attempt * 500 + Math.random() * 400);
    }
  }
  return last;
}
