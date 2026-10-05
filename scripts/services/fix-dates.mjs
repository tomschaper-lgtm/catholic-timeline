// One-time: put every article's dates in American order and clear the audio link of each article
// that changed, so it shows as needing a new recording (2026-10-05).
//   MODE=preview (default) — only report what would change; nothing is written.
//   MODE=apply             — change data.json (the workflow commits it).
// The conversion is the recorder's own (american-dates.mjs, also used by audio-generate.mjs): article
// sections and headings, the short description and Quick Facts values; quotes from sources and
// anything inside quotation marks are never touched. Old MP3/timing files are left in the repo;
// the next recording of an article removes its old versions.
import fs from 'node:fs/promises';
import { americanizeEntryDates } from './american-dates.mjs';

const MODE = (process.env.MODE || 'preview').trim().toLowerCase() === 'apply' ? 'apply' : 'preview';
const DATA = process.env.DATA_PATH || 'data.json';
const AUDIO_FIELDS = ['audio', 'audioTiming', 'audioEngine', 'audioTitleEnd', 'audioInvocation', 'audioPron'];

const raw = await fs.readFile(DATA, 'utf8');
const data = JSON.parse(raw);
const entries = Array.isArray(data) ? data : (data.entries || []);

// A readable "before -> after" for the report: the first changed sentence.
function firstChange(before, after){
  const pick = (e) => [e.d || '', ...((e.art && e.art.sections) || []).flatMap(s => [s.h || '', s.b || '']), ...((Array.isArray(e.facts) ? e.facts : []).map(f => (f && f.value) || ''))];
  const a = pick(before), b = pick(after);
  for(let i = 0; i < a.length; i++){
    if(a[i] === b[i]) continue;
    const strip = (x) => x.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
    const sa = strip(a[i]), sb = strip(b[i]);
    let k = 0; while(k < sa.length && sa[k] === sb[k]) k++;
    let from = Math.max(0, k - 30); if(from > 0){ const sp = sa.indexOf(' ', from); from = sp >= 0 && sp < k ? sp + 1 : from; }
    const cut = (x) => { const t = x.slice(from, from + 70); return (from > 0 ? '\u2026' : '') + t.replace(/\s+\S*$/, '') + '\u2026'; };
    return [cut(sa), cut(sb)];
  }
  return ['', ''];
}

const rows = [];
let dates = 0, cleared = 0;
for(const e of entries){
  const before = JSON.parse(JSON.stringify(e));
  const n = americanizeEntryDates(e);
  if(!n) continue;
  dates += n;
  const hadAudio = !!e.audio;
  if(hadAudio){ cleared++; if(MODE === 'apply') AUDIO_FIELDS.forEach(f => { delete e[f]; }); }
  rows.push({ id: e.id, name: e.n, n, hadAudio, ex: firstChange(before, e) });
  if(MODE !== 'apply') Object.assign(e, before);   // preview: leave everything as it was
}

if(MODE === 'apply' && rows.length){
  const indent = /^\{\s*\n(\s+)"/.exec(raw);            // keep the file's own layout
  await fs.writeFile(DATA, JSON.stringify(data, null, indent ? indent[1].length : 0) + (raw.endsWith('\n') ? '\n' : ''));
}

const lines = [];
lines.push('# Dates in American order — ' + (MODE === 'apply' ? 'APPLIED' : 'preview (nothing changed)'));
lines.push('');
lines.push('**' + rows.length + '** of ' + entries.length + ' articles, **' + dates + '** dates' +
  (MODE === 'apply' ? '; audio link cleared on **' + cleared + '** of them (they now need recording).' : '; ' + cleared + ' of them have audio that would be cleared.'));
if(MODE !== 'apply') lines.push('', 'To make these changes, run this workflow again with mode **apply**.');
lines.push('', '| Article | Dates | Had audio | Example (before → after) |', '|---|---|---|---|');
for(const r of rows) lines.push('| ' + r.name + ' | ' + r.n + ' | ' + (r.hadAudio ? 'yes' : 'no') + ' | ' + r.ex[0].replace(/\|/g, '/') + ' → ' + r.ex[1].replace(/\|/g, '/') + ' |');
const report = lines.join('\n') + '\n';
if(process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report.split('\n').slice(0, 4).join('\n'));
console.log('[fix-dates] ' + MODE + ': ' + rows.length + ' articles, ' + dates + ' dates, ' + cleared + ' audio links ' + (MODE === 'apply' ? 'cleared' : 'would be cleared'));
