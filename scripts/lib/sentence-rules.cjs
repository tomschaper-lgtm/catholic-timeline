/* ============================================================================
   sentence-rules.cjs
   VERSION: 2
   DATE: 2026-09-28

   THE one definition of "word", "sentence" and "long sentence" for Catholic
   Timeline. Every counter in the app (Add Task picker, reword service, review
   screen, Progress, Proof section / Audio lock, Export) must call this file
   and nothing else. Do not write a second splitter anywhere.

   RULES
   1. Scope: art.sections[].b only. Never quotes, facts, headings, links.
   2. A word is a piece of text between spaces that contains at least one
      letter or digit. Hyphenated words, en-dash ranges (64–67) and words
      joined by an unspaced em dash (districts—a) are ONE word. A lone dash
      or symbol is not a word. HTML tags are ignored; entities (&amp;
      &nbsp; ...) are decoded first. (To count unspaced em-dash words as two,
      set SPLIT_EM_DASH = true below; nothing else changes.)
   3. A sentence ends at . ! ? or … (also runs like ?! and ...), followed by
      any closing quotes / brackets, then a space, then a capital letter,
      digit or opening quote/bracket. A lowercase next word means the
      sentence continues (He asked "Who?" and left.)
   4. Not a sentence end: after an abbreviation (St. Sts. Dr. Fr. Mt. No. vs.
      c. b. d. r. A.D. e.g. i.e. months before a date, single initials).
      Roman numerals do end a sentence (Pope Pius X. He ...).
   5. Hard breaks: a blank line, a newline, and every <p> <br> <ul> <ol> <li>
      <blockquote> boundary end a sentence. A list item is its own unit, so
      a list is never one long sentence.
   6. Long means MORE than 40 words. Exactly 40 is fine.
   7. Colons and semicolons never end a sentence.

   Works in the browser (paste this whole block into index.html, global
   `SentenceRules`) and in Node (import SR from './sentence-rules.cjs').
   ============================================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SentenceRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 2;
  var LIMIT = 40;
  var SPLIT_EM_DASH = false;
  var BREAK = '\u0001';

  var TAG_AT = /<\/?[A-Za-z][^<>\n]*>/y;
  var BLOCK_TAG = /^<\/?(ul|ol|li|blockquote|p|br|div|h[1-6])\b/i;

  var ABBR = {};
  ('St Sts Mt Mts Dr Mr Mrs Ms Fr Bl Bp Abp Msgr Sr Jr Rev Revd Hon Gen Lt Col Capt Sgt ' +
   'Prof Pres Gov Card Ven Br Sen Rep No Nos Vol Vols Ch Chap Art Sec Fig Pp Pl ' +
   'vs cf Cf ca ff fl viz approx ' +
   'Ibid ibid Op op cit')
    .split(' ').forEach(function (a) { ABBR[a] = 1; });
  var MONTH = {};
  'Jan Feb Mar Apr Jun Jul Aug Sept Sep Oct Nov Dec'.split(' ').forEach(function (a) { MONTH[a] = 1; });

  var ENT = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d'
  };

  function decodeEntity(name) {
    if (name.charAt(0) === '#') {
      var code = name.charAt(1).toLowerCase() === 'x'
        ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (!isFinite(code) || code <= 0 || code > 0x10ffff) return null;
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(ENT, name.toLowerCase()) ? ENT[name.toLowerCase()] : null;
  }

  /* raw HTML -> plain text, remembering where every plain character came
     from in the raw string. Block tags and newlines become BREAK. */
  function toPlain(raw) {
    var chars = [], start = [], endp = [];
    var i = 0, n = raw.length;
    while (i < n) {
      var c = raw.charAt(i);
      if (c === '<') {
        /* a tag never contains < or >, so a stray "<" (or a broken "</b.") is
           kept as ordinary text instead of swallowing words up to some later ">" */
        TAG_AT.lastIndex = i;
        var tm = TAG_AT.exec(raw);
        if (tm) {
          if (BLOCK_TAG.test(tm[0])) { chars.push(BREAK); start.push(i); endp.push(i + tm[0].length); }
          i += tm[0].length;
          continue;
        }
      }
      if (c === '\n' || c === '\r') { chars.push(BREAK); start.push(i); endp.push(i + 1); i++; continue; }
      if (c === '&') {
        var m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(raw.substr(i, 12));
        if (m) {
          var d = decodeEntity(m[1]);
          if (d !== null) {
            for (var k = 0; k < d.length; k++) { chars.push(d.charAt(k)); start.push(i); endp.push(i + m[0].length); }
            i += m[0].length;
            continue;
          }
        }
      }
      chars.push(c); start.push(i); endp.push(i + 1); i++;
    }
    start.push(n);
    return { text: chars.join(''), start: start, endp: endp };
  }

  /* ---- words ---------------------------------------------------------- */
  var HAS_LD = /[\p{L}\p{N}]/u;
  function countWords(text) {
    var plain = toPlain(String(text)).text.split(BREAK).join(' ');
    var toks = plain.replace(/\u00a0/g, ' ').split(SPLIT_EM_DASH ? /[\s\u2014]+/ : /\s+/);
    var n = 0;
    for (var i = 0; i < toks.length; i++) if (HAS_LD.test(toks[i])) n++;
    return n;
  }
  function isLongWords(n) { return n > LIMIT; }

  /* ---- sentences ------------------------------------------------------ */
  var NEXT_OK = /[\p{Lu}\p{N}"\u201c\u2018(\[\u00ab]/u;

  function isAbbrev(tok, next) {
    if (!tok) return false;
    if (ABBR[tok]) return true;
    if (MONTH[tok] && /[0-9]/.test(next)) return true;
    if (/^[a-z]$/.test(tok)) return true;                       // b. d. r. c.
    if (/^[A-Z]$/.test(tok) && !/[IVXLCDM]/.test(tok)) return true;   // initials
    if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(tok)) return true;     // A.D  i.e  e.g  U.S
    return false;
  }

  function splitSegment(seg, off, out) {
    var re = /([.!?\u2026]+)(["\u201d\u2019\u00bb)\]]*)(\s+)/g;
    var last = 0, m;
    while ((m = re.exec(seg))) {
      var after = re.lastIndex;
      if (after >= seg.length) break;
      var next = seg.charAt(after);
      if (!NEXT_OK.test(next)) continue;
      if (m[1] === '.' && !m[2]) {
        var pre = seg.slice(last, m.index);
        var tm = /([^\s"\u201c\u2018(\[]+)$/.exec(pre);
        if (isAbbrev(tm ? tm[1] : '', next)) continue;
      }
      out.push([off + last, off + m.index + m[1].length + m[2].length]);
      last = after;
    }
    out.push([off + last, off + seg.length]);
  }

  /* Split one raw HTML string. Returns
     [{ text, html, words, start, end }] where start/end are offsets in `raw`. */
  var CACHE = new Map(), CACHE_MAX = 6000;
  function analyzeSection(raw) {
    raw = raw == null ? '' : String(raw);
    var hit = CACHE.get(raw);
    if (!hit) {
      hit = analyzeSectionUncached(raw);
      if (CACHE.size >= CACHE_MAX) CACHE.clear();
      CACHE.set(raw, hit);
    }
    return hit.map(function (x) { return { text: x.text, html: x.html, words: x.words, start: x.start, end: x.end }; });
  }
  function analyzeSectionUncached(raw) {
    var p = toPlain(raw), P = p.text, ranges = [], segStart = 0, i;
    for (i = 0; i <= P.length; i++) {
      if (i === P.length || P.charAt(i) === BREAK) {
        if (i > segStart) splitSegment(P.slice(segStart, i), segStart, ranges);
        segStart = i + 1;
      }
    }
    var res = [];
    for (i = 0; i < ranges.length; i++) {
      var a = ranges[i][0], b = ranges[i][1];
      while (a < b && /\s/.test(P.charAt(a))) a++;
      while (b > a && /\s/.test(P.charAt(b - 1))) b--;
      var text = P.slice(a, b);
      if (!HAS_LD.test(text)) continue;
      var rs = a > 0 ? p.endp[a - 1] : 0, re2 = p.start[b];
      res.push({ text: text, html: raw.slice(rs, re2), words: countWords(text), start: rs, end: re2 });
    }
    return res;
  }

  function longestQuotedSpan(text) {
    var best = 0, re = /[\u201c"]([^\u201d"]+)[\u201d"]/g, m;
    while ((m = re.exec(text))) best = Math.max(best, countWords(m[1]));
    return best;
  }

  /* Whole entry. Only art.sections[].b is counted. */
  function analyzeEntry(entry) {
    var secs = (entry && entry.art && entry.art.sections) || [];
    var sentences = [], words = 0;
    for (var s = 0; s < secs.length; s++) {
      var list = analyzeSection(secs[s] && secs[s].b);
      for (var k = 0; k < list.length; k++) {
        list[k].sec = s;
        list[k].quotedWords = longestQuotedSpan(list[k].text);
        words += list[k].words;
        sentences.push(list[k]);
      }
    }
    var long = sentences.filter(function (x) { return isLongWords(x.words); });
    var longest = null;
    for (var q = 0; q < sentences.length; q++) if (!longest || sentences[q].words > longest.words) longest = sentences[q];
    return {
      sentences: sentences, long: long, longest: longest,
      longestWords: longest ? longest.words : 0,
      hasLong: long.length > 0,
      wordCount: words, sectionCount: secs.length
    };
  }

  /* Total words in the article body (sections only), same word rule as above.
     Cheaper than analyzeEntry when only the total is needed. */
  function articleWordCount(entry) {
    var secs = (entry && entry.art && entry.art.sections) || [];
    return countWords(secs.map(function (x) { return x && x.b ? x.b : ''; }).join('\n'));
  }

  /* convenience names matching the existing app functions */
  function paragraphHasLongSentence(html) {
    return analyzeSection(html).some(function (x) { return isLongWords(x.words); });
  }
  function entryHasLongSentence(entry) { return analyzeEntry(entry).hasLong; }
  function splitSentences(html) { return analyzeSection(html).map(function (x) { return x.html; }); }

  return {
    VERSION: VERSION, LIMIT: LIMIT,
    countWords: countWords, isLongWords: isLongWords, articleWordCount: articleWordCount,
    analyzeSection: analyzeSection, analyzeEntry: analyzeEntry,
    paragraphHasLongSentence: paragraphHasLongSentence,
    entryHasLongSentence: entryHasLongSentence,
    splitSentences: splitSentences
  };
});
