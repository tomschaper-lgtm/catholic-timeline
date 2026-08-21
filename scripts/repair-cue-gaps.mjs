// Finds and repairs cue problems in already-generated audioTiming files.
// Two different problems, one pass:
//
// 1) TEXT DRIFT — a cue exists, its timing is fine, but its stored `text`
//    no longer matches the article word-for-word: a stray leaked quote
//    character, a straight vs. curly quote, an em-dash vs. hyphen, a double
//    space, a cross-reference-link punctuation artifact (v195). None of
//    these mean the sentence is missing — they mean the cue's text field is
//    stale. Fix: once a cue is matched to its sentence (see "loose
//    matching" below), overwrite `text` with the current, exact article
//    text. Timing is untouched.
//
// 2) GENUINE GAPS — a sentence IS narrated in the audio (and IS present in
//    the article) but has no cue at all, because the OLD sentence splitter
//    in generate-audio.mjs silently dropped any sentence ending in a
//    quotation mark immediately followed by terminal punctuation — e.g.
//    `...he was to name the child Jesus, "for he will save his people from
//    their sins."` — see scripts/lib/text.mjs for the fixed splitter, which
//    prevents this for anything narrated from now on. This script recovers
//    the missing cue's timing from its neighbors (see below) rather than
//    re-calling ElevenLabs, since the audio for it already exists.
//
// LOOSE MATCHING: a timing file's cue and the article's current sentence
// are considered "the same sentence" if they agree once everything except
// letters and digits is stripped (normalizeLoose, in lib/text.mjs) — so
// punctuation/quote-style/whitespace differences never masquerade as a
// missing sentence. Only genuine wording differences (or a sentence with no
// counterpart at all) fail to match. This is deliberately generous: it
// catches every case in category 1 above, INCLUDING the leaked-quote
// artifact from category 2's own bug — a cue starting with a stray `"`
// still loose-matches the sentence it belongs to and gets its text
// corrected automatically, no special-case code needed for that anymore.
//
// GAP TIMING RECONSTRUCTION, once a sentence truly has no matching cue:
//   - Sandwiched between two ordinary sentence cues in the same section:
//     exact. Sentences within a section body are narrated back-to-back with
//     no inserted silence (only heading→body and section→section get a
//     deliberate pause per generate-audio.mjs), so the missing sentence's
//     start is simply the previous cue's end, its end the next cue's start.
//   - First sentence in its section (right after the heading): the gap also
//     contains the heading→body pause, not recorded per-entry anywhere — so
//     this script assumes the same predictable default the generation
//     workflow uses (heading_pause_ms / section_pause_ms below, overridable
//     if a specific past run used something else).
//   - Two or more consecutive missing sentences: the recovered span is
//     split between them proportionally by word count, since there's no
//     other signal available to place the internal boundary — noted in the
//     log as an estimate.
//
// Anything the script can't anchor with real confidence — no nearby resync
// point in the expected-sentence list (more likely a genuine text edit than
// a splitter-dropped sentence), or an implied speaking rate outside a
// normal narration range — is left alone and flagged in the log rather than
// guessed at.
//
// Usage (normally via the "Repair Audio Timing Gaps" Action):
//   node scripts/repair-cue-gaps.mjs
// Env vars (all optional):
//   IDS               comma-separated entry ids to check; blank = every
//                      entry with a timing file (audioTiming explicitly set,
//                      or derivable from its audio path per the app's own
//                      convention)
//   DRY_RUN            'true' (default) previews without writing; 'false'
//                      writes the repaired timing files
//   HEADING_PAUSE_MS   default 500 — anchors a section's first missing
//                      sentence only
//   SECTION_PAUSE_MS   default 700 — anchors a section's last missing
//                      sentence only

import fs from 'node:fs/promises';
import { stripHtml, splitSentences, normalizeLoose } from './lib/text.mjs';

const DATA_PATH = 'data.json';
const LOG_PATH = 'cue-repair-log.csv';
const LOG_HEADERS = ['id', 'section', 'kind', 'text', 'start', 'end', 'note'];

const idFilter = (process.env.IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const dryRun = String(process.env.DRY_RUN ?? 'true') === 'true';
const HEADING_PAUSE_SEC = (parseInt(process.env.HEADING_PAUSE_MS || '500', 10) || 0) / 1000;
const SECTION_PAUSE_SEC = (parseInt(process.env.SECTION_PAUSE_MS || '700', 10) || 0) / 1000;

function round2(n) { return Math.round(n * 100) / 100; }

// Mirrors index.html's own deriveTimingPath() exactly — since v194, most
// entries DON'T carry an explicit audioTiming field at all; the path is
// derived from the audio path the same way every time (same folder, same
// base name, .json instead of .mp3/.wav). Checking entry.audioTiming alone
// misses almost everything — this is what the app itself falls back to, so
// the repair script needs to fall back the same way or it silently skips
// the majority of entries that actually have a timing file on disk.
function deriveTimingPath(audioPath) {
  if (!audioPath) return null;
  const m = audioPath.match(/\.[a-z0-9]+$/i);
  if (!m) return null;
  return audioPath.slice(0, -m[0].length) + '.json';
}
function resolveTimingPath(entry) {
  return entry.audioTiming || deriveTimingPath(entry.audio) || null;
}

function sectionParts(entry) {
  const sections = (entry.art && entry.art.sections) || [];
  return sections.map(s => ({
    heading: stripHtml(s.h || '').replace(/\s+/g, ' ').trim(),
    body: stripHtml(s.b || '').replace(/\s+/g, ' ').trim()
  }));
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function ensureLogHeader() {
  try { await fs.access(LOG_PATH); }
  catch { await fs.writeFile(LOG_PATH, LOG_HEADERS.join(',') + '\n'); }
}
async function appendLogRow(row) {
  await fs.appendFile(LOG_PATH, LOG_HEADERS.map(h => csvEscape(row[h])).join(',') + '\n');
}

// Aligns the expected sentence list (from the article's CURRENT text)
// against a section's actual sentence cues, using loose (words-only)
// equality — see normalizeLoose's comment for why. Returns:
//   matches — {expectedIdx, actualIdx} pairs: this actual cue IS this
//             expected sentence, possibly with stale/cosmetic text that
//             needs correcting.
//   groups  — runs of consecutive expected sentences with NO matching cue
//             at all, each tagged with the actual-cue index they trail (so
//             the caller can find both neighbors) — or lowConfidence:true
//             when no nearby resync point was found, meaning this probably
//             isn't a dropped-cue bug (more likely the text changed since
//             the audio was generated).
function alignSection(expected, actualSentenceCues) {
  const matches = [];
  const groups = [];
  let i = 0, j = 0;
  const LOOKAHEAD = 8;
  while (i < expected.length) {
    const want = normalizeLoose(expected[i]);
    if (j < actualSentenceCues.length && normalizeLoose(actualSentenceCues[j].text) === want) {
      matches.push({ expectedIdx: i, actualIdx: j });
      i++; j++;
      continue;
    }
    let resyncLook = null;
    for (let look = 1; look <= LOOKAHEAD && i + look < expected.length; look++) {
      if (j < actualSentenceCues.length && normalizeLoose(actualSentenceCues[j].text) === normalizeLoose(expected[i + look])) {
        resyncLook = look;
        break;
      }
    }
    if (resyncLook != null) {
      const expectedIdxs = [];
      for (let k = 0; k < resyncLook; k++) expectedIdxs.push(i + k);
      groups.push({ afterActualIdx: j - 1, expectedIdxs, lowConfidence: false });
      i += resyncLook; // j is unchanged — it already points at the cue matching expected[i] now
    } else {
      groups.push({ afterActualIdx: j - 1, expectedIdxs: [i], lowConfidence: true });
      i++;
    }
  }
  return { matches, groups };
}

async function processEntry(entry, warnings) {
  const timingPath = resolveTimingPath(entry);
  if (!timingPath) return null; // nothing to check
  if (/^https?:\/\//i.test(timingPath)) {
    // A handful of legacy entries (e.g. st-peter-67) point `audio` at a full
    // external URL rather than a repo-relative path. This script only reads
    // files out of the checked-out repo — an absolute URL isn't one, so
    // it's flagged rather than attempted (a failed local fs.readFile on a
    // URL would just be a confusing ENOENT otherwise).
    warnings.push(`${entry.id}: audio path is an external URL (${timingPath}) — not a repo-relative timing file, skipped. Check this one by hand.`);
    return null;
  }
  let timing;
  try {
    timing = JSON.parse(await fs.readFile(timingPath, 'utf8'));
  } catch (err) {
    warnings.push(`${entry.id}: couldn't read/parse ${timingPath} (${err.message}) — skipped`);
    return null;
  }
  const cues = timing.cues || [];
  const parts = sectionParts(entry);
  const rows = [];
  let inserted = 0;
  let corrected = 0;

  for (let si = 0; si < parts.length; si++) {
    const { body } = parts[si];
    if (!body) continue;
    const expected = splitSentences(body).map(s => s.text);
    const sectionCuesAll = cues.filter(c => c.section === si);
    const headingCue = sectionCuesAll.find(c => c.type === 'heading') || null;
    const actualSentenceCues = sectionCuesAll.filter(c => c.type === 'sentence').slice().sort((a, b) => a.start - b.start);

    const { matches, groups } = alignSection(expected, actualSentenceCues);

    // Text-drift pass: every matched cue whose stored text isn't already
    // exactly the current article text gets corrected in place. Timing is
    // untouched — the cue was already right about WHEN, just stale about
    // WHAT. This is what quietly absorbs the leaked-quote artifact too: a
    // cue like `" Joseph's response is recorded...` loose-matches its
    // sentence and gets overwritten to the clean version automatically.
    for (const { expectedIdx, actualIdx } of matches) {
      const cue = actualSentenceCues[actualIdx];
      const cleanText = expected[expectedIdx];
      if (cue.text !== cleanText) {
        rows.push({
          id: entry.id, section: si, kind: 'corrected', text: `${cue.text} → ${cleanText}`,
          start: cue.start, end: cue.end, note: ''
        });
        cue.text = cleanText;
        corrected++;
      }
    }

    if (!groups.length) continue;

    for (const group of groups) {
      if (group.lowConfidence) {
        rows.push({
          id: entry.id, section: si, kind: 'flagged', text: expected[group.expectedIdxs[0]], start: '', end: '',
          note: 'No confident resync point nearby — likely a real text edit since the audio was generated, not the splitter bug. Not auto-inserted; consider regenerating this entry\'s audio.'
        });
        continue;
      }

      // Resolve the span's start boundary.
      let start = null;
      const prevActual = group.afterActualIdx >= 0 ? actualSentenceCues[group.afterActualIdx] : null;
      if (prevActual) {
        start = prevActual.end; // mid-section: no pause between ordinary sentences
      } else if (headingCue) {
        start = round2(headingCue.end + HEADING_PAUSE_SEC); // section's first sentence
      } else {
        const prevSectionCues = cues.filter(c => c.section === si - 1);
        if (prevSectionCues.length) start = round2(Math.max(...prevSectionCues.map(c => c.end)) + SECTION_PAUSE_SEC);
      }

      // Resolve the span's end boundary.
      let end = null;
      const nextActual = actualSentenceCues[group.afterActualIdx + 1] || null;
      if (nextActual) {
        end = nextActual.start;
      } else {
        const nextSectionCues = cues.filter(c => c.section === si + 1);
        if (nextSectionCues.length) end = round2(Math.min(...nextSectionCues.map(c => c.start)) - SECTION_PAUSE_SEC);
        else if (typeof timing.durationSec === 'number') end = timing.durationSec;
      }

      if (start == null || end == null || end <= start) {
        rows.push({
          id: entry.id, section: si, kind: 'flagged', text: group.expectedIdxs.map(idx => expected[idx]).join(' / '),
          start: start ?? '', end: end ?? '', note: 'Could not anchor both a start and end time with confidence — left unrepaired.'
        });
        continue;
      }

      // Split the recovered span across the group's sentences, proportional
      // to word count (the only signal available when more than one
      // sentence was dropped in a row).
      const texts = group.expectedIdxs.map(idx => expected[idx]);
      const wordCounts = texts.map(t => t.split(/\s+/).filter(Boolean).length);
      const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1;
      const span = end - start;
      let cursor = start;
      let anyOutOfRange = false;

      texts.forEach((text, k) => {
        const segStart = round2(cursor);
        const segEnd = k === texts.length - 1 ? round2(end) : round2(cursor + span * (wordCounts[k] / totalWords));
        const wps = wordCounts[k] / Math.max(0.01, segEnd - segStart);
        if (wps < 1 || wps > 5) {
          anyOutOfRange = true;
          rows.push({
            id: entry.id, section: si, kind: 'flagged', text, start: segStart, end: segEnd,
            note: `Implied rate ${wps.toFixed(2)} words/sec is outside the normal narration range — left unrepaired.`
          });
        } else {
          const newCue = { section: si, type: 'sentence', text, start: segStart, end: segEnd };
          cues.push(newCue);
          inserted++;
          rows.push({
            id: entry.id, section: si, kind: 'inserted', text, start: segStart, end: segEnd,
            note: texts.length > 1 ? `1 of ${texts.length} consecutive gaps — boundary split by word count (estimate)` : ''
          });
        }
        cursor = segEnd;
      });
    }
  }

  if (!rows.length) return null;
  cues.sort((a, b) => a.start - b.start);
  timing.cues = cues;
  return { path: timingPath, timing, rows, inserted, corrected };
}

async function main() {
  const db = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  let targets = db.entries.filter(e => resolveTimingPath(e));
  if (idFilter.length) {
    const set = new Set(idFilter);
    targets = targets.filter(e => set.has(e.id));
  }
  if (!targets.length) {
    console.log('No entries with a timing file (explicit or derivable) matched — nothing to check.');
    return;
  }

  await ensureLogHeader();
  console.log(`Checking ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} for cue problems (dry_run=${dryRun})...`);

  const warnings = [];
  let filesChanged = 0, totalInserted = 0, totalCorrected = 0, totalFlagged = 0;

  for (const entry of targets) {
    const result = await processEntry(entry, warnings);
    if (!result) continue;
    for (const row of result.rows) await appendLogRow(row);
    totalInserted += result.inserted;
    totalCorrected += result.corrected;
    totalFlagged += result.rows.filter(r => r.kind === 'flagged').length;

    const summary = [];
    if (result.inserted) summary.push(`${result.inserted} gap(s) repaired`);
    if (result.corrected) summary.push(`${result.corrected} text drift correction(s)`);
    if (summary.length) {
      console.log(`${entry.id}: ${summary.join(', ')}` + (dryRun ? ' (dry run — not written)' : ''));
      if (!dryRun) {
        await fs.writeFile(result.path, JSON.stringify(result.timing, null, 1));
        filesChanged++;
      }
    }
    const flaggedCount = result.rows.filter(r => r.kind === 'flagged').length;
    if (flaggedCount) console.log(`${entry.id}: ${flaggedCount} sentence(s) flagged for manual review — see ${LOG_PATH}`);
  }

  if (warnings.length) { console.log('\nWarnings:'); warnings.forEach(w => console.log('  ' + w)); }
  console.log(`\nDone. ${totalInserted} gap(s) repaired, ${totalCorrected} text correction(s), across ${filesChanged} file(s), ${totalFlagged} flagged for manual review.`);
  if (dryRun) console.log('This was a dry run — re-run with dry_run unchecked (DRY_RUN=false) to write the fixes.');
}

main().catch(err => { console.error(err); process.exit(1); });
