const GITHUB_API = "https://api.github.com";

function authHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Turns a GitHub API status code into a message that's actually useful
 * to whoever's staring at the error in the UI.
 */
function githubErrorMessage(status, context) {
  if (status === 404) return `${context}: not found. Check the repo/PR is spelled right and is public (or that your GITHUB_TOKEN has access).`;
  if (status === 403) return `${context}: rate limited or access denied by GitHub. Add a GITHUB_TOKEN to backend/.env to raise the limit.`;
  if (status === 401) return `${context}: GitHub rejected the token. Check GITHUB_TOKEN in backend/.env is valid.`;
  return `${context}: GitHub API returned ${status}.`;
}

/**
 * Parses "owner/repo" out of a GitHub repo URL or shorthand.
 */
export function parseRepo(input) {
  const cleaned = input.trim().replace(/\.git$/, "");
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/) || cleaned.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("Could not parse a repo from that input. Use 'owner/repo' or a full GitHub URL.");
  return { owner: match[1], repo: match[2] };
}

/**
 * If the input is a GitHub PR URL (e.g. github.com/owner/repo/pull/123),
 * returns { owner, repo, prNumber }. Otherwise returns null.
 */
export function parsePrUrl(input) {
  const match = input.trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
}

/**
 * Fetches all commits belonging to a single PR, in a shape compatible
 * with getCommitRange()'s output.
 */
export async function getPrCommits({ owner, repo, prNumber }) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=100`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(githubErrorMessage(res.status, `PR #${prNumber} in ${owner}/${repo}`));
  const commits = await res.json();
  if (commits.length === 0) throw new Error(`PR #${prNumber} has no commits — nothing to summarize.`);
  return commits;
}

/**
 * Fetches commits between two refs (tags, SHAs, or branch names).
 * If `since` is omitted, falls back to the latest tag.
 */
export async function getCommitRange({ owner, repo, since, until = "HEAD" }) {
  let base = since;

  if (!base) {
    const tagsRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/tags`, { headers: authHeaders() });
    if (!tagsRes.ok) throw new Error(githubErrorMessage(tagsRes.status, `Repo ${owner}/${repo}`));
    const tags = await tagsRes.json();
    if (tags.length > 0) base = tags[0].name;
  }

  if (!base) {
    // No tags at all — just grab the last 20 commits.
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=20`, { headers: authHeaders() });
    if (!res.ok) throw new Error(githubErrorMessage(res.status, `Repo ${owner}/${repo}`));
    return res.json();
  }

  const compareRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/compare/${base}...${until}`, {
    headers: authHeaders(),
  });
  if (!compareRes.ok) throw new Error(githubErrorMessage(compareRes.status, `Comparing ${base}...${until} in ${owner}/${repo}`));
  const compareData = await compareRes.json();
  return compareData.commits || [];
}

/**
 * Fetches the file-level diff for a single commit (used as a fallback
 * when the commit message itself is uninformative).
 */
export async function getCommitDiff({ owner, repo, sha }) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch commit ${sha}: ${res.status}`);
  const data = await res.json();
  return {
    sha,
    message: data.commit?.message || "",
    files: (data.files || []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch, // may be undefined for large/binary files
    })),
  };
}
