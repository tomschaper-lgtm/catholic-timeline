#!/usr/bin/env node
/**
 * retire-short-description.mjs
 * ----------------------------
 * One-time migration retiring the `d` short-description field (app side done in v318).
 *
 * Two steps, in this order:
 *   1. For every t:"i" info entry that has a `d` but no `subtitle`, copy `d` into `subtitle`.
 *      These are the Learn More pages, the one place `d` was still rendered.
 *   2. Delete `d` from every entry.
 *
 * Deliberately does NOT touch anything else. `d` is the only field removed, and no entry is
 * added, reordered, or otherwise rewritten — the goal is a diff that contains nothing but the
 * removals and the handful of subtitle additions, so it's easy to eyeball before merging.
 *
 * Defaults to a DRY RUN: it reports exactly what it would change and writes nothing. Pass
 * apply=true (or APPLY=true) to actually write data.json. Run the dry run first and read the
 * summary — this deletes real content, and the only undo is git history.
 *
 * Usage:
 *   node retire-short-description.mjs [path-to-data.json]
 *   APPLY=true node retire-short-description.mjs
 */

import { readFileSync, writeFileSync } from 'fs';

const DATA_PATH = process.argv[2] || 'data.json';
const APPLY = String(process.env.APPLY || 'false').trim().toLowerCase() === 'true';

function main() {
  const rawText = readFileSync(DATA_PATH, 'utf8');
  const db = JSON.parse(rawText);
  const entries = Array.isArray(db.entries) ? db.entries : null;
  if (!entries) {
    console.error(`ERROR: ${DATA_PATH} has no "entries" array — nothing done.`);
    process.exit(1);
  }

  const promoted = [];   // info entries that gained a subtitle
  const skipped = [];    // info entries that already had one
  const noSubtitle = []; // info entries with no d to promote — will end up with a blank line
  let removed = 0;

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;

    if (e.t === 'i') {
      const d = typeof e.d === 'string' ? e.d.trim() : '';
      const existing = typeof e.subtitle === 'string' ? e.subtitle.trim() : '';
      if (existing) {
        skipped.push({ id: e.id, subtitle: existing });
      } else if (d) {
        e.subtitle = d;
        promoted.push({ id: e.id, name: e.n, subtitle: d });
      } else {
        noSubtitle.push({ id: e.id, name: e.n });
      }
    }

    if (Object.prototype.hasOwnProperty.call(e, 'd')) {
      delete e.d;
      removed++;
    }
  }

  console.log(`Scanned ${entries.length} entries in ${DATA_PATH}.\n`);

  console.log(`Info entries (t:"i") given a subtitle from their short description: ${promoted.length}`);
  promoted.forEach(p => {
    const preview = p.subtitle.length > 90 ? p.subtitle.slice(0, 90) + '…' : p.subtitle;
    console.log(`  ${p.id}  ->  "${preview}"`);
  });

  if (skipped.length) {
    console.log(`\nInfo entries that already had a subtitle (left alone): ${skipped.length}`);
    skipped.forEach(sk => console.log(`  ${sk.id}`));
  }
  if (noSubtitle.length) {
    console.log(`\nInfo entries with no short description to promote — these will show no`);
    console.log(`subtitle line until one is typed in the editor: ${noSubtitle.length}`);
    noSubtitle.forEach(n => console.log(`  ${n.id} (${n.name})`));
  }

  console.log(`\nEntries the "d" field was removed from: ${removed}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with apply=true to write these changes.');
    return;
  }

  // Match the app's own formatting (JSON.stringify(db, null, 1)) so the commit diff shows only
  // the real changes rather than a whole-file reindent.
  writeFileSync(DATA_PATH, JSON.stringify(db, null, 1));
  console.log(`\nWROTE ${DATA_PATH}.`);
}

main();
