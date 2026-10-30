import { useCallback, useEffect, useMemo, useState } from "react";
import { runPipeline, scenarioEvidence, type RunResult } from "./engine/pipeline";
import { realFeedProvider, FEED_SNAPSHOT, type EvidenceMode } from "./client/evidence";
import { compile, DEFAULT_MANDATE } from "./engine/legalAstCompiler";
import { fmt, fmtUsd, type RyoResult, type RyoTool } from "./engine/ryo";
import { getStatus, makeFetcher, SNAPSHOTS, type Chaos, type Mode, type ProxyStatus } from "./client/ryoBrowser";
import * as F from "./data/scenarioFixtures";
import { Badge, Fixture, Prov, short, useInspector } from "./ui/common";
import { CausalityView } from "./ui/Causality";
import { DebateView } from "./ui/Debate";
import { MandateView } from "./ui/Mandate";
import { CreView } from "./ui/Cre";
import { AuditView } from "./ui/Audit";

const TABS = ["Verdict", "Causality", "Debate", "Mandate", "CRE + x402", "Audit"] as const;
type Tab = (typeof TABS)[number];
const TOOL_ORDER: RyoTool[] = ["market_overview", "monitor_market_sentiment_shift", "scan_market", "compare_tokens", "analyze_token", "deep_analysis"];

export default function App() {
  const [tab, setTab] = useState<Tab>("Verdict");
  const [mode, setMode] = useState<Mode>("replay");
  const [chaos, setChaos] = useState<Chaos>("none");
  const [equity, setEquity] = useState(100000);
  const [mandate, setMandate] = useState(DEFAULT_MANDATE);
  const [posts, setPosts] = useState<F.KolPost[]>(F.KOL_POSTS);
  const [evMode, setEvMode] = useState<EvidenceMode>("real");
  const [channels, setChannels] = useState<string[]>(FEED_SNAPSHOT.channels);
  const [run, setRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [focus, setFocus] = useState<string>("SOL");
  const insp = useInspector();
  const fixtures = useMemo(() => ({ voices: F.KOL_VOICES, posts, whales: F.WHALE_EVENTS, news: F.NEWS_ITEMS }), [posts]);
  const compiled = useMemo(() => compile(mandate), [mandate]);

  const go = useCallback(
    async (m: Mode = mode) => {
      if (!compiled.ast) {
        setError("Mandate does not compile — see the Mandate tab.");
        return;
      }
      setRunning(true);
      setError(null);
      setLog([]);
      try {
        const userPosts = posts === F.KOL_POSTS ? [] : posts;
        const evidence = evMode === "scenario" ? scenarioEvidence(fixtures) : realFeedProvider(m === "live", userPosts, channels);
        const r = await runPipeline({ fetcher: makeFetcher(m, chaos), mandateProse: mandate, equityUsd: equity, evidence, onProgress: (msg) => setLog((l) => [...l, msg]) });
        setRun(r);
        if (r.practiceTrade) setFocus(r.practiceTrade.dossier.symbol);
        if (m === "live") getStatus().then(setStatus);
      } catch (e) {
        setError(String((e as Error).message));
      } finally {
        setRunning(false);
      }
    },
    [mode, chaos, mandate, equity, fixtures, compiled.ast, evMode, posts, channels],
  );

  useEffect(() => {
    getStatus().then(setStatus);
    go("replay");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveAvailable = !!status?.configured;
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Causal-Verdict CRE</h1>
          <span className="sub">Autonomous practice-trade agent · RYO-CHAN MCP evidence · fiduciary mandate compiler · Chainlink CRE anchoring</span>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Data mode">
            <button className={mode === "replay" ? "on" : ""} onClick={() => setMode("replay")}>Replay RYO snapshots</button>
            <button className={mode === "live" ? "on" : ""} onClick={() => { setMode("live"); getStatus().then(setStatus); }} title={liveAvailable ? "Calls RYO through the server proxy" : "Server has no RYO_MCP_KEY — live calls will fall back to snapshots"}>
              Live RYO MCP
            </button>
          </div>
          <div className="seg" role="group" aria-label="Evidence source" title="KOL / whale / news evidence">
            <button className={evMode === "real" ? "on" : ""} onClick={() => setEvMode("real")}>Real feeds</button>
            <button className={evMode === "scenario" ? "on" : ""} onClick={() => setEvMode("scenario")}>Scenario fixtures</button>
          </div>
          <label className="inline">
            Chaos
            <select value={chaos} onChange={(e) => setChaos(e.target.value as Chaos)} disabled={mode === "replay"} title="Inject a failure before the proxy calls RYO">
              <option value="none">none</option>
              <option value="429">429 rate-limited</option>
              <option value="503">503 unavailable</option>
              <option value="timeout">timeout</option>
              <option value="offline">offline</option>
            </select>
          </label>
          <label className="inline">
            Practice equity $
            <input className="num" type="number" value={equity} min={1000} step={1000} onChange={(e) => setEquity(Math.max(1000, Number(e.target.value)))} />
          </label>
          <button className="btn primary" disabled={running} onClick={() => go()}>
            {running ? "Running agent…" : mode === "live" ? "Run agent (live RYO)" : "Run agent (replay)"}
          </button>
          <span className="small muted">
            {status === null ? (
              <Badge k="snapshot">static mode · bundled RYO snapshots</Badge>
            ) : status.configured && status.whoami?.error ? (
              <Badge k="partial" title={status.whoami.error}>proxy ✓ · RYO unreachable now → snapshot fallback</Badge>
            ) : status.configured ? (
              <>
                <Badge k="live">proxy ✓ key {status.whoami?.key_id ?? "?"}</Badge> {status.whoami?.rate_limit_remaining ?? "?"}/{status.whoami?.rate_limit_per_min ?? "?"} calls/min left
              </>
            ) : (
              <Badge k="partial">proxy up · no RYO key → snapshot fallback</Badge>
            )}
          </span>
          {!compiled.ast && <Badge k="fail">mandate has {compiled.errors.length} error(s)</Badge>}
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      {error && <div className="notice err" style={{ marginBottom: 12 }}>{error}</div>}
      {!run ? (
        <div className="card">Running the agent on captured RYO evidence…</div>
      ) : (
        <>
          {tab === "Verdict" && <VerdictView run={run} log={log} onInspect={insp.open} onFocus={(s) => { setFocus(s); setTab("Debate"); }} />}
          {tab === "Causality" && <CausalityView run={run} focus={focus} setFocus={setFocus} posts={posts} setPosts={setPosts} channels={channels} setChannels={setChannels} />}
          {tab === "Debate" && <DebateView run={run} focus={focus} setFocus={setFocus} onInspect={insp.open} />}
          {tab === "Mandate" && <MandateView prose={mandate} setProse={setMandate} run={run} />}
          {tab === "CRE + x402" && <CreView mandate={mandate} run={run} />}
          {tab === "Audit" && <AuditView run={run} mandate={mandate} equity={equity} onInspect={insp.open} />}
        </>
      )}
      {insp.node}
      <footer>
        Practice trades only — research output, not financial advice, and nothing here places, approves or executes a trade. RYO-CHAN MCP is read-only. In "Real feeds" mode, whale, news and KOL evidence comes from public on-chain logs, RSS and Telegram, with a link to each item. Items marked <Fixture /> come from the illustrative scenario and are not live data. Snapshot bundle {short(SNAPSHOTS.bundle_sha256, 12)} captured {SNAPSHOTS.captured_at}.
      </footer>
    </div>
  );
}

function VerdictView({ run, log, onInspect, onFocus }: { run: RunResult; log: string[]; onInspect: (r: RyoResult) => void; onFocus: (s: string) => void }) {
  const m = run.market;
  const t = run.practiceTrade;
  const byTool = (tool: RyoTool) => run.calls.filter((c) => c.tool === tool);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid g4">
        <div className="card">
          <div className="stat-l">Market regime · market_overview</div>
          <div className="stat">{m.regime ?? "unavailable"}</div>
          <div className="small muted">breadth {fmt(m.breadth, 3)} · advancing share of non-stable top listings</div>
        </div>
        <div className="card">
          <div className="stat-l">Fear &amp; Greed · 7d shift</div>
          <div className="stat">
            {m.fearGreed ?? "—"} <span className={m.fearGreedChange7d !== null && m.fearGreedChange7d < 0 ? "err" : "ok"} style={{ fontSize: 15 }}>{m.fearGreedChange7d !== null ? `${m.fearGreedChange7d > 0 ? "+" : ""}${m.fearGreedChange7d}` : ""}</span>
          </div>
          <div className="small muted">altseason {m.altseasonPhase ?? "unavailable"}</div>
        </div>
        <div className="card">
          <div className="stat-l">BTC derivatives · sentiment_shift</div>
          <div className="stat" style={{ fontSize: 17 }}>{m.fundingCrowding ?? "unavailable"}</div>
          <div className="small muted">liquidations {m.liquidationPressure ?? "?"} · {fmt(m.liquidationLongShare, 1, "% longs")}</div>
        </div>
        <div className="card">
          <div className="stat-l">Provenance of this run</div>
          <div className="row" style={{ marginTop: 6 }}>
            {Object.entries(run.provenanceMix).map(([k, v]) => (
              <Badge key={k} k={k}>{v} {k}</Badge>
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>{run.evidenceMode === "real" ? <Badge k="live">evidence: real feeds</Badge> : <Fixture />}<span className="small muted">{run.evidenceUsed.whales.length} whale · {run.evidenceUsed.news.length} news · {run.evidenceUsed.posts.length} posts</span></div>
          <div className="small muted" style={{ marginTop: 6 }}>trace root <span className="hash">{short(run.trace.root, 14)}</span></div>
        </div>
      </div>

      <div className="grid g2">
        <div className={`card ${t ? "trade" : "noTrade"}`}>
          <h2>
            Practice trade — one atomic decision {t ? <Badge k="select">SELECT {t.dossier.symbol}</Badge> : <Badge k="reject">NO TRADE</Badge>}
          </h2>
          {t ? (
            <>
              <div className="grid g4" style={{ gap: 10 }}>
                <div><div className="stat-l">Entry</div><div className="stat">{fmtUsd(t.position.entry)}</div></div>
                <div><div className="stat-l">Stop</div><div className="stat err">{fmtUsd(t.position.stop)}</div></div>
                <div><div className="stat-l">Targets</div><div className="stat ok" style={{ fontSize: 17 }}>{t.position.targets.map((x) => fmtUsd(x.price)).join(" / ")}</div></div>
                <div><div className="stat-l">Size</div><div className="stat">{t.position.portfolioPct}%</div></div>
              </div>
              <div className="kv small" style={{ marginTop: 12 }}>
                <div>Units / notional</div><div>{t.position.units} {t.dossier.symbol} · {fmtUsd(t.position.notionalUsd)}</div>
                <div>Risk at stop</div><div>{fmtUsd(t.position.riskUsd)} ({((t.position.riskUsd / t.position.equityUsd) * 100).toFixed(2)}% of equity)</div>
                <div>Stop basis</div><div>{t.position.stopBasis}</div>
                <div>Sizing</div><div>{t.position.sizeBasis.join(" · ")}</div>
                <div>Dip tranches</div><div>{t.position.tranches.map((x) => `${x.pct}% @ ${fmtUsd(x.price)}`).join("  ·  ")}</div>
                <div>Exits</div><div>{t.position.targets.map((x) => `${x.closePct}% at ${x.r}R`).join(" · ")} · time stop {t.position.timeStopHours}h</div>
                <div>Invalidation</div><div>{t.position.invalidation}</div>
                <div>Why</div><div>{t.dossier.judgment.reasoning[0]}</div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => onFocus(t.dossier.symbol)}>Open Bull/Bear/Judge →</button>
                <span className="small muted">Entry/stop/targets start from RYO deep_analysis.trade_plan (ATR-14, preview only), then the mandate's stop/size clauses apply.</span>
              </div>
            </>
          ) : (
            <p className="muted">No candidate satisfied every binding mandate clause. Refusing to trade is a valid fiduciary outcome — see each rejection's failed clauses below.</p>
          )}
        </div>

        <div className="card">
          <h2>Token Hunter — selected vs rejected</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Token</th><th>Decision</th><th className="num">24h</th><th className="num">RSI</th><th className="num">ATR%</th><th className="num">Conf.</th><th>Failed clauses (first)</th></tr>
              </thead>
              <tbody>
                {run.dossiers.map((d) => (
                  <tr key={d.symbol} className="click" onClick={() => onFocus(d.symbol)}>
                    <td><b>{d.symbol}</b> <span className="faint small">{d.stage}</span></td>
                    <td><Badge k={d.judgment.decision === "SELECT" ? "select" : "reject"}>{d.judgment.decision}</Badge></td>
                    <td className="num">{fmt(d.evidence.ch24h, 1, "%")}</td>
                    <td className="num">{d.evidence.rsi14 ?? <span className="warn">null</span>}</td>
                    <td className="num">{d.evidence.atrPct ?? <span className="warn">null</span>}</td>
                    <td className="num">{d.evidence.confluence ?? <span className="faint">—</span>}</td>
                    <td className="small">{d.judgment.failedGates.length ? d.judgment.failedGates.slice(0, 2).map((g) => `${g.id} ${g.kind}`).join(", ") + (d.judgment.failedGates.length > 2 ? ` +${d.judgment.failedGates.length - 2}` : "") : <span className="ok">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Stablecoins removed from the scan before ranking. "null" means RYO reported the measurement unavailable; the mandate treats that as a failed gate, never as 0. Click a row for the full debate.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>RYO-CHAN MCP research funnel — {run.calls.length} calls, all six tools</h2>
        {TOOL_ORDER.map((tool) => (
          <div className="lane" key={tool}>
            <div>
              <div className="mono">{tool}</div>
              <div className="small faint">{LANE_HELP[tool]}</div>
            </div>
            <div>
              {byTool(tool).map((c, i) => (
                <div key={i} className="chip" onClick={() => onInspect(c)} title="Inspect the raw RYO envelope">
                  <span className="t">{Object.values(c.args).join(" ") || "{}"}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <Prov r={c} />
                    {c.envelope && <Badge k={c.envelope.status}>{c.envelope.status}</Badge>}
                  </span>
                  {c.fallback_reason && c.provenance !== "live" && <span className="small faint" style={{ maxWidth: 240 }}>{c.fallback_reason}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {run.comparisons.map((c, i) =>
          c.envelope ? (
            <div key={i} className="small muted">
              compare_tokens({String(c.args.symbols)}) → pick <b>{c.envelope.data?.conclusion?.pick ?? "—"}</b> ({c.envelope.data?.conclusion?.confidence ?? "?"} confidence, {c.envelope.data?.conclusion?.method}).{" "}
              {run.dossiers.find((d) => d.symbol === c.envelope!.data?.conclusion?.pick)?.judgment.decision === "REJECT" && <span className="warn">The mandate rejects RYO's relative pick — relative strength is not suitability.</span>}
            </div>
          ) : null,
        )}
      </div>

      <div className="card">
        <h2>Agent log</h2>
        <div className="log">{log.length ? log.map((l, i) => <div key={i}>{l}</div>) : "—"}</div>
      </div>
    </div>
  );
}

const LANE_HELP: Record<RyoTool, string> = {
  market_overview: "regime, breadth, movers",
  monitor_market_sentiment_shift: "7d F&G, funding, liquidations",
  scan_market: "momentum · dip · meme pools",
  compare_tokens: "relative factor winners",
  analyze_token: "RSI(14), ATR(14), verdict",
  deep_analysis: "confluence, perp, ATR trade plan",
};
