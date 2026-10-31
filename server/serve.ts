// Production server: serves dist/ and the /api routes on one port.
//   npm run build && npm start   ->  http://localhost:8787
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handleApi } from "./api";

const DIST = join(process.cwd(), "dist");
const WITNESS = join(process.cwd(), "witness"); // published ledger heads, Bitcoin proofs, Sigstore bundles
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".ots": "application/octet-stream", ".map": "application/json" };
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  // Witness files are served from the repo as committed, so the Ledger tab's proof links work in production.
  let file = path.startsWith("/witness/") ? join(WITNESS, path.slice("/witness/".length)) : join(DIST, path);
  try {
    if (!(await stat(file)).isFile()) file = join(DIST, "index.html");
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("build first: npm run build");
  }
}).listen(port, () => console.log(`Causal-Verdict CRE on http://localhost:${port}  (RYO key ${process.env.RYO_MCP_KEY ? "loaded server-side" : "absent → snapshot replay"})`));

// Render's free plan sleeps after 15 minutes without inbound traffic. Pinging our own public address every
// 10 minutes comes back in through Render's edge, which counts as traffic, so a judge never waits for a cold start.
// Render sets RENDER_EXTERNAL_URL itself; locally it is absent and nothing runs.
const SELF = process.env.RENDER_EXTERNAL_URL;
if (SELF) setInterval(() => fetch(`${SELF}/api/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => {}), 10 * 60_000).unref();
