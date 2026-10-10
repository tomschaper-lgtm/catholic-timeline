// scripts/services/article-log.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.6 — the article log: a short, readable record of what happened on each article job.
//
// WHAT IT KEEPS (article-log.json, repo root, committed like workLog.json):
//   { "version": 1, "jobs": [ { "id", "title", "kind": "rewrite" | "new", "startedAt", "requestedBy", "status", "totalSeconds",
//        "steps": [ { "n", "who", "text", "at", "seconds",
//                     "usage": { "model", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "webSearches",
//                                "longPrompt": { same four token fields, for requests over the long-prompt threshold }, "otherUsd" } } ] } ] }
//   inputTokens is the NEW (uncached) input, as the API reports it; cache reads and writes are separate and priced separately.
//   Each service adds its own steps to the SAME job by passing the same jobId (task.payload.jobId, else the task id).
//   Steps are written by CODE from real numbers (pages, words, seconds, tokens), never by an AI, so the numbers can be trusted.
//   The log is kept apart from workLog.json so the work log's pruning never touches it. It keeps the newest MAX_JOBS jobs,
//   and drops jobs older than MAX_AGE_DAYS (Claude's guess for "a while"; change the two constants or the env vars).
//
// COST (scripts/pricing.json, editable): the log stores RAW usage per step (tokens by model, web searches). Dollars are worked
//   out when the log is shown, from the pricing file, so a price change corrects every old job. A step with no usage shows no
//   cost. A price marked "verified": false is an assumption and the cost shows an asterisk until Tom confirms it.
//   Tom's rule: "the models dictate how expensive each thing is": so the model name is stored on every step that spent tokens.
//
// NOT BUILT YET: the Log view in the website (index.html), steps for the writer / verifier / reworder / recorder services
//   (they will call addStep with the same jobId), human events such as "Tom approved a new site" (needs the approval feature).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const LOG_PATH = process.env.ARTICLE_LOG_PATH || 'article-log.json';
export const PRICING_PATH = process.env.PRICING_PATH || 'scripts/pricing.json';
export const MAX_JOBS = parseInt(process.env.ARTICLE_LOG_MAX_JOBS || '200', 10);
export const MAX_AGE_DAYS = parseInt(process.env.ARTICLE_LOG_MAX_AGE_DAYS || '90', 10);

export function loadLog(path = LOG_PATH) {
  try {
    const l = JSON.parse(readFileSync(path, 'utf8'));
    if (l && Array.isArray(l.jobs)) return l;
  } catch (_e) { /* missing or unreadable: start fresh */ }
  return { version: 1, jobs: [] };
}

export function saveLog(log, path = LOG_PATH) {
  mkdirSync(dirname(path) || '.', { recursive: true });
  writeFileSync(path, JSON.stringify(log, null, 1) + '\n');
}

export function loadPricing(path = PRICING_PATH) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (_e) { return null; }
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'job';
export const jobIdFor = (title, atIso) => 'job-' + String(atIso).slice(0, 16).replace(/[-:T]/g, '') + '-' + slug(title);   // to the minute, so two runs the same day are two jobs

// Find the job with this id, or open it.
export function openJob(log, { id, title, kind, requestedBy, at }) {
  let job = log.jobs.find(j => j.id === id);
  if (!job) {
    job = { id, title: title || id, kind: kind || 'new', startedAt: at, requestedBy: requestedBy || null, status: 'open', totalSeconds: 0, steps: [] };
    log.jobs.push(job);
  }
  return job;
}

// Add one step. Returns the step. Numbers only from real measurements; seconds may be null (instant or unknown).
export function addStep(job, { who, text, at, seconds = null, usage = null }) {
  const step = { n: job.steps.length + 1, who, text: String(text).slice(0, 400), at, seconds: seconds == null ? null : Math.round(seconds * 10) / 10 };
  if (usage) {
    const u = {};
    if (usage.model) u.model = usage.model;
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'webSearches', 'otherUsd']) if (usage[k]) u[k] = usage[k];
    if (usage.longPrompt) {
      const lp = {};
      for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) if (usage.longPrompt[k]) lp[k] = usage.longPrompt[k];
      if (Object.keys(lp).length) u.longPrompt = lp;
    }
    if (Object.keys(u).length) step.usage = u;
  }
  job.steps.push(step);
  job.totalSeconds = Math.round(job.steps.reduce((n, s) => n + (s.seconds || 0), 0) * 10) / 10;
  return step;
}

export function finishJob(job, status = 'done') { job.status = status; return job; }

// Keep the newest MAX_JOBS jobs and nothing older than MAX_AGE_DAYS. Returns how many were dropped.
export function prune(log, { maxJobs = MAX_JOBS, maxAgeDays = MAX_AGE_DAYS, now = new Date() } = {}) {
  const cutoff = now.getTime() - maxAgeDays * 86400000;
  const before = log.jobs.length;
  log.jobs = log.jobs.filter(j => Date.parse(j.startedAt) >= cutoff || !Number.isFinite(Date.parse(j.startedAt)));
  log.jobs.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  if (log.jobs.length > maxJobs) log.jobs = log.jobs.slice(log.jobs.length - maxJobs);
  return before - log.jobs.length;
}

// ---- cost ----
// Returns { usd, assumed, missing }: usd is null when nothing could be priced. assumed = used a price marked unverified.
// missing = the step spent something the pricing file has no price for (never guessed).
// Tokens are priced in buckets: the normal bucket, and (for a model with a longPrompt price, such as Haiku 5.5) a second bucket for
// requests whose prompt was over the threshold. Within a bucket: new input, cache writes (5-minute), cache reads, output.
function bucketCost(b, rates) {
  let usd = 0, missing = false;
  const parts = [['inputTokens', 'inputPerMTok'], ['outputTokens', 'outputPerMTok'], ['cacheReadTokens', 'cacheReadPerMTok'], ['cacheWriteTokens', 'cacheWritePerMTok']];
  for (const [tok, rate] of parts) {
    if (!b[tok]) continue;
    if (rates[rate] == null) missing = true;
    else usd += b[tok] * rates[rate] / 1e6;
  }
  return { usd, missing };
}
const hasTokens = b => !!(b && (b.inputTokens || b.outputTokens || b.cacheReadTokens || b.cacheWriteTokens));

export function costOfStep(step, pricing) {
  const u = step && step.usage;
  if (!u || !pricing) return { usd: null, assumed: false, missing: !!u };
  let usd = 0, priced = false, assumed = false, missing = false;
  if (u.webSearches) {
    if (pricing.webSearchPer1000 != null) { usd += u.webSearches * pricing.webSearchPer1000 / 1000; priced = true; if (pricing.webSearchVerified === false) assumed = true; }
    else missing = true;
  }
  if (hasTokens(u) || hasTokens(u.longPrompt)) {
    const m = pricing.models && pricing.models[u.model];
    if (!m) missing = true;
    else {
      for (const [bucket, rates] of [[u, m], [u.longPrompt, m.longPrompt ? { ...m, ...m.longPrompt } : m]]) {
        if (!hasTokens(bucket)) continue;
        const c = bucketCost(bucket, rates);
        if (c.missing) missing = true; else { usd += c.usd; priced = true; }
      }
      if (m.verified === false) assumed = true;
    }
  }
  if (u.otherUsd) { usd += u.otherUsd; priced = true; }
  return { usd: priced ? Math.round(usd * 1e6) / 1e6 : null, assumed, missing };
}

export function costOfJob(job, pricing) {
  let usd = 0, any = false, assumed = false, missing = false;
  for (const s of job.steps || []) {
    const c = costOfStep(s, pricing);
    if (c.usd != null) { usd += c.usd; any = true; }
    if (c.assumed) assumed = true;
    if (c.missing) missing = true;
  }
  return { usd: any ? Math.round(usd * 1e6) / 1e6 : null, assumed, missing };
}

// ---- display ----
const mins = sec => sec == null ? null : (Math.round(sec / 6) / 10) + ' min';           // 174 s -> "2.9 min"
const money = c => c.usd == null ? null : '$' + (c.usd < 0.01 ? c.usd.toFixed(4) : c.usd.toFixed(2)) + (c.assumed ? '*' : '');
const k = n => n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n);

export function stepDetail(step, pricing) {
  const bits = [];
  const t = mins(step.seconds);
  if (t) bits.push(t);
  const u = step.usage;
  if (u) {
    const lp = u.longPrompt || {};
    const inT = (u.inputTokens || 0) + (lp.inputTokens || 0), outT = (u.outputTokens || 0) + (lp.outputTokens || 0);
    const cached = (u.cacheReadTokens || 0) + (lp.cacheReadTokens || 0);
    if (inT || outT || cached) bits.push(k(inT) + ' in' + (cached ? ' + ' + k(cached) + ' cached' : '') + ' / ' + k(outT) + ' out tokens' + (u.model ? ' (' + u.model + ')' : ''));
    if (u.webSearches) bits.push(u.webSearches + ' web search' + (u.webSearches === 1 ? '' : 'es'));
    const c = costOfStep(step, pricing);
    const m = money(c);
    if (m) bits.push(m);
    else if (c.missing) bits.push('cost unknown: no price set');
  }
  return bits.join(', ');
}

// Plain-text lines for one job, in the shape Tom asked for.
export function renderJob(job, pricing = null) {
  const lines = [];
  const when = String(job.startedAt || '').replace('T', ' ').slice(0, 16);
  lines.push((job.title || job.id) + (job.kind ? ' (' + job.kind + ')' : '') + ' — ' + when + ' UTC');
  for (const s of job.steps || []) {
    const d = stepDetail(s, pricing);
    lines.push(s.n + '. ' + s.who + ': ' + s.text + (d ? ' (' + d + ')' : ''));
  }
  const c = costOfJob(job, pricing);
  const total = ['Total working time ' + (mins(job.totalSeconds) || '0 min')];   // the steps' own time; GitHub's run time adds about a minute of setup
  const m = money(c);
  if (m) total.push('cost ' + m);
  lines.push(total.join(' · '));
  if (m && c.assumed) lines.push('* includes a price that is not confirmed yet (scripts/pricing.json)');
  return lines;
}

// ---- Jerome's steps ----
const siteName = d => String(d || '').replace(/^www\./, '');
const baseDom = h => String(h || '').toLowerCase().split('.').slice(-2).join('.');

const dropUndefined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Steps from a (raw) source-finder result. result.timing is added by runSourceFinder when a search ran.
export function jeromeSteps(result, { at } = {}) {
  const steps = [];
  const s = result.subject || {};
  const name = s.name || 'the subject';
  const what = result.mode === 'rewrite' ? 'rewrite of ' + name : 'new article: ' + name;
  steps.push({ who: 'Jerome', text: 'Got request for ' + what, at });
  if (result.outcome === 'error') { steps.push({ who: 'Jerome', text: 'Could not handle the request: ' + result.reason, at }); return steps; }
  if (result.outcome === 'exists') { steps.push({ who: 'Jerome', text: 'Already on the timeline as ' + (result.match && result.match.name) + '; nothing to do', at }); return steps; }
  if (result.outcome === 'possible_match' && !result.search) {
    steps.push({ who: 'Jerome', text: 'Similar entries exist (' + (result.matches || []).map(m => m.name).join(', ') + '); waiting for a person to decide', at });
    return steps;
  }
  const L3 = result.layer3;
  if (result.search && result.search.counts) {
    const c = result.search.counts;
    const usable = (result.search.sources || []).filter(x => x.usable);
    const hosts = usable.length ? usable.map(x => x.domain)
      : L3 && L3.selection ? [...L3.selection.selected, ...L3.selection.alsoFound].map(x => x.domain) : [];
    const pages = c.usableApproved + c.usableUnjudged;
    const tm = result.timing || {};
    steps.push({ who: 'Jerome', at, seconds: tm.seconds,
      text: 'Found ' + pages + ' usable pages on ' + new Set(hosts.map(baseDom)).size + ' sites, ' + c.totalWordsUsable.toLocaleString('en-US') + ' words in all',
      usage: dropUndefined({ model: tm.model, inputTokens: tm.inputTokens, outputTokens: tm.outputTokens, cacheReadTokens: tm.cacheReadTokens,
               cacheWriteTokens: tm.cacheWriteTokens, longPrompt: tm.longPrompt, webSearches: tm.webSearches }) });
  } else if (result.search && result.search.error) {
    steps.push({ who: 'Jerome', text: 'Source search failed: ' + result.search.error, at });
    return steps;
  }
  if (L3 && L3.selection && L3.selection.selected.length) {
    const sel = L3.selection.selected;
    steps.push({ who: 'Jerome', at, text: 'Ranked the sites and kept the best ' + sel.length + ' of ' + (sel.length + L3.selection.alsoFound.length) + ': ' +
      sel.map((x, i) => (i + 1) + ' ' + siteName(x.domain) + (x.lane ? ' (' + x.lane.replace(/_/g, ' ') + ')' : '') + ' ' + x.score).join('; ') });
  }
  if (L3) {
    const bits = [L3.status === 'ready' ? 'Enough to write from' : L3.status === 'needs_decision' ? 'Needs a decision' : L3.status === 'too_thin' ? 'Too thin' : L3.status === 'not_found' ? 'Nothing found' : 'Check: ' + L3.status];
    if (L3.verdict && L3.verdict.basis) bits.push('basis: ' + L3.verdict.basis.replace(/_/g, ' ') + (L3.verdict.evidence && L3.verdict.evidence.also_qualified ? ' (also ' + L3.verdict.evidence.also_qualified.map(x => x.replace(/_/g, ' ')).join(', ') + ')' : ''));
    if (L3.verdict && L3.verdict.advisory && L3.verdict.advisory.length) bits.push('advice only (rewrite): ' + L3.verdict.advisory.map(x => x.text).join('; '));
    if (L3.reason) bits.push(L3.reason);
    if (L3.flags && L3.flags.length) bits.push('flags: ' + L3.flags.join(', '));
    steps.push({ who: 'Jerome', at, text: bits.join('; ') });
    // Unjudged sites that could make the material enough: a person (and later Ignatius) decides whether to approve them.
    const uj = (L3.decisions || []).find(d => d.kind === 'unjudged_sources');
    if (uj && uj.urls && uj.urls.length) {
      const count = {};
      for (const u of uj.urls) { try { const h = new URL(u).hostname.replace(/^www\./, ''); count[h] = (count[h] || 0) + 1; } catch (_e) { /* skip */ } }
      steps.push({ who: 'Jerome', at, text: 'Unjudged sites waiting for approval: ' + Object.entries(count).map(([h, n]) => h + (n > 1 ? ' (' + n + ' pages)' : '')).join(', ') });
    }
  }
  // The diocese lookup (apparitions and miracles): what was found and handed to Ignatius.
  const au = result.authority;
  if (au) {
    if (au.error) steps.push({ who: 'Jerome', at, text: 'Diocese lookup failed: ' + au.error });
    else if (!au.found) steps.push({ who: 'Jerome', at, text: 'Could not find the diocese\'s own website' + (au.note ? ' (' + au.note + ')' : '') });
    else {
      const where = [au.diocese, [au.place, au.country].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
      for (const c of au.candidates) {
        const lead = (c.role === 'diocese' ? 'Diocese' : 'Other official') + ' website ' + (c.domain || c.url) + (c.role === 'diocese' && where ? ' (' + where + ')' : '');
        if (c.registry === 'new') {
          const ck = c.checks || {};
          steps.push({ who: 'Jerome', at, text: 'Handed to Ignatius: ' + lead + '; ' + (c.verified
            ? 'the page loads, names the diocese ' + ck.dioceseMentions + ' time(s) and reads like a church site'
            : 'NOT confirmed as a church site (' + (c.note || 'unknown') + ')') + '; waiting for his decision' });
        } else if (c.registry === 'approved') steps.push({ who: 'Jerome', at, text: lead + ' is already an approved source' });
        else if (c.registry === 'disabled') steps.push({ who: 'Jerome', at, text: lead + ' is on the registry but switched off' });
        else steps.push({ who: 'Jerome', at, text: lead + ' was skipped: ' + (c.note || 'not an allowed kind of site') });
      }
    }
  }
  return steps;
}

// Add Jerome's steps for one finished run to the log file. Returns the job.
export function recordJerome({ result, task, logPath = LOG_PATH, now = new Date() }) {
  const at = now.toISOString();
  const p = (task && task.payload) || {};
  const log = loadLog(logPath);
  const s = result.subject || {};
  const title = s.name || p.name || 'Untitled';
  const id = p.jobId || (task && task.id) || jobIdFor(title, at);
  const job = openJob(log, { id, title, kind: result.mode === 'rewrite' ? 'rewrite' : 'new', requestedBy: p.requestedBy, at });
  for (const st of jeromeSteps(result, { at })) addStep(job, st);
  prune(log, { now });
  saveLog(log, logPath);
  return job;
}

// ---- Thomas's steps (ledger-build: the source check of one article) ----
// ledger: the ledger object ledger-build writes (summary, sourceHealth, claims, pipeline?, usage?: [{ role, provider, model, calls, inputTokens, outputTokens,
// cacheReadTokens?, cacheWriteTokens? }], seconds?). The cost is NOT stored in the log: each step carries its role's tokens and model, and the dollars are worked out
// from scripts/pricing.json when a job is viewed, like Jerome's.
const usageOf = u => u ? dropUndefined({ model: u.model, inputTokens: u.inputTokens || undefined, outputTokens: u.outputTokens || undefined,
  cacheReadTokens: u.cacheReadTokens || undefined, cacheWriteTokens: u.cacheWriteTokens || undefined }) : null;

export function ledgerSteps(ledger, { at } = {}) {
  const s = ledger.summary || {};
  const claims = ledger.claims || [];
  const health = ledger.sourceHealth || [];
  const by = r => (ledger.usage || []).find(u => u.role === r);
  const steps = [];

  let read = 'Read ' + health.filter(h => h.ok).length + ' of ' + health.length + ' source page(s)';
  const pl = ledger.pipeline;
  if (pl) read += ' (Jerome\'s file: ' + pl.linked + ' linked in the article, ' + pl.notLinked + ' not linked, so only suggestions)';
  const drifted = health.filter(h => h.jerome && h.jerome.drift === 'changed').length;
  if (drifted) read += '; ' + drifted + ' page(s) differ in length from what Jerome saw';
  steps.push({ who: 'Thomas', at, text: read });

  const ex = by('extractor');
  steps.push({ who: 'Thomas', at, text: 'Listed ' + (s.total || 0) + ' claims to check' + (s.extractorRejected ? ' (' + s.extractorRejected + ' dropped: not copied word for word)' : ''), usage: usageOf(ex) });

  const withProof = claims.filter(c => c.sources && c.sources.length && c.status !== 'unsourced').length;
  const pv = by('prover');
  steps.push({ who: 'Thomas', at, text: 'Found a word-for-word excerpt for ' + withProof + ' of ' + (s.total || 0) + ' claims', usage: usageOf(pv) });

  const judged = claims.filter(c => c.judge);
  const jd = by('judge');
  steps.push({ who: 'Thomas', at, text: 'Judged ' + judged.length + ' excerpt(s) blind: ' + judged.filter(c => c.judge === 'supports').length + ' supported', usage: usageOf(jd) });

  const parts = [(s.verified || 0) + ' verified'];
  if (s.reported) parts.push(s.reported + ' reported');
  parts.push((s.traditional || 0) + ' traditional', (s.disputed || 0) + ' disputed', (s.unsourced || 0) + ' unsourced');
  steps.push({ who: 'Thomas', at, text: 'Result: ' + parts.join(', ') + (s.missingNumbers ? '; ' + s.missingNumbers + ' with numbers absent from the sources' : ''), seconds: ledger.seconds });
  for (const st of steps) if (!st.usage) delete st.usage;          // a step with no measured tokens carries no usage at all
  return steps;
}

export function recordLedger({ entry, ledger, task, multi = false, logPath = LOG_PATH, now = new Date() }) {
  const at = now.toISOString();
  const p = (task && task.payload) || {};
  const log = loadLog(logPath);
  const base = p.jobId || (task && task.id) || jobIdFor(entry.n, at);
  const id = !p.jobId && multi ? base + ':' + entry.id : base;
  const job = openJob(log, { id, title: entry.n || entry.id, kind: 'check', requestedBy: p.requestedBy, at });
  for (const st of ledgerSteps(ledger, { at })) addStep(job, st);
  prune(log, { now });
  saveLog(log, logPath);
  return job;
}

