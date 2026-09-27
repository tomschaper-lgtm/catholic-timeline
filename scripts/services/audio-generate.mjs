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

const AUDIO_ROOT = 'audio';
// 2026-09-27: was the github.io address; the site is served by Cloudflare at this domain, and
// GitHub Pages is being switched off, which would have broken the link shown in the Task List.
const SITE_BASE = 'https://catholictimeline.org';
const PRONUNCIATION_FILE = 'pronunciation/catholic-timeline-pronunciation.json';
// Closing invocation (2026-09-27): Saint entries (t: 's') end with a pause and then
// "<name>, pray for us." — spoken only; never added to the article text, and given no
// highlighting cue (there's no text on the page for it to highlight).
const INVOCATION_PAUSE_SEC = 1.2;
const TYPE_FOLDERS = { s: 'Saints', c: 'Councils', p: 'Persecutions', m: 'Marian', u: 'Eucharistic', e: 'Events' };

// Same format/bitrate rationale as the original: mp3 at this bitrate is plenty for spoken
// narration and runs roughly 4-5x smaller than the wav this used to produce, with no audible
// quality loss for voice. Change here (and nowhere else) if a different bitrate/format is wanted.
const OUTPUT_EXT = 'mp3';
const OUTPUT_BITRATE = '128k';

function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }

// ---- Pronunciation (see PRONUNCIATION at the top) -------------------------------------------
let pronunciationRules = null;
async function loadPronunciationRules(){
  if(pronunciationRules) return pronunciationRules;
  try{
    const raw = JSON.parse(await fs.readFile(PRONUNCIATION_FILE, 'utf8'));
    pronunciationRules = (raw.rules || [])
      .filter(r => r && r.type === 'alias' && r.string_to_replace && typeof r.alias === 'string')
      .map(r => ({ from: r.string_to_replace, to: r.alias }));
  }catch(e){
    pronunciationRules = []; // no file (or unreadable): narrate the text as written
  }
  return pronunciationRules;
}
const isWordChar = (ch) => !!ch && /[A-Za-z0-9\u00C0-\u024F]/.test(ch);
// Returns the text to speak, a position map (map[i] = where original character i starts in the
// spoken text; map[text.length] = spoken length), and how many replacements were made.
export function applyPronunciation(text, rules){
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
      out += hit.to;
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

// One {heading, body} pair per section, whitespace-collapsed. Sections with no body text are
// dropped (nothing to narrate).
function sectionParts(entry){
  const sections = (entry.art && entry.art.sections) || [];
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
function invocationFor(entry){
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
async function ttsWithTimestamps(text, outPath, voiceId, modelId, voiceSettings, apiKey){
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings })
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  await fs.writeFile(outPath, Buffer.from(data.audio_base64, 'base64'));
  return data.alignment || null;
}

function chunkDuration(alignment, mp3Path){
  const ends = alignment && alignment.character_end_times_seconds;
  if(ends && ends.length) return ends[ends.length - 1];
  try{
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3Path}"`).toString().trim();
    return parseFloat(out) || 0;
  }catch{ return 0; }
}

function makeSilence(durationSec, outPath){
  if(durationSec <= 0) return false;
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${durationSec.toFixed(2)} -q:a 9 "${outPath}"`, { stdio: 'inherit' });
  return true;
}

// Decodes/re-encodes every segment into one final audio file via ffmpeg's concat *filter* (not
// the concat demuxer) — tolerates the mp3-vs-silence-mp3 format differences that broke
// stream-copy concat in testing. Final output is re-encoded (libmp3lame's default encoder for a
// .mp3 target) rather than stream-copied, since concat's filter graph always re-encodes anyway.
function concatSegments(files, audioOut, dir){
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
  const invocation = invocationFor(entry);
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

function nextVersion(entry){
  if(!entry.audio) return 1;
  const m = entry.audio.match(/-v(\d+)\.\w+$/);
  if(!m) return 1;
  // Reached whenever this task ran against an entity that already had audio — the client-side
  // pool already made that an explicit, opt-in choice ("Include entries that already have
  // recorded audio") before this task was ever queued, so always creating a new version file
  // here (never silently overwriting) is correct regardless of why it happened.
  return parseInt(m[1], 10) + 1;
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */
export async function runAudioGenerate(task, dataJson){
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if(!apiKey) throw new Error('Missing ELEVENLABS_API_KEY secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry){
    return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };
  }
  if(!hasNarratableText(entry)){
    return { result: { entityId: entry.id, name: entry.n }, summary: 'skipped \u2014 no article text to narrate' };
  }

  const p = task.payload || {};
  const voiceId = String(p.voiceId || '').trim();
  if(!voiceId) throw new Error('Task has no voiceId in its payload \u2014 requeue from Add Task with a Voice ID set.');
  const modelId = p.modelId || 'eleven_multilingual_v2';
  const readHeadings = p.readHeadings !== false;
  const headingPauseSec = (parseInt(p.headingPauseMs, 10) || 500) / 1000;
  const sectionPauseSec = (parseInt(p.sectionPauseMs, 10) || 700) / 1000;
  const voiceSettings = {
    stability: clamp(parseFloat(p.stability ?? 0.5), 0, 1),
    similarity_boost: clamp(parseFloat(p.similarityBoost ?? 0.75), 0, 1),
    style: clamp(parseFloat(p.style ?? 0), 0, 1),
    speed: clamp(parseFloat(p.speed ?? 1), 0.25, 4),
    use_speaker_boost: p.useSpeakerBoost !== false
  };

  const folder = TYPE_FOLDERS[entry.t] || 'Other';
  const dir = path.join(AUDIO_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });

  const version = nextVersion(entry);
  const baseName = entry.id + '-v' + version;
  const { audioPath, durationSec, cues, replacements } = await narrateEntry(
    entry, dir, baseName,
    { voiceId, modelId, voiceSettings, readHeadings, headingPauseSec, sectionPauseSec },
    apiKey
  );

  const relAudio = path.join(AUDIO_ROOT, folder, path.basename(audioPath)).split(path.sep).join('/');
  const relTiming = relAudio.replace(new RegExp('\\.' + OUTPUT_EXT + '$'), '.json');
  const timingPath = audioPath.replace(new RegExp('\\.' + OUTPUT_EXT + '$'), '.json');
  await fs.writeFile(timingPath, JSON.stringify({ id: entry.id, audio: relAudio, durationSec, cues }, null, 1));

  entry.audio = relAudio;
  entry.audioTiming = relTiming;

  return {
    result: { entityId: entry.id, name: entry.n, audio: relAudio, durationSec, cueCount: cues.length, link: SITE_BASE + '/' + relAudio },
    summary: 'recorded ' + durationSec + 's (' + cues.length + ' cues' +
      (replacements ? ', ' + replacements + ' pronunciation fix' + (replacements === 1 ? '' : 'es') : '') + ') \u2014 ' + relAudio,
    filesToCommit: [relAudio, relTiming, 'data.json']
  };
}
