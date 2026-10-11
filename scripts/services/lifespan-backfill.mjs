// scripts/services/lifespan-backfill.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.1 — add the age at death to the saints that do not show one yet, from the Born and Died facts they already have.
//
// Tom (2026-10-09): readers want to know whether a saint died old or young, an estimate is fine, and being a year or two out does not matter. Augustine does this for
// every NEW draft (lifespan.mjs); this does it for the articles that already exist, with NO model and NO cost: it only reads the facts that are there.
//
// It builds a patch in the app's own format (Manage > Paste JSON > Apply): one edit per saint, ["facts", "Died", "U", "<the Died fact with the age on the end>"].
// Nothing else in any entry is touched. It never changes a fact that already shows an age, and it skips every saint whose age cannot be worked out honestly:
// no birth year, a century only, or dates more than 6 years apart.
//
// COMMAND LINE:  node scripts/services/lifespan-backfill.mjs [--data data.json] [--out proposals/ages-patch.json] [--max-spread 6]
// With no --out it prints the patch to the screen. The report (counts and the skipped saints with reasons) goes to the error output.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lifespanFromFacts, ageSuffix, DEFAULT_MAX_SPREAD } from './lifespan.mjs';

const hasAge = v => /\bage\b/i.test(String(v || ''));

// entries: the data.json entries array. Returns { patch, rows, skipped, counts }.
export function buildAgePatch(entries, { maxSpread = DEFAULT_MAX_SPREAD } = {}) {
  const patches = {};
  const rows = [], skipped = [];
  for (const e of entries || []) {
    if (!e || e.t !== 's') continue;                                          // saints and other people only
    const died = (e.facts || []).find(f => f && String(f.label || '').trim().toLowerCase() === 'died');
    if (!died || !String(died.value || '').trim()) { skipped.push({ id: e.id, reason: 'no Died fact' }); continue; }
    if (hasAge(died.value)) { skipped.push({ id: e.id, reason: 'already shows an age' }); continue; }
    const r = lifespanFromFacts(e.facts, { maxSpread });
    if (r.age == null) { skipped.push({ id: e.id, reason: r.reason }); continue; }
    const value = String(died.value).trim() + ageSuffix(r);
    patches[e.id] = [['facts', String(died.label).trim(), 'U', value]];
    rows.push({ id: e.id, name: e.n, born: r.bornText, died: r.diedText, age: r.age, kind: r.kind, min: r.min, max: r.max, value });
  }
  const reasons = {};
  for (const s of skipped) { const k = s.reason.replace(/\(.*$/, '').trim(); reasons[k] = (reasons[k] || 0) + 1; }
  return { patch: { v: 1, patches }, rows, skipped, counts: { patched: rows.length, exact: rows.filter(r => r.kind === 'exact').length, estimated: rows.filter(r => r.kind === 'estimated').length, skipped: skipped.length, reasons } };
}

function main(argv) {
  const get = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const dataPath = get('--data') || 'data.json', out = get('--out');
  const maxSpread = get('--max-spread') ? parseInt(get('--max-spread'), 10) : DEFAULT_MAX_SPREAD;
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const r = buildAgePatch(data.entries || data, { maxSpread });
  const text = JSON.stringify(r.patch, null, 1) + '\n';
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); } else process.stdout.write(text);
  console.error('saints patched: ' + r.counts.patched + ' (' + r.counts.exact + ' exact, ' + r.counts.estimated + ' estimated); skipped: ' + r.counts.skipped + ' ' + JSON.stringify(r.counts.reasons) + (out ? '; written to ' + out : ''));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
