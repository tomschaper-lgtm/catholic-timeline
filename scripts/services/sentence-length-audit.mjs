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
 * Output (all written to <output-dir>, default ./automation/reports/sentence-audit):
 *   batch-001.json ... batch-NNN.json   entities with flags, ~12 entities per file
 *   index.json                          manifest: batch list, counts, totals
 *   needs-rerecord.json                 entities that HAVE audio and ALSO have flags
 *
 * Batch files are meant to be consumed and deleted one at a time in chat —
 * each is sized to stay well within a single working conversation.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

// ---- tunables ----------------------------------------------------------

const ENTITIES_PER_BATCH = 12; // within the 10–15 range requested
const REVIEW_MIN = 31;   // 31–40 words: allowed occasionally, worth a look
const VIOLATION_MIN = 41; // 41+ words: hard cap exceeded, must fix

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

  // Stable order: as encountered in data.json (roughly chronological/thematic
  // already, which keeps a batch's worth of entities recognizable as a set).
  const batches = [];
  for (let i = 0; i < flaggedEntities.length; i += ENTITIES_PER_BATCH) {
    batches.push(flaggedEntities.slice(i, i + ENTITIES_PER_BATCH));
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

  const needsRerecord = flaggedEntities
    .filter(e => e.hasAudio)
    .map(e => ({
      id: e.id,
      name: e.name,
      audioPath: e.audioPath,
      violationCount: e.violationCount,
      reviewCount: e.reviewCount
    }));

  writeFileSync(
    path.join(outDir, 'needs-rerecord.json'),
    JSON.stringify(needsRerecord, null, 1)
  );

  const index = {
    generatedAt: new Date().toISOString(),
    sourceEntryCount: entries.length,
    flaggedEntityCount: flaggedEntities.length,
    totalViolations: flaggedEntities.reduce((s, e) => s + e.violationCount, 0),
    totalReviewFlags: flaggedEntities.reduce((s, e) => s + e.reviewCount, 0),
    entitiesNeedingRerecord: needsRerecord.length,
    batchCount: batches.length,
    entitiesPerBatch: ENTITIES_PER_BATCH,
    thresholds: { reviewMin: REVIEW_MIN, violationMin: VIOLATION_MIN },
    batches: batchFiles
  };
  writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));

  // Console summary for the Action log.
  console.log(`Scanned ${entries.length} entries.`);
  console.log(`Flagged ${flaggedEntities.length} entities across ${batches.length} batch file(s).`);
  console.log(`  Violations (>=${VIOLATION_MIN} words): ${index.totalViolations}`);
  console.log(`  Review-range (${REVIEW_MIN}-${VIOLATION_MIN - 1} words): ${index.totalReviewFlags}`);
  console.log(`  Entities with audio needing re-record: ${needsRerecord.length}`);
  console.log(`Output written to ${outDir}/`);
}

main();
