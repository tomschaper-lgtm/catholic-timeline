// scripts/tests/ledger-build.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for the v1.4 changes to scripts/services/ledger-build.mjs: the registry decides, "reported" status, Jerome's
// handoff file, per-role usage and the Thomas job in article-log.json. Offline: global fetch is replaced by fake websites and fake Anthropic / Google /
// OpenAI endpoints. The settings that ledger-build reads when it is loaded (folders) are set before it is imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'lb-'));
const P = { ledger: join(dir, 'ledger'), cache: join(dir, 'cache'), sources: join(dir, 'sources'), log: join(dir, 'article-log.json'), reg: join(dir, 'registry.json') };
Object.assign(process.env, { LEDGER_DIR: P.ledger, LEDGER_CACHE_DIR: P.cache, SOURCES_DIR: P.sources, ARTICLE_LOG_PATH: P.log, LEDGER_ALLOWLIST_PATH: P.reg,
  ANTHROPIC_API_KEY: 'k1', OPENAI_API_KEY: 'k2', GEMINI_API_KEY: 'k3' });

const { runLedgerBuild, __test } = await import('../services/ledger-build.mjs');
const { loadLog, costOfJob } = await import('../services/article-log.mjs');
const { hashText } = await import('../services/sources-file.mjs');

const REGISTRY = {
  tiers: { approved: { canVerify: true }, reported: { canVerify: false }, primary: { canVerify: true }, scripture: { canVerify: true } },
  domains: [{ domain: 'newadvent.org', tier: 'approved', enabled: true }, { domain: 'ncregister.com', tier: 'reported', enabled: true },
    { domain: 'ccel.org', tier: 'primary', enabled: true }, { domain: 'listed-only.example', tier: 'approved', enabled: false }]
};
const writeRegistry = r => writeFileSync(P.reg, JSON.stringify(r));
writeRegistry(REGISTRY);

// ---- the fake world ----
const BODY = 'Augustine of Hippo was born in Tagaste in 354. He died in Hippo in 430 during the siege by the Vandals. ' + 'This page is part of a long reference article about the saint and his writings. '.repeat(5);
const world = { pages: {}, calls: null, proverSeen: [], excerpts: { '430': 'He died in Hippo in 430 during the siege by the Vandals', '354': 'Augustine of Hippo was born in Tagaste in 354' }, judge: 'supports' };
function reset() { world.calls = { pages: [], anthropic: 0, google: 0, openai: 0 }; world.proverSeen = []; world.judge = 'supports'; world.pages = {}; }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = t => new Response('<html><body><p>' + t + '</p></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.anthropic.com')) {
    world.calls.anthropic++;
    return json({ content: [{ type: 'text', text: JSON.stringify({ claims: [
      { section: 1, sentence: 'Augustine died in Hippo in 430.', text: 'Augustine died in Hippo in 430.', kind: 'date', keys: ['Augustine', 'Hippo', '430'] },
      { section: 1, sentence: 'He was born in Tagaste in 354.', text: 'Augustine was born in Tagaste in 354.', kind: 'date', keys: ['Tagaste', '354'] }] }) }],
      stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 300 } });
  }
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    world.calls.google++;
    const req = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    world.proverSeen.push(req);
    const results = req.claims.map(c => {
      const key = Object.keys(world.excerpts).find(k => c.claim.includes(k));
      const src = req.sources.find(s => s.text.includes(world.excerpts[key] || '\u0000'));
      return key && src ? { cid: c.cid, found: true, url: src.url, excerpts: [world.excerpts[key]] } : { cid: c.cid, found: false, reason: 'not in the sources' };
    });
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ results }) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 300, thoughtsTokenCount: 100, totalTokenCount: 5400 } });
  }
  if (url.startsWith('https://api.openai.com')) {
    world.calls.openai++;
    const items = JSON.parse(JSON.parse(init.body).input).items;
    return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ verdicts: items.map(i => ({ cid: i.cid, verdict: world.judge, reason: 'ok' })) }) }] }],
      usage: { input_tokens: 400, output_tokens: 150, total_tokens: 550, input_tokens_details: { cached_tokens: 0 } } });
  }
  if (world.pages[url] != null) { world.calls.pages.push(url); return html(world.pages[url]); }
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
};

let seq = 0;
const entry = (links, over = {}) => ({ id: 'st-augustine-' + (++seq), n: 'St. Augustine', y: 430, t: 's',
  art: { sections: [{ h: 'Life', b: 'Augustine died in Hippo in 430. He was born in Tagaste in 354.' }], quotes: [], links: links.map(u => ({ label: 'src', url: u })) }, facts: [], ...over });
const run = (entries, payload = {}, taskId) => runLedgerBuild({ id: taskId || 'task-' + (++seq), entityId: entries[0].id, payload: { entityIds: entries.map(e => e.id), force: true, ...payload } }, { entries });
const ledgerOf = e => JSON.parse(readFileSync(join(P.ledger, e.id + '.json'), 'utf8'));
const PRICING = { version: 2, webSearchPer1000: 10, models: {
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, verified: true },
  'gemini-3.5-flash-lite': { inputPerMTok: 0.3, outputPerMTok: 2.5, verified: true },
  'gpt-5.6-luna': { inputPerMTok: 0.2, outputPerMTok: 1.2, cacheReadPerMTok: 0.02, cacheWritePerMTok: 0.25, verified: true } } };
const NA = 'https://www.newadvent.org/cathen/02084a.htm';

test('registry mode: an approved-tier page proves both claims "verified", and the ledger says the registry was used', async () => {
  reset(); world.pages[NA] = BODY;
  const e = entry([NA]);
  const out = await run([e]);
  const l = ledgerOf(e);
  assert.equal(l.allowlist.from, 'registry');
  assert.equal(l.generator, 'ledger-build v1.4 (2026-10-09)');
  assert.deepEqual([l.summary.total, l.summary.verified, l.summary.reported], [2, 2, 0]);
  assert.deepEqual(l.claims.map(c => [c.status, c.sources[0].tier]), [['verified', 'approved'], ['verified', 'approved']]);
  assert.match(out.summary, /2 claims — 2 verified, 0 reported, 0 traditional/);
  assert.equal(out.result.allowlist, 'registry');
});

test('usage is measured per role, for this article only: Claude in/out, Gemini input and (output + thinking), OpenAI in/out', async () => {
  reset(); world.pages[NA] = BODY;
  const e = entry([NA]);
  const out = await run([e]);
  const u = Object.fromEntries(ledgerOf(e).usage.map(x => [x.role, x]));
  assert.deepEqual([u.extractor.model, u.extractor.calls, u.extractor.inputTokens, u.extractor.outputTokens], ['claude-sonnet-4-6', 1, 1200, 300]);
  assert.deepEqual([u.prover.model, u.prover.calls, u.prover.inputTokens, u.prover.outputTokens], ['gemini-3.5-flash-lite', 1, 5000, 400]);
  assert.deepEqual([u.judge.model, u.judge.calls, u.judge.inputTokens, u.judge.outputTokens], ['gpt-5.6-luna', 1, 400, 150]);
  assert.equal(out.result.usage.length, 3);
  assert.ok(ledgerOf(e).seconds >= 0);
  const e2 = entry([NA]);                                              // the next article does not inherit the first one's tally
  await run([e2]);
  assert.equal(ledgerOf(e2).usage.find(x => x.role === 'extractor').inputTokens, 1200);
});

test('a Thomas job is written to the article log with a step per role, and its dollars come from the measured tokens', async () => {
  reset(); world.pages[NA] = BODY;
  const e = entry([NA]);
  const out = await run([e], {}, 'task-log-1');
  assert.ok(out.filesToCommit.includes(join(P.ledger, e.id + '.json')));
  assert.ok(out.filesToCommit.includes(P.log));
  const job = loadLog(P.log).jobs.find(j => j.id === 'task-log-1');
  assert.deepEqual([job.title, job.kind], ['St. Augustine', 'check']);
  assert.deepEqual(job.steps.map(s => s.who), ['Thomas', 'Thomas', 'Thomas', 'Thomas', 'Thomas']);
  assert.match(job.steps[0].text, /^Read 1 of 1 source page\(s\)$/);
  assert.equal(job.steps[1].text, 'Listed 2 claims to check');
  assert.equal(job.steps[2].text, 'Found a word-for-word excerpt for 2 of 2 claims');
  assert.equal(job.steps[3].text, 'Judged 2 excerpt(s) blind: 2 supported');
  assert.match(job.steps[4].text, /^Result: 2 verified, 0 traditional, 0 disputed, 0 unsourced$/);
  assert.deepEqual(job.steps.map(s => s.usage && s.usage.model), [undefined, 'claude-sonnet-4-6', 'gemini-3.5-flash-lite', 'gpt-5.6-luna', undefined]);
  // 1200*3/1e6 + 300*15/1e6 + 5000*0.3/1e6 + 400*2.5/1e6 + 400*0.2/1e6 + 150*1.2/1e6
  assert.ok(Math.abs(costOfJob(job, PRICING).usd - 0.01086) < 1e-9);
});

test('several entries in one task each get their own job; one entry uses the task id', async () => {
  reset(); world.pages[NA] = BODY;
  const a = entry([NA]), b = entry([NA]);
  await run([a, b], {}, 'task-multi');
  const ids = loadLog(P.log).jobs.map(j => j.id);
  assert.ok(ids.includes('task-multi:' + a.id) && ids.includes('task-multi:' + b.id));
  assert.equal(ids.includes('task-multi'), false);
});

test('a page of a tier that cannot verify (the "reported" tier) can only give status "reported", never "verified"', async () => {
  reset(); const NCR = 'https://www.ncregister.com/features/saint-augustine'; world.pages[NCR] = BODY;
  const e = entry([NCR]);
  const out = await run([e]);
  const l = ledgerOf(e);
  assert.deepEqual([l.summary.verified, l.summary.reported], [0, 2]);
  assert.deepEqual(l.claims.map(c => [c.status, c.sources[0].tier, c.judge]), [['reported', 'reported', 'supports'], ['reported', 'reported', 'supports']]);
  assert.match(out.summary, /0 verified, 2 reported/);
  assert.match(loadLog(P.log).jobs.slice(-1)[0].steps.slice(-1)[0].text, /^Result: 0 verified, 2 reported, 0 traditional/);
});

test('a reported-tier page whose excerpt the judge rejects is still "disputed", not "reported"', async () => {
  reset(); const NCR = 'https://www.ncregister.com/features/x'; world.pages[NCR] = BODY; world.judge = 'not';
  const e = entry([NCR]);
  await run([e]);
  assert.deepEqual(ledgerOf(e).claims.map(c => c.status), ['disputed', 'disputed']);
});

test('a site that only the registry knows (ccel.org, primary tier) is accepted; a listed-but-switched-off site and an unknown site are refused with the right reason', async () => {
  reset(); const CC = 'https://ccel.org/ccel/schaff/npnf101'; world.pages[CC] = BODY;
  const e = entry([CC, 'https://listed-only.example/p', 'https://unknown.example/p']);
  await run([e]);
  const l = ledgerOf(e);
  const by = Object.fromEntries(l.sourceHealth.map(h => [new URL(h.url).hostname, h]));
  assert.equal(by['ccel.org'].ok, true);
  assert.equal(by['ccel.org'].tier, 'primary');
  assert.equal(by['listed-only.example'].note, 'listed in the allowlist but not enabled');
  assert.equal(by['unknown.example'].note, 'not an approved source (outside the allowed domains)');
  assert.equal(l.summary.verified, 2);
});

test('with no usable link at all, no prover or judge is called and every claim stays unsourced', async () => {
  reset();
  const e = entry(['https://unknown.example/p']);
  await run([e]);
  assert.deepEqual([world.calls.google, world.calls.openai], [0, 0]);
  const l = ledgerOf(e);
  assert.deepEqual([l.summary.unsourced, l.summary.verified], [2, 0]);
  assert.deepEqual(l.usage.map(x => x.role), ['extractor']);
});

test('no registry file: the built-in lists are used as before, and the ledger says so (ccel.org is not on them)', async () => {
  reset(); world.pages[NA] = BODY; world.pages['https://ccel.org/x'] = BODY;
  const old = process.env.LEDGER_ALLOWLIST_PATH;
  process.env.LEDGER_ALLOWLIST_PATH = join(dir, 'missing-registry.json');
  try {
    const e = entry([NA, 'https://ccel.org/x']);
    const out = await run([e]);
    const l = ledgerOf(e);
    assert.equal(l.allowlist.from, 'built-in');
    assert.equal(out.result.allowlist, 'built-in');
    assert.deepEqual(l.sourceHealth.map(h => [new URL(h.url).hostname, h.ok]), [['www.newadvent.org', true], ['ccel.org', false]]);
    assert.equal(l.sourceHealth[0].tier, 'approved');
    assert.equal(l.summary.verified, 2);
  } finally { process.env.LEDGER_ALLOWLIST_PATH = old; }
});

test('a damaged registry falls back to the built-in lists too', async () => {
  reset(); world.pages[NA] = BODY;
  writeFileSync(P.reg, '{ not json');
  try { const e = entry([NA]); await run([e]); assert.equal(ledgerOf(e).allowlist.from, 'built-in'); }
  finally { writeRegistry(REGISTRY); }
});

// ---- Jerome's handoff file ----
function writeSources(id, sources, extra = {}) {
  mkdirSync(P.sources, { recursive: true });
  writeFileSync(join(P.sources, id + '.json'), JSON.stringify({ version: 1, entryId: id, mode: 'new', jobId: 'job-jerome-1', builtAt: '2026-10-09T18:00:00.000Z', outcome: 'ready', totalWords: 0, sources, unsure: [], alsoFound: [], ...extra }));
}
const jsrc = (n, url, o = {}) => ({ n, url, title: 't', domain: new URL(url).hostname.replace(/^www\./, ''), tier: 'approved', status: 'approved', words: 1000, hash: 'x', storage: 'excerpts', ...o });
const NCR2 = 'https://www.ncregister.com/features/b';

test('Jerome\'s page that the article links and that was stored in full is used as stored (no download); his unlinked page is only a suggestion and never reaches the prover', async () => {
  reset(); world.pages[NCR2] = BODY;                                  // NA is NOT served: a download would fail
  const e = entry([NA]);
  writeSources(e.id, [jsrc(1, NA, { storage: 'full', text: BODY, words: 80, hash: hashText(BODY) }), jsrc(2, NCR2, { tier: 'reported' })]);
  await run([e]);
  const l = ledgerOf(e);
  assert.equal(world.calls.pages.includes(NA), false);                  // read from the file
  assert.equal(l.summary.verified, 2);                                  // proved from the stored text
  assert.deepEqual(l.pipeline, { file: 'sources/' + e.id + '.json', jobId: 'job-jerome-1', builtAt: '2026-10-09T18:00:00.000Z', outcome: 'ready', jeromePages: 2, linked: 1, notLinked: 1 });
  assert.equal(l.suggestedSources.length, 1);
  assert.deepEqual([l.suggestedSources[0].url, l.suggestedSources[0].from, l.suggestedSources[0].ok], [NCR2, 'Jerome', true]);
  assert.match(l.suggestedSources[0].note, /add it to the article's links to use it/);
  assert.equal(l.summary.suggestedSources, 1);
  assert.equal(world.proverSeen.every(r => r.sources.every(s => s.url === NA)), true);     // proof only from the article's own link
  assert.deepEqual(l.sourceHealth.map(h => h.url), [NA]);
});

test('with the article linking nothing Jerome found, his pages are suggestions and the claims name the first one', async () => {
  reset(); world.pages[NCR2] = BODY;
  const e = entry([]);
  writeSources(e.id, [jsrc(1, NCR2, { tier: 'reported' })]);
  await run([e]);
  const l = ledgerOf(e);
  assert.equal(l.summary.unsourced, 2);
  assert.match(l.claims[0].note, /the article has no source links; possible source: https:\/\/www\.ncregister\.com\/features\/b \(add it to the article's links for it to count\)/);
  assert.equal(l.pipeline.linked, 0);
  assert.deepEqual([world.calls.google, world.calls.openai], [0, 0]);
});

test('the same page counts as linked whatever its www., trailing slash or fragment', async () => {
  reset(); world.pages[NA] = BODY;
  const e = entry([NA]);
  writeSources(e.id, [jsrc(1, 'https://newadvent.org/cathen/02084a.htm/#top')]);
  await run([e]);
  assert.deepEqual([ledgerOf(e).pipeline.linked, ledgerOf(e).pipeline.notLinked], [1, 0]);
  assert.equal(__test.urlKey('https://www.A.org/x/?q=1#f'), __test.urlKey('https://a.org/x?q=1'));
});

test('a linked page whose length is far from what Jerome saw is flagged as changed; a similar length is not; the log says so', async () => {
  reset(); world.pages[NA] = BODY;
  const words = BODY.split(/\s+/).length;
  const e = entry([NA]);
  writeSources(e.id, [jsrc(1, NA, { words: words * 5 })]);
  await run([e], {}, 'task-drift');
  const h = ledgerOf(e).sourceHealth[0];
  assert.deepEqual([h.jerome.drift, h.jerome.wordsThen, h.jerome.n], ['changed', words * 5, 1]);
  assert.match(loadLog(P.log).jobs.find(j => j.id === 'task-drift').steps[0].text, /1 page\(s\) differ in length from what Jerome saw/);
  const e2 = entry([NA]);
  writeSources(e2.id, [jsrc(1, NA, { words: words + 5 })]);
  await run([e2]);
  assert.equal(ledgerOf(e2).sourceHealth[0].jerome.drift, 'similar');
});

test('the Thomas step says how many of Jerome\'s pages the article links', async () => {
  reset(); world.pages[NA] = BODY; world.pages[NCR2] = BODY;
  const e = entry([NA]);
  writeSources(e.id, [jsrc(1, NA), jsrc(2, NCR2, { tier: 'reported' })]);
  await run([e], {}, 'task-pl');
  assert.match(loadLog(P.log).jobs.find(j => j.id === 'task-pl').steps[0].text, /\(Jerome's file: 1 linked in the article, 1 not linked, so only suggestions\)/);
});

test('payload.useSources:false ignores the file; a missing, unreadable or wrong-version file changes nothing', async () => {
  reset(); world.pages[NA] = BODY; world.pages[NCR2] = BODY;
  const a = entry([NA]); writeSources(a.id, [jsrc(1, NA), jsrc(2, NCR2)]);
  await run([a], { useSources: false });
  assert.equal(ledgerOf(a).pipeline, undefined);
  assert.equal(ledgerOf(a).suggestedSources, undefined);
  const b = entry([NA]);
  await run([b]);
  assert.equal(ledgerOf(b).pipeline, undefined);
  const c = entry([NA]); mkdirSync(P.sources, { recursive: true }); writeFileSync(join(P.sources, c.id + '.json'), '{ broken');
  await run([c]);
  assert.equal(ledgerOf(c).pipeline, undefined);
  assert.equal(ledgerOf(c).summary.verified, 2);
  const d = entry([NA]); writeFileSync(join(P.sources, d.id + '.json'), JSON.stringify({ version: 9, sources: [] }));
  await run([d]);
  assert.equal(ledgerOf(d).pipeline, undefined);
});

test('stored text is used only for a page the article links, and only when the site is allowed', async () => {
  reset(); world.pages[NA] = BODY;
  const e = entry([NA]);
  writeSources(e.id, [jsrc(1, NA, { storage: 'full', text: 'STORED TEXT. ' + BODY, words: 90 })]);
  await run([e]);
  assert.deepEqual(world.proverSeen[0].sources.map(s => s.text.slice(0, 12)), ['STORED TEXT.']);   // the stored text was what the prover read
  assert.equal(world.calls.pages.includes(NA), false);
  const stranger = entry(['https://unknown.example/p']);
  writeSources(stranger.id, [jsrc(1, 'https://unknown.example/p', { storage: 'full', text: BODY })]);
  await run([stranger]);
  assert.equal(ledgerOf(stranger).sourceHealth[0].ok, false);                                       // a stored page of a site that is not allowed is still refused
});

test('helpers: a tier with canVerify:false cannot verify; any other tier, and an unknown one, can', async () => {
  __test.initAllowlist();
  assert.equal(__test.tierCanVerify('reported'), false);
  assert.equal(__test.tierCanVerify('approved'), true);
  assert.equal(__test.tierCanVerify('never-heard-of-it'), true);
  assert.equal(__test.tierOf('https://www.ncregister.com/a'), 'reported');
  assert.equal(__test.onAllowlist('https://listed-only.example/a'), false);
  assert.equal(__test.onAllowlist('https://www.newadvent.org/a'), true);
});

test('the built-in tiers still work when there is no registry: Scripture pages and institutional sites keep their tiers', () => {
  const old = process.env.LEDGER_ALLOWLIST_PATH;
  process.env.LEDGER_ALLOWLIST_PATH = join(dir, 'nope.json');
  try {
    assert.equal(__test.initAllowlist(), 'built-in');
    assert.equal(__test.tierOf('https://bible.usccb.org/bible/lk/1'), 'scripture');
    assert.equal(__test.tierOf('https://www.vatican.va/x'), 'approved');
    assert.equal(__test.tierOf('https://www.fatima.pt/x'), 'official');
    assert.equal(__test.tierCanVerify('official'), true);
  } finally { process.env.LEDGER_ALLOWLIST_PATH = old; __test.initAllowlist(); }
});

test('an article with no sections is still skipped, and nothing is logged for it', async () => {
  reset();
  const e = { id: 'empty-1', n: 'Nobody', y: 1, art: { sections: [] } };
  const before = loadLog(P.log).jobs.length;
  const out = await run([e]);
  assert.match(out.summary, /outcome|skipped|no article sections/);
  assert.equal(loadLog(P.log).jobs.length, before);
  assert.equal(existsSync(join(P.ledger, 'empty-1.json')), false);
});
