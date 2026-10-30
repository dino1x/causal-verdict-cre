// Bidirectional Fiduciary Risk Mandate compiler.
//   compile(prose)  -> MandateAST   (controlled-natural-language parser, line-numbered errors, no LLM)
//   decompile(ast)  -> prose        (deterministic templates; decompile(compile(x)) is a fixpoint)
//   evaluate(ast, facts) -> per-clause verdicts with counterexamples
// Every clause carries its legal anchor so a rejection cites the exact rule that failed.

export type Clause =
  | { kind: "risk_per_trade"; maxPct: number }
  | { kind: "max_position"; maxPct: number }
  | { kind: "min_confluence"; min: number }
  | { kind: "require_status"; allowed: ("ok" | "partial")[] }
  | { kind: "min_turnover"; min: number }
  | { kind: "max_atr"; maxPct: number }
  | { kind: "stop_rule"; atrMult: number; maxPct: number }
  | { kind: "require_measurement"; field: "rsi_14" | "atr_14_pct" }
  | { kind: "reject_verdict"; verdicts: string[] }
  | { kind: "anti_exit_liquidity"; windowMin: number }
  | { kind: "anti_touting"; minKols: number; windowMin: number }
  | { kind: "regime_scaling"; regime: string; factor: number }
  | { kind: "min_planes"; n: number }
  | { kind: "perp_veto" };

export interface ClauseNode {
  id: string; // C1, C2 ...
  line: number;
  clause: Clause;
  anchor: LegalAnchor;
}

export interface LegalAnchor {
  code: string;
  title: string;
  why: string;
}

export interface MandateAST {
  type: "Mandate";
  name: string;
  clauses: ClauseNode[];
}

export interface CompileError {
  line: number;
  text: string;
  message: string;
}

const UPIA2 = { code: "UPIA §2(a)–(c)", title: "Uniform Prudent Investor Act — standard of care, risk and return objectives" };
const UPIA3 = { code: "UPIA §3", title: "Uniform Prudent Investor Act — duty to diversify" };
const S17B = { code: "Securities Act 1933 §17(b), 15 U.S.C. §77q(b)", title: "Anti-touting: undisclosed paid promotion" };
const MICA91 = { code: "MiCA Art. 91(2)", title: "Regulation (EU) 2023/1114 — prohibition of market manipulation (incl. voicing opinions while positioned)" };
const MICA92 = { code: "MiCA Art. 92", title: "Regulation (EU) 2023/1114 — prevention and detection of market abuse (surveillance duty)" };

export const ANCHORS: Record<Clause["kind"], LegalAnchor> = {
  risk_per_trade: { ...UPIA2, why: "Caps loss per decision so a single error cannot impair the portfolio's risk objective." },
  max_position: { ...UPIA3, why: "Concentration limit; prudence is judged at the portfolio level." },
  min_confluence: { ...UPIA2, why: "Reasonable inquiry: independent factors must agree before acting." },
  require_status: { ...UPIA2, why: "A fiduciary may not act on evidence its source declares unavailable." },
  min_turnover: { ...UPIA2, why: "Liquidity is a listed UPIA §2(c) circumstance; illiquid assets cannot be exited at the modeled stop." },
  max_atr: { ...UPIA2, why: "Volatility beyond the mandate's tolerance is outside the stated risk objective." },
  stop_rule: { ...UPIA2, why: "Loss is bounded by a measured-volatility stop rather than discretion." },
  require_measurement: { ...UPIA2, why: "Missing measurements are not treated as healthy or neutral." },
  reject_verdict: { ...UPIA2, why: "The research source's own adverse verdict must be respected, not overridden by narrative." },
  anti_exit_liquidity: { ...MICA91, why: "Wallets accumulating before promotion and sending to exchanges after it is the scalping / pump-and-dump pattern; the agent must not become the exit liquidity." },
  anti_touting: { ...S17B, why: "Coordinated promotion without a primary-source catalyst is treated as possible undisclosed paid touting (where the token is a security) and flagged under MiCA Art. 92 surveillance." },
  regime_scaling: { ...UPIA2, why: "Risk tolerance adapts to general economic conditions (UPIA §2(c)(1))." },
  min_planes: { ...MICA92, why: "Corroboration across independent evidence planes reduces reliance on a single manipulable feed." },
  perp_veto: { ...UPIA2, why: "Derivatives crowding / squeeze veto from RYO is binding." },
};

// ---- Grammar: one pattern per clause kind. Patterns are matched against a normalized line. ----
type Rule = { kind: Clause["kind"]; re: RegExp; build: (m: RegExpMatchArray) => Clause };
const N = "(\\d+(?:\\.\\d+)?)";
const RULES: Rule[] = [
  { kind: "risk_per_trade", re: new RegExp(`^risk no more than ${N}% of (?:portfolio )?equity (?:on|per) (?:any single|each) (?:practice )?(?:position|trade)`), build: (m) => ({ kind: "risk_per_trade", maxPct: +m[1] }) },
  { kind: "max_position", re: new RegExp(`^never allocate more than ${N}% of (?:portfolio )?equity to (?:a single|any one) asset`), build: (m) => ({ kind: "max_position", maxPct: +m[1] }) },
  { kind: "min_confluence", re: new RegExp(`^require (?:a )?ryo (?:deep_analysis )?confluence score of at least ${N}`), build: (m) => ({ kind: "min_confluence", min: +m[1] }) },
  { kind: "require_status", re: /^require ryo status to be (ok or partial|ok)(?:; reject when unavailable)?/, build: (m) => ({ kind: "require_status", allowed: m[1] === "ok" ? ["ok"] : ["ok", "partial"] }) },
  { kind: "min_turnover", re: new RegExp(`^require (?:a )?24h volume to market cap turnover of at least ${N}`), build: (m) => ({ kind: "min_turnover", min: +m[1] }) },
  { kind: "max_atr", re: new RegExp(`^reject when atr\\(14\\) exceeds ${N}% of price`), build: (m) => ({ kind: "max_atr", maxPct: +m[1] }) },
  { kind: "stop_rule", re: new RegExp(`^place the stop-loss at ${N} ?x atr\\(14\\) below entry, never more than ${N}% below entry`), build: (m) => ({ kind: "stop_rule", atrMult: +m[1], maxPct: +m[2] }) },
  { kind: "require_measurement", re: /^treat unavailable (rsi\(14\)|atr\(14\)) as a failed gate/, build: (m) => ({ kind: "require_measurement", field: m[1].startsWith("rsi") ? "rsi_14" : "atr_14_pct" }) },
  { kind: "reject_verdict", re: /^reject when the ryo deep_analysis verdict is ((?:[a-z_]+)(?: or [a-z_]+)*)/, build: (m) => ({ kind: "reject_verdict", verdicts: m[1].split(" or ") }) },
  { kind: "anti_exit_liquidity", re: new RegExp(`^block entry when whale wallets that accumulated before kol convergence send to exchanges within ${N} minutes after it`), build: (m) => ({ kind: "anti_exit_liquidity", windowMin: +m[1] }) },
  { kind: "anti_touting", re: new RegExp(`^block entry when ${N} or more independent kols promote the token within ${N} minutes without a verified primary-source catalyst`), build: (m) => ({ kind: "anti_touting", minKols: +m[1], windowMin: +m[2] }) },
  { kind: "regime_scaling", re: new RegExp(`^scale position size by ${N} when the market regime is ([a-z_]+)`), build: (m) => ({ kind: "regime_scaling", factor: +m[1], regime: m[2] }) },
  { kind: "min_planes", re: new RegExp(`^require at least ${N} independent evidence planes to support entry`), build: (m) => ({ kind: "min_planes", n: +m[1] }) },
  { kind: "perp_veto", re: /^honor the ryo derivatives veto/, build: () => ({ kind: "perp_veto" }) },
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .replace(/[.;]\s*$/, "")
    .trim();

export function compile(prose: string): { ast: MandateAST | null; errors: CompileError[] } {
  const errors: CompileError[] = [];
  const clauses: ClauseNode[] = [];
  let name = "Untitled Mandate";
  const lines = prose.split("\n");
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const t = raw.trim();
    if (!t || t.startsWith("#") || t.startsWith("//")) return;
    const head = t.match(/^MANDATE\s+"([^"]+)"/i);
    if (head) {
      name = head[1];
      return;
    }
    const n = normalize(t);
    const rule = RULES.find((r) => r.re.test(n));
    if (!rule) {
      errors.push({ line, text: t, message: "Unrecognized clause. Every line must match a defined clause form — ambiguous prose is rejected, never guessed." });
      return;
    }
    const clause = rule.build(n.match(rule.re)!);
    const bad = validate(clause);
    if (bad) {
      errors.push({ line, text: t, message: bad });
      return;
    }
    if (clauses.some((c) => c.clause.kind === clause.kind && clause.kind !== "regime_scaling" && clause.kind !== "require_measurement")) {
      errors.push({ line, text: t, message: `Duplicate ${clause.kind} clause — conflicting limits must be resolved by the drafter.` });
      return;
    }
    clauses.push({ id: `C${clauses.length + 1}`, line, clause, anchor: ANCHORS[clause.kind] });
  });
  return { ast: errors.length ? null : { type: "Mandate", name, clauses }, errors };
}

function validate(c: Clause): string | null {
  const pct = (v: number, lo: number, hi: number, label: string) => (v < lo || v > hi ? `${label} must be between ${lo} and ${hi} (got ${v}).` : null);
  switch (c.kind) {
    case "risk_per_trade": return pct(c.maxPct, 0.01, 5, "Risk per trade %");
    case "max_position": return pct(c.maxPct, 0.1, 100, "Max position %");
    case "min_confluence": return pct(c.min, 0, 1, "Confluence score");
    case "min_turnover": return pct(c.min, 0, 10, "Turnover");
    case "max_atr": return pct(c.maxPct, 0.1, 100, "ATR %");
    case "stop_rule": return pct(c.atrMult, 0.25, 6, "ATR multiple") ?? pct(c.maxPct, 0.5, 50, "Max stop %");
    case "anti_exit_liquidity": return pct(c.windowMin, 1, 1440, "Window minutes");
    case "anti_touting": return pct(c.minKols, 2, 20, "KOL count") ?? pct(c.windowMin, 1, 1440, "Window minutes");
    case "regime_scaling": return pct(c.factor, 0, 1, "Scale factor");
    case "min_planes": return pct(c.n, 1, 4, "Evidence planes");
    default: return null;
  }
}

const f = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

/** Deterministic decompiler: AST -> canonical prose. No model, no randomness. */
export function decompileClause(c: Clause): string {
  switch (c.kind) {
    case "risk_per_trade": return `Risk no more than ${f(c.maxPct)}% of portfolio equity on any single practice position.`;
    case "max_position": return `Never allocate more than ${f(c.maxPct)}% of portfolio equity to a single asset.`;
    case "min_confluence": return `Require RYO deep_analysis confluence score of at least ${f(c.min)}.`;
    case "require_status": return c.allowed.length === 1 ? "Require RYO status to be ok; reject when unavailable." : "Require RYO status to be ok or partial; reject when unavailable.";
    case "min_turnover": return `Require 24h volume to market cap turnover of at least ${f(c.min)}.`;
    case "max_atr": return `Reject when ATR(14) exceeds ${f(c.maxPct)}% of price.`;
    case "stop_rule": return `Place the stop-loss at ${f(c.atrMult)} x ATR(14) below entry, never more than ${f(c.maxPct)}% below entry.`;
    case "require_measurement": return `Treat unavailable ${c.field === "rsi_14" ? "RSI(14)" : "ATR(14)"} as a failed gate.`;
    case "reject_verdict": return `Reject when the RYO deep_analysis verdict is ${c.verdicts.join(" or ")}.`;
    case "anti_exit_liquidity": return `Block entry when whale wallets that accumulated before KOL convergence send to exchanges within ${f(c.windowMin)} minutes after it.`;
    case "anti_touting": return `Block entry when ${f(c.minKols)} or more independent KOLs promote the token within ${f(c.windowMin)} minutes without a verified primary-source catalyst.`;
    case "regime_scaling": return `Scale position size by ${f(c.factor)} when the market regime is ${c.regime}.`;
    case "min_planes": return `Require at least ${f(c.n)} independent evidence planes to support entry.`;
    case "perp_veto": return "Honor the RYO derivatives veto.";
  }
}

export function decompile(ast: MandateAST): string {
  return [`MANDATE "${ast.name}"`, ...ast.clauses.map((c, i) => `${i + 1}. ${decompileClause(c.clause)}`)].join("\n");
}

/** Round-trip proof: prose -> AST -> prose -> AST must yield an identical AST. */
export function roundTrip(prose: string): { ok: boolean; canonicalProse: string | null } {
  const a = compile(prose);
  if (!a.ast) return { ok: false, canonicalProse: null };
  const canonicalProse = decompile(a.ast);
  const b = compile(canonicalProse);
  const strip = (x: MandateAST) => JSON.stringify(x.clauses.map((c) => c.clause)) + x.name;
  return { ok: !!b.ast && strip(a.ast) === strip(b.ast), canonicalProse };
}

export const DEFAULT_MANDATE = `MANDATE "Prudent Practice Desk v1"
1. Risk no more than 1% of portfolio equity on any single practice position.
2. Never allocate more than 10% of portfolio equity to a single asset.
3. Require RYO status to be ok or partial; reject when unavailable.
4. Require RYO deep_analysis confluence score of at least 0.6.
5. Require 24h volume to market cap turnover of at least 0.05.
6. Reject when ATR(14) exceeds 25% of price.
7. Treat unavailable RSI(14) as a failed gate.
8. Treat unavailable ATR(14) as a failed gate.
9. Reject when the RYO deep_analysis verdict is avoid.
10. Honor the RYO derivatives veto.
11. Place the stop-loss at 1.5 x ATR(14) below entry, never more than 8% below entry.
12. Block entry when whale wallets that accumulated before KOL convergence send to exchanges within 90 minutes after it.
13. Block entry when 5 or more independent KOLs promote the token within 30 minutes without a verified primary-source catalyst.
14. Scale position size by 0.5 when the market regime is risk_off.
15. Require at least 2 independent evidence planes to support entry.`;

// ---------------------------------------------------------------- evaluation

export interface GateFacts {
  symbol: string;
  status: string | null; // worst of analyze/deep status, null if never fetched
  confluence: number | null;
  turnover: number | null;
  atrPct: number | null;
  rsi14: number | null;
  deepVerdict: string | null;
  perpVeto: boolean | null;
  exitLiquidityTrap: { detected: boolean; detail: string } | null;
  touting: { independentKols: number; windowMin: number; verifiedCatalyst: boolean; detail: string } | null;
  supportingPlanes: string[];
}

export interface GateResult {
  id: string;
  kind: Clause["kind"];
  prose: string;
  anchor: LegalAnchor;
  outcome: "pass" | "fail" | "not_applicable" | "modifier";
  observed: string;
  counterexample: string | null;
}

export function evaluate(ast: MandateAST, x: GateFacts, regime: string | null): GateResult[] {
  return ast.clauses.map(({ id, clause: c, anchor }) => {
    const base = { id, kind: c.kind, prose: decompileClause(c), anchor };
    const res = (outcome: GateResult["outcome"], observed: string, counterexample: string | null = null): GateResult => ({ ...base, outcome, observed, counterexample });
    switch (c.kind) {
      case "require_status":
        if (x.status === null || x.status === "unavailable") return res("fail", `status=${x.status ?? "never fetched"}`, `${x.symbol}: RYO evidence is unavailable; the mandate forbids acting on it.`);
        return (c.allowed as string[]).includes(x.status) ? res("pass", `status=${x.status}`) : res("fail", `status=${x.status}`, `${x.symbol}: RYO status '${x.status}' is not in {${c.allowed.join(", ")}}.`);
      case "min_confluence":
        if (x.confluence === null) return res("fail", "confluence=unavailable (deep_analysis not run or lane missing)", `${x.symbol}: no measured confluence, so the minimum ${c.min} cannot be shown to hold.`);
        return x.confluence >= c.min ? res("pass", `confluence=${x.confluence}`) : res("fail", `confluence=${x.confluence}`, `${x.symbol}: confluence ${x.confluence} < required ${c.min}.`);
      case "min_turnover":
        if (x.turnover === null) return res("fail", "turnover=unavailable", `${x.symbol}: volume or market cap unavailable.`);
        return x.turnover >= c.min ? res("pass", `turnover=${x.turnover.toFixed(4)}`) : res("fail", `turnover=${x.turnover.toFixed(4)}`, `${x.symbol}: turnover ${x.turnover.toFixed(4)} < ${c.min}; a stop could not be filled near its modeled price.`);
      case "max_atr":
        if (x.atrPct === null) return res("not_applicable", "ATR(14)=unavailable (see measurement clause)");
        return x.atrPct <= c.maxPct ? res("pass", `ATR(14)=${x.atrPct}%`) : res("fail", `ATR(14)=${x.atrPct}%`, `${x.symbol}: ATR(14) ${x.atrPct}% > ${c.maxPct}% tolerance.`);
      case "require_measurement": {
        const v = c.field === "rsi_14" ? x.rsi14 : x.atrPct;
        return v === null ? res("fail", `${c.field}=unavailable`, `${x.symbol}: RYO returned ${c.field}=null; a missing measurement is not treated as neutral.`) : res("pass", `${c.field}=${v}`);
      }
      case "reject_verdict":
        if (x.deepVerdict === null) return res("not_applicable", "deep_analysis verdict unavailable");
        return c.verdicts.includes(x.deepVerdict) ? res("fail", `verdict=${x.deepVerdict}`, `${x.symbol}: RYO deep_analysis verdict is '${x.deepVerdict}'.`) : res("pass", `verdict=${x.deepVerdict}`);
      case "perp_veto":
        if (x.perpVeto === null) return res("not_applicable", "derivatives lane unavailable");
        return x.perpVeto ? res("fail", "veto=true", `${x.symbol}: RYO derivatives veto is active.`) : res("pass", "veto=false");
      case "anti_exit_liquidity":
        if (!x.exitLiquidityTrap) return res("not_applicable", "no whale-flow evidence for this token");
        return x.exitLiquidityTrap.detected ? res("fail", x.exitLiquidityTrap.detail, `${x.symbol}: ${x.exitLiquidityTrap.detail}`) : res("pass", x.exitLiquidityTrap.detail);
      case "anti_touting":
        if (!x.touting) return res("not_applicable", "no KOL evidence for this token");
        {
          const t = x.touting;
          const trig = t.independentKols >= c.minKols && t.windowMin <= c.windowMin && !t.verifiedCatalyst;
          return trig ? res("fail", t.detail, `${x.symbol}: ${t.independentKols} independent KOLs within ${t.windowMin}m and no verified primary-source catalyst.`) : res("pass", t.detail);
        }
      case "min_planes":
        return x.supportingPlanes.length >= c.n ? res("pass", `supporting planes: ${x.supportingPlanes.join(", ") || "none"}`) : res("fail", `supporting planes: ${x.supportingPlanes.join(", ") || "none"}`, `${x.symbol}: only ${x.supportingPlanes.length} of ${c.n} required independent planes support entry.`);
      case "regime_scaling":
        return res("modifier", regime === c.regime ? `regime=${regime} → size × ${c.factor}` : `regime=${regime ?? "unavailable"} (no scaling)`);
      case "risk_per_trade":
      case "max_position":
      case "stop_rule":
        return res("modifier", "applied by the atomic position sizer");
    }
  });
}

export function clauseOf<K extends Clause["kind"]>(ast: MandateAST, kind: K): Extract<Clause, { kind: K }> | undefined {
  return ast.clauses.find((c) => c.clause.kind === kind)?.clause as any;
}
