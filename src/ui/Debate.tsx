import { useState } from "react";
import type { RunResult, TokenDossier } from "../engine/pipeline";
import type { RyoResult } from "../engine/ryo";
import { Badge, Fixture, download } from "./common";
import { complianceMemo, draftStor, storEligible } from "../engine/regulatory";
import { TokenPicker } from "./Causality";

export function DebateView({ run, focus, setFocus, onInspect }: { run: RunResult; focus: string; setFocus: (s: string) => void; onInspect: (r: RyoResult) => void }) {
  const d = run.dossiers.find((x) => x.symbol === focus) ?? run.dossiers[0];
  const bull = d.args.filter((a) => a.side === "bull").sort((a, b) => b.weight - a.weight);
  const bear = d.args.filter((a) => a.side === "bear").sort((a, b) => b.weight - a.weight);
  const srcFor = (cite: string) => {
    const tool = cite.split("(")[0].split(".")[0];
    return run.calls.find((c) => c.tool === tool && (c.args.symbol === d.symbol || !("symbol" in c.args)));
  };
  const Col = ({ side, list }: { side: "bull" | "bear"; list: typeof bull }) => (
    <div className="card">
      <h2>
        {side === "bull" ? "Bull agent" : "Bear agent"} <span className={side === "bull" ? "ok" : "err"}>Σ {side === "bull" ? d.judgment.bullScore : d.judgment.bearScore}</span>
      </h2>
      {list.map((a, i) => {
        const src = !a.fixture ? srcFor(a.cite) : undefined;
        return (
          <div key={i} className={`arg ${side}`}>
            <div className="spread">
              <span>{a.claim}</span>
              <span className="row" style={{ gap: 4 }}>
                <span className="badge faint">w {a.weight}</span>
                {a.fixture ? <Fixture /> : ["kol", "whale", "news"].includes(a.plane) ? <span className="badge b-live">FEED</span> : src ? <span className="badge b-snapshot" style={{ cursor: "pointer" }} onClick={() => onInspect(src)}>RYO ↗</span> : null}
              </span>
            </div>
            <div className="cite">{a.cite} = {a.value}</div>
          </div>
        );
      })}
      {!list.length && <p className="muted">No {side} argument is supported by the evidence.</p>}
    </div>
  );
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="spread">
        <TokenPicker run={run} focus={d.symbol} setFocus={setFocus} />
        <span className="small muted">Both agents argue from the same structured RYO <span className="mono">data</span> and fixture evidence; every claim cites its exact field.</span>
      </div>
      <div className="grid g3">
        <Col side="bull" list={bull} />
        <Col side="bear" list={bear} />
        <div className="card">
          <h2>Fiduciary Judge <Badge k={d.judgment.decision === "SELECT" ? "select" : "reject"}>{d.judgment.decision}</Badge></h2>
          {d.judgment.reasoning.map((r, i) => (
            <p key={i} style={{ margin: "0 0 8px" }}>{r}</p>
          ))}
          <h3>What would change the ruling</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {d.judgment.whatChangesIt.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <h3>Supporting evidence planes</h3>
          <div className="row">{d.planes.length ? d.planes.map((p) => <Badge key={p} k="pass">{p}</Badge>) : <span className="muted small">none</span>}</div>
          <h3>Regulatory documents</h3>
          <div className="row">
            <button className="btn" onClick={() => openDoc(complianceMemo(run, d), `compliance-memo-${d.symbol}.html`)}>Pre-trade compliance memo</button>
            <button className="btn" disabled={!storEligible(d)} title={storEligible(d) ? "Draft a MiCA Art. 92 suspicious transaction and order report" : "No manipulation detector fired for this token"} onClick={() => openDoc(draftStor(run, d), `draft-STOR-${d.symbol}.html`)}>
              Draft STOR (MiCA Art. 92)
            </button>
          </div>
          <p className="small muted">The Judge has no discretion over the mandate: a failed binding clause rejects regardless of how strong the bull case sounds. Argument weights only rank gate-compliant candidates.</p>
        </div>
      </div>
      <ClaudeAnalyst key={d.symbol + run.trace.root} run={run} d={d} />
      <div className="card">
        <h2>Mandate gates for {d.symbol} — formal counterexamples</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Clause</th><th>Outcome</th><th>Observed</th><th>Rule</th><th>Legal anchor</th></tr></thead>
            <tbody>
              {d.gates.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.id}</td>
                  <td><Badge k={g.outcome}>{g.outcome.replace("_", " ")}</Badge></td>
                  <td className="small">{g.counterexample ?? g.observed}</td>
                  <td className="small">{g.prose}</td>
                  <td className="small" title={g.anchor.why}>{g.anchor.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {d.evidence.warnings.length > 0 && (
        <div className="notice">
          <b>RYO warnings for {d.symbol}:</b> {d.evidence.warnings.join(" · ")}
        </div>
      )}
    </div>
  );
}

/** Open a generated document in a new tab (printable to PDF); fall back to a download if pop-ups are blocked. */
function openDoc(html: string, name: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  if (!window.open(url, "_blank")) download(name, html, "text/html");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type DebateResult =
  | { ok: true; model: string; result: { bull: { claim: string; cite: string; weight: number }[]; bear: { claim: string; cite: string; weight: number }[]; causal_story: string; what_would_change_my_mind: string }; validation: { allowedCites: number; claims: number; dropped: number }; output_sha256: string; usage: { input_tokens: number; output_tokens: number } }
  | { ok: false; error: string };

/** Claude argues both sides from the same structured evidence. Advisory only — the deterministic Judge decides. */
function ClaudeAnalyst({ run, d }: { run: RunResult; d: TokenDossier }) {
  const [state, setState] = useState<"idle" | "running">("idle");
  const [res, setRes] = useState<DebateResult | null>(null);
  const go = async () => {
    setState("running");
    const e = d.evidence;
    const payload = {
      symbol: d.symbol,
      evidence: { price: e.price, ch24h: e.ch24h, ch7d: e.ch7d, ch30d: e.ch30d, rsi14: e.rsi14, atrPct: e.atrPct, trend: e.trend, confluence: e.confluence, confluenceState: e.confluenceState, turnover: e.turnover, deepVerdict: e.deepVerdict, analyzeVerdict: e.analyzeVerdict, perp: e.perp, catalysts: e.catalysts, risks: e.risks, warnings: e.warnings },
      market: run.market,
      deterministicArgs: d.args.map((a) => ({ side: a.side, claim: a.claim, cite: a.cite, value: a.value })),
      gates: d.gates.map((g) => ({ id: g.id, outcome: g.outcome, prose: g.prose, observed: g.counterexample ?? g.observed })),
      decision: d.judgment.decision,
      evidenceMode: run.evidenceMode,
    };
    try {
      const r = await fetch("/api/ai/debate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setRes(await r.json());
    } catch (err) {
      setRes({ ok: false, error: `server unreachable (${(err as Error).message}) — static hosting has no Claude analyst` });
    }
    setState("idle");
  };
  const Col = ({ side, list }: { side: "bull" | "bear"; list: { claim: string; cite: string; weight: number }[] }) => (
    <div>
      <h3 className={side === "bull" ? "ok" : "err"}>{side === "bull" ? "Claude — bull" : "Claude — bear"}</h3>
      {list.map((c, i) => (
        <div key={i} className={`arg ${side}`}>
          <div className="spread"><span>{c.claim}</span><span className="badge faint">w {c.weight}</span></div>
          <div className="cite">{c.cite}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="card">
      <h2>Claude analyst debate (advisory) {res?.ok && <span className="badge faint">{res.model}</span>}</h2>
      <p className="small muted">Claude argues both sides from the same structured evidence. Every claim must cite an allowed evidence path, and claims that don't are dropped and counted. The deterministic, mandate-bound Judge above still makes the decision, so the hash-chained run and its replay are unaffected. Each response is SHA-256 hashed for the file.</p>
      <button className="btn primary" onClick={go} disabled={state === "running"}>{state === "running" ? "Claude is arguing both sides…" : `Run Claude debate on ${d.symbol}`}</button>
      {res && !res.ok && <p className="small warn" style={{ marginTop: 8 }}>{res.error}</p>}
      {res?.ok && (
        <>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <Col side="bull" list={res.result.bull} />
            <Col side="bear" list={res.result.bear} />
          </div>
          <h3>Causal story</h3>
          <p>{res.result.causal_story}</p>
          <h3>What would change the assessment</h3>
          <p>{res.result.what_would_change_my_mind}</p>
          <p className="small muted">
            Validation: {res.validation.claims} claims, {res.validation.dropped} dropped for citing outside the {res.validation.allowedCites} allowed paths · {res.usage.input_tokens} in / {res.usage.output_tokens} out tokens · output sha256 <span className="hash">{res.output_sha256.slice(0, 16)}…</span>
          </p>
        </>
      )}
    </div>
  );
}
