import type { RunResult } from "../engine/pipeline";
import type { RyoResult } from "../engine/ryo";
import { Badge, Fixture } from "./common";
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
          <p className="small muted">The Judge has no discretion over the mandate: a failed binding clause rejects regardless of how strong the bull case sounds. Argument weights only rank gate-compliant candidates.</p>
        </div>
      </div>
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
