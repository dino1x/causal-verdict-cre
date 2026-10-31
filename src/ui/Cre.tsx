import { useEffect, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex, type Hex } from "viem";
import { compile, decompileClause, type Clause } from "../engine/legalAstCompiler";
import { DEFAULT_GEN, generateCreConfig, generateGateSource, mandateHash } from "../engine/creCodegen";
import type { RunResult } from "../engine/pipeline";
import { Badge, download, short } from "./common";
import mainTs from "../../cre-workflow/causal-verdict/main.ts?raw";
import contractSol from "../../contracts/CausalVerdictVault.sol?raw";

const simLogs = import.meta.glob("../../cre-workflow/simulation-*.log", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Deterministic drafter: plain-English risk intent -> controlled mandate clauses. The compiler validates the result. */
function draftFromIntent(intent: string): string {
  const t = intent.toLowerCase();
  const pct = (re: RegExp, d: number) => {
    const m = t.match(re);
    return m ? Number(m[1] ?? m[2]) : d;
  };
  const clauses: Clause[] = [
    { kind: "risk_per_trade", maxPct: pct(/risk\D{0,12}(\d+(?:\.\d+)?)\s*%/, 1) },
    { kind: "max_position", maxPct: pct(/(?:max|cap|no more than)\D{0,20}(\d+(?:\.\d+)?)\s*%\D{0,20}(?:asset|position|token)/, 10) },
    { kind: "require_status", allowed: /strict|only ok|complete data/.test(t) ? ["ok"] : ["ok", "partial"] },
    { kind: "min_confluence", min: pct(/confluence\D{0,10}(0?\.\d+)/, 0.6) },
    { kind: "min_turnover", min: /illiquid|liquid/.test(t) ? pct(/turnover\D{0,10}(0?\.\d+)/, 0.05) : 0.02 },
    { kind: "max_atr", maxPct: pct(/(?:atr|volatility)\D{0,15}(\d+(?:\.\d+)?)\s*%/, 25) },
    { kind: "require_measurement", field: "rsi_14" },
    { kind: "require_measurement", field: "atr_14_pct" },
    { kind: "reject_verdict", verdicts: ["avoid"] },
    { kind: "perp_veto" },
    { kind: "price_agreement", maxPct: pct(/(?:agree|deviat\w*|price check)\D{0,20}(\d+(?:\.\d+)?)\s*%/, 2) },
    { kind: "stop_rule", atrMult: pct(/(\d+(?:\.\d+)?)\s*(?:x\s*)?atr\s*stop|stop\D{0,10}(\d+(?:\.\d+)?)\s*x?\s*atr/, 1.5), maxPct: pct(/never more than (\d+(?:\.\d+)?)\s*%/, 8) },
  ];
  if (!/allow (?:pumps|hype)/.test(t)) {
    clauses.push({ kind: "anti_exit_liquidity", windowMin: 90 });
    clauses.push({ kind: "anti_touting", minKols: pct(/(\d+)\s*(?:or more )?(?:kols|influencers)/, 5), windowMin: 30 });
  }
  if (/risk[- ]off|bear market|defensive|halve/.test(t)) clauses.push({ kind: "regime_scaling", regime: "risk_off", factor: /halve|half/.test(t) ? 0.5 : 0.75 });
  clauses.push({ kind: "min_planes", n: /corroborat|independent|multiple sources/.test(t) ? 3 : 2 });
  return [`MANDATE "Drafted Mandate"`, ...clauses.map((c, i) => `${i + 1}. ${decompileClause(c)}`)].join("\n");
}

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function X402Demo({ mandate }: { mandate: string }) {
  const [steps, setSteps] = useState<{ title: string; body: unknown; tone: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState("SOL");
  const [info, setInfo] = useState<{ settles: boolean; demoPayer: string | null } | null>(null);
  const [settledTx, setSettledTx] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/agent/x402-info").then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => setInfo(null));
  }, []);
  const go = async () => {
    setBusy(true);
    setSettledTx(null);
    const s: typeof steps = [];
    const push = (title: string, body: unknown, tone = "muted") => {
      s.push({ title, body, tone });
      setSteps([...s]);
    };
    try {
      const body = JSON.stringify({ symbol, mandate });
      const r1 = await fetch("/api/agent/verdict", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const req = await r1.json();
      push(`1 · POST /api/agent/verdict → HTTP ${r1.status} Payment Required`, req, r1.status === 402 ? "warn" : "err");
      if (r1.status !== 402) return;
      const a = req.accepts[0];
      let payment: unknown;
      if (info?.demoPayer) {
        // The server's demo agent wallet holds test USDC, so this payment settles on Base Sepolia.
        const d = await fetch("/api/agent/demo-sign", { method: "POST" });
        const dj = await d.json();
        if (!d.ok) throw new Error(dj.error ?? `demo wallet HTTP ${d.status}`);
        payment = dj;
        push(`2 · Demo agent ${short(info.demoPayer, 8)} signs EIP-3009 TransferWithAuthorization (${Number(a.maxAmountRequired) / 1e6} USDC)`, payment);
      } else {
      // No funded wallet on this server: an ephemeral wallet proves the signing flow; nothing settles.
      const account = privateKeyToAccount(generatePrivateKey());
      const now = Math.floor(Date.now() / 1000);
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
      const authorization = { from: account.address, to: a.payTo as Hex, value: a.maxAmountRequired, validAfter: String(now - 5), validBefore: String(now + a.maxTimeoutSeconds), nonce };
      const signature = await account.signTypedData({
        domain: { name: a.extra.name, version: a.extra.version, chainId: 84532, verifyingContract: a.asset },
        types: TYPES,
        primaryType: "TransferWithAuthorization",
        message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
      });
      payment = { x402Version: 1, scheme: "exact", network: a.network, payload: { signature, authorization } };
      push(`2 · Agent ${short(account.address, 8)} signs EIP-3009 TransferWithAuthorization (${Number(a.maxAmountRequired) / 1e6} USDC)`, payment);
      }
      const r2 = await fetch("/api/agent/verdict", { method: "POST", headers: { "Content-Type": "application/json", "X-PAYMENT": btoa(JSON.stringify(payment)) }, body });
      const out = await r2.json();
      const receipt = r2.headers.get("X-PAYMENT-RESPONSE");
      push(`3 · Retry with X-PAYMENT → HTTP ${r2.status}`, { verdict: out.decision, symbol: out.symbol, reason: out.reason, position: out.position, traceRoot: out.traceRoot, mandateHash: out.mandateHash }, r2.ok ? "ok" : "err");
      if (receipt) {
        const rc = JSON.parse(atob(receipt));
        if (rc.transaction) setSettledTx(rc.transaction);
        push(`4 · X-PAYMENT-RESPONSE${rc.settled ? " — settled on-chain" : ""}`, rc, "ok");
      }
      if (out.creHttpTriggerPayload) push("5 · Payload the gateway forwards to the CRE HTTP trigger", out.creHttpTriggerPayload, "ok");
      const r3 = await fetch("/api/agent/verdict", { method: "POST", headers: { "Content-Type": "application/json", "X-PAYMENT": btoa(JSON.stringify(payment)) }, body });
      push(`6 · Replaying the same payment → HTTP ${r3.status}`, await r3.json(), r3.status === 402 ? "ok" : "err");
    } catch (e) {
      push("Gateway unreachable", String(e) + " — run `npm run dev` or `npm start` (static hosting has no server).", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>x402 agent micropayment — live handshake against this server</h2>
      <div className="row">
        <label className="inline">symbol <input className="num" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
        <button className="btn primary" onClick={go} disabled={busy}>{busy ? "Negotiating…" : "Run as paying AI agent"}</button>
        <span className="small muted">{info?.demoPayer && info.settles ? "Base Sepolia USDC · settles on-chain · replays refused" : "Base Sepolia USDC · signature verified · replays refused · no funded wallet on this server"}</span>
      </div>
      {settledTx && (
        <p className="small" style={{ marginTop: 10 }}>
          <Badge k="pass">settled</Badge> <a href={`https://sepolia.basescan.org/tx/${settledTx}`} target="_blank" rel="noreferrer">This payment on BaseScan ↗</a>
        </p>
      )}
      {steps.map((st, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div className={st.tone}>{st.title}</div>
          <pre className="code" style={{ maxHeight: 220 }}>{typeof st.body === "string" ? st.body : JSON.stringify(st.body, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

export function CreView({ mandate, run }: { mandate: string; run: RunResult }) {
  const [intent, setIntent] = useState("Defensive desk: risk 0.75% per trade, max 8% per asset, stop at 2x ATR but never more than 10%, avoid illiquid tokens, halve size in risk-off, block coordinated pumps by 4 or more KOLs, require corroboration from independent sources.");
  const [drafted, setDrafted] = useState<string | null>(null);
  const [watch, setWatch] = useState("SOL, BEAM");
  const [schedule, setSchedule] = useState(DEFAULT_GEN.schedule);
  const source = drafted ?? mandate;
  const { ast, errors } = useMemo(() => compile(source), [source]);
  const cfg = useMemo(() => (ast ? generateCreConfig(ast, { ...DEFAULT_GEN, schedule, watchlist: watch.split(/[ ,]+/).filter(Boolean).map((s) => s.toUpperCase()) }) : null), [ast, schedule, watch]);
  const gate = ast ? generateGateSource(ast) : "";
  const [view, setView] = useState<"config" | "gates" | "main" | "sol" | "sim">("config");
  const logs = Object.entries(simLogs);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="notice">
        <b>Chainlink CRE workflow.</b> Cron and x402-paid HTTP triggers. It reads RYO through Confidential HTTP and Chainlink SOL/USD on-chain, applies the mandate, and writes the verdict to the vault.
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>AI-assisted workflow generation: intent → mandate → CRE</h2>
          <textarea className="code" style={{ minHeight: 120 }} value={intent} onChange={(e) => setIntent(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => setDrafted(draftFromIntent(intent))}>Draft mandate from intent</button>
            <button className="btn" onClick={() => setDrafted(null)}>Use the active mandate</button>
            <span className="small muted">The compiler accepts or rejects the draft.</span>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="inline">watchlist <input className="num" style={{ width: 160 }} value={watch} onChange={(e) => setWatch(e.target.value)} /></label>
            <label className="inline">cron <input className="num" style={{ width: 150 }} value={schedule} onChange={(e) => setSchedule(e.target.value)} /></label>
          </div>
          <h3>Mandate the workflow will enforce {errors.length ? <Badge k="fail">{errors.length} error(s)</Badge> : <Badge k="pass">compiles · {short(ast ? mandateHash(ast) : null, 12)}</Badge>}</h3>
          <pre className="code" style={{ maxHeight: 260 }}>{source}</pre>
          {errors.map((e, i) => <div key={i} className="small err">line {e.line}: {e.message}</div>)}
        </div>
        <div className="card">
          <div className="spread">
            <div className="seg">
              {(["config", "gates", "main", "sol", "sim"] as const).map((v) => (
                <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                  {{ config: "config.staging.json", gates: "gates.ts (generated)", main: "main.ts", sol: "CausalVerdictVault.sol", sim: "simulation log" }[v]}
                </button>
              ))}
            </div>
            {cfg && view === "config" && <button className="btn" onClick={() => download("config.staging.json", JSON.stringify(cfg, null, 2))}>Download</button>}
          </div>
          <pre className="code" style={{ marginTop: 10, maxHeight: 560 }}>
            {view === "config" ? (cfg ? JSON.stringify(cfg, null, 2) : "fix mandate errors") : view === "gates" ? gate : view === "main" ? mainTs : view === "sol" ? contractSol : logs.length ? logs.map(([k, v]) => `# ${k.split("/").pop()}\n${v}`).join("\n\n") : "Run `npm run cre:simulate` to produce a simulation log."}
          </pre>
        </div>
      </div>
      <X402Demo mandate={mandate} />
      <div className="card">
        <h2>Run it yourself</h2>
        <pre className="code">{`# local DON round: 4 nodes, field-wise consensus, report ABI, vault.onReport in a real EVM
npm run cre:simulate              # live RYO if RYO_MCP_KEY is set, else real snapshots
# official CRE CLI simulation (needs bun, the CRE CLI and "cre login")
npm run cre:compile
cd cre-workflow && cre workflow simulate ./causal-verdict --target staging-settings --env ../.env \
  --trigger-index 1 --http-payload http-payload.example.json   # 0 = cron`}</pre>
        <p className="small muted">Session trace root <span className="hash">{run.trace.root}</span></p>
      </div>
    </div>
  );
}
