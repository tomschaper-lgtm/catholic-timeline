// scripts/tests/article-log.test.mjs
// MODULE DATE: 2026-10-08 (Thursday) · tests for scripts/services/article-log.mjs v0.1 (temp files only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLog, saveLog, loadPricing, jobIdFor, openJob, addStep, finishJob, prune, costOfStep, costOfJob, stepDetail, renderJob, jeromeSteps, recordJerome } from '../services/article-log.mjs';

const PRICING = loadPricing(fileURLToPath(new URL('../pricing.json', import.meta.url)));
const dir = () => mkdtempSync(join(tmpdir(), 'alog-'));
const AT = '2026-10-08T22:46:43.000Z';

test('pricing file loads: web search price is confirmed, the model price is marked as an assumption', () => {
  assert.equal(PRICING.webSearchPer1000, 10);
  assert.equal(PRICING.webSearchVerified, true);
  assert.equal(PRICING.models['claude-sonnet-4-6'].verified, false);
});

test('loadLog: missing or damaged file gives an empty log, never a crash', () => {
  const d = dir();
  assert.deepEqual(loadLog(join(d, 'nope.json')), { version: 1, jobs: [] });
  writeFileSync(join(d, 'bad.json'), '{ not json');
  assert.deepEqual(loadLog(join(d, 'bad.json')).jobs, []);
});

test('job ids: to the minute, readable, and safe', () => {
  assert.equal(jobIdFor('St. Augustine of Hippo', AT), 'job-202610082246-st-augustine-of-hippo');
  assert.equal(jobIdFor('???', AT), 'job-202610082246-job');
});

test('addStep numbers steps, rounds seconds, and keeps a running total', () => {
  const log = { version: 1, jobs: [] };
  const job = openJob(log, { id: 'j1', title: 'Augustine', kind: 'rewrite', at: AT });
  addStep(job, { who: 'Jerome', text: 'one', at: AT, seconds: 174.04 });
  addStep(job, { who: 'Augustine', text: 'two', at: AT, seconds: 191.96 });
  addStep(job, { who: 'Tom', text: 'three, no timing', at: AT });
  assert.deepEqual(job.steps.map(s => s.n), [1, 2, 3]);
  assert.equal(job.steps[0].seconds, 174);
  assert.equal(job.steps[2].seconds, null);
  assert.equal(job.totalSeconds, 366);
  assert.equal(openJob(log, { id: 'j1', at: AT }), job);              // same id: the same job
  assert.equal(log.jobs.length, 1);
});

test('usage is stored raw (tokens, model, searches), and empty usage is dropped', () => {
  const job = openJob({ jobs: [] }, { id: 'j', at: AT });
  const s = addStep(job, { who: 'Jerome', text: 'x', at: AT, usage: { model: 'm', inputTokens: 100, outputTokens: 0, webSearches: 3 } });
  assert.deepEqual(s.usage, { model: 'm', inputTokens: 100, webSearches: 3 });
  assert.equal(addStep(job, { who: 'Jerome', text: 'y', at: AT, usage: { inputTokens: 0 } }).usage, undefined);
});

test('cost: searches at $10 per 1,000 plus tokens by model; an unconfirmed model price is flagged as assumed', () => {
  const step = { usage: { model: 'claude-sonnet-4-6', inputTokens: 200000, outputTokens: 10000, webSearches: 5 } };
  const c = costOfStep(step, PRICING);
  // 5 searches = $0.05; tokens = 200000*3/1e6 + 10000*15/1e6 = $0.60 + $0.15 = $0.75
  assert.equal(c.usd, 0.8);
  assert.equal(c.assumed, true);
  assert.equal(c.missing, false);
});

test('cost: a confirmed price is not marked assumed; a model with no price is reported as missing, not guessed', () => {
  const sure = { ...PRICING, models: { m: { inputPerMTok: 1, outputPerMTok: 2, verified: true } } };
  assert.equal(costOfStep({ usage: { model: 'm', inputTokens: 1e6, outputTokens: 1e6 } }, sure).assumed, false);
  assert.equal(costOfStep({ usage: { model: 'm', inputTokens: 1e6, outputTokens: 1e6 } }, sure).usd, 3);
  const none = costOfStep({ usage: { model: 'unpriced', inputTokens: 5000 } }, PRICING);
  assert.equal(none.usd, null);
  assert.equal(none.missing, true);
  assert.equal(costOfStep({ usage: { webSearches: 2 } }, { models: {} }).missing, true);   // no search price set
  assert.equal(costOfStep({ text: 'no usage' }, PRICING).usd, null);
  assert.equal(costOfStep({ usage: { webSearches: 1 } }, null).usd, null);
});

test('cost: a service can report its own dollars as otherUsd (audio, images)', () => {
  assert.equal(costOfStep({ usage: { otherUsd: 0.42 } }, PRICING).usd, 0.42);
});

test('job cost adds the steps that can be priced and keeps the flags', () => {
  const job = { steps: [{ usage: { webSearches: 10 } }, { text: 'no usage' }, { usage: { model: 'claude-sonnet-4-6', inputTokens: 1e6 } }] };
  const c = costOfJob(job, PRICING);
  assert.equal(c.usd, 3.1);
  assert.equal(c.assumed, true);
});

test('stepDetail and renderJob: minutes, tokens by model, searches, cost, total', () => {
  const log = { jobs: [] };
  const job = openJob(log, { id: 'j', title: 'St. Augustine', kind: 'rewrite', at: AT });
  addStep(job, { who: 'Jerome', text: 'Got request for rewrite of St. Augustine', at: AT });
  addStep(job, { who: 'Jerome', text: 'Found 18 usable pages on 7 sites, 89,759 words in all', at: AT, seconds: 174, usage: { model: 'claude-sonnet-4-6', inputTokens: 41200, outputTokens: 3100, webSearches: 5 } });
  const lines = renderJob(job, PRICING);
  assert.match(lines[0], /^St\. Augustine \(rewrite\) — 2026-10-08 22:46 UTC$/);
  assert.equal(lines[1], '1. Jerome: Got request for rewrite of St. Augustine');
  assert.match(lines[2], /^2\. Jerome: Found 18 usable pages on 7 sites, 89,759 words in all \(2\.9 min, 41\.2k in \/ 3\.1k out tokens \(claude-sonnet-4-6\), 5 web searches, \$0\.\d\d\*\)$/);
  assert.match(lines[3], /^Total task 2\.9 min · cost \$0\.\d\d\*$/);
  assert.match(lines[4], /not confirmed/);
});

test('renderJob without pricing still shows time and raw usage, and says the cost is unknown', () => {
  const job = openJob({ jobs: [] }, { id: 'j', title: 'T', at: AT });
  addStep(job, { who: 'Jerome', text: 'x', at: AT, seconds: 60, usage: { inputTokens: 1000, webSearches: 1 } });
  const text = renderJob(job, null).join('\n');
  assert.match(text, /1 min/);
  assert.match(text, /1 web search\b/);
  assert.match(text, /cost unknown/);
});

test('prune: drops jobs older than the age limit and keeps only the newest N', () => {
  const log = { jobs: [] };
  for (let i = 0; i < 5; i++) openJob(log, { id: 'j' + i, at: new Date(Date.parse(AT) - i * 86400000).toISOString() });
  openJob(log, { id: 'old', at: new Date(Date.parse(AT) - 200 * 86400000).toISOString() });
  const dropped = prune(log, { maxJobs: 3, maxAgeDays: 90, now: new Date(AT) });
  assert.equal(dropped, 3);                                            // 1 too old, 2 over the count
  assert.deepEqual(log.jobs.map(j => j.id), ['j2', 'j1', 'j0']);       // oldest first, the three newest kept
});

test('saveLog / loadLog round trip', () => {
  const p = join(dir(), 'sub', 'article-log.json');
  const log = { version: 1, jobs: [] };
  addStep(openJob(log, { id: 'j', title: 'T', at: AT }), { who: 'Jerome', text: 'x', at: AT });
  saveLog(log, p);
  assert.equal(loadLog(p).jobs[0].steps[0].text, 'x');
  assert.ok(readFileSync(p, 'utf8').endsWith('\n'));
});

// ---- Jerome's steps ----
const RESULT = {
  outcome: 'rewrite_ready', mode: 'rewrite', subject: { id: 'st-augustine-430', name: 'St. Augustine', category: 's' },
  search: { counts: { usableApproved: 18, usableUnjudged: 0, totalWordsUsable: 89759 }, sources: [
    { usable: true, domain: 'www.newadvent.org' }, { usable: true, domain: 'www.ewtn.com' }, { usable: true, domain: 'www.ewtn.com' }, { usable: false, domain: 'www.britannica.com' }] },
  timing: { seconds: 174.2, webSearches: 5, model: 'claude-sonnet-4-6', inputTokens: 41200, outputTokens: 3100 },
  layer3: { status: 'ready', flags: ['single_source'], verdict: { basis: 'ancient_veneration' },
    selection: { selected: [{ domain: 'www.newadvent.org', lane: 'history_biography', score: 100 }, { domain: 'www.ewtn.com', lane: 'magisterial', score: 100 }], alsoFound: [{ domain: 'www.ewtn.com' }] } }
};

test('jeromeSteps: request, what was found with time and usage, the ranking, and the verdict', () => {
  const st = jeromeSteps(RESULT, { at: AT });
  assert.equal(st[0].text, 'Got request for rewrite of St. Augustine');
  assert.equal(st[1].text, 'Found 18 usable pages on 2 sites, 89,759 words in all');
  assert.equal(st[1].seconds, 174.2);
  assert.deepEqual(st[1].usage, { model: 'claude-sonnet-4-6', inputTokens: 41200, outputTokens: 3100, webSearches: 5 });
  assert.equal(st[2].text, 'Ranked the sites and kept the best 2 of 3: 1 newadvent.org (history biography) 100; 2 ewtn.com (magisterial) 100');
  assert.equal(st[3].text, 'Enough to write from; basis: ancient veneration; flags: single_source');
});

test('jeromeSteps: new article, already exists, possible match, error, search failure', () => {
  assert.equal(jeromeSteps({ outcome: 'new_subject', mode: 'new', subject: { name: 'St. Bertha' } }, { at: AT })[0].text, 'Got request for new article: St. Bertha');
  const ex = jeromeSteps({ outcome: 'exists', mode: 'new', subject: { name: 'St. Peter' }, match: { name: 'St. Peter' } }, { at: AT });
  assert.match(ex[1].text, /Already on the timeline as St\. Peter; nothing to do/);
  const pm = jeromeSteps({ outcome: 'possible_match', mode: 'new', subject: { name: 'X' }, matches: [{ name: 'A' }, { name: 'B' }] }, { at: AT });
  assert.match(pm[1].text, /Similar entries exist \(A, B\); waiting for a person/);
  assert.match(jeromeSteps({ outcome: 'error', mode: 'rewrite', subject: {}, reason: 'no entry with id x' }, { at: AT })[1].text, /Could not handle the request: no entry with id x/);
  assert.match(jeromeSteps({ outcome: 'new_subject', mode: 'new', subject: { name: 'X' }, search: { error: 'boom' } }, { at: AT })[1].text, /Source search failed: boom/);
});

test('jeromeSteps: needs_decision shows the reason; works when the long page list was stripped from the result', () => {
  const r = JSON.parse(JSON.stringify(RESULT));
  delete r.search.sources;
  r.layer3.status = 'needs_decision'; r.layer3.reason = 'not canonized'; r.layer3.verdict = {};
  const st = jeromeSteps(r, { at: AT });
  assert.equal(st[1].text, 'Found 18 usable pages on 2 sites, 89,759 words in all');   // sites counted from the selection
  assert.equal(st[3].text, 'Needs a decision; not canonized; flags: single_source');
});

test('recordJerome: creates the job, adds the steps, and a later call with the same jobId adds to the same job', () => {
  const d = dir(), p = join(d, 'article-log.json');
  const job = recordJerome({ result: RESULT, task: { id: 'task-7', payload: {} }, logPath: p, now: new Date(AT) });
  assert.equal(job.id, 'task-7');
  assert.equal(job.kind, 'rewrite');
  assert.equal(job.steps.length, 4);
  const again = recordJerome({ result: RESULT, task: { id: 'task-8', payload: { jobId: 'task-7' } }, logPath: p, now: new Date(AT) });
  assert.equal(again.steps.length, 8);
  assert.equal(loadLog(p).jobs.length, 1);
  assert.equal(loadLog(p).jobs[0].totalSeconds, 348.4);          // the saved job, after both runs
});

test('recordJerome without a task id or jobId makes a readable id', () => {
  const p = join(dir(), 'l.json');
  assert.equal(recordJerome({ result: RESULT, task: { payload: {} }, logPath: p, now: new Date(AT) }).id, 'job-202610082246-st-augustine');
});
