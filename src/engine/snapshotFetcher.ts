import type { RyoFetcher, RyoResult, RyoTool } from "./ryo";
import { snapshotId } from "./ryo";

export interface SnapshotFile {
  captured_at: string;
  bundle_sha256: string;
  snapshots: {
    id: string;
    tool: RyoTool;
    args: Record<string, unknown>;
    captured_at: string;
    http_status: number;
    rate_limit: RyoResult["rate_limit"];
    ok: boolean;
    envelope: any;
    envelope_sha256: string | null;
  }[];
}

/** Serve real captured RYO responses. Unknown requests are reported unavailable — never invented. */
export function snapshotLookup(file: SnapshotFile, tool: RyoTool, args: Record<string, unknown>, reason: string | null): RyoResult {
  const s = file.snapshots.find((x) => x.id === snapshotId(tool, args) && x.ok);
  if (!s)
    return { tool, args, provenance: "unavailable", envelope: null, envelope_sha256: null, http_status: 0, rate_limit: null, fallback_reason: `${reason ? reason + "; " : ""}no captured snapshot for these arguments`, captured_at: null, latency_ms: 0 };
  return { tool, args, provenance: "snapshot", envelope: s.envelope, envelope_sha256: s.envelope_sha256, http_status: s.http_status, rate_limit: s.rate_limit, fallback_reason: reason, captured_at: s.captured_at, latency_ms: 0 };
}

export const snapshotFetcher = (file: SnapshotFile, reason: string | null = "replay mode"): RyoFetcher => async (tool, args) => snapshotLookup(file, tool, args, reason);
