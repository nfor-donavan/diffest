import { Router } from "express";
import { parseRepo, parsePrUrl, getPrCommits, getCommitRange, getCommitDiff } from "../lib/github.js";
import { summarizeChangelog, isUselessMessage } from "../lib/summarize.js";

const router = Router();

// POST /api/generate
// body: { repo: "owner/repo" | full URL | PR URL, since?: string, until?: string, tone?: "technical" | "release" }
router.post("/", async (req, res) => {
  try {
    const { repo, since, until = "HEAD", tone = "technical" } = req.body;
    if (!repo) return res.status(400).json({ error: "Missing 'repo'." });

    const prMatch = parsePrUrl(repo);
    let owner, repoName, commits;

    if (prMatch) {
      // Pasted a PR URL — scope to just that PR's commits, ignore since/until.
      ({ owner, repo: repoName } = prMatch);
      const prCommits = await getPrCommits(prMatch);
      commits = prCommits.map((c) => ({ sha: c.sha, commit: c.commit }));
    } else {
      ({ owner, repo: repoName } = parseRepo(repo));
      commits = await getCommitRange({ owner, repo: repoName, since, until });
    }

    if (commits.length === 0) {
      return res.json({ changelog: "No commits found in that range.", commitCount: 0 });
    }

    // For commits with an unhelpful message, pull the full diff so the
    // model has something real to summarize from.
    const enriched = await Promise.all(
      commits.slice(0, 30).map(async (c) => {
        const message = c.commit?.message || "";
        if (isUselessMessage(message)) {
          try {
            return await getCommitDiff({ owner, repo: repoName, sha: c.sha });
          } catch {
            return { sha: c.sha, message, files: [] };
          }
        }
        return { sha: c.sha, message, files: [] };
      })
    );

    const changelog = await summarizeChangelog(enriched, { tone });

    res.json({ changelog, commitCount: commits.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong." });
  }
});

export default router;
