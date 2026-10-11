// scripts/tests/lifespan.test.mjs
// MODULE DATE: 2026-10-09 (Friday) · tests for scripts/services/lifespan.mjs v0.1. The worked examples are the ones in the authoring skill's "Age at death" section.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDateText, ageAtDeath, ageSuffix, stripAge, lifespanFromFacts, applyAgeToFacts, numberWords, ageMentioned, agesStated, DEFAULT_MAX_SPREAD } from '../services/lifespan.mjs';

const P = parseDateText;
const age = (b, d, o) => ageAtDeath(P(b), P(d), o);

test('parseDateText: full dates, years, "c.", ranges, "or", double years, BC, parentheses; centuries and places alone give nothing', () => {
  assert.deepEqual(P('November 13, 354, Thagaste, North Africa'), { y1: 354, y2: 354, circa: false, month: 11, day: 13, bc: false, full: true });
  assert.deepEqual(P('1090, Fontaines-l\u00E8s-Dijon'), { y1: 1090, y2: 1090, circa: false, month: null, day: null, bc: false, full: false });
  assert.deepEqual(P('c. 1020/1025, Tuscany'), { y1: 1020, y2: 1025, circa: true, month: null, day: null, bc: false, full: false });
  assert.deepEqual(P('c. 64\u201367, Rome (Vatican Hill)'), { y1: 64, y2: 67, circa: true, month: null, day: null, bc: false, full: false });
  assert.deepEqual(P('672 or 673, Northumbria'), { y1: 672, y2: 673, circa: true, month: null, day: null, bc: false, full: false });
  assert.deepEqual(P('c. 107 (between 98 and 117), Rome'), { y1: 98, y2: 117, circa: true, month: null, day: null, bc: false, full: false });
  assert.deepEqual(P('January 6, 1499/1500, Almod\u00F3var del Campo'), { y1: 1499, y2: 1500, circa: true, month: 1, day: 6, bc: false, full: false });
  assert.deepEqual(P('c. 69'), { y1: 69, y2: 69, circa: true, month: null, day: null, bc: false, full: false });
  assert.deepEqual(P('4 BC, Bethlehem'), { y1: 4, y2: 4, circa: false, month: null, day: null, bc: true, full: false });
  assert.equal(P('March 15, 44 BC').bc, true);
  assert.equal(P('March 15, 44 BC').full, true);
  assert.deepEqual(P('December 1065'), { y1: 1065, y2: 1065, circa: false, month: 12, day: null, bc: false, full: false });
  assert.equal(P('c. March 3, 340').full, false);                       // a "c." date is never exact
  assert.deepEqual(P('January 1 or 2, 379, Caesarea'), { y1: 379, y2: 379, circa: false, month: 1, day: null, bc: false, full: false });     // an uncertain day is not a range of years
  assert.deepEqual(P('June 8\u20139, 597'), { y1: 597, y2: 597, circa: false, month: 6, day: null, bc: false, full: false });
  assert.deepEqual(P('May 30\u2013June 2, 1431'), { y1: 1431, y2: 1431, circa: false, month: 5, day: null, bc: false, full: false });
  assert.equal(age('c. 330, Caesarea, Cappadocia', 'January 1 or 2, 379, Caesarea').age, 49);                                                    // St. Basil, found in the real data
  for (const none of ['1st century BC, traditionally Jerusalem or Nazareth', 'Bethsaida, Galilee', '', null, undefined, 'unknown', 'Pope Pius X']) assert.equal(P(none), null, String(none));
});

test('ageAtDeath: the skill\'s own examples', () => {
  assert.deepEqual(age('November 13, 354, Thagaste', 'August 28, 430, Hippo Regius'), { age: 75, kind: 'exact', min: 75, max: 75, spread: 0 });   // Augustine: 76 minus one, the birthday had not come
  assert.equal(age('1182, Assisi', '1226, Assisi').age, 44);
  assert.equal(age('1182, Assisi', '1226, Assisi').kind, 'estimated');
  const gregory = age('c. 1020/1025, Tuscany', '1085, Salerno');
  assert.deepEqual([gregory.age, gregory.kind, gregory.min, gregory.max], [62, 'estimated', 60, 65]);                                                   // midpoint 62.5, rounded down
  assert.equal(age('4 BC', 'AD 30, Jerusalem').age, 33);                                                                                              // no year 0
  assert.equal(age('4 BC', '30 AD').age, 33);
  assert.equal(age('May 5, 100', 'May 5, 160').age, 60);                                                                                                // birthday that very day: no subtraction
  assert.equal(age('May 6, 100', 'May 5, 160').age, 59);
});

test('ageAtDeath: tolerance. A narrow range is estimated; a range wider than the tolerance gives no age and says why; no birth year gives none; nonsense is refused', () => {
  assert.equal(DEFAULT_MAX_SPREAD, 6);
  assert.equal(age('c. 296\u2013298, Alexandria', 'May 2, 373, Alexandria').age, 76);
  assert.equal(age('672 or 673, Northumbria', 'May 26, 735, Jarrow').age, 62);
  const ig = age('c. 35\u201350, Syria', 'c. 107 (between 98 and 117), Rome');
  assert.equal(ig.age, null);
  assert.match(ig.reason, /dates too uncertain \(the age could be anywhere from 48 to 82\)/);
  assert.equal(age('c. 35\u201350, Syria', 'c. 107 (between 98 and 117), Rome', { maxSpread: 40 }).age, 65);   // the tolerance is a setting
  assert.deepEqual(age('Bethsaida, Galilee', 'c. 64\u201367, Rome'), { age: null, reason: 'no birth year' });
  assert.deepEqual(age('1090', 'Rome (martyred)'), { age: null, reason: 'no death year' });
  assert.match(age('1200', '1100').reason, /death comes before the birth/);
  assert.match(age('1000', '1200').reason, /implausible age \(200\)/);
});

test('ageSuffix and stripAge', () => {
  assert.equal(ageSuffix({ age: 75, kind: 'exact' }), ' (at age 75)');
  assert.equal(ageSuffix({ age: 62, kind: 'estimated' }), ' (estimated age 62)');
  assert.equal(ageSuffix({ age: null }), '');
  assert.equal(stripAge('August 28, 430, Hippo (at age 75)'), 'August 28, 430, Hippo');
  assert.equal(stripAge('c. 304, Rome (traditionally at age 14)'), 'c. 304, Rome');
  assert.equal(stripAge('1937, Montreal (estimated age 92)'), '1937, Montreal');
  assert.equal(stripAge('March 7, 203, Carthage (amphitheatre)'), 'March 7, 203, Carthage (amphitheatre)');
});

test('lifespanFromFacts and applyAgeToFacts: the age goes on the Died fact; an age already there is replaced by the computed one; with no computable age the model\'s age is removed', () => {
  const facts = [{ label: 'Feast day', value: 'August 28' }, { label: 'Born', value: 'November 13, 354, Tagaste' }, { label: 'Died', value: 'August 28, 430, Hippo (at age 99)' }];
  const r = applyAgeToFacts(facts);
  assert.equal(r.facts[2].value, 'August 28, 430, Hippo (at age 75)');
  assert.equal(r.lifespan.age, 75);
  assert.equal(facts[2].value, 'August 28, 430, Hippo (at age 99)');            // the input is not changed
  const none = applyAgeToFacts([{ label: 'Born', value: 'Galilee' }, { label: 'Died', value: 'c. 64\u201367, Rome (estimated age 80)' }]);
  assert.equal(none.facts[1].value, 'c. 64\u201367, Rome');
  assert.equal(none.lifespan.reason, 'no birth year');
  assert.equal(applyAgeToFacts([{ label: 'Born', value: '1100' }]).lifespan.reason, 'no Died fact');
  assert.deepEqual(lifespanFromFacts([{ label: 'Born', value: '1182' }, { label: 'Died', value: '1226' }]).age, 44);
  assert.equal(lifespanFromFacts([{ label: 'born', value: '1182' }, { label: 'DIED', value: '1226' }]).age, 44);        // labels are matched without regard to case
});

test('numberWords', () => {
  assert.deepEqual([0, 7, 13, 20, 21, 75, 100, 105, 120].map(numberWords), ['zero', 'seven', 'thirteen', 'twenty', 'twenty-one', 'seventy-five', 'one hundred', 'one hundred five', 'one hundred twenty']);
});

test('ageMentioned: the ways an age is naturally said, in digits or words; other numbers and other ages do not count', () => {
  const yes = ['He died at about seventy-five.', 'She died at the age of 75.', 'He was aged 75 when he died.', 'He was seventy-five years old.', 'He died at 75 in Hippo.',
    'She died at about 75 years of age.', 'He died at nearly seventy five.', 'He died around 75 years later.'];
  for (const t of yes) assert.equal(ageMentioned(t, 75), true, t);
  const no = ['He died in 430.', 'He was bishop for 75 years of struggle.', 'He died at about seventy-six.', 'He wrote 75 sermons.', 'He died in the year seventy-five.'];
  for (const t of no) assert.equal(ageMentioned(t, 75), false, t);
});

test('agesStated: finds the ages a text claims, so a WRONG one can be reported', () => {
  assert.deepEqual(agesStated('He died at the age of 75. She died aged forty-four.'), [75, 44]);
  assert.deepEqual(agesStated('He was seventy-two years old.').length, 0);          // words plus "years old" are covered by ageMentioned, not here
  assert.deepEqual(agesStated('They met in 430 and he wrote 75 sermons.'), []);
  assert.deepEqual(agesStated('He died at about eighty.'), [80]);
});

test('the real library (when the data is in the repo): the calculation runs on every saint and every computed age is plausible', () => {
  const p = fileURLToPath(new URL('../../data.json', import.meta.url));
  if (!existsSync(p)) return;
  const data = JSON.parse(readFileSync(p, 'utf8'));
  let computed = 0;
  for (const e of (data.entries || []).filter(x => x.t === 's')) {
    const r = lifespanFromFacts(e.facts || []);
    if (r.age != null) { computed++; assert.ok(r.age >= 0 && r.age <= 125, e.id); }
  }
  assert.ok(computed > 0);
});
