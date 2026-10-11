// scripts/tests/lifespan-backfill.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/lifespan-backfill.mjs v0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAgePatch } from '../services/lifespan-backfill.mjs';

const SERVICE = fileURLToPath(new URL('../services/lifespan-backfill.mjs', import.meta.url));
const F = (born, died, diedLabel = 'Died') => [{ label: 'Feast day', value: 'x' }, ...(born != null ? [{ label: 'Born', value: born }] : []), ...(died != null ? [{ label: diedLabel, value: died }] : [])];
const E = [
  { id: 'a-1', n: 'A', t: 's', facts: F('c. 1020/1025, Tuscany', 'May 25, 1085, Salerno') },
  { id: 'b-2', n: 'B', t: 's', facts: F('November 13, 354, Thagaste', 'August 28, 430, Hippo') },
  { id: 'c-3', n: 'C', t: 's', facts: F('1090', 'August 20, 1153, Clairvaux (at age 63)') },
  { id: 'd-4', n: 'D', t: 's', facts: F(null, 'c. 304, Rome (traditionally at age 14)') },
  { id: 'e-5', n: 'E', t: 's', facts: F('Bethsaida, Galilee', 'c. 64\u201367, Rome') },
  { id: 'f-6', n: 'F', t: 's', facts: F('c. 35\u201350, Syria', 'c. 107 (between 98 and 117), Rome') },
  { id: 'g-7', n: 'G', t: 's', facts: F('1st century BC, Nazareth', null) },
  { id: 'h-8', n: 'H', t: 'c', facts: F('325', '325') },
  { id: 'i-9', n: 'I', t: 's', facts: F('1182, Assisi', '1226, Assisi (stigmata)', 'died') },
  { id: 'j-10', n: 'J', t: 's' }
];

test('one "Died" edit for each saint whose age can be worked out and who shows none; the label is the entry\'s own spelling; nothing else is touched', () => {
  const r = buildAgePatch(E);
  assert.deepEqual(Object.keys(r.patch.patches), ['a-1', 'b-2', 'i-9']);
  assert.equal(r.patch.v, 1);
  assert.deepEqual(r.patch.patches['a-1'], [['facts', 'Died', 'U', 'May 25, 1085, Salerno (estimated age 62)']]);
  assert.deepEqual(r.patch.patches['b-2'], [['facts', 'Died', 'U', 'August 28, 430, Hippo (at age 75)']]);                  // two full dates: exact
  assert.deepEqual(r.patch.patches['i-9'], [['facts', 'died', 'U', '1226, Assisi (stigmata) (estimated age 44)']]);
  for (const edits of Object.values(r.patch.patches)) assert.equal(edits.length, 1);
});

test('a saint that already shows an age (in any form) is never changed; neither are councils, saints with no birth year, a century only, a death fact missing, dates too far apart, or no facts', () => {
  const r = buildAgePatch(E);
  const why = Object.fromEntries(r.skipped.map(s => [s.id, s.reason]));
  assert.equal(why['c-3'], 'already shows an age');
  assert.equal(why['d-4'], 'already shows an age');                         // "traditionally at age 14" counts
  assert.equal(why['e-5'], 'no birth year');
  assert.match(why['f-6'], /^dates too uncertain/);
  assert.equal(why['g-7'], 'no Died fact');
  assert.equal(why['j-10'], 'no Died fact');
  assert.equal(why['h-8'], undefined);                                      // a council is not looked at at all
});

test('rows and counts say what was done: exact and estimated, how many were skipped and why', () => {
  const r = buildAgePatch(E);
  assert.deepEqual([r.counts.patched, r.counts.exact, r.counts.estimated, r.counts.skipped], [3, 1, 2, 6]);
  assert.deepEqual(r.counts.reasons, { 'already shows an age': 2, 'no birth year': 1, 'dates too uncertain': 1, 'no Died fact': 2 });
  assert.deepEqual(r.rows.map(x => [x.id, x.age, x.kind]), [['a-1', 62, 'estimated'], ['b-2', 75, 'exact'], ['i-9', 44, 'estimated']]);
});

test('the tolerance is a setting: with a wider tolerance the saint with uncertain dates gets an estimate too; the input is not changed', () => {
  const before = JSON.stringify(E);
  const r = buildAgePatch(E, { maxSpread: 40 });
  assert.equal(r.patch.patches['f-6'][0][3], 'c. 107 (between 98 and 117), Rome (estimated age 65)');
  assert.equal(JSON.stringify(E), before);
  assert.deepEqual(buildAgePatch([]).patch, { v: 1, patches: {} });
  assert.deepEqual(buildAgePatch(null).patch, { v: 1, patches: {} });
});

test('command line: reads data.json, writes the patch file, reports the counts; the patch is valid JSON in the app\'s format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lb-'));
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ entries: E }));
  const r = spawnSync(process.execPath, [SERVICE, '--data', join(dir, 'data.json'), '--out', join(dir, 'proposals', 'ages-patch.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /saints patched: 3 \(1 exact, 2 estimated\); skipped: 6/);
  const patch = JSON.parse(readFileSync(join(dir, 'proposals', 'ages-patch.json'), 'utf8'));
  assert.equal(patch.v, 1);
  assert.equal(Object.keys(patch.patches).length, 3);
  const toScreen = spawnSync(process.execPath, [SERVICE, '--data', join(dir, 'data.json')], { encoding: 'utf8' });
  assert.equal(JSON.parse(toScreen.stdout).v, 1);
});
