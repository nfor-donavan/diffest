// Uses Google's Gemini API (free tier available at aistudio.google.com/apikey).
// No SDK needed — just a plain fetch call.

const GEMINI_MODEL = "gemini-3.5-flash-lite"; // higher free-tier daily quota than full Flash models
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// Very rough heuristic for "is this commit message actually useful,
// or do we need to fall back to reading the diff?"
const USELESS_MESSAGE_PATTERNS = [
  /^wip$/i,
  /^fix$/i,
  /^update$/i,
  /^stuff$/i,
  /^\.+$/,
  /^minor$/i,
  /^tmp$/i,
];

export function isUselessMessage(message) {
  const firstLine = message.split("\n")[0].trim();
  if (firstLine.length < 6) return true;
  return USELESS_MESSAGE_PATTERNS.some((re) => re.test(firstLine));
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
export async function summarizeChangelog(
  commits,
  { tone = "technical", prTitle = "" } = {},
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey and add it to backend/.env",
    );
  }

  const commitBlocks = commits
    .map((c, i) => {
      const diffSummary = (c.files || [])
        .slice(0, 8) // cap to keep prompt size sane
        .map(
          (f) =>
            `  - ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})${f.patch ? `\n    patch:\n${f.patch.slice(0, 600)}` : ""}`,
        )
        .join("\n");
      return `Commit ${i + 1} (${c.sha?.slice(0, 7) || "n/a"}):\nmessage: ${c.message}\nfiles:\n${diffSummary || "  (no file data)"}`;
    })
    .join("\n\n");

  const prTitleBlock = prTitle
    ? `\nPR title (this is often more reliable than individual commit messages, e.g. after a squash-merge): "${prTitle}"\n`
    : "";

  const toneInstruction =
    tone === "release"
      ? "Write user-facing release notes: plain language, no internal jargon, focused on what changed for the people using the software."
      : "Write a technical CHANGELOG.md entry: concise, precise, grouped under standard headings.";

  const prompt = `You are generating a changelog from raw commit data. Some commit messages are uninformative (e.g. "fix", "wip") — in those cases, infer what actually changed from the file diffs instead.
${prTitleBlock}
${toneInstruction}

Group entries under these headings, omitting any that are empty:
- ### Breaking Changes — removes or changes existing behavior/API in a way that could break callers.
- ### Features — adds new capability: new behavior, new prop/option/API, support for something that didn't work before (even if scoped to one platform).
- ### Fixes — corrects broken/incorrect existing behavior back to what it was supposed to do, with no new capability added.
- ### Other — refactors, internal tooling, tests, docs, chores, and anything with no user-visible behavior change at all.

HARD RULE, applied before any other judgment: if EITHER the PR title (if given above) OR a commit's message begins with "feat" or "feature" (case-insensitive, with or without a scope like "feat(ios):"), classify it under Features. Do not reclassify based on your own reading of the diff — the author already told you what kind of change this is. This rule overrides everything else in this list. The same applies to a "fix"/"fix(...)" prefix for Fixes.

For commits with no such prefix on either the PR title or the commit message, use the diff to decide between the four categories above. When genuinely ambiguous, prefer Features over Other if the change affects what the software does or supports for any user, however small.

Output only the changelog markdown, nothing else.

Commit data:
${commitBlocks}`;

  const res = await fetch(GEMINI_URL(process.env.GEMINI_API_KEY), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return text;
}
