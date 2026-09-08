#!/usr/bin/env node
/**
 * enqueue-sentence-reword.mjs
 *
 * Adds entities to workQueue.sentenceReword.json with status "queued".
 * Run locally or in an Action step, then commit the updated queue file.
 *
 * Usage:
 *   node scripts/enqueue-sentence-reword.mjs                # queue every entity in data.json
 *   node scripts/enqueue-sentence-reword.mjs id1,id2,id3     # queue only these ids
 *   node scripts/enqueue-sentence-reword.mjs --force id1     # re-queue even if already present
 *
 * Skips (unless --force) any entity that already has a queue item in any
 * status ("queued" / "in_progress" / "awaiting_review" / "done" / "error" /
 * "cancelled") so re-running this is safe.
 */
import { readFileSync, writeFileSync } from "fs";

const DATA_PATH = "data.json";
const QUEUE_PATH = "workQueue.sentenceReword.json";

const args = process.argv.slice(2);
const force = args.includes("--force");
const idArg = args.find((a) => !a.startsWith("--"));
const requestedIds = idArg ? idArg.split(",").map((s) => s.trim()) : null;

const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
let queue;
try {
  queue = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
} catch {
  queue = { v: 1, items: [] };
}

const existingIds = new Set(queue.items.map((i) => i.entityId));
const candidateIds = requestedIds || data.entries.map((e) => e.id);

let added = 0;
for (const id of candidateIds) {
  const entity = data.entries.find((e) => e.id === id);
  if (!entity) {
    console.warn(`Skip ${id}: not found in data.json`);
    continue;
  }
  if (!entity.art || !entity.art.sections || entity.art.sections.length === 0) {
    continue; // nothing to reword
  }
  if (existingIds.has(id) && !force) {
    continue;
  }
  if (existingIds.has(id) && force) {
    queue.items = queue.items.filter((i) => i.entityId !== id);
  }
  queue.items.push({
    id: `reword-${id}-${Date.now()}`,
    entityId: id,
    workflowType: "sentence_reword",
    status: "queued",
    runId: null,
    payload: {},
    result: null,
    provider: null,
    tokensUsed: 0,
    error: null,
    queuedAt: new Date().toISOString(),
  });
  added++;
}

writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
console.log(`Queued ${added} entit${added === 1 ? "y" : "ies"} for sentence_reword.`);
