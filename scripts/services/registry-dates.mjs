// scripts/services/registry-dates.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.2 — "When was this site approved?": the date and the person on every source in the registry.
//
// WHAT TOM ASKED FOR: on the page that lists the approved websites with all their descriptions (SOURCE-ALLOWLIST.md, generated from
// scripts/ledger-allowlist.json), show the date each site was approved and added to the list.
//
// THE FIELDS (on every entry of scripts/ledger-allowlist.json):
//   "addedAt":    "YYYY-MM-DD"  the day the site was first put on the list (even if switched off); null when it cannot be known
//   "approvedAt": "YYYY-MM-DD"  the day the site was approved, i.e. first enabled, so the ledger may use it; null for a site that is only listed
//   "approvedBy": "Tom" | "Ignatius" | ...  who approved it; null when it was not recorded
//   (the existing "vetted" note is a different thing: when and how the operator was CHECKED, not when the site was approved.)
//
// THREE JOBS:
//   1. BACKFILL the sites that were added before dates were recorded. The only honest source is the repo's own history: addedAt = the first commit whose
//      copy of the registry contains the domain; approvedAt = the first commit where it was also enabled (a site listed but switched off has no
//      approvedAt). That needs the full git history, so it runs in a workflow (registry-dates.yml).
//      approvedBy stays null: the person who committed a file is not necessarily the person who approved the site.
//   2. STAMP every future approval: stampApproval / entryFromQueueItem / addApproved are what Ignatius (not built yet) calls when he approves a site
//      from ignatius-queue.json, and what anyone adding a site by hand should use, so the date is never forgotten.
//   3. SHOW it: updateDoc adds an "Approved" column to the descriptions page (every table whose columns are Domain, Operator, ...), refreshes the
//      date in the page header, and is safe to run again.
//
// COMMAND LINE (run by .github/workflows/registry-dates.yml, which checks out the full history):
//   node scripts/services/registry-dates.mjs --backfill [--registry scripts/ledger-allowlist.json] [--doc SOURCE-ALLOWLIST.md] [--dry]
// It rewrites the registry in its own format (one-space indent) and prints how many entries it dated. Nothing is changed for entries that already
// have an approvedAt.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REGISTRY_PATH = 'scripts/ledger-allowlist.json';
export const DOC_PATH = 'SOURCE-ALLOWLIST.md';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const isDate = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(s));
export const dayOf = d => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

// ---- 1. dates from the repo's own history ----
const defaultGit = args => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ' + args.slice(0, 2).join(' ') + ' failed: ' + String(r.stderr || '').slice(0, 200));
  return r.stdout;
};

// Map of domain -> { date, approved, sha, author }: `date` is the day of the FIRST commit whose copy of the registry contains the domain (when it
// was put on the list); `approved` is the day of the first commit where it was also enabled (null if never). runGit(argsArray) returns stdout;
// it is injected so tests can use a temporary repository.
export function datesFromHistory({ file = REGISTRY_PATH, runGit = defaultGit } = {}) {
  const log = runGit(['log', '--reverse', '--format=%H|%aI|%an', '--', file]).split('\n').filter(Boolean);
  const first = new Map();
  for (const line of log) {
    const [sha, iso, ...rest] = line.split('|');
    let reg;
    try { reg = JSON.parse(runGit(['show', sha + ':' + file])); } catch (_e) { continue; }        // an unreadable old version is skipped
    for (const e of (reg && reg.domains) || []) {
      if (!e || !e.domain) continue;
      const day = iso.slice(0, 10);
      let h = first.get(e.domain);
      if (!h) { h = { date: day, approved: null, sha, author: rest.join('|') }; first.set(e.domain, h); }
      if (e.enabled !== false && !h.approved) h.approved = day;
    }
  }
  return first;
}

// Give every entry that lacks them an addedAt and approvedAt from history. A site that is switched off is only listed, so it gets no approvedAt.
// Returns { approved, listedOnly, unknown, kept }.
export function backfill(reg, history) {
  let approved = 0, listedOnly = 0, unknown = 0, kept = 0;
  for (const e of reg.domains) {
    const h = history.get(e.domain);
    if (!isDate(e.addedAt)) e.addedAt = h ? h.date : null;
    if (isDate(e.approvedAt)) kept++;
    else if (e.enabled === false) { e.approvedAt = null; listedOnly++; }
    else if (h && (h.approved || h.date)) { e.approvedAt = h.approved || h.date; approved++; }
    else { e.approvedAt = null; unknown++; }
    if (!('approvedBy' in e)) e.approvedBy = null;
  }
  reg.datesNote = 'addedAt is the day a site was put on this list; approvedAt is the day it was approved (first enabled), null while it is only listed. For sites added before 2026-10-09 both come from the first commit of this file that contained the domain (and had it enabled); approvedBy was not recorded then. null means unknown or not approved.';
  return { approved, listedOnly, unknown, kept };
}

// ---- 2. stamping approvals ----
export function stampApproval(entry, { by, at }) {
  if (!by || !String(by).trim()) throw new Error('an approval needs to say who approved it');
  entry.addedAt = isDate(entry.addedAt) ? entry.addedAt : dayOf(at);
  entry.approvedAt = dayOf(at);
  entry.approvedBy = String(by).trim();
  return entry;
}

// The registry entry for a site Ignatius has approved from the queue (an item of ignatius-queue.json).
export function entryFromQueueItem(item, { by, at }) {
  if (!item || !item.suggestedEntry || !item.suggestedEntry.domain) throw new Error('this queue item has no suggested registry entry');
  const day = dayOf(at);
  const e = { ...item.suggestedEntry, enabled: true };
  e.vetted = 'proposed by ' + (item.proposedBy || 'Jerome') + ' ' + String(item.firstSeen || '').slice(0, 10) + '; judged and approved by ' + by + ' ' + day +
    (item.verified ? '; the page was checked: it loads, names the diocese and reads like a church site' : '; the page could NOT be confirmed as a church site by the code check');
  return stampApproval(e, { by, at });
}

// Add an approved entry to the registry (never replaces an existing domain) and mark the file as updated that day.
export function addApproved(reg, entry, { at }) {
  if (!isDate(entry.approvedAt) || !entry.approvedBy) throw new Error('only a stamped entry can be added (approvedAt and approvedBy)');
  if (reg.domains.some(e => e.domain === entry.domain)) throw new Error(entry.domain + ' is already in the registry');
  reg.domains.push(entry);
  reg.updated = dayOf(at);
  return reg;
}

// ---- 3. the descriptions page ----
export const approvalText = e => !e || !isDate(e.approvedAt) ? 'date not recorded'
  : e.approvedAt + (e.approvedBy ? ' by ' + e.approvedBy : '') + (isDate(e.addedAt) && e.addedAt !== e.approvedAt ? ' (listed ' + e.addedAt + ')' : '');

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const row = cs => '| ' + cs.join(' | ') + ' |';

export function updateDoc(md, reg, { now = new Date() } = {}) {
  const byDomain = new Map(reg.domains.map(e => [e.domain, e]));
  const lines = md.split('\n');
  const out = [];
  let i = 0, tables = 0, rows = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith('|')) { out.push(lines[i]); i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].trim().startsWith('|')) j++;
    const block = lines.slice(i, j), head = cells(block[0]);
    if (head[0] === 'Domain' && head[1] === 'Operator' && head.length >= 6) {
      tables++;
      const has = head[head.length - 1] === 'Approved';
      block.forEach((ln, k) => {
        const cs = cells(ln);
        if (k === 0) { if (!has) cs.push('Approved'); }
        else if (k === 1) { if (!has) cs.push('---'); }
        else {
          const dom = (cs[0] || '').replace(/`/g, '');
          const txt = approvalText(byDomain.get(dom));
          if (has) cs[cs.length - 1] = txt; else cs.push(txt);
          rows++;
        }
        out.push(row(cs));
      });
    } else out.push(...block);
    i = j;
  }
  let text = out.join('\n');
  const day = dayOf(now), wd = WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()];
  text = text.replace(/DOC DATE: \d{4}-\d\d-\d\d \([A-Za-z]+\)/, 'DOC DATE: ' + day + ' (' + wd + ')');
  const note = ' Each entry also records the day it was approved and added to the list (`approvedAt`) and who approved it (`approvedBy`); the Approved column shows both.';
  if (!text.includes('`approvedAt`')) text = text.replace(/(\n5\. \*\*Checked, and dated\.\*\*[^\n]*)/, '$1' + note);
  return { text, tables, rows };
}

// ---- command line ----
function readJson(path) { const raw = readFileSync(path, 'utf8'); return { reg: JSON.parse(raw), trailingNewline: raw.endsWith('\n') }; }
export const writeRegistry = (path, reg, trailingNewline) => writeFileSync(path, JSON.stringify(reg, null, 1) + (trailingNewline ? '\n' : ''));

function main(argv) {
  const get = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  if (!argv.includes('--backfill')) { console.error('usage: registry-dates.mjs --backfill [--registry path] [--doc path] [--dry]'); return 2; }
  const regPath = get('--registry') || REGISTRY_PATH, docPath = get('--doc') || DOC_PATH, dry = argv.includes('--dry');
  const { reg, trailingNewline } = readJson(regPath);
  const history = datesFromHistory({ file: regPath });
  const r = backfill(reg, history);
  console.log('registry: ' + reg.domains.length + ' entries; approval dated from history: ' + r.approved + '; already dated: ' + r.kept + '; listed only (switched off): ' + r.listedOnly + '; date unknown: ' + r.unknown);
  if (r.unknown) console.log('unknown: ' + reg.domains.filter(e => e.enabled !== false && !isDate(e.approvedAt)).map(e => e.domain).join(', '));
  if (!dry) writeRegistry(regPath, reg, trailingNewline);
  if (existsSync(docPath)) {
    const d = updateDoc(readFileSync(docPath, 'utf8'), reg);
    console.log('doc: ' + d.tables + ' table(s), ' + d.rows + ' row(s) now show the approval date');
    if (!dry) writeFileSync(docPath, d.text);
  } else console.log('doc: ' + docPath + ' not found, skipped');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
