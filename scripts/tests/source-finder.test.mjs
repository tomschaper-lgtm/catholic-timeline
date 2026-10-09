// scripts/tests/source-finder.test.mjs
// MODULE DATE: 2026-10-08 (Thursday) · tests for source-finder.mjs v0.3 (v0.9.7: layers 1, 2 and 3, with perspective lanes, best-few selection, signal types for ancient saints and the first live-pilot fixes; layer 2 with MOCKED search/fetch; layer 3 uses the real scripts/category-rules.json).
// Run: node --test scripts/tests/source-finder.test.mjs
// Synthetic tests always run. Real-data tests run only if DATA_PATH (or ./data.json) exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fold, scoreMatch, checkExistence, findSubject, runSourceFinder, findSources, safeUrl, allowedDomains, examine, assess, loadRules, evidence, laneOf, laneCoverage, perspectivePlan, selectSources, runJerome, compactResult, newTally, addUsage, recordHandoff, recordSources } from '../services/source-finder.mjs';
import { fileURLToPath } from 'node:url';

const RULES = loadRules(fileURLToPath(new URL('../category-rules.json', import.meta.url)));
const E = (id, n, t, y, alt) => ({ id, n, t, y, r: 'rome', ...(alt ? { alt } : {}) });
const data = { entries: [
  E('st-augustine-430', 'St. Augustine', 's', 430, ['Augustine of Hippo']),
  E('st-augustine-of-canterbury-604', 'St. Augustine of Canterbury', 's', 604),
  E('st-john-paul-ii-2005', 'St. John Paul II', 's', 2005, ['Karol Wojtyła']),
  E('st-john-paul-i-1978', 'Pope John Paul I', 's', 1978),
  E('pius-x-1914', 'St. Pius X', 's', 1914),
  E('pius-v-1572', 'St. Pius V', 's', 1572),
  E('guadalupe-1531', 'Our Lady of Guadalupe', 'm', 1531, ['Virgen de Guadalupe']),
  E('dup-a-100', 'St. Twin', 's', 100),
  E('dup-b-200', 'St. Twin', 's', 200)
] };

test('fold ignores honorifics, case, accents, punctuation', () => {
  assert.equal(fold('St. Augustine').key, 'augustine');
  assert.equal(fold('SAINT  augustine!').key, 'augustine');
  assert.equal(fold('Wojtyła').key, 'wojtyla');
  assert.equal(fold("St. Peter's Basilica").key, 'peter basilica');
});

test('fold reads roman numerals as digits, but only safe ones', () => {
  assert.deepEqual(fold('John Paul II').nums, ['2']);
  assert.deepEqual(fold('celestine i').nums, ['1']);
  assert.deepEqual(fold('Pius X').nums, ['10']);
  assert.deepEqual(fold('Paul Li').nums, []);       // "li" is a surname, not 51
  // Known limit: a final word "Xi" in a 2+ word name reads as 11 (Pius XI); rare for a saint's name.
});

test('exact, alt, id', () => {
  assert.equal(checkExistence('st augustine', data.entries).level, 'exact');
  assert.equal(checkExistence('Augustine of Hippo', data.entries).level, 'alt');
  assert.equal(checkExistence('Karol Wojtyla', data.entries).level, 'alt'); // ł folding
  assert.equal(checkExistence('st-augustine-430', data.entries).level, 'id');
});

test('numerals are identity', () => {
  assert.equal(checkExistence('Pius X', data.entries).matches[0].id, 'pius-x-1914');
  assert.equal(checkExistence('Pius V', data.entries).matches[0].id, 'pius-v-1572');
  const s = scoreMatch(fold('Pius X'), fold('St. Pius V'));
  assert.ok(s <= 0.5, 'X vs V must score low, got ' + s);
});

test('typo -> possible_match, not exists', () => {
  const r = findSubject({ mode: 'new', name: 'Agustine' }, data);
  assert.equal(r.outcome, 'possible_match');
  assert.equal(r.matches[0].id, 'st-augustine-430');
});

test('numeral on one side only is never "exists"', () => {
  const r = findSubject({ mode: 'new', name: 'John Paul' }, data);
  assert.equal(r.outcome, 'possible_match');
});

test('duplicate exact names -> possible_match, a human picks', () => {
  const r = findSubject({ mode: 'new', name: 'St. Twin' }, data);
  assert.equal(r.outcome, 'possible_match');
  assert.equal(r.matches.length >= 2, true);
});

test('category breaks a tie between exact matches', () => {
  const d2 = { entries: [E('a-1', 'Twin', 'e', 1), E('b-2', 'Twin', 's', 2)] };
  assert.equal(findSubject({ mode: 'new', name: 'Twin' }, d2).outcome, 'possible_match');
  const r = findSubject({ mode: 'new', name: 'Twin', category: 's' }, d2);
  assert.equal(r.outcome, 'exists');
  assert.equal(r.match.id, 'b-2');
  // same category on both: still a human decision
  assert.equal(findSubject({ mode: 'new', name: 'St. Twin', category: 's' }, data).outcome, 'possible_match');
});

test('unrelated name -> new_subject', () => {
  const r = findSubject({ mode: 'new', name: 'St. Bertha of Blangy' }, data);
  assert.equal(r.outcome, 'new_subject');
});

test('category is reported, never a filter', () => {
  const r = findSubject({ mode: 'new', name: 'Our Lady of Guadalupe', category: 'e' }, data);
  assert.equal(r.outcome, 'exists');
  assert.equal(r.match.categoryMatch, false);
});

test('rewrite mode skips the existence check and reads the entry as given', () => {
  const r = findSubject({ mode: 'rewrite', entityId: 'st-augustine-430' }, data);
  assert.equal(r.outcome, 'rewrite_ready');
  assert.equal(r.subject.year, 430);
  assert.equal(findSubject({ mode: 'rewrite', entityId: 'nope' }, data).outcome, 'error');
  assert.equal(findSubject({ mode: 'rewrite' }, data).outcome, 'error');
});

test('bad input is an error, not a crash', () => {
  assert.equal(findSubject({ mode: 'new', name: '   ' }, data).outcome, 'error');
  assert.equal(findSubject({ mode: 'new', name: '!!!' }, data).outcome, 'new_subject');
});

test('handler returns { result, summary } and no files', async () => {
  const out = await runSourceFinder({ payload: { mode: 'new', name: 'St. Augustine' } }, data);
  assert.equal(out.result.outcome, 'exists');
  assert.ok(typeof out.summary === 'string' && out.summary.length > 0);
  assert.equal(out.filesToCommit, undefined);
});

const real = process.env.DATA_PATH || 'data.json';
test('real data.json: known entries are found, a made-up saint is new', { skip: !existsSync(real) }, () => {
  const d = JSON.parse(readFileSync(real, 'utf8'));
  assert.equal(findSubject({ mode: 'new', name: 'St. Augustine' }, d).outcome, 'exists');
  assert.equal(findSubject({ mode: 'new', name: 'Virgen de Guadalupe' }, d).outcome, 'exists');
  // Two entries carry this alt name (the saint and the election): ambiguous until a category picks one.
  assert.equal(findSubject({ mode: 'new', name: 'Karol Wojtyla' }, d).outcome, 'possible_match');
  const picked = findSubject({ mode: 'new', name: 'Karol Wojtyla', category: 's' }, d);
  assert.equal(picked.outcome, 'exists');
  assert.equal(picked.match.id, 'st-john-paul-ii-2005');
  assert.equal(findSubject({ mode: 'new', name: 'St. Zzyzx of Nowhere' }, d).outcome, 'new_subject');
});


// ------------------------------------------------------------------------------------------------
// Layer 2 (mocked search and fetch; nothing here touches the network)
// ------------------------------------------------------------------------------------------------

const reg = {
  tiers: { approved: { canVerify: true }, primary: { canVerify: true }, scripture: { canVerify: true }, reported: { canVerify: false } },
  domains: [
    { domain: 'newadvent.org', tier: 'approved', enabled: true },
    { domain: 'vatican.va', tier: 'approved', enabled: true },
    { domain: 'ncregister.com', tier: 'reported', enabled: true },
    { domain: 'ccel.org', tier: 'primary', enabled: false },
    { domain: 'bible.usccb.org', tier: 'scripture', enabled: true }
  ]
};
const BERTHA = { name: 'St. Bertha', category: 's', year: 723 };
const longText = (who, n = 60) => ('Bertha was a widow who founded an abbey. '.repeat(n)).replace(/Bertha/g, who);
// pages: url -> text | null (null = 404)
function mocks(pages, searchResults) {
  const calls = { search: [], fetch: [] };
  return {
    calls,
    deps: {
      registry: reg,
      search: async q => { calls.search.push(q); const r = searchResults[Math.min(calls.search.length - 1, searchResults.length - 1)]; return { results: r, searches: 1 }; },
      fetchPage: async url => {
        calls.fetch.push(url);
        const body = pages[url];
        if (body === undefined || body === null) return { url, ok: false, http: 404, text: '', note: 'HTTP 404' };
        return { url, ok: true, http: 200, text: body, note: '' };
      }
    }
  };
}

test('safeUrl: https only, real host, no ip/localhost/credentials, fragment stripped', () => {
  assert.equal(safeUrl('https://www.newadvent.org/cathen/02524a.htm#x'), 'https://www.newadvent.org/cathen/02524a.htm');
  for (const bad of ['http://newadvent.org/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://user:pw@newadvent.org/a',
    'https://intranet/a', 'ftp://newadvent.org/a', 'not a url', '']) assert.equal(safeUrl(bad), null, bad);
});

test('allowedDomains: enabled only, Scripture excluded', () => {
  assert.deepEqual(allowedDomains(reg).sort(), ['ncregister.com', 'newadvent.org', 'vatican.va']);
});

test('pass A finds 2 usable allowlisted pages -> no widening, one search', async () => {
  const m = mocks({ 'https://www.newadvent.org/b': longText('Bertha'), 'https://www.vatican.va/b': longText('Bertha') },
    [[{ url: 'https://www.newadvent.org/b', title: 'St. Bertha' }, { url: 'https://www.vatican.va/b', title: 'Bertha' }]]);
  const r = await findSources(BERTHA, {}, m.deps);
  assert.equal(r.widened, false);
  assert.equal(m.calls.search.length, 1);
  assert.deepEqual(m.calls.search[0].allowedDomains.sort(), ['ncregister.com', 'newadvent.org', 'vatican.va']);
  assert.equal(r.counts.usableApproved, 2);
  assert.ok(r.counts.totalWordsUsable > 0);
  assert.equal(r.sources[0].status, 'approved');
  assert.equal(r.sources[0].tier, 'approved');
  assert.equal(r.sources[0].canVerify, true);
  assert.equal(r.sources[0].titleHasName, true);
});

test('only 1 usable allowlisted page -> widens to open web; new domains are "unjudged", never "approved"', async () => {
  const m = mocks({
    'https://www.newadvent.org/b': longText('Bertha'),
    'https://abbaye-x.fr/bertha': longText('Bertha')
  }, [
    [{ url: 'https://www.newadvent.org/b', title: 'Bertha' }],
    [{ url: 'https://abbaye-x.fr/bertha', title: 'Sainte Bertha' },
     { url: 'https://en.wikipedia.org/wiki/Bertha', title: 'Bertha' },
     { url: 'https://www.ccel.org/b', title: 'Bertha' }]
  ]);
  const r = await findSources(BERTHA, {}, m.deps);
  assert.equal(r.widened, true);
  assert.equal(m.calls.search.length, 2);
  assert.equal(m.calls.search[1].allowedDomains, null);
  const by = u => r.sources.find(s => s.url === u);
  assert.equal(by('https://abbaye-x.fr/bertha').status, 'unjudged');
  assert.equal(by('https://abbaye-x.fr/bertha').usable, true);
  assert.equal(by('https://en.wikipedia.org/wiki/Bertha').status, 'blocked');
  assert.equal(by('https://www.ccel.org/b').status, 'disabled');
  // blocked and disabled pages are never downloaded
  assert.deepEqual(m.calls.fetch.sort(), ['https://abbaye-x.fr/bertha', 'https://www.newadvent.org/b']);
  assert.equal(r.counts.usableApproved, 1);
  assert.equal(r.counts.usableUnjudged, 1);
});

test('allowlistOnly never widens', async () => {
  const m = mocks({}, [[]]);
  const r = await findSources(BERTHA, { allowlistOnly: true }, m.deps);
  assert.equal(r.widened, false);
  assert.equal(m.calls.search.length, 1);
  assert.equal(r.counts.usableApproved, 0);
});

test('a 404 and a page that never names the subject are both unusable, with a reason', async () => {
  const m = mocks({ 'https://www.newadvent.org/dead': null, 'https://www.vatican.va/other': longText('Francis') },
    [[{ url: 'https://www.newadvent.org/dead', title: 'x' }, { url: 'https://www.vatican.va/other', title: 'y' }]]);
  const r = await findSources(BERTHA, { allowlistOnly: true }, m.deps);
  const dead = r.sources.find(s => s.url.endsWith('/dead'));
  const wrong = r.sources.find(s => s.url.endsWith('/other'));
  assert.equal(dead.usable, false);
  assert.match(dead.note, /404/);
  assert.equal(wrong.usable, false);
  assert.equal(wrong.namePresent, false);
  assert.match(wrong.note, /name does not appear/);
});

test('a duplicate URL (even with a #fragment) is only examined once', async () => {
  const m = mocks({ 'https://www.newadvent.org/b': longText('Bertha') },
    [[{ url: 'https://www.newadvent.org/b', title: 'a' }, { url: 'https://www.newadvent.org/b#top', title: 'a' }]]);
  await findSources(BERTHA, { allowlistOnly: true }, m.deps);
  assert.equal(m.calls.fetch.length, 1);
});

test('rewrite: the article\'s own links are tried first, and can satisfy the search on their own', async () => {
  const m = mocks({ 'https://www.newadvent.org/a': longText('Augustine'), 'https://www.vatican.va/a': longText('Augustine') }, [[]]);
  const subject = { name: 'St. Augustine', category: 's', year: 430,
    links: [{ label: 'New Advent', url: 'https://www.newadvent.org/a' }, { label: 'Vatican', url: 'https://www.vatican.va/a' }] };
  const r = await findSources(subject, {}, m.deps);
  assert.equal(r.passes[0].kind, 'existing-links');
  assert.equal(m.calls.search.length, 0);
  assert.equal(r.counts.usableApproved, 2);
});

test('a reported-tier page is approved but flagged as unable to verify', async () => {
  const m = mocks({ 'https://www.ncregister.com/b': longText('Bertha') }, [[{ url: 'https://www.ncregister.com/b', title: 'Bertha' }]]);
  const r = await findSources(BERTHA, { allowlistOnly: true }, m.deps);
  assert.equal(r.sources[0].status, 'approved');
  assert.equal(r.sources[0].tier, 'reported');
  assert.equal(r.sources[0].canVerify, false);
});

test('examine: a multi-word name needs every word (3 or fewer)', async () => {
  const ex = await examine({ url: 'https://www.newadvent.org/z', title: '' }, { name: 'St. Francis Xavier' }, reg,
    { fetchPage: async url => ({ url, ok: true, http: 200, text: 'Francis of Assisi founded an order. '.repeat(20), note: '' }) });
  assert.equal(ex.namePresent, false);
});

test('handler: exists -> no search; possible_match needs confirmNew; new_subject searches', async () => {
  const m1 = mocks({}, [[]]);
  const a = await runSourceFinder({ payload: { mode: 'new', name: 'St. Augustine' } }, data, m1.deps);
  assert.equal(a.result.outcome, 'exists');
  assert.equal(m1.calls.search.length, 0);

  const m2 = mocks({}, [[]]);
  const b = await runSourceFinder({ payload: { mode: 'new', name: 'Agustine' } }, data, m2.deps);
  assert.equal(b.result.outcome, 'possible_match');
  assert.equal(m2.calls.search.length, 0);
  assert.match(b.summary, /confirmNew/);

  const m3 = mocks({}, [[]]);
  const c = await runSourceFinder({ payload: { mode: 'new', name: 'Agustine', confirmNew: true } }, data, m3.deps);
  assert.ok(m3.calls.search.length >= 1);
  assert.equal(c.result.layer2, 'no_candidates');

  const m4 = mocks({ 'https://www.newadvent.org/b': longText('Bertha of Blangy'), 'https://www.vatican.va/b': longText('Bertha of Blangy') },
    [[{ url: 'https://www.newadvent.org/b', title: 'Bertha' }, { url: 'https://www.vatican.va/b', title: 'Bertha' }]]);
  m4.deps.rules = RULES;
  const d = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's' } }, data, m4.deps);
  assert.equal(d.result.outcome, 'new_subject');
  assert.equal(d.result.layer2, 'candidates_found');
  assert.match(d.summary, /layer 3: needs_decision/);
  assert.equal(d.result.layer3.status, 'needs_decision');
  assert.equal(d.filesToCommit, undefined);

  const m5 = mocks({}, [[]]);
  await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', search: false } }, data, m5.deps);
  assert.equal(m5.calls.search.length, 0);
});

test('handler: a search that fails (not rate limit) is reported in the result, not thrown', async () => {
  const deps = { registry: reg, fetchPage: async () => ({ ok: false, http: 0, text: '', note: 'x' }),
    search: async () => { throw new Error('boom'); } };
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy' } }, data, deps);
  assert.match(r.result.search.error, /boom/);
  assert.match(r.summary, /source search failed/);
});

test('handler: a rate-limit/credit failure is rethrown as deferred so the orchestrator retries later', async () => {
  const deps = { registry: reg, fetchPage: async () => ({ ok: false }),
    search: async () => { const e = new Error('429'); e.deferred = true; throw e; } };
  await assert.rejects(() => runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy' } }, data, deps), e => e.deferred === true);
});

// ---------------------------------------------------------------------------------------------
// Layer 3: assess()
// ---------------------------------------------------------------------------------------------

// A fetched-source stand-in. `text` is non-enumerable, as examine() makes it.
function src({ domain = 'newadvent.org', path = '/x', words = 1200, text = '', status = 'approved', canVerify = true, usable = true, mentions = 10 } = {}) {
  const o = { url: 'https://www.' + domain + path, domain: 'www.' + domain, status, canVerify, usable, words, mentions };
  Object.defineProperty(o, 'text', { value: text, enumerable: false });
  return o;
}
const found = (...sources) => ({ sources });
const bertha = (extra = {}) => ({ name: 'St. Bertha of Blangy', category: 's', year: 723, ...extra });

test('rules file loads and has every category the timeline uses', () => {
  for (const k of ['s', 'c', 'p', 'm', 'u', 'e', 'i']) assert.ok(RULES.categories[k], k);
  assert.ok(RULES.sufficiency.minWordsVerifyCapable > 0);
});

test('evidence: a pattern counts only near the subject\'s name', () => {
  const near = 'bertha was canonized in the church. ' + 'x '.repeat(10);
  const far = 'someone else was canonized. ' + 'filler word '.repeat(200) + ' bertha lived quietly.';
  assert.equal(evidence(near, ['\\bwas canoni[sz]ed\\b'], 'bertha', 300).length, 1);
  assert.equal(evidence(far, ['\\bwas canoni[sz]ed\\b'], 'bertha', 300).length, 0);
  assert.deepEqual(evidence(near, ['(unclosed'], 'bertha'), []);   // a bad pattern is skipped, not fatal
});

test('no usable page -> not_found', () => {
  assert.equal(assess(bertha(), found(src({ usable: false })), RULES).status, 'not_found');
  assert.equal(assess(bertha(), found(), RULES).status, 'not_found');
});

test('one verify-capable source with enough words and a canonization -> ready, flagged single_source', () => {
  const r = assess(bertha(), found(src({ text: 'bertha of blangy was canonized by the church in the ninth century.' })), RULES);
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.action, 'accept');
  assert.equal(r.verdict.basis, 'formal_canonization');
  assert.ok(r.flags.includes('single_source') && r.flags.includes('thin_material'));   // 1,200 words is ready, but under the 4,000-word target
  assert.ok(r.verdict.evidence.formal_canonization[0].includes('canonized'));
});

test('two independent verify-capable sites -> ready without the single_source flag; same site twice is one', () => {
  const t = 'bertha was canonized.';
  const two = assess(bertha(), found(src({ text: t }), src({ domain: 'vatican.va', words: 300, text: t })), RULES);
  assert.equal(two.status, 'ready');
  assert.ok(!two.flags.includes('single_source'));
  const same = assess(bertha(), found(src({ text: t, words: 600 }), src({ text: t, words: 600 })), RULES);
  assert.equal(same.sufficiency.independentVerifyDomains, 1);
  assert.ok(same.flags.includes('single_source'));
});

test('too few words -> too_thin; unjudged pages that could make it enough -> needs_decision', () => {
  const thin = assess(bertha(), found(src({ words: 600, text: 'bertha was canonized.' })), RULES);
  assert.equal(thin.status, 'too_thin');
  const rescue = assess(bertha(), found(src({ words: 600, text: 'bertha was canonized.' }), src({ domain: 'example-order.org', status: 'unjudged', canVerify: undefined, words: 700 })), RULES);
  assert.equal(rescue.status, 'needs_decision');
  assert.equal(rescue.decisions[0].kind, 'unjudged_sources');
  const tooSmall = assess(bertha(), found(src({ words: 600 }), src({ domain: 'example-order.org', status: 'unjudged', words: 100 })), RULES);
  assert.equal(tooSmall.status, 'too_thin');
});

test('reported-tier and unjudged pages never count as verification', () => {
  const r = assess(bertha(), found(src({ domain: 'ncregister.com', status: 'approved', canVerify: false, words: 5000, text: 'bertha was canonized.' })), RULES);
  assert.equal(r.status, 'too_thin');
  assert.match(r.reason, /cannot carry verification/);
});

test('newSubjectMinDomains can demand two sites for a new subject but not for a rewrite', () => {
  const rules2 = { ...RULES, sufficiency: { ...RULES.sufficiency, newSubjectMinDomains: 2 } };
  const one = found(src({ text: 'bertha was canonized.' }));
  assert.equal(assess(bertha(), one, rules2, { mode: 'new' }).status, 'too_thin');
  assert.equal(assess(bertha(), one, rules2, { mode: 'rewrite' }).status, 'ready');
});

test('saint: only Blessed/Venerable signals -> needs_decision, reason "not canonized"', () => {
  const r = assess(bertha({ year: 1990 }), found(src({ text: 'bertha was beatified in 2001 and her cause continues.' })), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.match(r.verdict.reasons[0].text, /not canonized/);
  assert.ok(r.verdict.evidence.not_canonized.blessed);
});

test('saint: nothing at all near the name -> needs_decision, no basis found', () => {
  const r = assess(bertha(), found(src({ text: 'bertha lived in a village and kept sheep.' })), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.match(r.verdict.reasons[0].text, /no basis for sainthood/);
});

test('saint: ancient veneration needs two different kinds of signal, and only for a subject within the year limit', () => {
  const t = 'bertha is named in the roman martyrology, and a church was dedicated to st. bertha in the fifth century.';
  const old = assess(bertha({ year: 304 }), found(src({ text: t })), RULES);
  assert.equal(old.status, 'ready');
  assert.equal(old.verdict.basis, 'ancient_veneration');
  assert.deepEqual(Object.keys(old.verdict.evidence.ancient_veneration.signals).sort(), ['early_dedication', 'liturgical']);
  const late = assess(bertha({ year: 1500 }), found(src({ text: t })), RULES);
  assert.equal(late.status, 'needs_decision');
});

test('saint: New Testament figure basis, year limit 100', () => {
  const r = assess({ name: 'St. Bertha', category: 's', year: 60 }, found(src({ text: 'bertha, an apostle named in the new testament.' })), RULES);
  assert.equal(r.verdict.basis, 'new_testament');
});

test('someone else\'s canonization far from the name is not evidence', () => {
  const text = 'bertha lived quietly. ' + 'filler words go here. '.repeat(120) + ' her son was canonized.';
  assert.equal(assess(bertha(), found(src({ text })), RULES).status, 'needs_decision');
});

test('a scandal name goes to review, even with strong sources, and even in rewrite mode', () => {
  const sub = { name: 'The Clergy Abuse Scandal', category: 'e', year: 2002 };
  const f = found(src({ text: 'the scandal was widely reported.' }));
  const a = assess(sub, f, RULES, { mode: 'new' });
  assert.equal(a.status, 'needs_decision');
  assert.equal(a.verdict.reasons[0].kind, 'scandal');
  assert.equal(assess(sub, f, RULES, { mode: 'rewrite' }).status, 'needs_decision');
});

test('rewrite: failed saint-basis check is advisory, the article can still proceed', () => {
  const r = assess(bertha(), found(src({ text: 'bertha lived in a village.' })), RULES, { mode: 'rewrite' });
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.action, 'accept');
  assert.ok(r.flags.includes('category_advisory'));
  assert.equal(r.verdict.advisory.length, 1);
  const strict = assess(bertha(), found(src({ text: 'bertha lived in a village.' })), { ...RULES, enforceBasisChecksInRewrite: true }, { mode: 'rewrite' });
  assert.equal(strict.status, 'needs_decision');
});

test('apparition and miracle -> always review, with approval signals as evidence', () => {
  const sub = { name: 'Our Lady of Bertha', category: 'm', year: 1858 };
  const r = assess(sub, found(src({ text: 'the bishop approved the devotion; bertha is a local tradition.' })), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.ok(r.verdict.evidence.approval_signals.bishop_approved);
  assert.ok(r.verdict.evidence.approval_signals.tradition_only);
  const u = assess({ name: 'Miracle of Bertha', category: 'u', year: 800 }, found(src({ text: 'a nihil obstat was granted in the bertha case.' })), RULES);
  assert.equal(u.status, 'needs_decision');                      // "same as m" rule resolved
  assert.ok(u.verdict.evidence.approval_signals.dicastery_or_holy_see);
});

test('council, persecution, event, topic -> ready when there is enough material', () => {
  for (const c of ['c', 'p', 'e', 'i']) {
    const r = assess({ name: 'Bertha Matter', category: c, year: 400 }, found(src({ text: 'bertha matter.' })), RULES);
    assert.equal(r.status, 'ready', c);
  }
});

test('unknown category -> review, not a crash', () => {
  const r = assess({ name: 'Bertha', category: 'zz', year: 1 }, found(src({ text: 'bertha.' })), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.match(r.reason, /not in the rules file/);
});

test('page text is never in the JSON a caller sees', () => {
  const s1 = src({ text: 'bertha was canonized. secret page text' });
  assert.ok(!JSON.stringify(s1).includes('secret page text'));
  const r = assess(bertha(), found(s1), RULES);
  assert.ok(JSON.stringify(r).length < 2000);
});

test('examine keeps page text in memory only, and layer 3 reads it end to end', async () => {
  const m = mocks({ 'https://www.newadvent.org/b': longText('Bertha of Blangy', 130) + ' Bertha of Blangy was canonized.' },
    [[{ url: 'https://www.newadvent.org/b', title: 'Bertha of Blangy' }]]);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, { ...m.deps, rules: RULES });
  assert.equal(r.result.layer3.status, 'ready');
  assert.ok(r.result.layer3.flags.includes('single_source'));
  // Only short excerpts near a match may appear, never the page itself.
  assert.ok(!JSON.stringify(r.result).includes('widow who founded an abbey. '.repeat(4)));
  assert.ok(JSON.stringify(r.result).length < 6000);
  assert.match(r.summary, /layer 3: ready.*single_source/);
});

test('handler: a missing rules file is reported as a layer 3 error, layers 1 and 2 still return', async () => {
  const m = mocks({ 'https://www.newadvent.org/b': longText('Bertha of Blangy') }, [[{ url: 'https://www.newadvent.org/b', title: 'Bertha' }]]);
  const prev = process.env.CATEGORY_RULES_PATH;
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's' } }, data,
    { ...m.deps, rules: undefined });
  // With deps.rules unset the handler loads the file from the working directory; if that fails it must not throw.
  assert.ok(r.result.layer3);
  assert.ok(['ready', 'needs_decision', 'too_thin', 'not_found', 'error'].includes(r.result.layer3.status));
  assert.equal(r.result.layer2, 'candidates_found');
  if (prev !== undefined) process.env.CATEGORY_RULES_PATH = prev;
});

test('assess:false skips layer 3', async () => {
  const m = mocks({ 'https://www.newadvent.org/b': longText('Bertha of Blangy') }, [[{ url: 'https://www.newadvent.org/b', title: 'Bertha' }]]);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', assess: false } }, data, m.deps);
  assert.equal(r.result.layer3, undefined);
});

test('evidence anchors on the specific part of a name, not a generic word', () => {
  // "miracle" is generic; "lanciano" is what the evidence must appear near.
  const r = assess({ name: 'Miracle of Lanciano', category: 'u', year: 750 },
    found(src({ text: 'a nihil obstat is mentioned. ' + 'filler word '.repeat(200) + ' lanciano is a town.' })), RULES);
  assert.equal(r.verdict.evidence.approval_signals, undefined);       // far from "lanciano"
  const near = assess({ name: 'Miracle of Lanciano', category: 'u', year: 750 },
    found(src({ text: 'at lanciano the bishop approved the devotion.' })), RULES);
  assert.ok(near.verdict.evidence.approval_signals.bishop_approved);
});

test('layer 2 stops after the allowlist when one verify-capable page has enough words (no open-web pass)', async () => {
  const m = mocks({ 'https://www.newadvent.org/b': longText('Bertha of Blangy', 130) }, [[{ url: 'https://www.newadvent.org/b', title: 'Bertha' }]]);
  const r = await findSources({ name: 'Bertha of Blangy', category: 's' }, { minWords: 1000, minDomains: 1 }, m.deps);
  assert.equal(r.widened, false);
  assert.equal(m.calls.search.length, 1);
});

test('layer 2 widens when the allowlist text is short of minWords, or short of the required sites', async () => {
  const pages = { 'https://www.newadvent.org/b': longText('Bertha of Blangy', 130) };
  const res = [[{ url: 'https://www.newadvent.org/b', title: 'Bertha' }]];
  const a = mocks(pages, res);
  assert.equal((await findSources({ name: 'Bertha of Blangy', category: 's' }, { minWords: 5000, minDomains: 1 }, a.deps)).widened, true);
  const b = mocks(pages, res);
  assert.equal((await findSources({ name: 'Bertha of Blangy', category: 's' }, { minWords: 1000, minDomains: 2 }, b.deps)).widened, true);
});

test('layer 3: a long page that only mentions the name in passing is not material', () => {
  const r = assess(bertha(), found(src({ words: 5000, mentions: 1, text: 'bertha was canonized.' })), RULES);
  assert.equal(r.status, 'too_thin');
  assert.equal(r.sufficiency.substantivePages, 0);
});

test('layer 3: ready but below the target -> flagged thin_material; at the target -> not flagged', () => {
  const t = 'bertha was canonized.';
  const thin = assess(bertha(), found(src({ words: 1500, text: t })), RULES);
  assert.equal(thin.status, 'ready');
  assert.ok(thin.flags.includes('thin_material'));
  const rich = assess(bertha(), found(src({ words: 2500, text: t }), src({ domain: 'vatican.va', words: 2000, text: t })), RULES);
  assert.equal(rich.sufficiency.rich, true);
  assert.ok(!rich.flags.includes('thin_material'));
});

test('layer 2: keeps hunting (a second allowlist search) while substantive words are under the target', async () => {
  const pages = { 'https://www.newadvent.org/a': longText('Bertha of Blangy', 130),
                  'https://www.vatican.va/b': longText('Bertha of Blangy', 400) };
  const m = mocks(pages, [[{ url: 'https://www.newadvent.org/a', title: 'Bertha' }], [{ url: 'https://www.vatican.va/b', title: 'Bertha' }]]);
  const r = await findSources({ name: 'Bertha of Blangy', category: 's' }, { minWords: 1000, targetWords: 3000, minMentions: 3, minDomains: 1 }, m.deps);
  assert.equal(m.calls.search.length, 2);
  assert.deepEqual(r.passes.map(x => x.kind), ['allowlist', 'allowlist-more']);
  assert.equal(r.widened, false);                     // the floor was met, so no open-web pass
  assert.equal(r.counts.usableApproved, 2);
});

test('layer 2: stops after one search once the target is reached', async () => {
  const m = mocks({ 'https://www.newadvent.org/a': longText('Bertha of Blangy', 500) }, [[{ url: 'https://www.newadvent.org/a', title: 'Bertha' }]]);
  await findSources({ name: 'Bertha of Blangy', category: 's' }, { minWords: 1000, targetWords: 3000, minMentions: 3, minDomains: 1 }, m.deps);
  assert.equal(m.calls.search.length, 1);
});

test('layer 2: a page that only brushes the name does not count toward the target, so the hunt continues', async () => {
  const brush = ('Filler about church history. '.repeat(1200)) + ' Bertha of Blangy once.';
  const m = mocks({ 'https://www.newadvent.org/a': brush }, [[{ url: 'https://www.newadvent.org/a', title: 'x' }]]);
  const r = await findSources({ name: 'Bertha of Blangy', category: 's' }, { minWords: 1000, targetWords: 3000, minMentions: 3, minDomains: 1 }, m.deps);
  assert.ok(m.calls.search.length >= 2);
  assert.equal(r.widened, true);                       // the floor was never met either
});

// ---------------------------------------------------------------------------------------------
// Perspective lanes (v0.5)
// ---------------------------------------------------------------------------------------------

const PLAN_S = perspectivePlan(RULES, 's');
const BIO = 'https://www.newadvent.org/cathen/02084a.htm';

test('perspectivePlan: rules give a plan per category; none for an unknown category or when switched off', () => {
  assert.deepEqual(PLAN_S.lanes.map(l => l.id).slice(0, 3), ['history_biography', 'theology_commentary', 'magisterial']);
  assert.equal(perspectivePlan(RULES, 'zz'), null);
  assert.equal(perspectivePlan({ ...RULES, perspectives: { ...RULES.perspectives, enabled: false } }, 's'), null);
  assert.equal(perspectivePlan({ sufficiency: {}, categories: {} }, 's'), null);
});

test('laneOf: a path-specific site beats a whole-domain site; unknown sites belong to no lane', () => {
  assert.equal(laneOf(BIO, PLAN_S.lanes), 'history_biography');
  assert.equal(laneOf('https://www.newadvent.org/fathers/1101.htm', PLAN_S.lanes), 'primary_texts');
  assert.equal(laneOf('https://www.newadvent.org/summa/1002.htm', PLAN_S.lanes), 'primary_texts');
  assert.equal(laneOf('https://www.vatican.va/archive/x.html', PLAN_S.lanes), 'magisterial');
  assert.equal(laneOf('https://www.newadvent.org/other/x.htm', PLAN_S.lanes), null);
  assert.equal(laneOf('https://example.org/x', PLAN_S.lanes), null);
  assert.equal(laneOf('not a url', PLAN_S.lanes), null);
});

test('laneCoverage: verify lanes need verify-capable pages; the theology lane is context-only and takes reported pages', () => {
  const mk = (url, o = {}) => ({ url, usable: true, status: 'approved', canVerify: true, words: 500, mentions: 5, ...o });
  const cov = laneCoverage([
    mk(BIO),
    mk('https://www.stpaulcenter.com/a', { canVerify: false }),              // reported: counts for the context lane
    mk('https://www.vatican.va/a', { canVerify: false }),                     // a verify lane, but this page cannot verify: no
    mk('https://www.ccel.org/a', { words: 100 }),                             // under minWords: not covered
    mk('https://www.franciscanmedia.org/a', { mentions: 0 })                  // name barely there: no
  ], PLAN_S);
  assert.equal(cov.history_biography.covered, true);
  assert.equal(cov.theology_commentary.covered, true);
  assert.equal(cov.theology_commentary.contextOnly, true);
  assert.equal(cov.magisterial.covered, false);
  assert.equal(cov.primary_texts.covered, false);
  assert.equal(cov.devotion_liturgy.covered, false);
});

const lanePages = {
  [BIO]: longText('Bertha of Blangy', 500),
  'https://www.vatican.va/doc': longText('Bertha of Blangy', 50),
  'https://www.newadvent.org/fathers/b': longText('Bertha of Blangy', 50)
};
const laneResults = [[{ url: BIO, title: 'Bertha' }], [{ url: 'https://www.vatican.va/doc', title: 'Bertha' }], [{ url: 'https://www.newadvent.org/fathers/b', title: 'Bertha' }]];
const LOPTS = { minWords: 1000, targetWords: 3000, minMentions: 3, minDomains: 1 };

test('layer 2: target already met, but missing lanes still get one restricted search each (in priority order)', async () => {
  const m = mocks(lanePages, laneResults);
  const r = await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: PLAN_S }, m.deps);
  assert.deepEqual(r.passes.map(x => x.kind), ['allowlist', 'lane:magisterial', 'lane:primary_texts']);
  assert.deepEqual(m.calls.search[1].allowedDomains, ['vatican.va']);
  assert.deepEqual(m.calls.search[2].allowedDomains, ['newadvent.org']);
  assert.match(m.calls.search[1].query, /Church documents|decrees|magisterial/);
  assert.equal(r.widened, false);
});

test('layer 2: lanes whose sites are not enabled in the registry are skipped without a search', async () => {
  const m = mocks(lanePages, laneResults);
  await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: PLAN_S }, m.deps);
  // theology (stpaulcenter etc.), devotion and outside_check have no enabled site in the test registry
  assert.ok(m.calls.search.every(q => !(q.allowedDomains || []).includes('stpaulcenter.com')));
  assert.equal(m.calls.search.length, 3);
});

test('layer 2: maxExtraSearches caps the lane searches; a covered lane is not searched again', async () => {
  const one = mocks(lanePages, laneResults);
  const r1 = await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: { ...PLAN_S, maxExtraSearches: 1 } }, one.deps);
  assert.deepEqual(r1.passes.map(x => x.kind), ['allowlist', 'lane:magisterial']);
  // the first page is a Fathers page, so primary_texts is already covered and is skipped
  const m = mocks({ 'https://www.newadvent.org/fathers/b': longText('Bertha of Blangy', 500), 'https://www.vatican.va/doc': lanePages['https://www.vatican.va/doc'] },
    [[{ url: 'https://www.newadvent.org/fathers/b', title: 'Bertha' }], [{ url: 'https://www.vatican.va/doc', title: 'Bertha' }]]);
  const r2 = await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: PLAN_S }, m.deps);
  assert.ok(!r2.passes.some(x => x.kind === 'lane:primary_texts'));
});

test('layer 2: no perspectives option -> no lane searches (old behaviour)', async () => {
  const m = mocks(lanePages, laneResults);
  const r = await findSources({ name: 'Bertha of Blangy', category: 's' }, LOPTS, m.deps);
  assert.equal(m.calls.search.length, 1);
  assert.ok(!r.passes.some(x => x.kind.startsWith('lane:')));
});

test('layer 2: lane pages are fetched at most maxFetchPerLane per search', async () => {
  const pages = { [BIO]: lanePages[BIO] };
  const cands = [];
  for (let i = 0; i < 7; i++) { pages['https://www.vatican.va/d' + i] = longText('Bertha of Blangy', 5); cands.push({ url: 'https://www.vatican.va/d' + i, title: 'Bertha' }); }
  const m = mocks(pages, [[{ url: BIO, title: 'B' }], cands, [{ url: BIO, title: 'B' }]]);
  const r = await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: { ...PLAN_S, maxExtraSearches: 1 } }, m.deps);
  assert.equal(r.passes.find(x => x.kind === 'lane:magisterial').fetched, PLAN_S.maxFetchPerLane);
});

test('layer 3: reports which perspectives were covered and missing; flags narrow_perspective under 3 lanes', () => {
  const t = 'bertha was canonized.';
  const narrow = assess(bertha(), found(src({ path: '/cathen/b.htm', words: 4500, text: t })), RULES);
  assert.deepEqual(narrow.perspectives.covered.map(c => c.id), ['history_biography']);
  assert.ok(narrow.perspectives.missing.includes('magisterial'));
  assert.ok(narrow.flags.includes('narrow_perspective'));
  const wide = assess(bertha(), found(
    src({ path: '/cathen/b.htm', words: 4500, text: t }),
    src({ domain: 'vatican.va', path: '/doc', words: 400, text: t }),
    src({ domain: 'stpaulcenter.com', path: '/a', words: 400, status: 'approved', canVerify: false, text: t })), RULES);
  assert.equal(wide.perspectives.covered.length, 3);
  assert.ok(!wide.flags.includes('narrow_perspective'));
  assert.equal(wide.perspectives.covered.find(c => c.id === 'theology_commentary').contextOnly, true);
});

test('layer 3: perspectives never block a ready entry, and a category with no lanes reports none', () => {
  const r = assess(bertha(), found(src({ path: '/cathen/b.htm', words: 4500, text: 'bertha was canonized.' })), RULES);
  assert.equal(r.status, 'ready');
  const noLanes = assess(bertha(), found(src({ words: 4500, text: 'bertha was canonized.' })), { ...RULES, perspectives: { enabled: false } });
  assert.equal(noLanes.perspectives, undefined);
  assert.ok(!noLanes.flags.includes('narrow_perspective'));
});

test('handler: perspective lanes run end to end and appear in the result', async () => {
  const m = mocks(lanePages, laneResults);
  const noPool = { ...RULES, selection: { ...RULES.selection, poolTarget: 0 } };   // isolate the lane passes from the pool hunt
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, { ...m.deps, rules: noPool });
  assert.ok(r.result.search.passes.some(x => x.kind === 'lane:magisterial'));
  assert.ok(r.result.layer3.perspectives.covered.some(c => c.id === 'magisterial'));
});

// ---------------------------------------------------------------------------------------------
// Selection: search wide, provide the best 3-4 (v0.6)
// ---------------------------------------------------------------------------------------------

const P = (domain, path, o = {}) => ({ url: 'https://www.' + domain + path, domain: 'www.' + domain, usable: true, status: 'approved',
  tier: 'approved', canVerify: true, words: 2000, mentions: 10, titleHasName: true, ...o });

test('selection: at most 4 pages, one per lane first, the rest listed as alsoFound', () => {
  const pool = [
    P('newadvent.org', '/cathen/a.htm', { words: 6000 }),            // history_biography
    P('newadvent.org', '/cathen/b.htm', { words: 5000 }),            // same lane, second page
    P('vatican.va', '/d1', { words: 1500 }),                         // magisterial
    P('newadvent.org', '/fathers/f', { words: 900, tier: 'primary' }),   // primary_texts
    P('britannica.com', '/x', { words: 800 }),                       // outside_check
    P('franciscanmedia.org', '/y', { words: 700 })                   // devotion_liturgy
  ];
  const r = selectSources(pool, RULES, 's');
  assert.equal(r.selected.length, 4);
  const lanes = r.selected.map(x => x.lane);
  assert.ok(lanes.includes('history_biography') && lanes.includes('magisterial') && lanes.includes('primary_texts'));
  assert.equal(r.alsoFound.length, 2);
  assert.ok(r.selected.every((x, i, a) => i === 0 || a[i - 1].score >= x.score));   // listed best first
});

test('selection: no more than 2 pages from one site, and only 1 context-only page', () => {
  const pool = [
    P('newadvent.org', '/cathen/a.htm', { words: 6000 }), P('newadvent.org', '/cathen/b.htm', { words: 5900 }), P('newadvent.org', '/cathen/c.htm', { words: 5800 }),
    P('stpaulcenter.com', '/a', { tier: 'reported', canVerify: false, words: 3000 }), P('wordonfire.org', '/a', { tier: 'reported', canVerify: false, words: 2900 })
  ];
  const r = selectSources(pool, RULES, 's');
  assert.equal(r.selected.filter(x => x.domain === 'www.newadvent.org').length, 2);
  assert.equal(r.selected.filter(x => !x.canVerify).length, 1);
});

test('selection: unjudged, unusable and barely-mentioning pages are never selected; a verify page is always included', () => {
  const pool = [
    P('example-order.org', '/a', { status: 'unjudged', canVerify: undefined, words: 9000 }),
    P('newadvent.org', '/cathen/a.htm', { usable: false }),
    P('vatican.va', '/a', { mentions: 0, words: 9000 }),
    P('stpaulcenter.com', '/a', { tier: 'reported', canVerify: false, words: 3000 }),
    P('britannica.com', '/a', { words: 400 })
  ];
  const r = selectSources(pool, RULES, 's');
  assert.deepEqual(r.selected.map(x => x.domain).sort(), ['www.britannica.com', 'www.stpaulcenter.com']);
  assert.ok(r.selected.some(x => x.canVerify));
  const onlyContext = selectSources([pool[3]], RULES, 's');
  assert.equal(onlyContext.selected.length, 1);          // nothing verify-capable exists to add
});

test('selection: a better-scoring page wins within a lane (more words, more mentions, tier weight)', () => {
  const r = selectSources([P('vatican.va', '/small', { words: 400, mentions: 2, titleHasName: false }), P('vatican.va', '/big', { words: 3000, mentions: 15 })], RULES, 's');
  assert.equal(r.selected[0].url, 'https://www.vatican.va/big');
});

test('layer 3: a single qualifying page is judged on its own word count (floor applies to the selected set)', () => {
  const t = 'bertha was canonized.';
  const enough = assess(bertha(), found(P('newadvent.org', '/cathen/a.htm', { words: 1500, text: t })), RULES);
  assert.equal(enough.status, 'ready');
  assert.equal(enough.selection.selected.length, 1);
  assert.ok(enough.flags.includes('few_sources') && enough.flags.includes('single_source'));
  const short = assess(bertha(), found(P('newadvent.org', '/cathen/a.htm', { words: 600, text: t })), RULES);
  assert.equal(short.status, 'too_thin');
});

test('layer 3: sufficiency counts only the SELECTED pages; the rest are alsoFound and not counted', () => {
  const t = 'bertha was canonized.';
  const many = [];
  for (let i = 0; i < 6; i++) many.push(P('newadvent.org', '/cathen/p' + i, { words: 250, text: t }));   // 6 small pages: 1,500 words in all
  const r = assess(bertha(), found(...many), RULES);
  assert.equal(r.selection.selected.length, 2);                  // maxPerDomain 2
  assert.equal(r.sufficiency.verifyCapableWords, 500);           // only the selected two count
  assert.equal(r.status, 'too_thin');
  assert.equal(r.selection.alsoFound.length, 4);
});

test('layer 3: three or more selected pages -> no few_sources flag', () => {
  const t = 'bertha was canonized.';
  const r = assess(bertha(), found(P('newadvent.org', '/cathen/a.htm', { words: 3000, text: t }), P('vatican.va', '/d', { words: 1500, text: t }), P('britannica.com', '/a', { words: 1200, text: t })), RULES);
  assert.ok(!r.flags.includes('few_sources'));
  assert.equal(r.selection.selected.length, 3);
});

test('layer 2: keeps hunting until the pool target of substantive pages (or the caps) is reached', async () => {
  const pages = {}, results1 = [], results2 = [];
  for (let i = 0; i < 3; i++) { pages['https://www.newadvent.org/cathen/p' + i] = longText('Bertha of Blangy', 300); results1.push({ url: 'https://www.newadvent.org/cathen/p' + i, title: 'B' }); }
  for (let i = 0; i < 3; i++) { pages['https://www.vatican.va/q' + i] = longText('Bertha of Blangy', 300); results2.push({ url: 'https://www.vatican.va/q' + i, title: 'B' }); }
  const base = { minWords: 1000, targetWords: 3000, minMentions: 3, minDomains: 1 };
  const a = mocks(pages, [results1, results2]);
  const r1 = await findSources({ name: 'Bertha of Blangy', category: 's' }, base, a.deps);
  assert.equal(a.calls.search.length, 1);                       // no pool target: the word target alone is met
  const b = mocks(pages, [results1, results2]);
  const r2 = await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...base, poolTarget: 5 }, b.deps);
  assert.equal(b.calls.search.length, 2);                       // 3 pages < pool target 5: one more search
  assert.equal(r2.counts.usableApproved, 6);
});

test('handler: summary says how many pages were selected out of how many found', async () => {
  const m = mocks(lanePages, laneResults);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, { ...m.deps, rules: RULES });
  assert.match(r.summary, /selected \d+ of \d+ pages/);
  assert.ok(r.result.layer3.selection.selected.length >= 1);
});

// ---------------------------------------------------------------------------------------------
// Signal types for ancient saints (v0.7)
// ---------------------------------------------------------------------------------------------

const ANC = (text, o = {}) => assess(bertha({ year: 304 }), found(src({ text })), o.rules || RULES);

test('signal types: every signal has a strength and every pattern in the rules file compiles', () => {
  const anc = RULES.categories.s.bases.ancient_veneration;
  for (const [type, def] of Object.entries(anc.signals)) {
    assert.ok(['strong', 'medium', 'weak'].includes(def.strength), type);
    for (const pat of def.patterns) assert.doesNotThrow(() => new RegExp(pat, 'gi'), type + ': ' + pat);
  }
  for (const pat of anc.cautions) assert.doesNotThrow(() => new RegExp(pat, 'gi'), pat);
});

test('signal types: a single kind of signal alone is not enough (review, and it says which kind)', () => {
  const r = ANC('bertha is named in the roman martyrology. the roman martyrology lists bertha again. bertha and the roman canon.');
  assert.equal(r.status, 'needs_decision');                       // three mentions, but ONE kind (liturgical)
  assert.match(r.verdict.reasons[0].text, /only one kind of veneration signal \(liturgical\)/);
  assert.ok(r.verdict.evidence.ancient_veneration.signals.liturgical);
});

test('signal types: two strong kinds are accepted (Roman and Eastern)', () => {
  const r = ANC('bertha is in the roman martyrology; the orthodox church commemorates bertha too.');
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.basis, 'ancient_veneration');
});

test('signal types: strong plus medium is accepted; medium plus medium is not (no strong kind)', () => {
  assert.equal(ANC('bertha, philocalian calendar. relics of bertha are kept in rome.').status, 'ready');
  const mm = ANC('the feast of bertha is celebrated each year. a church was dedicated to st. bertha.');
  assert.equal(mm.status, 'needs_decision');
  assert.match(mm.verdict.reasons[0].text, /no strong veneration signal/);
});

test('signal types: place names, patronage and hospitals are weak and never count as strong', () => {
  const r = ANC('bertha is the patron of travellers, a hospital is named after bertha, and a church was dedicated to st. bertha.');
  assert.equal(r.status, 'needs_decision');
  assert.match(r.verdict.reasons[0].text, /no strong veneration signal/);
  assert.ok(r.verdict.evidence.ancient_veneration.signals.place_patronage);
});

test('signal types: a caution (legendary, removed from the calendar) sends it to review even with two good kinds', () => {
  const r = ANC('bertha is in the roman martyrology and the orthodox church commemorates bertha, but bertha is a legendary figure.');
  assert.equal(r.status, 'needs_decision');
  assert.match(r.verdict.reasons[0].text, /raise doubt/);
  assert.ok(r.verdict.evidence.ancient_veneration.cautions.length >= 1);
  assert.equal(ANC('bertha was removed from the general roman calendar; bertha is in the roman martyrology.').status, 'needs_decision');
});

test('signal types: decisiveTypes lets one kind settle it, if Tom chooses so in the rules', () => {
  const rules2 = JSON.parse(JSON.stringify(RULES));
  rules2.categories.s.bases.ancient_veneration.accept.decisiveTypes = ['liturgical'];
  const r = ANC('bertha is named in the roman martyrology.', { rules: rules2 });
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.basis, 'ancient_veneration');
  assert.equal(ANC('bertha is named in the roman martyrology.').status, 'needs_decision');   // default rules: not enough alone
});

test('signal types: a signal far from the name does not count', () => {
  const far = 'bertha lived quietly. ' + 'filler words go here. '.repeat(120) + ' the roman martyrology and the orthodox church commemorates others.';
  assert.equal(ANC(far).status, 'needs_decision');
});

test('signal types: formal canonization still works as its own basis, alongside the signals', () => {
  const r = assess(bertha({ year: 304 }), found(src({ text: 'bertha was canonized by the church. bertha in the roman martyrology.' })), RULES);
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.basis, 'formal_canonization');
});

test('signal types: in rewrite mode a failed veneration check is advisory only', () => {
  const r = assess(bertha({ year: 304 }), found(src({ text: 'bertha is named in the roman martyrology.' })), RULES, { mode: 'rewrite' });
  assert.equal(r.status, 'ready');
  assert.ok(r.flags.includes('category_advisory'));
});

// ---------------------------------------------------------------------------------------------
// Fixes from the first live run on St. Augustine (v0.8)
// ---------------------------------------------------------------------------------------------

test('live fix: a site that blocks automated fetching (britannica.com, 403) is never searched, and its lane is dropped', () => {
  assert.ok(RULES.fetchBlockedDomains.includes('britannica.com'));
  assert.ok(!perspectivePlan(RULES, 's').lanes.some(l => l.id === 'outside_check'));
  const noBlock = perspectivePlan({ ...RULES, fetchBlockedDomains: [] }, 's');
  assert.ok(noBlock.lanes.some(l => l.id === 'outside_check'));
});

test('live fix: findSources leaves blocked domains out of every allowlist search', async () => {
  const m = mocks(lanePages, laneResults);
  await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: PLAN_S, blockedDomains: ['vatican.va'] }, m.deps);
  assert.ok(m.calls.search.length >= 1);
  assert.ok(m.calls.search.every(q => !(q.allowedDomains || []).includes('vatican.va')));
  assert.ok(m.calls.search.every(q => !(q.allowedDomains || []).includes('www.vatican.va')));
});

test('live fix: findSources and the handler report web searches and timing (for the article log and for cost)', async () => {
  const m = mocks(lanePages, laneResults);
  const f = await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: PLAN_S }, m.deps);
  assert.equal(f.searchCalls, m.calls.search.length);
  assert.ok(f.webSearches >= 0);
  const m2 = mocks(lanePages, laneResults);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, { ...m2.deps, rules: RULES });
  assert.ok(r.result.timing.seconds >= 0);
  assert.equal(r.result.timing.searchCalls, m2.calls.search.length);
  assert.ok(r.result.timing.pagesFetched >= 1);
});

test('live fix: a CCEL encyclopedia page is not a primary text; a CCEL author page is', () => {
  const lanes = PLAN_S.lanes;
  assert.equal(laneOf('https://www.ccel.org/ccel/schaff/encyc01.html?term=Augustine', lanes), null);
  assert.equal(laneOf('https://ccel.org/ccel/herbermann/cathen02.html', lanes), null);
  assert.equal(laneOf('https://www.ccel.org/ccel/schaff/hist01.html', lanes), null);
  assert.equal(laneOf('https://ccel.org/ccel/augustine/confess.html', lanes), 'primary_texts');
  assert.equal(laneOf('https://ccel.org/a/augustine/index.html', lanes), 'primary_texts');
});

test('live fix: lane picks fill every slot, so the selected pages are different kinds before score decides', () => {
  const pool = [
    P('newadvent.org', '/cathen/a.htm', { words: 6000 }),                         // history_biography
    P('ewtn.com', '/lib/a', { words: 6500, mentions: 60 }),                       // magisterial, high score
    P('ewtn.com', '/lib/b', { words: 6400, mentions: 60 }),                       // magisterial again, also high score
    P('catholic.com', '/e/a', { words: 6000, tier: 'reported', canVerify: false }),   // theology (context only)
    P('newadvent.org', '/fathers/1101.htm', { words: 900, tier: 'primary', mentions: 4 })   // primary_texts, low score
  ];
  const r = selectSources(pool, RULES, 's');
  assert.equal(r.selected.length, 4);
  assert.deepEqual(r.selected.map(x => x.lane).sort(), ['history_biography', 'magisterial', 'primary_texts', 'theology_commentary']);
  assert.equal(r.alsoFound.length, 1);                                            // the second EWTN page waits in alsoFound
});

test('live fix: "contemporary account" (e.g. of the Vandal invasion) is no longer an early-witness signal for veneration', () => {
  const r = assess(bertha({ year: 430 }), found(src({ text: 'every contemporary account of bertha tells of the vandals. the orthodox church commemorates bertha.' })), RULES);
  const sig = r.verdict.evidence.ancient_veneration && r.verdict.evidence.ancient_veneration.signals;
  assert.ok(!sig || !sig.early_witness);
  assert.equal(r.status, 'needs_decision');          // only one real kind (eastern) is left
});

// ---------------------------------------------------------------------------------------------
// runJerome: the orchestrator entry point, with the article log (v0.9)
// ---------------------------------------------------------------------------------------------
import { mkdtempSync as _mk, writeFileSync } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';
import { join as _join } from 'node:path';
import { loadLog as _loadLog } from '../services/article-log.mjs';

test('runJerome: logs Jerome\'s steps, returns the log file to commit, and keeps the task result compact', async () => {
  const m = mocks(lanePages, laneResults);
  const rjDir = _mk(_join(_tmp(), 'rj-'));
  const logPath = _join(rjDir, 'article-log.json'), sourcesDir = _join(rjDir, 'sources');
  const out = await runJerome({ id: 'task-9', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, {}, { ...m.deps, rules: RULES, logPath, sourcesDir });
  assert.deepEqual(out.filesToCommit, [logPath, _join(sourcesDir, 'st-bertha-of-blangy-723.json')]);       // the log, then the sources file
  const job = _loadLog(logPath).jobs[0];
  assert.equal(job.id, 'task-9');
  assert.equal(job.steps[0].text, 'Got request for new article: St. Bertha of Blangy');
  assert.ok(job.steps.some(s => /^Found \d+ usable pages on \d+ sites/.test(s.text) && s.seconds != null));
  assert.equal(out.result.search.sources, undefined);                     // the long per-page records stay out of workLog.json
  assert.ok(out.result.search.counts && out.result.search.passes);
  assert.ok(out.result.layer3.selection.selected.length >= 1);            // the part Ignatius and a person need is kept
  assert.match(out.summary, /layer 3:/);
});

test('runJerome: the third argument the orchestrator passes (the work log) is not mistaken for dependencies', async () => {
  const m = mocks(lanePages, laneResults);
  const wlDir = _mk(_join(_tmp(), 'rj-'));
  const logPath = _join(wlDir, 'article-log.json');
  const workLog = { tasks: [{ id: 'a' }], search: 'not a function', rules: 'not rules' };      // looks like deps by accident
  const out = await runJerome({ id: 't', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's' } }, data, workLog, { ...m.deps, rules: RULES, logPath, sourcesDir: _join(wlDir, 'sources') });
  assert.equal(out.result.outcome, 'new_subject');
  assert.ok(out.result.layer3);
});

test('runJerome: a task id, a payload jobId, or neither all give a job; two services share one job via jobId', async () => {
  const logPath = _join(_mk(_join(_tmp(), 'rj-')), 'article-log.json');
  for (const task of [{ id: 'x1', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', search: false } },
                      { id: 'x2', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', search: false, jobId: 'x1' } }]) {
    await runJerome(task, data, {}, { rules: RULES, logPath });
  }
  const log = _loadLog(logPath);
  assert.equal(log.jobs.length, 1);
  assert.equal(log.jobs[0].id, 'x1');
  assert.ok(log.jobs[0].steps.length >= 2);
});

test('runJerome: an unwritable log never fails the task; it is reported in the summary', async () => {
  const blocker = _join(_mk(_join(_tmp(), 'rj-')), 'a-file');
  writeFileSync(blocker, 'x');                                            // a regular file, so nothing can be created beneath it
  const out = await runJerome({ id: 'x', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', search: false } }, data, {}, { rules: RULES, logPath: _join(blocker, 'sub', 'article-log.json') });
  assert.equal(out.filesToCommit, undefined);
  assert.match(out.summary, /article log not written/);
});

test('runJerome: a layer-1 answer (already on the timeline) is logged too', async () => {
  const logPath = _join(_mk(_join(_tmp(), 'rj-')), 'article-log.json');
  const exists = data.entries[0];
  const out = await runJerome({ id: 'e1', payload: { mode: 'new', name: exists.n, category: exists.t, year: exists.y, search: false } }, data, {}, { rules: RULES, logPath });
  assert.equal(out.result.outcome, 'exists');
  assert.match(_loadLog(logPath).jobs[0].steps[1].text, /Already on the timeline/);
});

test('compactResult: strips only the long per-page records', () => {
  const r = { outcome: 'x', search: { widened: false, passes: [1], counts: { a: 1 }, sources: [{}, {}], webSearches: 3, searchCalls: 2 }, layer3: { status: 'ready' } };
  const c = compactResult(r);
  assert.deepEqual(Object.keys(c.search).sort(), ['counts', 'passes', 'searchCalls', 'webSearches', 'widened']);
  assert.equal(c.layer3.status, 'ready');
  assert.equal(r.search.sources.length, 2);                    // the original is untouched
});

test('timing carries the model and token counts for the cost column', async () => {
  const m = mocks(lanePages, laneResults);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's' } }, data, { ...m.deps, rules: RULES });
  assert.equal(r.result.timing.model, 'claude-sonnet-4-6');
  assert.equal(typeof r.result.timing.inputTokens, 'number');
  assert.equal(typeof r.result.timing.outputTokens, 'number');
});

test('token tally: new input, output, cache reads and writes are kept apart; a request with a prompt over 100,000 tokens goes in its own bucket', () => {
  const t = newTally();
  addUsage(t, { input_tokens: 9000, output_tokens: 700, cache_read_input_tokens: 4000, cache_creation_input_tokens: 1000 });
  addUsage(t, { input_tokens: 3000, output_tokens: 300 });
  assert.deepEqual([t.input, t.output, t.cacheRead, t.cacheWrite], [12000, 1000, 4000, 1000]);
  addUsage(t, { input_tokens: 60000, output_tokens: 900, cache_read_input_tokens: 50000 });      // prompt = 110,000 -> long bucket
  assert.deepEqual([t.long.input, t.long.output, t.long.cacheRead], [60000, 900, 50000]);
  assert.equal(t.input, 12000);                                                                  // the normal bucket did not change
  addUsage(t, undefined);                                                                         // a response with no usage block changes nothing
  addUsage(t, {});
  assert.equal(t.output, 1000);
});

test('timing in the result carries cache tokens, and a longPrompt bucket only when there was one', async () => {
  const m = mocks(lanePages, laneResults);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's' } }, data, { ...m.deps, rules: RULES });
  assert.equal(r.result.timing.cacheReadTokens, 0);
  assert.equal(r.result.timing.cacheWriteTokens, 0);
  assert.equal(r.result.timing.longPrompt, undefined);
});

// ---------------------------------------------------------------------------------------------
// Fixes from the first run on St. Pachomius (v0.9.3): site signals and tighter cautions
// ---------------------------------------------------------------------------------------------

const PACH = { name: 'St. Pachomius', category: 's', year: 346 };
const page = (url, o = {}) => { const x = { url, domain: new URL(url).hostname, usable: true, status: 'approved', canVerify: true, tier: 'official', words: 1400, mentions: 20 , ...o }; Object.defineProperty(x, 'text', { value: o.text || '', enumerable: false }); return x; };
const OCA = 'https://www.oca.org/saints/lives/2026/05/15/101384-venerable-pachomius-the-great-founder-of-coenobitic-monasticism';
const VN = 'https://www.vaticannews.va/en/saints/05/09/st--pachomius--abbot.html';

test('site signals: an Orthodox saints entry and a Vatican News saint-of-the-day page are accepted as two kinds of veneration, with no matching phrase on the page', () => {
  const r = assess(PACH, found(page(OCA), page(VN, { mentions: 2, tier: 'approved' }), page('https://www.ewtn.com/catholicism/library/st-pachomius-abbot-5721', { words: 3500, tier: 'approved' })), RULES);
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.basis, 'ancient_veneration');
  const sig = r.verdict.evidence.ancient_veneration.signals;
  assert.equal(sig.eastern.strength, 'strong');
  assert.equal(sig.feast_day.strength, 'medium');
  assert.match(sig.eastern.excerpts[0], /^\[site\] Orthodox Church in America/);
  assert.ok(sig.eastern.excerpts[0].includes(OCA));
});

test('site signals: the page must be on the site, under the path, name the saint in its web address, and name him on the page', () => {
  const BASE = page('https://www.ewtn.com/catholicism/library/st-pachomius-abbot-5721', { words: 3500, tier: 'approved' });   // keeps the material sufficient, so a verdict exists
  const none = (...ps) => assess(PACH, found(BASE, ...ps), RULES).verdict.evidence.ancient_veneration;
  assert.equal(none(page('https://www.oca.org/orthodoxy/church-history/monasticism1')), undefined);                      // not under /saints/
  assert.equal(none(page('https://www.oca.org/saints/lives/2026/05/15/101385-venerable-theodore-the-sanctified')), undefined);   // another saint's slug
  assert.equal(none(page('https://www.vaticannews.va/en/saints/05/09.html', { mentions: 1 })), undefined);                      // a date list, no name in the address
  assert.equal(none(page(OCA, { mentions: 0 })), undefined);                                                                    // does not actually name him
  assert.equal(none(page(OCA, { canVerify: false, tier: 'reported' })), undefined);                                            // a page that cannot verify never counts
  assert.equal(none(page('https://example.org/saints/pachomius')), undefined);                                                 // an unlisted site
});

test('site signals: one site alone is still only one kind, so it goes to review like any single signal', () => {
  const r = assess({ ...PACH, year: 346 }, found(page(OCA), page('https://www.newadvent.org/cathen/12748b.htm', { tier: 'approved', words: 18000, mentions: 7 })), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.match(r.verdict.reasons[0].text, /only one kind of veneration signal \(eastern\)/);
});

test('site signals: only for a saint within the year limit, like every veneration signal', () => {
  const r = assess({ ...PACH, year: 1500 }, found(page(OCA), page(VN, { mentions: 2 })), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.equal(r.verdict.evidence.ancient_veneration, undefined);
});

test('cautions: a legendary ANGEL in a translator\'s note is not a doubt about the saint, but "a legendary figure" or removal from the calendar is', () => {
  const ok = assess(PACH, found(page(OCA), page(VN, { mentions: 2 }), page('https://ccel.org/ccel/pearse/morefathers/files/palladius_lausiac_02_text.htm', { tier: 'primary', words: 48000,
    text: 'the angel here seems to him legendary, since he is not mentioned in the lives. pachomius received first his own brother.' })), RULES);
  assert.equal(ok.status, 'ready');
  assert.equal(ok.verdict.evidence.ancient_veneration.cautions, undefined);
  const doubt = assess(PACH, found(page(OCA), page(VN, { mentions: 2 }), page('https://www.newadvent.org/cathen/x.htm', { tier: 'approved', text: 'pachomius was removed from the general roman calendar in 1969.' })), RULES);
  assert.equal(doubt.status, 'needs_decision');
  assert.match(doubt.verdict.reasons[0].text, /raise doubt/);
});

test('bases: when veneration and canonization both qualify, veneration leads and the other is recorded as also qualified', () => {
  const r = assess(bertha({ year: 304 }), found(src({ text: 'bertha is named in the roman martyrology, and a church was dedicated to st. bertha. bertha was canonized.' })), RULES);
  assert.equal(r.verdict.basis, 'ancient_veneration');
  assert.deepEqual(r.verdict.evidence.also_qualified, ['formal_canonization']);
});

// ---------------------------------------------------------------------------------------------
// From the first NEW-subject run (Blessed Michael McGivney): thin material no longer hides the category check (v0.9.4)
// ---------------------------------------------------------------------------------------------

const MCG = { name: 'Michael McGivney', category: 's', year: 1890 };
const unj = (host, o = {}) => ({ url: 'https://' + host + '/mcgivney', domain: host, usable: true, status: 'unjudged', canVerify: undefined, tier: undefined, words: 800, mentions: 12, ...o });

test('thin material AND a Blessed: the status is the sufficiency one, and "not canonized" is reported beside it', () => {
  const r = assess(MCG, found(src({ words: 656, text: 'michael mcgivney was beatified in 2020 and is venerable no longer; his cause continues.' }), unj('www.kofc.org')), RULES);
  assert.equal(r.status, 'needs_decision');                                    // thin, but unjudged pages might fix it
  assert.deepEqual(r.decisions.map(d => d.kind), ['unjudged_sources', 'category_review']);
  assert.match(r.verdict.reasons[0].text, /not canonized/);
  assert.match(r.reason, /too thin.*ALSO: not canonized/);
  assert.ok(!r.flags.includes('single_source') && !r.flags.includes('thin_material'));      // those flags describe an entry that has enough
});

test('thin material and nothing to fix it: still too_thin, and the category result is there too', () => {
  const r = assess(MCG, found(src({ words: 656, text: 'michael mcgivney was beatified in 2020.' })), RULES);
  assert.equal(r.status, 'too_thin');
  assert.match(r.verdict.reasons[0].text, /not canonized/);
  assert.equal(r.decisions.length, 1);
  assert.equal(r.decisions[0].kind, 'category_review');
});

test('thin material but the saint check passes: no category decision is added and the status is unchanged', () => {
  const r = assess(MCG, found(src({ words: 656, text: 'michael mcgivney was canonized by the church.' }), unj('www.kofc.org')), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.deepEqual(r.decisions.map(d => d.kind), ['unjudged_sources']);
  assert.equal(r.verdict.action, 'accept');
  assert.equal(r.verdict.basis, 'formal_canonization');
});

test('no usable page at all is still not_found, with no verdict', () => {
  const r = assess(MCG, found(src({ usable: false })), RULES);
  assert.equal(r.status, 'not_found');
  assert.equal(r.verdict, undefined);
});

// ---------------------------------------------------------------------------------------------
// From the Our Lady of Akita run (v0.9.5): cheaper lane searches, approval leads from reported pages, short reasons
// ---------------------------------------------------------------------------------------------

test('lane searches use one web search each (the rules say so); the normal passes keep the default', async () => {
  assert.equal(PLAN_S.searchesPerLane, 1);
  const m = mocks(lanePages, laneResults);
  await findSources({ name: 'Bertha of Blangy', category: 's' }, { ...LOPTS, perspectives: PLAN_S }, m.deps);
  assert.equal(m.calls.search[0].maxUses, undefined);                 // the first allowlist search: default
  assert.ok(m.calls.search.slice(1).every(q => q.maxUses === 1));     // each lane search: one
  const custom = perspectivePlan({ ...RULES, perspectives: { ...RULES.perspectives, searchesPerLane: 2 } }, 's');
  assert.equal(custom.searchesPerLane, 2);
});

const AKITA = { name: 'Our Lady of Akita', category: 'm', year: 1973 };
const rep = (text, o = {}) => src({ domain: 'ncregister.com', canVerify: false, tier: 'reported', words: 2500, text, ...o });

test('apparition: approval wording on a REPORTED page is shown as a lead, separately from verified evidence, and never changes the verdict', () => {
  const r = assess(AKITA, found(src({ domain: 'ewtn.com', words: 1700, text: 'the message of our lady of akita to sister agnes.' }),
    rep('in 1984 the bishop approved the devotion to our lady of akita, declaring it worthy of belief.')), RULES);
  assert.equal(r.status, 'needs_decision');
  assert.equal(r.verdict.evidence.approval_signals, undefined);              // nothing verifiable said it
  assert.ok(r.verdict.evidence.approval_signals_reported.bishop_approved);   // but a reported page did: a lead to check
  assert.equal(r.verdict.action, 'review');
});

test('apparition: evidence from verify-capable pages and from reported pages are kept in separate fields', () => {
  const r = assess(AKITA, found(src({ domain: 'vatican.va', words: 1700, text: 'a nihil obstat was issued for our lady of akita.' }),
    rep('the bishop approved our lady of akita as worthy of belief.')), RULES);
  assert.ok(r.verdict.evidence.approval_signals.dicastery_or_holy_see);
  assert.ok(r.verdict.evidence.approval_signals_reported.bishop_approved);
});

test('apparition: approval wording far from the name on a reported page is not a lead', () => {
  const far = 'the bishop approved the devotion. ' + 'filler words go here. '.repeat(120) + ' our lady of akita is discussed.';
  const r = assess(AKITA, found(src({ domain: 'ewtn.com', words: 1700, text: 'our lady of akita.' }), rep(far)), RULES);
  assert.equal(r.verdict.evidence.approval_signals_reported, undefined);
});

test('apparition and miracle reasons are short enough for the log', () => {
  assert.ok(RULES.categories.m.reason.length < 140);
  assert.ok(RULES.categories.u.reason.length < 140);
  assert.match(RULES.categories.m.reason, /a person sets the approval level/);
});

test('rewrite of an apparition: the review is advice only, and the reason in the log is the short one', () => {
  const r = assess(AKITA, found(src({ domain: 'ewtn.com', words: 1700, text: 'our lady of akita.' })), RULES, { mode: 'rewrite' });
  assert.equal(r.status, 'ready');
  assert.equal(r.verdict.advisory[0].text, RULES.categories.m.reason);
});

// ---------------------------------------------------------------------------------------------
// Diocese lookup and the handoff to Ignatius (v0.9.6)
// ---------------------------------------------------------------------------------------------
import { loadQueue as _loadQueue } from '../services/authority-finder.mjs';

const DIOCESE_REPLY = JSON.stringify({ place: 'Blangy', country: 'France', diocese: 'Diocese of Arras', official_site_url: 'https://arras.diocese.example/', alternates: [], confidence: 'high', note: 'test' });
const CHURCH_PAGE = 'The Diocese of Arras. Bishop and priests. Parishes, the cathedral and Mass times. Arras news. '.repeat(12);
const authPages = () => ({ ...lanePages, 'https://arras.diocese.example/': CHURCH_PAGE });
const NOPOOL = { ...RULES, selection: { ...RULES.selection, poolTarget: 0 } };
const APPARITION = { payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 'm', year: 723 } };

test('diocese lookup: an apparition gets the diocese and its site checked, and the searches are added to the run total', async () => {
  const m = mocks(authPages(), laneResults);
  const asked = [];
  const r = await runSourceFinder(APPARITION, data, { ...m.deps, rules: NOPOOL, askAuthority: async a => { asked.push(a); return { text: DIOCESE_REPLY, searches: 2 }; } });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].maxUses, 2);
  const a = r.result.authority;
  assert.deepEqual([a.found, a.diocese, a.candidates[0].registry, a.candidates[0].verified], [true, 'Diocese of Arras', 'new', true]);
  const base = r.result.search.webSearches;
  assert.equal(r.result.timing.webSearches, base + 2);
  assert.equal(r.result.timing.searchCalls, r.result.search.searchCalls + 1);
});

test('diocese lookup: saints (and other categories not in the rules) are not looked up', async () => {
  const m = mocks(authPages(), laneResults);
  let asked = 0;
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, { ...m.deps, rules: NOPOOL, askAuthority: async () => { asked++; return { text: DIOCESE_REPLY, searches: 1 }; } });
  assert.equal(asked, 0);
  assert.equal(r.result.authority, undefined);
});

test('diocese lookup: payload authority:false and the rules switch both turn it off', async () => {
  const off = async rules => {
    const m = mocks(authPages(), laneResults);
    let asked = 0;
    const payload = rules ? APPARITION.payload : { ...APPARITION.payload, authority: false };
    const r = await runSourceFinder({ payload }, data, { ...m.deps, rules: rules || NOPOOL, askAuthority: async () => { asked++; return { text: DIOCESE_REPLY, searches: 1 }; } });
    return [asked, r.result.authority];
  };
  assert.deepEqual(await off(null), [0, undefined]);
  assert.deepEqual(await off({ ...NOPOOL, authorityLookup: { ...NOPOOL.authorityLookup, enabled: false } }), [0, undefined]);
});

test('diocese lookup: a failing model call is reported on the result and the run still finishes', async () => {
  const m = mocks(authPages(), laneResults);
  const r = await runSourceFinder(APPARITION, data, { ...m.deps, rules: NOPOOL, askAuthority: async () => { throw new Error('model unavailable'); } });
  assert.deepEqual([r.result.authority.found, r.result.authority.error], [false, 'model unavailable']);
  assert.ok(r.result.layer3);
});

test('diocese lookup: a quota error is passed up (deferred), not swallowed', async () => {
  const m = mocks(authPages(), laneResults);
  const err = Object.assign(new Error('quota'), { deferred: true });
  await assert.rejects(runSourceFinder(APPARITION, data, { ...m.deps, rules: NOPOOL, askAuthority: async () => { throw err; } }), /quota/);
});

test('the rules file turns the lookup on for apparitions and miracles only', () => {
  assert.deepEqual(RULES.authorityLookup.categories, ['m', 'u']);
  assert.equal(RULES.authorityLookup.enabled, true);
});

test('recordHandoff: a new site goes into ignatius-queue.json as waiting, once; with nothing new the file is not touched', () => {
  const dir = _mk(_join(_tmp(), 'ho-'));
  const queuePath = _join(dir, 'ignatius-queue.json');
  const result = { subject: { name: 'Our Lady of Akita' }, authority: { diocese: 'Diocese of Niigata', place: 'Akita', country: 'Japan', confidence: 'high',
    candidates: [{ url: 'https://n.example/', domain: 'n.example', role: 'diocese', registry: 'new', verified: true, checks: {}, suggestedEntry: { domain: 'n.example' } }] } };
  const now = new Date('2026-10-09T17:00:00Z');
  assert.deepEqual(recordHandoff({ result, task: { id: 't1', payload: {} }, queuePath, now }), { added: 1, merged: 0, skipped: 0, changed: true });
  const q = _loadQueue(queuePath);
  assert.deepEqual([q.items[0].status, q.items[0].subjects[0].jobId, q.items[0].firstSeen], ['waiting', 't1', '2026-10-09T17:00:00.000Z']);
  assert.equal(recordHandoff({ result: { subject: result.subject, authority: { candidates: [{ registry: 'approved' }] } }, task: { id: 't2', payload: {} }, queuePath, now }).changed, false);
  assert.equal(recordHandoff({ result: {}, task: {}, queuePath }).changed, false);
});

test('runJerome: hands a new diocese site to Ignatius, returns the queue file to commit, and says so in the summary', async () => {
  const m = mocks(authPages(), laneResults);
  const dir = _mk(_join(_tmp(), 'rj2-'));
  const logPath = _join(dir, 'article-log.json'), queuePath = _join(dir, 'ignatius-queue.json'), sourcesDir = _join(dir, 'sources');
  const out = await runJerome({ id: 'task-12', payload: { ...APPARITION.payload } }, data, {}, { ...m.deps, rules: NOPOOL, logPath, queuePath, sourcesDir, askAuthority: async () => ({ text: DIOCESE_REPLY, searches: 2 }) });
  assert.deepEqual(out.filesToCommit, [logPath, queuePath, _join(sourcesDir, 'st-bertha-of-blangy-723.json')]);
  assert.match(out.summary, /handed 1 site\(s\) to Ignatius/);
  const item = _loadQueue(queuePath).items[0];
  assert.deepEqual([item.domain, item.subjects[0].jobId], ['arras.diocese.example', 'task-12']);
  const job = _loadLog(logPath).jobs[0];
  assert.ok(job.steps.some(s => /^Handed to Ignatius: Diocese website arras\.diocese\.example \(Diocese of Arras — Blangy, France\); the page loads/.test(s.text)));
});

test('runJerome: with no new site, the Ignatius queue is not committed (the log and the sources file are)', async () => {
  const m = mocks(authPages(), laneResults);
  const dir = _mk(_join(_tmp(), 'rj3-'));
  const logPath = _join(dir, 'article-log.json'), queuePath = _join(dir, 'ignatius-queue.json'), sourcesDir = _join(dir, 'sources');
  const out = await runJerome({ id: 'task-13', payload: { ...APPARITION.payload } }, data, {}, { ...m.deps, rules: NOPOOL, logPath, queuePath, sourcesDir, askAuthority: async () => ({ text: JSON.stringify({ diocese: 'D', official_site_url: null }), searches: 1 }) });
  assert.deepEqual(out.filesToCommit, [logPath, _join(sourcesDir, 'st-bertha-of-blangy-723.json')]);
});

// ---------------------------------------------------------------------------------------------
// The sources file (v0.9.7): sources/<entry-id>.json, Jerome's handoff to Augustine and Thomas
// ---------------------------------------------------------------------------------------------
import { loadSources as _loadSources } from '../services/sources-file.mjs';

const fullReg = { ...reg, domains: reg.domains.map(d => (d.domain === 'newadvent.org' ? { ...d, storage: 'full' } : d)) };

test('runJerome: saves sources/<entry-id>.json with the chosen pages, returns it to commit, and says so in the summary', async () => {
  const m = mocks(lanePages, laneResults);
  const dir = _mk(_join(_tmp(), 'rs-'));
  const logPath = _join(dir, 'article-log.json'), sourcesDir = _join(dir, 'sources');
  const out = await runJerome({ id: 'task-21', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, {}, { ...m.deps, rules: NOPOOL, logPath, sourcesDir });
  const path = _join(sourcesDir, 'st-bertha-of-blangy-723.json');
  assert.ok(out.filesToCommit.includes(path));
  assert.match(out.summary, /saved .*st-bertha-of-blangy-723\.json/);
  const f = _loadSources('st-bertha-of-blangy-723', sourcesDir);
  assert.deepEqual([f.version, f.mode, f.jobId, f.outcome], [1, 'new', _loadLog(logPath).jobs[0].id, out.result.layer3.status]);
  assert.ok(f.sources.length >= 1 && f.sources.every(s => /^[0-9a-f]{16}$/.test(s.hash) && s.status === 'approved'));
  assert.equal(f.totalWords, f.sources.reduce((n, s) => n + s.words, 0));
});

test('runJerome: full text goes into the file only for a registry source set to storage "full"', async () => {
  const dir = _mk(_join(_tmp(), 'rs2-')), sourcesDir = _join(dir, 'sources');
  const m = mocks(lanePages, laneResults);
  await runJerome({ id: 'task-22', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, {}, { ...m.deps, registry: fullReg, rules: NOPOOL, logPath: _join(dir, 'l.json'), sourcesDir });
  const f = _loadSources('st-bertha-of-blangy-723', sourcesDir);
  const na = f.sources.filter(s => s.domain === 'newadvent.org'), other = f.sources.filter(s => s.domain !== 'newadvent.org');
  assert.ok(na.length && na.every(s => s.storage === 'full' && typeof s.text === 'string' && s.text.includes('Bertha of Blangy')));
  assert.ok(other.every(s => s.storage === 'excerpts' && s.text === undefined));
});

test('runJerome: a rewrite is saved under the timeline id', async () => {
  const dir = _mk(_join(_tmp(), 'rs3-')), sourcesDir = _join(dir, 'sources');
  const m = mocks(lanePages, laneResults);
  const d2 = { entries: [{ id: 'st-bertha-723', n: 'St. Bertha of Blangy', t: 's', y: 723, r: 'west', d: 'x', art: { sections: [{ h: 'A', b: 'B' }], quotes: [], links: [] } }] };
  const out = await runJerome({ id: 'task-23', payload: { mode: 'rewrite', entityId: 'st-bertha-723', search: true } }, d2, {}, { ...m.deps, registry: reg, rules: NOPOOL, logPath: _join(dir, 'l.json'), sourcesDir });
  assert.equal(out.result.outcome, 'rewrite_ready');
  assert.ok(out.filesToCommit.includes(_join(sourcesDir, 'st-bertha-723.json')));
  const f = _loadSources('st-bertha-723', sourcesDir);
  assert.deepEqual([f.entryId, f.mode, f.subject.name], ['st-bertha-723', 'rewrite', 'St. Bertha of Blangy']);
});

test('runJerome: a layer-1 answer (no search) saves no sources file', async () => {
  const dir = _mk(_join(_tmp(), 'rs4-')), sourcesDir = _join(dir, 'sources');
  const out = await runJerome({ id: 'task-24', payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', search: false } }, data, {}, { rules: NOPOOL, logPath: _join(dir, 'l.json'), sourcesDir });
  assert.equal(out.filesToCommit.some(p => p.includes('sources')), false);
  assert.equal(existsSync(sourcesDir), false);
});

test('recordSources: never throws; an id that cannot be a file name is reported instead', () => {
  const r = recordSources({ result: { subject: { id: '../../evil', name: 'x' }, mode: 'new', layer3: { status: 'ready', selection: { selected: [], alsoFound: [] } } }, task: {}, dir: _join(_mk(_join(_tmp(), 'rs5-')), 's'), registry: reg });
  assert.match(r.skipped, /not a valid entry id/);
  assert.equal(recordSources({ result: {}, task: {} }).skipped, 'no search was run');
  assert.equal(recordSources({ result: null, task: {} }).skipped, 'no search was run');
});

test('the page text kept in memory for the sources file never reaches the JSON result or the compact task result', async () => {
  const m = mocks(lanePages, laneResults);
  const r = await runSourceFinder({ payload: { mode: 'new', name: 'St. Bertha of Blangy', category: 's', year: 723 } }, data, { ...m.deps, rules: NOPOOL });
  assert.ok(!JSON.stringify(r.result).includes('Bertha of Blangy was a widow'));
  assert.ok(r.result.search.sources.every(s => typeof s.plain === 'undefined' || !Object.keys(s).includes('plain')));
});
