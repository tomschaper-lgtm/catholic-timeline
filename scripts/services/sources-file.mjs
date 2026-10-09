// scripts/services/sources-file.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.1 — sources/<entry-id>.json: what Jerome hands to the writer (Augustine) and the verifier (Thomas).
//
// WHY: Jerome's work was only visible in a log and in a task result. The rest of the pipeline needs the same four pages, by name, per entry.
// This is the interface between Jerome and everything after him. It follows the storage rules decided on 2026-10-07 (design doc, sections 9-10):
//   - ONE FILE PER ENTRY: sources/<entry-id>.json (the id is the timeline's own id, e.g. st-augustine-430; for a new subject, slug of name + year).
//   - EVERY selected page gets a manifest line: url, title, domain, tier, lane, words, hash, when it was fetched, and how it ranked.
//   - FULL TEXT IS STORED ONLY WHERE TOM HAS SET THE REGISTRY ENTRY'S "storage" TO "full" (public domain, e.g. newadvent.org, ccel.org). The default is
//     "excerpts": no text in the file, and whoever needs the page (Augustine, Thomas) fetches it again, which is free, and checks the hash.
//     Scripture is NEVER stored whatever the setting says.
//   - Pages that could make the material enough but are not approved yet are listed as "unsure" (a manifest only) for Ignatius.
//
// FILE (version 1):
//   { version, entryId, mode: "new" | "rewrite", subject: { name, category, year }, builtAt, finder, jobId, model,
//     outcome: "ready" | "needs_decision" | "too_thin" | "not_found",   reason, flags[],
//     verdict: { action, basis, reasons[], advisory[] }, perspectives: { covered[], missing[] }, authority?: { diocese, place, country, candidates[] },
//     totalWords,                                  words in the selected pages
//     sources: [ { n, url, title, domain, tier, lane, canVerify, status: "approved", fetchedAt, words, mentions, score, hash, storage, text? } ],
//     unsure:  [ { url, domain, words, mentions } ],
//     alsoFound: [ { url, domain, lane, words, score } ] }
//
// READING IT: getSourceTexts(file, { fetchPage }) returns each source's text (stored, or fetched again) with a drift note when a fetched page no
// longer matches its hash. A page that has changed is still returned, flagged "changed", because the web moves; one that cannot be fetched is
// flagged "unavailable" and carries no text, so the caller can stop instead of writing from nothing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

export const SOURCES_DIR = process.env.SOURCES_DIR || 'sources';

// The same fingerprint Jerome puts on a fetched page: the first 16 hex characters of the SHA-256 of its cleaned text.
export const hashText = text => createHash('sha256').update(String(text)).digest('hex').slice(0, 16);

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// An id safe to use as a file name. Throws on anything else, so a bad id can never reach outside the folder.
export function safeId(id) {
  const s = String(id || '');
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(s)) throw new Error('not a valid entry id for a sources file: "' + s.slice(0, 60) + '"');
  return s;
}

// The timeline's own id for an existing entry, or slug(name)-year for a new subject (the app's rule).
export function entryIdFor(subject) {
  if (subject && subject.id) return safeId(subject.id);
  const base = slug(subject && subject.name);
  if (!base) throw new Error('cannot make an entry id without a name');
  return safeId(subject.year != null ? base + '-' + subject.year : base);
}

export const sourcesPath = (id, dir = SOURCES_DIR) => join(dir, safeId(id) + '.json');

// storageOf(domain, tier) -> "full" | "excerpts". Scripture never, whatever the setting.
function storageFor(src, storageOf) {
  if (src.tier === 'scripture') return 'excerpts';
  return storageOf && storageOf(src.domain) === 'full' ? 'full' : 'excerpts';
}

// Build the file from a RAW source-finder result (the one that still carries the per-page records, and, in memory only, each page's text).
// opts: { task, now, finder, storageOf(domain) }
export function buildSourcesFile(result, opts = {}) {
  const L3 = result && result.layer3;
  if (!L3 || !L3.selection) throw new Error('this result has no selection to save (no search was run)');
  const task = opts.task || {};
  const p = task.payload || {};
  const subject = result.subject || {};
  const byUrl = new Map(((result.search && result.search.sources) || []).map(s => [s.url, s]));
  const sel = L3.selection.selected || [];
  const sources = sel.map((x, i) => {
    const raw = byUrl.get(x.url) || {};
    const storage = storageFor({ domain: raw.domain || x.domain, tier: x.tier }, opts.storageOf);
    const s = { n: i + 1, url: x.url, title: raw.title || x.title || '', domain: String(x.domain || raw.domain || '').replace(/^www\./, ''), tier: x.tier || null, lane: x.lane || null,
      canVerify: !!x.canVerify, status: 'approved', fetchedAt: raw.fetchedAt || null, words: x.words, mentions: x.mentions, score: x.score, hash: raw.hash || null, storage };
    if (storage === 'full' && raw.plain) s.text = raw.plain;
    return s;
  });
  const unsure = ((L3.decisions || []).find(d => d.kind === 'unjudged_sources') || { urls: [] }).urls
    .map(u => byUrl.get(u)).filter(Boolean).map(r => ({ url: r.url, domain: String(r.domain || '').replace(/^www\./, ''), words: r.words, mentions: r.mentions }));
  const a = result.authority;
  const file = {
    version: 1,
    entryId: entryIdFor({ id: subject.id, name: subject.name || p.name, year: subject.year != null ? subject.year : p.year }),
    mode: result.mode === 'rewrite' ? 'rewrite' : 'new',
    subject: { name: subject.name || p.name || null, category: subject.category || p.category || null, year: subject.year != null ? subject.year : (p.year != null ? p.year : null) },
    builtAt: (opts.now || new Date()).toISOString(), finder: opts.finder || 'source-finder', jobId: opts.jobId || p.jobId || task.id || null,
    model: (result.timing && result.timing.model) || null,
    outcome: L3.status, ...(L3.reason ? { reason: L3.reason } : {}), flags: L3.flags || [],
    verdict: L3.verdict ? { action: L3.verdict.action, basis: L3.verdict.basis || null, reasons: L3.verdict.reasons || [], ...(L3.verdict.advisory ? { advisory: L3.verdict.advisory } : {}) } : null,
    ...(L3.perspectives ? { perspectives: { covered: L3.perspectives.covered.map(c => c.id), missing: L3.perspectives.missing } } : {}),
    ...(a && a.found ? { authority: { diocese: a.diocese, place: a.place, country: a.country, candidates: a.candidates.map(c => ({ domain: c.domain, role: c.role, registry: c.registry, ...(c.verified != null ? { verified: c.verified } : {}) })) } } : {}),
    totalWords: sources.reduce((n, s) => n + (s.words || 0), 0),
    sources, unsure,
    alsoFound: (L3.selection.alsoFound || []).map(x => ({ url: x.url, domain: String(x.domain || '').replace(/^www\./, ''), lane: x.lane || null, words: x.words, score: x.score }))
  };
  return file;
}

export function writeSourcesFile(file, dir = SOURCES_DIR) {
  const path = sourcesPath(file.entryId, dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 1) + '\n');
  return path;
}

export function loadSources(id, dir = SOURCES_DIR) {
  const path = sourcesPath(id, dir);
  if (!existsSync(path)) return null;
  const f = JSON.parse(readFileSync(path, 'utf8'));
  if (!f || f.version !== 1 || !Array.isArray(f.sources)) throw new Error('sources file ' + path + ' is not version 1');
  return f;
}

// The text of each source: stored, or fetched again with a drift note. fetchPage(url) -> { ok, text, http, note }.
export async function getSourceTexts(file, { fetchPage }) {
  const out = [];
  for (const s of file.sources) {
    const base = { n: s.n, url: s.url, domain: s.domain, tier: s.tier, lane: s.lane, canVerify: s.canVerify };
    if (typeof s.text === 'string' && s.text) { out.push({ ...base, text: s.text, drift: 'stored' }); continue; }
    let f;
    try { f = await fetchPage(s.url); } catch (e) { f = { ok: false, note: String((e && e.message) || e).slice(0, 120) }; }
    if (!f || !f.ok || !f.text) { out.push({ ...base, text: '', drift: 'unavailable', note: (f && f.note) || 'could not be fetched' }); continue; }
    const same = s.hash && hashText(f.text) === s.hash;
    const words = f.text.split(/\s+/).filter(Boolean).length;
    out.push({ ...base, text: f.text, drift: same ? 'same' : 'changed', ...(same ? {} : { note: 'the page differs from the one Jerome chose (' + (s.words || '?') + ' words then, about ' + words + ' now)' }) });
  }
  return out;
}
