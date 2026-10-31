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
import { LedgerView } from "./ui/Ledger";
import { Icon, Logo } from "./ui/icons";
import { HomeView } from "./ui/Home";

const TABS = ["Overview", "Verdict", "Ledger", "Causality", "Debate", "Mandate", "CRE + x402", "Audit"] as const;
type Tab = (typeof TABS)[number];
const TOOL_ORDER: RyoTool[] = ["market_overview", "monitor_market_sentiment_shift", "scan_market", "compare_tokens", "analyze_token", "deep_analysis"];

export default function App() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("cv-theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("cv-theme", theme);
    } catch {}
  }, [theme]);
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
  const [statusChecked, setStatusChecked] = useState(false);
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
    getStatus().then((st) => (setStatus(st), setStatusChecked(true)));
    go("replay");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveAvailable = !!status?.configured;
  const page = PAGES[tab];
  const statusBadge =
    status === null && !statusChecked ? (
      <Badge k="snapshot">checking the RYO proxy…</Badge>
    ) : status === null ? (
      <Badge k="snapshot">static mode · bundled RYO snapshots</Badge>
    ) : status.configured && status.whoami?.error ? (
      <Badge k="partial" title={status.whoami.error}>proxy ✓ · RYO unreachable now → snapshot fallback</Badge>
    ) : status.configured ? (
      <Badge k="live"><span className="dot pulse" /> proxy ✓ key {status.whoami?.key_id ?? "?"} · {status.whoami?.rate_limit_remaining ?? "?"}/{status.whoami?.rate_limit_per_min ?? "?"} calls/min</Badge>
    ) : (
      <Badge k="partial">proxy up · no RYO key → snapshot fallback</Badge>
    );
  return (
    <div className="shell">
      <header className="nav">
        <div className="brandmark">
          <Logo />
          <div>
            <b>causal verdict</b>
            <span>/fiduciary agent · RYO × Chainlink CRE</span>
          </div>
        </div>
        <nav className="navlinks" aria-label="Sections">
          {NAV.flatMap((g) => g.items).map((it) => (
            <button key={it.tab} className={tab === it.tab ? "on" : ""} onClick={() => setTab(it.tab)} aria-current={tab === it.tab ? "page" : undefined} title={it.desc}>
              {it.label ?? it.tab}
            </button>
          ))}
        </nav>
        <div className="navright">
          <button className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} aria-label="Toggle theme">
            {theme === "dark" ? <Icon.sun /> : <Icon.moon />}
          </button>
          <button className="btn primary" disabled={running} onClick={() => go()}>
            {running ? "Running…" : mode === "live" ? "Run agent · live" : "Run agent"}
          </button>
        </div>
      </header>

      {tab !== "Overview" && <div className="toolbar">
        <div className="statusline">
          {statusBadge}
          {run && (
            <>
              <span className="sep" />
              {Object.entries(run.provenanceMix).map(([k, v]) => <Badge key={k} k={k}>{v} {k}</Badge>)}
              {run.evidenceMode === "real" ? <Badge k="live">real feeds</Badge> : <Fixture />}
              <span className="sep" />
              <span>root <span className="hash">{short(run.trace.root, 8)}</span></span>
              <span>mandate <span className="hash">{short(run.mandateHash, 6)}</span></span>
            </>
          )}
          {!compiled.ast && <Badge k="fail">mandate has {compiled.errors.length} error(s)</Badge>}
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Data mode">
            <button className={mode === "replay" ? "on" : ""} onClick={() => setMode("replay")}>Replay</button>
            <button className={mode === "live" ? "on" : ""} onClick={() => { setMode("live"); getStatus().then(setStatus); }} title={liveAvailable ? "Calls RYO through the server proxy" : "Server has no RYO_MCP_KEY — live calls will fall back to snapshots"}>
              Live RYO
            </button>
          </div>
          <div className="seg" role="group" aria-label="Evidence source" title="KOL / whale / news / market evidence">
            <button className={evMode === "real" ? "on" : ""} onClick={() => setEvMode("real")}>Real feeds</button>
            <button className={evMode === "scenario" ? "on" : ""} onClick={() => setEvMode("scenario")}>Scenario</button>
          </div>
          <label className="inline">
            Chaos
            <select value={chaos} onChange={(e) => setChaos(e.target.value as Chaos)} disabled={mode === "replay"} title="Inject a failure before the proxy calls RYO (live mode)">
              <option value="none">none</option>
              <option value="429">429 rate-limited</option>
              <option value="503">503 unavailable</option>
              <option value="timeout">timeout</option>
              <option value="offline">offline</option>
            </select>
          </label>
          <label className="inline">
            Equity $
            <input className="num" type="number" value={equity} min={1000} step={1000} onChange={(e) => setEquity(Math.max(1000, Number(e.target.value)))} />
          </label>
        </div>
      </div>}

      {tab !== "Overview" && (
        <div className="pagehead">
          <div className="eyebrow">/{NAV.find((g) => g.items.some((i) => i.tab === tab))?.group.toLowerCase()}</div>
          <h1>{page.title}</h1>
          <p>{page.sub}</p>
        </div>
      )}

      <main className="content">
        {error && <div className="notice err" style={{ marginBottom: 14 }}>{error}</div>}
        {!run ? (
          <div className="card">Running the agent on captured RYO evidence…</div>
        ) : (
          <div className="fade-in" key={tab}>
            {tab === "Overview" && <HomeView run={run} go={(t) => setTab(t as Tab)} />}
            {tab === "Verdict" && <VerdictView run={run} log={log} onInspect={insp.open} onFocus={(s) => { setFocus(s); setTab("Debate"); }} />}
            {tab === "Ledger" && <LedgerView />}
            {tab === "Causality" && <CausalityView run={run} focus={focus} setFocus={setFocus} posts={posts} setPosts={setPosts} channels={channels} setChannels={setChannels} />}
            {tab === "Debate" && <DebateView run={run} focus={focus} setFocus={setFocus} onInspect={insp.open} />}
            {tab === "Mandate" && <MandateView prose={mandate} setProse={setMandate} run={run} />}
            {tab === "CRE + x402" && <CreView mandate={mandate} run={run} />}
            {tab === "Audit" && <AuditView run={run} mandate={mandate} equity={equity} onInspect={insp.open} />}
          </div>
        )}
        {insp.node}
        <footer>
          Practice trades only. Not financial advice; nothing here places a trade. <Fixture /> marks illustrative scenario data. Snapshot {short(SNAPSHOTS.bundle_sha256, 12)} · {SNAPSHOTS.captured_at}.
        </footer>
      </main>
    </div>
  );
}

type NavItem = { tab: Tab; label?: string; icon: keyof typeof Icon; desc: string };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ tab: "Overview", icon: "judge", desc: "What it is and how to check it" }] },
  { group: "Agent", items: [{ tab: "Verdict", icon: "verdict", desc: "Decision and RYO funnel" }, { tab: "Ledger", icon: "ledger", desc: "Practice trades, verified" }] },
  { group: "Evidence", items: [{ tab: "Causality", icon: "causality", desc: "Whales, voices, news, markets" }, { tab: "Debate", icon: "debate", desc: "Bull · Bear · Judge" }] },
  { group: "Governance", items: [{ tab: "Mandate", icon: "mandate", desc: "Prose ⇄ AST compiler" }, { tab: "Audit", icon: "audit", desc: "Replay and evidence" }] },
  { group: "On-chain", items: [{ tab: "CRE + x402", label: "CRE · x402", icon: "chain", desc: "Workflow and payments" }] },
];
const PAGES: Record<Tab, { title: string; sub: string }> = {
  Overview: { title: "Overview", sub: "" },
  Verdict: { title: "Verdict", sub: "One practice-trade decision from six RYO tools and independent evidence." },
  Ledger: { title: "Ledger", sub: "Every practice trade, recorded on live data and hash-chained." },
  Causality: { title: "Cause and effect", sub: "Whales, voices, news and markets on one timeline." },
  Debate: { title: "Bull · Bear · Judge", sub: "Two agents argue from the same evidence. The mandate decides." },
  Mandate: { title: "Mandate", sub: "Plain-English rules, compiled and enforced." },
  "CRE + x402": { title: "Chainlink CRE · x402", sub: "The on-chain workflow and paid verdicts for agents." },
  Audit: { title: "Audit", sub: "Replay the run, try to tamper with it, export the evidence." },
};

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

      <div className="grid">
        <div className={`card ${t ? "trade" : "noTrade"}`}>
          <h2>
            Practice trade — one atomic decision {t ? <Badge k="select">SELECT {t.dossier.symbol}</Badge> : <Badge k="reject">NO TRADE</Badge>}
          </h2>
          {t ? (
            <>
              <div className="grid g4 bigstats" style={{ gap: 10 }}>
                <div><div className="stat-l">Entry</div><div className="stat">{fmtUsd(t.position.entry)}</div></div>
                <div><div className="stat-l">Stop</div><div className="stat err">{fmtUsd(t.position.stop)}</div></div>
                <div><div className="stat-l">Targets</div><div className="stat ok" style={{ fontSize: 17 }}>{t.position.targets.map((x) => fmtUsd(x.price)).join(" / ")}</div></div>
                <div><div className="stat-l">Size</div><div className="stat">{t.position.portfolioPct}%</div></div>
              </div>
              <PriceLadder p={t.position} symbol={t.dossier.symbol} />
              <div className="kv kv2 small" style={{ marginTop: 18 }}>
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
                <span className="small muted">Starts from RYO's ATR trade plan; the mandate sets the stop and size.</span>
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
                <tr><th>Token</th><th>Decision</th><th className="num">24h</th><th className="num">RSI</th><th className="num">ATR%</th><th className="num">Conf.</th><th>Binding clauses failed</th></tr>
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
                    <td className="small">
                      {d.judgment.failedGates.length ? (
                        <span className="row" style={{ gap: 4 }}>
                          {d.judgment.failedGates.slice(0, 3).map((g) => <span key={g.id} className="badge b-fail" title={g.counterexample ?? g.observed}>{g.id} {g.kind.replace(/_/g, " ")}</span>)}
                          {d.judgment.failedGates.length > 3 && <span className="faint">+{d.judgment.failedGates.length - 3}</span>}
                        </span>
                      ) : <span className="badge b-pass">all gates pass</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            "null" means RYO reported it unavailable — a failed gate, never a 0. Click a row for the debate.
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

/** The atomic trade as one picture: risk (stop → entry) and reward (entry → targets), with the dip tranche. */
function PriceLadder({ p, symbol }: { p: NonNullable<RunResult["practiceTrade"]>["position"]; symbol: string }) {
  const W = 520, H = 112, L = 22, R = 22, axis = 58;
  const t2 = p.targets[p.targets.length - 1]?.price ?? p.entry;
  const lo = Math.min(p.stop, ...p.tranches.map((t) => t.price)), hi = Math.max(t2, p.entry);
  const pad = (hi - lo) * 0.06;
  const x = (v: number) => L + ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (W - L - R);
  const marks = [
    { v: p.stop, label: "Stop", color: "var(--bear)", up: false },
    ...p.tranches.slice(1).map((t) => ({ v: t.price, label: `Dip ${t.pct}%`, color: "var(--warn)", up: true })),
    { v: p.entry, label: "Entry", color: "var(--text)", up: false },
    ...p.targets.map((t, i) => ({ v: t.price, label: `T${i + 1} · ${t.r}R`, color: "var(--bull)", up: i % 2 === 0 })),
  ];
  return (
    <div className="ladder" role="img" aria-label={`${symbol} trade: stop ${fmtUsd(p.stop)}, entry ${fmtUsd(p.entry)}, targets ${p.targets.map((t) => fmtUsd(t.price)).join(", ")}`}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <rect x={x(p.stop)} y={axis - 7} width={x(p.entry) - x(p.stop)} height={14} rx={4} fill="var(--bear)" opacity={0.18} />
        <rect x={x(p.entry)} y={axis - 7} width={x(t2) - x(p.entry)} height={14} rx={4} fill="var(--bull)" opacity={0.18} />
        <line x1={L} x2={W - R} y1={axis} y2={axis} stroke="var(--line-2)" />
        {marks.map((m, i) => (
          <g key={i}>
            <line x1={x(m.v)} x2={x(m.v)} y1={axis - 11} y2={axis + 11} stroke={m.color} strokeWidth={2} />
            <circle cx={x(m.v)} cy={axis} r={4} fill={m.color} />
            <text x={x(m.v)} y={m.up ? axis - 33 : axis + 31} textAnchor="middle" fontSize="12.5" fontWeight={650} fill={m.color}>{m.label}</text>
            <text x={x(m.v)} y={m.up ? axis - 19 : axis + 46} textAnchor="middle" fontSize="11.5" fill="var(--muted)" style={{ fontFamily: "var(--mono)" }}>{fmtUsd(m.v)}</text>
          </g>
        ))}
      </svg>
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
