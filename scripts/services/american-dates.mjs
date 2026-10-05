// ---- American date order (2026-10-04) --------------------------------------------------------
// "28 December 1065" -> "December 28, 1065" (comma after the year when the sentence goes on),
// "13 October" -> "October 13", "28-30 December 1065" -> "December 28-30, 1065", "28th December"
// -> "December 28". Text inside quotation marks is left exactly as written (quoted sources).
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DAY = '(?:[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?';
const DATE_RE = new RegExp('\\b(' + DAY + ')(?:\\s*([\\u2013\\u2014-]|to|and)\\s*(' + DAY + '))?\\s+(' + MONTHS + ')\\b(?:,?\\s+(\\d{3,4}(?!\\d)|\\d{1,2}(?=\\s*(?:BC|AD|B\\.C\\.|A\\.D\\.)))(\\s*(?:BC|AD|B\\.C\\.|A\\.D\\.)(?![A-Za-z]))?)?', 'g');
const plainDay = (d) => String(parseInt(d, 10));
function convertSegment(seg){
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
    return s;
  });
  return { out, n };
}
export function americanDates(text){
  if(!text || typeof text !== 'string') return { text, n: 0 };
  // leave anything in quotation marks alone; also skip HTML tags
  const parts = text.split(/(\u201c[^\u201d]*\u201d|"[^"\n]*"|<[^>]*>)/);
  let n = 0;
  const out = parts.map((p, i) => {
    if(i % 2 === 1) return p;
    const r = convertSegment(p); n += r.n; return r.out;
  }).join('');
  return { text: out, n };
}
// Apply to everything the article shows and narrates except the quotes from sources.
export function americanizeEntryDates(entry){
  let n = 0;
  const fix = (s) => { const r = americanDates(s); n += r.n; return r.text; };
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
