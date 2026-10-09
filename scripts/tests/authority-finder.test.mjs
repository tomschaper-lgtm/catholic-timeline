// scripts/tests/authority-finder.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/authority-finder.mjs v0.1 (no network; the model and the fetch are faked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dioceseTokens, countChurchWords, buildPrompt, parseReply, verifySite, suggestedEntry, findAuthority, loadQueue, saveQueue, queueItemsFor, addToQueue } from '../services/authority-finder.mjs';
import { safeUrl, regEntry } from '../services/source-finder.mjs';

const NEVER = ['wikipedia.org', 'facebook.com'];
const REG = { tiers: {}, domains: [{ domain: 'vatican.va', tier: 'approved', enabled: true }, { domain: 'offsite.org', tier: 'official', enabled: false }] };
const helpers = { safeUrl, regEntry, neverHosts: NEVER };
const AKITA = { name: 'Our Lady of Akita', year: 1973, region: 'asia' };
const CHURCH = 'The Catholic Diocese of Niigata. Bishop and priests. Parishes and the cathedral. Mass times. Niigata Diocese news. '.repeat(10);
const reply = o => ({ text: JSON.stringify(o), searches: 2 });
const GOOD = { place: 'Yuzawadai, Akita', country: 'Japan', diocese: 'Roman Catholic Diocese of Niigata', official_site_url: 'https://www.niigata.catholic.example/', alternates: [], confidence: 'high', note: 'found on the bishops\' conference list' };
const pages = map => async url => map[url] || { ok: false, http: 404, text: '', note: 'HTTP 404' };

test('dioceseTokens: the place is what matters; "Roman Catholic Diocese of" is not', () => {
  assert.deepEqual(dioceseTokens('Roman Catholic Diocese of Niigata'), ['niigata']);
  assert.deepEqual(dioceseTokens('Archdiócesis de México'), ['mexico']);
  assert.deepEqual(dioceseTokens('Bistum Münster'), ['munster']);
  assert.deepEqual(dioceseTokens('Diocese of San Juan de los Lagos'), ['juan', 'lagos']);
  assert.deepEqual(dioceseTokens('The Diocese'), []);
});

test('countChurchWords: counts church vocabulary in several languages, ignoring accents and case', () => {
  assert.equal(countChurchWords('Bishop, PARISH and the Cathédrale. La diócesis y el obispo.'), 5);
  assert.equal(countChurchWords('A page about gardening and football.'), 0);
});

test('buildPrompt: names the subject, asks for JSON only, and rules out parishes, news sites and Wikipedia', () => {
  const p = buildPrompt(AKITA, 'Marian apparition');
  assert.match(p, /Our Lady of Akita \(Marian apparition\), about the year 1973, region: asia/);
  assert.match(p, /ONLY this JSON/);
  assert.match(p, /Not a parish, not a news site, not Wikipedia/);
});

test('parseReply: plain JSON, fenced JSON, JSON inside a sentence; bad input throws', () => {
  assert.equal(parseReply(JSON.stringify(GOOD)).diocese, 'Roman Catholic Diocese of Niigata');
  assert.equal(parseReply('```json\n' + JSON.stringify(GOOD) + '\n```').country, 'Japan');
  assert.equal(parseReply('Here you go: ' + JSON.stringify(GOOD) + ' Hope that helps.').place, 'Yuzawadai, Akita');
  assert.throws(() => parseReply('no json here'), /no JSON object/);
  assert.throws(() => parseReply('{ broken'), /no JSON object|not valid JSON/);
  assert.throws(() => parseReply('{ "a": }'), /not valid JSON/);
});

test('parseReply: a null address, odd confidence, too many alternates and non-strings are cleaned up', () => {
  const r = parseReply(JSON.stringify({ diocese: 'D', official_site_url: 'null', alternates: ['https://a.example', 5, '', 'https://b.example', 'https://c.example'], confidence: 'MAYBE', place: 7 }));
  assert.equal(r.official_site_url, '');
  assert.deepEqual(r.alternates, ['https://a.example', 'https://b.example']);
  assert.equal(r.confidence, 'low');
  assert.equal(r.place, '');
});

test('verifySite: passes when the page loads, names the diocese and reads like a church site', async () => {
  const v = await verifySite({ url: 'https://x.example/', diocese: 'Diocese of Niigata', fetchPage: pages({ 'https://x.example/': { ok: true, http: 200, text: CHURCH } }) });
  assert.equal(v.verified, true);
  assert.ok(v.dioceseMentions >= 10 && v.churchWords >= 10);
});

test('verifySite: fails, with the reason, when the page is missing, never names the diocese, or is not churchy', async () => {
  const miss = await verifySite({ url: 'https://x.example/', diocese: 'Diocese of Niigata', fetchPage: pages({}) });
  assert.equal(miss.verified, false);
  assert.equal(miss.http, 404);
  const other = await verifySite({ url: 'https://x.example/', diocese: 'Diocese of Niigata', fetchPage: pages({ 'https://x.example/': { ok: true, http: 200, text: 'Catholic bishop priest parish. '.repeat(20) } }) });
  assert.equal(other.verified, false);
  assert.match(other.note, /never names the diocese \(niigata\)/);
  const shop = await verifySite({ url: 'https://x.example/', diocese: 'Diocese of Niigata', fetchPage: pages({ 'https://x.example/': { ok: true, http: 200, text: 'Niigata rice and sake shop. '.repeat(20) } }) });
  assert.equal(shop.verified, false);
  assert.match(shop.note, /church words/);
  const noName = await verifySite({ url: 'https://x.example/', diocese: 'The Diocese', fetchPage: pages({ 'https://x.example/': { ok: true, http: 200, text: CHURCH } }) });
  assert.equal(noName.verified, false);
});

test('suggestedEntry: has exactly the registry fields, tier official, and does not claim to be approved', () => {
  const e = suggestedEntry({ domain: 'niigata.catholic.example', diocese: 'Diocese of Niigata', subject: AKITA });
  assert.deepEqual(Object.keys(e).sort(), ['domain', 'enabled', 'group', 'limits', 'operator', 'tier', 'useFor', 'why']);
  assert.equal(e.tier, 'official');
  assert.match(e.why, /Our Lady of Akita/);
  assert.equal(e.approvedAt, undefined);
});

test('findAuthority: a new, verified diocese site becomes a candidate with a suggested entry', async () => {
  const a = await findAuthority({ subject: AKITA, label: 'Marian apparition', ask: async () => reply(GOOD), fetchPage: pages({ 'https://www.niigata.catholic.example/': { ok: true, http: 200, text: CHURCH } }), reg: REG, helpers });
  assert.equal(a.found, true);
  assert.equal(a.diocese, 'Roman Catholic Diocese of Niigata');
  assert.equal(a.searches, 2);
  const c = a.candidates[0];
  assert.deepEqual([c.domain, c.role, c.registry, c.verified], ['niigata.catholic.example', 'diocese', 'new', true]);
  assert.equal(c.suggestedEntry.domain, 'niigata.catholic.example');
});

test('findAuthority: sites already approved, switched off, or never allowed are not re-proposed or fetched', async () => {
  let fetched = 0;
  const a = await findAuthority({ subject: AKITA, label: 'x', ask: async () => reply({ ...GOOD, official_site_url: 'https://www.vatican.va/x', alternates: ['https://offsite.org/y', 'https://en.wikipedia.org/wiki/Akita'] }),
    fetchPage: async () => { fetched++; return { ok: true, http: 200, text: CHURCH }; }, reg: REG, helpers });
  assert.deepEqual(a.candidates.map(c => c.registry), ['approved', 'disabled', 'blocked']);
  assert.equal(fetched, 0);
});

test('findAuthority: no address, an unusable address, duplicates and the candidate cap', async () => {
  const none = await findAuthority({ subject: AKITA, label: 'x', ask: async () => reply({ ...GOOD, official_site_url: null }), fetchPage: pages({}), reg: REG, helpers });
  assert.equal(none.found, false);
  const bad = await findAuthority({ subject: AKITA, label: 'x', ask: async () => reply({ ...GOOD, official_site_url: 'http://insecure.example/' }), fetchPage: pages({}), reg: REG, helpers });
  assert.equal(bad.candidates[0].registry, 'blocked');
  assert.match(bad.candidates[0].note, /plain https/);
  const dup = await findAuthority({ subject: AKITA, label: 'x', ask: async () => reply({ ...GOOD, official_site_url: 'https://a.example/', alternates: ['https://www.a.example/other', 'https://b.example/'] }),
    fetchPage: pages({}), reg: REG, helpers, cfg: { maxCandidates: 3 } });
  assert.deepEqual(dup.candidates.map(c => c.domain), ['a.example', 'b.example']);
  const capped = await findAuthority({ subject: AKITA, label: 'x', ask: async () => reply({ ...GOOD, alternates: ['https://b.example/', 'https://c.example/'] }), fetchPage: pages({}), reg: REG, helpers, cfg: { maxCandidates: 1 } });
  assert.equal(capped.candidates.length, 1);
});

test('findAuthority: an unreadable reply is reported, with the searches it cost, and never throws', async () => {
  const a = await findAuthority({ subject: AKITA, label: 'x', ask: async () => ({ text: 'I could not find it.', searches: 2 }), fetchPage: pages({}), reg: REG, helpers });
  assert.equal(a.found, false);
  assert.match(a.error, /no JSON object/);
  assert.equal(a.searches, 2);
});

test('findAuthority: passes the search limit to the model call', async () => {
  let got;
  await findAuthority({ subject: AKITA, label: 'x', ask: async a => { got = a; return reply({ ...GOOD, official_site_url: null }); }, fetchPage: pages({}), reg: REG, helpers, cfg: { maxSearches: 1 } });
  assert.equal(got.maxUses, 1);
  assert.match(got.prompt, /Our Lady of Akita/);
});

// ---- the queue for Ignatius ----
const AU = { diocese: 'Diocese of Niigata', place: 'Akita', country: 'Japan', confidence: 'high', candidates: [
  { url: 'https://niigata.example/', domain: 'niigata.example', role: 'diocese', registry: 'new', verified: true, checks: { http: 200, dioceseMentions: 9, churchWords: 30 }, suggestedEntry: { domain: 'niigata.example' } },
  { url: 'https://www.vatican.va/x', domain: 'vatican.va', role: 'alternate', registry: 'approved' }] };
const CTX = { subject: { name: 'Our Lady of Akita' }, jobId: 'job-1', at: '2026-10-09T17:00:00.000Z' };

test('queueItemsFor: only NEW sites are queued, each waiting, proposed by Jerome, with where they came from', () => {
  const items = queueItemsFor(AU, CTX);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.deepEqual([it.id, it.kind, it.status, it.proposedBy, it.verified], ['site-niigata.example', 'site_approval', 'waiting', 'Jerome', true]);
  assert.deepEqual(it.subjects, [{ name: 'Our Lady of Akita', jobId: 'job-1', at: CTX.at }]);
  assert.deepEqual(queueItemsFor({ found: false }, CTX), []);
  assert.deepEqual(queueItemsFor(null, CTX), []);
});

test('addToQueue: adds new, merges a second subject into a waiting site, leaves decided sites alone', () => {
  const q = { version: 1, items: [] };
  assert.deepEqual(addToQueue(q, queueItemsFor(AU, CTX)), { queue: q, added: 1, merged: 0, skipped: 0 });
  const ctx2 = { subject: { name: 'Our Lady of Fatima' }, jobId: 'job-2', at: '2026-10-10T09:00:00.000Z' };
  const r = addToQueue(q, queueItemsFor(AU, ctx2));
  assert.deepEqual([r.added, r.merged, r.skipped], [0, 1, 0]);
  assert.equal(q.items[0].subjects.length, 2);
  addToQueue(q, queueItemsFor(AU, ctx2));                              // the same subject and job again: no duplicate
  assert.equal(q.items[0].subjects.length, 2);
  q.items[0].status = 'approved';
  const r2 = addToQueue(q, queueItemsFor(AU, { ...CTX, jobId: 'job-3' }));
  assert.deepEqual([r2.added, r2.merged, r2.skipped], [0, 0, 1]);
  assert.equal(q.items[0].subjects.length, 2);
});

test('addToQueue: a waiting site that was unverified becomes verified when a later run confirms it', () => {
  const q = { version: 1, items: [] };
  const weak = JSON.parse(JSON.stringify(AU)); weak.candidates[0].verified = false; weak.candidates[0].note = 'thin page'; weak.candidates[0].checks = { http: 200, dioceseMentions: 0, churchWords: 1 };
  addToQueue(q, queueItemsFor(weak, CTX));
  assert.equal(q.items[0].verified, false);
  addToQueue(q, queueItemsFor(AU, { ...CTX, jobId: 'job-9' }));
  assert.equal(q.items[0].verified, true);
  assert.equal(q.items[0].note, undefined);
});

test('addToQueue: the queue is capped, keeping every waiting item', () => {
  const q = { version: 1, items: [] };
  for (let i = 0; i < 205; i++) q.items.push({ id: 's' + i, status: i < 3 ? 'waiting' : 'approved', subjects: [] });
  addToQueue(q, []);
  const more = addToQueue(q, [{ id: 'new', status: 'waiting', subjects: [{ name: 'x', jobId: 'j', at: 'a' }] }]);
  assert.ok(more.queue.items.length <= 200);
  assert.equal(more.queue.items.filter(x => x.status === 'waiting').length, 4);
});

test('loadQueue / saveQueue: a missing or damaged file is an empty queue; saving makes folders and ends with a newline', () => {
  const d = mkdtempSync(join(tmpdir(), 'aq-'));
  assert.deepEqual(loadQueue(join(d, 'nope.json')), { version: 1, items: [] });
  const p = join(d, 'sub', 'ignatius-queue.json');
  saveQueue({ version: 1, items: [{ id: 'a' }] }, p);
  assert.equal(loadQueue(p).items[0].id, 'a');
});
