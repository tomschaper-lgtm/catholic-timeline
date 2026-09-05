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
let VIOLATION_MIN = intEnv('VIOLATION_MIN', 41); // 41+ words by default: hard cap exceeded, must fix

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

// Abbreviations whose trailing period must never be read as a sentence end.
const ABBREVIATIONS = [
  'st','sts','mr','mrs','ms','dr','fr','frs','rev','msgr','card','bp','abp',
  'vs','etc','no','vol','ed','eds','pp','al','cf','ca','approx','messrs',
  'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec',
  'mt','ft','rd','blvd','ave','sr','jr','gen','col','capt','lt','maj','gov',
  'assn','dept','univ','co','corp','inc','ltd','bros'
];

// ---- HTML tag masking ---------------------------------------------------
// Replace every tag with a placeholder BEFORE sentence-splitting, so
// periods inside href URLs / attributes never get mistaken for sentence
// ends. Placeholder uses private-use Unicode chars that never occur in
// real prose, so it can't collide with anything in the article text.

function maskTags(html) {
  const tags = [];
  const masked = html.replace(/<[^>]+>/g, (m) => {
    tags.push(m);
    return `\uE000${tags.length - 1}\uE001`;
  });
  return { masked, tags };
}

function unmaskTags(text, tags) {
  return text.replace(/\uE000(\d+)\uE001/g, (_, i) => tags[Number(i)]);
}

// ---- abbreviation / decimal / initial / ellipsis protection ------------
// Temporarily swap protected periods for a placeholder char that will
// never trigger a sentence split, then restore real periods afterward.

const PLACEHOLDER_DOT = '\u2298'; // circled-slash, never appears in prose

function protectPeriods(text) {
  let out = text;
  // Ellipses first, so their dots aren't individually caught below.
  out = out.replace(/\.\.\./g, PLACEHOLDER_DOT.repeat(3));
  // Known abbreviations, case-insensitive, word-bounded.
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp(`\\b(${abbr})\\.`, 'gi');
    out = out.replace(re, (_, word) => `${word}${PLACEHOLDER_DOT}`);
  }
  // Single-letter initials: "C. S. Lewis", "W. H. Auden".
  out = out.replace(/\b([A-Z])\./g, `$1${PLACEHOLDER_DOT}`);
  // Decimal numbers: 3.5, 1.2 million, 40.5%.
  out = out.replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER_DOT}$2`);
  return out;
}

function restorePeriods(text) {
  return text.split(PLACEHOLDER_DOT).join('.');
}

// ---- sentence splitting ---------------------------------------------------

function splitSentences(protectedMasked) {
  // Grab runs of non-terminator chars ending in one-or-more terminators,
  // optionally followed by a closing quote mark and/or a masked closing
  // tag (very common right before </blockquote> — "...summarize."</blockquote>),
  // then whitespace or end of string. Trailing fragment with no terminator
  // at all is kept too, rather than dropped.
  const pattern = /[^.!?]*[.!?]+(?:["'\u2019\u201d]|\uE000\d+\uE001)*(?:\s+|$)|[^.!?]+$/g;
  const raw = protectedMasked.match(pattern) || [];
  const sentences = raw.map(s => s.trim()).filter(Boolean);

  // Safety net: a terminator immediately followed by something the
  // pattern above doesn't recognize (unusual punctuation, an edge case
  // not anticipated here) can otherwise cause a whole leading chunk to be
  // silently skipped by the regex engine rather than captured. That's
  // the one failure mode this tool cannot tolerate — missing a real
  // violation is worse than one oversized combined "sentence" flagged
  // for a human to look at. Verify reconstruction covers the input; if
  // not, fail safe by treating the whole paragraph as a single sentence.
  const reconstructedLen = sentences.join('').replace(/\s/g, '').length;
  const originalLen = protectedMasked.replace(/\s/g, '').length;
  if (sentences.length === 0 || reconstructedLen < originalLen * 0.98) {
    const whole = protectedMasked.trim();
    return whole ? [whole] : [];
  }

  return sentences;
}

// ---- word counting --------------------------------------------------------

function countWords(sentenceText, tags) {
  const unmasked = unmaskTags(sentenceText, tags).replace(/<[^>]+>/g, ' ');
  const words = unmasked
    .replace(/&[a-zA-Z]+;/g, ' ')
    .split(/\s+/)
    .filter(w => /[A-Za-z0-9]/.test(w));
  return words.length;
}

// ---- per-paragraph audit --------------------------------------------------

function stripListsForAudit(paragraph) {
  // <ul>/<ol> items are fragments, not narrated sentences in the usual
  // sense — exclude them from length scoring rather than false-flag them.
  return paragraph.replace(/<(ul|ol)>[\s\S]*?<\/\1>/g, ' ');
}

function auditParagraph(paragraph, sectionIndex, sectionHeading) {
  const forAudit = stripListsForAudit(paragraph);
  const { masked, tags } = maskTags(forAudit);
  const protectedText = protectPeriods(masked);
  const rawSentences = splitSentences(protectedText);

  const results = [];
  const seenTextCounts = {};

  for (const raw of rawSentences) {
    const wc = countWords(raw, tags);
    if (wc < REVIEW_MIN) continue;

    const restored = restorePeriods(raw);
    const fullText = unmaskTags(restored, tags).trim();
    if (!fullText) continue;

    // Track occurrence count of this exact sentence within the section,
    // so the @N addressing patches need is ready to hand.
    seenTextCounts[fullText] = (seenTextCounts[fullText] || 0) + 1;

    results.push({
      section: sectionIndex,
      heading: sectionHeading,
      text: fullText,
      wordCount: wc,
      severity: wc >= VIOLATION_MIN ? 'violation' : 'review',
      occurrence: seenTextCounts[fullText],
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
    const body = section.b || '';
    const paragraphs = body.split(/\n\n+/);
    paragraphs.forEach((para) => {
      const found = auditParagraph(para, idx + 1, section.h || '');
      flags.push(...found);
    });
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
