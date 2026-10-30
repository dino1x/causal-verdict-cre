import { useState } from "react";
import { recordedFetcher, runPipeline, verifyTrace, type RunResult } from "../engine/pipeline";
import { canonical, type RyoResult } from "../engine/ryo";
import { hashHex } from "../engine/pipeline";
import { Badge, download, Prov, short } from "./common";

function certificate(run: RunResult) {
  const items = run.calls.map((c, i) => ({
    exhibit: `RYO-${String(i + 1).padStart(2, "0")}`,
    tool: c.tool,
    arguments: c.args,
    provenance: c.provenance,
    ryo_status: c.envelope?.status ?? "unavailable",
    ryo_as_of: c.envelope?.as_of ?? null,
    retrieved_at: c.captured_at,
    sha256: c.envelope_sha256,
    fallback_reason: c.fallback_reason,
  }));
  return {
    title: "Electronic evidence package: Causal-Verdict practice-trade decision",
    rule: "Fed. R. Evid. 902(14), certified data copied from an electronic device, storage medium, or file",
    identification_method: "SHA-256 over UTF-8 JSON with object keys sorted lexicographically (applied to each RYO response envelope exactly as received). Decision steps are linked as hash(prev | index | label | sha256(payload)).",
    source_system: "RYO-CHAN MCP, https://app-ryochan.com/api/mcp (read-only research tools), REST /tools/<tool>/call",
    reference_time: run.referenceTime,
    mandate: { name: run.mandate.name, sha256: run.mandateHash, clauses: run.mandate.clauses.length },
    decision: run.practiceTrade ? run.practiceTrade.position : { symbol: null, outcome: "no trade" },
    rejections: run.dossiers.filter((d) => d.judgment.decision === "REJECT").map((d) => ({ symbol: d.symbol, failed: d.judgment.failedGates.map((g) => ({ clause: g.id, anchor: g.anchor.code, counterexample: g.counterexample })) })),
    reasoning_trace_root: run.trace.root,
    reasoning_trace: run.trace.steps.map((s) => ({ i: s.i, label: s.label, payload_sha256: s.payload_sha256, prev: s.prev, hash: s.hash })),
    exhibits: items,
    evidence_mode: run.evidenceMode,
    external_evidence:
      run.evidenceMode === "real"
        ? { whales: run.evidenceUsed.whales.map((w) => ({ symbol: w.symbol, kind: w.kind, usd: w.usd, minutes: w.minutes, source: w.source })), news: run.evidenceUsed.news.map((n) => ({ symbol: n.symbol, headline: n.headline, source: n.source })), posts: run.evidenceUsed.posts.map((p) => ({ handle: p.handle, minutes: p.minutes, source: p.source ?? "user-supplied" })), feeds: run.feedSources }
        : null,
    fixture_disclosure:
      run.evidenceMode === "real"
        ? "External evidence was collected from public sources (linked per item). Exchange labels are best-effort public labels. Items without a source URL were supplied by the user."
        : "KOL posts, whale-wallet events and news items used by this run are illustrative scenario fixtures, not live records, and are not certified as authentic.",
    certification_template:
      "DRAFT. To be completed and signed by a qualified person (FRE 902(11) and (14)). I, [NAME], [TITLE], declare that I am familiar with the system described above. The exhibits listed were retrieved by the process described, and each exhibit's SHA-256 digest, recomputed by me on [DATE], matches the value recorded here. I declare under penalty of perjury that the foregoing is true and correct (28 U.S.C. § 1746). Signature: __________",
  };
}

export function AuditView({ run, mandate, equity, onInspect }: { run: RunResult; mandate: string; equity: number; onInspect: (r: RyoResult) => void }) {
  const [replay, setReplay] = useState<{ root: string; same: boolean } | null>(null);
  const [tamper, setTamper] = useState<string | null>(null);
  const [rehash, setRehash] = useState<{ ok: number; bad: number } | null>(null);
  const v = verifyTrace(run.trace.steps);
  const doReplay = async () => {
    const r = await runPipeline({ fetcher: recordedFetcher(run.calls), mandateProse: mandate, equityUsd: equity, evidence: async () => ({ mode: run.evidenceMode, fixtures: run.evidenceUsed, sources: run.feedSources }) });
    setReplay({ root: r.trace.root, same: r.trace.root === run.trace.root });
  };
  const doTamper = () => {
    const steps = structuredClone(run.trace.steps);
    const i = steps.findIndex((s) => s.label === "ryo.regime");
    (steps[i].payload as any).market.regime = "risk_on";
    const res = verifyTrace(steps);
    setTamper(res.ok ? "chain still verifies (unexpected)" : `edited step ${i} (regime → risk_on): chain breaks at step ${res.brokenAt}`);
  };
  const doRehash = () => {
    let ok = 0, bad = 0;
    for (const c of run.calls) if (c.envelope) (hashHex(canonical(c.envelope)).slice(2) === c.envelope_sha256 ? ok++ : bad++);
    setRehash({ ok, bad });
  };
  const cert = certificate(run);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid g3">
        <div className="card">
          <h2>Repeatability</h2>
          <p className="small muted">The engine has no clock and no randomness. Replaying the recorded RYO envelopes must reproduce the same trace root, bit for bit.</p>
          <button className="btn primary" onClick={doReplay}>Replay this run</button>
          {replay && (
            <p className="small">
              <Badge k={replay.same ? "pass" : "fail"}>{replay.same ? "identical root" : "root differs"}</Badge> <span className="hash">{short(replay.root, 16)}</span>
              {!replay.same && <span className="warn"> (the mandate, equity or posts changed since this run)</span>}
            </p>
          )}
        </div>
        <div className="card">
          <h2>Tamper evidence</h2>
          <p className="small muted">Chain status: <Badge k={v.ok ? "pass" : "fail"}>{v.ok ? `${run.trace.steps.length} steps verify` : `broken at ${v.brokenAt}`}</Badge></p>
          <button className="btn" onClick={doTamper}>Edit one step and re-verify</button>
          {tamper && <p className="small warn">{tamper}</p>}
        </div>
        <div className="card">
          <h2>FRE 902(14) evidence package</h2>
          <p className="small muted">Exhibits are identified by hash, the reasoning trace is chained, fixtures are disclosed, and a draft certification is included for a qualified person to complete and sign.</p>
          <div className="row">
            <button className="btn primary" onClick={() => download(`causal-verdict-evidence-${run.trace.root.slice(2, 10)}.json`, JSON.stringify({ ...cert, raw_envelopes: run.calls.map((c) => c.envelope) }, null, 2))}>Download package</button>
            <button className="btn" onClick={doRehash}>Re-hash all exhibits</button>
          </div>
          {rehash && <p className="small"><Badge k={rehash.bad ? "fail" : "pass"}>{rehash.ok} match · {rehash.bad} mismatch</Badge></p>}
        </div>
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>Hash-chained reasoning trace · root {short(run.trace.root, 12)}</h2>
          <div className="scroll" style={{ maxHeight: 560 }}>
            {run.trace.steps.map((s) => (
              <div key={s.i} className="step">
                <div className="mono faint">#{s.i}</div>
                <div>
                  <div className="mono">{s.label}</div>
                  <div className="chain-link">prev {short(s.prev, 10)} → hash {short(s.hash, 10)} · payload {short(s.payload_sha256, 8)}</div>
                  <details>
                    <summary className="small muted">payload</summary>
                    <pre className="code" style={{ maxHeight: 220 }}>{JSON.stringify(s.payload, null, 2)}</pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>RYO exhibits ({run.calls.length})</h2>
          <div className="scroll" style={{ maxHeight: 560 }}>
            <table>
              <thead><tr><th>#</th><th>Tool / args</th><th>Source</th><th>as_of</th><th>sha256</th></tr></thead>
              <tbody>
                {run.calls.map((c, i) => (
                  <tr key={i} className="click" onClick={() => onInspect(c)}>
                    <td className="mono">RYO-{String(i + 1).padStart(2, "0")}</td>
                    <td className="small"><span className="mono">{c.tool}</span><div className="faint">{JSON.stringify(c.args)}</div></td>
                    <td><Prov r={c} /> {c.envelope && <Badge k={c.envelope.status}>{c.envelope.status}</Badge>}</td>
                    <td className="small">{c.envelope?.as_of ?? "—"}</td>
                    <td className="hash">{short(c.envelope_sha256, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">"Coping with failure": in Live mode, each exhibit records the HTTP status and X-RateLimit headers, and why it fell back to a real snapshot (429, 503, timeout, offline, no key). Missing evidence stays marked unavailable.</p>
        </div>
      </div>
    </div>
  );
}
