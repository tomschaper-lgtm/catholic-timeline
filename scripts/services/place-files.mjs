// scripts/services/place-files.mjs
// MODULE DATE: 2026-10-08 (Thursday) · v0.2 — "Place files": put the files from a bundle in the right folders, check them, commit them.
//
// THE PROBLEM IT SOLVES: Claude's chat sandbox cannot push to GitHub. Files used to travel one by one, each carried to
// its own folder by hand. Now Claude sends ONE file, a bundle, and this service does the placing.
//
// HOW IT IS USED
//   1. Claude builds   inbox/<name>.bundle.json   (this file's --make mode, below) and hands it over.
//   2. Tom uploads that one file to the repo, into inbox/ (or the repo's top folder; both are watched).
//   3. .github/workflows/place-files.yml runs this file. It places every file, runs the tests that came with them,
//      and, if everything passes, commits the files and removes the bundle. If anything fails NOTHING is changed.
//
// BUNDLE FORMAT (JSON, one file)
//   { "bundle": 1, "message": "commit message", "files": [
//       { "path": "scripts/services/x.mjs", "content": "...", "encoding": "utf8" | "base64",
//         "sha256": "<hex of the decoded bytes>", "mode": "replace" | "create-only" } ] }
//   sha256 is required: it catches a file damaged or edited on its way to the repo. mode defaults to replace;
//   create-only skips a file that already exists (for config files Tom edits, such as category-rules.json).
//   PATCH (v0.2): { "path": "scripts/orchestrator.mjs", "mode": "patch", "sha256": "<hex of JSON.stringify(edits)>",
//                   "edits": [ { "find": "exact text, must occur ONCE in the file as it is now", "replace": "new text" } ] }
//   Edits are applied to the file AS IT IS IN THE REPO, so they can never overwrite changes made since Claude last saw the
//   file. If a find is missing or matches more than once, the whole bundle is refused. The patched file still has to pass the
//   JSON / syntax checks, and the bundle's tests. Use patch for small changes to big files (adding a line to a list).
//
// SAFETY (all in scripts/place-rules.json, which a bundle can never change)
//   Paths must be relative, plain, and under an allowed folder. Never: .git/, .github/, node_modules/, inbox/, ledger/,
//   sources/, data.json, workLog.json, index.html, package.json, the source registry, place-rules.json and this file.
//   Sizes are capped. .json files must parse; .mjs/.cjs files must pass `node --check`. The whole bundle is checked
//   BEFORE anything is written; then files are written, the bundle's own tests run, and on any failure every file is
//   restored. A bundle that was already processed (same bytes) is skipped, via inbox/processed.json.
//   TRUST: whoever can put a file in the repo's inbox can run code in CI with write access to the repo, exactly as
//   whoever can push code can. Do not give this workflow any secrets.
//
// ORCHESTRATOR: runPlaceFiles(task, data, deps) follows the handler contract (returns summary, result, filesToCommit).
//   It is NOT registered in orchestrator.mjs; the workflow calls the command line instead.
//
// COMMAND LINE
//   node scripts/services/place-files.mjs                       place every pending bundle (inbox/ and top folder)
//   node scripts/services/place-files.mjs path/to/x.bundle.json  place one bundle
//   node scripts/services/place-files.mjs --make --message "text" --out inbox/x.bundle.json file1 file2:create-only file3:patch=edits.json
//   Writes place-result.json (files to commit, bundles to remove, message) and place-summary.md. Exit 1 if any bundle failed.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RULES_PATH = process.env.PLACE_RULES_PATH || 'scripts/place-rules.json';
const TEST_RE = /^scripts\/tests\/[^/]+\.test\.mjs$/;

export function loadPlaceRules(path = RULES_PATH) {
  if (!existsSync(path)) throw new Error('placement rules not found at ' + path + ' (commit scripts/place-rules.json first)');
  const r = JSON.parse(readFileSync(path, 'utf8'));
  if (!(Array.isArray(r.allowedPrefixes) && r.maxFileBytes && r.maxBundleBytes)) throw new Error('placement rules at ' + path + ' are not in the expected shape');
  return r;
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// Returns a plain-language problem, or null when the path is acceptable.
export function checkPath(p, rules) {
  if (typeof p !== 'string' || !p) return 'path is missing';
  if (p.includes('\0') || p.includes('\\')) return 'path has illegal characters';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'path must be relative to the repo root';
  if (p.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return 'path has an empty, . or .. part';
  if (posix.normalize(p) !== p) return 'path is not in plain form';
  const lower = p.toLowerCase();
  for (const d of rules.deniedPrefixes || []) if (lower.startsWith(d.toLowerCase())) return 'bundles may never write under ' + d;
  if ((rules.protectedFiles || []).some(f => f.toLowerCase() === lower)) return 'this file is protected and a bundle cannot replace it';
  const okPrefix = (rules.allowedPrefixes || []).some(a => p.startsWith(a));
  const okRoot = rules.allowedRootPattern ? new RegExp(rules.allowedRootPattern).test(p) : false;
  if (!okPrefix && !okRoot) return 'path is outside the allowed locations';
  return null;
}

function defaultCheckSyntax(path, buf) {
  const dir = mkdtempSync(join(tmpdir(), 'place-syntax-'));
  try {
    const f = join(dir, basename(path));
    writeFileSync(f, buf);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status === 0) return { ok: true };
    return { ok: false, message: String(r.stderr || 'syntax error').split('\n').filter(Boolean).slice(0, 4).join(' | ').slice(0, 300) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function defaultRunTests(files, root) {
  // NODE_TEST_CONTEXT is set when we are already running inside `node --test`; left in, a nested run reports success
  // whatever happens. Remove it so the gate always judges the bundle's tests on their own.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, encoding: 'utf8', env, timeout: 180000 });
  return { ok: r.status === 0, output: String(r.stdout || '') + String(r.stderr || '') };
}

// A patch entry: apply the edits to the file that is in the repo NOW. Returns { error } or { buf, plan }.
function planPatch(f, root, rules, deps) {
  const p = f.path;
  if (!Array.isArray(f.edits) || !f.edits.length) return { error: 'patch has no edits' };
  if (f.edits.length > 20) return { error: 'patch has too many edits (limit 20)' };
  if (!f.sha256 || sha256(Buffer.from(JSON.stringify(f.edits), 'utf8')) !== String(f.sha256).toLowerCase()) return { error: 'checksum missing or does not match (the patch was damaged or edited on the way)' };
  const abs = join(root, p);
  if (!existsSync(abs) || statSync(abs).isDirectory()) return { error: 'a patch needs the file to exist already, and it does not' };
  const before = readFileSync(abs, 'utf8');
  let text = before;
  for (let i = 0; i < f.edits.length; i++) {
    const e = f.edits[i];
    if (!e || typeof e.find !== 'string' || !e.find || typeof e.replace !== 'string') return { error: 'edit ' + (i + 1) + ' needs text in "find" and in "replace"' };
    const n = text.split(e.find).length - 1;
    if (n === 0) return { error: 'edit ' + (i + 1) + ': the text to find is not in the file as it is now (the file changed since Claude saw it); nothing was placed' };
    if (n > 1) return { error: 'edit ' + (i + 1) + ': the text to find appears ' + n + ' times; it must appear exactly once' };
    text = text.replace(e.find, () => e.replace);          // function form: "$" in the new text is taken literally
  }
  const buf = Buffer.from(text, 'utf8');
  if (buf.length > rules.maxFileBytes) return { error: 'the patched file would be too large' };
  if (/\.json$/i.test(p)) { try { JSON.parse(text); } catch (e) { return { error: 'the patched file is not valid JSON (' + String(e.message).slice(0, 80) + ')' }; } }
  if (/\.(mjs|cjs)$/i.test(p)) { const sc = (deps.checkSyntax || defaultCheckSyntax)(p, buf); if (!sc.ok) return { error: 'the patched file has a syntax error: ' + sc.message }; }
  return { buf, plan: { path: p, buf, mode: 'patch', status: text === before ? 'unchanged' : 'changed' } };
}

// Check a whole bundle WITHOUT writing anything. Returns { errors, plan }.
export function planBundle(bundle, rules, root = '.', deps = {}) {
  const errors = [], plan = [];
  if (!bundle || bundle.bundle !== 1 || !Array.isArray(bundle.files) || !bundle.files.length) {
    return { errors: ['this is not a bundle (expected {"bundle":1,"files":[...]})'], plan };
  }
  if (bundle.files.length > rules.maxFiles) errors.push('too many files (' + bundle.files.length + '; limit ' + rules.maxFiles + ')');
  const seen = new Set();
  let total = 0;
  for (const f of bundle.files) {
    const p = f && f.path;
    const pe = checkPath(p, rules);
    if (pe) { errors.push((typeof p === 'string' ? p : '(no path)') + ': ' + pe); continue; }
    if (seen.has(p.toLowerCase())) { errors.push(p + ': listed twice'); continue; }
    seen.add(p.toLowerCase());
    if (f.mode === 'patch') { const r = planPatch(f, root, rules, deps); if (r.error) errors.push(p + ': ' + r.error); else { total += r.buf.length; plan.push(r.plan); } continue; }
    if (typeof f.content !== 'string') { errors.push(p + ': content is missing'); continue; }
    if (f.encoding != null && f.encoding !== 'utf8' && f.encoding !== 'base64') { errors.push(p + ': unknown encoding ' + f.encoding); continue; }
    if (f.mode != null && f.mode !== 'replace' && f.mode !== 'create-only' && f.mode !== 'patch') { errors.push(p + ': unknown mode ' + f.mode); continue; }
    const buf = Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8');
    if (!f.sha256 || sha256(buf) !== String(f.sha256).toLowerCase()) { errors.push(p + ': checksum missing or does not match (the file was damaged or edited on the way)'); continue; }
    if (buf.length > rules.maxFileBytes) { errors.push(p + ': file is too large (' + buf.length + ' bytes)'); continue; }
    total += buf.length;
    if (/\.json$/i.test(p)) { try { JSON.parse(buf.toString('utf8')); } catch (e) { errors.push(p + ': not valid JSON (' + String(e.message).slice(0, 80) + ')'); continue; } }
    if (/\.(mjs|cjs)$/i.test(p)) { const s = (deps.checkSyntax || defaultCheckSyntax)(p, buf); if (!s.ok) { errors.push(p + ': syntax error: ' + s.message); continue; } }
    const abs = join(root, p);
    const exists = existsSync(abs);
    if (exists && statSync(abs).isDirectory()) { errors.push(p + ': a folder with this name already exists'); continue; }
    const mode = f.mode === 'create-only' ? 'create-only' : 'replace';
    const status = exists ? (mode === 'create-only' ? 'skipped_exists' : readFileSync(abs).equals(buf) ? 'unchanged' : 'changed') : 'new';
    plan.push({ path: p, buf, mode, status });
  }
  if (total > rules.maxBundleBytes) errors.push('bundle is too large (' + total + ' bytes; limit ' + rules.maxBundleBytes + ')');
  return { errors, plan };
}

// Check, write, run the bundle's own tests, and restore everything if anything goes wrong.
export function placeBundle(bundle, { root = '.', rules, deps = {} } = {}) {
  const { errors, plan } = planBundle(bundle, rules, root, deps);
  const out = { ok: false, errors: [...errors], placed: [], unchanged: [], skipped: [], tests: { ran: false } };
  if (out.errors.length) return out;
  const writes = plan.filter(x => x.status === 'new' || x.status === 'changed');
  out.unchanged = plan.filter(x => x.status === 'unchanged').map(x => x.path);
  out.skipped = plan.filter(x => x.status === 'skipped_exists').map(x => x.path);
  const backup = writes.map(w => ({ path: w.path, orig: existsSync(join(root, w.path)) ? readFileSync(join(root, w.path)) : null }));
  const restore = () => { for (const b of backup) { const abs = join(root, b.path); if (b.orig == null) rmSync(abs, { force: true }); else writeFileSync(abs, b.orig); } };
  try {
    for (const w of writes) { mkdirSync(dirname(join(root, w.path)), { recursive: true }); writeFileSync(join(root, w.path), w.buf); }
    const testFiles = writes.map(w => w.path).filter(p => TEST_RE.test(p));
    if (rules.runTests !== false && testFiles.length) {
      const t = (deps.runTests || defaultRunTests)(testFiles, root);
      out.tests = { ran: true, ok: !!t.ok, files: testFiles, tail: String(t.output || '').slice(-1500) };
      if (!t.ok) { restore(); out.errors.push('the tests that came with this bundle failed, so nothing was placed'); return out; }
    } else {
      out.tests = { ran: false, note: testFiles.length ? 'tests are switched off in the rules' : 'the bundle has no test files' };
    }
  } catch (e) {
    restore();
    out.errors.push('writing failed, all files were put back: ' + String((e && e.message) || e).slice(0, 200));
    return out;
  }
  out.placed = writes.map(w => ({ path: w.path, status: w.status }));
  out.ok = true;
  return out;
}

// Build a bundle from files on disk. specs: ['path', 'path:create-only', ...].
export function buildBundle(specs, message, root = '.') {
  const files = specs.map(spec => {
    const pm = /^(.*?):patch=(.+)$/.exec(spec);                       // path:patch=edits.json  (edits.json = [{find, replace}, ...])
    if (pm) {
      const edits = JSON.parse(readFileSync(join(root, pm[2]), 'utf8'));
      return { path: pm[1], mode: 'patch', edits, sha256: sha256(Buffer.from(JSON.stringify(edits), 'utf8')) };
    }
    const m = /^(.*?)(?::(create-only|replace))?$/.exec(spec);
    const path = m[1], mode = m[2] || 'replace';
    const buf = readFileSync(join(root, path));
    let text = null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_e) { /* binary */ }
    const f = text != null ? { path, encoding: 'utf8', content: text } : { path, encoding: 'base64', content: buf.toString('base64') };
    return { ...f, sha256: sha256(buf), ...(mode === 'create-only' ? { mode } : {}) };
  });
  return { bundle: 1, message: message || 'Place files', created: new Date().toISOString(), files };
}

// ---- the record of bundles already placed (so the same bundle is never applied twice) ----
const loadLedger = (root, rules) => { const p = join(root, rules.ledgerPath || 'inbox/processed.json'); try { return JSON.parse(readFileSync(p, 'utf8')); } catch (_e) { return {}; } };
const saveLedger = (root, rules, ledger) => { const p = join(root, rules.ledgerPath || 'inbox/processed.json'); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(ledger, null, 2) + '\n'); };

export function pendingBundles(root = '.', rules) {
  const found = [];
  for (const dir of rules.intakeFolders || ['inbox']) {
    const abs = join(root, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const name of readdirSync(abs).sort()) if (/\.bundle\.json$/i.test(name) && statSync(join(abs, name)).isFile()) found.push(dir === '.' ? name : dir + '/' + name);
  }
  return found;
}

export function processBundleFile(bundlePath, { root = '.', rules, deps = {} } = {}) {
  const res = { bundle: bundlePath, ok: false, errors: [], placed: [], unchanged: [], skipped: [], files: [], remove: [] };
  let raw;
  try { raw = readFileSync(join(root, bundlePath)); } catch (e) { res.errors.push('cannot read the bundle: ' + String(e.message).slice(0, 120)); return res; }
  const hash = sha256(raw);
  const ledger = loadLedger(root, rules);
  if (ledger[hash]) { res.ok = true; res.already = true; res.remove = [bundlePath]; return res; }
  let bundle;
  try { bundle = JSON.parse(raw.toString('utf8')); } catch (_e) { res.errors.push('the bundle is not valid JSON (was it damaged or edited?)'); return res; }
  const r = placeBundle(bundle, { root, rules, deps });
  Object.assign(res, { errors: r.errors, placed: r.placed, unchanged: r.unchanged, skipped: r.skipped, tests: r.tests });
  if (!r.ok) return res;
  res.message = String(bundle.message || 'Place files from ' + basename(bundlePath)).slice(0, 200);
  ledger[hash] = { at: new Date().toISOString(), bundle: basename(bundlePath), message: res.message, placed: r.placed.map(x => x.path) };
  saveLedger(root, rules, ledger);
  res.files = [...r.placed.map(x => x.path), rules.ledgerPath || 'inbox/processed.json'];
  res.remove = [bundlePath];
  res.ok = true;
  return res;
}

// Orchestrator handler contract (not registered yet). task.payload.bundle = one bundle path; blank = every pending bundle.
export async function runPlaceFiles(task, _data, deps = {}) {
  const root = deps.root || '.';
  const rules = deps.rules || loadPlaceRules();
  const one = task && task.payload && task.payload.bundle;
  const list = one ? [one] : pendingBundles(root, rules);
  const results = list.map(b => processBundleFile(b, { root, rules, deps }));
  const failed = results.filter(r => !r.ok);
  const files = [...new Set(results.flatMap(r => r.files))];
  const summary = list.length ? results.length + ' bundle(s): ' + results.filter(r => r.ok).length + ' placed, ' + failed.length + ' failed; ' + files.length + ' file(s) to commit' : 'no bundles waiting';
  if (failed.length) throw new Error(summary + ' — ' + failed.map(f => f.bundle + ': ' + f.errors.join('; ')).join(' | ').slice(0, 600));
  return { summary, result: { bundles: results.map(r => ({ bundle: r.bundle, placed: r.placed, unchanged: r.unchanged, skipped: r.skipped, tests: r.tests, already: !!r.already })) }, filesToCommit: files };
}

function summaryMarkdown(results) {
  const lines = ['### Place files'];
  if (!results.length) lines.push('No bundles were waiting.');
  for (const r of results) {
    lines.push('', '**' + r.bundle + '** — ' + (r.already ? 'already placed earlier, skipped' : r.ok ? 'placed' : 'FAILED, nothing was changed'));
    for (const e of r.errors) lines.push('- ' + e);
    for (const p of r.placed) lines.push('- ' + p.status + ': ' + p.path);
    for (const p of r.unchanged) lines.push('- unchanged: ' + p);
    for (const p of r.skipped) lines.push('- left alone (create-only, already exists): ' + p);
    if (r.tests && r.tests.ran) lines.push('- tests: ' + (r.tests.ok ? 'passed' : 'FAILED') + ' (' + r.tests.files.join(', ') + ')');
    if (r.tests && r.tests.ran && !r.tests.ok) lines.push('```', r.tests.tail, '```');
  }
  return lines.join('\n') + '\n';
}

function main(argv) {
  if (argv[0] === '--make') {
    const msgI = argv.indexOf('--message'), outI = argv.indexOf('--out');
    const message = msgI >= 0 ? argv[msgI + 1] : 'Place files';
    const out = outI >= 0 ? argv[outI + 1] : null;
    const specs = argv.filter((a, i) => !a.startsWith('--') && (msgI < 0 || i !== msgI + 1) && (outI < 0 || i !== outI + 1));
    if (!out || !specs.length) { console.error('usage: place-files.mjs --make --message "text" --out inbox/name.bundle.json file1 file2:create-only file3:patch=edits.json'); return 2; }
    const b = buildBundle(specs, message);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(b, null, 1) + '\n');
    console.log('wrote ' + out + ' with ' + b.files.length + ' file(s)');
    return 0;
  }
  const rules = loadPlaceRules();
  const list = argv.length ? argv : pendingBundles('.', rules);
  const results = list.map(b => processBundleFile(b, { root: '.', rules }));
  const md = summaryMarkdown(results);
  console.log(md);
  const files = [...new Set(results.flatMap(r => r.files))];
  const messages = results.filter(r => r.ok && !r.already && r.message).map(r => r.message);
  writeFileSync('place-result.json', JSON.stringify({ message: messages.join(' + ').slice(0, 300) || 'Place files', files, remove: results.flatMap(r => r.remove), bundles: results.map(r => ({ bundle: r.bundle, ok: r.ok })) }, null, 1) + '\n');
  writeFileSync('place-summary.md', md);
  return results.some(r => !r.ok) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
