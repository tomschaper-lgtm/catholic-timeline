// scripts/tests/article-writer.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/article-writer.mjs v0.1 ("Augustine"). Offline: the model is a script, the pages are served by a fake
// fetch, and every folder is a temporary one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDraft, writeDraftFile, runArticleWrite, buildSystemPrompt, normalizeDraft, __test } from '../services/article-writer.mjs';
import { hashText } from '../services/sources-file.mjs';
import { loadLog, costOfJob } from '../services/article-log.mjs';

const dir = mkdtempSync(join(tmpdir(), 'aw-'));
const D = { sources: join(dir, 'sources'), drafts: join(dir, 'drafts'), log: join(dir, 'article-log.json') };
const REG = { tiers: { approved: { rank: 1, label: 'Reference works & Church documents', canVerify: true }, official: { rank: 5, label: 'Official', canVerify: true }, reported: { rank: 9, label: 'Reported', canVerify: false } }, domains: [] };
const RULES = 'RULES-TEXT-MARKER: write warmly; no sentence over 40 words.';
const LIMITS = [{ id: 'quietly', pattern: '\\bquietly\\b', maxPerArticle: 1, instead: ['softly', 'gently', 'calmly'] }];

// ---- fixtures ----
const QUOTE = 'Late have I loved you, O Beauty so ancient and so new, late have I loved you!';
const filler = n => Array.from({ length: n }, (_v, i) => 'matter' + (i % 11)).join(' ');
const pageText = (n = 2600) => 'Augustine of Hippo wrote: ' + QUOTE + ' ' + filler(n);
const sentence = n => 'The ' + Array.from({ length: n - 1 }, () => 'saint').join(' ') + '.';
const para = (sentences, len = 12) => Array.from({ length: sentences }, () => sentence(len)).join(' ');
const sections = (n = 6, per = 10, extra = '') => Array.from({ length: n }, (_v, i) => ({ h: 'Part ' + (i + 1), b: para(per) + (i === 0 ? extra : '') }));
const article = (over = {}) => ({ d: 'A great bishop and teacher. His writings shaped the Church.', sections: sections(), quotes: [{ text: QUOTE, source: 'Confessions X, 27' }],
  facts: [{ label: 'Feast day', value: 'August 28' }], country: 'Algeria', region: 'africa', alt: ['Augustine of Hippo'], reviewNotes: [], flaggedWords: ['Tagaste', 'Hippo'], ...over });

let seq = 0;
function setup(over = {}) {
  // a new subject's file id is slug(name)-year, the app's own rule; a rewrite uses the entry's id
  const id = (over.mode === 'rewrite' || over.entryId) ? 'st-augustine-r' + (++seq) : 'st-augustine-430';
  const texts = { 'https://www.newadvent.org/cathen/02084a.htm': pageText(), 'https://www.ewtn.com/saints/augustine': pageText(2900), 'https://www.ncregister.com/x': pageText(2100), ...(over.texts || {}) };
  const srcs = over.sources || [
    { n: 1, url: 'https://www.ncregister.com/x', title: 'NCR feature', domain: 'ncregister.com', tier: 'reported', lane: null, canVerify: false },
    { n: 2, url: 'https://www.newadvent.org/cathen/02084a.htm', title: 'St. Augustine of Hippo', domain: 'newadvent.org', tier: 'approved', lane: 'history', canVerify: true },
    { n: 3, url: 'https://www.ewtn.com/saints/augustine', title: 'Augustine', domain: 'ewtn.com', tier: 'approved', lane: 'devotion', canVerify: true }];
  const file = { version: 1, entryId: id, mode: over.mode || 'new', subject: { name: 'St. Augustine', category: over.category || 's', year: 430 }, builtAt: '2026-10-09T18:00:00.000Z', jobId: 'job-j',
    outcome: over.outcome || 'ready', flags: over.flags || [], perspectives: { covered: ['history'], missing: over.missing || [] }, verdict: { action: 'accept', reasons: [] },
    sources: srcs.map(s => ({ ...s, status: 'approved', words: (texts[s.url] || '').split(/\s+/).length, hash: hashText(texts[s.url] || ''), storage: 'excerpts' })), unsure: [], alsoFound: [], ...(over.file || {}) };
  mkdirSync(D.sources, { recursive: true });
  writeFileSync(join(D.sources, id + '.json'), JSON.stringify(file));
  const fetchPage = async url => (texts[url] ? { ok: true, http: 200, text: texts[url] } : { ok: false, http: 404, text: '', note: 'HTTP 404' });
  return { id, file, texts, fetchPage, subject: { name: 'St. Augustine', category: over.category || 's', year: 430, y: 430, n: 'St. Augustine', id: over.entryId ? id : undefined, r: over.r, tier: over.tier } };
}
// A scripted model: replies[i] is the i-th reply (an object, a string, or a function(call)). Records every call.
function model(replies) {
  const calls = [];
  const fn = async c => {
    calls.push({ ...c, userObj: (() => { try { return JSON.parse(c.user); } catch (_e) { return null; } })() });
    let r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (typeof r === 'function') r = r(c);
    if (r && r.__raw) return r.__raw;
    return { text: typeof r === 'string' ? r : JSON.stringify(r), truncated: false, usage: { input: 50000, output: 4000, cacheRead: 0, cacheWrite: 0 } };
  };
  fn.calls = calls;
  return fn;
}
const run = (s, cm, extra = {}, taskOver = {}) => writeDraft(s.subject, { sourcesDir: D.sources, task: { id: 'task-' + seq, payload: {}, ...taskOver }, now: new Date('2026-10-09T19:00:00Z'),
  deps: { registry: REG, fetchPage: s.fetchPage, callModel: cm, rules: RULES, limits: LIMITS, ...extra } });

test('a good first draft: saved as a draft with its checks, links built from the pages in rank order, and nothing from the pages copied into it', async () => {
  const s = setup();
  const m = model([article()]);
  const r = await run(s, m);
  assert.equal(r.outcome, 'written');
  const d = r.draft;
  assert.deepEqual([d.status, d.checks.passed, d.writer.attempts, d.writer.model, d.mode], ['draft', true, 1, 'claude-sonnet-5-5', 'new']);
  assert.deepEqual(d.entry.art.links.map(l => l.url), ['https://www.newadvent.org/cathen/02084a.htm', 'https://www.ewtn.com/saints/augustine', 'https://www.ncregister.com/x']);    // rank 1, 1, then 9
  assert.equal(d.entry.art.links[0].label, 'newadvent.org: St. Augustine of Hippo');
  assert.deepEqual([d.entry.id, d.entry.t, d.entry.r, d.entry.country, d.entry.alt], [s.id, 's', 'africa', 'Algeria', ['Augustine of Hippo']]);
  assert.equal(d.entry.art.quotes[0].text, QUOTE);
  assert.deepEqual(d.flaggedWords, ['Tagaste', 'Hippo']);
  assert.equal(d.checks.stats.words, 720);
  assert.equal(d.length.tier, 'standard');
  assert.deepEqual(d.sourcesFile, { file: 'sources/' + s.id + '.json', jobId: 'job-j', builtAt: '2026-10-09T18:00:00.000Z', outcome: 'ready', pages: 3, words: d.sourcesFile.words, dropped: 0, changed: 0 });
  const json = JSON.stringify(d);
  assert.ok(!json.includes('matter7 matter8'));                                                  // no page text in the draft
});

test('what the model is told: the rules, the rationed words with synonyms, the length tier, the tier legend, and sources numbered in rank order', async () => {
  const s = setup();
  const m = model([article()]);
  await run(s, m);
  const c = m.calls[0];
  assert.match(c.system, /RULES-TEXT-MARKER/);
  assert.match(c.system, /"quietly": at most 1 per article.*softly, gently, calmly/);
  assert.match(c.system, /"standard" tier: 600 to 750 words/);
  assert.match(c.system, /PICK THE WINNER/);
  assert.match(c.system, /REPLY WITH ONLY THIS JSON/);
  assert.equal(c.maxTokens, 9000);
  assert.equal(c.model, 'claude-sonnet-5-5');
  const u = c.userObj;
  assert.deepEqual(u.sources.map(x => [x.n, x.domain, x.rank]), [[1, 'newadvent.org', 1], [2, 'ewtn.com', 1], [3, 'ncregister.com', 9]]);
  assert.ok(u.sources.every(x => typeof x.text === 'string' && x.text.length > 1000));
  assert.deepEqual(Object.keys(u.tierLegend).sort(), ['approved', 'official', 'reported']);
  assert.equal(u.revise, undefined);
  assert.equal(u.entryType, 'Saint');
});

test('a draft that breaks rules is sent back with the reasons, the synonyms and the previous draft; the next attempt passes', async () => {
  const s = setup();
  const bad = article({ sections: sections(6, 10, ' He prayed quietly. She wept quietly. ' + sentence(45)) });
  const m = model([bad, article()]);
  const r = await run(s, m);
  assert.equal(r.draft.writer.attempts, 2);
  assert.equal(r.draft.status, 'draft');
  const u = m.calls[1].userObj;
  assert.match(u.revise.problems.join(' | '), /"quietly" appears 2 times; the limit is 1.*softly/);
  assert.ok(u.revise.problems.some(p => /45 words \(limit 40\)/.test(p)));
  assert.equal(u.revise.previousDraft.sections.length, 6);
  assert.deepEqual(r.draft.attemptLog.map(a => a.violations.length > 0), [true, false]);
  assert.deepEqual([r.draft.usage[0].calls, r.draft.usage[0].inputTokens, r.draft.usage[0].outputTokens], [2, 100000, 8000]);
});

test('still failing after three attempts: the draft is saved anyway, marked needs_work, with the failures shown in a form note', async () => {
  const s = setup();
  const m = model([article({ sections: sections(6, 10, ' She prayed quietly. He wept quietly.') })]);
  const r = await run(s, m);
  assert.equal(m.calls.length, 3);
  assert.deepEqual([r.draft.status, r.draft.checks.passed, r.draft.writer.attempts], ['needs_work', false, 3]);
  assert.ok(r.draft.checks.violations.some(v => v.rule === 'style'));
  assert.ok(r.draft.reviewNotes.some(n => n.kind === 'form' && /Still failing after 3 attempts/.test(n.note)));
});

test('a quotation that is not word for word in a source is sent back; an unusable or cut-off reply is retried, with bigger budgets', async () => {
  const s = setup();
  const m1 = model([article({ quotes: [{ text: 'An invented line that no source contains whatsoever', source: 'Nowhere' }] }), article()]);
  const r1 = await run(s, m1);
  assert.match(m1.calls[1].userObj.revise.problems.join(' '), /not word for word in any source/);
  assert.equal(r1.draft.status, 'draft');
  const s2 = setup();
  const cut = { __raw: { text: '{"d": "cut', truncated: true, usage: { input: 50000, output: 9000 } } };
  const m2 = model([cut, article()]);
  const r2 = await run(s2, m2);
  assert.deepEqual(m2.calls.map(c => c.maxTokens), [9000, 14000]);                                   // same attempt, bigger budget
  assert.equal(r2.draft.writer.attempts, 1);
  assert.equal(r2.draft.usage[0].calls, 2);                                                          // both calls are billed
  const s3 = setup();
  const m3 = model(['I am sorry, I cannot do that.', article()]);
  const r3 = await run(s3, m3);
  assert.match(m3.calls[1].userObj.revise.problems[0], /not valid JSON/);
  assert.equal(r3.draft.status, 'draft');
});

test('blocked, with the reason and no model call: no sources file; Jerome\'s outcome not ready (unless a person overrides); too little text', async () => {
  const none = { name: 'Nobody', category: 's', year: 1, y: 1, n: 'Nobody' };
  const m = model([article()]);
  const r0 = await writeDraft(none, { sourcesDir: D.sources, deps: { registry: REG, callModel: m, rules: RULES, limits: LIMITS } });
  assert.deepEqual([r0.outcome, r0.reason], ['blocked', 'no sources file for nobody-1 (run Jerome first)']);
  const s = setup({ outcome: 'needs_decision', file: { reason: 'approved sources alone are too thin' } });
  const r1 = await run(s, m);
  assert.equal(r1.outcome, 'blocked');
  assert.match(r1.reason, /outcome for this entry is "needs_decision" \(approved sources alone are too thin\); a person must decide/);
  assert.equal(m.calls.length, 0);
  const r2 = await run(s, m, {}, { payload: { override: true } });
  assert.equal(r2.outcome, 'written');
  const tiny = setup({ texts: { 'https://www.newadvent.org/cathen/02084a.htm': 'Augustine ' + filler(300), 'https://www.ewtn.com/saints/augustine': 'x '.repeat(10), 'https://www.ncregister.com/x': 'y '.repeat(10) } });
  const r3 = await run(tiny, model([article()]));
  assert.equal(r3.outcome, 'blocked');
  assert.match(r3.reason, /words of source text could be read now/);
});

test('a page that cannot be fetched again is left out and noted; a page that changed is used and noted; both appear in the draft\'s sources note', async () => {
  const s = setup();
  s.fetchPage = async url => (url.includes('ewtn') ? { ok: false, http: 500, text: '', note: 'HTTP 500' } : url.includes('ncregister') ? { ok: true, http: 200, text: pageText(2100) + ' extra words added later' } : { ok: true, http: 200, text: s.texts[url] });
  const r = await run(s, model([article()]));
  assert.deepEqual([r.draft.sourcesFile.pages, r.draft.sourcesFile.dropped, r.draft.sourcesFile.changed], [2, 1, 1]);
  const note = r.draft.reviewNotes.find(n => n.kind === 'sources').note;
  assert.match(note, /1 source page\(s\) differ in length from what Jerome saw; 1 source page\(s\) could not be fetched again/);
  assert.equal(r.draft.entry.art.links.length, 2);
});

test('Jerome\'s own warnings become a review note; thin sources excuse a short article and add a "thin" note; an apparition always gets an approval note', async () => {
  const s = setup({ flags: ['single_source', 'thin_material'], missing: ['primary_texts'] });
  const r = await run(s, model([article()]));
  assert.equal(r.draft.reviewNotes.find(n => n.kind === 'sources').note, 'Jerome flagged: single_source, thin_material; no source found for: primary_texts');
  const thin = setup({ texts: { 'https://www.newadvent.org/cathen/02084a.htm': pageText(900), 'https://www.ewtn.com/saints/augustine': pageText(500), 'https://www.ncregister.com/x': pageText(300) } });
  const short = article({ sections: sections(5, 4) });
  const rt = await run(thin, model([short]));
  assert.equal(rt.draft.length.tier, 'lesser');
  assert.equal(rt.draft.status, 'draft');                                                           // short is allowed when the sources are thin
  assert.match(rt.draft.reviewNotes.find(n => n.kind === 'thin').note, /under the 400-word target for the lesser tier/);
  const ap = setup({ category: 'm', file: { authority: { found: true, diocese: 'Diocese of Niigata', place: 'Akita', country: 'Japan', candidates: [] } } });
  const ra = await run(ap, model([article({ facts: [{ label: 'Location', value: 'Akita, Japan' }] })]));
  const note = ra.draft.reviewNotes.find(n => n.kind === 'approval').note;
  assert.match(note, /bishop's or the Dicastery's own statement \(Diocese of Niigata\)/);
  assert.equal(ra.draft.entry.t, 'm');
});

test('conflict notes are cleaned and keep both versions with their source numbers and sites; unknown kinds become "other"; bad notes are dropped', async () => {
  const s = setup();
  const conflict = { kind: 'conflict', claim: 'Year of baptism', chosen: { text: 'AD 387', source: 1 }, other: { text: 'AD 388', source: '3' }, why: 'The encyclopedia outranks the news feature.' };
  const r = await run(s, model([article({ reviewNotes: [conflict, { kind: 'wibble', note: 'odd' }, { kind: 'tradition', note: 'The Tagaste story is tradition.' }, 'garbage', { kind: 'other' }] })]));
  const n = r.draft.reviewNotes;
  assert.deepEqual(n[0], { kind: 'conflict', claim: 'Year of baptism', chosen: { text: 'AD 387', source: 1, site: 'newadvent.org' }, other: { text: 'AD 388', source: 3, site: 'ncregister.com' }, why: 'The encyclopedia outranks the news feature.' });
  assert.deepEqual(n.slice(1).map(x => [x.kind, x.note]), [['other', 'odd'], ['tradition', 'The Tagaste story is tradition.']]);
});

test('a miracolieucaristici.org source is used but not linked in the article; a note says where its link belongs', async () => {
  const MC = 'https://www.miracolieucaristici.org/en/Liste/scheda.html?nat=italia&n=1';
  const s = setup({ category: 'u', sources: [
    { n: 1, url: 'https://www.newadvent.org/cathen/02084a.htm', title: 'T', domain: 'newadvent.org', tier: 'approved', canVerify: true },
    { n: 2, url: MC, title: 'Lanciano', domain: 'miracolieucaristici.org', tier: 'reference', canVerify: true }], texts: { [MC]: pageText(2500) } });
  const r = await run(s, model([article({ facts: [{ label: 'Location', value: 'Lanciano, Italy' }] })]));
  assert.deepEqual(r.draft.entry.art.links.map(l => l.url), ['https://www.newadvent.org/cathen/02084a.htm']);
  assert.ok(r.draft.reviewNotes.some(n => /miracolieucaristici\.org was a source but is not linked in the article; that link belongs in the separate carloLinks table/.test(n.note || '')));
});

test('a new subject must name a region from the list (retried if not); a rewrite keeps the entry\'s own id, year, name, type and region', async () => {
  const s = setup();
  const m = model([article({ region: 'narnia' }), article({ region: 'africa' })]);
  const r = await run(s, m);
  assert.match(m.calls[1].userObj.revise.problems.join(' '), /region must be one of: rome, west, brit, east, holy, africa, americas, asia/);
  assert.equal(r.draft.entry.r, 'africa');
  const w = setup({ mode: 'rewrite', entryId: true, r: 'west', tier: 1 });
  w.subject.id = w.id;
  const rw = await run(w, model([article({ region: 'africa' })]));
  assert.deepEqual([rw.draft.entry.id, rw.draft.entry.y, rw.draft.entry.n, rw.draft.entry.t, rw.draft.entry.r, rw.draft.mode], [w.id, 430, 'St. Augustine', 's', 'west', 'rewrite']);
  assert.equal(rw.draft.length.tier, 'major');                                                       // the entry's tier 1, with plenty of source text
});

test('the handler writes drafts/<id>.json and a Thomas-style job in the article log, and the cost comes from the measured tokens', async () => {
  const s = setup({ mode: 'rewrite' });
  const data = { entries: [{ id: s.id, n: 'St. Augustine', y: 430, t: 's', r: 'africa', tier: 2 }] };
  const m = model([article({ sections: sections(6, 10, ' He prayed quietly. She wept quietly.') }), article()]);
  const out = await runArticleWrite({ id: 'task-aw1', entityId: s.id, payload: {} }, data, {}, { sourcesDir: D.sources, draftsDir: D.drafts, logPath: D.log, registry: REG, fetchPage: s.fetchPage, callModel: m, rules: RULES, limits: LIMITS, now: new Date('2026-10-09T19:00:00Z') });
  const path = join(D.drafts, s.id + '.json');
  assert.deepEqual(out.filesToCommit, [path, D.log]);
  assert.equal(out.result.outcome, 'written');
  assert.match(out.summary, /^draft written for St\. Augustine: 720 words, 6 sections, 0 review note\(s\), attempt 2$/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).entry.id, s.id);
  const job = loadLog(D.log).jobs.find(j => j.id === 'task-aw1');
  assert.deepEqual([job.kind, job.title], ['rewrite', 'St. Augustine']);
  assert.deepEqual(job.steps.map(x => x.who), ['Augustine', 'Augustine', 'Augustine', 'Augustine']);
  assert.match(job.steps[0].text, /^Read Jerome's file: 3 source page\(s\), \d+ words$/);
  assert.match(job.steps[1].text, /^Attempt 1 of 3: sent back for 1 rule\(s\): "quietly" appears 2 times; the limit is 1/);
  assert.equal(job.steps[2].text, 'Attempt 2 of 3: passed the form checks');
  assert.match(job.steps[3].text, /^Draft ready: 720 words in 6 sections, 1 quotation\(s\), longest sentence 12 words \(standard tier\)$/);
  assert.deepEqual(job.steps.map(x => x.usage && x.usage.model), [undefined, 'claude-sonnet-5-5', 'claude-sonnet-5-5', undefined]);
  const pricing = { models: { 'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, verified: true } } };
  assert.ok(Math.abs(costOfJob(job, pricing).usd - 2 * (50000 * 2 + 4000 * 10) / 1e6) < 1e-9);       // two attempts, each 50,000 in and 4,000 out
});

test('the handler: an unknown entry, a new subject with no name, and a blocked run are reported, not thrown; a quota error is passed up to be retried later', async () => {
  const deps = { sourcesDir: D.sources, draftsDir: D.drafts, logPath: D.log, registry: REG, rules: RULES, limits: LIMITS };
  assert.match((await runArticleWrite({ id: 't', entityId: 'nope', payload: {} }, { entries: [] }, {}, deps)).summary, /no entry with id nope/);
  assert.match((await runArticleWrite({ id: 't', payload: {} }, { entries: [] }, {}, deps)).summary, /needs payload\.name/);
  const blocked = await runArticleWrite({ id: 't', payload: { name: 'Nobody', category: 's', year: 2 } }, { entries: [] }, {}, deps);
  assert.match(blocked.summary, /^blocked: no sources file for nobody-2/);
  assert.equal(blocked.filesToCommit, undefined);
  const s = setup();
  const quota = Object.assign(new Error('rate limited'), { deferred: true });
  await assert.rejects(runArticleWrite({ id: 't', payload: { name: 'St. Augustine', category: 's', year: 430 } }, { entries: [] }, {}, { ...deps, fetchPage: s.fetchPage, callModel: async () => { throw quota; } }), /rate limited/);
  const bad = await runArticleWrite({ id: 't', payload: { name: 'St. Augustine', category: 's', year: 430 } }, { entries: [] }, {}, { ...deps, fetchPage: s.fetchPage, callModel: async () => { throw new Error('boom'); } });
  assert.match(bad.summary, /^error: boom/);
});

test('normalizeDraft and the prompt builder: cleaned fields, bounded lists, and a prompt with no rationed-words block when there are none', () => {
  const n = normalizeDraft({ d: '  Hi  ', sections: [{ h: ' H ', b: 'a\r\n\r\n\r\n\r\nb' }, null], quotes: [{ text: 'q', source: 's' }, null], facts: [{ label: 'L', value: 'V' }], alt: ['a', '', 'a'], flaggedWords: ['x', 'x', 'y'], region: 'west' }, { type: 's' });
  assert.deepEqual([n.d, n.sections[0], n.region, n.alt, n.flaggedWords], ['Hi', { h: 'H', b: 'a\n\nb' }, 'west', ['a', 'a'], ['x', 'y']]);
  assert.equal(n.sections.length, 2);
  assert.equal(normalizeDraft(null, { type: 's' }).sections.length, 0);
  assert.equal(normalizeDraft({ region: 'moon' }, { type: 's', existing: { r: 'rome' } }).region, 'rome');
  const p = buildSystemPrompt({ rules: 'R', limits: [], band: { tier: 'lesser', min: 400, max: 600 }, type: 'p' });
  assert.ok(!p.includes('WORDS TO RATION'));
  assert.match(p, /THE ENTRY TYPE is Persecution/);
  assert.match(p, /"lesser" tier: 400 to 600 words/);
});

test('the real rules and style files ship with the repo and the prompt carries them', () => {
  const rules = readFileSync(new URL('../writer-rules.md', import.meta.url), 'utf8');
  assert.match(rules, /Hard limit: 40 words per sentence/);
  assert.match(rules, /Date formatting/);
  const style = JSON.parse(readFileSync(new URL('../writer-style.json', import.meta.url), 'utf8'));
  const p = buildSystemPrompt({ rules, limits: style.limits, band: { tier: 'standard', min: 600, max: 750 }, type: 's' });
  assert.match(p, /"quietly": at most 1 per article/);
  assert.match(p, /Hard limit: 40 words per sentence/);
});

test('writeDraftFile: creates the folder, names the file by the entry id, ends with a newline', () => {
  const p = writeDraftFile({ entryId: 'x-1', a: 1 }, join(dir, 'newfolder', 'drafts'));
  assert.equal(p, join(dir, 'newfolder', 'drafts', 'x-1.json'));
  assert.ok(readFileSync(p, 'utf8').endsWith('\n'));
  assert.ok(existsSync(p));
});

// ---------------------------------------------------------------------------------------------
// v0.2: age at death (code computes it, the model only places a marker) and the model's view of the sources
// ---------------------------------------------------------------------------------------------
const { fillAgeMarkers, agePhrase, normalizeFeedback } = __test;
const withMarker = (text, per = 10) => sections(6, per, ' ' + text);
const lived = (born, died) => [{ label: 'Feast day', value: 'August 28' }, { label: 'Born', value: born }, { label: 'Died', value: died }];

test('exact age: both dates in full. The code puts "(at age 75)" on the Died fact, replaces the marker with words, and records the calculation', async () => {
  const s = setup();
  const r = await run(s, model([article({ sections: withMarker('He died on August 28, 430, [[AGE]], while the city was besieged.'), facts: lived('November 13, 354, Thagaste', 'August 28, 430, Hippo Regius') })]));
  const d = r.draft;
  assert.equal(d.status, 'draft');
  assert.equal(d.entry.facts.find(f => f.label === 'Died').value, 'August 28, 430, Hippo Regius (at age 75)');
  assert.match(d.entry.art.sections[0].b, /He died on August 28, 430, at the age of seventy-five, while the city was besieged\./);
  assert.ok(!JSON.stringify(d.entry).includes('[[AGE]]'));
  assert.deepEqual(d.lifespan, { age: 75, kind: 'exact', min: 75, max: 75, reason: null, born: 'November 13, 354, Thagaste', died: 'August 28, 430, Hippo Regius' });
});

test('estimated age: a range in the birth year gives "(estimated age 62)" and "at about sixty-two"; any age the model put on the Died fact is replaced', async () => {
  const s = setup();
  const r = await run(s, model([article({ sections: withMarker('He died in Salerno, [[AGE]].'), facts: lived('c. 1020/1025, Tuscany, Italy', 'May 25, 1085, Salerno (at age 99)') })]));
  assert.equal(r.draft.entry.facts.find(f => f.label === 'Died').value, 'May 25, 1085, Salerno (estimated age 62)');
  assert.match(r.draft.entry.art.sections[0].b, /He died in Salerno, at about sixty-two\./);
  assert.deepEqual([r.draft.lifespan.age, r.draft.lifespan.kind, r.draft.lifespan.min, r.draft.lifespan.max], [62, 'estimated', 60, 65]);
});

test('an age of a hundred or more is written in digits', () => {
  assert.equal(agePhrase({ age: 105, kind: 'estimated' }), 'at about 105');
  assert.equal(agePhrase({ age: 44, kind: 'exact' }), 'at the age of forty-four');
  assert.equal(agePhrase({ age: null }), '');
});

test('the marker missing when an age can be worked out: the draft is sent back, told what code will fill in, and shown its own text with the marker place, not the filled phrase', async () => {
  const s = setup();
  const facts = lived('November 13, 354, Thagaste', 'August 28, 430, Hippo');
  const m = model([article({ facts }), article({ sections: withMarker('He died in 430, [[AGE]].'), facts })]);
  const r = await run(s, m);
  assert.equal(r.draft.writer.attempts, 2);
  assert.match(m.calls[1].userObj.revise.problems.join(' | '), /write the marker \[\[AGE\]\] once in the narrative of his death \(code fills it in as "at the age of seventy-five"\)/);
  assert.equal(r.draft.status, 'draft');
  const bad = model([article({ sections: withMarker('Died in 430, [[AGE]]. Buried later, [[AGE]].'), facts }), article({ sections: withMarker('He died in 430, [[AGE]].'), facts })]);
  await run(setup(), bad);
  assert.match(bad.calls[1].userObj.revise.problems.join(' | '), /only once; you wrote it 2 times/);
  assert.ok(bad.calls[1].userObj.revise.previousDraft.sections[0].b.includes('[[AGE]]'));      // the model sees its own marker, not the filled-in phrase
  assert.ok(!JSON.stringify(bad.calls[1].userObj.revise.previousDraft.facts).includes('(at age'));
});

test('no age can be worked out (no birth year, or dates too far apart): the marker is dropped cleanly, an age the model wrote is removed, no review note is made, and nothing is sent back for it', async () => {
  const s = setup();
  const m = model([article({ sections: withMarker('He died in Rome, [[AGE]], under Nero.'), facts: lived('Bethsaida, Galilee', 'c. 64\u201367, Rome (estimated age 80)') })]);
  const r = await run(s, m);
  assert.equal(m.calls.length, 1);
  assert.equal(r.draft.entry.facts.find(f => f.label === 'Died').value, 'c. 64\u201367, Rome');
  assert.match(r.draft.entry.art.sections[0].b, /He died in Rome, under Nero\./);
  assert.ok(!r.draft.reviewNotes.some(n => /age at death/i.test(n.note || '')));                           // no note: leaving the age out needs no explanation
  assert.deepEqual([r.draft.lifespan.age, r.draft.lifespan.reason, r.draft.lifespan.born, r.draft.lifespan.died], [null, 'no birth year', 'Bethsaida, Galilee', 'c. 64\u201367, Rome']);     // but the reason is kept for the log
  const wide = await run(setup(), model([article({ sections: withMarker('He died, [[AGE]].'), facts: lived('c. 35\u201350, Syria', 'c. 107 (between 98 and 117), Rome') })]));
  assert.ok(!wide.draft.reviewNotes.some(n => /age at death/i.test(n.note || '')));
  assert.match(wide.draft.lifespan.reason, /dates too uncertain \(the age could be anywhere from 48 to 82\)/);
  assert.equal(wide.draft.lifespan.age, null);
});

test('not a person (a council), or a saint with no Died fact: the marker is dropped, no age work is done and no age note is made', async () => {
  const c = setup({ category: 'c' });
  const rc = await run(c, model([article({ sections: withMarker('It ended in 325, [[AGE]].'), facts: [{ label: 'Location', value: 'Nicaea' }] })]));
  assert.equal(rc.draft.lifespan, null);
  assert.ok(!JSON.stringify(rc.draft.entry).includes('[[AGE]]'));
  assert.ok(!rc.draft.reviewNotes.some(n => /age at death/i.test(n.note || '')));
  const m = setup();
  const rm = await run(m, model([article({ sections: withMarker('She was assumed, [[AGE]].'), facts: [{ label: 'Feast day', value: 'August 15' }] })]));
  assert.equal(rm.draft.status, 'draft');                                                  // no Died fact: nothing to work out, nothing demanded
  assert.ok(!rm.draft.reviewNotes.some(n => /age at death/i.test(n.note || '')));
});

test('fillAgeMarkers: the comma and space around the marker are handled both when it is filled and when it is dropped', () => {
  const run1 = (text, ls) => { const sec = [{ b: text }]; const n = fillAgeMarkers(sec, ls); return [n, sec[0].b]; };
  const est = { age: 62, kind: 'estimated' }, none = { age: null };
  assert.deepEqual(run1('He died in 430, [[AGE]], in Hippo.', est), [1, 'He died in 430, at about sixty-two, in Hippo.']);
  assert.deepEqual(run1('He died in 430, [[AGE]], in Hippo.', none), [1, 'He died in 430, in Hippo.']);
  assert.deepEqual(run1('He died in 430, [[AGE]].', none), [1, 'He died in 430.']);
  assert.deepEqual(run1('He died in 430 [[AGE]].', none), [1, 'He died in 430.']);
  assert.deepEqual(run1('One. [[AGE]] Two.', est), [1, 'One.at about sixty-two Two.'].map((x, i) => (i ? 'One. at about sixty-two Two.' : x)));
  assert.deepEqual(run1('No marker here.', est), [0, 'No marker here.']);
});

test('the model\'s view of the sources is stored cleaned, with per-source statistics (words, tier, used or not); it never reaches the article', async () => {
  const s = setup();
  const fb = { amount: 'too_much', used: ['2', 1, 1, 'x', 0], unused: [3], gaps: ['No source gives the date of his baptism', ''], wouldHelp: ['A primary-text edition of the Confessions'] };
  const r = await run(s, model([article({ sourceFeedback: fb })]));
  const d = r.draft;
  assert.deepEqual(d.sourceFeedback, { amount: 'too_much', used: [1, 2], unused: [3], gaps: ['No source gives the date of his baptism'], wouldHelp: ['A primary-text edition of the Confessions'] });
  assert.deepEqual(d.sourceStats.map(x => [x.n, x.domain, x.tier, x.used]), [[1, 'newadvent.org', 'approved', true], [2, 'ewtn.com', 'approved', true], [3, 'ncregister.com', 'reported', false]]);
  assert.ok(d.sourceStats.every(x => x.words > 2000));
  assert.ok(!JSON.stringify(d.entry).includes('too_much'));
  const none = await run(setup(), model([article()]));
  assert.equal(none.draft.sourceFeedback, null);
  assert.ok(none.draft.sourceStats.every(x => x.used === null));                           // no opinion given: unknown, not "unused"
  assert.equal(normalizeFeedback('nonsense'), null);
  assert.equal(normalizeFeedback({ amount: 'huge' }).amount, null);
});

test('the prompt asks for the marker and the source opinion, and says the model must not work out the age', async () => {
  const s = setup();
  const m = model([article()]);
  await run(s, m);
  assert.match(m.calls[0].system, /Do NOT work out the age yourself/);
  assert.match(m.calls[0].system, /write the marker \[\[AGE\]\] exactly once/);
  assert.match(m.calls[0].system, /"sourceFeedback": \{ "amount": "too_little \| about_right \| too_much"/);
  assert.match(m.calls[0].system, /sourceFeedback is for the people who run this process, never for the reader/);
});

test('the default writer model is Claude Sonnet 5.5, and payload.model can still choose another (for a one-off comparison)', async () => {
  const s = setup();
  const m = model([article()]);
  await run(s, m, {}, { payload: { model: 'claude-opus-5-5' } });
  assert.equal(m.calls[0].model, 'claude-opus-5-5');
  const m2 = model([article()]);
  const r = await run(setup(), m2);
  assert.equal(m2.calls[0].model, 'claude-sonnet-5-5');
  assert.equal(r.draft.writer.model, 'claude-sonnet-5-5');
});
