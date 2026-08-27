# Diffest

Turn a GitHub commit range (or "since last tag") into a clean, human-readable CHANGELOG entry — even when the commit messages themselves are garbage.

Point it at a repo. It pulls the commits and diffs, groups them by real impact (features, fixes, breaking changes), and writes the summary for you — falling back to reading the actual diff content when commit messages are useless ("fix", "wip", "update").

## Why

Most changelog generators just reformat conventional-commit prefixes. If your commit history doesn't follow that convention (most don't), you get nothing useful. Diffest reads the diffs themselves when it has to.

## Project structure

```
diffest/
├── backend/     Express API — pulls commits/diffs from GitHub, summarizes them
└── frontend/    React app (Vite) — paste a repo + range, get a changelog
```

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env
# fill in GITHUB_TOKEN (free) and GEMINI_API_KEY (free tier) in .env
npm install
npm run dev
```

Runs on `http://localhost:3001` by default.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` by default, and expects the backend at `http://localhost:3001` (see `frontend/.env.example`).

## Roadmap (matches the plan we agreed on)

- [x] Scaffold: repo + commit range in → changelog text out
- [x] Diff-aware summarization (not just commit-message parsing)
- [ ] PAT support for private repos / higher rate limits
- [x] GitHub Action stub: `.github/workflows/changelog.yml` runs on tag push — **not fully wired yet**, needs the backend deployed somewhere persistent (Render) and its URL added as a `DIFFEST_API_URL` repo secret. Until then it's a template to finish, not a working automation.
- [ ] README section syncing

## Deploy

Same pattern as your other projects: frontend → Vercel, backend → Render (free tier). Just point the frontend's `VITE_API_URL` at your deployed backend URL.
