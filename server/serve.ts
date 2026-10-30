// Production server: serves dist/ and the /api routes on one port.
//   npm run build && npm start   ->  http://localhost:8787
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handleApi } from "./api";

const DIST = join(process.cwd(), "dist");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, path);
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
