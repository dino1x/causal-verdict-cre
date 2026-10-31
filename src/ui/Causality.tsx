import { useState } from "react";
import type { RunResult, TokenDossier } from "../engine/pipeline";
import type { KolPost } from "../data/scenarioFixtures";
import { KOL_POSTS } from "../data/scenarioFixtures";
import { Badge, Fixture } from "./common";

export function TokenPicker({ run, focus, setFocus }: { run: RunResult; focus: string; setFocus: (s: string) => void }) {
  return (
    <div className="seg">
      {run.dossiers.map((d) => (
        <button key={d.symbol} className={focus === d.symbol ? "on" : ""} onClick={() => setFocus(d.symbol)}>
          {d.symbol} {d.judgment.decision === "SELECT" ? "✓" : "✕"}
        </button>
      ))}
    </div>
  );
}

function Timeline({ d }: { d: TokenDossier }) {
  const pts = [...d.whale.events.map((e) => e.minutes), ...d.narrative.posts.map((p) => p.minutes), 0];
  const lo = Math.min(-60, ...pts) - 10;
  const hi = 10;
  const W = 1000, H = 230, L = 90, R = 20;
  const x = (m: number) => L + ((m - lo) / (hi - lo)) * (W - L - R);
  const rows = { whale: 50, kol: 105, news: 150, ryo: 190 };
  const T0 = d.narrative.convergenceAt;
  const ticks: number[] = [];
  const step = hi - lo > 300 ? 60 : 15;
  for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) ticks.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Lead-lag timeline for ${d.symbol}`}>
      {ticks.map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={25} y2={H - 20} stroke="var(--line)" />
          <text x={x(m)} y={H - 6} fontSize="11" fill="var(--faint)" textAnchor="middle">{m === 0 ? "T (RYO as_of)" : `${m}m`}</text>
        </g>
      ))}
      {Object.entries(rows).map(([k, y]) => (
        <text key={k} x={8} y={y + 4} fontSize="12" fill="var(--muted)">{{ whale: "Whale flows", kol: "KOL posts", news: "News", ryo: "RYO reads" }[k]}</text>
      ))}
      {T0 !== null && (
        <g>
          <rect x={x(T0)} y={22} width={Math.max(2, x(Math.min(hi, T0 + 90)) - x(T0))} height={H - 44} fill="var(--bear)" opacity={d.whale.trap ? 0.08 : 0.03} />
          <line x1={x(T0)} x2={x(T0)} y1={20} y2={H - 20} stroke="var(--warn)" strokeWidth={2} strokeDasharray="4 3" />
          <text x={x(T0) + 4} y={16} fontSize="11.5" fill="var(--warn)">T₀ KOL convergence ({T0}m)</text>
        </g>
      )}
      {d.whale.events.map((e) => {
        const acc = e.kind === "dex_buy" || e.kind === "exchange_withdrawal";
        const cx = x(e.minutes);
        return (
          <g key={e.id}>
            <circle cx={cx} cy={rows.whale} r={4 + Math.min(10, e.usd / 6e5)} fill={acc ? "var(--bull)" : "var(--bear)"} opacity={0.8}>
              <title>{`${e.wallet} ${e.kind} $${(e.usd / 1e6).toFixed(2)}M at ${e.minutes}m`}</title>
            </circle>
            <text x={cx} y={rows.whale - 16} fontSize="10" fill="var(--faint)" textAnchor="middle">{acc ? "▲" : "▼"}{e.wallet.slice(-1)}</text>
          </g>
        );
      })}
      {d.narrative.posts.map((p) => (
        <circle key={p.id} cx={x(p.minutes)} cy={rows.kol + ((p.cluster * 7) % 21) - 10} r={5} fill={p.sentiment > 0 ? "var(--bull)" : p.sentiment < 0 ? "var(--bear)" : "var(--muted)"} stroke={p.urgency > 0.3 ? "var(--warn)" : "none"} strokeWidth={2} opacity={0.85}>
          <title>{`${p.handle} (${p.minutes}m) cluster ${p.cluster}: ${p.text}`}</title>
        </circle>
      ))}
      {d.news.claims.length > 0 &&
        d.narrative.claims.length > 0 && (
          <text x={L} y={rows.news + 4} fontSize="11.5" fill="var(--muted)">
            {d.news.claims.map((c) => `${c.claim}: ${c.verdict}`).join("  ·  ")}
          </text>
        )}
      <circle cx={x(0)} cy={rows.ryo} r={6} fill="var(--snap)" />
      <text x={x(0) - 8} y={rows.ryo + 4} fontSize="11" fill="var(--snap)" textAnchor="end">analyze/deep_analysis</text>
    </svg>
  );
}

function CausalChain({ d }: { d: TokenDossier }) {
  const failed = d.judgment.failedGates;
  const nodes: { label: string; tone: "bull" | "bear" | "muted" }[] = [];
  if (d.whale.preConvergenceAccumulators.length) nodes.push({ label: `Whales accumulate ${d.whale.leadMin}m before T₀`, tone: "bear" });
  else if (d.whale.netExchangeFlowUsd !== null && d.whale.netExchangeFlowUsd < 0) nodes.push({ label: "Whales withdraw from exchanges (absorbing)", tone: "bull" });
  if (d.news.claims.length) nodes.push({ label: d.news.verifiedCatalyst ? "Catalyst verified" : "Catalyst unverified / rumor", tone: d.news.verifiedCatalyst ? "bull" : "bear" });
  if (d.narrative.posts.length) nodes.push({ label: `${d.narrative.posts.length} posts → ${d.narrative.independentVoices} independent voices${d.narrative.convergenceAt !== null ? " converge" : ""}`, tone: d.narrative.echoRatio >= 0.4 ? "bear" : "muted" });
  if (d.whale.trap) nodes.push({ label: `Deposits to exchanges ${d.whale.lagMin}m after T₀ → exit liquidity`, tone: "bear" });
  nodes.push({ label: `RYO: RSI ${d.evidence.rsi14 ?? "null"} · ATR ${d.evidence.atrPct ?? "null"}% · conf ${d.evidence.confluence ?? "—"}`, tone: "muted" });
  nodes.push({ label: failed.length ? `Mandate: ${failed.map((g) => g.id).join(", ")} fail` : "Mandate: all gates pass", tone: failed.length ? "bear" : "bull" });
  nodes.push({ label: d.judgment.decision, tone: d.judgment.decision === "SELECT" ? "bull" : "bear" });
  return (
    <div className="row" style={{ gap: 6 }}>
      {nodes.map((n, i) => (
        <span key={i} className="row" style={{ gap: 6 }}>
          <span className="badge" style={{ color: `var(--${n.tone === "muted" ? "muted" : n.tone})`, fontWeight: 500, padding: "3px 9px" }}>{n.label}</span>
          {i < nodes.length - 1 && <span className="faint">→</span>}
        </span>
      ))}
    </div>
  );
}

const toText = (posts: KolPost[]) => posts.map((p) => `${p.handle} | ${p.minutes} | ${p.text}`).join("\n");

const channelOf = (h: string): KolPost["channel"] => (h.startsWith("t.me/") ? "telegram" : h.startsWith("#") ? "discord" : "x");
const Src = ({ href }: { href?: string }) => (href ? <a href={href} target="_blank" rel="noreferrer" className="small">source ↗</a> : null);

export function CausalityView({ run, focus, setFocus, posts, setPosts, channels, setChannels }: { run: RunResult; focus: string; setFocus: (s: string) => void; posts: KolPost[]; setPosts: (p: KolPost[]) => void; channels: string[]; setChannels: (c: string[]) => void }) {
  const d = run.dossiers.find((x) => x.symbol === focus) ?? run.dossiers[0];
  const real = run.evidenceMode === "real";
  const Tag = () => (real ? <Badge k="live">REAL FEED</Badge> : <Fixture />);
  const [chDraft, setChDraft] = useState(channels.join(", "));
  const [draft, setDraft] = useState(posts === KOL_POSTS ? "" : toText(posts));
  const [msg, setMsg] = useState<string | null>(null);
  const apply = () => {
    const out: KolPost[] = [];
    const bad: number[] = [];
    draft.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      const [h, m, ...rest] = line.split("|").map((s) => s.trim());
      if (!h || !Number.isFinite(Number(m)) || Number(m) > 0 || !rest.length) return bad.push(i + 1);
      out.push({ id: `u${i}`, handle: h, channel: channelOf(h), minutes: Number(m), text: rest.join("|") });
    });
    if (bad.length) return setMsg(`Lines ${bad.join(", ")} need "handle | minutes (≤ 0) | text".`);
    if (new Set(out.map((p) => p.handle)).size > 20) return setMsg("At most 20 voices.");
    setPosts(out.length ? out : KOL_POSTS);
    setMsg(`Loaded ${out.length} posts — press "Run agent" to re-evaluate.`);
  };
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="spread">
        <TokenPicker run={run} focus={d.symbol} setFocus={setFocus} />
        <span className="small muted">{real ? <>Whale, news and KOL lanes come from <b>real public feeds</b>, each item linked. RYO reads are real.</> : <>Whale, KOL and news lanes are <Fixture /> evidence. RYO reads are real.</>}</span>
      </div>
      <div className="card">
        <h2>Temporal lead-lag forensics — {d.symbol} {d.whale.trap ? <Badge k="fail">EXIT-LIQUIDITY TRAP</Badge> : <Badge k="pass">no trap pattern</Badge>}</h2>
        <Timeline d={d} />
        <p className="small muted" style={{ margin: "6px 0 10px" }}>{d.whale.detail}. Shaded band = the mandate's post-convergence window; ▲ accumulation, ▼ distribution; dot size ∝ USD.</p>
        <CausalChain d={d} />
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>Multi-KOL narrative radar — {d.symbol} <Tag /></h2>
          <div className="grid g4" style={{ gap: 8, marginBottom: 10 }}>
            <div><div className="stat-l">Posts / voices</div><div className="stat">{d.narrative.posts.length} / {d.narrative.voices}</div></div>
            <div><div className="stat-l">Independent</div><div className="stat">{d.narrative.independentVoices}</div></div>
            <div><div className="stat-l">Echo ratio</div><div className={`stat ${d.narrative.echoRatio >= 0.4 ? "err" : ""}`}>{(d.narrative.echoRatio * 100).toFixed(0)}%</div></div>
            <div><div className="stat-l">Wtd. sentiment</div><div className="stat">{d.narrative.weightedSentiment ?? "—"}</div></div>
          </div>
          <div className="scroll" style={{ maxHeight: 340 }}>
            <table>
              <thead><tr><th>Voice</th><th className="num">t</th><th>Post</th><th className="num">sent</th><th className="num">conv</th><th className="num">urg</th><th>echo</th></tr></thead>
              <tbody>
                {d.narrative.posts.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{p.handle}<div className="faint">{p.channel}</div></td>
                    <td className="num small">{p.minutes}m</td>
                    <td className="small">{p.text} <Src href={p.source} />{!p.disclosed && <div className="faint">no position/payment disclosure</div>}</td>
                    <td className={`num ${p.sentiment > 0 ? "ok" : p.sentiment < 0 ? "err" : ""}`}>{p.sentiment}</td>
                    <td className="num">{p.conviction}</td>
                    <td className="num">{p.urgency}</td>
                    <td className="small mono">#{p.cluster}</td>
                  </tr>
                ))}
                {!d.narrative.posts.length && <tr><td colSpan={7} className="muted">No monitored voice mentioned {d.symbol}.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="small muted">Echo clusters: posts with ≥50% word-trigram Jaccard overlap count once. Sentiment, conviction and urgency come from a fixed lexicon, so results are deterministic and auditable.</p>
        </div>
        <div className="card">
          <h2>News checker — {d.symbol}</h2>
          <table>
            <thead><tr><th>Claim in posts</th><th>Verdict</th><th>Basis</th></tr></thead>
            <tbody>
              {d.news.claims.map((c) => (
                <tr key={c.claim}>
                  <td>{c.claim}</td>
                  <td><Badge k={c.verdict === "verified_primary" || c.verdict === "corroborated_by_ryo" ? "pass" : c.verdict === "secondary_only" ? "partial" : "fail"}>{c.verdict}</Badge></td>
                  <td className="small">{c.basis}</td>
                </tr>
              ))}
              {!d.news.claims.length && <tr><td colSpan={3} className="muted">No catalyst claims to check.</td></tr>}
            </tbody>
          </table>
          {run.evidenceUsed.news.filter((n) => n.symbol === d.symbol).map((n) => (
            <div key={n.id} className="small" style={{ margin: "4px 0" }}>{n.minutes}m · {n.headline} <span className="faint">({n.sourceType})</span> <Src href={n.source.split(" — ")[1]} /></div>
          ))}
          <p className="small muted">A claim counts as verified only from a primary source or from RYO's own token-profile text (live research evidence). A secondary wire alone is not verification.</p>
          <h3>Whale wallet events <Tag /></h3>
          <table>
            <thead><tr><th>Wallet</th><th className="num">t</th><th>Kind</th><th className="num">USD</th><th>Counterparty</th></tr></thead>
            <tbody>
              {d.whale.events.map((e) => (
                <tr key={e.id}><td className="small mono">{e.wallet}</td><td className="num">{e.minutes}m</td><td className={e.kind === "dex_buy" || e.kind === "exchange_withdrawal" ? "ok" : "err"}>{e.kind}</td><td className="num">${(e.usd / 1e6).toFixed(2)}M</td><td className="small">{e.counterparty ?? "—"} <Src href={e.source} /></td></tr>
              ))}
              {!d.whale.events.length && <tr><td colSpan={5} className="muted">No whale-flow evidence{real ? ` (${run.feedSources.filter((s) => s.target.startsWith(d.symbol)).map((s) => s.detail).join("; ") || "no transfers ≥ $25k in window"})` : ""}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Independent market check — exchange and Chainlink {real ? <Badge k="live">REAL FEED</Badge> : <Badge k="snapshot">not used in scenario mode</Badge>}</h2>
        <p className="small muted">Read from the exchanges and from Chainlink Data Feeds as of the reference time, independent of RYO. The exchange plane can support or oppose a trade; clause "price agreement" refuses to act on a RYO price that no independent reference confirms. Tokens without a listing or a feed show as unavailable, never filled in.</p>
        <div className="scroll">
          <table>
            <thead><tr><th>Token</th><th>Venue</th><th className="num">24h (1h candles)</th><th className="num">Funding / 8h</th><th className="num">OI 24h</th><th>Reference price</th><th>Price agreement</th></tr></thead>
            <tbody>
              {run.dossiers.map((x) => {
                const m = x.market;
                const g = x.gates.find((y) => y.kind === "price_agreement");
                const ch = m && m.candles.length >= 2 ? ((m.candles[m.candles.length - 1].c - m.candles[0].o) / m.candles[0].o) * 100 : null;
                return (
                  <tr key={x.symbol}>
                    <td><b>{x.symbol}</b></td>
                    <td className="small">{m?.venue ?? "—"}</td>
                    <td className="num">{ch === null ? "—" : `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`}</td>
                    <td className="num">{m?.fundingRate === null || m?.fundingRate === undefined ? "—" : `${(m.fundingRate * 100).toFixed(4)}%`}</td>
                    <td className="num">{m?.oiChange24hPct === null || m?.oiChange24hPct === undefined ? "—" : `${m.oiChange24hPct >= 0 ? "+" : ""}${m.oiChange24hPct}%`}</td>
                    <td className="small">{m?.priceRef ? <a href={m.priceRef.url} target="_blank" rel="noreferrer">{m.priceRef.source} {m.priceRef.price}</a> : "unavailable"}</td>
                    <td className="small">{g ? <><Badge k={g.outcome === "fail" ? "fail" : g.outcome === "pass" ? "pass" : "partial"}>{g.outcome.replace("_", " ")}</Badge> {g.observed}</> : "clause not in mandate"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {real && (
        <div className="card">
          <h2>Feed status for this run</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>Feed</th><th>Target</th><th></th><th className="num">Items</th><th>Detail</th></tr></thead>
              <tbody>
                {run.feedSources.map((s, i) => (
                  <tr key={i}><td className="mono small">{s.feed}</td><td className="small">{s.target}</td><td><Badge k={s.ok ? "pass" : "fail"}>{s.ok ? "ok" : "unavailable"}</Badge></td><td className="num">{s.items}</td><td className="small muted">{s.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="inline">Telegram voices (public channels, ≤ 20) <input className="num" style={{ width: 360 }} value={chDraft} onChange={(e) => setChDraft(e.target.value)} /></label>
            <button className="btn" onClick={() => setChannels(chDraft.split(/[ ,]+/).map((c) => c.replace(/^@|^t\.me\//, "")).filter(Boolean).slice(0, 20))}>Use channels</button>
            <span className="small muted">Applies to Live runs. Replay uses the bundled capture. X and Discord need paid or bot API access, so paste posts from them below.</span>
          </div>
        </div>
      )}
      <div className="card">
        <h2>Bring your own evidence — up to 20 voices</h2>
        <p className="small muted">One post per line: <span className="mono">handle | minutes before the reference time (≤ 0) | text</span>. Handle prefixes: <span className="mono">@name</span> for X, <span className="mono">#channel</span> for Discord, <span className="mono">t.me/name</span> for Telegram. {real ? "In Real-feeds mode your posts are added alongside the feeds and labelled user-supplied." : "In Scenario mode they replace the fixture posts."} Then press "Run agent".</p>
        <textarea className="code" style={{ minHeight: 180 }} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={apply}>Use these posts</button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
