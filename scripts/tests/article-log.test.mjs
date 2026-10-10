// scripts/tests/article-log.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/article-log.mjs v0.3 (temp files only).
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
  assert.match(lines[3], /^Total working time 2\.9 min · cost \$0\.22$/);
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

test('jeromeSteps: a rewrite whose saint check only advised says why, in plain words', () => {
  const r = JSON.parse(JSON.stringify(RESULT));
  r.layer3.verdict = { action: 'accept', basis: null, reasons: [], advisory: [{ kind: 'basis', text: 'no basis for sainthood found near the name' }] };
  r.layer3.flags = ['category_advisory'];
  const st = jeromeSteps(r, { at: AT });
  assert.match(st[3].text, /advice only \(rewrite\): no basis for sainthood found near the name/);
});

test('jeromeSteps: when two bases qualify, the first leads and the other is shown', () => {
  const r = JSON.parse(JSON.stringify(RESULT));
  r.layer3.verdict = { basis: 'ancient_veneration', evidence: { also_qualified: ['formal_canonization'] } };
  assert.match(jeromeSteps(r, { at: AT })[3].text, /basis: ancient veneration \(also formal canonization\)/);
});

test('jeromeSteps: a thin result lists the unjudged sites that could help, so a person knows what to approve', () => {
  const r = JSON.parse(JSON.stringify(RESULT));
  r.layer3.status = 'needs_decision';
  r.layer3.reason = 'approved sources alone are too thin (656 of 1000 words)';
  r.layer3.decisions = [{ kind: 'unjudged_sources', urls: ['https://www.kofc.org/a', 'https://www.kofc.org/b', 'https://www.example-order.org/c', 'not a url'] }];
  const st = jeromeSteps(r, { at: AT });
  assert.equal(st[st.length - 1].text, 'Unjudged sites waiting for approval: kofc.org (2 pages), example-order.org');
});

const AUTH = (c, extra = {}) => ({ ...RESULT, authority: { found: true, diocese: 'Diocese of Niigata', place: 'Akita', country: 'Japan', confidence: 'high', candidates: [c], ...extra } });
const lastText = r => { const st = jeromeSteps(r, { at: AT }); return st[st.length - 1].text; };

test('jeromeSteps: a new, verified diocese site is "handed to Ignatius" with what the code checked', () => {
  assert.equal(lastText(AUTH({ url: 'https://n.example/', domain: 'n.example', role: 'diocese', registry: 'new', verified: true, checks: { dioceseMentions: 9, churchWords: 30 } })),
    'Handed to Ignatius: Diocese website n.example (Diocese of Niigata — Akita, Japan); the page loads, names the diocese 9 time(s) and reads like a church site; waiting for his decision');
});

test('jeromeSteps: a site the code could not confirm is still handed over, but says so plainly', () => {
  assert.match(lastText(AUTH({ domain: 'n.example', role: 'diocese', registry: 'new', verified: false, note: 'the page never names the diocese (niigata)' })),
    /Handed to Ignatius: .*NOT confirmed as a church site \(the page never names the diocese \(niigata\)\); waiting for his decision/);
});

test('jeromeSteps: approved, switched-off and skipped sites, other official sites, nothing found, and a failed lookup', () => {
  assert.equal(lastText(AUTH({ domain: 'vatican.va', role: 'alternate', registry: 'approved' })), 'Other official website vatican.va is already an approved source');
  assert.match(lastText(AUTH({ domain: 'x.org', role: 'diocese', registry: 'disabled' })), /is on the registry but switched off$/);
  assert.match(lastText(AUTH({ url: 'http://x', domain: '', role: 'diocese', registry: 'blocked', note: 'not a plain https address on a real host' })), /was skipped: not a plain https address/);
  assert.equal(lastText({ ...RESULT, authority: { found: false, note: 'no diocese site located' } }), 'Could not find the diocese\'s own website (no diocese site located)');
  assert.equal(lastText({ ...RESULT, authority: { found: false, error: 'model unavailable' } }), 'Diocese lookup failed: model unavailable');
  assert.equal(jeromeSteps(RESULT, { at: AT }).some(s => /diocese/i.test(s.text)), false);       // no lookup, no lines
});

// ---- Thomas's steps (v0.6) ----
import { ledgerSteps as _ledgerSteps, recordLedger as _recordLedger, loadLog as _loadLogT } from '../services/article-log.mjs';
import { mkdtempSync as _mkT } from 'node:fs';
import { tmpdir as _tmpT } from 'node:os';
import { join as _joinT } from 'node:path';

const LEDGER = {
  summary: { total: 30, verified: 20, reported: 3, traditional: 2, disputed: 1, unsourced: 4, missingNumbers: 2, extractorRejected: 1 },
  sourceHealth: [{ url: 'https://a', ok: true, jerome: { drift: 'changed' } }, { url: 'https://b', ok: true, jerome: { drift: 'similar' } }, { url: 'https://c', ok: false }],
  claims: [{ status: 'verified', sources: [{}], judge: 'supports' }, { status: 'reported', sources: [{}], judge: 'supports' }, { status: 'disputed', sources: [{}], judge: 'not' },
    { status: 'traditional', sources: [{}], judge: 'partial' }, { status: 'unsourced', sources: [] }],
  pipeline: { linked: 2, notLinked: 3 },
  usage: [{ role: 'extractor', model: 'claude-sonnet-4-6', inputTokens: 3000, outputTokens: 2000 }, { role: 'prover', model: 'gemini-3.5-flash-lite', inputTokens: 90000, outputTokens: 4000 },
    { role: 'judge', model: 'gpt-5.6-luna', inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 100 }],
  seconds: 83.4
};

test('ledgerSteps: what was read, what was listed, found and judged, and the result, with tokens per role on the right steps', () => {
  const st = _ledgerSteps(LEDGER, { at: AT });
  assert.deepEqual(st.map(s => s.who), ['Thomas', 'Thomas', 'Thomas', 'Thomas', 'Thomas']);
  assert.equal(st[0].text, 'Read 2 of 3 source page(s) (Jerome\'s file: 2 linked in the article, 3 not linked, so only suggestions); 1 page(s) differ in length from what Jerome saw');
  assert.equal(st[1].text, 'Listed 30 claims to check (1 dropped: not copied word for word)');
  assert.equal(st[2].text, 'Found a word-for-word excerpt for 4 of 30 claims');
  assert.equal(st[3].text, 'Judged 4 excerpt(s) blind: 2 supported');
  assert.equal(st[4].text, 'Result: 20 verified, 3 reported, 2 traditional, 1 disputed, 4 unsourced; 2 with numbers absent from the sources');
  assert.deepEqual(st.map(s => s.usage), [undefined, { model: 'claude-sonnet-4-6', inputTokens: 3000, outputTokens: 2000 }, { model: 'gemini-3.5-flash-lite', inputTokens: 90000, outputTokens: 4000 },
    { model: 'gpt-5.6-luna', inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 100 }, undefined]);
  assert.equal(st[4].seconds, 83.4);
});

test('ledgerSteps: with no Jerome file, no drift, no reported claims and no usage the lines are plain', () => {
  const st = _ledgerSteps({ summary: { total: 2, verified: 2, traditional: 0, disputed: 0, unsourced: 0 }, sourceHealth: [{ ok: true }], claims: [] }, { at: AT });
  assert.equal(st[0].text, 'Read 1 of 1 source page(s)');
  assert.equal(st[1].text, 'Listed 2 claims to check');
  assert.equal(st[4].text, 'Result: 2 verified, 0 traditional, 0 disputed, 0 unsourced');
  assert.deepEqual(st.map(s => s.usage), [undefined, undefined, undefined, undefined, undefined]);
});

test('recordLedger: a check is its own job (kind check); a shared job id from the pipeline joins Jerome\'s steps; several entries in one task get separate jobs', () => {
  const path = _joinT(_mkT(_joinT(_tmpT(), 'rl-')), 'article-log.json');
  const entry = { id: 'st-x-1', n: 'St. X' };
  const j1 = _recordLedger({ entry, ledger: LEDGER, task: { id: 't-1', payload: {} }, logPath: path, now: new Date('2026-10-09T18:00:00Z') });
  assert.deepEqual([j1.id, j1.title, j1.kind, j1.steps.length], ['t-1', 'St. X', 'check', 5]);
  const j2 = _recordLedger({ entry, ledger: LEDGER, task: { id: 't-2', payload: { jobId: 'pipeline-9' } }, logPath: path });
  const j3 = _recordLedger({ entry, ledger: LEDGER, task: { id: 't-3', payload: { jobId: 'pipeline-9' } }, logPath: path });
  assert.equal(j2.id, 'pipeline-9');
  assert.equal(j3.steps.length, 10);                                   // the same job, two checks
  const m = _recordLedger({ entry, ledger: LEDGER, task: { id: 't-4', payload: {} }, multi: true, logPath: path });
  assert.equal(m.id, 't-4:st-x-1');
  assert.equal(_loadLogT(path).jobs.length, 3);
});
