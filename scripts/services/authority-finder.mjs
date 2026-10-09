// scripts/services/authority-finder.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.1 — "Which diocese speaks for this?": find the official website of the diocese that judges an
// apparition or miracle, check the page is real, and hand it to IGNATIUS for a decision.
//
// WHY: an apparition's approval status is stated by the bishop (and, since 2024, in agreement with the Dicastery for the Doctrine of the
// Faith) of the diocese where it happened. The sources on the approved list rarely say what the bishop decided; the diocese's own
// website would. But a site that is not on the registry is never trusted automatically.
//
// WHO DECIDES: JEROME ONLY PROPOSES. Jerome asks a model (with web search) to identify the place, the diocese and its official website;
// CODE then fetches the page and checks it (it loads; it names the diocese; it reads like a church site). The result goes into a queue,
// ignatius-queue.json, marked "waiting". IGNATIUS (the judge, NOT BUILT YET) will read the queue, decide whether it is really the
// diocese's own site, and approve or reject it. Nothing in this file edits the registry, and nothing is approved here.
//
// THE QUEUE: { "version": 1, "items": [ { "id": "site-<domain>", "kind": "site_approval", "status": "waiting" | "approved" | "rejected",
//   "domain", "url", "role": "diocese" | "alternate", "diocese", "place", "country", "confidence", "verified", "checks", "note",
//   "suggestedEntry": { registry fields }, "proposedBy": "Jerome", "firstSeen", "subjects": [ { "name", "jobId", "at" } ] } ] }
//   A site already decided (approved or rejected) is never queued again. A site already waiting just gains the new subject.
//
// The model call and the page fetch are passed in (ask, fetchPage), so this file has no network code of its own.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const QUEUE_PATH = process.env.IGNATIUS_QUEUE_PATH || 'ignatius-queue.json';
export const MAX_QUEUE_ITEMS = 200;

const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Words that appear in almost every diocese's name; the rest (the place) is what the page must mention.
const GENERIC = new Set(['the', 'of', 'de', 'di', 'del', 'della', 'da', 'do', 'dos', 'das', 'du', 'des', 'la', 'le', 'el', 'los', 'las', 'and', 'y', 'e', 'et',
  'roman', 'catholic', 'diocese', 'dioceses', 'archdiocese', 'archdiocesan', 'diocesi', 'arcidiocesi', 'diocesis', 'archidiocesis', 'archdiocesis', 'arquidiocesis', 'arquidiocese', 'obispado', 'arzobispado', 'bispado', 'archbishopric', 'eparquia', 'diocese', 'dioceses',
  'bistum', 'erzbistum', 'eparchy', 'archeparchy', 'apostolic', 'vicariate', 'prelature', 'territorial', 'military', 'ordinariate', 'church',
  'holy', 'see', 'saint', 'san', 'santa', 'sao']);

export function dioceseTokens(name) {
  return fold(name).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !GENERIC.has(t));
}

// Words that make a page read like a church institution's site, in the languages the Church's sites most often use.
const CHURCH_WORDS = ['diocese', 'dioceses', 'diocesi', 'diocesis', 'archdiocese', 'bishop', 'bishops', 'archbishop', 'parish', 'parishes', 'catholic',
  'catholique', 'cattolica', 'catolica', 'catolico', 'bistum', 'bispo', 'obispo', 'vescovo', 'eveque', 'priest', 'priests', 'clergy', 'cathedral',
  'cathedrale', 'cattedrale', 'catedral', 'kirche', 'eglise', 'chiesa', 'iglesia', 'igreja', 'mass', 'sacrament', 'sacraments'];
const CHURCH_RE = new RegExp('\\b(' + CHURCH_WORDS.join('|') + ')\\b', 'g');

export function countChurchWords(text) { return (fold(text).match(CHURCH_RE) || []).length; }

export function buildPrompt(subject, label) {
  return 'You are helping a Catholic history website find the OFFICIAL website of the Catholic diocese (or archdiocese, eparchy or equivalent) whose ' +
    'bishop judges the following, because that bishop\'s own statement is the authority for its approval status.\n\n' +
    'Subject: ' + subject.name + ' (' + label + ')' + (subject.year != null ? ', about the year ' + subject.year : '') +
    (subject.region ? ', region: ' + subject.region : '') + '.\n\n' +
    'Use the search tool. Find the place where it happened, the diocese that covers that place (if the diocese changed since, the one that made the ' +
    'judgement), and that diocese\'s OWN official website. Not a parish, not a news site, not Wikipedia, not a pilgrimage blog or a private site.\n\n' +
    'Reply with ONLY this JSON and nothing else: {"place": "...", "country": "...", "diocese": "full name of the diocese", ' +
    '"official_site_url": "https://... or null if you could not find it", "alternates": ["at most 2 other OFFICIAL https addresses, such as the ' +
    'bishops\' conference or the shrine\'s own site, or an empty list"], "confidence": "high|medium|low", "note": "one short line"}';
}

// Pull the JSON object out of a model reply (it may arrive in a code fence or with a sentence around it).
export function parseReply(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('the reply had no JSON object');
  let o;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('the reply was not valid JSON'); }
  const str = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : '');
  const conf = ['high', 'medium', 'low'].includes(String(o.confidence).toLowerCase()) ? String(o.confidence).toLowerCase() : 'low';
  return {
    place: str(o.place), country: str(o.country), diocese: str(o.diocese),
    official_site_url: str(o.official_site_url) && !/^null$/i.test(str(o.official_site_url)) ? str(o.official_site_url) : '',
    alternates: Array.isArray(o.alternates) ? o.alternates.map(str).filter(Boolean).slice(0, 2) : [],
    confidence: conf, note: str(o.note)
  };
}

// Fetch the page and check it: it loads, it names the diocese's place, and it reads like a church site.
export async function verifySite({ url, diocese, fetchPage }) {
  const f = await fetchPage(url);
  if (!f || !f.ok) return { verified: false, http: f ? f.http : 0, dioceseMentions: 0, churchWords: 0, note: (f && f.note) || 'could not be fetched' };
  const text = fold(f.text);
  const toks = dioceseTokens(diocese);
  const dioceseMentions = toks.reduce((n, t) => n + (text.match(new RegExp('\\b' + t + '\\b', 'g')) || []).length, 0);
  const churchWords = countChurchWords(f.text);
  const problems = [];
  if (!toks.length) problems.push('the diocese name has no distinctive word to look for');
  else if (dioceseMentions < 1) problems.push('the page never names the diocese (' + toks.join(', ') + ')');
  if (churchWords < 3) problems.push('the page has only ' + churchWords + ' church words');
  return { verified: problems.length === 0, http: f.http, dioceseMentions, churchWords, ...(problems.length ? { note: problems.join('; ') } : {}) };
}

// The registry fields Ignatius would add if he approves. Never written by this file.
export function suggestedEntry({ domain, diocese, subject }) {
  return {
    domain, tier: 'official', enabled: true, group: '-', operator: diocese || domain,
    why: 'The diocese\'s own website: the body whose bishop judges ' + subject.name + ' in its territory, speaking about itself.',
    useFor: 'Its own decisions, decrees, statements and history about ' + subject.name + ' and its diocese.',
    limits: 'An institution speaking about itself: authoritative for its own decisions, not independent confirmation, and no use for general history or for other dioceses.'
  };
}

// Ask, check, and report. helpers: { safeUrl, regEntry, neverHosts }. cfg: { maxSearches, maxCandidates }.
export async function findAuthority({ subject, label, ask, fetchPage, reg, helpers, cfg = {} }) {
  const reply = await ask({ prompt: buildPrompt(subject, label), maxUses: cfg.maxSearches || 2 });
  const searches = (reply && reply.searches) || 0;
  let r;
  try { r = parseReply(reply && reply.text); } catch (e) { return { found: false, error: e.message, searches }; }
  const urls = [r.official_site_url, ...r.alternates].filter(Boolean).slice(0, cfg.maxCandidates || 3);
  const seen = new Set();
  const candidates = [];
  for (let i = 0; i < urls.length; i++) {
    const url = helpers.safeUrl(urls[i]);
    if (!url) { candidates.push({ url: urls[i], domain: '', role: i === 0 ? 'diocese' : 'alternate', registry: 'blocked', note: 'not a plain https address on a real host' }); continue; }
    const host = new URL(url).hostname.toLowerCase();
    const domain = host.replace(/^www\./, '');
    if (seen.has(domain)) continue;
    seen.add(domain);
    const role = i === 0 ? 'diocese' : 'alternate';
    if (helpers.neverHosts.some(d => host === d || host.endsWith('.' + d))) { candidates.push({ url, domain, role, registry: 'blocked', note: 'a never-allowed kind of site' }); continue; }
    const e = helpers.regEntry(reg, host);
    if (e) { candidates.push({ url, domain, role, registry: e.enabled === false ? 'disabled' : 'approved', ...(e.tier ? { tier: e.tier } : {}) }); continue; }
    const v = await verifySite({ url, diocese: r.diocese, fetchPage });
    candidates.push({ url, domain, role, registry: 'new', verified: v.verified,
      checks: { http: v.http, dioceseMentions: v.dioceseMentions, churchWords: v.churchWords }, ...(v.note ? { note: v.note } : {}),
      suggestedEntry: suggestedEntry({ domain, diocese: r.diocese, subject }) });
  }
  return { found: candidates.length > 0, place: r.place, country: r.country, diocese: r.diocese, confidence: r.confidence, ...(r.note ? { note: r.note } : {}), candidates, searches };
}

// ---- the queue for Ignatius ----
export function loadQueue(path = QUEUE_PATH) {
  try { const q = JSON.parse(readFileSync(path, 'utf8')); if (q && Array.isArray(q.items)) return q; } catch (_e) { /* start fresh */ }
  return { version: 1, items: [] };
}
export function saveQueue(q, path = QUEUE_PATH) { mkdirSync(dirname(path) || '.', { recursive: true }); writeFileSync(path, JSON.stringify(q, null, 1) + '\n'); }

// Items for the NEW sites in an authority result. ctx: { subject: { name }, jobId, at }.
export function queueItemsFor(authority, ctx) {
  if (!authority || !authority.candidates) return [];
  return authority.candidates.filter(c => c.registry === 'new').map(c => ({
    id: 'site-' + c.domain, kind: 'site_approval', status: 'waiting', domain: c.domain, url: c.url, role: c.role,
    diocese: authority.diocese, place: authority.place, country: authority.country, confidence: authority.confidence,
    verified: !!c.verified, checks: c.checks, ...(c.note ? { note: c.note } : {}), suggestedEntry: c.suggestedEntry, proposedBy: 'Jerome',
    firstSeen: ctx.at, subjects: [{ name: ctx.subject.name, jobId: ctx.jobId, at: ctx.at }]
  }));
}

// Add items. A site Ignatius has already decided is left alone; a site already waiting only gains the new subject.
export function addToQueue(queue, items) {
  let added = 0, merged = 0, skipped = 0;
  for (const it of items) {
    const ex = queue.items.find(x => x.id === it.id);
    if (!ex) { queue.items.push(it); added++; continue; }
    if (ex.status !== 'waiting') { skipped++; continue; }
    for (const s of it.subjects) if (!ex.subjects.some(y => y.name === s.name && y.jobId === s.jobId)) ex.subjects.push(s);
    if (it.verified && !ex.verified) { ex.verified = true; ex.checks = it.checks; delete ex.note; }
    merged++;
  }
  if (queue.items.length > MAX_QUEUE_ITEMS) {
    const waiting = queue.items.filter(x => x.status === 'waiting'), decided = queue.items.filter(x => x.status !== 'waiting');
    queue.items = [...decided.slice(-(MAX_QUEUE_ITEMS - waiting.length > 0 ? MAX_QUEUE_ITEMS - waiting.length : 0)), ...waiting];
  }
  return { queue, added, merged, skipped };
}
