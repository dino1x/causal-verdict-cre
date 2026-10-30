// Browser fetchers. The browser never sees RYO_MCP_KEY: live calls go to our /api/ryo proxy.
import type { RyoFetcher, RyoResult } from "../engine/ryo";
import { snapshotLookup, type SnapshotFile } from "../engine/snapshotFetcher";
import snapshotsJson from "../data/ryoLiveSnapshots.json";

export const SNAPSHOTS = snapshotsJson as unknown as SnapshotFile;

export type Mode = "replay" | "live";
export type Chaos = "none" | "429" | "503" | "timeout" | "offline";

export function makeFetcher(mode: Mode, chaos: Chaos): RyoFetcher {
  if (mode === "replay") return async (tool, args) => snapshotLookup(SNAPSHOTS, tool, args, "replay mode");
  return async (tool, args): Promise<RyoResult> => {
    try {
      const r = await fetch("/api/ryo/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args, chaos: chaos === "none" ? null : chaos }),
      });
      if (!r.ok) throw new Error(`proxy HTTP ${r.status}`);
      return (await r.json()) as RyoResult;
    } catch (e) {
      // Static hosting / proxy down: fall back to the bundled real snapshots, and say so.
      return snapshotLookup(SNAPSHOTS, tool, args, `proxy unreachable (${String((e as Error).message)})`);
    }
  };
}

export interface ProxyStatus {
  configured: boolean;
  endpoint: string | null;
  whoami: { key_id?: string; label?: string; rate_limit_per_min?: number; rate_limit_remaining?: number; expires_at?: string; tools?: string[]; allowed?: boolean; error?: string } | null;
  lastRate: { limit: string | null; remaining: string | null; reset: string | null; at: string | null };
  snapshot: { captured_at: string; count: number; bundle_sha256: string };
}

export async function getStatus(): Promise<ProxyStatus | null> {
  try {
    const r = await fetch("/api/ryo/status");
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
