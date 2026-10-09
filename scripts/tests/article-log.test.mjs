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

test('pricing file: web search and every listed model price came from Anthropic\'s own page and are marked verified', () => {
  assert.equal(PRICING.webSearchPer1000, 10);
  assert.equal(PRICING.webSearchVerified, true);
  for (const [id, m] of Object.entries(PRICING.models)) assert.equal(m.verified, true, id);
  const s46 = PRICING.models['claude-sonnet-4-6'];
  assert.deepEqual([s46.inputPerMTok, s46.outputPerMTok, s46.cacheWritePerMTok, s46.cacheReadPerMTok], [3, 15, 3.75, 0.30]);
});

test('pricing file: the 5.5 family and Fable, with cache prices', () => {
  const m = PRICING.models;
  assert.deepEqual([m['claude-sonnet-5-5'].inputPerMTok, m['claude-sonnet-5-5'].outputPerMTok, m['claude-sonnet-5-5'].cacheReadPerMTok], [2, 10, 0.10]);
  assert.deepEqual([m['claude-opus-5-5'].inputPerMTok, m['claude-opus-5-5'].outputPerMTok, m['claude-opus-5-5'].cacheReadPerMTok], [4, 20, 0.20]);
  assert.deepEqual([m['claude-fable-5-1'].inputPerMTok, m['claude-fable-5-1'].outputPerMTok, m['claude-fable-5-1'].cacheReadPerMTok], [10, 50, 0.25]);
  const h = m['claude-haiku-5-5'];
  assert.deepEqual([h.inputPerMTok, h.outputPerMTok, h.cacheReadPerMTok], [0.10, 0.50, 0.01]);
  assert.deepEqual([h.longPrompt.thresholdTokens, h.longPrompt.inputPerMTok, h.longPrompt.outputPerMTok], [100000, 0.50, 2.50]);
  assert.match(PRICING._tokenizer, /30% more tokens/);
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

test('cost: searches at $10 per 1,000 plus tokens by model; verified prices carry no asterisk', () => {
  const step = { usage: { model: 'claude-sonnet-4-6', inputTokens: 200000, outputTokens: 10000, webSearches: 5 } };
  const c = costOfStep(step, PRICING);
  // 5 searches = $0.05; tokens = 200000*3/1e6 + 10000*15/1e6 = $0.60 + $0.15 = $0.75
  assert.equal(c.usd, 0.8);
  assert.equal(c.assumed, false);
  assert.equal(c.missing, false);
});

test('cost: a price marked unverified is flagged as assumed', () => {
  const shaky = { ...PRICING, models: { m: { inputPerMTok: 1, outputPerMTok: 2, verified: false } } };
  assert.equal(costOfStep({ usage: { model: 'm', inputTokens: 1e6 } }, shaky).assumed, true);
  assert.equal(costOfStep({ usage: { webSearches: 1 } }, { ...PRICING, webSearchVerified: false }).assumed, true);
});

test('cost: cache reads and writes are priced separately from new input (Sonnet 5.5: write $2.50, read $0.10 per million)', () => {
  const step = { usage: { model: 'claude-sonnet-5-5', inputTokens: 10000, cacheWriteTokens: 100000, cacheReadTokens: 1000000, outputTokens: 2000 } };
  // 10000*2 + 100000*2.5 + 1000000*0.10 + 2000*10, all /1e6 = 0.02 + 0.25 + 0.10 + 0.02 = 0.39
  assert.equal(costOfStep(step, PRICING).usd, 0.39);
});

test('cost: a cache price that is not in the pricing file is reported missing, never guessed', () => {
  const noCache = { webSearchPer1000: 10, models: { m: { inputPerMTok: 1, outputPerMTok: 2, verified: true } } };
  const c = costOfStep({ usage: { model: 'm', inputTokens: 1000, cacheReadTokens: 5000 } }, noCache);
  assert.equal(c.missing, true);
});

test('cost: Haiku 5.5 prices requests over 100,000 tokens at the higher rates, each bucket on its own', () => {
  const small = { usage: { model: 'claude-haiku-5-5', inputTokens: 80000, outputTokens: 5000 } };
  assert.equal(costOfStep(small, PRICING).usd, 0.0105);            // 80000*0.10 + 5000*0.50 = 8000 + 2500 = 10500 / 1e6
  const both = { usage: { model: 'claude-haiku-5-5', inputTokens: 80000, outputTokens: 5000, longPrompt: { inputTokens: 150000, outputTokens: 4000 } } };
  // normal bucket 0.0105 + long bucket 150000*0.50 + 4000*2.50 = 75000 + 10000 = 85000 / 1e6 = 0.085  -> 0.0955
  assert.equal(costOfStep(both, PRICING).usd, 0.0955);
  assert.equal(costOfStep({ usage: { model: 'claude-sonnet-5-5', inputTokens: 150000, longPrompt: { inputTokens: 150000 } } }, PRICING).usd, 0.6);   // no tier on Sonnet: same price for both buckets
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
  assert.equal(c.assumed, false);
});

test('stepDetail and renderJob: minutes, tokens by model, searches, cost, total', () => {
  const log = { jobs: [] };
  const job = openJob(log, { id: 'j', title: 'St. Augustine', kind: 'rewrite', at: AT });
  addStep(job, { who: 'Jerome', text: 'Got request for rewrite of St. Augustine', at: AT });
  addStep(job, { who: 'Jerome', text: 'Found 18 usable pages on 7 sites, 89,759 words in all', at: AT, seconds: 174, usage: { model: 'claude-sonnet-4-6', inputTokens: 41200, outputTokens: 3100, webSearches: 5 } });
  const lines = renderJob(job, PRICING);
  assert.match(lines[0], /^St\. Augustine \(rewrite\) — 2026-10-08 22:46 UTC$/);
  assert.equal(lines[1], '1. Jerome: Got request for rewrite of St. Augustine');
  assert.match(lines[2], /^2\. Jerome: Found 18 usable pages on 7 sites, 89,759 words in all \(2\.9 min, 41\.2k in \/ 3\.1k out tokens \(claude-sonnet-4-6\), 5 web searches, \$0\.22\)$/);
  assert.match(lines[3], /^Total task 2\.9 min · cost \$0\.22$/);
  assert.equal(lines.length, 4);                                    // verified prices: no asterisk, no "not confirmed" line
});

test('renderJob shows cached tokens, and an asterisk plus a note when a price is unverified', () => {
  const job = openJob({ jobs: [] }, { id: 'j', title: 'T', at: AT });
  addStep(job, { who: 'Augustine', text: 'wrote it', at: AT, seconds: 120, usage: { model: 'claude-sonnet-5-5', inputTokens: 5000, cacheReadTokens: 200000, outputTokens: 3000 } });
  assert.match(renderJob(job, PRICING)[1], /5k in \+ 200k cached \/ 3k out tokens \(claude-sonnet-5-5\), \$0\.06\)$/);   // 5000*2 + 200000*0.10 + 3000*10 = 0.06
  const shaky = { ...PRICING, models: { m: { inputPerMTok: 1, outputPerMTok: 2, verified: false } } };
  const job2 = openJob({ jobs: [] }, { id: 'k', title: 'T', at: AT });
  addStep(job2, { who: 'X', text: 'y', at: AT, usage: { model: 'm', inputTokens: 1e6 } });
  const lines = renderJob(job2, shaky);
  assert.match(lines[1], /\$1\.00\*\)$/);
  assert.match(lines[lines.length - 1], /not confirmed/);
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
  assert.deepEqual(st[1].usage, { model: 'claude-sonnet-4-6', inputTokens: 41200, outputTokens: 3100, webSearches: 5 });   // fields that were not measured are left out
  const withCache = jeromeSteps({ ...RESULT, timing: { ...RESULT.timing, cacheReadTokens: 900, longPrompt: { inputTokens: 120000, outputTokens: 800 } } }, { at: AT });
  assert.equal(withCache[1].usage.cacheReadTokens, 900);
  assert.deepEqual(withCache[1].usage.longPrompt, { inputTokens: 120000, outputTokens: 800 });
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
