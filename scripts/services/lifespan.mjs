// scripts/services/lifespan.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.1 — "How old was he when he died?": read the Born and Died facts, work out the age, and say how sure we are.
//
// Tom (2026-10-09): for saints and other people, get birth and death dates or years; where a date is a little fuzzy, ESTIMATE the age at death ("died at about
// 87"), because the reader wants to know whether he died old or young and should not have to do the sum; being a year or two out does not matter.
//
// The rules are the ones already in the authoring skill ("Age at death"), made exact and given a tolerance:
//   - both FULL dates (month and day at both ends, no "c.", no range) -> exact: "(at age N)", one less if the birthday had not come yet
//   - otherwise from the years -> "(estimated age N)"; a range or "c." gives an earliest and a latest possible age and the MIDPOINT, rounded down
//   - TOLERANCE: if the earliest and latest possible ages are more than maxSpread years apart (default 6, "a year or two out" each way) no age is given at all,
//     because a guess that wide would mislead; the caller records why
//   - no birth year (or a century only) -> no age; an age under 0 or over 125 -> refused as implausible
//   - crossing BC to AD there is no year 0: 4 BC to AD 30 is 33
// Pure functions, no network, no model: the arithmetic is code's, never a model's.

export const DEFAULT_MAX_SPREAD = 6;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = '(January|February|March|April|May|June|July|August|September|October|November|December)';

// Text like "November 13, 354, Thagaste, North Africa", "c. 1020/1025, Tuscany", "c. 64\u201367, Rome", "c. 107 (between 98 and 117), Rome", "4 BC".
// Returns { y1, y2, circa, month, day, bc, full } or null when no year can be read (a century, or no number at all).
export function parseDateText(text) {
  let t = String(text || '').trim();
  if (!t || /century|millennium/i.test(t)) return null;
  const adPrefix = /\b(?:AD|A\.D\.)\s+(?=\d)/i.test(t);
  t = t.replace(/\b(?:AD|A\.D\.)\s+(?=\d)/i, '');                                    // "AD 30" reads the same as "30"
  const circa = /(?:\bc\.|\bca\.|\b(?:circa|about|around|approximately|traditionally|by tradition|possibly|probably)\b)/i.test(t);
  const bcAt = s => /\bBC\b|\bB\.C\./i.test(s);

  // an explicit "(between A and B)" or "(A or B)" beats the single year before it
  const between = /\((?:between|from)\s+(\d{1,4})\s+(?:and|to|\u2013|-)\s+(\d{1,4})\)/i.exec(t);
  if (between) { const a = +between[1], b = +between[2]; return { y1: Math.min(a, b), y2: Math.max(a, b), circa: true, month: null, day: null, bc: bcAt(t), full: false }; }

  // "January 1 or 2, 379", "June 8-9, 597", "May 30-June 2, 1431": the day is uncertain or spans days, the year is not
  const dayAlt = new RegExp('\\b' + MON_RE + '\\s+\\d{1,2}\\s*(?:or|/|[\\u2013\\u2014-])\\s*(?:' + MON_RE + '\\s+)?\\d{1,2},\\s*(\\d{1,4})\\b', 'i').exec(t);
  if (dayAlt) return { y1: +dayAlt[3], y2: +dayAlt[3], circa, month: MONTHS.indexOf(dayAlt[1].toLowerCase()) + 1, day: null, bc: bcAt(t.slice(dayAlt.index, dayAlt.index + dayAlt[0].length + 8)), full: false };
  const mdy = new RegExp('\\b' + MON_RE + '\\s+(\\d{1,2}),\\s*(\\d{1,4})\\b', 'i').exec(t);
  if (mdy) {
    const after = t.slice(mdy.index + mdy[0].length);
    const bc = bcAt(t.slice(mdy.index, mdy.index + mdy[0].length + 8));
    const y1 = +mdy[3];
    const dbl = /^\s*\/\s*(\d{2,4})(?!\d)/.exec(after);                         // "1499/1500": old and new style, so the year itself is not certain
    if (dbl) { const y2 = dbl[1].length === 2 ? Math.floor(y1 / 100) * 100 + +dbl[1] : +dbl[1]; return { y1: Math.min(y1, y2), y2: Math.max(y1, y2), circa: true, month: MONTHS.indexOf(mdy[1].toLowerCase()) + 1, day: +mdy[2], bc, full: false }; }
    return { y1, y2: y1, circa, month: MONTHS.indexOf(mdy[1].toLowerCase()) + 1, day: +mdy[2], bc, full: !circa };
  }
  const my = new RegExp('\\b' + MON_RE + '\\s+(\\d{3,4})\\b', 'i').exec(t);                  // "December 1065": a month but no day
  if (my) return { y1: +my[2], y2: +my[2], circa, month: MONTHS.indexOf(my[1].toLowerCase()) + 1, day: null, bc: bcAt(t.slice(my.index, my.index + my[0].length + 8)), full: false };

  const range = /(?:^|[^\d])(\d{1,4})\s*(?:[\u2013\u2014\-/]|\bto\b|\bor\b)\s*(\d{1,4})(?!\d)/i.exec(t);
  if (range && +range[1] !== +range[2] && Math.abs(+range[2] - +range[1]) < 200) {
    const a = +range[1], b = +range[2];
    const bc = bcAt(t.slice(range.index, range.index + range[0].length + 8));
    return { y1: Math.min(a, b), y2: Math.max(a, b), circa: true, month: null, day: null, bc, full: false };
  }
  const y = /(?:^|[^\d\w])(\d{1,4})(?!\d)(?:\s*(BC|AD|B\.C\.|A\.D\.))?/i.exec(t);
  if (y) {
    const bc = /^b/i.test(y[2] || '');
    // a lone small number is not a year unless it is marked BC/AD or follows "c."; this keeps "Pope Pius X" and "1st" out
    if (!(y[2] || adPrefix || circa || +y[1] >= 100)) return null;
    return { y1: +y[1], y2: +y[1], circa, month: null, day: null, bc, full: false };
  }
  return null;
}

// BC years have no year 0, so 1 BC is astronomical year 0, 2 BC is -1, and so on.
const astro = (y, bc) => (bc ? -(y - 1) : y);

// Age at death from two parsed dates. Returns { age, kind: 'exact' | 'estimated', min, max, spread } or { age: null, reason }.
export function ageAtDeath(born, died, { maxSpread = DEFAULT_MAX_SPREAD } = {}) {
  if (!born) return { age: null, reason: 'no birth year' };
  if (!died) return { age: null, reason: 'no death year' };
  const b1 = astro(born.y1, born.bc), b2 = astro(born.y2, born.bc), d1 = astro(died.y1, died.bc), d2 = astro(died.y2, died.bc);
  const sameCal = true;
  if (born.full && died.full && sameCal) {
    let age = d1 - b1;
    if (died.month < born.month || (died.month === born.month && died.day < born.day)) age -= 1;
    if (age < 0 || age > 125) return { age: null, reason: 'implausible age (' + age + ')' };
    return { age, kind: 'exact', min: age, max: age, spread: 0 };
  }
  const min = d1 - b2, max = d2 - b1;
  if (min < 0 && max < 0) return { age: null, reason: 'the death comes before the birth' };
  const spread = max - min;
  if (spread > maxSpread) return { age: null, reason: 'dates too uncertain (the age could be anywhere from ' + Math.max(min, 0) + ' to ' + max + ')', min, max, spread };
  const age = Math.floor((Math.max(min, 0) + max) / 2);
  if (age < 0 || age > 125) return { age: null, reason: 'implausible age (' + age + ')' };
  return { age, kind: 'estimated', min, max, spread };
}

export const ageSuffix = r => (r && r.age != null ? (r.kind === 'exact' ? ' (at age ' + r.age + ')' : ' (estimated age ' + r.age + ')') : '');
export const AGE_SUFFIX_RE = /\s*\((?:at age|estimated age|traditionally at age|aged?)\s+\d{1,3}\)\s*$/i;
export const stripAge = v => String(v || '').replace(AGE_SUFFIX_RE, '').trim();

// ---- from a facts array ----
const factOf = (facts, label) => { const f = (facts || []).find(x => x && String(x.label || '').trim().toLowerCase() === label.toLowerCase()); return f ? String(f.value || '').trim() : null; };

export function lifespanFromFacts(facts, opts = {}) {
  const bornText = factOf(facts, 'Born'), diedText = factOf(facts, 'Died');
  if (diedText == null) return { age: null, reason: 'no Died fact', bornText, diedText };
  const died = stripAge(diedText);                                  // an age already written there is not part of the date
  const r = ageAtDeath(parseDateText(bornText), parseDateText(died), opts);
  return { ...r, bornText, diedText: died };
}

// Put the computed age on the Died fact (replacing any age already there); returns the new facts array and the result. Facts with no computable age are left as they are,
// except that an age the model wrote which we cannot back up is removed: a number nobody can check is worse than none.
export function applyAgeToFacts(facts, opts = {}) {
  const r = lifespanFromFacts(facts, opts);
  const out = (facts || []).map(f => ({ ...f }));
  const d = out.find(f => f && String(f.label || '').trim().toLowerCase() === 'died');
  if (d) {
    const base = stripAge(d.value);
    d.value = r.age != null ? base + ageSuffix(r) : base;
  }
  return { facts: out, lifespan: r };
}

// ---- the age in the narrative (what a listener hears) ----
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  return String(n);
}
const NOT_MORE = '(?![-\\s]?(?:one|two|three|four|five|six|seven|eight|nine)\\b)';                 // "forty" must not match inside "forty-four"
const alt = n => '(?:' + [String(n), numberWords(n), numberWords(n).replace('-', ' ')].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')' + NOT_MORE;

// Does the text say this age? "at about seventy-five", "aged 75", "at the age of 75", "75 years old", "in his seventy-sixth year" is NOT accepted (it means 75, but is easy to misread).
export function ageMentioned(text, n) {
  const a = alt(n);
  const re = new RegExp('\\b(?:(?:at|aged|age of|at the age of|when he was|when she was)\\s+(?:about |approximately |nearly |roughly |around |some |almost )?' + a + '\\b|' + a + '\\s+years?\\s+(?:old|of age)\\b|(?:about|approximately|nearly|roughly|around|almost)\\s+' + a + '\\b(?=[^.]{0,20}(?:years?|age|old)))', 'i');
  return re.test(String(text || ''));
}

// Any age the text states, as a number (digits or words), so a WRONG one can be reported. Returns an array of numbers.
export function agesStated(text) {
  const out = [];
  const words = Array.from({ length: 121 }, (_v, i) => i).map(i => [i, numberWords(i)]);
  const t = String(text || '');
  for (const m of t.matchAll(/\b(?:at the age of|at age|aged|age of|at about the age of)\s+(?:about |approximately |nearly |roughly |around |some |almost )?(\d{1,3})\b/gi)) out.push(+m[1]);
  for (const m of t.matchAll(/\b(\d{1,3})\s+years?\s+(?:old|of age)\b/gi)) out.push(+m[1]);
  for (const [n, w] of words) {
    if (n < 10) continue;
    const re = new RegExp('\\b(?:at the age of|at age|aged|age of|at about|at nearly|at almost|at around|at roughly)\\s+(?:about |approximately |nearly |roughly |around |almost )?(?:' + w.replace('-', '[- ]') + ')\\b' + NOT_MORE, 'i');
    if (re.test(t)) out.push(n);
  }
  return [...new Set(out)];
}
