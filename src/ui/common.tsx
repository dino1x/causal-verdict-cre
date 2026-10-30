import { useState, type ReactNode } from "react";
import type { RyoResult } from "../engine/ryo";
import { canonical } from "../engine/ryo";
import { hashHex } from "../engine/pipeline";

export const Badge = ({ k, children, title }: { k: string; children: ReactNode; title?: string }) => (
  <span className={`badge b-${k}`} title={title}>
    {children}
  </span>
);

export const Prov = ({ r }: { r: Pick<RyoResult, "provenance" | "fallback_reason" | "captured_at"> }) => (
  <Badge k={r.provenance} title={r.fallback_reason ? `fallback: ${r.fallback_reason}` : r.captured_at ? `captured ${r.captured_at}` : undefined}>
    {r.provenance === "live" ? "● LIVE RYO" : r.provenance === "snapshot" ? "◆ RYO SNAPSHOT" : "✕ UNAVAILABLE"}
  </Badge>
);

export const Fixture = () => (
  <Badge k="fixture" title="Scenario fixture — illustrative evidence, not RYO and not live">
    FIXTURE
  </Badge>
);

export const short = (h: string | null | undefined, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");

export function EnvelopeInspector({ r, onClose }: { r: RyoResult; onClose: () => void }) {
  const recomputed = r.envelope ? hashHex(canonical(r.envelope)).slice(2) : null;
  const match = recomputed && r.envelope_sha256 === recomputed;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
      <div className="card" style={{ width: "min(980px, 100%)", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 style={{ margin: 0 }}>
            {r.tool} <span className="mono faint">{JSON.stringify(r.args)}</span>
          </h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="row" style={{ margin: "10px 0" }}>
          <Prov r={r} />
          {r.envelope && <Badge k={r.envelope.status}>status: {r.envelope.status}</Badge>}
          {r.envelope && <span className="badge faint">data_mode: {r.envelope.data_mode}</span>}
          {r.envelope && <span className="badge faint">as_of: {r.envelope.as_of}</span>}
          {r.rate_limit?.remaining != null && <span className="badge faint">X-RateLimit-Remaining: {r.rate_limit.remaining}/{r.rate_limit.limit}</span>}
        </div>
        {r.fallback_reason && <div className="notice" style={{ marginBottom: 10 }}><b>Fallback:</b> {r.fallback_reason}</div>}
        <div className="small" style={{ marginBottom: 8 }}>
          SHA-256 (key-sorted JSON): <span className="hash">{r.envelope_sha256 ?? "—"}</span>{" "}
          {r.envelope && <Badge k={match ? "pass" : "fail"}>{match ? "re-hashed in your browser ✓" : "hash mismatch"}</Badge>}
        </div>
        <pre className="code">{r.envelope ? JSON.stringify(r.envelope, null, 2) : "No envelope. Evidence is unavailable — it is shown as missing, never as zero."}</pre>
      </div>
    </div>
  );
}

export function useInspector() {
  const [r, setR] = useState<RyoResult | null>(null);
  return { open: setR, node: r ? <EnvelopeInspector r={r} onClose={() => setR(null)} /> : null };
}

export function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
