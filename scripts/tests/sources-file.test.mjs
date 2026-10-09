// scripts/tests/sources-file.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/sources-file.mjs v0.1 (temporary folders; no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashText, safeId, entryIdFor, sourcesPath, buildSourcesFile, writeSourcesFile, loadSources, getSourceTexts } from '../services/sources-file.mjs';

const AT = new Date('2026-10-09T18:00:00.000Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'sf-'));

// A raw source-finder result: the per-page records carry the page text in memory only (non-enumerable), as examine() makes them.
function page(url, domain, o = {}) {
  const x = { url, domain, title: o.title || 'T ' + domain, words: o.words || 1000, mentions: o.mentions || 9, fetchedAt: '2026-10-09T17:59:00.000Z', hash: o.hash || hashText(o.plain || 'x'), usable: true };
  Object.defineProperty(x, 'plain', { value: o.plain || 'Original Case Text.', enumerable: false });
  Object.defineProperty(x, 'text', { value: 'folded lowercase text', enumerable: false });
  return x;
}
const sel = (url, domain, o = {}) => ({ url, domain, tier: o.tier || 'approved', lane: o.lane || null, canVerify: o.canVerify !== false, words: o.words || 1000, mentions: o.mentions || 9, score: o.score || 50 });
function result(extra = {}) {
  const pages = [page('https://www.newadvent.org/cathen/a.htm', 'www.newadvent.org', { plain: 'The Saint was born in Tagaste.', words: 6000 }), page('https://www.ewtn.com/x', 'www.ewtn.com', { plain: 'EWTN page text.', words: 6500 }),
    page('https://bible.usccb.org/bible/luke/1', 'bible.usccb.org', { plain: 'SCRIPTURE VERSE TEXT', words: 300 }), page('https://kofc.org/y', 'kofc.org', { words: 800 })];
  return { outcome: 'new_subject', mode: 'new', subject: { name: 'St. Bertha of Blangy', category: 's', year: 723 },
    search: { sources: pages }, timing: { model: 'claude-haiku-5-5' },
    layer3: { status: 'ready', reason: undefined, flags: ['single_source'], verdict: { action: 'accept', basis: 'ancient_veneration', reasons: [] },
      perspectives: { covered: [{ id: 'history_biography' }, { id: 'magisterial' }], missing: ['primary_texts'] },
      decisions: [{ kind: 'unjudged_sources', urls: ['https://kofc.org/y', 'https://nowhere.example/z'] }],
      selection: { selected: [sel('https://www.newadvent.org/cathen/a.htm', 'www.newadvent.org', { lane: 'history_biography', words: 6000 }), sel('https://www.ewtn.com/x', 'www.ewtn.com', { lane: 'magisterial', words: 6500 }),
        sel('https://bible.usccb.org/bible/luke/1', 'bible.usccb.org', { tier: 'scripture', words: 300 })],
        alsoFound: [{ url: 'https://www.vatican.va/q', domain: 'www.vatican.va', lane: null, words: 400, score: 20 }] } },
    ...extra };
}
const storageOf = d => (d === 'www.newadvent.org' || d === 'bible.usccb.org' ? 'full' : 'excerpts');

test('hashText: the first 16 hex characters of the SHA-256, the same fingerprint Jerome puts on a page', () => {
  assert.equal(hashText('abc'), 'ba7816bf8f01cfea');
  assert.equal(hashText('abc').length, 16);
});

test('safeId: only plain ids can become file names', () => {
  assert.equal(safeId('st-augustine-430'), 'st-augustine-430');
  for (const bad of ['', '../x', 'a/b', 'A-b', 'a b', '-a', 'a.json', null, undefined, 'x'.repeat(200)]) assert.throws(() => safeId(bad), /not a valid entry id/, String(bad));
});

test('entryIdFor: the timeline id for an existing entry; slug of the name plus the year for a new subject', () => {
  assert.equal(entryIdFor({ id: 'st-augustine-430', name: 'whatever' }), 'st-augustine-430');
  assert.equal(entryIdFor({ name: 'St. Bertha of Blangy', year: 723 }), 'st-bertha-of-blangy-723');
  assert.equal(entryIdFor({ name: 'Council of Nicaea' }), 'council-of-nicaea');
  assert.equal(entryIdFor({ name: 'Our Lady of Akita', year: 1973 }), 'our-lady-of-akita-1973');
  assert.throws(() => entryIdFor({ year: 5 }), /without a name/);
  assert.throws(() => entryIdFor({ name: '???' }), /without a name/);
  assert.throws(() => entryIdFor({ id: '../../etc' }), /not a valid entry id/);
});

test('sourcesPath: inside the folder, with the id as the file name', () => {
  assert.equal(sourcesPath('st-augustine-430', 'sources'), join('sources', 'st-augustine-430.json'));
  assert.throws(() => sourcesPath('../x'), /not a valid entry id/);
});

test('buildSourcesFile: a manifest line for every chosen page, ranked, with totals, flags, verdict and where it came from', () => {
  const f = buildSourcesFile(result(), { task: { id: 'task-5', payload: {} }, now: AT, finder: 'source-finder v0.9.7', storageOf });
  assert.deepEqual([f.version, f.entryId, f.mode, f.outcome, f.jobId, f.model, f.builtAt], [1, 'st-bertha-of-blangy-723', 'new', 'ready', 'task-5', 'claude-haiku-5-5', '2026-10-09T18:00:00.000Z']);
  assert.deepEqual(f.subject, { name: 'St. Bertha of Blangy', category: 's', year: 723 });
  assert.deepEqual(f.sources.map(s => [s.n, s.domain, s.lane, s.tier, s.words]), [[1, 'newadvent.org', 'history_biography', 'approved', 6000], [2, 'ewtn.com', 'magisterial', 'approved', 6500], [3, 'bible.usccb.org', null, 'scripture', 300]]);
  assert.equal(f.totalWords, 12800);
  assert.deepEqual(f.sources[0].hash, hashText('The Saint was born in Tagaste.'));
  assert.equal(f.sources[0].fetchedAt, '2026-10-09T17:59:00.000Z');
  assert.deepEqual(f.flags, ['single_source']);
  assert.deepEqual(f.verdict, { action: 'accept', basis: 'ancient_veneration', reasons: [] });
  assert.deepEqual(f.perspectives, { covered: ['history_biography', 'magisterial'], missing: ['primary_texts'] });
  assert.deepEqual(f.alsoFound, [{ url: 'https://www.vatican.va/q', domain: 'vatican.va', lane: null, words: 400, score: 20 }]);
});

test('buildSourcesFile: full text only for a source set to "full", never for Scripture, and never the folded lowercase text', () => {
  const f = buildSourcesFile(result(), { now: AT, storageOf });
  assert.deepEqual(f.sources.map(s => s.storage), ['full', 'excerpts', 'excerpts']);                // scripture is "full" in the registry here, and is still refused
  assert.equal(f.sources[0].text, 'The Saint was born in Tagaste.');                               // original case and punctuation
  assert.equal(f.sources[1].text, undefined);
  assert.equal(f.sources[2].text, undefined);
  const json = JSON.stringify(f);
  assert.ok(!json.includes('SCRIPTURE VERSE TEXT') && !json.includes('EWTN page text.') && !json.includes('folded lowercase'));
  const none = buildSourcesFile(result(), { now: AT });                                              // no storage rule at all: everything is excerpts
  assert.ok(none.sources.every(s => s.storage === 'excerpts' && s.text === undefined));
});

test('buildSourcesFile: pages that could make it enough but are not approved are listed as unsure, with no text', () => {
  const f = buildSourcesFile(result(), { now: AT, storageOf });
  assert.deepEqual(f.unsure, [{ url: 'https://kofc.org/y', domain: 'kofc.org', words: 800, mentions: 9 }]);
});

test('buildSourcesFile: a rewrite uses the timeline id; the apparition lookup is kept in short form', () => {
  const r = result({ mode: 'rewrite', subject: { id: 'our-lady-of-akita-1973', name: 'Our Lady of Akita', category: 'm', year: 1973 },
    authority: { found: true, diocese: 'Diocese of Niigata', place: 'Akita', country: 'Japan', candidates: [{ domain: 'n.example', role: 'diocese', registry: 'new', verified: true, url: 'https://n.example/', suggestedEntry: { domain: 'n.example' } }] } });
  const f = buildSourcesFile(r, { now: AT, storageOf });
  assert.deepEqual([f.entryId, f.mode], ['our-lady-of-akita-1973', 'rewrite']);
  assert.deepEqual(f.authority, { diocese: 'Diocese of Niigata', place: 'Akita', country: 'Japan', candidates: [{ domain: 'n.example', role: 'diocese', registry: 'new', verified: true }] });
});

test('buildSourcesFile: carries the reason and verdict advice when the material is thin', () => {
  const r = result();
  r.layer3.status = 'needs_decision'; r.layer3.reason = 'approved sources alone are too thin (656 of 1000 words)';
  r.layer3.verdict = { action: 'review', basis: null, reasons: [{ kind: 'basis', text: 'not canonized' }], advisory: [{ kind: 'basis', text: 'x' }] };
  const f = buildSourcesFile(r, { now: AT, storageOf });
  assert.deepEqual([f.outcome, f.reason], ['needs_decision', 'approved sources alone are too thin (656 of 1000 words)']);
  assert.equal(f.verdict.reasons[0].text, 'not canonized');
  assert.equal(f.verdict.advisory[0].text, 'x');
});

test('buildSourcesFile: refuses a result with no selection (no search was run)', () => {
  assert.throws(() => buildSourcesFile({ outcome: 'exists', subject: { name: 'x' } }, {}), /no selection to save/);
  assert.throws(() => buildSourcesFile(null, {}), /no selection to save/);
});

test('write and load: a round trip that ends with a newline; a missing file is null; a file that is not version 1 is refused', () => {
  const dir = tmp();
  const f = buildSourcesFile(result(), { now: AT, storageOf });
  const path = writeSourcesFile(f, join(dir, 'sources'));
  assert.equal(path, join(dir, 'sources', 'st-bertha-of-blangy-723.json'));
  assert.ok(readFileSync(path, 'utf8').endsWith('\n'));
  assert.deepEqual(loadSources('st-bertha-of-blangy-723', join(dir, 'sources')), JSON.parse(JSON.stringify(f)));
  assert.equal(loadSources('nobody-1', join(dir, 'sources')), null);
  writeFileSync(join(dir, 'sources', 'old-1.json'), JSON.stringify({ version: 2, sources: [] }));
  assert.throws(() => loadSources('old-1', join(dir, 'sources')), /not version 1/);
});

const fetchOf = map => async url => map[url] || { ok: false, http: 404, text: '', note: 'HTTP 404' };

test('getSourceTexts: stored text is used as it is; other pages are fetched again and compared with the hash', async () => {
  const f = buildSourcesFile(result(), { now: AT, storageOf });
  f.sources = f.sources.slice(0, 2);
  const same = await getSourceTexts(f, { fetchPage: fetchOf({ 'https://www.ewtn.com/x': { ok: true, text: 'EWTN page text.' } }) });
  assert.deepEqual(same.map(t => [t.n, t.drift]), [[1, 'stored'], [2, 'same']]);
  assert.equal(same[0].text, 'The Saint was born in Tagaste.');
  assert.equal(same[1].note, undefined);
  const changed = await getSourceTexts(f, { fetchPage: fetchOf({ 'https://www.ewtn.com/x': { ok: true, text: 'EWTN page text. And more.' } }) });
  assert.equal(changed[1].drift, 'changed');
  assert.equal(changed[1].text, 'EWTN page text. And more.');                                       // a changed page is still returned: the web moves
  assert.match(changed[1].note, /differs from the one Jerome chose \(6500 words then, about 5 now\)/);
});

test('getSourceTexts: a page that still matches its hash is "same"; one that cannot be fetched is "unavailable" with no text; a throwing fetch is handled', async () => {
  const f = { version: 1, sources: [
    { n: 1, url: 'https://a.example/', domain: 'a.example', hash: hashText('same text here'), words: 3, storage: 'excerpts' },
    { n: 2, url: 'https://b.example/', domain: 'b.example', hash: 'x', words: 5, storage: 'excerpts' },
    { n: 3, url: 'https://c.example/', domain: 'c.example', hash: 'y', words: 5, storage: 'excerpts' }] };
  const t = await getSourceTexts(f, { fetchPage: async url => { if (url.includes('a.example')) return { ok: true, text: 'same text here' }; if (url.includes('c.example')) throw new Error('network down'); return { ok: false, http: 404, note: 'HTTP 404' }; } });
  assert.deepEqual(t.map(x => x.drift), ['same', 'unavailable', 'unavailable']);
  assert.equal(t[0].note, undefined);
  assert.deepEqual([t[1].text, t[1].note, t[2].note], ['', 'HTTP 404', 'network down']);
});
