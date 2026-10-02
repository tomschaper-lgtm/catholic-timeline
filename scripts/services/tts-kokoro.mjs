// scripts/services/tts-kokoro.mjs
//
// Voice engine: Kokoro-82M, a free open-source neural voice that runs on the GitHub runner itself
// (CPU, no API key, no credits). Second engine beside ElevenLabs.
//
// v2 (2026-09-30): now runs the PYTHON Kokoro (via kokoro_synth.py) instead of the JavaScript
// kokoro-js. Proof of concept confirmed the Python version pronounces "records" correctly by
// context, and it supports inline [word](/IPA/) pronunciation markup, which the JS version does not.
//
// HOW IT IS SELECTED: put  kokoro:<voice>  in the Voice ID field (the app's Voice dropdown does this
// for you), e.g. kokoro:af_heart. Any other Voice ID is an ElevenLabs voice, as before. Speed is
// used; the ElevenLabs-only fields are ignored.
//
// This file is only the ENGINE: hand it a list of texts, get back audio samples; hold a recording in
// memory; write it out as WAV then MP3. What to say (sections, pronunciation rules, closing prayer,
// cues, versioning) stays in audio-generate.mjs.
//
// Requires Python 3.10-3.12 with the `kokoro` package on the runner (orchestrator.yml installs it).
// KOKORO_PYTHON overrides which python to run (default: python3).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KOKORO_PREFIX = 'kokoro:';
export const KOKORO_DEFAULT_VOICE = 'af_heart';
const RATE = 24000; // Kokoro's native sample rate
const OUTPUT_BITRATE = process.env.KOKORO_BITRATE || '64k'; // mono speech; 64k is plenty
const PY = process.env.KOKORO_PYTHON || 'python3';
const SYNTH_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kokoro_synth.py');

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

export const hasSpeakable = (s) => /[A-Za-z0-9\u00C0-\u024F]/.test(s);

// ---- Synthesis: one Python process per call, model loaded once, every text spoken in order ------
function readWavSamples(buf){
  // Standard PCM16 mono WAV written by kokoro_synth.py; walk the chunks to find "data".
  let off = 12;
  while(off + 8 <= buf.length){
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if(id === 'data'){
      const n = Math.min(size, buf.length - off - 8) >> 1;
      const out = new Float32Array(n);
      for(let i = 0; i < n; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('Kokoro WAV had no data chunk');
}

// texts: array of strings (already pronunciation-processed). Returns Float32Array[] in the same
// order; a text with nothing pronounceable gets an empty array rather than being sent.
export async function synthBatch(texts, voice, speed){
  const out = new Array(texts.length).fill(null).map(() => new Float32Array(0));
  const items = [];
  texts.forEach((t, i) => { if(hasSpeakable(t)) items.push({ id: String(i), text: t }); });
  if(!items.length) return out;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kokoro-'));
  try{
    const jobPath = path.join(dir, 'job.json');
    await fs.writeFile(jobPath, JSON.stringify({ voice, speed, out_dir: dir, items }), 'utf8');
    await new Promise((resolve, reject) => {
      const child = spawn(PY, [SYNTH_SCRIPT, jobPath], { stdio: 'inherit', env: process.env });
      child.on('error', e => reject(new Error('could not start Python for Kokoro (' + PY + '): ' + e.message)));
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('Kokoro (Python) failed with exit code ' + code + ' \u2014 see the log above')));
    });
    const results = JSON.parse(await fs.readFile(path.join(dir, 'results.json'), 'utf8'));
    for(const r of results){
      out[parseInt(r.id, 10)] = trimSilence(readWavSamples(await fs.readFile(r.wav)));
    }
    return out;
  }finally{
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Kokoro pads each clip with a little silence at both ends. That padding stacks on top of the pause
// we add between sentences, so trim anything very quiet from both ends, keeping a short natural pad.
const TRIM_THRESHOLD = 0.004;      // ~ -48 dB; real speech sits far above this
const TRIM_KEEP_SEC = 0.05;
export function trimSilence(f32){
  let a = 0, b = f32.length;
  while(a < b && Math.abs(f32[a]) < TRIM_THRESHOLD) a++;
  while(b > a && Math.abs(f32[b - 1]) < TRIM_THRESHOLD) b--;
  if(a >= b) return f32; // all quiet: leave it alone rather than return nothing
  const keep = Math.round(TRIM_KEEP_SEC * RATE);
  return f32.subarray(Math.max(0, a - keep), Math.min(f32.length, b + keep));
}

// ---- A recording held in memory ---------------------------------------------------------------
export class Track {
  constructor(){ this.chunks = []; this.length = 0; }
  get seconds(){ return this.length / RATE; }
  addSamples(f32){ if(f32.length){ this.chunks.push(f32); this.length += f32.length; } }
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
