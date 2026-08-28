// Uses Google's Gemini API (free tier available at aistudio.google.com/apikey).
// No SDK needed — just a plain fetch call.

const GEMINI_MODEL = "gemini-3.5-flash-lite"; // higher free-tier daily quota than full Flash models
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

const CATEGORIES = ["Breaking Changes", "Features", "Fixes", "Other"];

// Very rough heuristic for "is this commit message actually useful,
// or do we need to fall back to reading the diff?"
const USELESS_MESSAGE_PATTERNS = [/^wip$/i, /^fix$/i, /^update$/i, /^stuff$/i, /^\.+$/, /^minor$/i, /^tmp$/i];

export function isUselessMessage(message) {
  const firstLine = message.split("\n")[0].trim();
  if (firstLine.length < 6) return true;
  return USELESS_MESSAGE_PATTERNS.some((re) => re.test(firstLine));
}

/**
 * Deterministic, code-side category detection from a conventional-commit-style
 * prefix (e.g. "feat(ios): ...", "fix: ...", "feat!: ..."). Returns null if no
 * recognizable prefix is present — in that case the model decides from the diff.
 * Doing this in code (not via the model) means a clear prefix can never be
 * misclassified, regardless of how reliably the model follows instructions.
 */
function detectCategoryFromPrefix(text) {
  if (!text) return null;
  const firstLine = text.split("\n")[0].trim();
  const match = firstLine.match(/^(\w+)(\([^)]*\))?(!)?:/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const breaking = Boolean(match[3]) || /BREAKING[ -]CHANGE/i.test(text);
  if (breaking) return "Breaking Changes";
  if (type === "feat" || type === "feature") return "Features";
  if (type === "fix") return "Fixes";
  return null;
}

function stripJsonFences(text) {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

/**
 * Takes an array of { message, files } commit objects and asks the model
 * to produce a grouped, human-readable changelog.
 *
 * `tone` is "technical" (for CHANGELOG.md) or "release" (user-facing notes).
 * `prTitle`, when generating for a single PR, is the PR's own title —
 * often more reliable than the underlying commit message(s), especially
 * after squash-merges where the commit message gets auto-generated.
 */
export async function summarizeChangelog(commits, { tone = "technical", prTitle = "" } = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey and add it to backend/.env");
  }

  // Decide categories in code wherever possible. A PR title's prefix applies to
  // every commit in that PR (it's one logical change); otherwise each commit is
  // checked on its own message.
  const prTitleCategory = detectCategoryFromPrefix(prTitle);
  const knownCategories = commits.map((c) => prTitleCategory || detectCategoryFromPrefix(c.message));

  const commitBlocks = commits
    .map((c, i) => {
      const diffSummary = (c.files || [])
        .slice(0, 8) // cap to keep prompt size sane
        .map((f) => `  - ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})${f.patch ? `\n    patch:\n${f.patch.slice(0, 600)}` : ""}`)
        .join("\n");
      const categoryNote = knownCategories[i]
        ? `\ncategory (already decided, do not change): ${knownCategories[i]}`
        : `\ncategory: undecided — infer one of ${CATEGORIES.join(" | ")} from the diff below`;
      return `Commit index ${i}:\nmessage: ${c.message}${categoryNote}\nfiles:\n${diffSummary || "  (no file data)"}`;
    })
    .join("\n\n");

  const prTitleBlock = prTitle ? `\nThis is all one PR. PR title: "${prTitle}"\n` : "";

  const toneInstruction =
    tone === "release"
      ? "Write user-facing release notes: plain language, no internal jargon, focused on what changed for the people using the software."
      : "Write a technical CHANGELOG.md entry: concise and precise.";

  const prompt = `You are generating changelog bullet points from raw commit data. Some commit messages are uninformative (e.g. "fix", "wip") — in those cases, infer what actually changed from the file diffs instead.
${prTitleBlock}
${toneInstruction}

For each commit, respond with one bullet describing what changed, and a category. Some commits already have their category decided for you (marked "already decided, do not change") — use that exact value. For commits marked "undecided," pick the single best fit from: ${CATEGORIES.join(", ")}.
- "Breaking Changes": removes or changes existing behavior/API in a way that could break callers.
- "Features": adds new capability — new behavior, new prop/option/API, or support for something that didn't work before, even if scoped to one platform.
- "Fixes": corrects broken/incorrect existing behavior back to what it was supposed to do, with no new capability added.
- "Other": refactors, internal tooling, tests, docs, chores, or anything with no user-visible behavior change.
When undecided and genuinely ambiguous between Features and Other, prefer Features if the change affects what the software does or supports for any user, however small.

Respond with ONLY a JSON array, no other text, no markdown fences. Each element:
{"index": <commit index number>, "category": "<one of the four category strings exactly>", "bullet": "<one changelog bullet, no leading dash>"}

Commit data:
${commitBlocks}`;

  const res = await fetch(GEMINI_URL(process.env.GEMINI_API_KEY), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500, responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "[]";

  let entries;
  try {
    entries = JSON.parse(stripJsonFences(rawText));
  } catch {
    throw new Error("Model returned malformed output — try again.");
  }

  // Group into the four fixed headings, overriding with our code-decided
  // category wherever we had one (belt and suspenders — the model was told
  // not to change it, but this makes it impossible for it to slip through).
  const grouped = { "Breaking Changes": [], Features: [], Fixes: [], Other: [] };
  for (const entry of entries) {
    const idx = entry.index;
    const category = knownCategories[idx] || (CATEGORIES.includes(entry.category) ? entry.category : "Other");
    if (grouped[category] && entry.bullet) grouped[category].push(entry.bullet);
  }

  const sections = CATEGORIES.filter((cat) => grouped[cat].length > 0).map(
    (cat) => `### ${cat}\n${grouped[cat].map((b) => `- ${b}`).join("\n")}`
  );

  return sections.join("\n\n") || "No summarizable changes found.";
}
