// pron-vote.mjs (2026-10-07) — automatic pronunciation check before a Kokoro recording.
//
// Tom's rule: for capitalized words (names, places, councils...) that the pronunciation
// dictionary doesn't already cover, compare how Kokoro will say them with what Claude, OpenAI and
// Gemini say. If at least two of the three agree with each other and differ from Kokoro, add
// their pronunciation to the dictionary on the spot — it's used in this recording and committed
// with it. "Agree" is decided the way the app's pronunciation view groups answers (pron-compare).
//
// Never blocks a recording: any failure is reported in the run summary and recording goes on.
// Words checked with at least two answers are remembered in pronunciation/auto-checked.json and
// not asked again; delete a word there to have it checked on the next recording.
//
// Env: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY (already passed by the orchestrator);
// PRON_MODEL_ANTHROPIC / PRON_MODEL_OPENAI / PRON_MODEL_GEMINI override the models;
// PRON_VOTE=0 turns the check off; PRON_VOTE_MAX caps words per article (default 40).

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { soundKey, kokoroKey, lpRespell } from './pron-compare.mjs';

export const PRONUNCIATION_FILE = 'pronunciation/catholic-timeline-pronunciation.json';
export const CHECKED_FILE = 'pronunciation/auto-checked.json';
const WORDS_FILE = 'pronunciation/story/words.json';
const NAMES = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
const MODELS = {
  anthropic: process.env.PRON_MODEL_ANTHROPIC || 'claude-sonnet-5-5',
  openai: process.env.PRON_MODEL_OPENAI || 'gpt-6-luna',
  gemini: process.env.PRON_MODEL_GEMINI || 'gemini-flash-latest'
};
const KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
const PY = process.env.KOKORO_PYTHON || 'python3';
const SYNTH_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kokoro_synth.py');

// Words that are capitalized only because they start a sentence — not worth asking about there.
export const COMMON = new Set(('a an the and but or nor so yet for of in on at to by with from into onto upon over under after before ' +
  'during since until while when where why how what which who whom whose that this these those there here then thus ' +
  'he she it they we you i his her its their our your my him them us me as if though although because once ' +
  'not no yes all both each every few many most much more some such other another one two three four five six seven ' +
  'eight nine ten first second third last later early soon still even also only just never always often today ' +
  'is was were are be been being has had have do did does can could may might must shall should will would ' +
  'let like long near now well within without among across against along around beyond through throughout toward towards ' +
  'instead indeed perhaps rather whatever whoever whether nothing everything something anyone everyone someone ' +
  'born died according despite following within years year day days century centuries').split(/\s+/));

const plain = (s) => String(s || '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // [text](entry:id) -> text
  .replace(/[*_]{1,3}/g, '');                  // **bold**, *italic*

function sentencesOf(entry){
  const parts = [plain(entry.n)];
  for(const sec of ((entry.art && entry.art.sections) || [])){
    if(sec.h) parts.push(plain(sec.h));
    for(const para of String(sec.b || '').split(/\n{2,}/)) parts.push(plain(para));
  }
  const out = [];
  for(const p of parts){
    for(const s of p.split(/(?<=[.!?][\u201d\u2019"')]?)\s+(?=[\u201c\u2018"'(]?\p{Lu})/u)) if(s.trim()) out.push(s.trim());
  }
  return out;
}

const WORD_RE = /\p{Lu}[\p{L}\p{M}]+(?:['\u2019]\p{L}+)?/gu;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function coveredBy(word, rules){
  const re = new RegExp('(^|[^\\p{L}\\p{M}])' + escRe(word) + '(?![\\p{L}\\p{M}])', 'u');
  return rules.some(r => r && r.type === 'alias' && r.string_to_replace && re.test(r.string_to_replace));
}

// The capitalized words worth checking, each with the first sentence it appears in.
export function capitalizedWords(entry, rules, checked){
  const found = new Map();
  for(const s of sentencesOf(entry)){
    const lead = s.replace(/^[\u201c\u2018"'(\s]+/, '');
    for(const m of s.matchAll(WORD_RE)){
      let w = m[0].replace(/['\u2019]s$/, '');
      if(w.length < 2 || found.has(w)) continue;
      if(/^[IVXLCDM]+$/.test(w)) continue;                       // roman numerals (spelling rules handle them)
      if(/^\p{Lu}+$/u.test(w) && w.length <= 5) continue;         // short acronyms
      const atStart = m.index === s.length - lead.length;   // first word of the sentence
      if(atStart && COMMON.has(w.toLowerCase())) continue;         // "The", "After" starting a sentence
      if(COMMON.has(w.toLowerCase()) && w.length <= 3) continue;
      if(coveredBy(w, rules)) continue;                            // already in the dictionary
      if(checked[w]) continue;                                     // decided on an earlier recording
      found.set(w, s.length > 300 ? s.slice(0, 300) : s);
    }
  }
  return [...found].map(([word, sentence]) => ({ word, sentence }));
}

async function readJson(file, fallback){
  try{ return JSON.parse(await fs.readFile(file, 'utf8')); }catch(e){ return fallback; }
}

// Kokoro's own reading: from the story's every-word list, else ask Kokoro (no recording).
async function kokoroReadings(words){
  const known = ((await readJson(WORDS_FILE, {})) || {}).words || {};
  const out = {}, missing = [];
  for(const w of words){ if(known[w]) out[w] = known[w]; else missing.push(w); }
  if(missing.length){
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pronvote-'));
    const jobPath = path.join(dir, 'job.json');
    await fs.writeFile(jobPath, JSON.stringify({ g2p: missing, out_dir: dir }), 'utf8');
    await new Promise((res, rej) => {
      const child = spawn(PY, [SYNTH_SCRIPT, jobPath], { stdio: 'inherit', env: process.env });
      child.on('error', rej);
      child.on('close', code => code === 0 ? res() : rej(new Error('Kokoro reading failed (exit ' + code + ')')));
    });
    const got = ((await readJson(path.join(dir, 'results.json'), {})) || {}).g2p || {};
    Object.assign(out, got);
  }
  return out;
}

const PROMPT = 'You advise on pronunciation for an English-language Catholic history narration read by an American narrator. ' +
  'For each numbered word below (shown with the sentence it appears in), say how a careful, well-informed American Catholic lector would say it IN THAT SENTENCE: ' +
  'for saints, popes, places and councils, the established English (anglicized) pronunciation used in American Catholic usage when one exists, otherwise the native pronunciation as an English speaker would naturally say it; ' +
  'for ordinary words, the pronunciation that fits the sentence. Answer with JSON only: {"words":[{"word":"<exactly as given>","respell":"..."}]}, one object per word. ' +
  '"respell": a simple respelling, syllables joined by hyphens, the stressed syllable in CAPITALS, using these sounds: uh, ay, ee, eye, oh, oo, uu, ah, aw, ih, eh, er, ow, oy, a (as in cat), th, sh, zh, ch, j, ng (e.g. KRAH-koof, nye-SEE-uh).';

function parseAnswer(text){
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if(a < 0 || b <= a) throw new Error('no JSON in answer');
  const j = JSON.parse(t.slice(a, b + 1));
  const list = Array.isArray(j.words) ? j.words : [];
  const out = {};
  for(const x of list) if(x && x.word && x.respell) out[String(x.word).trim()] = String(x.respell).trim();
  return out;
}

async function ask(svc, items){
  const user = items.map((it, i) => (i + 1) + '. ' + it.word + ' \u2014 "' + it.sentence + '"').join('\n');
  return parseAnswer(await callModel(svc, PROMPT, user));
}

async function callModel(svc, system, user){
  const key = process.env[KEYS[svc]];
  if(!key) throw new Error('no ' + KEYS[svc] + ' secret');
  const model = MODELS[svc];
  const PROMPT = system;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 120000);
  try{
    let r, j, text;
    if(svc === 'anthropic'){
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 4000, system: PROMPT, messages: [{ role: 'user', content: user }] }) });
      j = await r.json();
      if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      text = (j.content || []).map(c => c.text || '').join('');
    }else if(svc === 'openai'){
      r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: ctl.signal,
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: user }] }) });
      j = await r.json();
      if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    }else{
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', signal: ctl.signal,
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: PROMPT }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json' } }) });
      j = await r.json();
      if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      text = (((j.candidates || [])[0] || {}).content || {}).parts ? j.candidates[0].content.parts.map(p => p.text || '').join('') : '';
    }
    return text;
  }finally{ clearTimeout(timer); }
}

// Two answers out of three agreeing (by sound) decide; Kokoro is overridden only when they differ from it.
export function decide(kokoroIpa, answers){
  const kok = kokoroKey(kokoroIpa);
  const groups = [];
  for(const [svc, respell] of Object.entries(answers)){
    if(!respell) continue;
    const k = soundKey(respell);
    let g = groups.find(x => x.k === k);
    if(!g){ g = { k, members: [] }; groups.push(g); }
    g.members.push({ svc, respell });
  }
  groups.sort((a, b) => b.members.length - a.members.length);
  const best = groups[0];
  if(!best || best.members.length < 2) return { verdict: 'no-majority', kok };
  if(best.k === kok) return { verdict: 'agrees', kok };
  return { verdict: 'corrected', kok, respell: best.members[0].respell, votes: best.members.map(m => NAMES[m.svc]) };
}

// Runs the whole check for one entry. Returns what changed; the caller commits the files.
export async function pronVote(entry, rawRulesLoader){
  if(process.env.PRON_VOTE === '0') return { skipped: 'turned off (PRON_VOTE=0)' };
  const dict = await readJson(PRONUNCIATION_FILE, { name: 'catholic-timeline-pronunciation', rules: [] });
  dict.rules = Array.isArray(dict.rules) ? dict.rules : [];
  const checkedFile = await readJson(CHECKED_FILE, { about: 'Words the recorder has already compared (Kokoro vs Claude, OpenAI, Gemini). Delete a word to have it checked again.', words: {} });
  checkedFile.words = checkedFile.words || {};
  const max = parseInt(process.env.PRON_VOTE_MAX, 10) || 40;
  const today0 = new Date().toISOString().slice(0, 10);
  let items = capitalizedWords(entry, dict.rules, checkedFile.words);
  if(!items.length) return { checked: 0, corrected: [], files: [] };
  // First, one model picks the words worth checking — names, places, foreign words a voice might
  // get wrong — so ordinary words ("Church", "Soldier", "Christ") never go to the vote. The ones it
  // passes over are remembered as not needed. If no model answers, everything is checked as before.
  const pre = await preselect(entry, items);
  let skippedCount = 0;
  if(pre){
    const keep = new Set(pre.words);
    for(const it of items) if(!keep.has(it.word)){ checkedFile.words[it.word] = { date: today0, result: 'not-needed', by: pre.by }; skippedCount++; }
    items = items.filter(it => keep.has(it.word));
    console.log('[pron-vote] ' + pre.by + ' picked ' + items.length + ' of ' + (items.length + skippedCount) + ' words to check: ' + items.map(i => i.word).join(', '));
  }
  items = items.slice(0, max);
  if(!items.length){
    if(skippedCount){ await fs.mkdir(path.dirname(CHECKED_FILE), { recursive: true }); await fs.writeFile(CHECKED_FILE, JSON.stringify(checkedFile, null, 1)); }
    return { checked: 0, corrected: [], picked: pre ? 0 : undefined, skipped: skippedCount, files: skippedCount ? [CHECKED_FILE] : [] };
  }

  const readings = await kokoroReadings(items.map(i => i.word));
  const svcs = Object.keys(KEYS).filter(s => process.env[KEYS[s]]);
  const errors = [], answers = {};
  await Promise.all(svcs.map(async svc => {
    try{ answers[svc] = await ask(svc, items); }
    catch(e){ errors.push(NAMES[svc] + ': ' + String(e.message || e).slice(0, 120)); }
  }));

  const today = new Date().toISOString().slice(0, 10);
  const corrected = [], log = [];
  let checked = 0;
  for(const it of items){
    const kokIpa = readings[it.word];
    const got = {};
    for(const svc of Object.keys(answers)) if(answers[svc][it.word]) got[svc] = answers[svc][it.word];
    if(!kokIpa || Object.keys(got).length < 2) continue;   // not enough to decide — ask again next time
    checked++;
    const d = decide(kokIpa, got);
    // a split with an answer missing might be settled by the missing one next time — don't remember it
    if(d.verdict === 'no-majority' && Object.keys(got).length < Object.keys(KEYS).length){ log.push(it.word + ': no majority yet (' + Object.keys(got).length + ' answers)'); continue; }
    const rec = { date: today, result: d.verdict, kokoro: kokIpa, answers: Object.fromEntries(Object.entries(got).map(([s, r]) => [NAMES[s], r])) };
    checkedFile.words[it.word] = rec;
    log.push(it.word + ': ' + d.verdict + (d.respell ? ' \u2192 ' + d.respell + ' (' + d.votes.join(' + ') + ')' : ''));
    if(d.verdict === 'corrected'){
      dict.rules.push({ string_to_replace: it.word, type: 'alias', alias: it.word, kokoro_ipa: lpRespell(d.respell),
        case_sensitive: true, word_boundaries: true, source: 'auto-vote', votes: d.votes.join(', '), respell: d.respell, added: today });
      corrected.push({ word: it.word, respell: d.respell, votes: d.votes });
    }
  }
  const files = [];
  if(checked || skippedCount){
    await fs.mkdir(path.dirname(CHECKED_FILE), { recursive: true });
    await fs.writeFile(CHECKED_FILE, JSON.stringify(checkedFile, null, 1));
    files.push(CHECKED_FILE);
  }
  if(corrected.length){
    await fs.writeFile(PRONUNCIATION_FILE, JSON.stringify(dict, null, 2));
    files.push(PRONUNCIATION_FILE);
  }
  for(const l of log) console.log('[pron-vote] ' + l);
  for(const e of errors) console.log('[pron-vote] ' + e);
  return { checked, corrected, errors, files, picked: pre ? items.length : undefined, skipped: skippedCount, pickedBy: pre && pre.by };
}

// Step 1: which of the article's capitalized words are worth checking at all? One model decides
// (Claude, else OpenAI, else Gemini). Returns { words: [...], by } or null if none could answer.
const PRE_PROMPT = 'You help prepare a Catholic history article to be read aloud by an American English text-to-speech voice. ' +
  'From the numbered list of capitalized words taken from the article, pick ONLY the ones such a voice might plausibly mispronounce: ' +
  'personal and place names that are not everyday English (e.g. Sabaria, Pannonia, Amiens, Wojtyła, Chalcedon), foreign, Latin or Greek words, ' +
  'unusual saints\' names and titles. Do NOT pick ordinary English words or very familiar names (e.g. Christ, Christian, Church, Roman, Bishop, ' +
  'Soldier, Martin, Rome, Peter, Mary, France, Hungary). When unsure whether a name is familiar, pick it. ' +
  'Answer with JSON only: {"words":["<exactly as listed>", ...]} — an empty list if none.';
async function preselect(entry, items){
  const user = 'Article: ' + plain(entry.n) + '\n\n' + items.map((it, i) => (i + 1) + '. ' + it.word).join('\n');
  for(const svc of ['anthropic', 'openai', 'gemini'].filter(x => process.env[KEYS[x]])){
    try{
      const t = String(await callModel(svc, PRE_PROMPT, user)).replace(/```(?:json)?/g, '');
      const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      const listed = new Set(items.map(i => i.word));
      const words = (Array.isArray(j.words) ? j.words : []).map(w => String(w).trim()).filter(w => listed.has(w));
      return { words, by: NAMES[svc] };
    }catch(e){ console.log('[pron-vote] word picking: ' + NAMES[svc] + ' failed (' + String(e.message || e).slice(0, 100) + ')'); }
  }
  return null;
}


// ---- "I" after a name: the first, One, or the word I? (2026-10-07) ----------------------------
// The recorder's rules (regnalFirstAt) can't cover every case, so each "Name I" the dictionary
// doesn't cover is put to one model with its sentence — a simple reading question, so one answer
// decides: Claude, or OpenAI if Claude can't be reached, then Gemini. Each decision
// is keyed by its surroundings — the name before and up to three words after — which is the same
// wherever the sentence is spoken (iKey). No majority, or no answers: the recorder's rules decide.
const NUM_I = /(\p{Lu}[\p{L}\p{M}]*) I(?![\p{L}\p{M}\p{N}])(?!['\u2019]\p{L}{2})/gu;
export function iKey(text, i){
  const prev = (text.slice(0, i).match(/(\p{Lu}[\p{L}\p{M}]*)\s+$/u) || [])[1] || '';
  const after = text.slice(i + 1).replace(/^['\u2019]s\b/, ' s').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return prev + ' I ' + after.slice(0, 3).join(' ');
}
const I_PROMPT = 'Each numbered item is a sentence from a Catholic history narration, read aloud by an American narrator. ' +
  'In it, the capital letter I right after a name is marked like this: [[I]]. Decide how the narrator should say that I: ' +
  '"the first" when it is a regnal or ordinal numeral (Pope Leo I, Gregory I, Mary I of England, Leo I\'s letter); ' +
  '"One" when it numbers a council or a war (Vatican I, Constantinople I, World War I); ' +
  '"I" when it is the pronoun, as in a prayer or a quotation (Lord I am not worthy). ' +
  'Answer with JSON only: {"items":[{"n":<item number>,"say":"the first" | "One" | "I"}]}, one per item.';
export async function decideRomanI(entry, rules){
  const items = [], seen = new Set();
  for(const s of sentencesOf(entry)){
    for(const m of s.matchAll(NUM_I)){
      const prev = m[1], at = m.index + m[0].length - 1;
      if(COMMON.has(prev.toLowerCase())) continue;                        // "Then I", "So I"
      if(coveredBy(prev + ' I', rules) || rules.some(r => r && r.type === 'alias' && r.string_to_replace && s.includes(r.string_to_replace) && r.string_to_replace.includes(prev + ' I'))) continue;
      const key = iKey(s, at);
      if(seen.has(key)) continue;
      seen.add(key);
      items.push({ key, marked: s.slice(0, at) + '[[I]]' + s.slice(at + 1) });
    }
  }
  const decisions = new Map();
  if(!items.length) return { decisions, asked: 0, decided: [], errors: [] };
  const user = items.map((it, k) => (k + 1) + '. ' + it.marked).join('\n');
  const errors = [];
  let got = null, by = '';
  for(const svc of ['anthropic', 'openai', 'gemini'].filter(x => process.env[KEYS[x]])){   // first one that answers
    try{
      const t = String(await callModel(svc, I_PROMPT, user)).replace(/```(?:json)?/g, '');
      const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      got = {};
      for(const x of (j.items || [])){
        const say = String(x.say || '').trim().toLowerCase();
        got[Number(x.n)] = say === 'the first' ? 'the first' : say === 'one' ? 'One' : say === 'i' ? 'I' : null;
      }
      by = NAMES[svc];
      break;
    }catch(e){ errors.push(NAMES[svc] + ': ' + String(e.message || e).slice(0, 120)); }
  }
  const decided = [];
  items.forEach((it, k) => {
    const say = got && got[k + 1];
    if(say){
      decisions.set(it.key, say);
      decided.push({ context: it.key.replace(/ I /, ' I \u2026 ').trim(), say, votes: [by] });
      console.log('[pron-vote] "' + it.key + '" -> ' + say + ' (' + by + ')');
    }else console.log('[pron-vote] "' + it.key + '" -> no answer; the recorder\'s rules decide');
  });
  for(const e of errors) console.log('[pron-vote] ' + e);
  return { decisions, asked: items.length, decided, errors };
}
