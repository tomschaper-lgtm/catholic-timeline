// scripts/tests/article-checks.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/article-checks.mjs v0.1 (pure functions; no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wordCount, stripTags, splitSentences, sentenceReport, dateViolations, styleViolations, htmlViolations, lengthTier, BANDS, quoteSource, FACT_LABELS, factViolations, checkDraft } from '../services/article-checks.mjs';

const STYLE = JSON.parse(readFileSync(fileURLToPath(new URL('../writer-style.json', import.meta.url)), 'utf8'));
const words = n => Array.from({ length: n }, (_v, i) => 'word' + (i % 7)).join(' ');
// A sentence of exactly n words, ending with a full stop.
const sentence = n => 'The ' + Array.from({ length: n - 1 }, () => 'saint').join(' ') + '.';

test('wordCount and stripTags', () => {
  assert.equal(wordCount('  one two\nthree  '), 3);
  assert.equal(wordCount(''), 0);
  assert.equal(stripTags('<p>Hello&nbsp;<b>world</b></p><br/>again &amp; more'), 'Hello world . again & more');
});

test('splitSentences: abbreviations, initials and numbered titles do not end a sentence', () => {
  assert.deepEqual(splitSentences('St. Augustine was born in Tagaste. He met Fr. Simplicianus in Milan.'), ['St. Augustine was born in Tagaste.', 'He met Fr. Simplicianus in Milan.']);
  assert.deepEqual(splitSentences('J. R. R. Tolkien admired him. The council met at Nicaea.'), ['J. R. R. Tolkien admired him.', 'The council met at Nicaea.']);
  assert.equal(splitSentences('He died c. 430 in Hippo. Many mourned.').length, 2);
  assert.equal(splitSentences('He asked, "Who are you?" She said nothing. He left.').length, 3);
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  assert.equal(splitSentences('<p>First sentence here.</p><p>Second one follows.</p>').length, 2);
});

test('sentenceReport: finds the over-long sentences and reports the average', () => {
  const r = sentenceReport(sentence(20) + ' ' + sentence(41) + ' ' + sentence(10), 40);
  assert.equal(r.count, 3);
  assert.equal(r.over.length, 1);
  assert.equal(r.over[0].words, 41);
  assert.equal(r.max, 41);
  assert.equal(r.avg, 23.7);
  assert.equal(sentenceReport(sentence(40), 40).over.length, 0);            // 40 is allowed
  assert.deepEqual(sentenceReport('', 40), { count: 0, over: [], max: 0, avg: 0 });
});

test('dateViolations: each wrong form is found; the right forms and quotations are not', () => {
  const bad = t => dateViolations(t).map(v => v.text);
  assert.deepEqual(bad('He died on 28 December 1065 in Rome.'), ['28 December']);
  assert.deepEqual(bad('On the 3rd of May the relics came.'), ['3rd of May']);
  assert.deepEqual(bad('He died on December 28th.'), ['December 28th']);
  assert.deepEqual(bad('Born circa 1020 and died ca. 1085.'), ['circa 1020', 'ca. 1085']);
  assert.deepEqual(bad('Signed 12/28/1065 at the abbey.'), ['12/28/1065']);
  assert.deepEqual(bad('They met June 8-9, 597.'), ['June 8-9']);
  assert.deepEqual(bad('He died on December 28, 1065. The feast is October 13. Born c. 1020. They met June 8\u20139, 597. In May 1431 the court met.'), []);
  assert.deepEqual(bad('The chronicle says \u201COn 28 December 1065 the church was hallowed\u201D and that is all.'), []);
  assert.deepEqual(bad('The chronicle says "On 28 December 1065 the church was hallowed" and that is all.'), []);
});

test('styleViolations: "quietly" once is fine, twice is over; the family limit counts every form; the limits file ships with synonyms', () => {
  const one = 'He prayed quietly. The room was still.';
  assert.deepEqual(styleViolations(one, STYLE.limits), []);
  const two = 'He prayed quietly. She quietly left.';
  const v = styleViolations(two, STYLE.limits);
  assert.deepEqual(v.map(x => [x.id, x.count, x.max]), [['quietly', 2, 1]]);
  assert.ok(v[0].instead.includes('softly') && v[0].instead.includes('gently'));
  const fam = 'A quiet life. A quiet death. Quietness followed. She quietly wept.';
  assert.deepEqual(styleViolations(fam, STYLE.limits).map(x => [x.id, x.count, x.max]), [['quiet-family', 4, 2]]);      // one "quietly" is allowed; four of the family are not
});

test('styleViolations: matching is case-insensitive, whole words only, and a bad pattern in the file is skipped, not fatal', () => {
  assert.equal(styleViolations('Quietly. QUIETLY. quietly.', [{ id: 'q', pattern: '\\bquietly\\b', maxPerArticle: 1 }])[0].count, 3);
  assert.deepEqual(styleViolations('inquietly', [{ id: 'q', pattern: '\\bquietly\\b', maxPerArticle: 0 }]), []);
  assert.deepEqual(styleViolations('x', [{ id: 'bad', pattern: '(', maxPerArticle: 0 }]), []);
  assert.deepEqual(styleViolations('x', undefined), []);
});

test('htmlViolations: only the tags the app allows, https links only, and no entry: links', () => {
  assert.deepEqual(htmlViolations('<b>bold</b> <i>it</i> <u>u</u><br><ul><li>x</li></ul><blockquote>q</blockquote><a href="https://a.org/x">a</a>'), []);
  assert.deepEqual(htmlViolations('<script>x</script><div>y</div>'), ['tag <script> is not allowed', 'tag <div> is not allowed']);
  assert.deepEqual(htmlViolations('<a href="http://a.org">a</a>'), ['a link must have an https href']);
  assert.ok(htmlViolations('<a href="entry:st-peter-64">Peter</a>').includes('entry: links are not written by the writer'));
});

test('lengthTier: a requested tier wins; otherwise the entry tier; thin sources only ever lower it', () => {
  assert.deepEqual(lengthTier({ requested: 'major' }), { tier: 'major', min: 900, max: 1000 });
  assert.equal(lengthTier({ entryTier: 1 }).tier, 'major');
  assert.equal(lengthTier({ entryTier: 2 }).tier, 'standard');
  assert.equal(lengthTier({ entryTier: 3 }).tier, 'lesser');
  assert.equal(lengthTier({}).tier, 'standard');
  assert.equal(lengthTier({ entryTier: 1, sourceWords: 2000 }).tier, 'lesser');
  assert.equal(lengthTier({ entryTier: 1, sourceWords: 4000 }).tier, 'standard');
  assert.equal(lengthTier({ entryTier: 1, sourceWords: 9000 }).tier, 'major');
  assert.equal(lengthTier({ requested: 'major', sourceWords: 500 }).tier, 'major');          // a person's request is not overridden
  assert.deepEqual(BANDS.lesser, { min: 400, max: 600 });
});

test('quoteSource: a quotation must be in a source word for word; quote marks, dashes, spacing and case are evened out; short or invented text is not', () => {
  const src = [{ n: 1, text: 'Late have I loved you, O Beauty so ancient and so new \u2014 late have I loved you!' }, { n: 2, text: 'Another page entirely about something else, with enough words to be a page.' }];
  assert.equal(quoteSource('\u201CLate have I loved you, O Beauty so ancient and so new - late have I loved you!\u201D', src), 1);
  assert.equal(quoteSource('late have i loved you,   o beauty so ancient', src), 1);
  assert.equal(quoteSource('Late have I loved you, O Beauty so ancient and so new, late have I loved thee', src), 0);
  assert.equal(quoteSource('Beauty', src), 0);
  assert.equal(quoteSource('Another page entirely about something else', src), 2);
});

test('factViolations: labels for the type, no repeats, short values, the age forms, dates', () => {
  assert.deepEqual(factViolations('s', [{ label: 'Feast day', value: 'August 28' }, { label: 'Died', value: 'August 28, 430, Hippo, Algeria (at age 75)' }, { label: 'Born', value: 'November 13, 354, Tagaste' }]), []);
  assert.deepEqual(factViolations('s', [{ label: 'Died', value: 'August 28, 430 (estimated age 75)' }]), []);
  assert.deepEqual(factViolations('s', [{ label: 'Died', value: 'August 28, 430, aged 75' }]), ['"Died" age must end "(at age N)" or "(estimated age N)"']);
  assert.deepEqual(factViolations('s', [{ label: 'Hobby', value: 'x' }]), ['Quick Fact label "Hobby" is not one of: ' + FACT_LABELS.s.join(', ')]);
  assert.deepEqual(factViolations('s', [{ label: 'Feast day', value: 'a' }, { label: 'Feast day', value: 'b' }]), ['Quick Fact "Feast day" appears twice']);
  assert.match(factViolations('s', [{ label: 'Feast day', value: '28 August' }])[0], /day before month/);
  assert.deepEqual(factViolations('s', [{ label: 'Born', value: '' }]), ['a Quick Fact with an empty label or value']);
  assert.match(factViolations('s', [{ label: 'Major works', value: 'x'.repeat(200) }])[0], /too long/);
  assert.deepEqual(factViolations('i', [{ label: 'Anything', value: 'goes' }]), []);          // topic pages have no fixed labels
  assert.deepEqual(factViolations('m', [{ label: 'Approval status', value: 'Approved by the bishop, 1984' }]), []);
});

const STD = { tier: 'standard', min: 600, max: 750 };
const para = n => Array.from({ length: Math.ceil(n / 12) }, () => sentence(12)).join(' ');
const sec = (n, h = 'Heading') => ({ h, b: para(n) });
const good = () => ({ d: 'A short description of the saint. It has two sentences.', sections: Array.from({ length: 6 }, (_v, i) => sec(110, 'Part ' + (i + 1))), quotes: [], facts: [{ label: 'Feast day', value: 'August 28' }] });
const SRC = [{ n: 1, text: 'Late have I loved you, O Beauty so ancient and so new, late have I loved you!' }];

test('checkDraft: a good draft passes and reports its statistics', () => {
  const r = checkDraft(good(), { type: 's', band: STD, limits: STYLE.limits, sources: SRC, sourceWords: 9000 });
  assert.deepEqual(r.violations, []);
  assert.deepEqual([r.stats.sections, r.stats.maxSentence, r.stats.quotes, r.stats.facts], [6, 12, 0, 1]);
  assert.ok(r.stats.words >= 600 && r.stats.words <= 750);
});

test('checkDraft: too long, too short (but thin sources excuse short), too few sections, an over-long sentence', () => {
  const run = (d, extra = {}) => checkDraft(d, { type: 's', band: STD, limits: [], sources: SRC, sourceWords: 9000, ...extra }).violations.map(v => v.rule);
  const long = good(); long.sections[0] = sec(300);
  assert.ok(run(long).includes('length'));
  const short = good(); short.sections = short.sections.slice(0, 5).map(s => ({ ...s, b: para(60) }));
  assert.ok(run(short).includes('length'));
  assert.ok(!run(short, { sourceWords: 1500 }).includes('length'));
  const few = good(); few.sections = few.sections.slice(0, 3);
  assert.ok(run(few).includes('sections'));
  const sent = good(); sent.sections[1].b = sentence(45) + ' ' + sent.sections[1].b;
  assert.ok(run(sent).includes('sentence'));
  const never = good(); never.sections[0] = sec(400);
  assert.match(checkDraft(never, { type: 's', band: BANDS.major, limits: [], sources: SRC, sourceWords: 9000 }).violations.map(v => v.text).join(' '), /never exceed it|target/);
});

test('checkDraft: wrong dates, "quietly" over the limit, a bad tag, a wrong fact label and an invented quotation are each reported with their rule', () => {
  const d = good();
  d.sections[0].b += ' He died on 28 December 1065. He prayed quietly. She wept quietly. <script>x</script>';
  d.facts.push({ label: 'Hobby', value: 'x' });
  d.quotes = [{ text: 'Late have I loved you, O Beauty so ancient and so new', source: 'Confessions X, 27' }, { text: 'An invented quotation that no source contains at all', source: 'Nowhere' }, { text: 'Late have I loved you, O Beauty', source: '' }];
  const v = checkDraft(d, { type: 's', band: { tier: 'standard', min: 0, max: 5000 }, limits: STYLE.limits, sources: SRC, sourceWords: 9000 }).violations;
  const rules = v.map(x => x.rule);
  for (const r of ['date', 'style', 'html', 'facts', 'quotes']) assert.ok(rules.includes(r), r);
  assert.ok(v.some(x => /"quietly" appears 2 times; the limit is 1.*softly/.test(x.text)));
  assert.ok(v.some(x => /not word for word in any source/.test(x.text)));
  assert.ok(v.some(x => /has no attribution/.test(x.text)));
});

test('checkDraft: more than four quotations, an empty description, a too-long description', () => {
  const d = good();
  d.quotes = Array.from({ length: 5 }, () => ({ text: 'Late have I loved you, O Beauty so ancient and so new', source: 'Conf.' }));
  assert.ok(checkDraft(d, { type: 's', band: STD, limits: [], sources: SRC, sourceWords: 9000 }).violations.some(v => /5 quotations; the limit is 4/.test(v.text)));
  const e = good(); e.d = '';
  assert.ok(checkDraft(e, { type: 's', band: STD, limits: [], sources: SRC, sourceWords: 9000 }).violations.some(v => v.rule === 'description'));
  const f = good(); f.d = words(70);
  assert.ok(checkDraft(f, { type: 's', band: STD, limits: [], sources: SRC, sourceWords: 9000 }).violations.some(v => /70 words/.test(v.text)));
});

test('the style file: every limit has an id, a valid pattern, a positive maximum and synonyms; "quietly" is limited to one', () => {
  assert.ok(STYLE.limits.length >= 2);
  for (const l of STYLE.limits) {
    assert.ok(l.id && l.pattern && l.maxPerArticle >= 1 && Array.isArray(l.instead) && l.instead.length >= 3, l.id);
    assert.doesNotThrow(() => new RegExp(l.pattern, 'gi'));
  }
  assert.equal(STYLE.limits.find(l => l.id === 'quietly').maxPerArticle, 1);
});

test('the real library (when data.json is in the repo): a rewrite will be held to a stricter standard than the old articles, and the check runs on every article without error', () => {
  const p = fileURLToPath(new URL('../../data.json', import.meta.url));
  if (!existsSync(p)) return;
  const data = JSON.parse(readFileSync(p, 'utf8'));
  let ran = 0;
  for (const e of data.entries || []) {
    const body = ((e.art && e.art.sections) || []).map(s => s.b).join(' ');
    sentenceReport(body); dateViolations(body); styleViolations(body, STYLE.limits); ran++;
  }
  assert.ok(ran > 0);
});
