// Claude analyst debate (server-side). Claude argues Bull and Bear from the SAME structured evidence the
// deterministic agents use. Every claim must cite an allowed evidence path; uncited or off-list claims are
// dropped and counted. The output is advisory: the deterministic, mandate-bound Judge still decides, so
// replay stays exact. Each response is hashed so the analysis can be filed with the decision.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { canonical } from "../src/engine/ryo";
import { sha256Hex } from "./hash";

const MODEL = "claude-opus-5-5";

const Claim = z.object({
  claim: z.string().describe("One concrete argument, at most two sentences, grounded in the cited value."),
  cite: z.string().describe("Exactly one evidence path copied verbatim from ALLOWED_CITES."),
  weight: z.number().describe("Strength of this argument from 0 (negligible) to 1 (decisive)."),
});

const DebateSchema = z.object({
  bull: z.array(Claim).describe("Strongest arguments for taking the practice position."),
  bear: z.array(Claim).describe("Strongest arguments against it, including what the evidence cannot show."),
  causal_story: z.string().describe("Two to four sentences on the cause-and-effect chain the evidence supports, and where it breaks."),
  what_would_change_my_mind: z.string().describe("The single observation that would most change the assessment."),
});

export interface DebateInput {
  symbol: string;
  evidence: Record<string, unknown>;
  market: Record<string, unknown>;
  deterministicArgs: { side: string; claim: string; cite: string; value: string }[];
  gates: { id: string; outcome: string; prose: string; observed: string }[];
  decision: string;
  evidenceMode: string;
}

const SYSTEM = `You are one half of a research desk's adversarial review. You argue BOTH sides of a practice-trade decision from structured evidence, then explain the causal story. Rules:
- Use only the evidence provided. Do not invent prices, events, news or wallet activity.
- Every claim must cite exactly one path from ALLOWED_CITES, copied verbatim. Claims you cannot ground in a listed path must be left out.
- A value of null or "unavailable" means the measurement is missing. Say so; never treat it as zero or as healthy.
- Scenario-fixture evidence (evidenceMode "scenario") is illustrative, not real; note that when you rely on it.
- The mandate gates are binding and you cannot override them. Argue the merits; the deterministic judge decides.
- This is research for practice trades only, not financial advice.`;

export async function claudeDebate(input: DebateInput) {
  const allowed = [...new Set(input.deterministicArgs.map((a) => a.cite).concat(Object.keys(input.evidence).map((k) => `evidence.${k}`), Object.keys(input.market).map((k) => `market.${k}`)))];
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY (server-side env) — never sent to the browser
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(DebateSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Token: ${input.symbol}\nDeterministic judge decision: ${input.decision}\nevidenceMode: ${input.evidenceMode}\n\nALLOWED_CITES:\n${allowed.map((c) => `- ${c}`).join("\n")}\n\nEVIDENCE (structured RYO fields, nulls preserved):\n${JSON.stringify(input.evidence, null, 1)}\n\nMARKET CONTEXT:\n${JSON.stringify(input.market, null, 1)}\n\nDETERMINISTIC ARGUMENTS ALREADY ON FILE (cite + value):\n${input.deterministicArgs.map((a) => `- [${a.side}] ${a.cite} = ${a.value}: ${a.claim}`).join("\n")}\n\nMANDATE GATES:\n${input.gates.map((g) => `- ${g.id} ${g.outcome}: ${g.prose} (observed: ${g.observed})`).join("\n")}\n\nArgue both sides, then give the causal story.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return { ok: false as const, error: `refused (${response.stop_details?.category ?? "unspecified"})`, model: response.model };
  }
  const out = response.parsed_output;
  if (!out) return { ok: false as const, error: `no structured output (stop_reason ${response.stop_reason})`, model: response.model };

  // Validation: keep only claims whose citation is on the allowed list, clamp weights.
  const keep = (cs: z.infer<typeof Claim>[]) => cs.filter((c) => allowed.includes(c.cite)).map((c) => ({ ...c, weight: Math.max(0, Math.min(1, c.weight)) }));
  const bull = keep(out.bull);
  const bear = keep(out.bear);
  const dropped = out.bull.length + out.bear.length - bull.length - bear.length;
  const result = { bull, bear, causal_story: out.causal_story, what_would_change_my_mind: out.what_would_change_my_mind };
  return {
    ok: true as const,
    model: response.model,
    result,
    validation: { allowedCites: allowed.length, claims: out.bull.length + out.bear.length, dropped },
    output_sha256: sha256Hex(canonical(result)),
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
  };
}
