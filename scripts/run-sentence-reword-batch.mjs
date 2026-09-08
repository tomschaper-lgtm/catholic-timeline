#!/usr/bin/env node
/**
 * run-sentence-reword-batch.mjs
 *
 * One-shot version of the sentence_reword workflow, matching the
 * start-year / category / count picker used for the photo-generation
 * queue. No entity ids to gather by hand.
 *
 * Walking forward from START_YEAR (chronological order), filtered to
 * CATEGORY (a type key s/c/p/m/u/e, or "all"), it selects up to COUNT
 * entities that:
 *   1. are not already in workQueue.sentenceReword.json in any status
 *      (never re-propose the same fix), and
 *   2. have no audio recorded yet (never trigger an audio purge in an
 *      automatic sweep — entities that already have narration are left
 *      for a separate, deliberate pass), and
 *   3. actually contain a sentence over 40 words outside any paragraph
 *      with an entry: cross-reference link.
 *
 * Selected entities are queued, claimed, sent to Claude for proposed
 * splits, and left as "awaiting_review" — same review step as before,
 * nothing is merged or purged until a human approves in the CMS panel.
 *
 * Env vars: ANTHROPIC_API_KEY (required), START_YEAR, CATEGORY, COUNT.
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const DATA_PATH = "data.json";
const QUEUE_PATH = "workQueue.sentenceReword.json";
const MODEL = "claude-sonnet-5";
const MAX_WORDS = 40;

const startYear = parseInt(process.env.START_YEAR || "0", 10);
const category = (process.env.CATEGORY || "all").trim();
const count = parseInt(process.env.COUNT || "10", 10);
const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function saveJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}
function commit(message) {
  execSync(`git add ${QUEUE_PATH}`, { stdio: "inherit" });
  execSync(`git config user.name "reword-bot"`, { stdio: "inherit" });
  execSync(`git config user.email "reword-bot@users.noreply.github.com"`, { stdio: "inherit" });
  try {
    execSync(`git commit -m "${message}"`, { stdio: "inherit" });
    execSync(`git push`, { stdio: "inherit" });
  } catch (e) {
    console.log("Nothing to commit or push failed:", e.message);
  }
}

function isLinkedParagraph(paragraph) {
  return /<a\s+href=["']entry:/i.test(paragraph);
}

// Rough heuristic only — a cheap pre-filter, not the final judgment.
// Claude does the real sentence-boundary reasoning in the actual pass;
// this just decides who's worth sending.
function hasOverLongSentence(entity) {
  if (!entity.art || !entity.art.sections) return false;
  for (const section of entity.art.sections) {
    for (const paragraph of section.b.split("\n\n")) {
      if (isLinkedParagraph(paragraph)) continue;
      const plain = paragraph.replace(/<[^>]+>/g, "");
      const sentences = plain.split(/(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        const words = sentence.trim().split(/\s+/).filter(Boolean).length;
        if (words > MAX_WORDS) return true;
      }
    }
  }
  return false;
}

function buildPrompt(entity) {
  const sections = entity.art.sections.map((s, i) => {
    const paragraphs = s.b.split("\n\n").map((p, j) => {
      const skip = isLinkedParagraph(p);
      return `  [section ${i}, paragraph ${j}${skip ? ", SKIP - contains entry: link, do not touch" : ""}]\n  ${p}`;
    });
    return `SECTION ${i} — "${s.h}"\n${paragraphs.join("\n\n")}`;
  });

  return `You are doing a mechanical sentence-length pass on a saints/history article. Do NOT do any research, do NOT change any fact, date, name, quote, or the certainty level of any claim (e.g. never turn "tradition holds" into a flat statement, and never turn a flat statement into a hedge). Your only job is splitting sentences that are too long into two or more shorter sentences that together say exactly the same thing.

Rule: any sentence over ${MAX_WORDS} words must be split. Sentences at or under ${MAX_WORDS} words must be left completely untouched — do not "improve" or rephrase anything that isn't over the limit.

Paragraphs marked SKIP contain an in-app cross-reference link (an <a href="entry:...") and must be left completely untouched, even if they contain a long sentence — report nothing for those paragraphs.

Article:
${sections.join("\n\n")}

Respond with ONLY a JSON array (no prose, no markdown fences) of objects, one per sentence you are changing:
[
  {
    "sectionIndex": 0,
    "before": "<verbatim over-length sentence, copied exactly including punctuation>",
    "after": "<the same content as two or more sentences, each ${MAX_WORDS} words or fewer>"
  }
]
If nothing in the article needs changing, respond with an empty array: []`;
}

async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const text = json.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const usage = json.usage || {};
  const tokensUsed = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const cleaned = text.replace(/^```json\s*|```$/g, "").trim();
  return { pairs: JSON.parse(cleaned), tokensUsed };
}

async function main() {
  const data = loadJson(DATA_PATH);
  let queue;
  try {
    queue = loadJson(QUEUE_PATH);
  } catch {
    queue = { v: 1, items: [] };
  }
  const alreadyQueued = new Set(queue.items.map((i) => i.entityId));

  const candidates = data.entries
    .filter((e) => e.y >= startYear)
    .filter((e) => category === "all" || e.t === category)
    .sort((a, b) => a.y - b.y)
    .filter((e) => !alreadyQueued.has(e.id))
    .filter((e) => !e.audio) // already-recorded entities are left for a deliberate pass
    .filter((e) => hasOverLongSentence(e));

  const selected = candidates.slice(0, count);

  if (selected.length === 0) {
    console.log(
      `No qualifying entities found from year ${startYear}, category "${category}". ` +
        `(Either none exceed ${MAX_WORDS} words, all are already recorded, or all are already queued.)`
    );
    return;
  }

  console.log(`Selected ${selected.length}: ${selected.map((e) => e.id).join(", ")}`);

  const newItems = selected.map((e) => ({
    id: `reword-${e.id}-${Date.now()}`,
    entityId: e.id,
    workflowType: "sentence_reword",
    status: "in_progress",
    runId,
    payload: { startYear, category, count },
    result: null,
    provider: null,
    tokensUsed: 0,
    error: null,
    queuedAt: new Date().toISOString(),
  }));
  queue.items.push(...newItems);
  saveJson(QUEUE_PATH, queue);
  commit(`Reword batch: claimed ${newItems.length} item(s) from year ${startYear}, category ${category}`);

  let totalTokens = 0;
  let succeeded = 0;
  for (const item of newItems) {
    const entity = data.entries.find((e) => e.id === item.entityId);
    try {
      const prompt = buildPrompt(entity);
      const { pairs, tokensUsed } = await callClaude(prompt);
      item.result = { pairs };
      item.tokensUsed = tokensUsed;
      item.status = "awaiting_review";
      totalTokens += tokensUsed;
      succeeded++;
    } catch (e) {
      item.status = "error";
      item.error = String(e.message || e);
    }
  }

  saveJson(QUEUE_PATH, queue);
  commit(`Reword batch: ${succeeded}/${newItems.length} processed, ${totalTokens} tokens`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
