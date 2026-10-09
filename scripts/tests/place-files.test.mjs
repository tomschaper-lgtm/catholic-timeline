// scripts/tests/place-files.test.mjs
// MODULE DATE: 2026-10-08 (Thursday) · tests for scripts/services/place-files.mjs v0.2 (patch mode added). Uses temporary folders; never touches the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadPlaceRules, checkPath, planBundle, placeBundle, processBundleFile, pendingBundles, buildBundle, runPlaceFiles, sha256 } from '../services/place-files.mjs';

const RULES = loadPlaceRules(fileURLToPath(new URL('../place-rules.json', import.meta.url)));
const SERVICE = fileURLToPath(new URL('../services/place-files.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'place-test-'));
const file = (path, content, extra = {}) => ({ path, content, encoding: 'utf8', sha256: sha256(Buffer.from(content, 'utf8')), ...extra });
const bundle = (...files) => ({ bundle: 1, message: 'test bundle', files });
const put = (root, path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const passTests = () => ({ ok: true, output: 'ok' });
const failTests = () => ({ ok: false, output: 'not ok 1 - boom' });

test('rules file loads and protects the registry, the data and itself', () => {
  for (const f of ['data.json', 'workLog.json', 'scripts/ledger-allowlist.json', 'scripts/place-rules.json', 'scripts/services/place-files.mjs']) assert.ok(RULES.protectedFiles.includes(f), f);
  assert.ok(RULES.deniedPrefixes.includes('.github/'));
});

test('checkPath: allowed places pass', () => {
  for (const p of ['scripts/services/x.mjs', 'scripts/tests/x.test.mjs', 'scripts/category-rules.json', 'docs/a.md', 'DESIGN-2026-10-08.md', 'CHANGELOG.md']) assert.equal(checkPath(p, RULES), null, p);
});

test('checkPath: traversal, absolute paths, odd characters and plain-form tricks are refused', () => {
  for (const p of ['../x.mjs', 'scripts/../data.json', '/etc/passwd', 'C:/x', 'scripts\\x.mjs', 'scripts//x.mjs', 'scripts/./x.mjs', 'scripts/x\0.mjs', '', null, 5, 'scripts/']) assert.ok(checkPath(p, RULES), String(p));
});

test('checkPath: workflows, git, inbox, ledger, protected files and unlisted places are refused (any letter case)', () => {
  for (const p of ['.github/workflows/x.yml', '.GitHub/workflows/x.yml', '.git/config', 'node_modules/x/y.js', 'inbox/x.json', 'ledger/a.json', 'sources/a.json',
    'data.json', 'DATA.JSON', 'workLog.json', 'index.html', 'package.json', 'scripts/ledger-allowlist.json', 'scripts/place-rules.json', 'scripts/services/place-files.mjs',
    'images/a.png', 'a.html', 'scripts']) assert.ok(checkPath(p, RULES), p);
});

test('a good bundle: files placed in their folders, new and changed told apart', () => {
  const root = tmp();
  put(root, 'scripts/a.json', '{"v":1}');
  const r = placeBundle(bundle(file('scripts/a.json', '{"v":2}'), file('scripts/services/b.mjs', 'export const b = 1;\n'), file('docs/c.md', '# c\n')), { root, rules: RULES, deps: { runTests: passTests } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.placed.map(p => p.status).sort(), ['changed', 'new', 'new']);
  assert.equal(read(root, 'scripts/a.json'), '{"v":2}');
  assert.equal(read(root, 'scripts/services/b.mjs'), 'export const b = 1;\n');
  assert.equal(read(root, 'docs/c.md'), '# c\n');
});

test('an identical file is reported unchanged and is not written again', () => {
  const root = tmp();
  put(root, 'scripts/a.json', '{"v":1}');
  const r = placeBundle(bundle(file('scripts/a.json', '{"v":1}')), { root, rules: RULES });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unchanged, ['scripts/a.json']);
  assert.equal(r.placed.length, 0);
});

test('create-only leaves an existing file alone, but creates a missing one', () => {
  const root = tmp();
  put(root, 'scripts/category-rules.json', '{"mine":"edited by Tom"}');
  const r = placeBundle(bundle(file('scripts/category-rules.json', '{"mine":"claude default"}', { mode: 'create-only' }), file('scripts/new-rules.json', '{"x":1}', { mode: 'create-only' })), { root, rules: RULES });
  assert.equal(r.ok, true);
  assert.equal(read(root, 'scripts/category-rules.json'), '{"mine":"edited by Tom"}');
  assert.deepEqual(r.skipped, ['scripts/category-rules.json']);
  assert.equal(read(root, 'scripts/new-rules.json'), '{"x":1}');
});

test('a damaged file (wrong checksum) refuses the WHOLE bundle: nothing is written', () => {
  const root = tmp();
  const bad = file('scripts/b.mjs', 'export const b = 2;\n');
  bad.content = 'export const b = 3;\n';                             // edited after the checksum was made
  const r = placeBundle(bundle(file('scripts/a.json', '{}'), bad), { root, rules: RULES });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /checksum/);
  assert.equal(existsSync(join(root, 'scripts/a.json')), false);
});

test('a missing checksum is refused (it is required)', () => {
  const f = file('scripts/a.json', '{}'); delete f.sha256;
  assert.equal(placeBundle(bundle(f), { root: tmp(), rules: RULES }).ok, false);
});

test('one bad path refuses the whole bundle, naming the file', () => {
  const root = tmp();
  const r = placeBundle(bundle(file('scripts/a.json', '{}'), file('.github/workflows/x.yml', 'name: x\n'), file('data.json', '[]')), { root, rules: RULES });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.startsWith('.github/workflows/x.yml')));
  assert.ok(r.errors.some(e => e.startsWith('data.json')));
  assert.equal(existsSync(join(root, 'scripts/a.json')), false);
});

test('invalid JSON and JavaScript with a syntax error are refused before anything is written', () => {
  const root = tmp();
  const r1 = placeBundle(bundle(file('scripts/a.json', '{not json')), { root, rules: RULES });
  assert.match(r1.errors.join(' '), /not valid JSON/);
  const r2 = placeBundle(bundle(file('scripts/b.mjs', 'export const = ;')), { root, rules: RULES });
  assert.match(r2.errors.join(' '), /syntax error/);
  assert.equal(existsSync(join(root, 'scripts/b.mjs')), false);
});

test('size limits, duplicate paths, unknown mode or encoding, and non-bundles are refused', () => {
  const small = { ...RULES, maxFileBytes: 10, maxBundleBytes: 15, maxFiles: 2 };
  assert.match(planBundle(bundle(file('scripts/a.json', '{"long":"enough to fail"}')), small, tmp()).errors.join(' '), /too large/);
  assert.match(planBundle(bundle(file('docs/a.md', 'a'), file('docs/b.md', 'b'), file('docs/c.md', 'c')), small, tmp()).errors.join(' '), /too many files/);
  assert.match(planBundle(bundle(file('docs/a.md', 'a'), file('docs/A.md', 'a')), RULES, tmp()).errors.join(' '), /listed twice/);
  assert.match(planBundle(bundle(file('docs/a.md', 'a', { mode: 'delete' })), RULES, tmp()).errors.join(' '), /unknown mode/);
  assert.match(planBundle(bundle(file('docs/a.md', 'a', { encoding: 'rot13' })), RULES, tmp()).errors.join(' '), /unknown encoding/);
  assert.ok(planBundle({ files: [] }, RULES, tmp()).errors.length);
  assert.ok(planBundle(null, RULES, tmp()).errors.length);
});

test('a folder where a file should go is refused', () => {
  const root = tmp();
  mkdirSync(join(root, 'docs/a.md'), { recursive: true });
  assert.match(placeBundle(bundle(file('docs/a.md', 'x')), { root, rules: RULES }).errors.join(' '), /folder/);
});

test('test gate: the bundle\'s own tests run, and a failure puts EVERY file back as it was', () => {
  const root = tmp();
  put(root, 'scripts/a.json', '{"v":1}');
  const seen = [];
  const r = placeBundle(bundle(file('scripts/a.json', '{"v":2}'), file('scripts/n.mjs', 'export const n = 1;\n'), file('scripts/tests/n.test.mjs', 'import "../n.mjs";\n')),
    { root, rules: RULES, deps: { runTests: (files) => { seen.push(files); return failTests(); } } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /tests .* failed/);
  assert.deepEqual(seen[0], ['scripts/tests/n.test.mjs']);
  assert.equal(read(root, 'scripts/a.json'), '{"v":1}');                 // restored
  assert.equal(existsSync(join(root, 'scripts/n.mjs')), false);           // removed again
  assert.equal(existsSync(join(root, 'scripts/tests/n.test.mjs')), false);
  assert.match(r.tests.tail, /boom/);
});

test('test gate: passing tests -> files stay; no test files -> the gate says so', () => {
  const root = tmp();
  const ok = placeBundle(bundle(file('scripts/n.mjs', 'export const n = 1;\n'), file('scripts/tests/n.test.mjs', 'import "../n.mjs";\n')), { root, rules: RULES, deps: { runTests: passTests } });
  assert.equal(ok.ok, true);
  assert.equal(ok.tests.ran, true);
  const none = placeBundle(bundle(file('docs/x.md', 'x')), { root, rules: RULES, deps: { runTests: failTests } });
  assert.equal(none.ok, true);
  assert.equal(none.tests.ran, false);
});

test('test gate: really runs node --test on the placed test file (no injected runner)', () => {
  const root = tmp();
  const good = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(1, 1));\n";
  const bad = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('no', () => assert.equal(1, 2));\n";
  assert.equal(placeBundle(bundle(file('scripts/tests/g.test.mjs', good)), { root, rules: RULES }).ok, true);
  const r = placeBundle(bundle(file('scripts/tests/h.test.mjs', bad)), { root, rules: RULES });
  assert.equal(r.ok, false);
  assert.equal(existsSync(join(root, 'scripts/tests/h.test.mjs')), false);
});

test('base64 files round-trip (for anything that is not plain text)', () => {
  const root = tmp();
  const bytes = Buffer.from([0, 255, 1, 2, 3]);
  const f = { path: 'docs/blob.md', encoding: 'base64', content: bytes.toString('base64'), sha256: sha256(bytes) };
  assert.equal(placeBundle(bundle(f), { root, rules: RULES }).ok, true);
  assert.ok(readFileSync(join(root, 'docs/blob.md')).equals(bytes));
});

test('processBundleFile: records the bundle, lists what to commit and remove, and skips the same bundle next time', () => {
  const root = tmp();
  put(root, 'inbox/one.bundle.json', JSON.stringify(bundle(file('docs/a.md', '# a\n'))));
  const r = processBundleFile('inbox/one.bundle.json', { root, rules: RULES });
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.sort(), ['docs/a.md', 'inbox/processed.json']);
  assert.deepEqual(r.remove, ['inbox/one.bundle.json']);
  assert.equal(r.message, 'test bundle');
  assert.ok(Object.keys(JSON.parse(read(root, 'inbox/processed.json'))).length === 1);
  rmSync(join(root, 'docs/a.md'));
  const again = processBundleFile('inbox/one.bundle.json', { root, rules: RULES });
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
  assert.equal(existsSync(join(root, 'docs/a.md')), false);              // not placed a second time
});

test('processBundleFile: a failed bundle changes nothing, is not recorded, and is not removed', () => {
  const root = tmp();
  put(root, 'inbox/bad.bundle.json', JSON.stringify(bundle(file('data.json', '[]'))));
  const r = processBundleFile('inbox/bad.bundle.json', { root, rules: RULES });
  assert.equal(r.ok, false);
  assert.deepEqual(r.remove, []);
  assert.equal(existsSync(join(root, 'inbox/processed.json')), false);
  put(root, 'inbox/junk.bundle.json', '{ this is not json');
  assert.match(processBundleFile('inbox/junk.bundle.json', { root, rules: RULES }).errors.join(' '), /not valid JSON/);
  assert.match(processBundleFile('inbox/missing.bundle.json', { root, rules: RULES }).errors.join(' '), /cannot read/);
});

test('pendingBundles: finds *.bundle.json in inbox/ and the top folder, in order, and nothing else', () => {
  const root = tmp();
  put(root, 'inbox/b.bundle.json', '{}'); put(root, 'inbox/a.bundle.json', '{}'); put(root, 'inbox/processed.json', '{}'); put(root, 'top.bundle.json', '{}'); put(root, 'README.md', '#');
  assert.deepEqual(pendingBundles(root, RULES), ['inbox/a.bundle.json', 'inbox/b.bundle.json', 'top.bundle.json']);
  assert.deepEqual(pendingBundles(tmp(), RULES), []);
});

test('buildBundle: a bundle built from files on disk is accepted, checksums right, create-only marked', () => {
  const src = tmp(), dst = tmp();
  put(src, 'scripts/services/x.mjs', 'export const x = "é";\n');
  put(src, 'scripts/category-rules.json', '{"a":1}');
  const b = buildBundle(['scripts/services/x.mjs', 'scripts/category-rules.json:create-only'], 'built by test', src);
  assert.equal(b.files[1].mode, 'create-only');
  assert.equal(b.files[0].sha256, sha256(readFileSync(join(src, 'scripts/services/x.mjs'))));
  const r = placeBundle(b, { root: dst, rules: RULES });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(read(dst, 'scripts/services/x.mjs'), 'export const x = "é";\n');
});

test('handler contract: returns summary, result and filesToCommit; throws with the reasons when a bundle fails', async () => {
  const root = tmp();
  put(root, 'inbox/ok.bundle.json', JSON.stringify(bundle(file('docs/a.md', '# a\n'))));
  const out = await runPlaceFiles({ payload: {} }, null, { root, rules: RULES });
  assert.deepEqual(out.filesToCommit.sort(), ['docs/a.md', 'inbox/processed.json']);
  assert.match(out.summary, /1 placed, 0 failed/);
  put(root, 'inbox/bad.bundle.json', JSON.stringify(bundle(file('index.html', '<html>'))));
  await assert.rejects(runPlaceFiles({ payload: { bundle: 'inbox/bad.bundle.json' } }, null, { root, rules: RULES }), /protected/);
  assert.match((await runPlaceFiles({ payload: {} }, null, { root: tmp(), rules: RULES })).summary, /no bundles waiting/);
});

test('command line: --make then place, end to end in a temp repo; result file lists commit and remove', () => {
  const root = tmp();
  put(root, 'scripts/place-rules.json', readFileSync(fileURLToPath(new URL('../place-rules.json', import.meta.url)), 'utf8'));
  put(root, 'docs/note.md', '# note\n');
  const make = spawnSync(process.execPath, [SERVICE, '--make', '--message', 'CLI test', '--out', 'inbox/t.bundle.json', 'docs/note.md'], { cwd: root, encoding: 'utf8' });
  assert.equal(make.status, 0, make.stderr);
  rmSync(join(root, 'docs/note.md'));
  const run = spawnSync(process.execPath, [SERVICE], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(read(root, 'docs/note.md'), '# note\n');
  const res = JSON.parse(read(root, 'place-result.json'));
  assert.equal(res.message, 'CLI test');
  assert.deepEqual(res.files.sort(), ['docs/note.md', 'inbox/processed.json']);
  assert.deepEqual(res.remove, ['inbox/t.bundle.json']);
  assert.match(read(root, 'place-summary.md'), /placed/);
});

test('command line: exit code 1 when a bundle is refused, and the summary says nothing was changed', () => {
  const root = tmp();
  put(root, 'scripts/place-rules.json', readFileSync(fileURLToPath(new URL('../place-rules.json', import.meta.url)), 'utf8'));
  put(root, 'inbox/bad.bundle.json', JSON.stringify(bundle(file('workLog.json', '{}'))));
  const run = spawnSync(process.execPath, [SERVICE], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(read(root, 'place-summary.md'), /FAILED, nothing was changed/);
  assert.deepEqual(JSON.parse(read(root, 'place-result.json')).files, []);
  assert.equal(existsSync(join(root, 'workLog.json')), false);
});

// ---------------------------------------------------------------------------------------------
// Patch mode (v0.2): small edits applied to the file as it is in the repo NOW
// ---------------------------------------------------------------------------------------------

const patch = (path, edits, extra = {}) => ({ path, mode: 'patch', edits, sha256: sha256(Buffer.from(JSON.stringify(edits), 'utf8')), ...extra });
const ORCH = "import { a } from './a.mjs';\nimport { runLedgerBuild } from './services/ledger-build.mjs';\n\nconst SERVICE_HANDLERS = {\n  'ledger-build': runLedgerBuild, // source-proof ledger\n};\n";

test('patch: edits are applied to the file in the repo, leaving everything else (even recent changes) alone', () => {
  const root = tmp();
  put(root, 'scripts/orchestrator.mjs', ORCH + "// a line Tom added after Claude last saw the file\n");
  const r = placeBundle(bundle(patch('scripts/orchestrator.mjs', [
    { find: "import { runLedgerBuild } from './services/ledger-build.mjs';", replace: "import { runLedgerBuild } from './services/ledger-build.mjs';\nimport { runJerome } from './services/source-finder.mjs';" },
    { find: "  'ledger-build': runLedgerBuild,", replace: "  'source-find': runJerome,\n  'ledger-build': runLedgerBuild," }])), { root, rules: RULES });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.placed, [{ path: 'scripts/orchestrator.mjs', status: 'changed' }]);
  const out = read(root, 'scripts/orchestrator.mjs');
  assert.ok(out.includes("import { runJerome } from './services/source-finder.mjs';"));
  assert.ok(out.includes("  'source-find': runJerome,\n  'ledger-build': runLedgerBuild, // source-proof ledger"));   // the original comment stays on its own line
  assert.ok(out.includes('// a line Tom added after Claude last saw the file'));
});

test('patch: a find that is not in the file refuses the whole bundle (the file changed since Claude saw it)', () => {
  const root = tmp();
  put(root, 'scripts/orchestrator.mjs', ORCH);
  put(root, 'scripts/other.json', '{"v":1}');
  const r = placeBundle(bundle(file('scripts/other.json', '{"v":2}'), patch('scripts/orchestrator.mjs', [{ find: 'text that is not there', replace: 'x' }])), { root, rules: RULES });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not in the file as it is now/);
  assert.equal(read(root, 'scripts/other.json'), '{"v":1}');                       // nothing else was placed either
  assert.equal(read(root, 'scripts/orchestrator.mjs'), ORCH);
});

test('patch: a find that appears more than once is refused', () => {
  const root = tmp();
  put(root, 'scripts/x.mjs', 'const a = 1;\nconst a = 1;\n');
  assert.match(placeBundle(bundle(patch('scripts/x.mjs', [{ find: 'const a = 1;', replace: 'const a = 2;' }])), { root, rules: RULES }).errors.join(' '), /appears 2 times/);
});

test('patch: the file must exist; protected files cannot be patched; bad edits, bad checksums and too many edits are refused', () => {
  const root = tmp();
  assert.match(placeBundle(bundle(patch('scripts/missing.mjs', [{ find: 'a', replace: 'b' }])), { root, rules: RULES }).errors.join(' '), /to exist already/);
  put(root, 'index.html', '<html>');
  assert.match(placeBundle(bundle(patch('index.html', [{ find: '<html>', replace: '<html lang="en">' }])), { root, rules: RULES }).errors.join(' '), /protected/);
  put(root, 'scripts/x.mjs', 'const a = 1;\n');
  assert.match(placeBundle(bundle(patch('scripts/x.mjs', [])), { root, rules: RULES }).errors.join(' '), /no edits/);
  assert.match(placeBundle(bundle(patch('scripts/x.mjs', [{ find: '', replace: 'b' }])), { root, rules: RULES }).errors.join(' '), /needs text/);
  assert.match(placeBundle(bundle(patch('scripts/x.mjs', [{ find: 'a', replace: 5 }])), { root, rules: RULES }).errors.join(' '), /needs text/);
  const damaged = patch('scripts/x.mjs', [{ find: 'const a = 1;', replace: 'const a = 2;' }]);
  damaged.edits[0].replace = 'const a = 3;';                                        // edited after the checksum was made
  assert.match(placeBundle(bundle(damaged), { root, rules: RULES }).errors.join(' '), /checksum/);
  const many = Array.from({ length: 21 }, (_, i) => ({ find: 'x' + i, replace: 'y' }));
  assert.match(placeBundle(bundle(patch('scripts/x.mjs', many)), { root, rules: RULES }).errors.join(' '), /too many edits/);
  assert.equal(read(root, 'scripts/x.mjs'), 'const a = 1;\n');
});

test('patch: a patch that leaves the file with a syntax error, or invalid JSON, is refused and nothing changes', () => {
  const root = tmp();
  put(root, 'scripts/x.mjs', 'const a = 1;\n');
  put(root, 'scripts/c.json', '{"a":1}');
  assert.match(placeBundle(bundle(patch('scripts/x.mjs', [{ find: 'const a = 1;', replace: 'const = ;' }])), { root, rules: RULES }).errors.join(' '), /syntax error/);
  assert.match(placeBundle(bundle(patch('scripts/c.json', [{ find: '"a":1', replace: '"a":' }])), { root, rules: RULES }).errors.join(' '), /not valid JSON/);
  assert.equal(read(root, 'scripts/x.mjs'), 'const a = 1;\n');
});

test('patch: edits apply in order, and "$" in the new text is kept literally', () => {
  const root = tmp();
  put(root, 'scripts/x.mjs', 'const a = 1;\n');
  const r = placeBundle(bundle(patch('scripts/x.mjs', [{ find: 'const a = 1;', replace: 'const a = 2;' }, { find: 'const a = 2;', replace: "const price = '$&$1 $$';" }])), { root, rules: RULES });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(read(root, 'scripts/x.mjs'), "const price = '$&$1 $$';\n");
});

test('patch: an edit that changes nothing is reported unchanged and not committed', () => {
  const root = tmp();
  put(root, 'scripts/x.mjs', 'const a = 1;\n');
  const r = placeBundle(bundle(patch('scripts/x.mjs', [{ find: 'const a = 1;', replace: 'const a = 1;' }])), { root, rules: RULES });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unchanged, ['scripts/x.mjs']);
  assert.equal(r.placed.length, 0);
});

test('patch: if the bundle\'s tests fail, the patched file is put back exactly as it was', () => {
  const root = tmp();
  put(root, 'scripts/x.mjs', 'const a = 1;\n');
  const r = placeBundle(bundle(patch('scripts/x.mjs', [{ find: 'const a = 1;', replace: 'const a = 2;' }]), file('scripts/tests/t.test.mjs', 'export {};\n')),
    { root, rules: RULES, deps: { runTests: failTests } });
  assert.equal(r.ok, false);
  assert.equal(read(root, 'scripts/x.mjs'), 'const a = 1;\n');
});

test('patch: buildBundle reads path:patch=edits.json and the service accepts the result end to end', () => {
  const src = tmp(), dst = tmp();
  put(src, 'edits.json', JSON.stringify([{ find: "  'ledger-build': runLedgerBuild,", replace: "  'source-find': runJerome,\n  'ledger-build': runLedgerBuild," }]));
  put(dst, 'scripts/orchestrator.mjs', ORCH);
  const b = buildBundle(['scripts/orchestrator.mjs:patch=edits.json'], 'patch test', src);
  assert.equal(b.files[0].mode, 'patch');
  assert.equal(b.files[0].content, undefined);
  const r = placeBundle(b, { root: dst, rules: RULES });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.match(read(dst, 'scripts/orchestrator.mjs'), /'source-find': runJerome,/);
});

test('patch: through the command line, with a mix of replaced files and a patch, and the summary says which is which', () => {
  const root = tmp();
  put(root, 'scripts/place-rules.json', readFileSync(fileURLToPath(new URL('../place-rules.json', import.meta.url)), 'utf8'));
  put(root, 'scripts/orchestrator.mjs', ORCH);
  put(root, 'edits.json', JSON.stringify([{ find: "  'ledger-build': runLedgerBuild,", replace: "  'source-find': runJerome,\n  'ledger-build': runLedgerBuild," }]));
  put(root, 'docs/n.md', '# n\n');
  const make = spawnSync(process.execPath, [SERVICE, '--make', '--message', 'mix', '--out', 'inbox/m.bundle.json', 'docs/n.md', 'scripts/orchestrator.mjs:patch=edits.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(make.status, 0, make.stderr);
  rmSync(join(root, 'docs/n.md'));
  const run = spawnSync(process.execPath, [SERVICE], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(read(root, 'scripts/orchestrator.mjs'), /'source-find': runJerome,/);
  assert.equal(read(root, 'docs/n.md'), '# n\n');
  assert.deepEqual(JSON.parse(read(root, 'place-result.json')).files.sort(), ['docs/n.md', 'inbox/processed.json', 'scripts/orchestrator.mjs']);
});
