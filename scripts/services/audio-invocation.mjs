// scripts/services/audio-invocation.mjs
//
// Service: "audio-invocation" ("Add closing prayer")  —  2026-09-27
//
// For a Saint entry that ALREADY has recorded audio, adds the closing prayer to the end of that
// recording without re-recording the article: a pause, then "<name>, pray for us." (same wording,
// pause length and pronunciation rules audio-generate.mjs uses for new recordings — the helpers
// are imported from there, so the two can never drift apart).
//
//   1. Records ONLY the short prayer line with ElevenLabs (the voice/model/settings in the task
//      payload, captured from Voice & pacing settings when the task was queued).
//   2. Joins: existing recording + silence + prayer, into the NEXT version file
//      (…-v1.mp3 → …-v2.mp3). The old file is left untouched in the repo.
//   3. Copies the existing timing file to the new version name. Its sentence cues are unchanged
//      (the prayer only adds time after the last sentence); only `audio` and `durationSec` move.
//   4. Points the entry at the new files and sets entry.audioInvocation = true, so this entry is
//      never given the prayer twice. audio-generate.mjs sets the same flag on new recordings.
//
// Skips (no change, reported in the summary): not a Saint entry, no audio, already has the
// prayer, or the audio file isn't in the repo.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  ttsWithTimestamps, makeSilence, concatSegments, invocationFor, prayerFor, loadPronunciationRules,
  applyPronunciation, nextVersion, freeVersion, voiceFromPayload, INVOCATION_PAUSE_SEC, SITE_BASE, OUTPUT_EXT
} from './audio-generate.mjs';
import { isKokoroVoice } from './tts-kokoro.mjs';

function round2(n){ return Math.round(n * 100) / 100; }
function probeDuration(file){
  try{ return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`).toString().trim()) || 0; }
  catch{ return 0; }
}
// Local repo path for an entry's audio/timing field ("audio/Saints/x-v1.mp3", or a full URL on
// this site, whose path part is the same repo path).
function repoPathOf(ref){
  if(!ref) return '';
  let p = String(ref).trim();
  if(/^https?:\/\//i.test(p)){ try{ p = new URL(p).pathname; }catch{ return ''; } }
  return decodeURIComponent(p).replace(/^\/+/, '');
}

export async function runAudioInvocation(task, dataJson){
  // 2026-09-30: this service patches an existing ElevenLabs recording with a prayer in the SAME
  // voice. New Kokoro recordings already include the prayer, so there is nothing for Kokoro to do
  // here — and splicing a different voice onto the end of a recording would sound wrong.
  if(isKokoroVoice((task.payload || {}).voiceId)){
    return { result: null, summary: 'skipped — Kokoro recordings already include the closing prayer; to patch an older ElevenLabs recording, queue this with an ElevenLabs Voice ID' };
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if(!apiKey) throw new Error('Missing ELEVENLABS_API_KEY secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry) return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };
  const prayer = prayerFor(entry);   // the article's own [prayer], else the default for saints
  if(!prayer) return { result: { entityId: entry.id, name: entry.n }, summary: 'skipped \u2014 no prayer (not a Saint, and no [prayer] in the article)' };
  if(entry.audioInvocation) return { result: { entityId: entry.id, name: entry.n }, summary: 'skipped \u2014 already has the closing prayer' };
  const oldAudio = repoPathOf(entry.audio);
  if(!oldAudio) return { result: { entityId: entry.id, name: entry.n }, summary: 'skipped \u2014 no recorded audio' };
  try{ await fs.access(oldAudio); }
  catch{ return { result: { entityId: entry.id, name: entry.n }, summary: 'skipped \u2014 audio file not found in the repo: ' + oldAudio }; }

  const { voiceId, modelId, voiceSettings } = voiceFromPayload(task.payload || {});
  const dir = path.dirname(oldAudio);
  const baseName = entry.id + '-v' + await freeVersion(entry, dir);   // never reuse a cached name
  const gap = path.join(dir, baseName + '.tmp-gap.mp3');
  const clip = path.join(dir, baseName + '.tmp-prayer.mp3');
  const outAudio = path.join(dir, baseName + '.' + OUTPUT_EXT);

  const rules = await loadPronunciationRules();
  const spoken = applyPronunciation(prayer, rules).spoken;
  await ttsWithTimestamps(spoken, clip, voiceId, modelId, voiceSettings, apiKey);
  makeSilence(INVOCATION_PAUSE_SEC, gap);
  try{
    concatSegments([oldAudio, gap, clip], outAudio, dir);
  }finally{
    await Promise.all([gap, clip].map(f => fs.unlink(f).catch(() => {})));
  }
  const durationSec = round2(probeDuration(outAudio));

  // Timing: same cues, new file name and length. If the entry had no timing file, write a minimal
  // one (no cues) so the entry's fields stay consistent.
  const relAudio = outAudio.split(path.sep).join('/');
  const relTiming = relAudio.replace(new RegExp('\\.' + OUTPUT_EXT + '$'), '.json');
  const oldTimingPath = repoPathOf(entry.audioTiming) || oldAudio.replace(new RegExp('\\.' + OUTPUT_EXT + '$'), '.json');
  let timing = { id: entry.id, cues: [] };
  try{ timing = JSON.parse(await fs.readFile(oldTimingPath, 'utf8')); }catch{}
  timing.audio = relAudio;
  timing.durationSec = durationSec;
  await fs.writeFile(relTiming, JSON.stringify(timing, null, 1));

  entry.audio = relAudio;
  entry.audioTiming = relTiming;
  entry.audioInvocation = true;

  return {
    result: { entityId: entry.id, name: entry.n, audio: relAudio, durationSec, prayer: spoken, link: SITE_BASE + '/' + relAudio },
    summary: 'added \u201C' + spoken + '\u201D \u2014 ' + relAudio + ' (' + durationSec + 's)',
    filesToCommit: [relAudio, relTiming, 'data.json']
  };
}
