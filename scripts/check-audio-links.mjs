// scripts/check-audio-links.mjs
//
// MODULE DATE: 2026-10-27T21:55:00-05:00 (Tuesday) · v1 — ONE-TIME broken-audio-link scanner. READ-ONLY:
// it never writes data.json or anything else in the repo. It only reads and prints a report.
//
// For every story in data.json that has an audio link it checks:
//   REPO  — the mp3 and its timing .json exist in the repo (git tree), at exactly the linked path
//   SITE  — the mp3 and timing .json load from the LIVE site (what the app and visitors really get)
//           and the timing file belongs to this story and this recording
// and it also looks for the mess a lost link leaves behind: a link older than the files
// (the Anthony bug), a story with files but no link, leftover older versions, files no story uses.
//
// Where the data comes from:
//   --github owner/repo[@branch]   read the file list and data.json through GitHub's API (nothing is
//                                  cloned; this is what the workflow uses). Uses GITHUB_TOKEN if set.
//   (default)                      read ./data.json and the repo files in the current folder (--root).
// Other options:  --site https://example.org   check this site (default: settings.audioBase in data.json)
//                 --no-site                    skip the live-site checks (repo checks only)
//                 --concurrency 8   --strict (exit 1 if any ERROR)   --api-base URL (testing)
//
// Needs Node 18+ (built-in fetch). No packages.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------------------------
function parseArgs(argv){
  const o = { concurrency: 8, strict: false, site: null, noSite: false, github: null, root: '.', data: null,
              apiBase: 'https://api.github.com', out: null };
  for(let i = 0; i < argv.length; i++){
    const a = argv[i], next = () => argv[++i];
    if(a === '--github') o.github = next();
    else if(a === '--site') o.site = next();
    else if(a === '--no-site') o.noSite = true;
    else if(a === '--concurrency') o.concurrency = Math.max(1, parseInt(next(), 10) || 8);
    else if(a === '--strict') o.strict = true;
    else if(a === '--root') o.root = next();
    else if(a === '--data') o.data = next();
    else if(a === '--api-base') o.apiBase = next();
    else if(a === '--out') o.out = next();
    else { console.error('Unknown option: ' + a); process.exit(2); }
  }
  return o;
}

// ---------------------------------------------------------------------------------------------
// reading the repo (file list + data.json)
// ---------------------------------------------------------------------------------------------
async function fromGitHub(o){
  const m = /^([^/\s]+\/[^/@\s]+)(?:@(.+))?$/.exec(o.github || '');
  if(!m){ console.error('--github needs owner/repo or owner/repo@branch'); process.exit(2); }
  const repo = m[1], branch = m[2] || 'main';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const hdr = (accept) => Object.assign({ 'User-Agent': 'check-audio-links', 'Accept': accept },
    token ? { Authorization: 'Bearer ' + token } : {});
  const treeRes = await fetch(o.apiBase + '/repos/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1',
    { headers: hdr('application/vnd.github+json') });
  if(!treeRes.ok) throw new Error('GitHub file list failed: HTTP ' + treeRes.status);
  const tree = await treeRes.json();
  const files = new Set((tree.tree || []).filter(t => t.type === 'blob').map(t => t.path));
  const notes = [];
  if(tree.truncated) notes.push('GitHub says the file list was truncated, so "missing in repo" results may be wrong.');
  // raw media type: data.json is over 1 MB, and the default read sends no body for files that big
  const dRes = await fetch(o.apiBase + '/repos/' + repo + '/contents/data.json?ref=' + encodeURIComponent(branch),
    { headers: hdr('application/vnd.github.raw+json') });
  if(!dRes.ok) throw new Error('GitHub data.json read failed: HTTP ' + dRes.status);
  return { data: JSON.parse(await dRes.text()), files, notes, source: 'GitHub ' + repo + '@' + branch };
}

async function walk(dir, base, out){
  for(const d of await fs.readdir(dir, { withFileTypes: true })){
    if(d.name === '.git' || d.name === 'node_modules') continue;
    const full = path.join(dir, d.name), rel = base ? base + '/' + d.name : d.name;
    if(d.isDirectory()) await walk(full, rel, out); else out.add(rel);
  }
}
async function fromLocal(o){
  const dataPath = o.data || path.join(o.root, 'data.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  let files = new Set();
  try{    // committed files (what GitHub has); falls back to whatever is on disk
    const out = execFileSync('git', ['-C', o.root, 'ls-tree', '-r', '--name-only', 'HEAD'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    out.split('\n').filter(Boolean).forEach(p => files.add(p));
  }catch(e){ files = new Set(); }
  if(!files.size) await walk(o.root, '', files);
  return { data, files, notes: [], source: 'local folder ' + path.resolve(o.root) };
}

// ---------------------------------------------------------------------------------------------
// paths — same rules the app uses (deriveTimingPath / resolveAsset in index.html)
// ---------------------------------------------------------------------------------------------
const isAbs = p => /^(https?:)?\/\//i.test(p);
function deriveTiming(audio){
  const m = String(audio).match(/\.[a-z0-9]+$/i);
  return m ? String(audio).slice(0, -m[0].length) + '.json' : null;
}
function resolveAsset(p, base){
  if(!p) return '';
  if(isAbs(p) || p.startsWith('/') || p.startsWith('data:')) return p;
  if(!base) return p;
  const b = base.replace(/\/+$/, '');
  let q = p.replace(/^\/+/, '');
  const lastSeg = b.split('/').pop(), slash = q.indexOf('/');
  if(lastSeg && slash > 0 && q.slice(0, slash).toLowerCase() === lastSeg.toLowerCase()) q = q.slice(slash + 1);
  return (b + '/' + q).replace(/([^:])\/{2,}/g, '$1/');
}
const norm = p => String(p || '').replace(/^\/+/, '');
const parseVersioned = p => { const m = /^(.*)-v(\d+)\.([a-z0-9]+)$/i.exec(path.posix.basename(p)); return m ? { id: m[1], v: +m[2], ext: m[3].toLowerCase() } : null; };

// ---------------------------------------------------------------------------------------------
// live-site checks
// ---------------------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function http(url, opts){
  for(let attempt = 0; attempt < 2; attempt++){
    try{
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'chk=' + Date.now(), Object.assign({ signal: ctl.signal, redirect: 'follow' }, opts));
      clearTimeout(t);
      if(res.status >= 500 && attempt === 0){ await sleep(1000); continue; }
      return res;
    }catch(e){ if(attempt === 1) return { status: 0, error: e.name === 'AbortError' ? 'timed out' : e.message, headers: new Map() }; await sleep(1000); }
  }
}
async function headSize(url){
  let res = await http(url, { method: 'HEAD' });
  if(res.status === 405 || res.status === 403 || res.status === 501) res = await http(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  let size = null;
  if(res.headers && res.headers.get){
    const cr = res.headers.get('content-range'), cl = res.headers.get('content-length');
    if(cr && /\/(\d+)$/.test(cr)) size = +/\/(\d+)$/.exec(cr)[1]; else if(cl != null) size = +cl;
  }
  return { status: res.status, size, error: res.error };
}
async function getTiming(url){
  const res = await http(url, { method: 'GET' });
  if(res.status !== 200) return { status: res.status, error: res.error };
  try{ return { status: 200, json: JSON.parse(await res.text()) }; }catch(e){ return { status: 200, badJson: true }; }
}
async function pool(items, n, fn){
  let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while(i < items.length){ const k = i++; await fn(items[k], k); } }));
}

// ---------------------------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------------------------
export async function scan(o, src){
  const { data, files, notes } = src;
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const base = o.site || (data.settings && data.settings.audioBase) || '';
  const doSite = !o.noSite && !!base;
  const findings = [];   // { sev: 'ERROR'|'WARN', kind, e, msg, fix? }
  const add = (sev, kind, e, msg, fix) => findings.push({ sev, kind, id: e.id, name: e.n || e.name || e.id, msg, fix });

  // what files exist, grouped by story id and version (audio/ only)
  const byId = new Map();
  for(const f of files){
    if(!f.startsWith('audio/')) continue;
    const pv = parseVersioned(f); if(!pv) continue;
    if(!byId.has(pv.id)) byId.set(pv.id, new Map());
    const vs = byId.get(pv.id);
    if(!vs.has(pv.v)) vs.set(pv.v, {});
    vs.get(pv.v)[pv.ext === 'json' ? 'json' : 'mp3'] = f;
  }
  const newestComplete = id => {
    const vs = byId.get(id); if(!vs) return null;
    const ok = [...vs.entries()].filter(([, x]) => x.mp3 && x.json).sort((a, b) => b[0] - a[0]);
    return ok.length ? { v: ok[0][0], mp3: ok[0][1].mp3, json: ok[0][1].json } : null;
  };
  // suggest the newest complete recording, but only when it differs from what the story already points at
  const fixFor = (id, link, timing) => {
    const n = newestComplete(id); if(!n) return null;
    if(link && norm(link) === n.mp3 && timing && norm(timing) === n.json) return null;
    return 'set audio = ' + n.mp3 + '  and  audioTiming = ' + n.json;
  };

  const ids = new Set(entries.map(e => e.id));
  const withAudio = entries.filter(e => typeof e.audio === 'string' && e.audio.trim());
  const siteJobs = [];

  for(const e of withAudio){
    const link = e.audio.trim();
    const timing = (typeof e.audioTiming === 'string' && e.audioTiming.trim()) ? e.audioTiming.trim() : deriveTiming(link);
    const pv = parseVersioned(link);
    const fix = fixFor(e.id, link, timing);

    if(!isAbs(link)){
      if(!files.has(norm(link))) add('ERROR', 'REPO_AUDIO_MISSING', e, 'link points at ' + link + ', which is not in the repo', fix);
      if(timing && !isAbs(timing) && !files.has(norm(timing))) add('ERROR', 'REPO_TIMING_MISSING', e, 'timing file ' + timing + ' is not in the repo', fix);
    }
    if(!timing) add('WARN', 'NO_TIMING_PATH', e, 'no timing path could be worked out from ' + link);
    if(pv && pv.id !== e.id) add('WARN', 'NAME_MISMATCH', e, 'link file is named for "' + pv.id + '", not this story (' + e.id + ')');
    const vs = byId.get(e.id);
    if(pv && vs){
      const top = Math.max(...vs.keys());
      if(top > pv.v) add('WARN', 'LINK_BEHIND_FILES', e, 'link is v' + pv.v + ' but v' + top + ' exists in the repo', fix);
      if(vs.size > 1) add('WARN', 'EXTRA_VERSIONS', e, 'versions in repo: ' + [...vs.keys()].sort((a, b) => a - b).map(v => 'v' + v).join(', ') + ' (older ones should have been removed)');
    }
    if(doSite){
      const aUrl = resolveAsset(link, base), tUrl = timing ? resolveAsset(timing, base) : null;
      siteJobs.push({ e, link, timing, aUrl: aUrl.startsWith('//') ? 'https:' + aUrl : aUrl, tUrl: tUrl && (tUrl.startsWith('//') ? 'https:' + tUrl : tUrl), fix });
    }
  }
  for(const e of entries){
    if(e.audio && String(e.audio).trim()) continue;
    if(byId.has(e.id)){
      const n = newestComplete(e.id);
      add('WARN', 'NO_LINK_BUT_FILES', e, 'story has no audio link, but recordings exist in the repo (' + [...byId.get(e.id).keys()].sort((a, b) => a - b).map(v => 'v' + v).join(', ') + ')', fixFor(e.id));
    }
  }
  const orphans = [...byId.keys()].filter(id => !ids.has(id));

  let siteChecked = 0;
  if(doSite){
    await pool(siteJobs, o.concurrency, async (j) => {
      const [a, t] = await Promise.all([headSize(j.aUrl), j.tUrl ? getTiming(j.tUrl) : null]);
      siteChecked++;
      if(a.status !== 200 && a.status !== 206) add('ERROR', 'SITE_AUDIO_' + (a.status || 'FAILED'), j.e, 'live site gives ' + (a.status || a.error) + ' for ' + j.aUrl, j.fix);
      else if(a.size != null && a.size < 10000) add('ERROR', 'AUDIO_TINY', j.e, 'audio file is only ' + a.size + ' bytes (' + j.aUrl + ')');
      if(t){
        if(t.status !== 200) add('ERROR', 'SITE_TIMING_' + (t.status || 'FAILED'), j.e, 'live site gives ' + (t.status || t.error) + ' for ' + j.tUrl + ' (sentence sync will fail)', j.fix);
        else if(t.badJson) add('ERROR', 'TIMING_BAD_JSON', j.e, 'timing file is not valid JSON (' + j.tUrl + ')');
        else{
          const tj = t.json || {};
          if(tj.id && tj.id !== j.e.id) add('ERROR', 'TIMING_MISMATCH', j.e, 'timing file says it belongs to "' + tj.id + '"');
          if(tj.audio && norm(tj.audio) !== norm(j.link)) add('ERROR', 'TIMING_MISMATCH', j.e, 'timing file is for ' + tj.audio + ' but the link is ' + j.link, j.fix);
          if(!Array.isArray(tj.cues) || !tj.cues.length) add('WARN', 'TIMING_EMPTY', j.e, 'timing file has no sentence cues');
        }
      }
    });
  }
  return { findings, orphans: orphans.map(id => ({ id, versions: [...byId.get(id).keys()].sort((a, b) => a - b) })),
           stats: { entries: entries.length, withAudio: withAudio.length, siteChecked, doSite, base, notes, source: src.source } };
}

// ---------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------
export function render(result, cap = 150){
  const { findings, orphans, stats } = result;
  const L = [];
  const errs = findings.filter(f => f.sev === 'ERROR'), warns = findings.filter(f => f.sev === 'WARN');
  const bad = new Set(errs.map(f => f.id));
  L.push('# Audio link scan');
  L.push('');
  L.push('Source: ' + stats.source + (stats.doSite ? ' · live site: ' + stats.base : ' · live-site checks OFF'));
  L.push('');
  L.push('- Stories: **' + stats.entries + '**, with an audio link: **' + stats.withAudio + '**');
  L.push('- Stories with at least one ERROR: **' + bad.size + '**   ·   ERROR lines: **' + errs.length + '**   ·   WARN lines: **' + warns.length + '**   ·   files no story uses: **' + orphans.length + '**');
  if(stats.doSite) L.push('- Checked on the live site: ' + stats.siteChecked + ' stories (audio file + timing file each)');
  stats.notes.forEach(n => L.push('- NOTE: ' + n));
  L.push('');
  const kinds = new Map();
  for(const f of findings){ if(!kinds.has(f.kind)) kinds.set(f.kind, []); kinds.get(f.kind).push(f); }
  const order = [...kinds.keys()].sort((a, b) => {
    const sa = kinds.get(a)[0].sev === 'ERROR' ? 0 : 1, sb = kinds.get(b)[0].sev === 'ERROR' ? 0 : 1;
    return sa - sb || a.localeCompare(b);
  });
  if(!findings.length && !orphans.length) L.push('**No problems found.**', '');
  for(const k of order){
    const list = kinds.get(k);
    L.push('## ' + list[0].sev + ' · ' + k + ' (' + list.length + ')', '');
    list.sort((a, b) => a.id.localeCompare(b.id)).slice(0, cap).forEach(f => {
      L.push('- **' + f.name + '** (`' + f.id + '`) — ' + f.msg);
      if(f.fix) L.push('  - suggested: ' + f.fix);
    });
    if(list.length > cap) L.push('- …and ' + (list.length - cap) + ' more (the job log has them all)');
    L.push('');
  }
  if(orphans.length){
    L.push('## INFO · ORPHAN_FILES (' + orphans.length + ')', '', 'Recordings in the repo whose story id is not in data.json:', '');
    orphans.slice(0, cap).forEach(o => L.push('- `' + o.id + '` — ' + o.versions.map(v => 'v' + v).join(', ')));
    if(orphans.length > cap) L.push('- …and ' + (orphans.length - cap) + ' more');
    L.push('');
  }
  L.push('This scan changed nothing. "suggested" lines are only suggestions for the newest complete recording (mp3 + timing both present).');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------
async function main(){
  const o = parseArgs(process.argv.slice(2));
  const src = o.github ? await fromGitHub(o) : await fromLocal(o);
  const result = await scan(o, src);
  const text = render(result, Infinity);
  console.log(text);
  if(process.env.GITHUB_STEP_SUMMARY){ await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, render(result, 150) + '\n'); }
  if(o.out) await fs.writeFile(o.out, text + '\n');
  if(o.strict && result.findings.some(f => f.sev === 'ERROR')) process.exit(1);
}
import { fileURLToPath } from 'node:url';
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  main().catch(e => { console.error('Scan failed: ' + (e && e.message || e)); process.exit(2); });
}
