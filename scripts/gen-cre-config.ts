// Compiles the default mandate and writes cre-workflow/causal-verdict/config.staging.json.
import { writeFileSync } from "node:fs";
import { compile, DEFAULT_MANDATE } from "../src/engine/legalAstCompiler";
import { generateCreConfig, DEFAULT_GEN } from "../src/engine/creCodegen";
const { ast, errors } = compile(DEFAULT_MANDATE);
if (!ast) throw new Error(JSON.stringify(errors));
const cfg = generateCreConfig(ast, { ...DEFAULT_GEN, vaultAddress: process.env.VAULT_ADDRESS ?? DEFAULT_GEN.vaultAddress });
writeFileSync("cre-workflow/causal-verdict/config.staging.json", JSON.stringify(cfg, null, 2) + "\n");
console.log("mandate hash", cfg.mandate.hash, "clauses", cfg.mandate.clauses.length);
