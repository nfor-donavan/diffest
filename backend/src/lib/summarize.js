// Uses Google's Gemini API (free tier available at aistudio.google.com/apikey).
// No SDK needed — just a plain fetch call.

const GEMINI_MODEL = "gemini-3.6-flash"; // current stable Flash model (GA July 2026)
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// Very rough heuristic for "is this commit message actually useful,
// or do we need to fall back to reading the diff?"
const USELESS_MESSAGE_PATTERNS = [/^wip$/i, /^fix$/i, /^update$/i, /^stuff$/i, /^\.+$/, /^minor$/i, /^tmp$/i];

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
 */
export async function summarizeChangelog(commits, { tone = "technical" } = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey and add it to backend/.env");
  }

  const commitBlocks = commits
    .map((c, i) => {
      const diffSummary = (c.files || [])
        .slice(0, 8) // cap to keep prompt size sane
        .map((f) => `  - ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})${f.patch ? `\n    patch:\n${f.patch.slice(0, 600)}` : ""}`)
        .join("\n");
      return `Commit ${i + 1} (${c.sha?.slice(0, 7) || "n/a"}):\nmessage: ${c.message}\nfiles:\n${diffSummary || "  (no file data)"}`;
    })
    .join("\n\n");

  const toneInstruction =
    tone === "release"
      ? "Write user-facing release notes: plain language, no internal jargon, focused on what changed for the people using the software."
      : "Write a technical CHANGELOG.md entry: concise, precise, grouped under standard headings.";

  const prompt = `You are generating a changelog from raw commit data. Some commit messages are uninformative (e.g. "fix", "wip") — in those cases, infer what actually changed from the file diffs instead.

${toneInstruction}

Group entries under these headings, omitting any that are empty:
- ### Breaking Changes
- ### Features
- ### Fixes
- ### Other

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
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return text;
}
