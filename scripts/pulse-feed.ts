// Collects stats for your GitHub repos and pushes them to two Pulse tiles.
// Runs with Bun (no dependencies). Env:
//   GH_TOKEN             fine-grained PAT: read access to metadata, issues, pull requests, actions
//   PULSE_URL            e.g. https://pulse.lola.farm
//   PULSE_REPOS_TILE     tile id of "Repositories"
//   PULSE_REPOS_TOKEN    that tile's token (from its page in Pulse)
//   PULSE_ACTIVITY_TILE  tile id of "Recent activity"
//   PULSE_ACTIVITY_TOKEN that tile's token
//   REPOS (optional)     comma list "owner/name,owner/name"; default = your 12 most recently pushed repos
//
// This repo is public and its Actions logs are public. Logs and errors name a
// status code and, for Pulse, a tile id. They never include a token, a repo
// name, or a response body.

const env = (k: string, required = true) => {
  const v = process.env[k]?.trim();
  if (!v && required) throw new Error(`Missing env ${k}`);
  return v ?? "";
};

const GH = "https://api.github.com";

function ghHeaders() {
  return {
    Authorization: `Bearer ${env("GH_TOKEN")}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function discard(res: Response) {
  await res.body?.cancel().catch(() => {});
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(GH + path, { headers: ghHeaders() });
  if (!res.ok) {
    await discard(res);
    throw new Error(`GitHub ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`GitHub ${res.status}`);
  }
}

type GhRepo = {
  full_name: string;
  name: string;
  stargazers_count: number;
  open_issues_count: number; // GitHub counts open PRs here too
  pushed_at: string;
  default_branch: string;
};

type CiStatus = "passing" | "failing" | "running" | "none";

async function ciStatus(full: string, branch: string): Promise<CiStatus> {
  const r = await gh<{ workflow_runs: { status: string; conclusion: string | null }[] }>(
    `/repos/${full}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
  );
  const run = r.workflow_runs[0];
  if (!run) return "none";
  if (run.status !== "completed") return "running";
  return run.conclusion === "success" || run.conclusion === "skipped" ? "passing" : "failing";
}

async function openPrCount(full: string): Promise<number> {
  const r = await gh<{ total_count: number }>(
    `/search/issues?q=${encodeURIComponent(`repo:${full} is:pr is:open`)}&per_page=1`,
  );
  return r.total_count;
}

async function loadRepos(): Promise<GhRepo[]> {
  const list = env("REPOS", false);
  if (list) {
    return Promise.all(list.split(",").map((s) => gh<GhRepo>(`/repos/${s.trim()}`)));
  }
  return gh<GhRepo[]>(`/user/repos?affiliation=owner&sort=pushed&per_page=12`);
}

async function buildRepos() {
  const repos = await loadRepos();
  const rows = [];
  for (const r of repos) {
    // sequential: keeps us well under the search API's 30 requests/minute
    const [prs, ci] = await Promise.all([openPrCount(r.full_name), ciStatus(r.full_name, r.default_branch)]);
    rows.push({
      name: r.name,
      stars: r.stargazers_count,
      openIssues: Math.max(0, r.open_issues_count - prs),
      openPullRequests: prs,
      lastPushAt: r.pushed_at,
      ciStatus: ci,
    });
  }
  return { repos: rows, updatedAt: new Date().toISOString() };
}

type GhEvent = {
  type: string;
  actor: { login: string };
  repo: { name: string };
  created_at: string;
  payload: any;
};

async function buildActivity() {
  const me = await gh<{ login: string }>(`/user`);
  // Public events only. Private-repo activity is not in this feed.
  const raw = await gh<GhEvent[]>(`/users/${me.login}/events?per_page=60`);
  const events = [];
  for (const e of raw) {
    const repo = e.repo.name.split("/")[1] ?? e.repo.name;
    const base = { repo, actor: e.actor.login, at: e.created_at };
    const p = e.payload ?? {};
    if (e.type === "PushEvent") {
      const n = p.size ?? p.commits?.length ?? 0;
      const branch = String(p.ref ?? "").replace("refs/heads/", "");
      events.push({ type: "push", title: `${n} commit${n === 1 ? "" : "s"} to ${branch}`, ...base });
    } else if (e.type === "PullRequestEvent" && p.action === "opened") {
      events.push({ type: "pr_opened", title: p.pull_request?.title ?? "Pull request", ...base });
    } else if (e.type === "PullRequestEvent" && p.action === "closed" && p.pull_request?.merged) {
      events.push({ type: "pr_merged", title: p.pull_request?.title ?? "Pull request", ...base });
    } else if (e.type === "IssuesEvent" && p.action === "opened") {
      events.push({ type: "issue_opened", title: p.issue?.title ?? "Issue", ...base });
    } else if (e.type === "ReleaseEvent" && p.action === "published") {
      events.push({ type: "release", title: p.release?.name || p.release?.tag_name || "Release", ...base });
    }
    if (events.length >= 15) break;
  }
  return { events };
}

async function pushToPulse(tile: string, token: string, body: unknown) {
  const res = await fetch(`${env("PULSE_URL").replace(/\/$/, "")}/api/widget-data/${tile}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await discard(res);
    throw new Error(`Pulse ${res.status} for tile ${tile}`);
  }
  await discard(res);
  console.log(`Pushed tile ${tile}`);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^Missing env [A-Z0-9_]+$/.test(message)) return message;
  if (/^GitHub \d{3}$/.test(message)) return message;
  if (/^Pulse \d{3} for tile \d+$/.test(message)) return message;
  return "Pulse feed failed";
}

try {
  const [repos, activity] = await Promise.all([buildRepos(), buildActivity()]);
  await pushToPulse(env("PULSE_REPOS_TILE"), env("PULSE_REPOS_TOKEN"), repos);
  await pushToPulse(env("PULSE_ACTIVITY_TILE"), env("PULSE_ACTIVITY_TOKEN"), activity);
} catch (error) {
  console.error(safeError(error));
  process.exit(1);
}
