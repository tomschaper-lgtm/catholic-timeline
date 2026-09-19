// scripts/sync-changelog.mjs
//
// Files changelog entries out of index.html's header comment into CHANGELOG.md, then trims the
// header back to the newest few.
//
// WHY THE ENTRIES START IN index.html AT ALL
// index.html is the file a chat session can edit and hand back whole; CHANGELOG.md is not, so
// entries written straight there kept getting lost between sessions. Writing them where the work
// already happens makes the changelog a byproduct of the change rather than a separate step to
// remember. This job is the janitor that keeps that from growing without bound — which is the
// same problem v418 solved by moving the changelog OUT of the header in the first place. The
// difference now is the janitor.
//
// PRUNE BY VERSION NUMBER, NEVER BY AGE
// "Delete anything older than a week" would silently drop an entry that never reached
// CHANGELOG.md if this job failed for a week. So: file first, and only ever drop a version from
// the header once it is confirmed present in CHANGELOG.md. That makes the whole run idempotent —
// twice in a day is a no-op the second time, and a week of failures loses nothing.
//
// SENTINELS, NOT PATTERN-MATCHING
// A daily job that rewrites index.html is the risky part of this: unlike workLog.json, a bad
// write takes the whole site down rather than one task. So this only ever replaces the span
// between the two sentinel lines, each of which must appear exactly once ALONE ON ITS OWN LINE,
// and never regexes across the rest of the file. Same discipline as a str_replace needing a
// unique match. The own-line rule matters: the header's own prose describes this mechanism and
// would otherwise match itself. If either sentinel is missing or duplicated, the run aborts
// without writing anything.
//
// Usage: node scripts/sync-changelog.mjs [--dry-run]
// Env:   INDEX_PATH, CHANGELOG_PATH, KEEP_VERSIONS, GIT_PUSH_RETRIES, GIT_RETRY_BASE_MS

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const INDEX_PATH = process.env.INDEX_PATH || 'index.html';
const CHANGELOG_PATH = process.env.CHANGELOG_PATH || 'CHANGELOG.md';
// How many of the newest versions stay in the header after filing. Purely cosmetic — everything
// dropped is already in CHANGELOG.md — but a couple of recent entries in the header are handy
// context for the next session that opens the file.
const KEEP_VERSIONS = parseInt(process.env.KEEP_VERSIONS || '3', 10);
const GIT_PUSH_RETRIES = parseInt(process.env.GIT_PUSH_RETRIES || '4', 10);
const GIT_RETRY_BASE_MS = parseInt(process.env.GIT_RETRY_BASE_MS || '1200', 10);
const DRY_RUN = process.argv.includes('--dry-run');

const BEGIN_RE = /^CHANGELOG:BEGIN[ \t]*$/m;
const END_RE = /^CHANGELOG:END[ \t]*$/m;

function fail(msg){
  console.error('sync-changelog: ' + msg);
  process.exit(1);
}

function countMatches(text, re){
  const g = new RegExp(re.source, 'gm');
  let n = 0;
  while(g.exec(text) !== null) n++;
  return n;
}

// ---- Locate the staging block --------------------------------------------------------------
// Both sentinels must appear exactly once, alone on their line. Anything else means the header is
// not in the shape this job knows how to edit, and guessing is exactly what must not happen here.
function locateBlock(html){
  const beginCount = countMatches(html, BEGIN_RE);
  const endCount = countMatches(html, END_RE);
  if(beginCount !== 1 || endCount !== 1){
    fail('expected exactly one CHANGELOG:BEGIN line and one CHANGELOG:END line in ' + INDEX_PATH +
         ' (found ' + beginCount + ' and ' + endCount + ') — aborting without writing.');
  }
  const bm = html.match(BEGIN_RE);
  const em = html.match(END_RE);
  const start = bm.index + bm[0].length;
  const stop = em.index;
  if(stop < start) fail('CHANGELOG:END appears before CHANGELOG:BEGIN — aborting without writing.');
  return { start, stop, body: html.slice(start, stop) };
}

// ---- Parse version blocks ------------------------------------------------------------------
// Split on "## vNNN" headings. Anything before the first heading is whitespace between the
// sentinel and the first entry; it is regenerated rather than preserved.
const HEADING_RE = /^##\s+v(\d+)\b.*$/gm;

function parseBlocks(body){
  const blocks = [];
  const heads = [];
  let m;
  HEADING_RE.lastIndex = 0;
  while((m = HEADING_RE.exec(body)) !== null){
    heads.push({ version: parseInt(m[1], 10), index: m.index });
  }
  for(let i = 0; i < heads.length; i++){
    const from = heads[i].index;
    const to = (i + 1 < heads.length) ? heads[i + 1].index : body.length;
    blocks.push({ version: heads[i].version, text: body.slice(from, to).trim() });
  }
  return blocks;
}

// Version numbers already filed in CHANGELOG.md, at any heading depth (## or ###), so this keeps
// working if the file's own heading level ever shifts.
function filedVersions(md){
  const seen = new Set();
  const re = /^#{2,3}\s+v(\d+)\b/gm;
  let m;
  while((m = re.exec(md)) !== null) seen.add(parseInt(m[1], 10));
  return seen;
}

// ---- Insert into CHANGELOG.md --------------------------------------------------------------
// New entries go directly above the newest existing entry, so the file stays newest-first and
// the preamble above it is never touched. With no entries yet, they go after the preamble's
// trailing "---" separator, or at the end if there isn't one.
function insertEntries(md, entries){
  const text = entries.map(e => e.text.trim()).join('\n\n') + '\n\n';
  const firstHeading = md.search(/^#{2,3}\s+v\d+\b/m);
  if(firstHeading !== -1) return md.slice(0, firstHeading) + text + md.slice(firstHeading);
  const sep = md.indexOf('\n---\n');
  if(sep !== -1){
    const after = sep + '\n---\n'.length;
    return md.slice(0, after) + '\n' + text + md.slice(after).replace(/^\n+/, '');
  }
  return md.replace(/\n*$/, '\n\n') + text;
}

// ---- git ------------------------------------------------------------------------------------
function sh(cmd){ return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function sleepMs(ms){
  try{ execSync('sleep ' + (Math.max(ms, 0) / 1000).toFixed(2), { stdio: 'ignore' }); }catch(_e){}
}
function currentBranch(){
  try{ return sh('git rev-parse --abbrev-ref HEAD').trim() || 'main'; }catch(_e){ return 'main'; }
}

// Same shape as orchestrator.mjs's pushWithResync, minus the JSON re-apply step: on rejection this
// re-reads both files from the resynced tree and redoes the whole computation, which is safe
// precisely because the run is idempotent. Named file paths only — never `git add -A`.
function commitAndPush(paths, message, redo){
  const branch = currentBranch();
  const addArgs = paths.map(p => JSON.stringify(p)).join(' ');
  for(let attempt = 0; attempt <= GIT_PUSH_RETRIES; attempt++){
    try{
      execSync('git add ' + addArgs, { stdio: 'inherit' });
      try{ execSync('git diff --cached --quiet'); return true; } // nothing staged is not an error
      catch(_e){ /* there IS a staged diff — commit it */ }
      execSync('git commit -m ' + JSON.stringify(message), { stdio: 'inherit' });
      execSync('git push', { stdio: 'inherit' });
      return true;
    }catch(err){
      if(attempt >= GIT_PUSH_RETRIES){
        console.warn('Push failed after ' + (GIT_PUSH_RETRIES + 1) + ' attempts: ' + err.message);
        return false;
      }
      console.warn('Push rejected (attempt ' + (attempt + 1) + '); resyncing to origin/' + branch);
      try{
        execSync('git fetch origin ' + branch, { stdio: 'inherit' });
        execSync('git reset --hard origin/' + branch, { stdio: 'inherit' });
        if(typeof redo === 'function') redo();
      }catch(resyncErr){
        console.warn('Resync itself failed: ' + resyncErr.message);
      }
      sleepMs(GIT_RETRY_BASE_MS * Math.pow(2, attempt));
    }
  }
  return false;
}

// ---- Run -------------------------------------------------------------------------------------
function run(){
  if(!existsSync(INDEX_PATH)) fail(INDEX_PATH + ' not found.');
  if(!existsSync(CHANGELOG_PATH)) fail(CHANGELOG_PATH + ' not found.');

  const html = readFileSync(INDEX_PATH, 'utf8');
  const md = readFileSync(CHANGELOG_PATH, 'utf8');
  const { start, stop, body } = locateBlock(html);

  const blocks = parseBlocks(body).sort((a, b) => b.version - a.version);
  if(!blocks.length){
    console.log('sync-changelog: staging block is empty — nothing to do.');
    return { changed: false };
  }

  const filed = filedVersions(md);
  const toFile = blocks.filter(b => !filed.has(b.version));   // newest-first already
  const keep = blocks.slice(0, Math.max(KEEP_VERSIONS, 0));
  const keepSet = new Set(keep.map(b => b.version));
  const dropped = blocks.filter(b => !keepSet.has(b.version));

  const newMd = toFile.length ? insertEntries(md, toFile) : md;
  const newBody = '\n' + keep.map(b => b.text).join('\n\n') + '\n';
  const newHtml = html.slice(0, start) + newBody + html.slice(stop);

  const mdChanged = newMd !== md;
  const htmlChanged = newHtml !== html;

  console.log('sync-changelog: ' + blocks.length + ' block(s) staged; ' +
    toFile.length + ' newly filed (' + (toFile.map(b => 'v' + b.version).join(', ') || 'none') + '); ' +
    dropped.length + ' pruned from header (' + (dropped.map(b => 'v' + b.version).join(', ') || 'none') + ').');

  // Every pruned version is in CHANGELOG.md by now — either it already was, or it was filed a few
  // lines above. This assertion is the one that makes pruning safe, so it is checked rather than
  // assumed: bail out of the prune (but keep the filing) if it ever fails.
  const nowFiled = filedVersions(newMd);
  const unsafe = dropped.filter(b => !nowFiled.has(b.version));
  if(unsafe.length){
    fail('refusing to prune ' + unsafe.map(b => 'v' + b.version).join(', ') +
         ' — not present in ' + CHANGELOG_PATH + ' after filing. Nothing written.');
  }

  if(DRY_RUN){
    console.log('sync-changelog: --dry-run, no files written.');
    return { changed: mdChanged || htmlChanged };
  }
  if(!mdChanged && !htmlChanged){
    console.log('sync-changelog: already in sync — nothing written.');
    return { changed: false };
  }

  if(mdChanged) writeFileSync(CHANGELOG_PATH, newMd);
  if(htmlChanged) writeFileSync(INDEX_PATH, newHtml);
  return { changed: true, toFile, dropped };
}

const result = run();
if(result.changed && !DRY_RUN){
  const filedList = (result.toFile || []).map(b => 'v' + b.version).join(', ');
  const msg = 'Changelog sync' + (filedList ? ': filed ' + filedList : ': prune only');
  commitAndPush([CHANGELOG_PATH, INDEX_PATH], msg, () => run());
}
