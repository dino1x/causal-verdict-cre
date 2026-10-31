// Judge path: every requirement of the three prizes, each mapped to the tab, file or transaction that proves it.
import type { RunResult } from "../engine/pipeline";
import { roundTrip, DEFAULT_MANDATE } from "../engine/legalAstCompiler";
import { ledgerHead, type Ledger } from "../engine/ledger";
import ledgerSnap from "../data/ledgerSnapshot.json";
import battery from "../data/batteryReport.json";
import witnesses from "../data/witnesses.json";
import { Badge } from "./common";
import { BuiltOn, HowItWorks, ProofTiles, VerdictConsole } from "./Overview";

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
            <td style={{ width: "26%" }}><div style={{ fontWeight: 500 }}>{r.what}</div>{r.weight && <div className="stat-l">{r.weight} of score</div>}</td>
            <td className="small">{r.built}</td>
            <td style={{ width: 190, textAlign: "right" }}>
              {r.tab && <button className="btn" onClick={() => go(r.tab!)}>Open {r.tab} →</button>}
              {r.proof?.map((p) => <div key={p.href} className="small"><a href={p.href} target="_blank" rel="noreferrer">{p.label} ↗</a></div>)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="hero">
        <div className="hero-pill"><span className="dot" /> Built for BLI Legal Tech Hackathon 2</div>
        <h2>An agent built on RYO, <em>not around it</em></h2>
        <p>
          It reads all six RYO-CHAN MCP tools, checks them against exchanges, Chainlink Data Feeds and public evidence, argues both sides, obeys a compiled fiduciary mandate, and anchors every verdict on-chain.
        </p>
        <div className="cta">
          <button className="btn primary" onClick={() => go("Verdict")}>See the verdict</button>
          <button className="btn" onClick={() => go("Audit")}>Replay it yourself</button>
        </div>
        {run && <VerdictConsole run={run} onOpen={() => go("Verdict")} />}
      </section>

      <BuiltOn />

      <div className="section-head"><div><div className="eyebrow">/how it works</div><h3>From evidence to a verdict you can check</h3></div></div>
      <HowItWorks />

      <div className="section-head"><div><div className="eyebrow">/numbers</div><h3>Measured, not claimed</h3></div></div>
      <div className="kpis">
        <div className="kpi">
          <div className="stat-l">/ryo tools this run</div>
          <div className="stat">{tools.size}<span className="faint"> / 6</span></div>
          <div className="small muted">{calls.length} calls · {mix}</div>
        </div>
        <div className="kpi">
          <div className="stat-l">/attack battery</div>
          <div className={`stat ${b.missedWithWitness ? "err" : ""}`}>{b.missedWithWitness}<span className="faint"> of {b.total}</span></div>
          <div className="small muted">tamper attempts missed, ledger and trace</div>
        </div>
        <div className="kpi">
          <div className="stat-l">/mandate</div>
          <div className="stat">16<span className="faint"> clauses</span></div>
          <div className="small muted">{rt.ok ? "prose ⇄ AST round-trip holds" : "round-trip broken"}, each anchored in law</div>
        </div>
        <div className="kpi">
          <div className="stat-l">/ledger head</div>
          <div className="stat">{headWitnessed ? "Witnessed" : "Advancing"}</div>
          <div className="small muted">{headWitnessed ? "git · Bitcoin block 973,943" : "runs recorded since the last stamp"}</div>
        </div>
      </div>

      <div className="section-head"><div><div className="eyebrow">/on-chain</div><h3>Every claim has a transaction</h3></div></div>
      <ProofTiles
        tiles={[
          { label: "Vault", sub: "Sepolia · deployed", href: TX.vaultDeploy },
          { label: "CRE report", sub: "written by the workflow", href: TX.creReport },
          { label: "Chainlink check", sub: "price verified in CRE", href: TX.chainlinkReport },
          { label: "Mandate", sub: "activated by the owner", href: TX.mandateActivation },
          { label: "x402", sub: "USDC settled on Base", href: TX.x402 },
        ]}
      />

      <div className="section-head"><div><div className="eyebrow">/ryo-chan · autonomous agents</div><h3>The official rubric, line by line</h3></div></div>
      <div className="card"><Table rows={ryo} /></div>
      <div className="section-head"><div><div className="eyebrow">/chainlink · best workflow with cre</div><h3>The workflow, on-chain</h3></div></div>
      <div className="card"><Table rows={cre} /></div>
      <div className="section-head"><div><div className="eyebrow">/bli · legaltech and regtech</div><h3>Duties written as code</h3></div></div>
      <div className="card"><Table rows={bli} /></div>
      <div className="section-head"><div><div className="eyebrow">/limits</div><h3>What it does not claim</h3></div></div>
      <div className="card">
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
