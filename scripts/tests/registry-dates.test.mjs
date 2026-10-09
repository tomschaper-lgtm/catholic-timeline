// scripts/tests/registry-dates.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/registry-dates.mjs v0.2. Uses temporary git repositories; never touches the real repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDate, dayOf, datesFromHistory, backfill, stampApproval, entryFromQueueItem, addApproved, approvalText, updateDoc } from '../services/registry-dates.mjs';

const SERVICE = fileURLToPath(new URL('../services/registry-dates.mjs', import.meta.url));
const REGFILE = 'scripts/ledger-allowlist.json';
const ent = (domain, extra = {}) => ({ domain, tier: 'approved', enabled: true, group: '-', operator: 'Op ' + domain, why: 'why', useFor: 'use', limits: 'lim', vetted: 'knowledge', ...extra });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'rd-'));
  const git = (args, env = {}) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout; };
  git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 't@example.com']);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  const commit = (text, iso, author = 'Tom') => {
    writeFileSync(join(dir, REGFILE), text);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c ' + iso], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso, GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author });
  };
  const run = (...args) => git(args);
  return { dir, commit, run, runGit: args => git(args) };
}
const regText = (...domains) => JSON.stringify({ version: 1, updated: '2026-10-06', tiers: {}, domains: domains.map(d => (typeof d === 'string' ? ent(d) : d)) }, null, 1);

test('isDate and dayOf', () => {
  assert.equal(isDate('2026-10-09'), true);
  for (const bad of ['2026-1-9', '2026-13-45', 'yesterday', null, 20261009, '2026-10-09T10:00:00Z']) assert.equal(isDate(bad), false, String(bad));
  assert.equal(dayOf(new Date('2026-10-09T23:30:00Z')), '2026-10-09');
  assert.equal(dayOf('2026-10-07T01:00:00Z'), '2026-10-07');
});

test('datesFromHistory: each domain gets the date of the FIRST commit that contained it, even after edits, removals and re-adding', () => {
  const r = repo();
  r.commit(regText('a.org', 'b.org'), '2026-10-06T10:00:00-05:00', 'Tom');
  r.commit(regText('a.org', 'b.org', 'c.org'), '2026-10-07T09:00:00-05:00', 'Tom');
  r.commit(regText(ent('a.org', { why: 'edited' }), 'b.org', 'c.org'), '2026-10-08T09:00:00-05:00', 'Tom');
  r.commit('{ this version is damaged', '2026-10-08T12:00:00-05:00', 'Tom');
  r.commit(regText('a.org', 'c.org'), '2026-10-09T08:00:00-05:00', 'Tom');            // b.org removed
  r.commit(regText('a.org', 'b.org', 'c.org'), '2026-10-10T08:00:00-05:00', 'Tom');   // and put back
  const h = datesFromHistory({ file: REGFILE, runGit: r.runGit });
  assert.deepEqual([h.get('a.org').date, h.get('b.org').date, h.get('c.org').date], ['2026-10-06', '2026-10-06', '2026-10-07']);
  assert.deepEqual([h.get('a.org').approved, h.get('c.org').approved], ['2026-10-06', '2026-10-07']);
  assert.equal(h.get('c.org').author, 'Tom');
  assert.equal(h.has('zzz.org'), false);
  assert.match(h.get('a.org').sha, /^[0-9a-f]{40}$/);
});

test('datesFromHistory: a site listed switched off, then enabled later, is "added" on the first day and "approved" on the day it was enabled', () => {
  const r = repo();
  r.commit(regText(ent('x.org', { enabled: false }), 'y.org'), '2026-10-06T10:00:00-05:00');
  r.commit(regText(ent('x.org', { enabled: false }), ent('y.org', { why: 'edited' })), '2026-10-07T10:00:00-05:00');   // a change that is not about x.org
  r.commit(regText(ent('x.org', { enabled: true }), ent('y.org', { why: 'edited' })), '2026-10-08T10:00:00-05:00');
  r.commit(regText(ent('x.org', { enabled: false }), ent('y.org', { why: 'edited' })), '2026-10-09T10:00:00-05:00');       // switched off again: the first approval date stays
  r.commit(regText(ent('z.org', { enabled: false })), '2026-10-10T10:00:00-05:00');                  // only ever listed
  const h = datesFromHistory({ file: REGFILE, runGit: r.runGit });
  assert.deepEqual([h.get('x.org').date, h.get('x.org').approved], ['2026-10-06', '2026-10-08']);
  assert.deepEqual([h.get('z.org').date, h.get('z.org').approved], ['2026-10-10', null]);
});

test('datesFromHistory: a file with no history gives an empty map, and a git failure is reported', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'README.md'), 'x');
  r.run('add', '-A'); r.run('commit', '-q', '-m', 'unrelated');                         // a repository with commits, but none touching the registry
  assert.equal(datesFromHistory({ file: REGFILE, runGit: r.runGit }).size, 0);
  assert.throws(() => datesFromHistory({ file: REGFILE, runGit: () => { throw new Error('git is broken'); } }), /git is broken/);
});

test('backfill: dates entries from history, treats a switched-off site as listed only, leaves existing dates alone, and is safe to repeat', () => {
  const reg = JSON.parse(regText('a.org', 'b.org', ent('c.org', { approvedAt: '2026-10-09', approvedBy: 'Ignatius', addedAt: '2026-10-08' }), 'd.org', ent('off.org', { enabled: false })));
  const hist = new Map([['a.org', { date: '2026-10-06', approved: '2026-10-06' }], ['b.org', { date: '2026-10-06', approved: '2026-10-08' }], ['c.org', { date: '2026-01-01', approved: '2026-01-01' }],
    ['off.org', { date: '2026-10-07', approved: null }]]);
  assert.deepEqual(backfill(reg, hist), { approved: 2, listedOnly: 1, unknown: 1, kept: 1 });
  const by = Object.fromEntries(reg.domains.map(e => [e.domain, [e.addedAt, e.approvedAt, e.approvedBy]]));
  assert.deepEqual(by, { 'a.org': ['2026-10-06', '2026-10-06', null], 'b.org': ['2026-10-06', '2026-10-08', null], 'c.org': ['2026-10-08', '2026-10-09', 'Ignatius'],
    'd.org': [null, null, null], 'off.org': ['2026-10-07', null, null] });
  assert.match(reg.datesNote, /first commit of this file that contained the domain/);
  const again = JSON.stringify(reg);
  assert.deepEqual(backfill(reg, hist), { approved: 0, listedOnly: 1, unknown: 1, kept: 3 });
  assert.equal(JSON.stringify(reg), again);
});

test('stampApproval: sets the day and the person, and refuses an approval nobody made', () => {
  const e = stampApproval(ent('a.org'), { by: ' Ignatius ', at: new Date('2026-10-09T20:00:00Z') });
  assert.deepEqual([e.addedAt, e.approvedAt, e.approvedBy], ['2026-10-09', '2026-10-09', 'Ignatius']);
  const listedEarlier = stampApproval(ent('a.org', { addedAt: '2026-10-06' }), { by: 'Tom', at: '2026-10-10T08:00:00Z' });
  assert.deepEqual([listedEarlier.addedAt, listedEarlier.approvedAt], ['2026-10-06', '2026-10-10']);        // an earlier listing date is kept
  assert.throws(() => stampApproval(ent('a.org'), { by: '', at: new Date() }), /who approved/);
  assert.throws(() => stampApproval(ent('a.org'), { by: undefined, at: new Date() }), /who approved/);
});

const ITEM = { id: 'site-n.example', status: 'waiting', proposedBy: 'Jerome', firstSeen: '2026-10-09T17:00:00.000Z', verified: true,
  suggestedEntry: { domain: 'n.example', tier: 'official', enabled: true, group: '-', operator: 'Diocese of Niigata', why: 'w', useFor: 'u', limits: 'l' } };

test('entryFromQueueItem: the approved entry carries the stamp and a "vetted" note saying who proposed it, who approved it and what the code checked', () => {
  const e = entryFromQueueItem(ITEM, { by: 'Ignatius', at: '2026-10-11T08:00:00Z' });
  assert.deepEqual([e.domain, e.tier, e.enabled, e.addedAt, e.approvedAt, e.approvedBy], ['n.example', 'official', true, '2026-10-11', '2026-10-11', 'Ignatius']);
  assert.match(e.vetted, /proposed by Jerome 2026-10-09; judged and approved by Ignatius 2026-10-11; the page was checked/);
  assert.match(entryFromQueueItem({ ...ITEM, verified: false }, { by: 'Ignatius', at: '2026-10-11' }).vetted, /could NOT be confirmed/);
  assert.equal(ITEM.suggestedEntry.approvedAt, undefined);                                    // the queue item itself is not changed
  assert.throws(() => entryFromQueueItem({ id: 'x' }, { by: 'Ignatius', at: new Date() }), /no suggested registry entry/);
});

test('addApproved: adds a stamped entry and the update date; refuses an unstamped entry and a domain already listed', () => {
  const reg = JSON.parse(regText('a.org'));
  const e = entryFromQueueItem(ITEM, { by: 'Ignatius', at: '2026-10-11' });
  addApproved(reg, e, { at: '2026-10-11T08:00:00Z' });
  assert.deepEqual([reg.domains.length, reg.updated], [2, '2026-10-11']);
  assert.throws(() => addApproved(reg, e, { at: new Date() }), /already in the registry/);
  assert.throws(() => addApproved(reg, ent('x.org'), { at: new Date() }), /only a stamped entry/);
});

test('approvalText', () => {
  assert.equal(approvalText({ approvedAt: '2026-10-07', approvedBy: 'Tom' }), '2026-10-07 by Tom');
  assert.equal(approvalText({ approvedAt: '2026-10-07', approvedBy: null }), '2026-10-07');
  assert.equal(approvalText({ approvedAt: '2026-10-08', approvedBy: 'Tom', addedAt: '2026-10-06' }), '2026-10-08 by Tom (listed 2026-10-06)');
  assert.equal(approvalText({ approvedAt: '2026-10-08', addedAt: '2026-10-08' }), '2026-10-08');
  assert.equal(approvalText({ approvedAt: null }), 'date not recorded');
  assert.equal(approvalText(undefined), 'date not recorded');
});

const DOC = [
  '<!-- DOC DATE: 2026-10-06 (Tuesday) · generated from scripts/ledger-allowlist.json · registry version 1 -->',
  '# Source allowlist', '', '5. **Checked, and dated.** The `vetted` field records whether the operator was confirmed online.', '',
  '### approved (2)', '', '| Domain | Operator | Why it is trusted | Use it for | Do not use it for / limits | Checked |', '| --- | --- | --- | --- | --- | --- |',
  '| `a.org` | Op a | why | use | lim | knowledge |', '| `gone.org` | Op g | why | use | lim | knowledge |', '',
  '### candidates', '', '| Domain | Hits | Notes |', '| --- | --- | --- |', '| `a.org` | 3 | seen |', ''].join('\n');

test('updateDoc: adds an Approved column to the six-column tables only, fills it from the registry, and leaves other tables and text alone', () => {
  const reg = JSON.parse(regText(ent('a.org', { approvedAt: '2026-10-07', approvedBy: 'Tom' })));
  const r = updateDoc(DOC, reg, { now: new Date('2026-10-09T15:00:00Z') });
  const lines = r.text.split('\n');
  assert.deepEqual([r.tables, r.rows], [1, 2]);
  assert.equal(lines[7], '| Domain | Operator | Why it is trusted | Use it for | Do not use it for / limits | Checked | Approved |');
  assert.equal(lines[8], '| --- | --- | --- | --- | --- | --- | --- |');
  assert.equal(lines[9], '| `a.org` | Op a | why | use | lim | knowledge | 2026-10-07 by Tom |');
  assert.equal(lines[10], '| `gone.org` | Op g | why | use | lim | knowledge | date not recorded |');
  assert.ok(r.text.includes('| Domain | Hits | Notes |\n| --- | --- | --- |\n| `a.org` | 3 | seen |'));     // the candidates table is untouched
  assert.match(lines[0], /DOC DATE: 2026-10-09 \(Friday\)/);
  assert.equal((r.text.match(/`approvedAt`/g) || []).length, 1);
  assert.match(r.text, /5\. \*\*Checked, and dated\.\*\*.*the Approved column shows both\./);
});

test('updateDoc: running it again changes nothing, and a changed date in the registry is picked up', () => {
  const reg = JSON.parse(regText(ent('a.org', { approvedAt: '2026-10-07', approvedBy: 'Tom' })));
  const once = updateDoc(DOC, reg, { now: new Date('2026-10-09T15:00:00Z') });
  const twice = updateDoc(once.text, reg, { now: new Date('2026-10-09T15:00:00Z') });
  assert.equal(twice.text, once.text);
  reg.domains[0].approvedAt = '2026-10-08';
  assert.match(updateDoc(once.text, reg, { now: new Date('2026-10-09T15:00:00Z') }).text, /`a\.org` \| Op a \| why \| use \| lim \| knowledge \| 2026-10-08 by Tom \|/);
});

test('updateDoc: a page with no matching tables is returned unchanged apart from the date line', () => {
  const r = updateDoc('# Nothing here\n\n| A | B |\n| - | - |\n| 1 | 2 |\n', { domains: [] }, { now: new Date('2026-10-09T15:00:00Z') });
  assert.deepEqual([r.tables, r.rows], [0, 0]);
  assert.equal(r.text, '# Nothing here\n\n| A | B |\n| - | - |\n| 1 | 2 |\n');
});

test('the real registry and descriptions page (when both are in the repo): the update runs, keeps every table row, and dates every domain it knows', () => {
  const regPath = fileURLToPath(new URL('../ledger-allowlist.json', import.meta.url));
  const docPath = fileURLToPath(new URL('../../SOURCE-ALLOWLIST.md', import.meta.url));
  if (!existsSync(regPath) || !existsSync(docPath)) return;
  const reg = JSON.parse(readFileSync(regPath, 'utf8'));
  const md = readFileSync(docPath, 'utf8');
  const before = md.split('\n').filter(l => l.startsWith('| `')).length;
  const r = updateDoc(md, reg, { now: new Date('2026-10-09T15:00:00Z') });
  assert.equal(r.text.split('\n').filter(l => l.startsWith('| `')).length, before);
  assert.ok(r.tables >= 1);
});

test('command line, end to end in a real repository: dates the entries from history, keeps the registry format, updates the page; --dry writes nothing', () => {
  const r = repo();
  r.commit(regText('a.org', 'b.org'), '2026-10-06T10:00:00-05:00');
  r.commit(regText('a.org', 'b.org', 'c.org'), '2026-10-07T10:00:00-05:00');
  writeFileSync(join(r.dir, 'SOURCE-ALLOWLIST.md'), DOC);
  const before = readFileSync(join(r.dir, REGFILE), 'utf8');
  const dry = spawnSync(process.execPath, [SERVICE, '--backfill', '--dry'], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /3 entries; approval dated from history: 3; already dated: 0; listed only \(switched off\): 0; date unknown: 0/);
  assert.equal(readFileSync(join(r.dir, REGFILE), 'utf8'), before);
  const real = spawnSync(process.execPath, [SERVICE, '--backfill'], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(real.status, 0, real.stderr);
  const raw = readFileSync(join(r.dir, REGFILE), 'utf8');
  const reg = JSON.parse(raw);
  assert.deepEqual(reg.domains.map(e => e.approvedAt), ['2026-10-06', '2026-10-06', '2026-10-07']);
  assert.equal(raw, JSON.stringify(reg, null, 1));                                       // one-space indent, no trailing newline, like the original
  assert.match(readFileSync(join(r.dir, 'SOURCE-ALLOWLIST.md'), 'utf8'), /\| `a\.org` \| Op a \| why \| use \| lim \| knowledge \| 2026-10-06 \|/);
  assert.equal(spawnSync(process.execPath, [SERVICE], { cwd: r.dir, encoding: 'utf8' }).status, 2);   // no --backfill: usage message
});
