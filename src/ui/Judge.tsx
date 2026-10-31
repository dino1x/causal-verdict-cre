// Judge path: every requirement of the three prizes, each mapped to the tab, file or transaction that proves it.
import type { RunResult } from "../engine/pipeline";
import { roundTrip, DEFAULT_MANDATE } from "../engine/legalAstCompiler";
import { ledgerHead, type Ledger } from "../engine/ledger";
import ledgerSnap from "../data/ledgerSnapshot.json";
import battery from "../data/batteryReport.json";
import witnesses from "../data/witnesses.json";
import { Badge } from "./common";
import { Icon } from "./icons";

const TX = {
  vaultDeploy: "https://sepolia.etherscan.io/tx/0x4cca438a56f868df390340092d08f3e76716e1319ec4643a8b21d0143b82925a",
  vault: "https://sepolia.etherscan.io/address/0xb86d25cd0317de545c8573f040a589c34a093544",
  creReport: "https://sepolia.etherscan.io/tx/0xea20a213693990660226b817c94b85ea4c1b6e7bc66c409e5fb4d36797c81cc6",
  x402: "https://sepolia.basescan.org/tx/0x0406f0749a6958723822ebf24cd3d85376f11ca13ef0c01bbba63bf9daa04bf7",
  chainlinkReport: "https://sepolia.etherscan.io/tx/0xc4e4dd3024e12a24c99c7918fa70880fa9dd05b3a05135cbc96a13ff7588547f",
  mandateActivation: "https://sepolia.etherscan.io/tx/0x3ec3beb1a5519c213d14eed5003bb5fcc599fea4616949f0a3a7cd5ed0ba07c7",
};

type Row = { what: string; weight?: string; built: string; tab?: string; proof?: { label: string; href: string }[] };

export function JudgeView({ run, go }: { run: RunResult | null; go: (tab: string) => void }) {
  const calls = run?.calls ?? [];
  const tools = new Set(calls.map((c) => c.tool));
  const mix = run ? Object.entries(run.provenanceMix).map(([k, n]) => `${n} ${k}`).join(" · ") : "—";
  const rt = roundTrip(DEFAULT_MANDATE);
  const ledger = ledgerSnap as unknown as Ledger;
  const w = witnesses as { head: string; at: string }[];
  const b = battery as { total: number; missedWithWitness: number };
  const headWitnessed = w.some((x) => x.head === ledgerHead(ledger));

  const ryo: Row[] = [
    { what: "Combining sources", weight: "20%", built: `Every run chains all six RYO tools (${tools.size}/6 in this run, ${calls.length} calls: ${mix}) — scan_market → compare_tokens → analyze_token → deep_analysis, framed by market_overview and monitor_market_sentiment_shift — with on-chain whale transfers, Whale Alert, news (RSS, Telegram, Tavily), Telegram voices, an exchange plane (candles, funding, open interest) and a Chainlink reference price, into one gated decision.`, tab: "Causality" },
    { what: "Coping with failure", weight: "20%", built: "Server proxy reads X-RateLimit-*; circuit breaker honours Retry-After; every failure falls back to a real captured RYO envelope labelled with its reason, never a placeholder; partial lanes stay partial and null stays null. The autonomous loop paces itself to RYO's 6/min fanout limit. Try the Chaos menu (429, 503, timeout, offline).", tab: "Verdict" },
    { what: "Real thinking", weight: "25%", built: "Bull and Bear argue from the same structured RYO fields, each claim citing the exact field; the Judge cannot override a binding mandate gate. Claude Opus 5.5 adds an advisory debate whose claims must cite allowed evidence paths (uncited ones are dropped and counted).", tab: "Debate" },
    { what: "Cause and effect", weight: "20%", built: "Whale lead-lag forensics (accumulation before KOL convergence, exchange deposits after it), echo collapse of copied posts, catalyst verification against primary sources and RYO's own profile, and a Why column for every candidate in every ledger run.", tab: "Causality" },
    { what: "Repeatability", weight: "10%", built: "Hash-chained reasoning trace; Replay on the recorded envelopes reproduces the identical root. The practice-trade ledger is hash-chained, its head is witnessed in git, Bitcoin and Sigstore, and an attack battery publishes what the verifier catches.", tab: "Audit" },
    { what: "Advanced execution", weight: "5%", built: "Entry, size, stop, two dip tranches, two targets and a 72h time stop are one atomic object, then anchored on-chain by a Chainlink CRE workflow.", tab: "CRE + x402", proof: [{ label: "CRE report on Sepolia", href: TX.creReport }] },
  ];
  const cre: Row[] = [
    { what: "CRE workflow (@chainlink/cre-sdk) connecting a chain with external APIs and an AI agent", built: "Cron trigger (automated risk monitoring) and HTTP trigger (x402-gated); RYO read through Confidential HTTP with a Vault-DON secret; mandate evaluated; ABI-encoded report; EVMClient.writeReport to the vault.", tab: "CRE + x402" },
    { what: "Chainlink Data Feeds inside the workflow", built: "The workflow reads SOL/USD from the Chainlink aggregator on Ethereum mainnet (EVMClient.callContract, last finalized block) and refuses to act on a RYO price it does not confirm (mandate clause 16, UPIA §2(d) duty to verify).", proof: [{ label: "verdict written after the Chainlink check", href: TX.chainlinkReport }] },
    { what: "Successful CRE CLI simulation", built: "Official `cre workflow simulate` (CLI v1.39.0) for both triggers, and a `--broadcast` run that wrote a verdict to the Sepolia vault.", proof: [{ label: "report tx", href: TX.creReport }, { label: "vault", href: TX.vault }] },
    { what: "AI agents consuming CRE workflows with x402 payments", built: "An agent pays 0.01 USDC per verdict; the gateway settles through the public x402 facilitator before serving it, and forwards the CRE HTTP-trigger payload.", proof: [{ label: "settled payment on Base Sepolia", href: TX.x402 }] },
    { what: "AI-assisted workflow generation", built: "Plain-English risk intent → mandate draft → compiler validation → generated CRE config and gate source.", tab: "CRE + x402" },
  ];
  const bli: Row[] = [
    { what: "Fiduciary mandate as code (UPIA §2, §3)", built: `16 clauses, each anchored to its legal source (UPIA §2(d) for the new price-verification clause, activated on the vault by an owner transaction). Controlled-language compiler with a deterministic decompiler; prose → AST → prose is a tested fixpoint (${rt.ok ? "verified now" : "FAILED"}). The same AST drives the Judge, the x402 gateway and the on-chain workflow, and the vault checks its hash.`, tab: "Mandate" },
    { what: "Anti-touting and market-manipulation controls (Securities Act §17(b), MiCA Art. 91–92)", built: "Touting and exit-liquidity detectors are binding gates; a draft STOR for a reporting entity's compliance review is generated only when one fires, with its scope stated.", tab: "Debate" },
    { what: "Evidence a lawyer can use (FRE 902(13)/(14))", built: "Hash-identified exhibits, a replayable machine-generated trace, the 902(11) notice requirement, stated limits, and a draft certification for a qualified person.", tab: "Audit" },
  ];

  const Table = ({ rows }: { rows: Row[] }) => (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.what}>
            <td style={{ width: "26%" }}><b>{r.what}</b>{r.weight && <div className="small muted">{r.weight}</div>}</td>
            <td className="small">{r.built}</td>
            <td style={{ width: 170 }}>
              {r.tab && <button className="btn" onClick={() => go(r.tab!)}>Show me →</button>}
              {r.proof?.map((p) => <div key={p.href} className="small"><a href={p.href} target="_blank" rel="noreferrer">{p.label} ↗</a></div>)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="hero">
        <div className="eyebrow">BLI Legal Tech Hackathon 2 · RYO-CHAN · Chainlink CRE · LegalTech</div>
        <h2>Built on RYO, not around it.</h2>
        <p>
          An autonomous practice-trade agent that reads all six RYO-CHAN MCP tools, checks them against exchanges, Chainlink Data Feeds and public evidence, argues both sides, obeys a compiled fiduciary mandate, and anchors every verdict on-chain through a Chainlink CRE workflow. Without a key it replays {calls.length} real captured RYO responses, hashed and labelled.
        </p>
        <div className="kpis">
          <div className="kpi">
            <div className="stat-l">RYO tools in this run</div>
            <div className="stat">{tools.size}<span className="faint" style={{ fontSize: 16 }}> / 6</span></div>
            <div className="small muted">{calls.length} calls · {mix}</div>
          </div>
          <div className="kpi">
            <div className="stat-l">Attack battery</div>
            <div className={`stat ${b.missedWithWitness ? "err" : "ok"}`}>{b.missedWithWitness}<span className="faint" style={{ fontSize: 16 }}> missed / {b.total}</span></div>
            <div className="small muted">tamper attempts on ledger and trace</div>
          </div>
          <div className="kpi">
            <div className="stat-l">Mandate</div>
            <div className="stat">{rt.ok ? "fixpoint" : "broken"}</div>
            <div className="small muted">prose ⇄ AST round-trip, legal anchors per clause</div>
          </div>
          <div className="kpi">
            <div className="stat-l">Ledger head</div>
            <div className="stat" style={{ fontSize: 20, marginTop: 8 }}><Badge k={headWitnessed ? "pass" : "partial"}>{headWitnessed ? "witnessed · git · Bitcoin" : "advanced since last witness"}</Badge></div>
            <div className="small muted">hourly Sigstore signing in the public Action</div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div className="stat-l" style={{ marginBottom: 8 }}>On-chain proofs</div>
          <a className="pill-link" href={TX.vaultDeploy} target="_blank" rel="noreferrer"><Icon.chain size={13} /> Vault on Sepolia</a>
          <a className="pill-link" href={TX.creReport} target="_blank" rel="noreferrer"><Icon.bolt size={13} /> CRE report</a>
          <a className="pill-link" href={TX.chainlinkReport} target="_blank" rel="noreferrer"><Icon.check size={13} /> Chainlink-checked verdict</a>
          <a className="pill-link" href={TX.mandateActivation} target="_blank" rel="noreferrer"><Icon.mandate size={13} /> Mandate activation</a>
          <a className="pill-link" href={TX.x402} target="_blank" rel="noreferrer"><Icon.external size={13} /> x402 payment on Base</a>
          <button className="pill-link" onClick={() => go("Audit")} style={{ cursor: "pointer" }}><Icon.audit size={13} /> Replay it yourself</button>
        </div>
      </section>
      <div className="card"><h2>RYO-CHAN · Autonomous Agents (official rubric)</h2><Table rows={ryo} /></div>
      <div className="card"><h2>Chainlink · Best workflow with CRE</h2><Table rows={cre} /></div>
      <div className="card"><h2>BLI · LegalTech &amp; RegTech</h2><Table rows={bli} /></div>
      <div className="card">
        <h2>What it does not claim</h2>
        <ul className="small">
          <li>Practice trades only: nothing is bought or sold, and RYO's tools are read-only.</li>
          <li>The CRE report went through the simulator's broadcast path (MockKeystoneForwarder); a production DON deployment needs CRE deploy access.</li>
          <li>X is read through user-pasted posts (its API is paid); Telegram channels, RSS and on-chain transfers are read natively.</li>
          <li>The exit-liquidity trap fires on the labelled scenario fixtures; on the real feeds captured so far it has not fired, and the app says so.</li>
          <li>The ledger shows what was decided and why. It does not show that a decision was right, and short-term P&amp;L is not the point.</li>
        </ul>
      </div>
    </div>
  );
}
