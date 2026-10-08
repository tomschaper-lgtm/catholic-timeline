// scripts/tests/source-finder.test.mjs
// MODULE DATE: 2026-10-08 (Thursday) · tests for source-finder.mjs v0.3 (v0.4: layers 1, 2 and 3; layer 2 with MOCKED search/fetch; layer 3 uses the real scripts/category-rules.json).
// Run: node --test scripts/tests/source-finder.test.mjs
// Synthetic tests always run. Real-data tests run only if DATA_PATH (or ./data.json) exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fold, scoreMatch, checkExistence, findSubject, runSourceFinder, findSources, safeUrl, allowedDomains, examine, assess, loadRules, evidence } from '../services/source-finder.mjs';
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
function src({ domain = 'newadvent.org', words = 1200, text = '', status = 'approved', canVerify = true, usable = true, mentions = 10 } = {}) {
  const o = { url: 'https://www.' + domain + '/x', domain: 'www.' + domain, status, canVerify, usable, words, mentions };
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
  assert.deepEqual(r.flags, ['single_source', 'thin_material']);   // 1,200 words is ready, but under the 4,000-word target
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

test('saint: ancient veneration counts only for a subject within the year limit', () => {
  const t = 'bertha is named in the roman martyrology.';
  const old = assess(bertha({ year: 304 }), found(src({ text: t })), RULES);
  assert.equal(old.status, 'ready');
  assert.equal(old.verdict.basis, 'ancient_veneration');
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
