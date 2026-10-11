// scripts/services/article-checks.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.1 — the checks CODE makes on a draft article, before it goes to Thomas or to Tom.
//
// Pure functions, no network. They enforce the rules in scripts/writer-rules.md (an excerpt of content-authoring-skill.md) that can be checked
// mechanically, so Augustine is not trusted to follow them and the work is not done by a model:
//   - no sentence over 40 words (the same limit the sentence-reword service enforces), average around 18-22 (reported, not enforced)
//   - the length tier: standard 600-750, major 900-1000 (never more than 1,000), lesser 400-600 words; a short article is allowed only when the sources are thin
//   - dates in American order, no ordinals, en dash in ranges, "c." not "circa" (quotations are exempt)
//   - quotations are word for word in a source, and attributed
//   - Quick Facts use the labels for the entry's type; an age at death is in one of the two allowed forms
//   - words that appear too often (scripts/writer-style.json), counted in the sections and the short description
//   - only the HTML tags the app allows
// Nothing here judges whether a fact is TRUE; that is Thomas's job (ledger-build).

export const wordCount = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// ---- text helpers ----
export const stripTags = s => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|li|blockquote)>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Words that end in a full stop without ending a sentence.
const ABBREV = ['St', 'Sts', 'Fr', 'Mt', 'Mr', 'Mrs', 'Ms', 'Dr', 'Jr', 'Sr', 'Bl', 'Bp', 'Abp', 'Msgr', 'Rev', 'Gen', 'Capt', 'vs', 'No', 'Nos', 'Vol', 'ch', 'cf', 'ca', 'c', 'e.g', 'i.e', 'a.m', 'p.m', 'A.D', 'B.C', 'Ps', 'Mt', 'Lk', 'Jn', 'Mk', 'Acts'];
const PLACE = '\u0001';

export function splitSentences(text) {
  let t = stripTags(text);
  for (const a of ABBREV) t = t.replace(new RegExp('\\b' + a.replace(/\./g, '\\.') + '\\.(?=\\s)', 'g'), a + PLACE);
  t = t.replace(/\b([A-Z])\.(?=\s+[A-Z])/g, '$1' + PLACE);                                   // initials: J. R. R.
  return t.split(/(?<=[.!?])["\u201D\u2019)]*\s+(?=["\u201C\u2018(]?[A-Z0-9])/).map(s => s.replace(new RegExp(PLACE, 'g'), '.').trim()).filter(Boolean);
}

export function sentenceReport(text, maxWords = 40) {
  const ss = splitSentences(text);
  const lens = ss.map(wordCount);
  const over = ss.filter((_s, i) => lens[i] > maxWords).map(s => ({ words: wordCount(s), text: s.slice(0, 120) + (s.length > 120 ? '…' : '') }));
  return { count: ss.length, over, max: Math.max(0, ...lens), avg: ss.length ? Math.round((lens.reduce((a, b) => a + b, 0) / ss.length) * 10) / 10 : 0 };
}

// Remove quotations so that rules which do not apply inside them are not checked there.
const outsideQuotes = s => String(s || '').replace(/\u201C[^\u201D]*\u201D/g, ' ').replace(/"[^"]*"/g, ' ');

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
export function dateViolations(text) {
  const t = outsideQuotes(stripTags(text));
  const out = [];
  const add = (rule, re) => { for (const m of t.matchAll(re)) out.push({ rule, text: m[0] }); };
  add('day before month (write "December 28")', new RegExp('\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:' + MONTHS + ')\\b', 'g'));
  add('ordinal on a date (write "December 28", not "28th")', new RegExp('\\b(?:' + MONTHS + ')\\s+\\d{1,2}(?:st|nd|rd|th)\\b', 'g'));
  add('"circa"/"ca." (write "c. 1020")', /\b(?:circa|ca\.)\s*\d+/gi);
  add('numeric date (write the month in words)', /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
  add('hyphen in a date range (use an en dash)', new RegExp('\\b(?:' + MONTHS + ')\\s+\\d{1,2}-\\d{1,2}\\b', 'g'));
  return out;
}

// ---- words used too often ----
export function styleViolations(text, limits) {
  const t = stripTags(text);
  const out = [];
  for (const l of limits || []) {
    let re;
    try { re = new RegExp(l.pattern, 'gi'); } catch (_e) { continue; }
    const n = (t.match(re) || []).length;
    if (n > l.maxPerArticle) out.push({ id: l.id, count: n, max: l.maxPerArticle, why: l.why || '', instead: Array.isArray(l.instead) ? l.instead : [] });
  }
  return out;
}

// ---- HTML ----
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'ul', 'ol', 'li', 'br', 'blockquote', 'a']);
export function htmlViolations(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) out.push('tag <' + tag + '> is not allowed');
    else if (tag === 'a' && !/^<\s*\//.test(m[0]) && !/href\s*=\s*["']https:\/\//i.test(m[2])) out.push('a link must have an https href');
    if (tag === 'a' && /href\s*=\s*["']entry:/i.test(m[2])) out.push('entry: links are not written by the writer');
  }
  return [...new Set(out)];
}

// ---- length tiers ----
export const BANDS = { major: { min: 900, max: 1000 }, standard: { min: 600, max: 750 }, lesser: { min: 400, max: 600 } };

// payload.length wins; otherwise the entry's explicit tier (1 major, 2 standard, 3 lesser); otherwise standard. Thin sources only ever lower the band.
export function lengthTier({ requested, entryTier, sourceWords }) {
  let tier = ['major', 'standard', 'lesser'].includes(requested) ? requested : ({ 1: 'major', 2: 'standard', 3: 'lesser' }[entryTier] || 'standard');
  if (!requested && sourceWords != null && sourceWords < 2500) tier = 'lesser';
  else if (!requested && sourceWords != null && sourceWords < 4500 && tier === 'major') tier = 'standard';
  return { tier, ...BANDS[tier] };
}

// ---- quotations ----
const foldQuote = s => String(s || '').normalize('NFC').replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"').replace(/[\u2013\u2014\u2212]/g, '-')
  .replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
// Is this quotation, word for word (apart from quote marks, dashes, spacing and case), in one of the source texts? Returns the source's n or 0.
export function quoteSource(quote, sources) {
  const q = foldQuote(quote).replace(/^["']|["']$/g, '');
  if (q.length < 8) return 0;
  for (const s of sources) if (foldQuote(s.text).includes(q)) return s.n;
  return 0;
}

// ---- Quick Facts ----
export const FACT_LABELS = {
  s: ['Feast day', 'Born', 'Died', 'Title', 'Beatified', 'Canonized', 'Patronage', 'Religious order', 'Major works', 'Attributes in art'],
  c: ['Ecumenical number', 'Convoked by', 'Location', 'Dates', 'Condemned', 'Defined', 'Key documents', 'Sessions'],
  p: ['Regime or ruler', 'Region', 'Span of years', 'Cause', 'Notable martyrs', 'Estimated toll', 'Ended by'],
  m: ['Seer(s)', 'Location', 'Date(s)', 'Title of Our Lady', 'Words/message', 'Approval status', 'Feast day', 'Shrine'],
  u: ['Location', 'Date', 'What occurred', 'Scientific findings', 'Approval status', 'Where venerated'],
  e: ['Date', 'Location', 'Key figures', 'Significance', 'Related document or decree']
};

export function factViolations(type, facts) {
  const out = [];
  const allowed = FACT_LABELS[type];
  const seen = new Set();
  for (const f of facts || []) {
    const label = String((f && f.label) || '').trim(), value = String((f && f.value) || '').trim();
    if (!label || !value) { out.push('a Quick Fact with an empty label or value'); continue; }
    if (allowed && !allowed.includes(label)) out.push('Quick Fact label "' + label + '" is not one of: ' + allowed.join(', '));
    if (seen.has(label)) out.push('Quick Fact "' + label + '" appears twice');
    seen.add(label);
    if (value.length > 160) out.push('Quick Fact "' + label + '" is too long (keep each value short)');
    if (label === 'Died' && /age/i.test(value) && !/\((?:at age|estimated age) \d{1,3}\)\s*$/.test(value)) out.push('"Died" age must end "(at age N)" or "(estimated age N)"');
    for (const v of dateViolations(value)) out.push('Quick Fact "' + label + '": ' + v.rule + ' ("' + v.text + '")');
  }
  return out;
}

// ---- the whole draft ----
// draft: { d, sections: [{h, b}], quotes: [{text, source}], facts: [{label, value}] }; opts: { type, band, limits, sources: [{n, text}], sourceWords }
export function checkDraft(draft, opts) {
  const v = [];
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const body = sections.map(s => stripTags(s && s.b)).join(' ');
  const words = wordCount(body);
  const band = opts.band;

  if (sections.length < 4 || sections.length > 8) v.push({ rule: 'sections', text: 'there are ' + sections.length + ' sections; expected 5 to 7 (never fewer than 4 or more than 8)' });
  sections.forEach((s, i) => { if (!s || !String(s.h || '').trim() || !String(s.b || '').trim()) v.push({ rule: 'sections', text: 'section ' + (i + 1) + ' has no heading or no text' }); });
  if (words > band.max) v.push({ rule: 'length', text: 'the article is ' + words + ' words; the limit for this tier is ' + band.max + ' (never exceed it)' });
  const thin = opts.sourceWords != null && opts.sourceWords < 3000;
  if (words < band.min && !thin) v.push({ rule: 'length', text: 'the article is ' + words + ' words; the target for this tier is ' + band.min + ' to ' + band.max });

  const sr = sentenceReport(body, 40);
  for (const s of sr.over) v.push({ rule: 'sentence', text: s.words + ' words (limit 40): "' + s.text + '"' });
  const dsr = sentenceReport(draft.d || '', 40);
  if (!String(draft.d || '').trim()) v.push({ rule: 'description', text: 'the short description is empty' });
  else if (wordCount(draft.d) > 60) v.push({ rule: 'description', text: 'the short description is ' + wordCount(draft.d) + ' words; keep it to one or two sentences' });
  for (const s of dsr.over) v.push({ rule: 'sentence', text: 'short description sentence of ' + s.words + ' words' });

  for (const d of dateViolations(body + ' ' + (draft.d || ''))) v.push({ rule: 'date', text: d.rule + ': "' + d.text + '"' });
  for (const sv of styleViolations(body + ' ' + (draft.d || ''), opts.limits)) v.push({ rule: 'style', text: '"' + sv.id + '" appears ' + sv.count + ' times; the limit is ' + sv.max + '. Use other wording for the extra uses' + (sv.instead.length ? ', for example: ' + sv.instead.join(', ') : '') + '.' });
  sections.forEach((s, i) => { for (const h of htmlViolations(s && s.b)) v.push({ rule: 'html', text: 'section ' + (i + 1) + ': ' + h }); });
  for (const f of factViolations(opts.type, draft.facts)) v.push({ rule: 'facts', text: f });

  const quotes = Array.isArray(draft.quotes) ? draft.quotes : [];
  if (quotes.length > 4) v.push({ rule: 'quotes', text: quotes.length + ' quotations; the limit is 4' });
  quotes.forEach((q, i) => {
    if (!q || !String(q.text || '').trim()) { v.push({ rule: 'quotes', text: 'quotation ' + (i + 1) + ' is empty' }); return; }
    if (!String(q.source || '').trim()) v.push({ rule: 'quotes', text: 'quotation ' + (i + 1) + ' has no attribution' });
    if (!quoteSource(q.text, opts.sources || [])) v.push({ rule: 'quotes', text: 'quotation ' + (i + 1) + ' is not word for word in any source: "' + String(q.text).slice(0, 80) + '"' });
  });

  return { violations: v, stats: { words, sections: sections.length, sentences: sr.count, maxSentence: sr.max, avgSentence: sr.avg, quotes: quotes.length, facts: (draft.facts || []).length } };
}
