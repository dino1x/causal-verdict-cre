// GitHub's cron is best effort and often skips hours on young repos. This backstop keeps the agent hourly: every
// 5 minutes, if no agent run (scheduled or dispatched) has started in the last 55 minutes, start one. GitHub's own
// run at :17 counts, so the two never double up. Needs GH_DISPATCH_TOKEN (fine-grained, this repo, Actions: write);
// without it nothing runs.
const REPO = process.env.GITHUB_REPOSITORY ?? "dino1x/causal-verdict-cre";
const WORKFLOW = "agent.yml";
const EVERY_MS = 5 * 60_000;
const GAP_MS = 55 * 60_000;

async function gh(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "causal-verdict", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(15_000),
  });
}

export async function dispatchIfDue(token: string, now = Date.now()): Promise<string> {
  const r = await gh("/runs?per_page=1", token);
  if (!r.ok) return `runs HTTP ${r.status}`;
  const last = (await r.json()).workflow_runs?.[0]?.created_at;
  if (last && now - Date.parse(last) < GAP_MS) return `last run ${last}, not due`;
  const d = await gh("/dispatches", token, { method: "POST", body: JSON.stringify({ ref: "main" }) });
  return d.status === 204 ? "dispatched" : `dispatch HTTP ${d.status}`;
}

export function startAgentDispatch(): void {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return;
  const tick = () => dispatchIfDue(token).then((s) => s === "dispatched" && console.log("agent run dispatched"), () => {});
  setTimeout(tick, 60_000).unref();
  setInterval(tick, EVERY_MS).unref();
}
