// scripts/repo-cleanup.mjs
//
// MODULE DATE: 2026-11-22T07:30:00-06:00 (Sunday) · v1 — deletes old one-time files listed in cleanup-list.txt.
//
// MODE preview (default): changes nothing. Writes a report of what WOULD be deleted, what is skipped and why,
//   and how much space it frees. MODE apply: deletes with `git rm` and the workflow makes ONE commit.
//
// WHAT IT DELETES
//   1. Every path in cleanup-list.txt (one per line; blank lines and lines starting with # are ignored).
//        a/b.txt          one file
//        folder/          every tracked file under that folder
//        folder/prefix_*  simple wildcard (* = anything except /, ** = anything)
//   2. If ORPHAN_AUDIO=true: every file under audio/ that data.json never mentions (old versions, tests).
//
// SAFETY
//   - Protected files are never deleted, whatever the list says (see PROTECTED).
//   - Before deleting a listed file it searches the other code and data files (.html .js .mjs .json .yml .py .csv
//     .txt, NOT .md notes, NOT CHANGELOG, NOT logs/reports) for its full path or file name. If something still
//     uses it, the file is SKIPPED and the report names who uses it. A folder entry is skipped whole if its
//     folder path is mentioned.
//   - Never more than LIMIT files in one run (default 600); over that, nothing is deleted.
//   - Deleting goes through git, so the commit can be reverted from GitHub's history.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MODE = (process.env.MODE || 'preview').toLowerCase();
const ORPHAN_AUDIO = String(process.env.ORPHAN_AUDIO || 'false').toLowerCase() === 'true';
const LIMIT = Number(process.env.LIMIT || 600);
const LIST_FILE = process.env.LIST_FILE || 'cleanup-list.txt';

const PROTECTED = [
  'data.json', 'index.html', 'sw.js', 'pronounce.html', 'package.json', 'package-lock.json', 'CLAUDE.md', 'README.md',
  'CHANGELOG.md', 'changelog.json', 'workLog.json', '.assetsignore', 'cleanup-list.txt',
  'pronunciation/catholic-timeline-pronunciation.json', 'scripts/repo-cleanup.mjs', '.github/workflows/repo-cleanup.yml',
];
const PROTECTED_PREFIX = ['s/', 'scripts/lib/', '.git/'];
const isProtected = (p) => PROTECTED.includes(p) || PROTECTED_PREFIX.some(x => p.startsWith(x));

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const size = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';

// ---- 1. what the list names ----
const lines = fs.existsSync(LIST_FILE)
  ? fs.readFileSync(LIST_FILE, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
const globRe = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*') + '$');
const entries = [];   // { files: [...], tokens: [...], label }
const notFound = [];
for (const line of lines) {
  if (line.endsWith('/')) {
    const files = tracked.filter(f => f.startsWith(line));
    if (!files.length) { notFound.push(line); continue; }
    entries.push({ label: line, files, tokens: [line], dir: true });
  } else if (line.includes('*')) {
    const re = globRe(line); const files = tracked.filter(f => re.test(f));
    if (!files.length) { notFound.push(line); continue; }
    entries.push({ label: line, files, tokens: null });   // tokens per file (its name)
  } else {
    if (!trackedSet.has(line)) { notFound.push(line); continue; }
    entries.push({ label: line, files: [line], tokens: null });
  }
}
const candidate = new Set(entries.flatMap(e => e.files));

// ---- 2. the search corpus: code and data files, minus the candidates themselves ----
const CODE_EXT = new Set(['.html', '.js', '.mjs', '.json', '.yml', '.yaml', '.py', '.csv', '.txt']);
const SKIP_PREFIX = ['node_modules/', 'audio/', 's/', 'ai/', 'automation/reports/', 'Images/', 'pronunciation/luna-test/', 'pronunciation/story/'];
const SKIP_FILE = new Set(['package-lock.json', 'CHANGELOG.md', 'workLog.json', 'audio-log.csv', 'cue-repair-log.csv', 'article-log.json', 'cleanup-list.txt']);
const corpus = [];
for (const f of tracked) {
  if (candidate.has(f) || SKIP_FILE.has(f) || SKIP_PREFIX.some(x => f.startsWith(x))) continue;
  if (!CODE_EXT.has(path.extname(f).toLowerCase())) continue;
  const n = size(f); if (!n || n > 6e6) continue;
  corpus.push({ f, t: fs.readFileSync(f, 'utf8') });
}
const dataJson = fs.readFileSync('data.json', 'utf8');
// A mention counts only if the text is not the tail of a longer path: "x.json" inside "pronunciation/x.json" is a
// different file, so it does not count for a top-level x.json.
const mentionRe = (needle) => new RegExp('(?<![\\w./-])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const whoUses = (needle) => { const re = mentionRe(needle); if (re.test(dataJson)) return 'data.json'; const c = corpus.find(x => re.test(x.t)); return c ? c.f : null; };

// ---- 3. decide ----
const del = [], skipped = [];
for (const e of entries) {
  if (e.dir) {
    const by = whoUses(e.tokens[0]);
    if (by) { skipped.push(`${e.label} (${e.files.length} files, ${mb(e.files.reduce((a, f) => a + size(f), 0))}) — still mentioned in ${by}`); continue; }
    for (const f of e.files) { if (isProtected(f)) skipped.push(`${f} — protected`); else del.push(f); }
    continue;
  }
  for (const f of e.files) {
    if (isProtected(f)) { skipped.push(`${f} — protected`); continue; }
    const base = path.basename(f);
    const by = whoUses(f) || (base.length >= 6 ? whoUses(base) : null);
    if (by) skipped.push(`${f} — still mentioned in ${by}`); else del.push(f);
  }
}
if (ORPHAN_AUDIO) {
  for (const f of tracked) {
    if (!f.startsWith('audio/') || isProtected(f) || del.includes(f)) continue;
    if (dataJson.includes(f)) continue;
    const by = whoUses(f);
    if (by) skipped.push(`${f} \u2014 unused by data.json but mentioned in ${by}`); else del.push(f);
  }
}
const uniq = [...new Set(del)];
const bytes = uniq.reduce((a, f) => a + size(f), 0);

// ---- 4. report ----
const rep = [];
rep.push(`# Repo cleanup — ${MODE}`, '', `Would delete **${uniq.length} files, ${mb(bytes)}**${MODE === 'apply' ? ' (deleting now)' : ''}.`, '');
if (ORPHAN_AUDIO) rep.push(`Unused audio included: ${uniq.filter(f => f.startsWith('audio/')).length} files.`, '');
if (skipped.length) rep.push('## Skipped (kept)', ...skipped.map(s => '- ' + s), '');
if (notFound.length) rep.push('## In the list but not in the repo (already gone or misspelled)', ...notFound.map(s => '- ' + s), '');
rep.push('## Files', ...uniq.slice(0, 400).map(f => `- ${f} (${mb(size(f))})`));
if (uniq.length > 400) rep.push(`- …and ${uniq.length - 400} more`);
const text = rep.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');

if (uniq.length > LIMIT) { console.error(`Refusing: ${uniq.length} files is over the limit of ${LIMIT}. Nothing deleted.`); process.exit(1); }
if (MODE === 'apply' && uniq.length) {
  for (let i = 0; i < uniq.length; i += 200) git('rm', '-q', '--', ...uniq.slice(i, i + 200));
  console.log(`Removed ${uniq.length} files.`);
}
