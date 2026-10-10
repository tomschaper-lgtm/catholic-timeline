// scripts/services/article-writer.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.2 — "Augustine": writes ONE draft article from the pages Jerome saved, and nothing else.
//
// Service "article-write". It never touches data.json. It writes drafts/<entry-id>.json, which Thomas (ledger-build) checks next, then the recorder
// (Kokoro), and which Tom approves by listening and reading the review notes. Nothing goes live until he approves.
//
// TASK SHAPE:  { id, type: 'article-write', entityId: '<existing entry id>' }                          (a rewrite)
//              { id, type: 'article-write', payload: { name, category, year } }                        (a new subject)
//   payload: { model: 'claude-sonnet-5-5' (default), length: 'major'|'standard'|'lesser' (default: from the entry's tier, lowered if the sources are thin),
//              override: false (true = write even though Jerome's outcome was not "ready"; a person has decided), jobId }
//
// WHAT IT DOES
//   1. Reads sources/<entry-id>.json (Jerome's handoff) and gets each page's text (stored, or fetched again). A page that cannot be fetched is left out;
//      too little left, or Jerome's outcome not "ready" (needs_decision, too_thin, not_found) and no override, and it stops with the reason: no draft.
//   2. Asks the model (Anthropic) to write the article from those pages ONLY, following scripts/writer-rules.md (an excerpt of the authoring skill) and the
//      words rationed in scripts/writer-style.json. When sources disagree he PICKS THE WINNER (higher-ranked tier first) and writes a review note naming both
//      versions and why: Tom's decision of 2026-10-09 ("pick the winner but add a note to review and I will look at it and make a final decision").
//   3. CODE checks the result (article-checks.mjs): sentence length, length tier, dates, quotations word for word in a source, Quick Fact labels, rationed words,
//      HTML. Anything wrong goes back to the model with the reason, up to 3 attempts. After the last attempt the draft is saved anyway, marked as still failing,
//      so a person sees it rather than losing it.
//   4. CODE builds the links (the pages he was given, in rank order; never a URL from the model), adds a review note for Jerome's own warnings, and for
//      apparitions and miracles always adds an "approval" note (a person must set the approval level).
//   5. Writes the draft, a step list in article-log.json (tokens per attempt, so cost is measured), and returns both to commit.
//
// AGE AT DEATH (v0.2, Tom 2026-10-09): for a saint or other person the reader wants to know whether he died old or young, so an age is given even when a date is
// a little fuzzy ("died at about seventy-five"). The model does NO arithmetic: he writes the Born and Died facts as the sources give them, and writes the marker
// [[AGE]] once where the age belongs in the story of the death. CODE (lifespan.mjs) computes the age (exact only from two full dates; otherwise estimated from the
// years, a range or "c." giving the midpoint; no age when the dates are more than 6 years apart or the birth year is unknown), puts it on the Died fact, and
// replaces the marker with "at the age of N" or "at about N" (or removes it when there is no age). A computed age is not a sourced claim: Thomas must not look
// for it in the sources.
//
// SOURCE FEEDBACK (v0.2, groundwork for the efficiency phase Tom described): the model also says whether the sources were too little, about right or too much, which
// he used, what gaps he saw and what would have helped. It is stored in the draft as `sourceFeedback`, with `sourceStats` (words, tier and used or not for each
// source), so after a pilot there is real evidence for trimming what he is sent. It never appears in the article and changes nothing yet.
//
// The model never grades itself: Thomas checks every claim afterwards, against the same pages, on different models.
//
// DRAFT FILE drafts/<entry-id>.json (version 1):
//   { version, entryId, mode: 'new'|'rewrite', status: 'draft' | 'needs_work', subject: { name, category, year }, builtAt,
//     writer: { role: 'Augustine', model, attempts, maxAttempts }, sourcesFile: { file, jobId, builtAt, outcome, pages, words, dropped, changed },
//     length: { tier, min, max },
//     entry: { id, y, n, t, r, country, alt: [], d, art: { sections: [{ h, b }], quotes: [{ text, source }], links: [{ label, url }] }, facts: [{ label, value }] },
//     reviewNotes: [ { kind: 'conflict'|'tradition'|'thin'|'approval'|'sources'|'form'|'other', note?, claim?, chosen?: { text, source }, other?: { text, source }, why? } ],
//     flaggedWords: [ plain words likely to trip the voice; NO suggested pronunciation ],
//     checks: { passed, violations: [{ rule, text }], stats }, attemptLog: [ { n, violations: [text], usage } ], usage: [ ... ], seconds }
//   `entry` holds only the fields the writer owns, plus id/y/n/t/r to identify it. On approval a person (or the approval step) merges it into data.json.
//
// Requires ANTHROPIC_API_KEY. The page text is never written to the draft.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { loadSources, getSourceTexts, entryIdFor, SOURCES_DIR } from './sources-file.mjs';
import { loadRegistry } from './registry.mjs';
import { checkDraft, lengthTier, wordCount } from './article-checks.mjs';
import { applyAgeToFacts, numberWords } from './lifespan.mjs';
import { recordWriter, LOG_PATH } from './article-log.mjs';
import { realFetchPage } from './source-finder.mjs';

export const DRAFTS_DIR = process.env.DRAFTS_DIR || 'drafts';
const RULES_PATH = process.env.WRITER_RULES_PATH || 'scripts/writer-rules.md';
const STYLE_PATH = process.env.WRITER_STYLE_PATH || 'scripts/writer-style.json';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_ATTEMPTS = 3;
const TOKEN_BUDGETS = [9000, 14000, 16000];
const MAX_SOURCE_CHARS = 120000;           // per page sent to the model; a longer page is cut with a note
const MIN_SOURCE_WORDS = 800;              // fewer words than this left after dropping pages: no draft
const REGIONS = ['rome', 'west', 'brit', 'east', 'holy', 'africa', 'americas', 'asia'];
const CATEGORY_LABEL = { s: 'Saint', c: 'Council', p: 'Persecution', m: 'Marian apparition', u: 'Eucharistic miracle', e: 'Event', i: 'Topic page' };
const NOTE_KINDS = ['conflict', 'tradition', 'thin', 'approval', 'sources', 'form', 'other'];
const AGE_TOKEN = '[[AGE]]';
const AMOUNTS = ['too_little', 'about_right', 'too_much'];

let tokensUsed = 0;

// ---- the model call (Anthropic Messages); deps.callModel replaces it in tests ----
async function callAnthropic({ system, user, maxTokens, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret (needed for the writer).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) {
    const err = new Error('Anthropic messages ' + res.status + ': ' + String(await res.text().catch(() => '')).slice(0, 300));
    err.status = res.status;
    if (res.status === 429 || res.status === 529 || /quota|credit|billing/i.test(err.message)) err.deferred = true;
    throw err;
  }
  const data = await res.json();
  const u = data.usage || {};
  return { text: (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n').trim(), truncated: data.stop_reason === 'max_tokens',
    usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 } };
}

function extractJson(raw) {
  const s = String(raw || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('no JSON object in the reply');
  return JSON.parse(s.slice(a, b + 1));
}

// ---- settings read at run time ----
function readText(path, what) {
  if (!existsSync(path)) throw new Error(what + ' not found at ' + path);
  return readFileSync(path, 'utf8');
}
function loadStyle(path = STYLE_PATH) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return Array.isArray(j.limits) ? j.limits : []; } catch (_e) { return []; }
}

// ---- the prompt ----
export function buildSystemPrompt({ rules, limits, band, type }) {
  const rationed = limits.length
    ? 'WORDS TO RATION (counted by code in your section text and short description, outside quotations; over the limit and the draft is sent back)\n' +
      limits.map(l => '- "' + l.id + '": at most ' + l.maxPerArticle + ' per article. Instead of the extra uses, vary the wording, for example: ' + (l.instead || []).join(', ') + '.').join('\n') + '\n\n'
    : '';
  return `You are Augustine, the writer for "Catholic Timeline", a reference site on the history of the Catholic Church. You write ONE article, from the numbered sources you are given and from nothing else.

THE SOURCES RULE (absolute)
- Every fact in your article (each date, number, name, place, event and attribution) must come from the sources. Use no outside knowledge, not even for something you are sure of. If the sources do not say it, leave it out.
- Do not copy sentences from a source. Write in your own words. The only copied text is inside quotations, which must be word for word from one source.
- Give each fact the weight the sources give it: where a source says tradition holds, or later legend relates, you say so (the four tiers in the rules below).
- Scripture: refer to a passage and, at most, quote a short verse or two word for word, with the reference. Never reproduce a chapter.

WHEN SOURCES DISAGREE
- You PICK THE WINNER and write only the winning version into the article. Do not write both versions into the text. Prefer the higher-ranked source (a LOWER rank number is higher; see the tier legend). When ranks are equal, prefer the more specific source, then the fuller one. A source speaking for itself about its own subject (an official body on its own matter) wins on that matter.
- Then record the conflict in "reviewNotes" with kind "conflict": the claim, the version you chose and its source number, the other version and its source number, and your reason in one plain sentence. A person makes the final decision, so be exact and honest about what you were unsure of.
- Also add review notes for: a claim that rests on tradition or legend ("tradition"); material that is thin ("thin"); the approval status of an apparition or miracle ("approval"); anything else you are unsure of ("other"). Each note says the real concern, specifically ("Only source for the date is a 1912 encyclopedia; the diocese's own page gives none"), never just "sourcing is thin".

${rationed}HOW TO WRITE (the house rules; follow them exactly)
${rules}

LENGTH: this article is in the "${band.tier}" tier: ${band.min} to ${band.max} words in the sections taken together; never more than ${band.max}. If the sources are too thin to reach ${band.min} honestly, write less and add a "thin" review note; never pad.

THE ENTRY TYPE is ${CATEGORY_LABEL[type] || type}. Use only the Quick Fact labels the rules list for it, and leave out any fact the sources do not give.

AGE AT DEATH (people only): the reader wants to know whether he died old or young. Do NOT work out the age yourself. Write the "Born" and "Died" Quick Facts exactly as the sources give them: month, day and year when the sources give them; "c." before a year that is approximate; a range such as "c. 1020/1025" when the sources give one; the year only when that is all they give. Do not put an age in the "Died" fact; code adds it. In the narrative of his death write the marker [[AGE]] exactly once, where the age belongs, for example: "He died on August 28, 430, [[AGE]], while the Vandals besieged the city." Code replaces the marker with "at the age of seventy-five" or "at about seventy-five", and removes it where no age can be worked out. Do not write any other statement of the age at death.

FORMAT OF THE SECTIONS: plain text only. Paragraphs are separated by a blank line. No HTML except <i> for titles of works. No <p>, no markdown, no entry: links, no footnote numbers.

REPLY WITH ONLY THIS JSON, no preamble, no code fences:
{
 "d": "the short description: one or two sentences",
 "sections": [ { "h": "heading", "b": "paragraph one\\n\\nparagraph two" } ],
 "quotes": [ { "text": "exact words from ONE source", "source": "who said or wrote it, and where (for example Confessions X, 27)" } ],
 "facts": [ { "label": "Feast day", "value": "August 28" } ],
 "country": "the modern country name, or an empty string",
 "region": "one of: ${REGIONS.join(', ')}",
 "alt": [ "other names the subject is known by, if any" ],
 "reviewNotes": [ { "kind": "conflict | tradition | thin | approval | other", "claim": "...", "chosen": { "text": "...", "source": 1 }, "other": { "text": "...", "source": 2 }, "why": "one sentence" } ],
 "flaggedWords": [ "plain names or terms in your article that a text-to-speech voice may mispronounce; the words only, no pronunciation" ],
 "sourceFeedback": { "amount": "too_little | about_right | too_much", "used": [ 1, 2 ], "unused": [ 3 ], "gaps": [ "what the sources did not tell you that the article needed" ], "wouldHelp": [ "what kind of source or material would have made this easier or better" ] }
}
sourceFeedback is for the people who run this process, never for the reader: say honestly whether the sources were too little, about right or too much for this article, which numbered sources you actually drew on, and what was missing or surplus.
For kinds other than "conflict" use { "kind": "...", "note": "the specific concern" }.`;
}

function tierLegend(registry) {
  const t = (registry && registry.tiers) || {};
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { rank: v.rank, label: v.label, means: v.means, canVerify: v.canVerify }]));
}

// ---- turning the model's JSON into a clean draft ----
const str = (v, n = 4000) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function normalizeDraft(raw, { type, mode, existing }) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const sections = (Array.isArray(o.sections) ? o.sections : []).map(s => ({ h: str(s && s.h, 200), b: str(s && s.b, 20000).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n') }));
  const quotes = (Array.isArray(o.quotes) ? o.quotes : []).map(q => ({ text: str(q && q.text, 1500), source: str(q && q.source, 300) }));
  const facts = (Array.isArray(o.facts) ? o.facts : []).map(f => ({ label: str(f && f.label, 80), value: str(f && f.value, 400) }));
  const notes = [];
  for (const n of Array.isArray(o.reviewNotes) ? o.reviewNotes : []) {
    if (!n || typeof n !== 'object') continue;
    const kind = NOTE_KINDS.includes(n.kind) ? n.kind : 'other';
    if (kind === 'conflict') {
      const src = x => { const v = parseInt(x && x.source, 10); return Number.isFinite(v) && v > 0 ? v : null; };
      notes.push({ kind, claim: str(n.claim, 400), chosen: { text: str(n.chosen && n.chosen.text, 400), source: src(n.chosen) }, other: { text: str(n.other && n.other.text, 400), source: src(n.other) }, why: str(n.why, 400) });
    } else notes.push({ kind, note: str(n.note || n.why || n.claim, 600) });
  }
  const regionOk = REGIONS.includes(o.region);
  return {
    d: str(o.d, 600), sections, quotes, facts, country: str(o.country, 60), region: regionOk ? o.region : (existing && existing.r) || '',
    regionGiven: str(o.region, 40), alt: (Array.isArray(o.alt) ? o.alt : []).map(a => str(a, 80)).filter(Boolean).slice(0, 8),
    reviewNotes: notes.filter(n => (n.kind === 'conflict' ? n.claim || n.why : n.note)),
    flaggedWords: [...new Set((Array.isArray(o.flaggedWords) ? o.flaggedWords : []).map(w => str(w, 60)).filter(Boolean))].slice(0, 40),
    sourceFeedback: normalizeFeedback(o.sourceFeedback)
  };
}

const nums = a => [...new Set((Array.isArray(a) ? a : []).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0))].sort((x, y) => x - y);
export function normalizeFeedback(f) {
  if (!f || typeof f !== 'object') return null;
  return { amount: AMOUNTS.includes(f.amount) ? f.amount : null, used: nums(f.used), unused: nums(f.unused),
    gaps: (Array.isArray(f.gaps) ? f.gaps : []).map(g => str(g, 300)).filter(Boolean).slice(0, 8), wouldHelp: (Array.isArray(f.wouldHelp) ? f.wouldHelp : []).map(g => str(g, 300)).filter(Boolean).slice(0, 8) };
}

// The age phrase for the marker: exact ages say "at the age of", estimates say "at about". Words up to a hundred, digits above.
export function agePhrase(lifespan) {
  if (!lifespan || lifespan.age == null) return '';
  const n = lifespan.age < 100 ? numberWords(lifespan.age) : String(lifespan.age);
  return (lifespan.kind === 'exact' ? 'at the age of ' : 'at about ') + n;
}
// Fill or drop the [[AGE]] markers in the sections. Returns the number of markers found.
export function fillAgeMarkers(sections, lifespan) {
  let count = 0;
  const phrase = agePhrase(lifespan);
  for (const s of sections) {
    s.b = String(s.b || '').replace(/(\s*,?\s*)\[\[AGE\]\]/g, (_m, lead) => { count++; return phrase ? lead + phrase : ''; });
  }
  return count;
}

// The sources as the model sees them: numbered in rank order, with the tier legend. Text only goes to the model, never into the draft.
function prepareSources(texts, file, registry) {
  const rankOf = tier => { const t = registry && registry.tiers && registry.tiers[tier]; return t && t.rank != null ? t.rank : 99; };
  const meta = new Map(file.sources.map(s => [s.n, s]));
  return texts.filter(t => t.drift !== 'unavailable' && t.text)
    .map(t => ({ ...t, title: (meta.get(t.n) || {}).title || '', rank: rankOf(t.tier), words: wordCount(t.text), cut: t.text.length > MAX_SOURCE_CHARS, send: t.text.slice(0, MAX_SOURCE_CHARS) }))
    .sort((a, b) => a.rank - b.rank || a.n - b.n)
    .map((t, i) => ({ ...t, num: i + 1 }));
}

function linksFrom(sources) {
  const out = [], skipped = [];
  for (const s of sources) {
    if (/(^|\.)miracolieucaristici\.org$/.test(s.domain)) { skipped.push(s); continue; }       // that link lives in the separate carloLinks table
    const site = String(s.domain || '').replace(/^www\./, '');
    out.push({ label: (site + (s.title ? ': ' + s.title.replace(/\s+/g, ' ').trim().slice(0, 90) : '')).trim(), url: s.url });
  }
  return { links: out, skipped };
}

const sigHash = s => createHash('sha256').update(s).digest('hex').slice(0, 12);

// ---- the run ----
export async function writeDraft(subject, { sourcesDir = SOURCES_DIR, task, now = new Date(), deps = {} } = {}) {
  const t0 = Date.now();
  const p = (task && task.payload) || {};
  const id = entryIdFor(subject);
  const file = loadSources(id, sourcesDir);
  if (!file) return { outcome: 'blocked', reason: 'no sources file for ' + id + ' (run Jerome first)' };
  if (file.outcome !== 'ready' && !p.override) return { outcome: 'blocked', reason: 'Jerome\'s outcome for this entry is "' + file.outcome + '"' + (file.reason ? ' (' + file.reason + ')' : '') + '; a person must decide (resend with override) before anything is written' };

  const registry = deps.registry || (() => { try { return loadRegistry(); } catch (_e) { return null; } })();
  const texts = await getSourceTexts(file, { fetchPage: deps.fetchPage || realFetchPage });
  const sources = prepareSources(texts, file, registry);
  const dropped = texts.filter(t => t.drift === 'unavailable').length;
  const changed = texts.filter(t => t.drift === 'changed').length;
  const sourceWords = sources.reduce((n, s) => n + s.words, 0);
  if (sourceWords < MIN_SOURCE_WORDS) return { outcome: 'blocked', reason: 'only ' + sourceWords + ' words of source text could be read now (' + dropped + ' page(s) could not be fetched); the minimum is ' + MIN_SOURCE_WORDS };

  const type = (file.subject && file.subject.category) || subject.category || 's';
  const band = lengthTier({ requested: p.length, entryTier: subject.tier, sourceWords });
  const limits = deps.limits || loadStyle();
  const rules = deps.rules != null ? deps.rules : readText(RULES_PATH, 'the writer rules');
  const model = p.model || deps.model || DEFAULT_MODEL;
  const system = buildSystemPrompt({ rules, limits, band, type });
  const call = deps.callModel || callAnthropic;

  const base = {
    subject: { name: file.subject.name || subject.name, category: type, year: file.subject.year != null ? file.subject.year : subject.year },
    entryType: CATEGORY_LABEL[type] || type, length: band, tierLegend: tierLegend(registry),
    jeromeNotes: { outcome: file.outcome, flags: file.flags || [], verdict: file.verdict ? { action: file.verdict.action, reasons: (file.verdict.reasons || []).map(r => r.text), advisory: (file.verdict.advisory || []).map(r => r.text) } : null,
      missingPerspectives: (file.perspectives && file.perspectives.missing) || [], diocese: file.authority ? file.authority.diocese : undefined },
    sources: sources.map(s => ({ n: s.num, rank: s.rank, tier: s.tier, domain: s.domain, title: s.title, url: s.url, words: s.words, ...(s.cut ? { note: 'cut after ' + MAX_SOURCE_CHARS + ' characters' } : {}), text: s.send }))
  };

  const attemptLog = [];
  const usageTotal = { role: 'writer', provider: 'anthropic', model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let draft = null, result = null, previous = null, failure = null;
  const plainSources = sources.map(s => ({ n: s.num, text: s.text }));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user = JSON.stringify({ ...base, ...(failure ? { revise: { instruction: 'Your previous draft broke these rules. Rewrite the whole article so that none is broken, changing as little else as you can.', problems: failure, previousDraft: previous } } : {}) });
    let reply, parsed = null, parseErr = '';
    for (let b = 0; b < TOKEN_BUDGETS.length; b++) {
      reply = await call({ system, user, maxTokens: TOKEN_BUDGETS[b], model });
      usageTotal.calls++; usageTotal.inputTokens += reply.usage.input || 0; usageTotal.outputTokens += reply.usage.output || 0;
      usageTotal.cacheReadTokens += reply.usage.cacheRead || 0; usageTotal.cacheWriteTokens += reply.usage.cacheWrite || 0;
      tokensUsed += (reply.usage.input || 0) + (reply.usage.output || 0);
      if (reply.truncated) { parseErr = 'the reply was cut off at the token limit'; continue; }
      try { parsed = extractJson(reply.text); parseErr = ''; } catch (e) { parseErr = 'the reply was not valid JSON (' + e.message + ')'; }
      break;
    }
    const callUsage = { model, inputTokens: reply ? reply.usage.input : 0, outputTokens: reply ? reply.usage.output : 0 };
    if (!parsed) { failure = [parseErr || 'no usable reply']; attemptLog.push({ n: attempt, violations: failure, usage: callUsage }); continue; }

    draft = normalizeDraft(parsed, { type, mode: file.mode, existing: subject.r ? { r: subject.r } : null });
    // Age at death: code works it out from the Born and Died facts and fills the [[AGE]] marker; the model's own copy (marker and facts as he wrote them) is what he is
    // shown again if the draft is sent back.
    const rawSections = draft.sections.map(x => ({ ...x })), rawFacts = draft.facts.map(x => ({ ...x }));
    const isPerson = type === 's';
    const la = isPerson ? applyAgeToFacts(draft.facts) : { facts: draft.facts, lifespan: { age: null, reason: 'not a person' } };
    draft.facts = la.facts; draft.lifespan = la.lifespan;
    const markers = fillAgeMarkers(draft.sections, la.lifespan);
    result = checkDraft(draft, { type, band, limits, sources: plainSources, sourceWords });
    const extra = [];
    if (!subject.id && !REGIONS.includes(draft.regionGiven)) extra.push({ rule: 'region', text: 'region must be one of: ' + REGIONS.join(', ') });
    if (isPerson && la.lifespan.age != null && markers !== 1) {
      extra.push({ rule: 'age', text: markers === 0 ? 'write the marker ' + AGE_TOKEN + ' once in the narrative of his death (code fills it in as "' + agePhrase(la.lifespan) + '")' : 'write the marker ' + AGE_TOKEN + ' only once; you wrote it ' + markers + ' times' });
    }
    const vs = result.violations.concat(extra);
    attemptLog.push({ n: attempt, violations: vs.map(v => v.text), usage: callUsage });
    if (!vs.length) { result.violations = []; break; }
    result.violations = vs;
    failure = vs.map(v => v.text).slice(0, 14);
    previous = { d: draft.d, sections: rawSections, quotes: draft.quotes, facts: rawFacts };
  }
  if (!draft) return { outcome: 'error', reason: 'the model never returned a usable article: ' + (failure && failure[0]), attemptLog, usage: usageTotal };

  const passed = !!result && result.violations.length === 0;
  const { links, skipped } = linksFrom(sources);
  const quotes = draft.quotes.filter(q => q.text);
  const notes = draft.reviewNotes.map(n => (n.kind === 'conflict'
    ? { ...n, chosen: { ...n.chosen, site: (sources.find(s => s.num === n.chosen.source) || {}).domain }, other: { ...n.other, site: (sources.find(s => s.num === n.other.source) || {}).domain } } : n));

  // Notes added by code, not left to the model: Jerome's own warnings, thin material, a form failure, and the approval note for apparitions and miracles.
  const jn = [];
  if (file.flags && file.flags.length) jn.push('Jerome flagged: ' + file.flags.join(', '));
  if (file.perspectives && file.perspectives.missing && file.perspectives.missing.length) jn.push('no source found for: ' + file.perspectives.missing.join(', '));
  if (changed) jn.push(changed + ' source page(s) differ in length from what Jerome saw');
  if (dropped) jn.push(dropped + ' source page(s) could not be fetched again and were not used');
  if (jn.length) notes.push({ kind: 'sources', note: jn.join('; ') });
  if (skipped.length) notes.push({ kind: 'other', note: skipped.map(s => s.domain).join(', ') + ' was a source but is not linked in the article; that link belongs in the separate carloLinks table' });
  const words = result.stats.words;
  if (words < band.min && !notes.some(n => n.kind === 'thin')) notes.push({ kind: 'thin', note: 'The article is ' + words + ' words, under the ' + band.min + '-word target for the ' + band.tier + ' tier, because the sources give no more to say.' });
  if ((type === 'm' || type === 'u') && !notes.some(n => n.kind === 'approval')) {
    notes.push({ kind: 'approval', note: 'A person must confirm the approval status against the bishop\'s or the Dicastery\'s own statement' + (file.authority && file.authority.diocese ? ' (' + file.authority.diocese + ')' : '') + '. The article states only what the sources state.' });
  }
  const lf = draft.lifespan;                                  // no review note when no age can be given: Tom, 2026-10-09 ("No note needed if age is left out"); the reason stays in draft.lifespan and the log
  if (!passed) notes.push({ kind: 'form', note: 'Still failing after ' + attemptLog.length + ' attempts: ' + result.violations.slice(0, 5).map(v => v.text).join(' | ') });

  const entry = { id, y: subject.y != null ? subject.y : (file.subject.year != null ? file.subject.year : null), n: subject.n || file.subject.name || subject.name, t: type, r: subject.r || draft.region,
    country: draft.country, alt: draft.alt, d: draft.d, art: { sections: draft.sections, quotes, links }, facts: draft.facts };
  const out = {
    version: 1, entryId: id, mode: file.mode, status: passed ? 'draft' : 'needs_work', subject: base.subject, builtAt: now.toISOString(),
    writer: { role: 'Augustine', model, attempts: attemptLog.length, maxAttempts: MAX_ATTEMPTS, rules: sigHash(rules), style: sigHash(JSON.stringify(limits)) },
    sourcesFile: { file: 'sources/' + id + '.json', jobId: file.jobId || null, builtAt: file.builtAt || null, outcome: file.outcome, pages: sources.length, words: sourceWords, dropped, changed },
    length: band, entry, reviewNotes: notes, flaggedWords: draft.flaggedWords,
    lifespan: type === 's' ? { age: lf.age, kind: lf.kind || null, min: lf.min != null ? lf.min : null, max: lf.max != null ? lf.max : null, reason: lf.reason || null, born: lf.bornText || null, died: lf.diedText || null } : null,
    sourceFeedback: draft.sourceFeedback, sourceStats: sources.map(x => ({ n: x.num, jeromeN: x.n, domain: x.domain, tier: x.tier, words: x.words, used: draft.sourceFeedback && draft.sourceFeedback.used.length ? draft.sourceFeedback.used.includes(x.num) : null })),
    checks: { passed, violations: result.violations, stats: result.stats }, attemptLog, usage: [usageTotal], seconds: Math.round((Date.now() - t0) / 100) / 10
  };
  return { outcome: 'written', draft: out };
}

export function writeDraftFile(draft, dir = DRAFTS_DIR) {
  const path = join(dir, draft.entryId + '.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(draft, null, 1) + '\n');
  return path;
}

// The orchestrator's handler: (task, dataJson, workLog, deps) => outcome. The third argument is the work log, not dependencies.
export async function runArticleWrite(task, dataJson, _workLog, deps = {}) {
  const p = (task && task.payload) || {};
  tokensUsed = 0;
  let subject;
  if (task.entityId && !p.name) {
    const e = (dataJson.entries || []).find(x => x.id === task.entityId);
    if (!e) return { result: { outcome: 'error', reason: 'no entry with id ' + task.entityId }, summary: 'no entry with id ' + task.entityId };
    subject = { id: e.id, name: e.n, y: e.y, year: e.y, n: e.n, t: e.t, category: e.t, r: e.r, tier: e.tier };
  } else {
    if (!p.name) return { result: { outcome: 'error', reason: 'a new subject needs payload.name' }, summary: 'a new subject needs payload.name' };
    subject = { name: p.name, category: p.category, year: p.year != null ? p.year : null, y: p.year != null ? p.year : null, n: p.name };
  }
  let r;
  try { r = await writeDraft(subject, { sourcesDir: deps.sourcesDir || SOURCES_DIR, task, now: deps.now || new Date(), deps }); }
  catch (err) {
    if (err && err.deferred) throw err;
    return { result: { outcome: 'error', reason: String((err && err.message) || err).slice(0, 300) }, summary: 'error: ' + String((err && err.message) || err).slice(0, 200), provider: 'anthropic', tokensUsed };
  }
  if (r.outcome !== 'written') {
    return { result: { outcome: r.outcome, reason: r.reason }, summary: (r.outcome === 'blocked' ? 'blocked: ' : 'error: ') + r.reason, provider: 'anthropic', tokensUsed };
  }
  const d = r.draft;
  const path = writeDraftFile(d, deps.draftsDir || DRAFTS_DIR);
  const files = [path];
  try { recordWriter({ draft: d, task, logPath: deps.logPath || LOG_PATH, now: deps.now || new Date() }); files.push(deps.logPath || LOG_PATH); } catch (_e) { /* the log is optional */ }
  const st = d.checks.stats;
  return {
    result: { outcome: 'written', entryId: d.entryId, status: d.status, file: path, words: st.words, sections: st.sections, attempts: d.writer.attempts, reviewNotes: d.reviewNotes.length, usage: d.usage, model: d.writer.model },
    summary: (d.status === 'draft' ? 'draft written' : 'draft written but STILL FAILING form checks') + ' for ' + d.subject.name + ': ' + st.words + ' words, ' + st.sections + ' sections, ' + d.reviewNotes.length + ' review note(s), attempt ' + d.writer.attempts,
    provider: 'anthropic', tokensUsed, filesToCommit: files
  };
}

export const __test = { normalizeDraft, prepareSources, linksFrom, buildSystemPrompt, normalizeFeedback, agePhrase, fillAgeMarkers };
