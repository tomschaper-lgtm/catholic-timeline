// scripts/services/article-fix.mjs
// MODULE DATE: 2026-10-11 (Sunday) · v0.1 — "Augustine, fix pass" (stage 4): repairs the claims Thomas could not verify in a draft. UNTESTED LIVE.
//
// Service "article-fix". It reads THREE files and changes ONE:
//   reads   drafts/<entry-id>.json          (Augustine's draft)
//           ledger-drafts/<entry-id>.json   (Thomas's check of that draft; run Thomas on the draft first)
//           sources/<entry-id>.json         (Jerome's pages; the text is fetched again or taken from the stored copy)
//   writes  drafts/<entry-id>.json          (the revised draft; git keeps the old one). data.json and the ledger are never touched.
//
// WHAT IT FIXES (from Thomas's ledger): every claim marked "disputed" or "unsourced", and every sentence Thomas could not tie to a claim ("uncovered").
// WHAT IT LEAVES ALONE: a claim that failed only because of Thomas's own limits (an excerpt over the word limit, or a quotation that Thomas already
// verified in the quote block). Those are Thomas's to retry, not the writer's to rewrite.
//
// HOW (cheap and safe): the model does NOT rewrite the article. For each problem sentence it returns ONE edit: replace, delete, or keep.
//   replace/delete: CODE finds the sentence word for word (exactly once) and swaps it. Nothing else in the article can change.
//   keep:           allowed only with a passage the model copied from a source; CODE checks that the passage really is in that page. Otherwise it is sent back.
//   Any year in a replacement must appear in a source (or in the sentence it replaces). The model cannot invent a date.
// CODE then re-runs the same form checks as the writer (article-checks.mjs). Anything wrong goes back to the model, up to 3 attempts.
// If the third attempt still fails, NOTHING is overwritten and the outcome says why.
//
// DATE RULE (Tom, 2026-10-11): when sources give different years, (1) if the Catholic Encyclopedia (newadvent.org/cathen) gives a year, use that year: settled;
// (2) otherwise, if the years differ by no more than two, write "around 395" or "395 or 396"; (3) if they differ by more than two, leave the year out and add a review note.
// A year no source gives is not stated. A day or place no source gives is dropped.
//
// AGE AT DEATH: the draft holds the age phrase code wrote ("at the age of seventy-five"). Before the model sees the article that phrase goes back to the marker
// [[AGE]] and the Died fact loses its "(age 75)"; after the edits CODE works the age out again (lifespan.mjs), as the writer does. If a day is dropped from a date,
// the age may change from "at the age of" to "at about". That is correct.
//
// TASK SHAPE:  { id, type: 'article-fix', entityId: '<entry id>' }      payload: { model: 'claude-sonnet-5-5' (default) }
// Requires ANTHROPIC_API_KEY. After a fix, run Thomas on the draft again to see the new result.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSources, getSourceTexts, SOURCES_DIR } from './sources-file.mjs';
import { loadRegistry } from './registry.mjs';
import { checkDraft, wordCount } from './article-checks.mjs';
import { applyAgeToFacts } from './lifespan.mjs';
import { realFetchPage } from './source-finder.mjs';
import { DRAFTS_DIR, fillAgeMarkers, writeDraftFile, __test as writerInternals } from './article-writer.mjs';

export const LEDGER_DRAFTS_DIR = process.env.LEDGER_DRAFTS_DIR || 'ledger-drafts';
const RULES_PATH = process.env.WRITER_RULES_PATH || 'scripts/writer-rules.md';
const STYLE_PATH = process.env.WRITER_STYLE_PATH || 'scripts/writer-style.json';
const DEFAULT_MODEL = 'claude-sonnet-5-5';            // the writer's model (Tom, 2026-10-10); the fix pass is the writer's second stage
const MAX_ATTEMPTS = 3;
const TOKEN_BUDGETS = [4000, 8000, 12000];            // replies are short lists of edits, not whole articles
const MAX_SOURCE_CHARS = 120000;
const AGE_TOKEN = '[[AGE]]';
let tokensUsed = 0;

// ---------- the model call (same as the writer's; deps.callModel replaces it in tests) ----------
async function callAnthropic({ system, user, maxTokens, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret (needed for the fix pass).');
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

// ---------- small helpers ----------
const norm = s => String(s || '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
const stripMarker = s => String(s || '').replace(/\s*,?\s*\[\[AGE\]\]/g, '');
const countOf = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const sentencesOf = text => String(text || '').split(/\n{2,}/).flatMap(p => p.split(/(?<=[.!?]["\u201D')]?)\s+/)).map(s => s.trim()).filter(Boolean);

// ---------- put the age back to the marker (and take "(age 75)" off the Died fact), so the model never sees code-made words ----------
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const spell = n => n < 20 ? ONES[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '') : n === 100 ? 'one hundred' : 'one hundred ' + spell(n - 100);
export function restoreAgeMarkers(entry, lifespan) {
  const sections = (entry.art.sections || []).map(s => ({ h: s.h, b: s.b })), facts = (entry.facts || []).map(f => ({ label: f.label, value: f.value }));
  const age = lifespan && lifespan.age;
  let restored = 0;
  if (Number.isInteger(age) && age > 0 && age <= 120) {
    const alt = '(?:' + spell(age) + '|' + age + ')';
    const inText = new RegExp('(,?)\\s*\\b(?:at about|at the age of about|at the age of|aged about|aged)\\s+' + alt + '\\b', 'gi');
    const inFact = new RegExp('\\s*\\((?:at |estimated )?(?:age |about )?' + alt + '\\)', 'gi');
    for (const s of sections) s.b = s.b.replace(inText, (_m, comma) => { restored++; return comma + ' ' + AGE_TOKEN; });
    for (const f of facts) f.value = f.value.replace(inFact, '');
  }
  return { sections, facts, restored };
}

// ---------- what needs fixing ----------
const LIMIT_NOTE = /excerpt \d+ is \d+ words; the limit is \d+/i;
export function collectProblems(ledger, sections, facts) {
  const claims = Array.isArray(ledger.claims) ? ledger.claims : [];
  const verifiedQuotes = new Set(claims.filter(c => c.kind === 'quote' && c.status === 'verified').map(c => norm(c.text).replace(/^"|"$/g, '')));
  const skipped = [], groups = new Map();
  for (const c of claims) {
    if (c.status !== 'disputed' && c.status !== 'unsourced') continue;
    if (LIMIT_NOTE.test(c.note || '')) { skipped.push({ cid: c.cid, text: c.text, why: 'Thomas\'s own excerpt limit, not a sourcing gap; Thomas should retry' }); continue; }
    if (c.kind === 'quote' && verifiedQuotes.has(norm(c.text).replace(/^"|"$/g, ''))) { skipped.push({ cid: c.cid, text: c.text, why: 'same quotation already verified in the quote block' }); continue; }
    const key = (c.section === 'facts' ? 'facts|' : 'text|') + norm(c.sentence || c.text);
    if (!groups.has(key)) groups.set(key, { where: c.section === 'facts' ? 'facts' : 'section', sentence: c.sentence || c.text, claims: [] });
    groups.get(key).claims.push({ cid: c.cid, text: c.text, status: c.status, kind: c.kind, judge: c.judge || null, note: c.note || '', checks: c.checks || undefined,
      closest: (c.sources || []).slice(0, 2).map(s => ({ url: s.url, excerpt: s.excerpt })) });
  }
  for (const u of Array.isArray(ledger.uncovered) ? ledger.uncovered : []) {
    const key = 'text|' + norm(u.sentence);
    if (!groups.has(key)) groups.set(key, { where: 'section', sentence: u.sentence, claims: [{ cid: 'uncovered', text: u.sentence, status: 'uncovered', kind: 'sentence', note: 'Thomas found no checkable claim in this sentence; it may state something no source gives' }] });
  }
  // find each text sentence in the article as it now stands (age marker included), so the model can copy it exactly
  const sentences = sections.flatMap((s, i) => sentencesOf(s.b).map(x => ({ section: i + 1, text: x, plain: norm(stripMarker(x)) })));
  const problems = [...groups.values()].map((g, i) => {
    const hit = g.where === 'section' ? sentences.find(x => x.plain === norm(g.sentence)) || sentences.find(x => x.plain.includes(norm(g.sentence)) || norm(g.sentence).includes(x.plain)) : null;
    return { id: i + 1, where: g.where, section: hit ? hit.section : null, articleSentence: hit ? hit.text : null, thomasSentence: g.sentence, claims: g.claims, located: g.where === 'facts' || !!hit };
  });
  return { problems, skipped };
}

// ---------- the prompt ----------
export function buildFixSystem({ rules, limits }) {
  const rationed = limits && limits.length ? 'WORDS TO RATION (counted by code outside quotations): ' + limits.map(l => '"' + l.id + '" at most ' + l.maxPerArticle).join('; ') + '.\n\n' : '';
  return `You are Augustine, the writer for "Catholic Timeline". This is the FIX PASS: Thomas, the fact-checker, found claims in your draft that the sources do not fully support. You repair ONLY those sentences, using the numbered sources you are given and nothing else.

THE SOURCES RULE (absolute): every date, number, name, place, event and attribution must come from the sources. Outside knowledge is not allowed, even when you are sure. A sentence may say no more than the sources say.

FOR EACH PROBLEM (identified by "id") give exactly ONE edit:
- "replace": rewrite the sentence so it says only what the sources support. Where Thomas said "partial", drop the extra detail the source does not give (a claim the source does not state, such as "by his own account", "public", "town council") or use the source's own wording of it. Keep the rest of the sentence and its voice.
- "delete": remove the sentence when nothing supportable is left, or when it adds nothing the article needs.
- "keep": ONLY if some source really does support the sentence as written. You must give "support": { "source": <number>, "passage": "words copied exactly from that source" }. Code checks the passage is on that page; a passage that is not there sends the edit back.
For a problem whose "where" is "facts", name the Quick Fact by "label" instead of copying a sentence; "new" is the corrected value ("" removes the fact).
For a problem whose "where" is "section", "old" must be the "articleSentence" copied exactly, including any [[AGE]] marker. Leave [[AGE]] where it is and never write an age yourself. Never delete a sentence that contains [[AGE]]; reword it instead. If "articleSentence" is null, copy the sentence from the article text yourself.

DATE RULE (Tom's decision): when the sources give different years for the same event: (1) if a Catholic Encyclopedia page (URL contains newadvent.org/cathen/) gives a year, use that year and nothing else; (2) otherwise, if the years differ by no more than two, write "around 395" or "395 or 396"; (3) if they differ by more than two, leave the year out and say so in a review note. A year, day or place that NO source gives is not stated: drop that detail and keep the rest of the sentence. Never add a date, number or name that is not in the sources. Where Thomas's note names the missing detail (for example "does not state that he sat on the town council"), that is the detail to cut or reword.

Do not touch any sentence that is not listed. Do not add new sentences or new facts. Keep each replacement about as short as the sentence it replaces. Plain text; <i> only for titles of works.

${rationed}HOUSE STYLE (follow when you reword):
${rules}

REPLY WITH ONLY THIS JSON, no preamble, no code fences:
{ "edits": [ { "id": 1, "action": "replace | delete | keep", "old": "exact sentence from the article (sections only)", "label": "Quick Fact label (facts only)", "new": "the replacement sentence or fact value", "support": { "source": 2, "passage": "exact words from the source (keep only)" }, "why": "one plain sentence for the person who reviews this" } ],
  "reviewNotes": [ { "kind": "other", "note": "only where a date was left out because sources differ by more than two years, or another judgment a person should see" } ] }
Every problem id must appear exactly once.`;
}

// ---------- applying the edits (all in code) ----------
export function applyEdits(edits, problems, sections, facts, sources) {
  const problemsOut = [], changes = [], kept = [];
  const secs = sections.map(s => ({ h: s.h, b: s.b })), fs = facts.map(f => ({ label: f.label, value: f.value }));
  const allText = sources.map(s => norm(s.text)).join(' || ');
  const byId = new Map();
  for (const e of Array.isArray(edits) ? edits : []) { if (e && Number.isInteger(+e.id)) { if (byId.has(+e.id)) problemsOut.push('problem ' + e.id + ' has more than one edit; give exactly one'); byId.set(+e.id, e); } }
  for (const p of problems) {
    const e = byId.get(p.id);
    if (!e) { problemsOut.push('problem ' + p.id + ' has no edit'); continue; }
    const action = String(e.action || '').toLowerCase();
    const why = String(e.why || '').trim().slice(0, 300);
    if (!['replace', 'delete', 'keep'].includes(action)) { problemsOut.push('problem ' + p.id + ': action must be replace, delete or keep'); continue; }
    if (action === 'keep') {
      const src = sources.find(s => s.num === Number(e.support && e.support.source));
      const passage = norm(e.support && e.support.passage);
      if (!src || passage.length < 12 || !norm(src.text).includes(passage)) { problemsOut.push('problem ' + p.id + ': keep needs a passage copied exactly from the source named; that passage was not found on that page'); continue; }
      const yearsNeeded = (String(p.thomasSentence || '').match(/\b\d{3,4}\b/g) || []).filter(y => !passage.includes(y));
      if (yearsNeeded.length) { problemsOut.push('problem ' + p.id + ': the passage must contain the year ' + yearsNeeded[0] + ' the sentence states; otherwise reword the sentence'); continue; }
      kept.push({ id: p.id, cids: p.claims.map(c => c.cid), source: src.num, passage: String(e.support.passage).slice(0, 300), why });
      continue;
    }
    if (p.where === 'facts') {
      const f = fs.find(x => norm(x.label) === norm(e.label));
      if (!f) { problemsOut.push('problem ' + p.id + ': no Quick Fact labeled "' + e.label + '"'); continue; }
      const before = f.value;
      if (action === 'delete' || !String(e.new || '').trim()) fs.splice(fs.indexOf(f), 1); else f.value = String(e.new).trim();
      changes.push({ id: p.id, cids: p.claims.map(c => c.cid), where: 'facts', label: f.label, action, before, after: action === 'delete' ? '' : f.value, why });
    } else {
      const old = String(e.old || '').trim();
      const hits = secs.filter(s => countOf(s.b, old) > 0).reduce((n, s) => n + countOf(s.b, old), 0);
      if (!old || hits !== 1) { problemsOut.push('problem ' + p.id + ': "old" must match the article exactly once (it matched ' + hits + ' times); copy the sentence exactly'); continue; }
      const next = action === 'delete' ? '' : String(e.new || '').trim();
      if (action === 'replace' && !next) { problemsOut.push('problem ' + p.id + ': replace needs "new" text; use delete to remove the sentence'); continue; }
      const oldYears = new Set(old.match(/\b\d{3,4}\b/g) || []);
      const bad = (next.match(/\b\d{3,4}\b/g) || []).filter(y => !oldYears.has(y) && !new RegExp('(^|[^0-9])' + y + '([^0-9]|$)').test(allText));
      if (bad.length) { problemsOut.push('problem ' + p.id + ': the year ' + bad[0] + ' is in no source; do not state it'); continue; }
      for (const s of secs) if (s.b.includes(old)) { s.b = s.b.replace(old, () => next).replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:])/g, '$1').replace(/\n{3,}/g, '\n\n').trim(); break; }
      changes.push({ id: p.id, cids: p.claims.map(c => c.cid), where: 'section ' + (p.section || '?'), action, before: old, after: next, why });
    }
  }
  return { sections: secs.filter(s => s.b), facts: fs, changes, kept, problems: problemsOut };
}

// ---------- the run ----------
export async function fixDraft(entryId, { task, now = new Date(), deps = {} } = {}) {
  const t0 = Date.now();
  const draftPath = join(deps.draftsDir || DRAFTS_DIR, entryId + '.json'), ledgerPath = join(deps.ledgerDir || LEDGER_DRAFTS_DIR, entryId + '.json');
  if (!existsSync(draftPath)) return { outcome: 'blocked', reason: 'no draft file ' + draftPath + ' (run Augustine first)' };
  if (!existsSync(ledgerPath)) return { outcome: 'blocked', reason: 'no ledger file ' + ledgerPath + ' (run Thomas on the draft first)' };
  const draft = JSON.parse(readFileSync(draftPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (!draft.entry || !draft.entry.art) return { outcome: 'error', reason: draftPath + ' has no entry.art' };
  const file = loadSources(entryId, deps.sourcesDir || SOURCES_DIR);
  if (!file) return { outcome: 'blocked', reason: 'no sources file for ' + entryId };
  const p = (task && task.payload) || {};
  const model = p.model || deps.model || DEFAULT_MODEL;

  const registry = deps.registry || (() => { try { return loadRegistry(); } catch (_e) { return null; } })();
  const texts = await getSourceTexts(file, { fetchPage: deps.fetchPage || realFetchPage });
  const sources = writerInternals.prepareSources(texts, file, registry);
  const sourceWords = sources.reduce((n, s) => n + s.words, 0);
  if (!sources.length) return { outcome: 'blocked', reason: 'none of the source pages could be read now' };

  const type = (file.subject && file.subject.category) || (draft.subject && draft.subject.category) || 's';
  const restored = restoreAgeMarkers(draft.entry, draft.lifespan);
  const { problems, skipped } = collectProblems(ledger, restored.sections, restored.facts);
  if (!problems.length) return { outcome: 'nothing', reason: 'Thomas found nothing to fix', skipped };

  const rules = deps.rules != null ? deps.rules : (existsSync(RULES_PATH) ? readFileSync(RULES_PATH, 'utf8') : '');
  const limits = deps.limits || (() => { try { const j = JSON.parse(readFileSync(STYLE_PATH, 'utf8')); return Array.isArray(j.limits) ? j.limits : []; } catch (_e) { return []; } })();
  const system = buildFixSystem({ rules, limits });
  const call = deps.callModel || callAnthropic;
  const band = draft.length || { tier: 'standard', min: 0, max: 99999 };
  const plainSources = sources.map(s => ({ n: s.num, text: s.text }));
  const base = {
    subject: draft.subject, article: { description: draft.entry.d, sections: restored.sections.map((s, i) => ({ n: i + 1, h: s.h, b: s.b })), quotes: draft.entry.art.quotes, facts: restored.facts },
    problems,
    sources: sources.map(s => ({ n: s.num, tier: s.tier, url: s.url, catholicEncyclopedia: /newadvent\.org\/cathen\//i.test(s.url || ''), text: s.send }))
  };

  const usageTotal = { role: 'writer-fix', provider: 'anthropic', model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const attemptLog = [];
  let failure = null, previous = null, final = null, finalCheck = null, modelNotes = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user = JSON.stringify({ ...base, ...(failure ? { revise: { instruction: 'Your previous edits had these problems. Return the COMPLETE list of edits again, one per problem id, with these fixed.', problems: failure, previousEdits: previous } } : {}) });
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
    if (!parsed) { failure = [parseErr || 'no usable reply']; attemptLog.push({ n: attempt, problems: failure }); continue; }
    const applied = applyEdits(parsed.edits, problems, restored.sections, restored.facts, sources);
    let vs = applied.problems.slice();
    let candidate = null;
    if (!vs.length) {
      const isPerson = type === 's';
      const la = isPerson ? applyAgeToFacts(applied.facts) : { facts: applied.facts, lifespan: { age: null, reason: 'not a person' } };
      const sections = applied.sections.map(s => ({ ...s }));
      const markers = fillAgeMarkers(sections, la.lifespan);
      const check = checkDraft({ d: draft.entry.d, sections, quotes: draft.entry.art.quotes, facts: la.facts }, { type, band, limits, sources: plainSources, sourceWords });
      vs = check.violations.map(v => v.text);
      if (isPerson && la.lifespan.age != null && markers !== 1) vs.push('the age marker ' + AGE_TOKEN + ' must stay in the article exactly once; it appears ' + markers + ' times now');
      if (!vs.length) candidate = { sections, facts: la.facts, lifespan: la.lifespan, applied, check };
    }
    attemptLog.push({ n: attempt, problems: vs, usage: reply ? reply.usage : null });
    if (candidate) { final = candidate; finalCheck = candidate.check; modelNotes = Array.isArray(parsed.reviewNotes) ? parsed.reviewNotes : []; break; }
    failure = vs.slice(0, 14); previous = parsed.edits;
  }
  if (!final) return { outcome: 'needs_work', attempts: attemptLog.length, reason: 'after ' + attemptLog.length + ' attempts: ' + (failure || []).slice(0, 4).join(' | '), attemptLog, usage: usageTotal, skipped };

  // the revised draft: only sections, facts and notes change
  const lf = final.lifespan || {};
  const notes = (draft.reviewNotes || []).slice();
  for (const c of final.applied.changes) notes.push({ kind: 'other', note: 'Fix pass (' + c.where + ', ' + c.action + '): ' + (c.why || 'adjusted to what the sources say') + ' Before: "' + String(c.before).slice(0, 200) + '"' });
  for (const n of modelNotes) if (n && typeof n.note === 'string' && n.note.trim()) notes.push({ kind: 'other', note: 'Fix pass: ' + n.note.trim().slice(0, 500) });
  const entry = { ...draft.entry, art: { ...draft.entry.art, sections: final.sections }, facts: final.facts };
  const out = {
    ...draft, status: 'draft', entry, reviewNotes: notes,
    lifespan: draft.lifespan ? { age: lf.age, kind: lf.kind || null, min: lf.min != null ? lf.min : null, max: lf.max != null ? lf.max : null, reason: lf.reason || null, born: lf.bornText || null, died: lf.diedText || null } : draft.lifespan,
    checks: { passed: true, violations: [], stats: finalCheck.stats },
    fixPass: { fixedAt: now.toISOString(), model, attempts: attemptLog.length, ledgerArticleHash: ledger.articleHash || null, problems: problems.length, changes: final.applied.changes, kept: final.applied.kept, skipped, usage: usageTotal, seconds: Math.round((Date.now() - t0) / 100) / 10 }
  };
  return { outcome: 'fixed', draft: out, changes: final.applied.changes, kept: final.applied.kept, skipped, usage: usageTotal, problems: problems.length, attempts: attemptLog.length, wordsBefore: (draft.checks && draft.checks.stats && draft.checks.stats.words) || null, wordsAfter: finalCheck.stats && finalCheck.stats.words };
}

// The orchestrator's handler: (task, dataJson, workLog, deps) => outcome.
export async function runArticleFix(task, dataJson, _workLog, deps = {}) {
  tokensUsed = 0;
  const id = task && (task.entityId || (task.payload && task.payload.entryId));
  if (!id) return { result: { outcome: 'error', reason: 'article-fix needs entityId (the entry id)' }, summary: 'error: article-fix needs entityId' };
  let r;
  try { r = await fixDraft(id, { task, now: deps.now || new Date(), deps }); }
  catch (err) {
    if (err && err.deferred) throw err;
    return { result: { outcome: 'error', reason: String((err && err.message) || err).slice(0, 300) }, summary: 'error: ' + String((err && err.message) || err).slice(0, 200), provider: 'anthropic', tokensUsed };
  }
  if (r.outcome !== 'fixed') return { result: { outcome: r.outcome, reason: r.reason, skipped: r.skipped, attemptLog: r.attemptLog, usage: r.usage }, summary: r.outcome + ': ' + r.reason, provider: 'anthropic', tokensUsed };
  const path = writeDraftFile(r.draft, deps.draftsDir || DRAFTS_DIR);
  const n = a => r.changes.filter(c => c.action === a).length;
  return {
    result: { outcome: 'fixed', entryId: id, file: path, problems: r.problems, replaced: n('replace'), deleted: n('delete'), keptWithSupport: r.kept.length, skippedForThomas: r.skipped.length, attempts: r.attempts, words: { before: r.wordsBefore, after: r.wordsAfter }, usage: r.usage, model: r.usage.model, changes: r.changes, kept: r.kept, skipped: r.skipped },
    summary: 'fix pass for ' + id + ': ' + r.problems + ' problem sentence(s): ' + n('replace') + ' reworded, ' + n('delete') + ' removed, ' + r.kept.length + ' kept with a source passage, ' + r.skipped.length + ' left for Thomas; attempt ' + r.attempts + '. Run Thomas on the draft again.',
    provider: 'anthropic', tokensUsed, filesToCommit: [path]
  };
}

export const __test = { restoreAgeMarkers, collectProblems, applyEdits, buildFixSystem, sentencesOf, norm };
