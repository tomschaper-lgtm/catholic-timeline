// scripts/tests/registry.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/registry.mjs v0.1 (the one registry reader shared by Jerome and Thomas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, regEntry, allowlistPath } from '../services/registry.mjs';
import { loadRegistry as jeromeLoad, regEntry as jeromeEntry } from '../services/source-finder.mjs';

const REG = { tiers: { approved: { canVerify: true }, reported: { canVerify: false } },
  domains: [{ domain: 'usccb.org', tier: 'official', enabled: true }, { domain: 'bible.usccb.org', tier: 'scripture', enabled: true }, { domain: 'newadvent.org', tier: 'approved', enabled: true }] };
const tmpFile = (obj, raw) => { const p = join(mkdtempSync(join(tmpdir(), 'reg-')), 'r.json'); writeFileSync(p, raw != null ? raw : JSON.stringify(obj)); return p; };

test('loadRegistry: reads a good file; a missing file, bad JSON and the wrong shape are each refused with a clear message', () => {
  assert.equal(loadRegistry(tmpFile(REG)).domains.length, 3);
  assert.throws(() => loadRegistry(join(tmpdir(), 'no-such-registry.json')), /not found/);
  assert.throws(() => loadRegistry(tmpFile(null, '{ broken')), /JSON/);
  assert.throws(() => loadRegistry(tmpFile({ tiers: {} })), /not in the expected shape/);
  assert.throws(() => loadRegistry(tmpFile({ domains: [] })), /not in the expected shape/);
});

test('allowlistPath: the default, and LEDGER_ALLOWLIST_PATH read at call time so a test or one-off run can change it', () => {
  const old = process.env.LEDGER_ALLOWLIST_PATH;
  delete process.env.LEDGER_ALLOWLIST_PATH;
  assert.equal(allowlistPath(), 'scripts/ledger-allowlist.json');
  process.env.LEDGER_ALLOWLIST_PATH = '/tmp/other.json';
  assert.equal(allowlistPath(), '/tmp/other.json');
  if (old === undefined) delete process.env.LEDGER_ALLOWLIST_PATH; else process.env.LEDGER_ALLOWLIST_PATH = old;
});

test('regEntry: the most specific domain wins, subdomains match, a near-miss does not, nothing gives null', () => {
  assert.equal(regEntry(REG, 'bible.usccb.org').tier, 'scripture');          // beats usccb.org
  assert.equal(regEntry(REG, 'www.usccb.org').tier, 'official');
  assert.equal(regEntry(REG, 'usccb.org').tier, 'official');
  assert.equal(regEntry(REG, 'www.newadvent.org').domain, 'newadvent.org');
  assert.equal(regEntry(REG, 'notusccb.org'), null);
  assert.equal(regEntry(REG, 'example.com'), null);
});

test('Jerome and Thomas use the very same reader', () => {
  assert.equal(jeromeLoad, loadRegistry);
  assert.equal(jeromeEntry, regEntry);
});

test('the real registry (when it is in the repo) loads, every entry names a tier the registry defines, and the tiers say whether they can verify', () => {
  const p = fileURLToPath(new URL('../ledger-allowlist.json', import.meta.url));
  if (!existsSync(p)) return;
  const reg = loadRegistry(p);
  assert.ok(reg.domains.length > 0);
  for (const e of reg.domains) assert.ok(reg.tiers[e.tier], e.domain + ' uses an undefined tier: ' + e.tier);
  for (const [name, t] of Object.entries(reg.tiers)) assert.equal(typeof t.canVerify, 'boolean', name + ' has no canVerify');
  assert.ok(JSON.parse(readFileSync(p, 'utf8')).domains.every(e => typeof e.domain === 'string' && e.domain.includes('.')));
});
