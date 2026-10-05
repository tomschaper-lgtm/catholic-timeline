// ---- American date order (2026-10-04) --------------------------------------------------------
// "28 December 1065" -> "December 28, 1065" (comma after the year when the sentence goes on),
// "13 October" -> "October 13", "28-30 December 1065" -> "December 28-30, 1065", "28th December"
// -> "December 28". Text inside quotation marks is left exactly as written (quoted sources).
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DAY = '(?:[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?';
const DATE_RE = new RegExp('\\b(' + DAY + ')(?:\\s*([\\u2013\\u2014-]|to|and)\\s*(' + DAY + '))?\\s+(' + MONTHS + ')\\b(?:,?\\s+(\\d{3,4}(?!\\d)|\\d{1,2}(?=\\s*(?:BC|AD|B\\.C\\.|A\\.D\\.)))(\\s*(?:BC|AD|B\\.C\\.|A\\.D\\.)(?![A-Za-z]))?)?', 'g');
const plainDay = (d) => String(parseInt(d, 10));
function convertSegment(seg, log){
  let n = 0;
  const out = seg.replace(DATE_RE, (m, d1, sep, d2, month, year, era, offset, whole) => {
    n++;
    let s = month + ' ' + plainDay(d1);
    if(d2) s += (sep === 'to' || sep === 'and' ? ' ' + sep + ' ' : sep) + plainDay(d2);
    if(year){
      s += ', ' + year + (era || '');
      const after = whole.slice(offset + m.length);
      if(/^\s+[A-Za-z(\u2018\u201c]/.test(after)) s += ',';   // "...1065, the abbey" (American style, also before "and")
    }
    if(log) log.push({ from: m, to: s.replace(/,$/, '') });   // optional: what changed (for reports)
    return s;
  });
  return { out, n };
}
export function americanDates(text, log){
  if(!text || typeof text !== 'string') return { text, n: 0 };
  // leave anything in quotation marks alone; also skip HTML tags
  const parts = text.split(/(\u201c[^\u201d]*\u201d|"[^"\n]*"|<[^>]*>)/);
  let n = 0;
  const out = parts.map((p, i) => {
    if(i % 2 === 1) return p;
    const r = convertSegment(p, log); n += r.n; return r.out;
  }).join('');
  return { text: out, n };
}
// Apply to everything the article shows and narrates except the quotes from sources.
export function americanizeEntryDates(entry, log){
  let n = 0;
  const fix = (s) => { const r = americanDates(s, log); n += r.n; return r.text; };
  if(typeof entry.d === 'string') entry.d = fix(entry.d);
  for(const sec of ((entry.art && entry.art.sections) || [])){
    if(typeof sec.h === 'string') sec.h = fix(sec.h);
    if(typeof sec.b === 'string') sec.b = fix(sec.b);
  }
  for(const f of (Array.isArray(entry.facts) ? entry.facts : [])){
    if(f && typeof f.value === 'string') f.value = fix(f.value);
  }
  return n;
}

// ---- Spoken dates (2026-10-05): "October 3, 1952" is SAID "October third, 1952" ---------------
// Used only on the text sent to the voice — the article keeps "October 3". Handles "June 8–9"
// ("June eighth to ninth") and "May 4 and 6" ("May fourth and sixth"). Returns null if no date
// starts at position i, else { len, say } — how many characters it covers and what to say.
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth',
  'twentieth', 'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth',
  'twenty-seventh', 'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first'];
const SPOKEN_DATE_RE = new RegExp('(' + MONTHS + ') ([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:\\s*([\\u2013\\u2014-]|to|and|or)\\s*([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?)?(?![\\d\\w])', 'y');
export function spokenDateAt(text, i){
  SPOKEN_DATE_RE.lastIndex = i;
  const m = SPOKEN_DATE_RE.exec(text);
  if(!m) return null;
  let say = m[1] + ' ' + ORD[+m[2]];
  if(m[4]) say += ' ' + (/[\u2013\u2014-]/.test(m[3]) ? 'to' : m[3]) + ' ' + ORD[+m[4]];
  return { len: m[0].length, say };
}
