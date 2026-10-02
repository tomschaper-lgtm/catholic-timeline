// scripts/services/audio-generate.mjs
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
export async function loadPronunciationRules(){
  if(pronunciationRules) return pronunciationRules;
  try{
    const raw = JSON.parse(await fs.readFile(PRONUNCIATION_FILE, 'utf8'));
    pronunciationRules = (raw.rules || [])
      .filter(r => r && r.type === 'alias' && r.string_to_replace && typeof r.alias === 'string')
      // kokoro_ipa (optional): exact sounds for the Kokoro voice, used instead of the alias
      // respelling when Kokoro is recording. ElevenLabs and the browser voice ignore it.
      .map(r => ({ from: r.string_to_replace, to: r.alias, ipa: typeof r.kokoro_ipa === 'string' && r.kokoro_ipa.trim() ? r.kokoro_ipa.trim() : '' }));
  }catch(e){
    pronunciationRules = []; // no file (or unreadable): narrate the text as written
  }
  return pronunciationRules;
}
const isWordChar = (ch) => !!ch && /[A-Za-z0-9\u00C0-\u024F]/.test(ch);
// Returns the text to speak, a position map (map[i] = where original character i starts in the
// spoken text; map[text.length] = spoken length), and how many replacements were made.
// Kokoro's markup gives a multi-word override's sound to the FIRST word only and treats the rest
// unreliably, so a phrase fix ("God's will" -> "ɡˈɑdz wˈɪl") is written as one override per word:
// "[God's](/ɡˈɑdz/) [will](/wˈɪl/)". The fix still applies only where the whole phrase appears.
// When the sounds can't be split word for word (a phrase fix saved as one run of sounds), the
// phrase is left to Kokoro's own reading rather than sent as a multi-word override. (2026-10-01)
export function kokoroMarkup(from, ipa){
  const words = String(from).split(/\s+/).filter(Boolean);
  if(words.length <= 1) return '[' + from + '](/' + ipa + '/)';
  const sounds = String(ipa).trim().split(/\s+/).filter(Boolean);
  if(sounds.length !== words.length) return from;
  return words.map((w, k) => '[' + w + '](/' + sounds[k] + '/)').join(' ');
}
export function applyPronunciation(text, rules, useIpa){
  const map = new Array(text.length + 1);
  let out = '', count = 0, i = 0;
  while(i < text.length){
    let hit = null;
    if(!isWordChar(text[i - 1])){
      for(const r of rules){
        if(text.startsWith(r.from, i) && !isWordChar(text[i + r.from.length])){ hit = r; break; }
      }
    }
    if(hit){
      for(let k = 0; k < hit.from.length; k++) map[i + k] = out.length;
      // Kokoro: [word](/sounds/) markup when the rule has kokoro_ipa; otherwise the alias text.
      out += (useIpa && hit.ipa) ? kokoroMarkup(hit.from, hit.ipa) : hit.to;
      i += hit.from.length;
      count++;
    }else{
      map[i] = out.length;
      out += text[i];
      i++;
    }
  }
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
export function invocationFor(entry){
  if(!entry || entry.t !== 's' || !entry.n) return '';
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

  // Closing invocation for saints: a pause, then "<name>, pray for us." Spoken only.
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
  const speak = (type, section, cueText) => {
    const r = applyPronunciation(cueText, rules, true);
    replacements += r.count;
    plan.push({ type, section, cueText, spoken: r.spoken });
  };
  // The name first ("Blessed Virgin Mary."), then a pause. No cue: it isn't article text.
  const title = titleFor(entry);
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

  // PASS 2 \u2014 synthesize everything, then lay it down in order. Each cue's start/end is simply the
  // running length of the audio so far, so the highlighting timings are exact by construction.
  const spokenItems = plan.filter(x => x.gap === undefined);
  // The closing prayer may have its own pace (prayerSpeed, default 0.9 — a little slower).
  const audio = await synthBatch(spokenItems.map(x => x.spoken), voice, speed,
    spokenItems.map(x => x.type === 'invocation' ? prayerSpeed : speed));
  const track = new Track();
  const cues = [];
  let n = 0, titleEnd = 0;
  for(const step of plan){
    if(step.gap !== undefined){ track.addSilence(step.gap); continue; }
    const start = track.seconds;
    track.addSamples(audio[n++]);
    if(step.type === 'title'){ titleEnd = round2(track.seconds); continue; }
    if(step.type !== 'invocation'){
      cues.push({ section: step.section, type: step.type, text: step.cueText, start: round2(start), end: round2(track.seconds) });
    }
  }

  const audioPath = path.join(dir, `${baseName}.${OUTPUT_EXT}`);
  await trackToMp3(track, audioPath);
  return { audioPath, durationSec: round2(track.seconds), cues, replacements, titleEnd };
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

  const p = task.payload || {};
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
  const { audioPath, durationSec, cues, replacements, titleEnd } = kokoro
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
  await fs.writeFile(timingPath, JSON.stringify({ id: entry.id, audio: relAudio, engine, durationSec, titleEnd: titleEnd || 0, cues }, null, 1));

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

  return {
    result: { entityId: entry.id, name: entry.n, audio: relAudio, durationSec, cueCount: cues.length, link: SITE_BASE + '/' + relAudio },
    summary: 'recorded ' + durationSec + 's with ' + engine + ' (' + cues.length + ' cues' +
      (replacements ? ', ' + replacements + ' pronunciation fix' + (replacements === 1 ? '' : 'es') : '') + ') \u2014 ' + relAudio +
      (removed.length ? ' (removed ' + removed.length + ' old file' + (removed.length === 1 ? '' : 's') + ')' : ''),
    filesToCommit: [relAudio, relTiming, 'data.json', ...removed]
  };
}
