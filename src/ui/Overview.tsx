// Overview set pieces: the verdict console (this run's real reasoning, replayed line by line), the four-step flow,
// the stack strip and the on-chain proof tiles. Everything shown is read from the run or the committed records.
import type { RunResult } from "../engine/pipeline";
import { fmtUsd } from "../engine/ryo";

export function VerdictConsole({ run, onOpen }: { run: RunResult; onOpen: () => void }) {
  const t = run.practiceTrade;
  const tools = new Set(run.calls.map((c) => c.tool)).size;
  const live = run.provenanceMix.live ?? 0;
  const sel = t?.dossier ?? run.dossiers[0];
  const c16 = sel?.gates.find((g) => g.kind === "price_agreement");
  const failedOthers = run.dossiers.filter((d) => d.judgment.decision === "REJECT").length;
  const lines: { k: string; v: string; tone?: "ok" | "err" | "muted" }[] = [
    { k: "market_overview", v: `regime ${run.market.regime ?? "unavailable"} · fear & greed ${run.market.fearGreed ?? "—"}` },
    { k: "ryo funnel", v: `${run.calls.length} RYO calls across ${tools}/6 tools · ${live ? `${live} live` : "replayed from real snapshots"}` },
    { k: "evidence planes", v: `${run.evidenceUsed.whales.length} whale transfers · ${run.evidenceUsed.news.length} news · ${run.evidenceUsed.posts.length} posts · ${(run.evidenceUsed.markets ?? []).length} exchange books` },
    { k: "bull vs bear", v: sel ? `${sel.symbol}: bull ${sel.judgment.bullScore} · bear ${sel.judgment.bearScore} · planes ${sel.planes.join(", ") || "none"}` : "—" },
    { k: "clause 16 · price check", v: c16 ? `${c16.outcome.replace("_", " ")} — ${c16.observed}` : "not in mandate", tone: c16?.outcome === "fail" ? "err" : c16?.outcome === "pass" ? "ok" : "muted" },
    { k: "mandate", v: `${run.mandate.clauses.length} clauses · ${failedOthers} candidate${failedOthers === 1 ? "" : "s"} rejected with a counterexample` },
    { k: "verdict", v: t ? `SELECT ${t.position.symbol} · entry ${fmtUsd(t.position.entry)} · stop ${fmtUsd(t.position.stop)} · ${t.position.portfolioPct}% of equity` : "NO TRADE — no candidate satisfied every binding clause", tone: t ? "ok" : "muted" },
  ];
  return (
    <div className="console">
      <div className="console-q">
        <span className="faint">ask</span> Should the desk take a practice position, under the Prudent Practice mandate?
      </div>
      <ol className="console-lines">
        {lines.map((l, i) => (
          <li key={l.k} style={{ animationDelay: `${0.25 + i * 0.32}s` }}>
            <span className="ck">{l.k}</span>
            <span className={`cv ${l.tone ?? ""}`}>{l.v}</span>
          </li>
        ))}
      </ol>
      <div className="console-foot">
        <span className="hash">trace root {run.trace.root.slice(0, 18)}…</span>
        <button className="roundbtn" onClick={onOpen} aria-label="Open the verdict">→</button>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const steps = [
    { n: "01", t: "Read RYO", d: "All six RYO-CHAN MCP tools, chained: the scan shortlist drives the comparison, which drives token and deep analysis." },
    { n: "02", t: "Check the world", d: "Whale transfers, voices, news, exchange positioning and a Chainlink price, each linked and timestamped before the run." },
    { n: "03", t: "Argue, then obey", d: "Bull and bear argue from the same fields; a compiled fiduciary mandate decides, and says which clause refused." },
    { n: "04", t: "Prove it", d: "A hash-chained trace that replays exactly, a witnessed ledger, and a verdict written on-chain by a Chainlink CRE workflow." },
  ];
  return (
    <div className="flow">
      {steps.map((s) => (
        <div key={s.n} className="flow-step">
          <div className="flow-n">{s.n}</div>
          <div className="flow-t">{s.t}</div>
          <p>{s.d}</p>
        </div>
      ))}
    </div>
  );
}

export function BuiltOn() {
  const items = ["RYO-CHAN MCP", "Chainlink CRE", "Chainlink Data Feeds", "x402 · Base", "OpenTimestamps · Bitcoin", "Sigstore", "Claude", "Tavily"];
  return (
    <div className="builton">
      <span className="eyebrow">/built on</span>
      <div className="builton-row">{items.map((i) => <span key={i}>{i}</span>)}</div>
    </div>
  );
}

export function ProofTiles({ tiles }: { tiles: { label: string; sub: string; href: string }[] }) {
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <a key={t.href} className="tile" href={t.href} target="_blank" rel="noreferrer">
          <span className="tile-seal" aria-hidden="true">✓</span>
          <span className="tile-l">{t.label}</span>
          <span className="tile-s">{t.sub}</span>
        </a>
      ))}
    </div>
  );
}
