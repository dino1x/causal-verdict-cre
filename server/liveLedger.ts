// Keeps the hosted app's ledger current without redeploying. The hourly agent commits the ledger with [skip render],
// so this server's own copy only updates on code deploys. Every few minutes we ask GitHub for the newest commit on
// main (from git's own ref listing) and read the ledger and its witness list *at that commit* (a pinned commit never changes, so the two can
// never disagree). A candidate replaces what we serve only if its hash chain verifies, its head is in its own witness
// list, and it does not shrink the ledger. Anything else (GitHub down, rate limited, a bad commit) keeps the last good one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ledgerHead, verifyLedger, type Ledger } from "../src/engine/ledger";

export interface Witness { at: string; head: string; runs: number; events: number; file: string }

const REPO = process.env.GITHUB_REPOSITORY ?? "dino1x/causal-verdict-cre";
const EVERY_MS = 5 * 60_000;

const state = {
  ledger: JSON.parse(readFileSync(join(process.cwd(), "src/data/ledgerSnapshot.json"), "utf8")) as Ledger,
  witnesses: JSON.parse(readFileSync(join(process.cwd(), "src/data/witnesses.json"), "utf8")) as Witness[],
  commit: null as string | null, // null: the copy this server was deployed with
  checkedAt: null as string | null,
  lastError: null as string | null,
};
const rejected = new Set<string>();

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { headers: { "User-Agent": "causal-verdict" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
  return r;
}

/** Why a candidate may not replace the current ledger, or null when it may. */
export function rejectReason(ledger: Ledger, witnesses: Witness[], current: Ledger): string | null {
  if (!ledger?.runs || !ledger?.events || !Array.isArray(witnesses)) return "malformed files";
  const v = verifyLedger(ledger);
  if (!v.ok) return `hash chain broken (${v.part} ${v.brokenAt})`;
  const head = ledgerHead(ledger);
  if (!witnesses.some((w) => w.head === head)) return `head ${head.slice(0, 10)}… is not in its witness list`;
  if (ledger.runs.length < current.runs.length || ledger.events.length < current.events.length) return "shorter than the ledger already served";
  return null;
}

export async function refreshLiveLedger(): Promise<void> {
  try {
    // The git endpoint (what `git ls-remote` reads), not api.github.com: hosting IPs are shared, and the anonymous
    // API quota is often spent by other tenants before we ask.
    const refs = await (await get(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`)).text();
    const sha = refs.match(/([0-9a-f]{40}) refs\/heads\/main\b/)?.[1] ?? "";
    state.checkedAt = new Date().toISOString();
    if (!/^[0-9a-f]{40}$/.test(sha) || sha === state.commit || rejected.has(sha)) return;
    const raw = (p: string) => get(`https://raw.githubusercontent.com/${REPO}/${sha}/${p}`).then((r) => r.json());
    const [ledger, witnesses] = await Promise.all([raw("src/data/ledgerSnapshot.json"), raw("src/data/witnesses.json")]);
    const why = rejectReason(ledger, witnesses, state.ledger);
    if (why) {
      rejected.add(sha);
      state.lastError = `commit ${sha.slice(0, 7)} not served: ${why}`;
      return;
    }
    Object.assign(state, { ledger, witnesses, commit: sha, lastError: null });
  } catch (e) {
    state.lastError = String((e as Error).message ?? e).slice(0, 160);
  }
}

export function liveLedger() {
  return {
    ledger: state.ledger,
    witnesses: state.witnesses,
    commit: state.commit,
    source: state.commit ? `GitHub main @ ${state.commit.slice(0, 7)}, verified on the server` : "the copy deployed with this server (src/data/ledgerSnapshot.json)",
    checkedAt: state.checkedAt,
    lastError: state.lastError,
  };
}

/** Proof files for heads newer than this deploy are not on disk: they live in the repo at the served commit. */
export function witnessUrl(path: string): string | null {
  return state.commit ? `https://raw.githubusercontent.com/${REPO}/${state.commit}/witness/${path}` : null;
}

export function startLiveLedger(): void {
  setTimeout(refreshLiveLedger, 5_000).unref();
  setInterval(refreshLiveLedger, EVERY_MS).unref();
}
