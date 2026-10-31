// Overview: what the agent is, what it has proved on-chain, and where each capability can be checked.
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

export function HomeView({ run, go }: { run: RunResult | null; go: (tab: string) => void }) {
  const calls = run?.calls ?? [];
  const tools = new Set(calls.map((c) => c.tool));
  const mix = run ? Object.entries(run.provenanceMix).map(([k, n]) => `${n} ${k}`).join(" · ") : "—";
  const rt = roundTrip(DEFAULT_MANDATE);
  const ledger = ledgerSnap as unknown as Ledger;
  const w = witnesses as { head: string; at: string }[];
  const b = battery as { total: number; missedWithWitness: number };
  const headWitnessed = w.some((x) => x.head === ledgerHead(ledger));

  const ryo: Row[] = [
    { what: "Combining sources", weight: "20%", built: `All six RYO tools (${calls.length} calls) chained with whale transfers, news, voices, exchange data and a Chainlink price into one decision.`, tab: "Causality" },
    { what: "Coping with failure", weight: "20%", built: "Rate-limit aware, circuit breaker, labelled fallback to real RYO snapshots. Null stays null. Try the Chaos menu.", tab: "Verdict" },
    { what: "Real thinking", weight: "25%", built: "Bull and Bear cite exact RYO fields; a mandate-bound judge rules. Claude adds a citation-checked second opinion.", tab: "Debate" },
    { what: "Cause and effect", weight: "20%", built: "Whale lead-lag, copied-post collapse, catalyst checks, and a reason for every rejected candidate.", tab: "Causality" },
    { what: "Repeatability", weight: "10%", built: "Hash-chained trace that replays exactly; a ledger witnessed in git, Bitcoin and Sigstore.", tab: "Audit" },
    { what: "Advanced execution", weight: "5%", built: "Entry, size, stop, tranches, targets and time stop as one object, anchored by Chainlink CRE.", tab: "Verdict", proof: [{ label: "CRE report", href: TX.creReport }] },
  ];
  const cre: Row[] = [
    { what: "CRE workflow", built: "Cron and x402-gated HTTP triggers, RYO over Confidential HTTP, mandate in the workflow, report written to the vault.", tab: "CRE + x402" },
    { what: "Chainlink Data Feeds", built: "The workflow reads SOL/USD on-chain and refuses a RYO price it can't confirm.", proof: [{ label: "Chainlink-checked verdict", href: TX.chainlinkReport }] },
    { what: "CLI simulation", built: "`cre workflow simulate` passes for both triggers; a broadcast run wrote to Sepolia.", proof: [{ label: "report", href: TX.creReport }, { label: "vault", href: TX.vault }] },
    { what: "x402 payments", built: "Agents pay 0.01 USDC per verdict, settled on Base before it is served.", proof: [{ label: "settled payment", href: TX.x402 }] },
    { what: "AI-assisted generation", built: "Plain-English intent becomes a validated mandate and a CRE config.", tab: "CRE + x402" },
  ];
  const bli: Row[] = [
    { what: "Fiduciary mandate", built: `16 clauses anchored in UPIA, compiled from prose and back (round-trip ${rt.ok ? "holds" : "broken"}). The vault checks its hash.`, tab: "Mandate" },
    { what: "Market-abuse controls", built: "Touting and exit-liquidity gates (§17(b), MiCA Art. 91–92), with a draft STOR when one fires.", tab: "Debate" },
    { what: "Evidence package", built: "Hash-identified exhibits and a replayable trace, with an FRE 902(13)/(14) certification draft.", tab: "Audit" },
  ];

  const Table = ({ rows }: { rows: Row[] }) => (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.what}>
            <td style={{ width: "26%" }}><div style={{ fontWeight: 500 }}>{r.what}</div>{r.weight && <div className="stat-l">{r.weight}</div>}</td>
            <td className="small">{r.built}</td>
            <td style={{ width: 190, textAlign: "right" }}>
              {r.tab && <button className="btn" onClick={() => go(r.tab!)}>Open {r.tab === "CRE + x402" ? "CRE · x402" : r.tab} →</button>}
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

      <div className="section-head"><div><div className="eyebrow">/ryo-chan · autonomous agents</div><h3>How the agent decides</h3></div></div>
      <div className="card"><Table rows={ryo} /></div>
      <div className="section-head"><div><div className="eyebrow">/chainlink · best workflow with cre</div><h3>The workflow, on-chain</h3></div></div>
      <div className="card"><Table rows={cre} /></div>
      <div className="section-head"><div><div className="eyebrow">/bli · legaltech and regtech</div><h3>Duties written as code</h3></div></div>
      <div className="card"><Table rows={bli} /></div>
      <div className="section-head"><div><div className="eyebrow">/limits</div><h3>What it does not claim</h3></div></div>
      <div className="card">
        <ul className="small">
          <li>Practice trades only; nothing is bought or sold.</li>
          <li>CRE reports use the simulator's broadcast path, not a production DON.</li>
          <li>X posts are pasted in; the X API is paid.</li>
          <li>The exit-liquidity trap has fired only on the labelled scenario so far.</li>
          <li>The ledger shows what was decided and why, not that it was right.</li>
        </ul>
      </div>
    </div>
  );
}
