import { useEffect, useState } from "react";
import { ledgerHead, ledgerStats, verifyLedger, type Ledger } from "../engine/ledger";
import battery from "../data/batteryReport.json";
import { fmtUsd } from "../engine/ryo";
import bundled from "../data/ledgerSnapshot.json";
import { Badge, short } from "./common";

type Tamper = { label: string; mutate: (l: Ledger) => void };
const TAMPERS: Tamper[] = [
  { label: "Flip the latest decision", mutate: (l) => { const r = l.runs[l.runs.length - 1]; if (r) r.decision = r.decision === "NO TRADE" ? "SELECT SOL" : "NO TRADE"; } },
  { label: "Erase a rejection reason", mutate: (l) => { const c = l.runs.flatMap((r) => r.candidates ?? []).find((x) => x.failed.length); if (c) c.failed = []; } },
  { label: "Rewrite an event's text", mutate: (l) => { if (l.events[0]) l.events[0].detail += " (edited)"; } },
  { label: "Delete the latest run (truncation)", mutate: (l) => { l.runs.pop(); } },
];

function VerifyPanel({ ledger }: { ledger: Ledger }) {
  const head = ledgerHead(ledger);
  const [check, setCheck] = useState<string | null>(null);
  const [tamper, setTamper] = useState<{ label: string; chain: string; head: string } | null>(null);
  const b = battery as any;
  const recheck = () => {
    const t0 = performance.now();
    const v = verifyLedger(ledger);
    setCheck(`${v.ok ? "verified" : `BROKEN: ${v.detail}`} — ${ledger.events.length} events, ${ledger.runs.length} runs and the positions re-hashed in this browser in ${(performance.now() - t0).toFixed(1)} ms`);
  };
  const run = (t: Tamper) => {
    const x: Ledger = structuredClone(ledger);
    t.mutate(x);
    const v = verifyLedger(x);
    const h = ledgerHead(x);
    setTamper({ label: t.label, chain: v.ok ? "the chain alone still verifies (a shorter ledger is a valid prefix)" : `chain breaks: ${v.detail}`, head: !v.ok ? "caught" : h === head ? "head unchanged: NOT caught" : `but its head becomes ${short(h, 10)}, which no longer matches the published head, so it is caught` });
  };
  return (
    <div className="card">
      <h2>Check it yourself</h2>
      <p className="small muted">Everything below runs in your browser on the ledger shown here. No server is trusted.</p>
      <div className="small">Ledger head <span className="hash">{head}</span></div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={recheck}>Re-verify the chain</button>
        {TAMPERS.map((t) => <button key={t.label} className="btn" onClick={() => run(t)}>{t.label}</button>)}
      </div>
      {check && <p className="small" style={{ marginTop: 8 }}><Badge k={check.startsWith("verified") ? "pass" : "fail"}>{check.split(" — ")[0]}</Badge> {check.split(" — ")[1]}</p>}
      {tamper && <p className="small" style={{ marginTop: 8 }}><b>{tamper.label}</b> on a private copy → {tamper.chain}{tamper.head === "caught" ? "." : `, ${tamper.head}.`}</p>}
      <p className="small" style={{ marginTop: 10 }}>
        <b>Attack battery</b> (<span className="mono">scripts/battery.ts</span>, run by <span className="mono">npm test</span>): <Badge k={b.missedWithWitness ? "fail" : "pass"}>{b.missedWithWitness} missed of {b.total}</Badge> attacks on copies of the live ledger, a ledger with real positions, and a reasoning trace. The hash chains alone catch every edit, deletion and swap; truncating the tail or re-hashing the whole history leaves a valid chain ({b.missedByChain} such attacks), and only the published head catches those. That is why the head is witnessed outside our control.
      </p>
    </div>
  );
}

export function LedgerView() {
  const [ledger, setLedger] = useState<Ledger>(bundled as unknown as Ledger);
  const [source, setSource] = useState("bundled snapshot (src/data/ledgerSnapshot.json)");
  useEffect(() => {
    fetch("/api/ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && (setLedger(j.ledger), setSource(j.source)))
      .catch(() => {});
  }, []);
  const st = ledgerStats(ledger);
  const v = verifyLedger(ledger);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="notice">
        <b>Practice-trade ledger.</b> An autonomous loop (<span className="mono">scripts/run-agent.ts</span>) runs the full agent every 15 minutes on live RYO data (paced to RYO’s rate limits) and real feeds, and records every practice trade it would make. Later runs re-price open positions with fresh RYO prices and close them at the stop, the targets or the 72-hour time stop. Positions are marked only at observation points (each run): a level counts as hit only if an observed price is beyond it, and highs and lows between runs aren't seen. Stale runs and prices older than the position are ignored. No trade is ever executed.
      </div>
      <div className="grid g4">
        <div className="card"><div className="stat-l">Agent runs recorded</div><div className="stat">{st.runs}</div><div className="small muted">{source}</div></div>
        <div className="card"><div className="stat-l">Open / closed</div><div className="stat">{st.open} / {st.closed}</div></div>
        <div className="card"><div className="stat-l">Realized P&amp;L · avg R</div><div className={`stat ${st.realizedPnlUsd >= 0 ? "ok" : "err"}`}>{fmtUsd(st.realizedPnlUsd)}</div><div className="small muted">avg {st.avgR ?? "—"}R · win rate {st.winRate === null ? "—" : `${(st.winRate * 100).toFixed(0)}%`}</div></div>
        <div className="card"><div className="stat-l">Ledger hash chain</div><div className="row" style={{ marginTop: 6 }}><Badge k={v.ok ? "pass" : "fail"}>{v.ok ? `${ledger.events.length} events · ${ledger.runs.length} runs verify` : `${v.part} ${v.brokenAt} broken`}</Badge></div></div>
      </div>
      <VerifyPanel ledger={ledger} />
      <div className="card">
        <h2>Positions</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Symbol</th><th>Opened (RYO as_of)</th><th className="num">Entry</th><th className="num">Stop now</th><th>Targets</th><th className="num">Last mark</th><th>Fills</th><th className="num">Realized</th><th>Status</th></tr></thead>
            <tbody>
              {ledger.positions.map((p) => {
                const last = p.marks[p.marks.length - 1];
                return (
                  <tr key={p.id}>
                    <td><b>{p.symbol}</b><div className="hash">{short(p.openTraceRoot, 8)}</div></td>
                    <td className="small">{p.openedAt}</td>
                    <td className="num">{fmtUsd(p.entry)}</td>
                    <td className="num">{fmtUsd(p.stopNow)}</td>
                    <td className="small">{p.targets.map((t) => fmtUsd(t.price)).join(" / ")}</td>
                    <td className="num" title={last?.source}>{last ? fmtUsd(last.price) : "—"}<div className="faint small">{last?.at}</div></td>
                    <td className="small">{p.fills.length ? p.fills.map((f) => `${f.reason} ${f.pct}% @ ${fmtUsd(f.price)}`).join(" · ") : "—"}</td>
                    <td className={`num ${p.realizedPnlUsd >= 0 ? "ok" : "err"}`}>{fmtUsd(p.realizedPnlUsd)}{p.realizedR !== null && <div className="small">{p.realizedR}R</div>}</td>
                    <td><Badge k={p.status === "open" ? "partial" : "pass"}>{p.status}</Badge></td>
                  </tr>
                );
              })}
              {!ledger.positions.length && <tr><td colSpan={9} className="muted">No practice positions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>Run history</h2>
          <div className="scroll" style={{ maxHeight: 420 }}>
            <table>
              <thead><tr><th>Reference time</th><th>Decision</th><th>Why (deciding gates per candidate)</th><th>RYO provenance</th><th>Evidence</th><th>Trace root</th></tr></thead>
              <tbody>
                {[...ledger.runs].reverse().map((r) => (
                  <tr key={r.traceRoot}>
                    <td className="small">{r.at}</td>
                    <td><Badge k={r.decision.startsWith("SELECT") ? "select" : "reject"}>{r.decision}</Badge></td>
                    <td className="small">
                      {r.candidates
                        ? r.candidates.map((c) => (
                            <div key={c.symbol} title={c.failed.map((f) => `${f.gate}: ${f.observed}`).join("\n")}>
                              <b>{c.symbol}</b>{" "}
                              {c.decision === "SELECT" ? <span className="ok">selected</span> : <span className="mono">{c.failed.map((f) => f.gate).join(", ") || "rejected"}</span>}
                            </div>
                          ))
                        : <span className="muted">not stored (recorded before reasons were added)</span>}
                    </td>
                    <td className="small">{Object.entries(r.provenance).map(([k, n]) => `${n} ${k}`).join(" · ")}</td>
                    <td className="small">{r.evidenceMode}</td>
                    <td className="hash">{short(r.traceRoot, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Ledger events (hash-chained)</h2>
          <div className="scroll" style={{ maxHeight: 420 }}>
            {[...ledger.events].reverse().map((e) => (
              <div key={e.i} className="step">
                <div className="mono faint">#{e.i}</div>
                <div>
                  <div><span className="mono">{e.kind}</span> {e.symbol && <b>{e.symbol}</b>} <span className="small muted">{e.at}</span></div>
                  <div className="small">{e.detail}</div>
                  <div className="chain-link">prev {short(e.prev, 8)} → {short(e.hash, 8)} · run {short(e.traceRoot, 8)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
