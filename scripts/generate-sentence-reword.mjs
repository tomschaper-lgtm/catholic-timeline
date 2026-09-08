#!/usr/bin/env node
/**
 * generate-sentence-reword.mjs
 *
 * The per-workflow handler for "sentence_reword". Run inside the GitHub
 * Action (see .github/workflows/sentence-reword.yml). Requires
 * ANTHROPIC_API_KEY as an env var.
 *
 * Steps:
 *   1. Load the queue, filter to status "queued".
 *   2. Claim a batch (mark in_progress + runId) and commit that claim
 *      immediately, before any AI calls — see content-pipeline-vision.md
 *      "Claiming (race prevention)".
 *   3. For each claimed item, build a reword prompt from the entity's
 *      current art.sections, call Claude, and store the proposed
 *      before/after sentence pairs on the queue item.
 *   4. Commit the results.
 *
 * Scope rules enforced in the prompt (see content-authoring-skill.md +
 * chat spec):
 *   - Only art.sections[].b is touched. quotes/facts are never sent.
 *   - Any paragraph containing an `entry:` link is left untouched
 *     (paragraph-level skip, not section-level).
 *   - Target: no sentence over 40 words. Meaning and certainty-tier
 *     wording (Scripture / early testimony / tradition / legend) must be
 *     preserved exactly — split the sentence, never reword the epistemics.
 *   - New entries never enter this queue (enforced by enqueue script,
 *     not here, but the prompt still only touches what's over the limit).
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const DATA_PATH = "data.json";
const QUEUE_PATH = "workQueue.sentenceReword.json";
const MODEL = "claude-sonnet-5";
const MAX_WORDS = 40;

const batchSize = parseInt(process.env.BATCH_SIZE || "10", 10);
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
  // This script only ever writes the queue file — data.json is untouched
  // until a human resolves an item in the CMS (Approve / Approve & Record).
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

// A paragraph is off-limits if it contains an in-app cross-reference link.
function isLinkedParagraph(paragraph) {
  return /<a\s+href=["']entry:/i.test(paragraph);
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
  const queue = loadJson(QUEUE_PATH);
  const eligible = queue.items.filter((i) => i.status === "queued");
  const batch = eligible.slice(0, batchSize);

  if (batch.length === 0) {
    console.log("No queued items. Nothing to do.");
    return;
  }

  // Claim immediately, before any AI calls.
  for (const item of batch) {
    item.status = "in_progress";
    item.runId = runId;
  }
  saveJson(QUEUE_PATH, queue);
  commit(`Reword batch: claimed ${batch.length} item(s)`);

  const data = loadJson(DATA_PATH);
  let totalTokens = 0;
  let succeeded = 0;

  for (const item of batch) {
    const entity = data.entries.find((e) => e.id === item.entityId);
    if (!entity || !entity.art || !entity.art.sections) {
      item.status = "error";
      item.error = "Entity not found or has no art.sections";
      continue;
    }
    try {
      const prompt = buildPrompt(entity);
      const { pairs, tokensUsed } = await callClaude(prompt);
      item.result = { pairs };
      item.tokensUsed = tokensUsed;
      item.status = "awaiting_review";
      item.error = null;
      totalTokens += tokensUsed;
      succeeded++;
    } catch (e) {
      item.status = "error";
      item.error = String(e.message || e);
    }
  }

  saveJson(QUEUE_PATH, queue);
  commit(`Reword batch: ${succeeded}/${batch.length} processed, ${totalTokens} tokens`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
