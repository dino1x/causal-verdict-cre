import { useMemo } from "react";
import { compile, decompile, roundTrip, DEFAULT_MANDATE, type Clause, type MandateAST } from "../engine/legalAstCompiler";
import { mandateHash } from "../engine/creCodegen";
import type { RunResult } from "../engine/pipeline";
import { Badge, short } from "./common";

const NUM_FIELDS: Partial<Record<Clause["kind"], { key: string; step: number }[]>> = {
  risk_per_trade: [{ key: "maxPct", step: 0.25 }],
  max_position: [{ key: "maxPct", step: 1 }],
  min_confluence: [{ key: "min", step: 0.05 }],
  min_turnover: [{ key: "min", step: 0.01 }],
  max_atr: [{ key: "maxPct", step: 1 }],
  stop_rule: [{ key: "atrMult", step: 0.25 }, { key: "maxPct", step: 0.5 }],
  anti_exit_liquidity: [{ key: "windowMin", step: 5 }],
  anti_touting: [{ key: "minKols", step: 1 }, { key: "windowMin", step: 5 }],
  regime_scaling: [{ key: "factor", step: 0.1 }],
  min_planes: [{ key: "n", step: 1 }],
  price_agreement: [{ key: "maxPct", step: 0.5 }],
};

export function MandateView({ prose, setProse, run }: { prose: string; setProse: (s: string) => void; run: RunResult }) {
  const { ast, errors } = useMemo(() => compile(prose), [prose]);
  const rt = useMemo(() => roundTrip(prose), [prose]);
  const hash = ast ? mandateHash(ast) : null;

  // AST edits are decompiled straight back into prose: the AST is an editable view of the same mandate.
  const editAst = (i: number, key: string, value: number) => {
    if (!ast) return;
    const next: MandateAST = { ...ast, clauses: ast.clauses.map((c, j) => (j === i ? { ...c, clause: { ...c.clause, [key]: value } as Clause } : c)) };
    setProse(decompile(next));
  };
  const removeClause = (i: number) => ast && setProse(decompile({ ...ast, clauses: ast.clauses.filter((_, j) => j !== i) }));

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="notice">
        <b>Mandate compiler.</b> Prose compiles to rules; anything ambiguous is rejected with a line number. Rules decompile to the same prose. Edit either side.
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>
            Mandate prose {errors.length ? <Badge k="fail">{errors.length} error(s)</Badge> : <Badge k="pass">compiles</Badge>}
            {ast && <Badge k={rt.ok ? "pass" : "fail"}>{rt.ok ? "round-trip fixpoint ✓" : "round-trip drift"}</Badge>}
          </h2>
          <textarea className="code" value={prose} onChange={(e) => setProse(e.target.value)} spellCheck={false} />
          {errors.map((e, i) => (
            <div key={i} className="small err">line {e.line}: {e.message} <span className="faint">“{e.text}”</span></div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => rt.canonicalProse && setProse(rt.canonicalProse)} disabled={!rt.canonicalProse}>Normalize to canonical prose</button>
            <button className="btn" onClick={() => setProse(DEFAULT_MANDATE)}>Reset</button>
            {hash && <span className="small muted">mandate hash <span className="hash">{short(hash, 14)}</span></span>}
          </div>
          {hash && hash !== run.mandateHash && <p className="small warn">The mandate changed since the last run. Run the agent again to apply it.</p>}
        </div>
        <div className="card">
          <h2>Typed AST — editable</h2>
          {!ast ? (
            <p className="muted">Fix the compile errors to see the AST.</p>
          ) : (
            <div className="scroll" style={{ maxHeight: 560 }}>
              <table>
                <thead><tr><th>id</th><th>kind</th><th>parameters</th><th>anchor</th><th></th></tr></thead>
                <tbody>
                  {ast.clauses.map((c, i) => (
                    <tr key={c.id}>
                      <td className="mono">{c.id}<div className="faint small">L{c.line}</div></td>
                      <td className="mono small">{c.clause.kind}</td>
                      <td className="small">
                        {(NUM_FIELDS[c.clause.kind] ?? []).map((f) => (
                          <label key={f.key} className="inline" style={{ marginRight: 8 }}>
                            {f.key}
                            <input className="num" style={{ width: 80 }} type="number" step={f.step} value={(c.clause as any)[f.key]} onChange={(e) => editAst(i, f.key, Number(e.target.value))} />
                          </label>
                        ))}
                        {c.clause.kind === "require_status" && <span className="mono">{c.clause.allowed.join(" | ")}</span>}
                        {c.clause.kind === "reject_verdict" && <span className="mono">{c.clause.verdicts.join(" | ")}</span>}
                        {c.clause.kind === "require_measurement" && <span className="mono">{c.clause.field}</span>}
                        {c.clause.kind === "regime_scaling" && <span className="mono"> when {c.clause.regime}</span>}
                      </td>
                      <td className="small" title={c.anchor.why}>{c.anchor.code}</td>
                      <td><button className="btn small" onClick={() => removeClause(i)} title="Remove clause">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <h2>Legal anchors used by this mandate</h2>
        <div className="grid g2">
          {ast &&
            [...new Map(ast.clauses.map((c) => [c.anchor.code, c.anchor])).values()].map((a) => (
              <div key={a.code} className="arg">
                <b>{a.code}</b> <span className="muted small">{a.title}</span>
                <div className="small">{ast.clauses.filter((c) => c.anchor.code === a.code).map((c) => c.id).join(", ")}: {ast.clauses.find((c) => c.anchor.code === a.code)!.anchor.why}</div>
              </div>
            ))}
        </div>
        <p className="small muted">
          §17(b) covers securities; the touting gate flags undisclosed promotion either way. MiCA Art. 91 bans manipulation; Art. 92 requires abuse detection. Engineering, not legal advice.
        </p>
      </div>
    </div>
  );
}
