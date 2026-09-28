#!/usr/bin/env node
/**
 * sentence-length-audit.mjs
 * -------------------------
 * Scans data.json for narrated article prose (art.sections[].b ONLY —
 * never the `d` teaser, which is being retired) and flags sentences
 * that run long against the target in content-authoring-skill.md:
 *   - 15–25 words is the target
 *   - up to 35 is fine "when the thought genuinely needs it"
 *   - 40 words is the hard cap, never to be exceeded
 *
 * This does no AI calls and makes no judgment calls about how to fix
 * anything — it just finds candidates and hands them over verbatim,
 * ready to be copy-pasted into a `patches` block. Pure text processing,
 * safe to run in a GitHub Action on workflow_dispatch.
 *
 * Usage:
 *   node sentence-length-audit.mjs <path-to-data.json> [output-dir]
 *
 * Tunables (ENTITIES_PER_BATCH, REVIEW_MIN, VIOLATION_MIN, SKIP_RECORDED)
 * are read from env vars, so the workflow's dispatch inputs can override
 * them per run without touching this file — see the "tunables" block
 * below for the defaults, which match the content-authoring-skill.md
 * targets.
 *
 * Output (all written to <output-dir>, default ./automation/reports/sentence-audit):
 *   batch-001.json ... batch-NNN.json   entities with flags, ~12 per file — excludes
 *                                       already-recorded entities when SKIP_RECORDED
 *                                       is on (the default), since fixing prose before
 *                                       its first recording is the normal workflow
 *   index.json                          manifest: batch list, counts, totals
 *   needs-rerecord.json                 entities that HAVE audio and ALSO have flags —
 *                                       always computed from the full scan, regardless
 *                                       of SKIP_RECORDED, since this is the one place
 *                                       that signal is meant to surface
 *
 * Batch files are meant to be consumed and deleted one at a time in chat —
 * each is sized to stay well within a single working conversation.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
// v502: word counting and sentence splitting come from ../lib/sentence-rules.cjs (SentenceRules) — the
// same file index.html embeds and sentence-reword.mjs imports. This script used to carry its own
// splitter (a fifth definition), which disagreed with the app in both directions: it treated a
// Roman-numeral ending like "Pope Pius X." or "Clement I." as an initial and merged the next sentence
// into it, protected "..." even at a real sentence end, and did not break at a <blockquote> — 10
// entries it called violations are not; it also did not treat . ! ? followed by a lowercase word
// correctly. Its old abbreviation list, tag-masking and period-protection code is gone.
import SR from '../lib/sentence-rules.cjs';

// ---- tunables ----------------------------------------------------------
// All three can be overridden per run via env vars — the workflow passes
// these through from its workflow_dispatch inputs (see the .yml). Run the
// script directly (no env vars set) and you get exactly the original
// defaults back, unchanged.
//   ENTITIES_PER_BATCH — how many flagged entities go in each batch file
//   REVIEW_MIN         — word count where a sentence starts getting flagged at all
//   VIOLATION_MIN      — word count where a flagged sentence is "violation" severity
//                         (anything flagged but under this is "review" severity)
function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const ENTITIES_PER_BATCH = intEnv('ENTITIES_PER_BATCH', 12); // within the 10–15 range originally requested
let REVIEW_MIN = intEnv('REVIEW_MIN', 31);     // 31–40 words by default: allowed occasionally, worth a look
let VIOLATION_MIN = intEnv('VIOLATION_MIN', SR.LIMIT + 1); // 41+ words by default (SR.LIMIT is 40): hard cap exceeded, must fix

// A misconfigured pair (e.g. violation_min set below review_min) would
// silently make every "review" sentence a "violation" or vice versa —
// fail loudly and self-correct rather than produce a confusing report.
if (VIOLATION_MIN <= REVIEW_MIN) {
  console.warn(`VIOLATION_MIN (${VIOLATION_MIN}) must be greater than REVIEW_MIN (${REVIEW_MIN}) — bumping VIOLATION_MIN to ${REVIEW_MIN + 1} for this run.`);
  VIOLATION_MIN = REVIEW_MIN + 1;
}

// Only "true" (case-insensitive) reads as true — an unset or empty env var
// falls back to `fallback` rather than JS's usual falsy-string surprises
// (Boolean("false") is true), which matters here since the workflow always
// passes this through as the literal string "true"/"false".
function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return String(v).trim().toLowerCase() === 'true';
}
// Default ON: the normal use of this audit is finding prose to fix BEFORE
// an entry's first recording, so an entry that already has audio isn't
// something to hand over in today's batch. It's never dropped entirely,
// though — needs-rerecord.json (below) tracks exactly this case regardless
// of this flag, so turning SKIP_RECORDED off is only ever needed if you
// specifically want already-recorded entries mixed back into the batches.
const SKIP_RECORDED = boolEnv('SKIP_RECORDED', true);

// ---- per-section audit ---------------------------------------------------
// One section body at a time. SR.analyzeSection ends a sentence at every blank line and every
// <li>/<p>/<blockquote> boundary, so a list item is scored as its own unit instead of being
// dropped (the old stripListsForAudit) — the app's Progress and Add Task count list items too.

function auditSection(body, sectionIndex, sectionHeading) {
  const results = [];
  for (const unit of SR.analyzeSection(body)) {
    const wc = unit.words;
    if (wc < REVIEW_MIN) continue;
    const fullText = unit.html.trim(); // exact verbatim substring, tags included — ready for a patch
    if (!fullText) continue;
    results.push({
      section: sectionIndex,
      heading: sectionHeading,
      text: fullText,
      wordCount: wc,
      severity: wc >= VIOLATION_MIN ? 'violation' : 'review',
      occurrence: 1,
      inBlockquote: /blockquote/.test(fullText)
    });
  }
  return results;
}

function auditEntry(entry) {
  const sections = entry?.art?.sections;
  if (!Array.isArray(sections)) return [];

  const flags = [];
  sections.forEach((section, idx) => {
    flags.push(...auditSection(section.b || '', idx + 1, section.h || ''));
  });

  // Re-number `occurrence` per exact text across the WHOLE article (not
  // just within one paragraph loop), since that's what patches addressing
  // actually needs — the article-wide occurrence of that verbatim text.
  const counts = {};
  for (const f of flags) {
    counts[f.text] = (counts[f.text] || 0) + 1;
  }
  const seenSoFar = {};
  for (const f of flags) {
    seenSoFar[f.text] = (seenSoFar[f.text] || 0) + 1;
    f.occurrence = seenSoFar[f.text];
    f.totalOccurrences = counts[f.text];
  }

  return flags;
}

// ---- main -------------------------------------------------------------

function main() {
  const dataPath = process.argv[2];
  const outDir = process.argv[3] || './automation/reports/sentence-audit';

  if (!dataPath) {
    console.error('Usage: node sentence-length-audit.mjs <path-to-data.json> [output-dir]');
    process.exit(1);
  }

  const raw = readFileSync(dataPath, 'utf8');
  const data = JSON.parse(raw);
  const entries = data.entries || data; // tolerate either {entries:[...]} or a bare array

  mkdirSync(outDir, { recursive: true });

  const flaggedEntities = [];
  for (const entry of entries) {
    const flags = auditEntry(entry);
    if (flags.length === 0) continue;

    const violationCount = flags.filter(f => f.severity === 'violation').length;
    const reviewCount = flags.filter(f => f.severity === 'review').length;

    flaggedEntities.push({
      id: entry.id,
      name: entry.n,
      type: entry.t,
      hasAudio: Boolean(entry.audio),
      audioPath: entry.audio || null,
      violationCount,
      reviewCount,
      flags
    });
  }

  // needs-rerecord.json always reflects the FULL scan, independent of
  // SKIP_RECORDED — it exists specifically to surface already-recorded
  // entities whose text has grown a long sentence since narration, so
  // excluding them here (even when they're excluded from the batches
  // below) would defeat the one thing this list is for.
  const needsRerecord = flaggedEntities
    .filter(e => e.hasAudio)
    .map(e => ({
      id: e.id,
      name: e.name,
      audioPath: e.audioPath,
      violationCount: e.violationCount,
      reviewCount: e.reviewCount
    }));

  // The batch queue is what you actually work through in chat — with
  // SKIP_RECORDED on (the default), that's unrecorded entries only, since
  // fixing prose before the first recording is the normal flow and an
  // already-recorded entry needing a fix is the separate needs-rerecord
  // case above, not more of today's batch.
  const entitiesForBatching = SKIP_RECORDED
    ? flaggedEntities.filter(e => !e.hasAudio)
    : flaggedEntities;
  const recordedEntitiesSkipped = flaggedEntities.length - entitiesForBatching.length;

  // Stable order: as encountered in data.json (roughly chronological/thematic
  // already, which keeps a batch's worth of entities recognizable as a set).
  const batches = [];
  for (let i = 0; i < entitiesForBatching.length; i += ENTITIES_PER_BATCH) {
    batches.push(entitiesForBatching.slice(i, i + ENTITIES_PER_BATCH));
  }

  const batchFiles = [];
  batches.forEach((batch, i) => {
    const num = String(i + 1).padStart(3, '0');
    const filename = `batch-${num}.json`;
    const totalFlags = batch.reduce((sum, e) => sum + e.flags.length, 0);
    const totalViolations = batch.reduce((sum, e) => sum + e.violationCount, 0);
    writeFileSync(path.join(outDir, filename), JSON.stringify(batch, null, 1));
    batchFiles.push({
      file: filename,
      entityCount: batch.length,
      entityIds: batch.map(e => e.id),
      totalFlags,
      totalViolations
    });
  });

  writeFileSync(
    path.join(outDir, 'needs-rerecord.json'),
    JSON.stringify(needsRerecord, null, 1)
  );

  const index = {
    generatedAt: new Date().toISOString(),
    sourceEntryCount: entries.length,
    // Full-scan totals — everything flagged, whether or not it made it into
    // a batch file this run. Unchanged meaning from before SKIP_RECORDED
    // existed, so anything already reading these fields keeps seeing the
    // whole picture.
    flaggedEntityCount: flaggedEntities.length,
    totalViolations: flaggedEntities.reduce((s, e) => s + e.violationCount, 0),
    totalReviewFlags: flaggedEntities.reduce((s, e) => s + e.reviewCount, 0),
    entitiesNeedingRerecord: needsRerecord.length,
    // What actually went into today's batch queue.
    skipRecorded: SKIP_RECORDED,
    recordedEntitiesSkipped: recordedEntitiesSkipped,
    batchedEntityCount: entitiesForBatching.length,
    batchedViolations: entitiesForBatching.reduce((s, e) => s + e.violationCount, 0),
    batchedReviewFlags: entitiesForBatching.reduce((s, e) => s + e.reviewCount, 0),
    batchCount: batches.length,
    entitiesPerBatch: ENTITIES_PER_BATCH,
    thresholds: { reviewMin: REVIEW_MIN, violationMin: VIOLATION_MIN },
    batches: batchFiles
  };
  writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));

  // Console summary for the Action log.
  console.log(`Scanned ${entries.length} entries.`);
  console.log(`Flagged ${flaggedEntities.length} entities total (${needsRerecord.length} already have audio).`);
  if (SKIP_RECORDED && recordedEntitiesSkipped > 0) {
    console.log(`Skipping ${recordedEntitiesSkipped} already-recorded entit${recordedEntitiesSkipped === 1 ? 'y' : 'ies'} from the batch queue (SKIP_RECORDED=true) \u2014 see needs-rerecord.json.`);
  }
  console.log(`Batched ${entitiesForBatching.length} entities across ${batches.length} batch file(s).`);
  console.log(`  Entities per batch: ${ENTITIES_PER_BATCH}`);
  console.log(`  Violations (>=${VIOLATION_MIN} words) in batch queue: ${index.batchedViolations}`);
  console.log(`  Review-range (${REVIEW_MIN}-${VIOLATION_MIN - 1} words) in batch queue: ${index.batchedReviewFlags}`);
  console.log(`  Entities with audio needing re-record: ${needsRerecord.length}`);
  console.log(`Output written to ${outDir}/`);
}

main();
