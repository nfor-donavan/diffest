import { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function App() {
  const [repo, setRepo] = useState("");
  const [since, setSince] = useState("");
  const [tone, setTone] = useState("technical");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function handleGenerate(e) {
    e.preventDefault();
    if (!repo.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, since: since || undefined, tone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setResult(data);
    } catch (err) {
      if (err instanceof TypeError) {
        setError(`Can't reach the backend at ${API_URL}. Is it running? (npm run dev in the backend folder)`);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (result?.changelog) navigator.clipboard.writeText(result.changelog);
  }

  return (
    <div className="app">
      <div className="brand">
        <img src="/logo.svg" alt="" className="brand-mark" width="28" height="28" />
        <span className="brand-word">DIFFEST</span>
      </div>
      <h1 className="headline">
        Changelogs, <em>digested</em> from your diffs.
      </h1>
      <p className="subhead">
        Paste a repo and a commit range. Diffest reads the commits — and the diffs themselves when the
        messages are useless — and writes the changelog entry for you.
      </p>

      <div className="panel">
        <form onSubmit={handleGenerate}>
          <div className="field-row">
            <input
              type="text"
              placeholder="owner/repo, a GitHub URL, or a PR link (github.com/owner/repo/pull/123)"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </div>
          <div className="row-inline">
            <input
              type="text"
              placeholder="since (tag or SHA — optional, defaults to latest tag)"
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="technical">Technical CHANGELOG</option>
              <option value="release">User-facing release notes</option>
            </select>
            <button className="primary" type="submit" disabled={loading || !repo.trim()}>
              {loading ? "Digesting…" : "Generate"}
            </button>
          </div>
          <div className="hint">
            Paste a PR link to summarize just that PR, or a repo to summarize a commit range. Public repos work
            without a token.
          </div>
        </form>

        {error && <div className="error">{error}</div>}

        <div className="output">
          {!result && !loading && !error && (
            <div className="empty-state">// changelog will appear here</div>
          )}
          {loading && <div className="loading-state">// reading commits and diffs…</div>}
          {result && (
            <>
              <div className="output-header">
                <span className="output-label">{result.commitCount} commits summarized</span>
                <button className="copy-btn" onClick={handleCopy}>
                  Copy
                </button>
              </div>
              <div className="changelog">{result.changelog}</div>
            </>
          )}
        </div>
      </div>
      <div className="footer">built by nfor-donavan</div>
    </div>
  );
}
