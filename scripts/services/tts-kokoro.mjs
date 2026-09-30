// scripts/services/tts-kokoro.mjs
//
// Voice engine: Kokoro-82M, a free open-source neural voice that runs on the GitHub runner itself
// (CPU, no API key, no credits). Added 2026-09-30 as a second engine beside ElevenLabs.
//
// HOW IT IS SELECTED — no app change needed: put  kokoro:<voice>  in the Voice ID field under
// Voice & pacing settings (for example  kokoro:af_heart  or  kokoro:bm_george). Any other Voice ID
// is treated as an ElevenLabs voice exactly as before. The Speed field is used; the other
// ElevenLabs-only fields (stability, similarity, style, speaker boost, model id) are ignored.
//
// This file is only the ENGINE: load the model once, turn one piece of text into audio samples,
// hold a recording in memory, write it out as WAV then MP3. Everything about WHAT to say (sections,
// headings, pronunciation rules, closing prayer, cues, versioning) stays in audio-generate.mjs so
// both engines share it.
//
// Kokoro is synthesized ONE SENTENCE AT A TIME. Two reasons: Kokoro silently cuts off text past
// roughly 500 tokens, and it gives exact sentence timings for free — each cue's start/end is just
// the running length of the audio built so far, so highlighting needs no alignment step at all.
//
// Requires the kokoro-js package (orchestrator.yml installs it). It is imported lazily, so
// ElevenLabs-only runs never touch it.

import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

export const KOKORO_PREFIX = 'kokoro:';
export const KOKORO_MODEL_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_DEFAULT_VOICE = 'af_heart';
const RATE = 24000; // Kokoro's native sample rate
// q8 = the same quantized model that ran on your phone in the test page. Set KOKORO_DTYPE=fp32 in
// the workflow for the full-precision model: a little better, larger download, slower.
const DTYPE = process.env.KOKORO_DTYPE || 'q8';
const OUTPUT_BITRATE = process.env.KOKORO_BITRATE || '64k'; // mono speech; 64k is plenty

export function isKokoroVoice(voiceId){
  return String(voiceId || '').trim().toLowerCase().startsWith(KOKORO_PREFIX);
}
export function kokoroVoiceName(voiceId){
  return String(voiceId || '').trim().slice(KOKORO_PREFIX.length).trim() || KOKORO_DEFAULT_VOICE;
}
export function kokoroSpeed(p){
  const s = parseFloat(p && p.speed);
  return Number.isFinite(s) ? Math.min(2, Math.max(0.5, s)) : 1;
}

// ---- Model (loaded once per run) --------------------------------------------------------------
let ttsPromise = null;
async function getTts(){
  if(!ttsPromise){
    ttsPromise = (async () => {
      let mod;
      try{ mod = await import('kokoro-js'); }
      catch(e){
        throw new Error('kokoro-js is not installed on this runner (orchestrator.yml should run "npm install --no-save kokoro-js") \u2014 ' + e.message);
      }
      // Optional: keep the ~90 MB model download in a folder the workflow caches between runs.
      if(process.env.KOKORO_CACHE_DIR){
        try{
          const tf = await import('@huggingface/transformers');
          if(tf && tf.env) tf.env.cacheDir = process.env.KOKORO_CACHE_DIR;
        }catch{ /* no cache dir override available \u2014 the default location still works */ }
      }
      const t0 = Date.now();
      const tts = await mod.KokoroTTS.from_pretrained(KOKORO_MODEL_REPO, { dtype: DTYPE, device: 'cpu' });
      console.log('[kokoro] model loaded (' + DTYPE + ') in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
      return tts;
    })();
    ttsPromise.catch(() => { ttsPromise = null; }); // a failed load can be retried by the next task
  }
  return ttsPromise;
}

const hasSpeakable = (s) => /[A-Za-z0-9\u00C0-\u024F]/.test(s);

// Very long sentences are cut at clause boundaries so nothing nears Kokoro's length limit.
function pieces(text, maxChars = 350){
  const t = text.trim();
  if(t.length <= maxChars) return [t];
  const out = [];
  let cur = '';
  for(const part of t.split(/(?<=[,;:\u2014])\s+/)){
    if(cur && (cur + ' ' + part).length > maxChars){ out.push(cur); cur = part; }
    else cur = cur ? cur + ' ' + part : part;
  }
  if(cur) out.push(cur);
  return out;
}

// ---- A recording held in memory ---------------------------------------------------------------
export class Track {
  constructor(){ this.chunks = []; this.length = 0; }
  get seconds(){ return this.length / RATE; }
  addSamples(f32){ this.chunks.push(f32); this.length += f32.length; }
  addSilence(sec){
    const n = Math.round(Math.max(0, sec) * RATE);
    if(n > 0) this.addSamples(new Float32Array(n));
  }
  merged(){
    const out = new Float32Array(this.length);
    let o = 0;
    for(const c of this.chunks){ out.set(c, o); o += c.length; }
    return out;
  }
}

// Speaks `text` into `track`. Text with nothing pronounceable (a lone dash, say) is skipped.
export async function speakInto(track, text, voice, speed){
  const tts = await getTts();
  const bits = pieces(text).filter(hasSpeakable);
  for(let i = 0; i < bits.length; i++){
    const out = await tts.generate(bits[i], { voice, speed });
    const samples = out && out.audio;
    const rate = out && (out.sampling_rate || out.sampleRate);
    if(!samples || !samples.length) throw new Error('Kokoro returned no audio for: ' + bits[i].slice(0, 60));
    if(rate && rate !== RATE) throw new Error('Kokoro returned ' + rate + ' Hz audio; expected ' + RATE);
    track.addSamples(samples);
    if(i < bits.length - 1) track.addSilence(0.15);
  }
}

// ---- Output -----------------------------------------------------------------------------------
async function writeWav(samples, file){
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for(let i = 0; i < n; i++){
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2);
  }
  await fs.writeFile(file, buf);
}

// Writes the track as mono MP3 at 44.1 kHz. 44.1 kHz on purpose: it matches the silence clips and
// the ElevenLabs recordings the rest of the pipeline (concatSegments) already joins with.
export async function trackToMp3(track, mp3Path){
  const wav = mp3Path.replace(/\.mp3$/i, '') + '.tmp.wav';
  await writeWav(track.merged(), wav);
  try{
    execSync(`ffmpeg -y -i "${wav}" -ac 1 -ar 44100 -c:a libmp3lame -b:a ${OUTPUT_BITRATE} "${mp3Path}"`, { stdio: 'inherit' });
  }finally{
    await fs.unlink(wav).catch(() => {});
  }
}
