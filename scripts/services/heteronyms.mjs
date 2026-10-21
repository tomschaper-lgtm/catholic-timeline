// scripts/services/heteronyms.mjs
//
// MODULE DATE: 2026-10-21T16:55:00-05:00 (Wednesday). Lives beside audio-generate.mjs, pron-vote.mjs and
// ai-router.mjs (same folder). 2026-10-21: also reads pronunciation/heteronyms.json, the words added in the app
// (pronunciation picker → "Two sounds"); a word there replaces the same word in the built-in WORDS list.
//
// WORDS WITH TWO SOUNDS (Tom's idea): "records" is REH-kerdz as a noun ("parish records") but
// ri-KORDZ as a verb ("Eusebius records that..."). The pronunciation dictionary can't tell them
// apart: it matches text, not meaning. So before a Kokoro recording, every sentence holding one
// of the words below is sent to a cheap AI model (job "heteronym" in ai/models.json, one batched
// call per article), which says which meaning each use has. That use alone gets the right sound
// for this recording. The pronunciation dictionary is never changed.
//
// Answers are remembered in pronunciation/heteronym-picks.json (one line per word in a sentence),
// so a re-recording asks nothing and always sounds the same. To correct a wrong pick, change its
// "sense" there (to the other name listed for that word below); to have it asked again, delete it.
//
// Never blocks a recording: with no key, a failed call or an odd reply, the word is left to
// Kokoro's own reading and the run summary says so. HETERONYM=0 turns the check off.
//
// Adding a word: copy a line in WORDS. "ipa" is in Kokoro's own notation, the same as kokoro_ipa
// in the pronunciation file (A = "ay", I = "eye", O = "oh", W = "ow", ɹ = r, ˈ before the stressed
// part). Each word needs exactly two meanings; their names are what the model answers with.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const PICKS_FILE = 'pronunciation/heteronym-picks.json';
export const ADDED_FILE = 'pronunciation/heteronyms.json';   // 2026-10-21: words added from the app
const MAX_ITEMS = parseInt(process.env.HETERONYM_MAX, 10) || 80;   // per article, per call

export const WORDS = {
  records:  { noun:     { say: 'REH-kerdz, things written down',      ipa: 'ɹˈɛkəɹdz' },
              verb:     { say: 'ri-KORDZ, writes down or tells',       ipa: 'ɹikˈɔɹdz' } },
  record:   { noun:     { say: 'REH-kerd, a written account',          ipa: 'ɹˈɛkəɹd' },
              verb:     { say: 'ri-KORD, to write down',               ipa: 'ɹikˈɔɹd' } },
  read:     { present:  { say: 'REED, reads now or will read',         ipa: 'ɹˈid' },
              past:     { say: 'RED, already read',                    ipa: 'ɹˈɛd' } },
  lead:     { verb:     { say: 'LEED, to guide',                       ipa: 'lˈid' },
              metal:    { say: 'LED, the metal',                       ipa: 'lˈɛd' } },
  live:     { verb:     { say: 'LIV, to be alive or dwell',            ipa: 'lˈɪv' },
              adjective:{ say: 'LYVE, alive, not recorded',            ipa: 'lˈIv' } },
  wound:    { injury:   { say: 'WOOND, an injury',                     ipa: 'wˈund' },
              wrapped:  { say: 'WOWND, past of wind (wrapped, coiled)',ipa: 'wˈWnd' } },
  minute:   { time:     { say: 'MIN-it, sixty seconds',                ipa: 'mˈɪnət' },
              tiny:     { say: 'my-NOOT, very small',                  ipa: 'mInˈut' } },
  close:    { near:     { say: 'KLOHS, near, or close (adjective)',    ipa: 'klˈOs' },
              shut:     { say: 'KLOHZ, to shut or to end',             ipa: 'klˈOz' } },
  present:  { noun:     { say: 'PREH-zent, a gift, now, or here',      ipa: 'pɹˈɛzənt' },
              verb:     { say: 'pri-ZENT, to give or show',            ipa: 'pɹizˈɛnt' } },
  content:  { noun:     { say: 'KON-tent, what something contains',    ipa: 'kˈɑntɛnt' },
              adjective:{ say: 'kun-TENT, satisfied',                  ipa: 'kəntˈɛnt' } },
  object:   { noun:     { say: 'OB-jekt, a thing or a goal',           ipa: 'ˈɑbʤɛkt' },
              verb:     { say: 'ub-JEKT, to protest',                  ipa: 'əbʤˈɛkt' } },
  desert:   { land:     { say: 'DEH-zert, dry land',                   ipa: 'dˈɛzəɹt' },
              abandon:  { say: 'di-ZERT, to abandon',                  ipa: 'dəzˈɜɹt' } },
  refuse:   { verb:     { say: 'ri-FYOOZ, to say no',                  ipa: 'ɹəfjˈuz' },
              garbage:  { say: 'REF-yoos, rubbish',                    ipa: 'ɹˈɛfjus' } },
  tears:    { crying:   { say: 'TEERZ, from the eyes',                 ipa: 'tˈɪɹz' },
              rips:     { say: 'TAIRZ, rips',                          ipa: 'tˈɛɹz' } },
  bow:      { bend:     { say: 'BOW (rhymes with now), to bend',       ipa: 'bˈW' },
              ribbon:   { say: 'BOH, a ribbon or archer\'s bow',        ipa: 'bˈO' } },
  wind:     { air:      { say: 'WIND, moving air',                     ipa: 'wˈɪnd' },
              turn:     { say: 'WYND, to turn or wrap',                ipa: 'wˈInd' } },
  convert:  { noun:     { say: 'KON-vert, a person who converted',     ipa: 'kˈɑnvəɹt' },
              verb:     { say: 'kun-VERT, to change',                  ipa: 'kənvˈɜɹt' } },
  converts: { noun:     { say: 'KON-verts, people who converted',      ipa: 'kˈɑnvəɹts' },
              verb:     { say: 'kun-VERTS, changes',                   ipa: 'kənvˈɜɹts' } },
  rebel:    { noun:     { say: 'REB-ul, one who rebels',               ipa: 'ɹˈɛbəl' },
              verb:     { say: 'ri-BEL, to rise up against',           ipa: 'ɹəbˈɛl' } },
  rebels:   { noun:     { say: 'REB-ulz, people who rebel',            ipa: 'ɹˈɛbəlz' },
              verb:     { say: 'ri-BELZ, rises up against',            ipa: 'ɹəbˈɛlz' } }
};

const WORD_CH = "A-Za-z0-9\\u00C0-\\u024F'\\u2019";
// 2026-10-21: the built-in words plus the app's file. A file entry counts only if it has exactly two sounds,
// each with an ipa string; anything malformed is skipped, never fatal.
async function loadWords(){
  const words = Object.assign({}, WORDS);
  try{
    const j = JSON.parse(await fs.readFile(ADDED_FILE, 'utf8'));
    for(const [w, senses] of Object.entries((j && j.words) || {})){
      const key = String(w).trim().toLowerCase();
      const ok = key && /^[a-z\u00C0-\u024F'\u2019-]+$/.test(key) && senses && typeof senses === 'object' &&
        Object.keys(senses).length === 2 && Object.values(senses).every(s => s && typeof s.ipa === 'string' && s.ipa);
      if(ok) words[key] = Object.fromEntries(Object.entries(senses).map(([n, s]) => [String(n).toLowerCase(), { say: String(s.say || n), ipa: s.ipa }]));
    }
  }catch(e){ /* no file yet, or unreadable: built-in words only */ }
  return words;
}
const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const keyOf = (word, text, nth) =>
  crypto.createHash('sha1').update(word + '\u0000' + nth + '\u0000' + text).digest('hex').slice(0, 16);

async function loadPicks(){
  try{
    const j = JSON.parse(await fs.readFile(PICKS_FILE, 'utf8'));
    return j && typeof j.picks === 'object' && j.picks ? j : { v: 1, picks: {} };
  }catch(e){ return { v: 1, picks: {} }; }
}

const SYSTEM = 'You decide which meaning a word has in a sentence, so a narrator can pronounce it correctly. ' +
  'Each item gives a sentence with the word marked [[like this]] and the word\'s two meanings by name. ' +
  'Answer ONLY with JSON: {"answers":[{"n":1,"sense":"<one of the two names given>"}]} — one answer per item, ' +
  'using exactly one of the names offered for that item. Judge by grammar and meaning in that sentence only.';

// texts: the strings that will be spoken (titles, headings, sentences), in order.
// Returns { extras: [[{at, len, ipa, sense, word}] per text], found, asked, fromMemory, model,
//           error, filesToCommit }. Never throws.
export async function heteronymPicks(texts){
  const out = { extras: texts.map(() => []), found: 0, asked: 0, fromMemory: 0, model: '', error: '', filesToCommit: [] };
  if(process.env.HETERONYM === '0') return out;
  try{
    const book = await loadPicks();
    const WORDS = await loadWords();   // 2026-10-21: shadows the built-in list for this run
    const FIND = new RegExp('(?<![' + WORD_CH + '])(' + Object.keys(WORDS).map(escRe).join('|') + ')(?![' + WORD_CH + '])', 'gi');
    const todo = [];   // occurrences not remembered yet
    texts.forEach((t, ti) => {
      if(!t) return;
      const seen = {};
      for(const m of String(t).matchAll(FIND)){
        const word = m[1].toLowerCase();
        const nth = seen[word] = (seen[word] || 0) + 1;
        const occ = { ti, at: m.index, len: m[1].length, word, nth, key: keyOf(word, t, nth) };
        out.found++;
        const known = book.picks[occ.key];
        if(known && WORDS[word][known.sense]){ place(out, occ, known.sense, WORDS[word][known.sense].ipa); out.fromMemory++; }
        else todo.push(occ);
      }
    });
    if(!todo.length) return out;

    const batch = todo.slice(0, MAX_ITEMS);
    const items = batch.map((o, k) => {
      const t = texts[o.ti];
      const senses = WORDS[o.word];
      return { n: k + 1, word: o.word,
        sentence: t.slice(0, o.at) + '[[' + t.slice(o.at, o.at + o.len) + ']]' + t.slice(o.at + o.len),
        meanings: Object.fromEntries(Object.entries(senses).map(([name, s]) => [name, s.say])) };
    });
    let router;
    try{ router = await import('./ai-router.mjs'); }
    catch(e){ out.error = 'ai-router.mjs not found beside heteronyms.mjs'; return out; }
    const a = await router.ask('heteronym', SYSTEM, JSON.stringify({ items }));
    out.model = a.model || '';
    const answers = (router.jsonOf(a.text).answers || []);
    const now = new Date().toISOString().slice(0, 10);
    let saved = 0;
    for(const ans of answers){
      const o = batch[(parseInt(ans && ans.n, 10) || 0) - 1];
      const sense = ans && String(ans.sense || '').trim().toLowerCase();
      if(!o || !WORDS[o.word][sense]) continue;
      place(out, o, sense, WORDS[o.word][sense].ipa);
      out.asked++;
      book.picks[o.key] = { word: o.word, sense, sentence: texts[o.ti], by: out.model, at: now };
      saved++;
    }
    if(saved){
      await fs.mkdir(path.dirname(PICKS_FILE), { recursive: true });
      await fs.writeFile(PICKS_FILE, JSON.stringify(book, null, 1) + '\n');
      out.filesToCommit.push(PICKS_FILE);
    }
    try{ const u = await router.flushUsage(); if(u) out.filesToCommit.push(u); }catch(e){}
    if(saved < batch.length) out.error = (batch.length - saved) + ' word' + (batch.length - saved === 1 ? '' : 's') + ' not answered (left to Kokoro)';
  }catch(e){
    out.error = String((e && e.message) || e).slice(0, 160);
  }
  return out;
}

function place(out, o, sense, ipa){
  out.extras[o.ti].push({ at: o.at, len: o.len, ipa, sense, word: o.word });
}
