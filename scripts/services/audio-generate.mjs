// scripts/services/audio-generate.mjs
//
// MODULE DATE: 2026-10-22T15:10:00-05:00 (Thursday). 15:10 change: "Callistus I's" goes to Kokoro as
// "the firsts" (no apostrophe) — Kokoro read "the first's" as "the,, firstizz". REBUILT on the GitHub copy of 2026-10-10 (the last
// recorder before 2026-10-19), because the 10-19 and 10-22 uploads were built on an older 10-06 copy and
// silently dropped the 10-07..10-11 work. This file = 10-10 recorder (pron-vote check, "Name I" decisions
// and regnalFirstAt, II Kings -> Second Kings, X-ray guard, NUMERAL_ENTRIES, the closing prayer's place in
// the timing file, AI spend log) + the 10-06 SPOKEN TITLE block (spokenTitleFor / SpokenTitle: overrides,
// which the 10-10 copy lacked) + three later changes: (1) 2026-10-15 CLOSING PRAYERS FOR MORE THAN SAINTS
// (PRAYER_BY_TYPE, MARIAN_PRAYER_BY_NAME; an article's own [prayer] still wins); (2) 2026-10-19 WORDS WITH
// TWO SOUNDS (heteronyms.mjs, applyPronunciation's 4th argument); (3) 2026-10-21 POSSESSIVES after a
// dictionary rule keep the "'s" inside the Kokoro markup (possessiveAt / possessiveIpa).
// If this file has changed since, ask for a refresh before relying on it.
//
// Service: "audio-generate"
//
// Ported from the standalone scripts/generate-audio.mjs (triggered directly via the "Generate
// Audio Narration (ElevenLabs)" GitHub Action, outside workLog.json entirely) into a proper
// orchestrator service — one task = one entity, queued via Task Automation's Add Task batch
// selector (Category/Start/Quantity, same picker shape every other batch service uses; see
// audioGeneratePool() in index.html) instead of the old dedicated category/count/start-picker
// form. That form, and the direct-trigger workflow it drove, are retired — the batch-selection
// logic that used to live in this file's old candidateEntries() now lives client-side, same as
// every other service, and "already has audio, don't touch it" is a decision made once at QUEUE
// time (the pool skips them unless "Include entries that already have recorded audio" is
// checked), not re-checked here at RUN time.
//
// Per-entity voice/pacing settings (voice_id, model_id, stability, similarity_boost, style,
// speed, use_speaker_boost, read_headings, heading_pause_ms, section_pause_ms) travel in
// task.payload, captured from index.html's Voice & pacing settings fields at the moment the task
// was queued — not read from env vars, since a generic orchestrator run has no per-service custom
// inputs the way the old dedicated workflow_dispatch form did.
//
// Requires ELEVENLABS_API_KEY as a repo secret (passed through by orchestrator.yml) and
// ffmpeg/ffprobe on PATH (orchestrator.yml now installs it unconditionally, same as the old
// generate-audio.yml did) — used to build silence gaps and concatenate segments into one file.
//
// Not ported: audio-log.csv. Every other service here reports through task.result/summary,
// shown in the app's own Task List — this follows that same convention instead of a separate
// file nothing else in the app reads. Also not ported (out of scope for this pass, still
// standalone, unchanged): the "List ElevenLabs Voices & Models" and "Repair Audio Timing Gaps"
// Actions — the former is a one-off lookup with no entity/review concept, the latter a
// maintenance tool for old timing files, neither fitting the per-entity task model this file
// implements.
//
// VOICE ENGINE (2026-09-30): a Voice ID written as  kokoro:<voice>  (e.g. kokoro:af_heart) records with
// the free Kokoro voice on the runner instead of ElevenLabs — see tts-kokoro.mjs, kokoro_synth.py and narrateEntryKokoro()
// below. Same sections, headings, pronunciation rules, closing prayer, pauses, cue format and
// versioned filenames; no ELEVENLABS_API_KEY needed. Every recording now stamps entry.audioEngine
// ("kokoro:af_heart" / "elevenlabs:<voiceId>") so a later "re-record everything made with the old
// engine" pass has something to filter on.
//
// PRONUNCIATION (2026-09-27): before any text is sent to ElevenLabs, whole-word replacements from
// pronunciation/catholic-timeline-pronunciation.json are applied here (e.g. "Pius XII" is sent as
// "Pius the twelfth", "Vatican II" as "Vatican Two"). Done here rather than with an ElevenLabs
// pronunciation dictionary on purpose: the sentence-highlighting cues are built by mapping each
// sentence's character positions onto ElevenLabs' character timings, and a swap made on
// ElevenLabs' side could leave those timings describing text the article doesn't contain. Here,
// applyPronunciation() records where every character of the original moved to, so the cues are
// computed against exactly the text that was spoken and then mapped back onto the article's own
// text — highlighting stays exact. Rules: checked in file order, first match wins (so phrase
// exceptions like "Vatican II" sit above plain "II"); case-sensitive; whole words only (the
// characters on either side must not be letters or digits). Edit the JSON file to add or change
// pronunciations; no ElevenLabs setup involved. Missing file = no replacements.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { stripHtml, splitSentences } from '../lib/text.mjs';
import { isKokoroVoice, kokoroVoiceName, kokoroSpeed, Track, synthBatch, trackToMp3 } from './tts-kokoro.mjs';
import { americanDates, americanizeEntryDates, spokenDateAt } from './american-dates.mjs';
import { pronVote, COMMON, decideRomanI, iKey } from './pron-vote.mjs';
import { usageSummary, flushUsage } from './ai-router.mjs';   // 2026-10-11: AI spend log   // 2026-10-05: own file, shared with fix-dates.mjs
export { americanDates, americanizeEntryDates };

export const AUDIO_ROOT = 'audio';
// 2026-09-27: was the github.io address; the site is served by Cloudflare at this domain, and
// GitHub Pages is being switched off, which would have broken the link shown in the Task List.
export const SITE_BASE = 'https://catholictimeline.org';
const PRONUNCIATION_FILE = 'pronunciation/catholic-timeline-pronunciation.json';
// Closing invocation (2026-09-27): Saint entries (t: 's') end with a pause and then
// "<name>, pray for us." — spoken only; never added to the article text, and given no
// highlighting cue (there's no text on the page for it to highlight).
export const INVOCATION_PAUSE_SEC = 1.2;
// 2026-10-01: every recording starts with the article's name ("Blessed Virgin Mary."), then this
// pause. The app's speaker icon by the title plays just that part: 0 -> entry.audioTitleEnd.
export const TITLE_PAUSE_SEC = 1.3;   // was 0.8; a little more room after the name (2026-10-01)
const TYPE_FOLDERS = { s: 'Saints', c: 'Councils', p: 'Persecutions', m: 'Marian', u: 'Eucharistic', e: 'Events' };

// Same format/bitrate rationale as the original: mp3 at this bitrate is plenty for spoken
// narration and runs roughly 4-5x smaller than the wav this used to produce, with no audible
// quality loss for voice. Change here (and nowhere else) if a different bitrate/format is wanted.
export const OUTPUT_EXT = 'mp3';
const OUTPUT_BITRATE = '128k';

export function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }

// ---- Pronunciation (see PRONUNCIATION at the top) -------------------------------------------
let pronunciationRules = null;
// Spoken-title overrides (2026-10-06): alias rules whose string_to_replace starts with this prefix are
// NOT pronunciation fixes. They are looked up by spokenTitleFor() only, and are kept out of the rule
// list applyPronunciation() walks, so a short name like "Rome" can never collide with ordinary words
// in an article. Key: SpokenTitle:<entry id>  or  SpokenTitle:<entry name>  (id wins; use the id
// when two entries share a name, e.g. the two "St. Peter Damian" entries). The alias is the FULL
// announcement, e.g. "The Eucharistic Miracle at Meerssen, Netherlands."
export const SPOKEN_TITLE_PREFIX = 'SpokenTitle:';
let titleOverrides = new Map();
export async function loadPronunciationRules(){
  if(pronunciationRules) return pronunciationRules;
  try{
    const raw = JSON.parse(await fs.readFile(PRONUNCIATION_FILE, 'utf8'));
    // Pause rules (2026-10-04): { type: "pause", string_to_replace: "the faith Mary",
    // pause_after: "the faith" } — a comma is spoken after "the faith" wherever the whole phrase
    // appears. They go first and never consume the phrase, so sound fixes inside it still apply.
    const pauses = (raw.rules || [])
      .filter(r => r && r.type === 'pause' && r.string_to_replace && typeof r.pause_after === 'string'
        && r.pause_after.trim() && r.string_to_replace.startsWith(r.pause_after) && r.pause_after.length < r.string_to_replace.length)
      .map(r => ({ from: r.string_to_replace, pauseAt: r.pause_after.length, pause: true }));
    pronunciationRules = pauses.concat((raw.rules || [])
      .filter(r => r && r.type === 'alias' && r.string_to_replace && typeof r.alias === 'string' && !String(r.string_to_replace).startsWith(SPOKEN_TITLE_PREFIX))
      // kokoro_ipa (optional): exact sounds for the Kokoro voice, used instead of the alias
      // respelling when Kokoro is recording. ElevenLabs and the browser voice ignore it.
      .map(r => ({ from: r.string_to_replace, to: r.alias, ipa: typeof r.kokoro_ipa === 'string' && r.kokoro_ipa.trim() ? r.kokoro_ipa.trim() : '' })));
    titleOverrides = new Map((raw.rules || [])
      .filter(r => r && r.type === 'alias' && typeof r.string_to_replace === 'string' && r.string_to_replace.startsWith(SPOKEN_TITLE_PREFIX)
        && typeof r.alias === 'string' && r.alias.trim())
      .map(r => [r.string_to_replace.slice(SPOKEN_TITLE_PREFIX.length).trim(), r.alias.trim()]));
  }catch(e){
    pronunciationRules = []; // no file (or unreadable): narrate the text as written
    titleOverrides = new Map();
  }
  return pronunciationRules;
}
export async function loadSpokenTitleOverrides(){ await loadPronunciationRules(); return titleOverrides; }
const isWordChar = (ch) => !!ch && /[A-Za-z0-9\u00C0-\u024F]/.test(ch);
// Returns the text to speak, a position map (map[i] = where original character i starts in the
// spoken text; map[text.length] = spoken length), and how many replacements were made.
// Kokoro's markup gives a multi-word override's sound to the FIRST word only and treats the rest
// unreliably, so a phrase fix ("God's will" -> "ɡˈɑdz wˈɪl") is written as one override per word:
// "[God's](/ɡˈɑdz/) [will](/wˈɪl/)". The fix still applies only where the whole phrase appears.
// When the sounds can't be split word for word (a phrase fix saved as one run of sounds), the
// phrase is left to Kokoro's own reading rather than sent as a multi-word override. (2026-10-01)
// A lone "I" right after a capitalized name is a numeral, said "the first": "Leo I",
// "Constantinople I", "Pope Leo I convened". The dictionary's other numerals (II, III, XXVIII...) are
// ordinary rules; "I" can't be one, since it is also the word "I". So it is NOT changed:
// after a word that only starts a sentence ("Then I", "So I"), inside quotation marks
// ("Lord, I am not worthy"), as "I'm"/"I'll", or after counted things ("Book I", "Part I").
// "Vatican I" is said "Vatican One", matching the dictionary's "Vatican Two". A dictionary entry
// that covers the phrase ("John Paul I") wins, since it matches first. (2026-10-07)
const COUNTED = new Set(['Book', 'Part', 'Chapter', 'Volume', 'Vol', 'Section', 'Article', 'Canon', 'Session',
  'Act', 'Phase', 'Stage', 'Level', 'Class', 'Type', 'Grade', 'Appendix', 'Table', 'Figure', 'Question', 'Lesson', 'Psalm', 'Step',
  'Sermon', 'Homily', 'Letter', 'Epistle', 'Canto', 'Hymn', 'Treatise', 'Discourse', 'Oration', 'Tract']);
// After these "I" is always the word "I" (prayers): no one is "Jesus the first". Not Mary — Mary I of England.
const NEVER_NUMBERED = new Set(['God', 'Lord', 'Jesus', 'Christ', 'Father', 'Savior', 'Saviour', 'Spirit']);
// A verb only the speaker could use after "I" means it's the word "I": "Lord I am", "Christ I live".
// ("Leo I has", "Leo I sent" still read as "the first".)
const FIRST_PERSON = new Set(('am have believe know love pray beg ask trust adore praise thank give offer confess hope want ' +
  'desire seek beseech implore live say tell promise swear intend wish fear need feel think see hear come go will shall ' +
  'cannot can must may might would could should do').split(' '));
// Decisions from the models for this recording (decideRomanI): key -> "the first" | "One" | "I".
let romanIDecisions = new Map();
export function setRomanIDecisions(m){ romanIDecisions = m instanceof Map ? m : new Map(); }
export function regnalFirstAt(text, i){
  if(text[i] !== 'I') return null;
  // the models' vote for this spot wins; the rules below are the fallback (2026-10-07)
  if(text[i - 1] === ' ' && romanIDecisions.size){
    const d = romanIDecisions.get(iKey(text, i));
    if(d) return d === 'I' ? null : d;
  }
  const next = text[i + 1];
  if(isWordChar(next)) return null;
  // "Leo I's letter" -> "the first's"; "I'm", "I'll" are the word "I"
  const apos = next === "'" || next === '\u2019';
  const possessive = apos && text[i + 2] === 's' && !isWordChar(text[i + 3]);
  if(apos && isWordChar(text[i + 2]) && !possessive) return null;
  if(text[i - 1] !== ' ') return null;
  const m = text.slice(0, i - 1).match(/(\p{Lu}[\p{L}\p{M}]*)$/u);
  if(!m) return null;
  const prev = m[1];
  if(COMMON.has(prev.toLowerCase()) || COUNTED.has(prev) || NEVER_NUMBERED.has(prev)) return null;
  const nextWord = (text.slice(i + 1).match(/^\s+([a-z]+)/) || [])[1];
  if(nextWord && FIRST_PERSON.has(nextWord)) return null;
  // inside quotation marks? (curly pairs, or an odd number of straight quotes before it)
  const before = text.slice(0, i);
  const open = (before.match(/\u201c/g) || []).length - (before.match(/\u201d/g) || []).length;
  if(open > 0 || (before.match(/"/g) || []).length % 2 === 1) return null;
  return prev === 'Vatican' ? 'One' : 'the first';
}
// "I Corinthians", "II Kings", "3 John" -> "First/Second/Third ..." — the number comes before these books.
const BOOKS = /^(I{1,3}|[123]) (Samuel|Kings|Chronicles|Maccabees|Corinthians|Thessalonians|Timothy|Peter|John|Esdras)(?![\p{L}\p{M}])/u;
export function bookOrdinalAt(text, i){
  const m = BOOKS.exec(text.slice(i, i + 20));
  if(!m) return null;
  // "And I John saw the holy city" (Apoc. 21:2): with John/Peter, "I" followed by a word is the
  // speaker — only a verse number or punctuation after the name makes it the book ("I John 4:8").
  if(m[1] === 'I' && /^(John|Peter)$/.test(m[2]) && /^\s+[a-z]/.test(text.slice(i + m[0].length))) return null;
  const n = /\d/.test(m[1]) ? Number(m[1]) : m[1].length;
  return { len: m[1].length, say: ['First', 'Second', 'Third'][n - 1] };
}

export function kokoroMarkup(from, ipa){
  const words = String(from).split(/\s+/).filter(Boolean);
  if(words.length <= 1) return '[' + from + '](/' + ipa + '/)';
  const sounds = String(ipa).trim().split(/\s+/).filter(Boolean);
  if(sounds.length !== words.length) return from;
  return words.map((w, k) => '[' + w + '](/' + sounds[k] + '/)').join(' ');
}
// 2026-10-21: possessives after a pronunciation rule. possessiveAt -> how many characters of "'s" / "\u2019s" (2)
// or a bare trailing apostrophe on a word ending in s ("Gentiles'", 1) follow position p; 0 if none.
function possessiveAt(text, p){
  const a = text[p];
  if(a !== "'" && a !== '\u2019') return 0;
  if((text[p + 1] === 's' || text[p + 1] === 'S') && !isWordChar(text[p + 2])) return 2;
  if(!isWordChar(text[p + 1]) && /s$/i.test(text.slice(Math.max(0, p - 1), p))) return 1;   // plural possessive: no new sound
  return 0;
}
// The sound of the possessive on the LAST word's sounds: after s, z, sh, zh, ch, j -> "ɪz"; after p, t, k, f, th -> "s";
// otherwise "z". A bare apostrophe (len 1) adds nothing.
function possessiveIpa(ipa, len){
  if(len !== 2) return ipa;
  const t = String(ipa).trim(), last = t.replace(/[ˈˌː.]+$/, '').slice(-1);
  const add = /[szʃʒʧʤ]/.test(last) ? 'ɪz' : /[ptkfθ]/.test(last) ? 's' : 'z';
  return t + add;
}
export function applyPronunciation(text, rules, useIpa, extras){   // extras (2026-10-19): [{at, len, ipa}] one use of a two-sound word, Kokoro only
  const map = new Array(text.length + 1);
  let out = '', count = 0, i = 0;
  const pauseAt = new Set();          // positions in the original text where a comma is spoken first
  const flushPause = (upto) => {      // speak any pause due at or before this position (once)
    for(const p of [...pauseAt]) if(p <= upto){
      pauseAt.delete(p);
      if(!/[,;:.!?\u2014]\s*$/.test(out)) out += ',';
    }
  };
  while(i < text.length){
    flushPause(i);
    // "II Kings" -> "Second Kings" before the dictionary's bare "II" -> "the second" can apply (2026-10-07)
    const bo = !isWordChar(text[i - 1]) ? bookOrdinalAt(text, i) : null;
    if(bo){
      for(let k = 0; k < bo.len; k++) map[i + k] = out.length;
      out += bo.say;
      i += bo.len;
      count++;
      continue;
    }
    let hit = null;
    if(!isWordChar(text[i - 1])){
      for(const r of rules){
        if(!(text.startsWith(r.from, i) && !isWordChar(text[i + r.from.length]))) continue;
        // A bare roman numeral ("X" -> "the tenth") never applies to a letter hyphenated onto a word:
        // "X-shaped", "X-ray", "V-neck" stay as written; "Pius X" is still "Pius the tenth". (2026-10-11)
        if(/^[IVXLCDM]+$/.test(r.from) && ((text[i + r.from.length] === '-' && isWordChar(text[i + r.from.length + 1])) || (text[i - 1] === '-' && isWordChar(text[i - 2])))) continue;
        if(r.pause){ pauseAt.add(i + r.pauseAt); count++; continue; }   // mark it; keep looking for a sound/spelling rule here
        hit = r; break;
      }
      // A two-sound word judged for THIS sentence (heteronyms.mjs). A phrase rule that starts here still
      // wins (it was chosen for exactly this wording); a single-word rule does not.
      const x = (useIpa && extras && extras.length) ? extras.find(o => o.at === i) : null;
      if(x && !(hit && /\s/.test(hit.from))) hit = { from: text.slice(i, i + x.len), ipa: x.ipa, to: text.slice(i, i + x.len) };
    }
    // A date is spoken with an ordinal day: "October 3, 1952" -> "October third, 1952" (2026-10-05).
    // Checked before the rules so a month name never gets a rule of its own in between.
    const sd = !hit && !isWordChar(text[i - 1]) ? spokenDateAt(text, i) : null;
    if(sd){
      for(let k = 0; k < sd.len; k++) map[i + k] = out.length;
      out += sd.say;
      i += sd.len;
      count++;
      continue;
    }
    // "Leo I", "Constantinople I" -> "the first" (2026-10-07); see regnalFirstAt().
    const rf = !hit && !isWordChar(text[i - 1]) ? regnalFirstAt(text, i) : null;
    if(rf){
      // 2026-10-22: a possessive ("Callistus I's") is sent to Kokoro as "the firsts" with no apostrophe.
      // Kokoro's own reader turned "the first's" into "the,, firstizz". ElevenLabs keeps "the first's".
      const pz = useIpa ? possessiveAt(text, i + 1) : 0;
      const take = pz === 2 ? 3 : 1;
      for(let k = 0; k < take; k++) map[i + k] = out.length;
      out += pz === 2 ? rf + 's' : rf;
      i += take;
      count++;
      continue;
    }
    if(hit){
      // 2026-10-21: a possessive right after a rule ("Pope Callistus I's", "Gentiles'") goes INSIDE the Kokoro
      // markup, with its own sound on the last word. Left outside, Kokoro got "[...](/.../)'s" and mangled it.
      const poss = (useIpa && hit.ipa) ? possessiveAt(text, i + hit.from.length) : 0;
      for(let k = 0; k < hit.from.length + poss; k++) map[i + k] = out.length;
      // Kokoro: [word](/sounds/) markup when the rule has kokoro_ipa; otherwise the alias text.
      out += (useIpa && hit.ipa)
        ? (poss ? kokoroMarkup(hit.from + text.slice(i + hit.from.length, i + hit.from.length + poss), possessiveIpa(hit.ipa, poss))
                : kokoroMarkup(hit.from, hit.ipa))
        : hit.to;
      i += hit.from.length + poss;
      count++;
    }else{
      flushPause(i);
      map[i] = out.length;
      out += text[i];
      i++;
    }
  }
  flushPause(text.length);
  map[text.length] = out.length;
  return { spoken: out, map, count };
}

// Custom closing prayer (2026-10-01): an article may end with "[prayer] Holy Mary, our Blessed
// Mother, pray for us." Everything from the marker on is the prayer: spoken at the end instead of
// the default, and never shown on the page (the app hides it too). Without a marker, saints get
// the default "<name>, pray for us." and other entries get none.
const PRAYER_MARK = /\[prayer\]/i;
export function readingSections(entry){
  const out = [];
  for(const s of ((entry.art && entry.art.sections) || [])){
    const b = String((s && s.b) || '');
    const m = PRAYER_MARK.exec(b);
    if(m){ out.push(Object.assign({}, s, { b: b.slice(0, m.index).replace(/(?:<[^>]*>|\s)+$/, '') })); break; }   // later sections belong to the prayer
    out.push(s);
  }
  return out;
}
export function customPrayer(entry){
  for(const s of ((entry.art && entry.art.sections) || [])){
    const b = String((s && s.b) || '');
    const m = PRAYER_MARK.exec(b);
    if(m) return stripHtml(b.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  }
  return '';
}
export function prayerFor(entry){ return customPrayer(entry) || invocationFor(entry); }
// The name as spoken at the start: abbreviations spelled out, ending with a full stop.
export function titleFor(entry){
  const name = String((entry && entry.n) || '').trim()
    .replace(/\bSts\.\s+/g, 'Saints ')
    .replace(/\bSt\.\s+/g, 'Saint ')
    .replace(/\bBl\.\s+/g, 'Blessed ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[.,;:\s]+$/, '');
  return name ? name + '.' : '';
}

// ---- Spoken title (2026-10-06) ----------------------------------------------------------------
// What a recording announces first. Order: (1) a SpokenTitle: override from the pronunciation
// table (id, then name) is used exactly as written; (2) otherwise a rule for the entry's category
// builds it; (3) otherwise the plain name, as before (titleFor). The result still goes through the
// normal pronunciation rules afterwards, so "Pius XII" etc. are still fixed inside it.
//   Eucharistic Miracle  "The Eucharistic Miracle at Meerssen, Netherlands."  (Turin I -> "The First ... at Turin, Italy.")
//                        saint-named ones: "The Eucharistic Miracle of Saint Peter Damian."  (no country)
//   Council              "Nicaea I" -> "The First Council of Nicaea."; "Ephesus" -> "The Council of Ephesus."; others get "The"
//   Marian apparition    "The Apparition of Our Lady of Lourdes, France."
//   Persecution          "The" + name (not before a possessive such as "Trajan's Rescript")
//   Saint (t: 's')       as titleFor; "(Edith Stein)" -> ", also known as Edith Stein"
//   everything else      as titleFor. Roman numerals on popes/events are left to the pronunciation table.
const ORDINALS = ['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh','Twelfth','Thirteenth','Fourteenth','Fifteenth','Sixteenth','Seventeenth','Eighteenth','Nineteenth','Twentieth'];
const RE_ROMAN = /^(X{0,2})(IX|IV|V?I{0,3})$/;
function ordinalFromRoman(r){
  const m = RE_ROMAN.exec(r || '');
  if(!m || !r) return '';
  const v = {I:1,V:5,X:10}, d = { IX:9, IV:4 };
  const n = (m[1].length * 10) + (d[m[2]] || ([...m[2]].reduce((a, c) => a + v[c], 0)));
  return n >= 1 && n <= ORDINALS.length ? ORDINALS[n - 1] : '';
}
const RE_TRAIL_ROMAN = /^(.*\S)\s+([IVX]{1,5})$/;
const withThe = (s) => /^the\s/i.test(s) ? s : 'The ' + s;
export function spokenTitleFor(entry, overrides){
  const base = titleFor(entry);
  if(!entry || !entry.n || !base) return base;
  const ov = overrides && (overrides.get(String(entry.id)) || overrides.get(String(entry.n).trim()));
  if(ov) return /[.!?]$/.test(ov) ? ov : ov + '.';

  let name = base.replace(/\.$/, '');
  let paren = '';
  const pm = /\s*\(([^)]*)\)\s*$/.exec(name);
  if(pm){ paren = pm[1].trim(); name = name.slice(0, pm.index).trim(); }
  const country = (entry.country && !/^none$/i.test(String(entry.country).trim())) ? String(entry.country).trim() : '';
  const rm = RE_TRAIL_ROMAN.exec(name);
  const ord = rm ? ordinalFromRoman(rm[2]) : '';

  switch(entry.t){
    case 's':
      return name + (paren ? ', also known as ' + paren : '') + '.';
    case 'u': {
      const place = ord ? rm[1] : name;
      const head = ord ? 'The ' + ord + ' Eucharistic Miracle' : 'The Eucharistic Miracle';
      if(/^(Saint|Saints|Blessed)\b/.test(place)) return head + ' of ' + place + '.';
      // A parenthetical with a year or century in it is kept (", 1610") so the two Romes differ;
      // any other parenthetical (a church, a region) is dropped. Both still deserve a look.
      return head + ' at ' + place + (/\d/.test(paren) ? ', ' + paren : '') + (country ? ', ' + country : '') + '.';
    }
    case 'c':
      if(ord) return 'The ' + ord + ' Council of ' + rm[1] + '.';
      if(/\b(Council|Synod)\b/.test(name)) return withThe(name) + '.';
      return 'The Council of ' + name + '.';
    case 'm': {
      const pre = /^Our Lady\b/i.test(name) ? 'The Apparition of ' : (/ and /.test(name) ? 'The Apparitions at ' : 'The Apparition at ');
      return pre + name + (country ? ', ' + country : '') + '.';
    }
    case 'p':
      return (/^[A-Za-z]+'s\b/.test(name) ? name : withThe(name)) + '.';
    default:
      return base;
  }
}

// One {heading, body} pair per section, whitespace-collapsed. Sections with no body text are
// dropped (nothing to narrate). The prayer (see above) is not part of the body.
function sectionParts(entry){
  const sections = readingSections(entry);
  return sections
    .map(s => ({
      heading: stripHtml(s.h || '').replace(/\s+/g, ' ').trim(),
      body: stripHtml(s.b || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(s => s.body);
}
function hasNarratableText(entry){ return sectionParts(entry).length > 0; }

// "St. John Paul II" → "Saint John Paul II, pray for us." (the pronunciation rules then turn
// II into "the second"). Abbreviations are spelled out so the voice doesn't say "Street":
// St. → Saint, Sts. → Saints, Bl. → Blessed; "&" → "and". Saint entries only.
// Default closing prayers by category (2026-10-15). Saints and Marian apparitions pray with their own name;
// Councils, Persecutions and Eucharistic Miracles use one fixed line; Events (e) have none.
const PRAYER_BY_TYPE = {
  c: 'Holy Spirit, protector of the Church, guide us into all truth.',
  p: 'Holy martyrs of the Church, pray for us.',
  u: 'O Sacrament most holy, O Sacrament divine, all praise and all thanksgiving be every moment thine.'
};
// Marian entries whose name does not read as an invocation (matched on the entry name).
const MARIAN_PRAYER_BY_NAME = {
  'Miraculous Medal (Rue du Bac)': 'O Mary, conceived without sin, pray for us who have recourse to thee.',
  'Beauraing & Banneux': 'Our Lady of Beauraing and Banneux, pray for us.'
};
export function invocationFor(entry){
  if(!entry || !entry.t) return '';
  if(PRAYER_BY_TYPE[entry.t]) return PRAYER_BY_TYPE[entry.t];
  if(entry.t !== 's' && entry.t !== 'm') return '';
  if(!entry.n) return '';
  if(entry.t === 'm' && MARIAN_PRAYER_BY_NAME[String(entry.n).trim()]) return MARIAN_PRAYER_BY_NAME[String(entry.n).trim()];
  const name = String(entry.n).trim()
    .replace(/\bSts\.\s+/g, 'Saints ')
    .replace(/\bSt\.\s+/g, 'Saint ')
    .replace(/\bBl\.\s+/g, 'Blessed ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[.,;:\s]+$/, '');
  return name ? name + ', pray for us.' : '';
}

function round2(n){ return Math.round(n * 100) / 100; }

// Calls ElevenLabs' timestamped endpoint, writes the decoded mp3 to outPath, and returns the
// character-level alignment for that exact input text.
export async function ttsWithTimestamps(text, outPath, voiceId, modelId, voiceSettings, apiKey){
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings })
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    // 2026-09-27: running out of ElevenLabs credits (or hitting its rate limit) isn't a failure
    // of this task — throwing with `deferred` makes the orchestrator put the task back in the
    // queue untouched, stop attempting the rest of the batch, and leave a plain-language notice,
    // instead of marking every remaining task as a red error.
    if(/quota_exceeded|insufficient|credits remaining/i.test(errText)){
      const e = new Error('ElevenLabs credits are used up — run again after they reset or are topped up');
      e.deferred = true;
      throw e;
    }
    if(res.status === 429){
      const e = new Error('ElevenLabs is rate-limiting requests right now — run again in a few minutes');
      e.deferred = true;
      throw e;
    }
    throw new Error(`ElevenLabs API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  await fs.writeFile(outPath, Buffer.from(data.audio_base64, 'base64'));
  return data.alignment || null;
}

export function chunkDuration(alignment, mp3Path){
  const ends = alignment && alignment.character_end_times_seconds;
  if(ends && ends.length) return ends[ends.length - 1];
  try{
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3Path}"`).toString().trim();
    return parseFloat(out) || 0;
  }catch{ return 0; }
}

export function makeSilence(durationSec, outPath){
  if(durationSec <= 0) return false;
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${durationSec.toFixed(2)} -q:a 9 "${outPath}"`, { stdio: 'inherit' });
  return true;
}

// Decodes/re-encodes every segment into one final audio file via ffmpeg's concat *filter* (not
// the concat demuxer) — tolerates the mp3-vs-silence-mp3 format differences that broke
// stream-copy concat in testing. Final output is re-encoded (libmp3lame's default encoder for a
// .mp3 target) rather than stream-copied, since concat's filter graph always re-encodes anyway.
export function concatSegments(files, audioOut, dir){
  const rel = files.map(f => path.relative(dir, f));
  const inputs = rel.map(f => `-i "${f}"`).join(' ');
  const filterIn = rel.map((_, i) => `[${i}:a]`).join('');
  const filter = `${filterIn}concat=n=${rel.length}:v=0:a=1[out]`;
  execSync(`ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[out]" -c:a libmp3lame -b:a ${OUTPUT_BITRATE} "${path.basename(audioOut)}"`, { stdio: 'inherit', cwd: dir });
}

// Narrates one entry: heading (optional) + body per section, each its own timestamped TTS call,
// with silence gaps inserted between heading→body and between sections so nothing runs together.
// Returns the final audio path, total duration, and a `cues` array of {section, type, text,
// start, end} in seconds — the raw material for the site's sentence-highlighting player.
async function narrateEntry(entry, dir, baseName, opts, apiKey){
  const { voiceId, modelId, voiceSettings, readHeadings, headingPauseSec, sectionPauseSec } = opts;
  const rules = await loadPronunciationRules();
  let replacements = 0;
  const parts = sectionParts(entry);
  const segmentFiles = [];
  const cues = [];
  let cumulative = 0;
  let tmpIndex = 0;
  const tmp = () => path.join(dir, `${baseName}.tmp${tmpIndex++}.mp3`);

  for(let si = 0; si < parts.length; si++){
    const { heading, body } = parts[si];

    if(si > 0 && sectionPauseSec > 0){
      const gap = tmp();
      makeSilence(sectionPauseSec, gap);
      segmentFiles.push(gap);
      cumulative += sectionPauseSec;
    }

    if(readHeadings && heading){
      const hPath = tmp();
      const h = applyPronunciation(heading, rules);
      replacements += h.count;
      const alignment = await ttsWithTimestamps(h.spoken, hPath, voiceId, modelId, voiceSettings, apiKey);
      segmentFiles.push(hPath);
      const dur = chunkDuration(alignment, hPath);
      cues.push({ section: si, type: 'heading', text: heading, start: round2(cumulative), end: round2(cumulative + dur) });
      cumulative += dur;

      if(headingPauseSec > 0){
        const gap = tmp();
        makeSilence(headingPauseSec, gap);
        segmentFiles.push(gap);
        cumulative += headingPauseSec;
      }
    }

    const bPath = tmp();
    const b = applyPronunciation(body, rules);
    replacements += b.count;
    const alignment = await ttsWithTimestamps(b.spoken, bPath, voiceId, modelId, voiceSettings, apiKey);
    segmentFiles.push(bPath);
    const dur = chunkDuration(alignment, bPath);

    if(alignment && alignment.characters && alignment.characters.length){
      splitSentences(body).forEach(sen => {
        // Sentences are found in the article's own text; b.map moves their positions onto the
        // spoken text the timings describe. Cue text stays the article's own wording.
        const startIdx = Math.max(0, Math.min(b.map[sen.start], alignment.characters.length - 1));
        const endIdx = Math.max(0, Math.min(b.map[sen.end] - 1, alignment.characters.length - 1));
        const start = alignment.character_start_times_seconds[startIdx] ?? 0;
        const end = alignment.character_end_times_seconds[endIdx] ?? dur;
        cues.push({ section: si, type: 'sentence', text: sen.text, start: round2(cumulative + start), end: round2(cumulative + end) });
      });
    }else{
      // No alignment returned (shouldn't normally happen) — fall back to one cue for the whole paragraph.
      cues.push({ section: si, type: 'sentence', text: body, start: round2(cumulative), end: round2(cumulative + dur) });
    }
    cumulative += dur;
  }

  // Closing invocation (default for the category, see invocationFor): a pause, then the prayer. Spoken only.
  const invocation = prayerFor(entry);   // the article's own [prayer], else the default for saints
  if(invocation){
    const gap = tmp();
    makeSilence(INVOCATION_PAUSE_SEC, gap);
    segmentFiles.push(gap);
    cumulative += INVOCATION_PAUSE_SEC;
    const iPath = tmp();
    const inv = applyPronunciation(invocation, rules);
    replacements += inv.count;
    const alignment = await ttsWithTimestamps(inv.spoken, iPath, voiceId, modelId, voiceSettings, apiKey);
    segmentFiles.push(iPath);
    cumulative += chunkDuration(alignment, iPath);
  }

  const audioPath = path.join(dir, `${baseName}.${OUTPUT_EXT}`);
  concatSegments(segmentFiles, audioPath, dir);
  await Promise.all(segmentFiles.map(f => fs.unlink(f).catch(() => {})));

  return { audioPath, durationSec: round2(cumulative), cues, replacements };
}

// The sentence splitter can cut after an abbreviation ("...beside St." / "Martial. Another..."),
// which the Kokoro path would speak as two separate pieces with a pause between them. Glue those
// back together. Uses the original character offsets when the splitter provides them, so the cue
// text stays exactly what is on the page; otherwise joins with one space (the page's own spacing).
const ABBREV_END = /(?:\b(?:St|Sts|Mt|Mr|Mrs|Ms|Dr|Fr|Bl|Ven|Msgr|Jr|Sr|Gen|Rev|Hon|Prof|vs|cf|ca|approx|no|vol|ch)\.|\b[A-Z]\.)$/;
const DATE_ABBREV_END = /\b(?:A\.D|B\.C|C\.E|B\.C\.E|A\.M|P\.M)\.$/;
function mergeAbbrevSplits(list, body){
  const out = [];
  for(const cur of list){
    const prev = out[out.length - 1];
    const next = String(cur.text || '');
    const glue = prev && (
      ABBREV_END.test(prev.text) ||
      (DATE_ABBREV_END.test(prev.text) && /^[0-9a-z]/.test(next))
    );
    if(glue){
      const hasOffsets = Number.isFinite(prev.start) && Number.isFinite(cur.end) && cur.end > prev.start;
      prev.text = hasOffsets ? body.slice(prev.start, cur.end).trim() : (prev.text + ' ' + next).trim();
      if(Number.isFinite(cur.end)) prev.end = cur.end;
    }else{
      out.push(Object.assign({}, cur, { text: next }));
    }
  }
  return out;
}

// Kokoro version of narrateEntry(): same order of things (heading, pause, body, section gap,
// closing prayer) and the same cue shape, but the whole recording is built in memory. Every
// sentence is its own Kokoro call, so its start/end come straight from the audio length so far —
// exact by construction. Cue text is the article's own wording; pronunciation rules change only
// what is spoken.
async function narrateEntryKokoro(entry, dir, baseName, opts){
  const { voiceId, speed, readHeadings, headingPauseSec, sectionPauseSec, sentencePauseSec, titlePauseSec } = opts;
  const prayerSpeed = opts.prayerSpeed || speed;
  const voice = kokoroVoiceName(voiceId);
  const rules = await loadPronunciationRules();
  const parts = sectionParts(entry);
  let replacements = 0;

  // PASS 1 \u2014 plan the whole recording: what is spoken, what the cue says, and where the silences go.
  // Nothing is synthesized yet, so every piece can be sent to Kokoro in ONE batch (the model loads
  // once per entry, not once per sentence).
  const plan = [];   // {gap:sec} | {type, section, cueText, spoken}
  const speak = (type, section, cueText) => { plan.push({ type, section, cueText }); };   // spoken text is made below
  // The name first ("Blessed Virgin Mary."), then a pause. No cue: it isn't article text.
  const title = spokenTitleFor(entry, await loadSpokenTitleOverrides());   // 2026-10-06: was titleFor(entry)
  if(title){
    speak('title', -1, title);
    plan.push({ gap: titlePauseSec });
  }
  for(let si = 0; si < parts.length; si++){
    const { heading, body } = parts[si];
    if(si > 0) plan.push({ gap: sectionPauseSec });
    if(readHeadings && heading){
      speak('heading', si, heading);
      plan.push({ gap: headingPauseSec });
    }
    const sentences = splitSentences(body);
    const list = sentences && sentences.length ? mergeAbbrevSplits(sentences, body) : [{ text: body }];
    for(let k = 0; k < list.length; k++){
      speak('sentence', si, list[k].text);
      if(k < list.length - 1) plan.push({ gap: sentencePauseSec });
    }
  }
  // Closing invocation for saints: a pause, then "<name>, pray for us." Spoken only, no cue.
  const invocation = prayerFor(entry);   // the article's own [prayer], else the default for saints
  if(invocation){
    plan.push({ gap: INVOCATION_PAUSE_SEC });
    speak('invocation', -1, invocation);
  }

  // Words with two sounds (2026-10-19): one AI call for the whole article decides each use, then every
  // piece gets its pronunciation rules plus those per-use sounds.
  const toSay = plan.filter(x => x.gap === undefined);
  let hetero = null;
  try{
    const mod = await import('./heteronyms.mjs');
    hetero = await mod.heteronymPicks(toSay.map(x => x.cueText));
  }catch(e){ hetero = { extras: [], found: 0, asked: 0, fromMemory: 0, error: 'heteronyms.mjs: ' + String((e && e.message) || e).slice(0, 120), filesToCommit: [] }; }
  toSay.forEach((x, k) => {
    const r = applyPronunciation(x.cueText, rules, true, (hetero.extras || [])[k]);
    replacements += r.count;
    x.spoken = r.spoken;
  });

  // PASS 2 \u2014 synthesize everything, then lay it down in order. Each cue's start/end is simply the
  // running length of the audio so far, so the highlighting timings are exact by construction.
  const spokenItems = plan.filter(x => x.gap === undefined);
  // The closing prayer may have its own pace (prayerSpeed, default 0.9 — a little slower).
  const audio = await synthBatch(spokenItems.map(x => x.spoken), voice, speed,
    spokenItems.map(x => x.type === 'invocation' ? prayerSpeed : speed));
  const track = new Track();
  const cues = [];
  let n = 0, titleEnd = 0, prayer = null;
  for(const step of plan){
    if(step.gap !== undefined){ track.addSilence(step.gap); continue; }
    const start = track.seconds;
    track.addSamples(audio[n++]);
    if(step.type === 'title'){ titleEnd = round2(track.seconds); continue; }
    // The closing prayer's exact place, for the app's finale (2026-10-10)
    if(step.type === 'invocation'){ prayer = { start: round2(start), end: round2(track.seconds), text: step.cueText || step.text || '' }; continue; }
    if(step.type !== 'invocation'){
      cues.push({ section: step.section, type: step.type, text: step.cueText, start: round2(start), end: round2(track.seconds) });
    }
  }

  const audioPath = path.join(dir, `${baseName}.${OUTPUT_EXT}`);
  await trackToMp3(track, audioPath);
  return { audioPath, durationSec: round2(track.seconds), cues, replacements, titleEnd, prayer, hetero };
}

export function nextVersion(entry){
  if(!entry.audio) return 1;
  const m = entry.audio.match(/-v(\d+)\.\w+$/);
  if(!m) return 1;
  // Reached whenever this task ran against an entity that already had audio — the client-side
  // pool already made that an explicit, opt-in choice ("Include entries that already have
  // recorded audio") before this task was ever queued, so always creating a new version file
  // here (never silently overwriting) is correct regardless of why it happened.
  return parseInt(m[1], 10) + 1;
}

// The version number from the article's link can point at a name that's already taken (an old
// recording whose link was lost, e.g. after the text was rewritten). Reusing that name made phones
// and the site's cache keep playing the OLD file, so step past every name already in the folder:
// a new recording always gets a name nobody has cached.
export async function freeVersion(entry, dir){
  let v = nextVersion(entry);
  for(;;){
    try{ await fs.access(path.join(dir, entry.id + '-v' + v + '.' + OUTPUT_EXT)); v++; }
    catch(e){ return v; }
  }
}

// Cleanup (2026-10-01): once a new recording exists, every OLDER version of the same article's
// recording is deleted — "<id>-vN.mp3" and its "<id>-vN.json", in any type folder under audio/ —
// keeping only the files just written. Returns the deleted repo paths; the caller adds them to
// filesToCommit, so the deletions land in the same commit as the new files and data.json (the
// orchestrator's `git add <path>` records a deletion for a path that's gone). Only runs after the
// new recording is fully written, so a failed recording never deletes anything.
export async function removeOldVersions(entryId, keepPaths){
  const keep = new Set(keepPaths.map(x => x.split(path.sep).join('/')));
  const esc = String(entryId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc + '-v\\d+\\.(?:' + OUTPUT_EXT + '|json)$');
  const removed = [];
  let folders = [];
  try{ folders = (await fs.readdir(AUDIO_ROOT, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); }
  catch{ return removed; }
  for(const folder of folders){
    let names = [];
    try{ names = await fs.readdir(path.join(AUDIO_ROOT, folder)); }catch{ continue; }
    for(const name of names){
      if(!re.test(name)) continue;
      const rel = AUDIO_ROOT + '/' + folder + '/' + name;
      if(keep.has(rel)) continue;
      try{ await fs.unlink(path.join(AUDIO_ROOT, folder, name)); removed.push(rel); }catch{}
    }
  }
  return removed;
}

// Voice/model/settings from a task payload (shared with audio-invocation.mjs).
export function voiceFromPayload(p){
  const voiceId = String(p.voiceId || '').trim();
  if(!voiceId) throw new Error('Task has no voiceId in its payload \u2014 requeue from Add Task with a Voice ID set.');
  return {
    voiceId,
    modelId: p.modelId || 'eleven_multilingual_v2',
    voiceSettings: {
      stability: clamp(parseFloat(p.stability ?? 0.5), 0, 1),
      similarity_boost: clamp(parseFloat(p.similarityBoost ?? 0.75), 0, 1),
      style: clamp(parseFloat(p.style ?? 0), 0, 1),
      speed: clamp(parseFloat(p.speed ?? 1), 0.25, 4),
      use_speaker_boost: p.useSpeakerBoost !== false
    }
  };
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */

// Numbered names the dictionary should always have (2026-10-07): councils are said "One", like
// its "Constantinople Two"; "World War I" is "World War One". Added once if missing — never
// overwriting an entry Tom has saved for the same words — and committed with the recording.
const NUMERAL_ENTRIES = [['Nicaea I', 'Nicaea One'], ['Constantinople I', 'Constantinople One'], ['Lateran I', 'Lateran One'],
  ['Lyon I', 'Lyon One'], ['Lyons I', 'Lyons One'], ['Vatican I', 'Vatican One'], ['World War I', 'World War One']];
async function ensureNumeralEntries(){
  let raw;
  try{ raw = JSON.parse(await fs.readFile(PRONUNCIATION_FILE, 'utf8')); }catch(e){ return []; }
  raw.rules = Array.isArray(raw.rules) ? raw.rules : [];
  const have = new Set(raw.rules.map(r => r && r.string_to_replace));
  const add = NUMERAL_ENTRIES.filter(([from]) => !have.has(from));
  if(!add.length) return [];
  for(const [from, alias] of add) raw.rules.push({ string_to_replace: from, type: 'alias', alias, case_sensitive: true, word_boundaries: true, source: 'numerals' });
  await fs.writeFile(PRONUNCIATION_FILE, JSON.stringify(raw, null, 2));
  pronunciationRules = null;
  return [PRONUNCIATION_FILE];
}

// One line for the run summary: what this recording's AI calls cost (ai-router's log).
let aiCostLine = '';
function aiCostSummary(){ return aiCostLine; }

// One line for the run summary about "I" after names.
function romanISummary(r){
  if(!r || !r.asked) return r && r.error ? ' \u2014 "I" check skipped (' + r.error.slice(0, 80) + ')' : '';
  return ' \u2014 "I" after a name: ' + r.decided.length + ' of ' + r.asked + ' decided by ' + ((r.decided[0] && r.decided[0].votes[0]) || 'the model') +
    (r.decided.length ? ' (' + r.decided.map(d => d.context + ' \u2192 ' + d.say).join('; ').slice(0, 200) + ')' : '') +
    (r.decided.length < r.asked ? ', the rest by the recorder\'s rules' : '');
}

// One line for the run summary about the pronunciation check.
function voteSummary(v){
  if(!v || v.skipped) return '';
  if(v.error) return ' \u2014 pronunciation check skipped (' + v.error.slice(0, 100) + ')';
  if(!v.checked && v.pickedBy && v.skipped) return ' \u2014 pronunciation check: ' + v.pickedBy + ' found nothing unusual (' + v.skipped + ' ordinary word' + (v.skipped === 1 ? '' : 's') + ' skipped)';
  if(!v.checked) return v.errors && v.errors.length ? ' \u2014 pronunciation check: no answers (' + v.errors.join('; ').slice(0, 160) + ')' : '';
  return ' \u2014 pronunciation check: ' + (v.pickedBy ? v.pickedBy + ' picked ' + v.picked + ' word' + (v.picked === 1 ? '' : 's') + ' to check (' + v.skipped + ' ordinary skipped), ' : '') + v.checked + ' compared' +
    (v.corrected.length ? ', ' + v.corrected.length + ' added to the dictionary: ' + v.corrected.map(c => c.word + ' \u2192 ' + c.respell + ' (' + c.votes.join(' + ') + ')').join('; ') : ', all as Kokoro says them') +
    (v.errors && v.errors.length ? ' [' + v.errors.join('; ').slice(0, 120) + ']' : '');
}

export async function runAudioGenerate(task, dataJson){
  const kokoro = isKokoroVoice((task.payload || {}).voiceId);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if(!kokoro && !apiKey) throw new Error('Missing ELEVENLABS_API_KEY secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry){
    return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };
  }
  if(!hasNarratableText(entry)){
    return { result: { entityId: entry.id, name: entry.n }, summary: 'skipped \u2014 no article text to narrate' };
  }
  // American date order first ("28 December 1065" -> "December 28, 1065"), so the saved text,
  // the recording and its sentence timing all match. Quotes from sources are left alone.
  const datesFixed = americanizeEntryDates(entry);
  // A new recording has to be listened to again before it counts as checked (2026-10-05).
  if(entry.qc){ delete entry.qc.pronChecked; delete entry.qc.pronCheckedAt; }

  const p = task.payload || {};
  const numeralFiles = await ensureNumeralEntries();   // councils "One", "World War One" (2026-10-07)
  // Pronunciation check (2026-10-07): capitalized words not in the dictionary — Kokoro vs Claude,
  // OpenAI and Gemini; two agreeing against Kokoro add a dictionary fix, used in this recording.
  let vote = null, romanI = null;
  if(kokoro && p.pronVote !== false){
    try{ vote = await pronVote(entry); }catch(e){ vote = { error: String(e.message || e) }; }
    pronunciationRules = null;   // reload, so a fix added just now is used below
  }
  // "I" after a name: one model decides "the first" / "One" / the word "I" (2026-10-07)
  setRomanIDecisions(new Map());
  if(p.pronVote !== false && process.env.PRON_VOTE !== '0'){
    try{
      const raw = JSON.parse(await fs.readFile(PRONUNCIATION_FILE, 'utf8').catch(() => '{"rules":[]}'));
      romanI = await decideRomanI(entry, raw.rules || []);
      setRomanIDecisions(romanI.decisions);
    }catch(e){ romanI = { error: String(e.message || e) }; }
  }
  const { voiceId, modelId, voiceSettings } = voiceFromPayload(p);
  const readHeadings = p.readHeadings !== false;
  // Pauses in milliseconds from the app's Voice & pacing settings (2026-10-01: all four adjustable;
  // a blank field means the default, and 0 is allowed).
  const ms = (v, def) => { const n = parseInt(v, 10); return (Number.isFinite(n) && n >= 0 ? Math.min(n, 10000) : def) / 1000; };
  const headingPauseSec = ms(p.headingPauseMs, 500);
  const sectionPauseSec = ms(p.sectionPauseMs, 700);
  const sentencePauseSec = ms(p.sentencePauseMs, parseInt(process.env.KOKORO_SENTENCE_PAUSE_MS, 10) || 200);
  const titlePauseSec = ms(p.titlePauseMs, TITLE_PAUSE_SEC * 1000);

  const folder = TYPE_FOLDERS[entry.t] || 'Other';
  const dir = path.join(AUDIO_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });

  const version = await freeVersion(entry, dir);
  const baseName = entry.id + '-v' + version;
  const engine = kokoro ? 'kokoro:' + kokoroVoiceName(voiceId) : 'elevenlabs:' + voiceId;
  const { audioPath, durationSec, cues, replacements, titleEnd, prayer, hetero } = kokoro
    ? await narrateEntryKokoro(entry, dir, baseName, {
        voiceId, speed: kokoroSpeed(p), prayerSpeed: kokoroSpeed({ speed: p.prayerSpeed || 0.9 }), readHeadings, headingPauseSec, sectionPauseSec,
        sentencePauseSec, titlePauseSec
      })
    : await narrateEntry(
        entry, dir, baseName,
        { voiceId, modelId, voiceSettings, readHeadings, headingPauseSec, sectionPauseSec },
        apiKey
      );

  const relAudio = path.join(AUDIO_ROOT, folder, path.basename(audioPath)).split(path.sep).join('/');
  const relTiming = relAudio.replace(new RegExp('\\.' + OUTPUT_EXT + '$'), '.json');
  const timingPath = audioPath.replace(new RegExp('\\.' + OUTPUT_EXT + '$'), '.json');
  await fs.writeFile(timingPath, JSON.stringify({ id: entry.id, audio: relAudio, engine, durationSec, titleEnd: titleEnd || 0, ...(prayer ? { prayer } : {}), cues }, null, 1));

  entry.audio = relAudio;
  entry.audioTiming = relTiming;
  entry.audioEngine = engine;
  // Recorded with the closing prayer (saints only) — "Add closing prayer" skips entries with this.
  if(prayerFor(entry)) entry.audioInvocation = true; else delete entry.audioInvocation;
  // Where the spoken name ends (Kokoro recordings): the app's speaker icon by the title plays 0 -> here.
  if(titleEnd) entry.audioTitleEnd = titleEnd; else delete entry.audioTitleEnd;
  // Recorded with the pronunciation rules applied — the app's "recorded before the pronunciation
  // fix" check skips entries with this stamp.
  entry.audioPron = true;
  // Keep only this recording: delete the article's older versions (committed with the new files).
  const removed = await removeOldVersions(entry.id, [relAudio, relTiming]);

  // AI spend for this recording (2026-10-11): logged to ai/usage/<month>.jsonl and committed with it
  const u = usageSummary();
  aiCostLine = u.calls ? ' \u2014 AI: ' + u.calls + ' call' + (u.calls === 1 ? '' : 's') + ', $' + u.cost.toFixed(4) + (u.unpriced ? ' (+' + u.unpriced + ' unpriced)' : '') : '';
  const usageFile = await flushUsage().catch(() => null);

  return {
    result: { entityId: entry.id, name: entry.n, audio: relAudio, durationSec, cueCount: cues.length, link: SITE_BASE + '/' + relAudio },
    summary: 'recorded ' + durationSec + 's with ' + engine + ' (' + cues.length + ' cues' +
      (replacements ? ', ' + replacements + ' pronunciation fix' + (replacements === 1 ? '' : 'es') : '') +
      (datesFixed ? ', ' + datesFixed + ' date' + (datesFixed === 1 ? '' : 's') + ' put in American order' : '') +
      (hetero && hetero.found ? ', ' + hetero.found + ' two-sound word' + (hetero.found === 1 ? '' : 's') + ' (' + hetero.asked + ' asked' + (hetero.model ? ' ' + hetero.model : '') + ', ' + hetero.fromMemory + ' remembered)' : '') +
      (hetero && hetero.error ? ' [two-sound words: ' + hetero.error + ']' : '') + ') \u2014 ' + relAudio +
      voteSummary(vote) + romanISummary(romanI) + aiCostSummary() +
      (removed.length ? ' (removed ' + removed.length + ' old file' + (removed.length === 1 ? '' : 's') + ')' : ''),
    filesToCommit: [...new Set([relAudio, relTiming, 'data.json', ...removed, ...numeralFiles, ...((vote && vote.files) || []), ...(usageFile ? [usageFile] : []), ...((hetero && hetero.filesToCommit) || [])])]
  };
}
