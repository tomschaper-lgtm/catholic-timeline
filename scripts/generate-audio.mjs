// Generates narration audio + a sentence-timing file for timeline entries via
// the ElevenLabs API. Saves audio/<Category>/<id>-v<N>.mp3 plus a matching
// <id>-v<N>.json timing file, updates data.json's `audio` (and `audioTiming`)
// fields, and appends a row per entry to audio-log.csv.
//
// Run via the "Generate Audio Narration (ElevenLabs)" GitHub Actions workflow,
// which supplies all the env vars below from the workflow_dispatch inputs.
// Requires Node 18+ (global fetch) and ffmpeg/ffprobe on PATH (preinstalled
// on GitHub-hosted ubuntu-latest runners).

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DATA_PATH = 'data.json';
const LOG_PATH = 'audio-log.csv';
const AUDIO_ROOT = 'audio';
const SITE_BASE = 'https://tomschaper-lgtm.github.io/catholic-timeline';

const TYPE_FOLDERS = { s: 'Saints', c: 'Councils', p: 'Persecutions', m: 'Marian', u: 'Eucharistic', e: 'Events' };
const LOG_HEADERS = ['id', 'name', 'action', 'status', 'timestamp', 'filename', 'link', 'error'];

const ids = (process.env.IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const count = parseInt(process.env.COUNT || '5', 10) || 0;
const category = (process.env.CATEGORY || '').trim();
const voiceId = (process.env.VOICE_ID || '').trim();
const modelId = process.env.MODEL_ID || 'eleven_multilingual_v2';
const overwrite = String(process.env.OVERWRITE || 'false') === 'true';
const apiKey = process.env.ELEVENLABS_API_KEY;

// Final stitched output format. mp3 at this bitrate is plenty for spoken narration and runs
// roughly 4-5x smaller than the uncompressed wav this used to produce (a ~5-minute entry drops
// from ~25MB to ~5-6MB) — meaningfully faster to load on the site, no audible quality loss for
// voice. Change here (and nowhere else) if a different bitrate/format is ever wanted.
const OUTPUT_EXT = 'mp3';
const OUTPUT_BITRATE = '128k';

// Narration pacing — tune these via the workflow's inputs and re-run on a
// couple of test entries; there's no universally "right" gap, it depends on
// the voice and model. Heading pause defaults shorter than section pause
// since a heading is a brief label, not a full breath-break.
const READ_HEADINGS = String(process.env.READ_HEADINGS ?? 'true') === 'true';
const HEADING_PAUSE_SEC = (parseInt(process.env.HEADING_PAUSE_MS || '500', 10) || 0) / 1000;
const SECTION_PAUSE_SEC = (parseInt(process.env.SECTION_PAUSE_MS || '700', 10) || 0) / 1000;

// ElevenLabs per-request voice settings — see README for what each does.
// Same "test a few" advice as the pause timing: these interact with the
// voice/model you picked, so there's no one right answer across voices.
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
const VOICE_SETTINGS = {
  stability: clamp(parseFloat(process.env.STABILITY ?? '0.5'), 0, 1),
  similarity_boost: clamp(parseFloat(process.env.SIMILARITY_BOOST ?? '0.75'), 0, 1),
  style: clamp(parseFloat(process.env.STYLE ?? '0'), 0, 1),
  speed: clamp(parseFloat(process.env.SPEED ?? '1'), 0.25, 4),
  use_speaker_boost: String(process.env.USE_SPEAKER_BOOST ?? 'true') === 'true'
};

function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }
if (!apiKey) fail('Missing ELEVENLABS_API_KEY secret (add it under repo Settings → Secrets → Actions).');
if (!voiceId) fail('Missing voice_id input. Run the "List ElevenLabs Voices & Models" workflow to find one.');

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ');
}
// One {heading, body} pair per section, whitespace-collapsed. Sections with
// no body text are dropped (nothing to narrate).
function sectionParts(entry) {
  const sections = (entry.art && entry.art.sections) || [];
  return sections
    .map(s => ({
      heading: stripHtml(s.h || '').replace(/\s+/g, ' ').trim(),
      body: stripHtml(s.b || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(s => s.body);
}
function hasNarratableText(entry) {
  return sectionParts(entry).length > 0;
}

// Naive but effective sentence splitter — splits after ./!/? + whitespace.
// Returns {text, start, end} where start/end are character offsets into the
// exact string that was sent to the TTS call, so they line up with the
// alignment data ElevenLabs returns for that same string.
function splitSentences(text) {
  const re = /[^.!?]+[.!?]+(\s+|$)/g;
  const sentences = [];
  let m, lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmedStart = m.index + (raw.length - raw.trimStart().length);
    const trimmedEnd = m.index + raw.trimEnd().length;
    sentences.push({ text: text.slice(trimmedStart, trimmedEnd), start: trimmedStart, end: trimmedEnd });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    const trimmedStart = lastIndex + (rest.length - rest.trimStart().length);
    const trimmedEnd = text.length;
    if (trimmedStart < trimmedEnd) sentences.push({ text: text.slice(trimmedStart, trimmedEnd), start: trimmedStart, end: trimmedEnd });
  }
  return sentences;
}

async function loadDb() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}
async function saveDb(db) {
  await fs.writeFile(DATA_PATH, JSON.stringify(db, null, 1));
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function ensureLogHeader() {
  try { await fs.access(LOG_PATH); }
  catch { await fs.writeFile(LOG_PATH, LOG_HEADERS.join(',') + '\n'); }
}
async function appendLogRow(row) {
  await fs.appendFile(LOG_PATH, LOG_HEADERS.map(h => csvEscape(row[h])).join(',') + '\n');
}

function candidateEntries(db) {
  let pool;
  if (ids.length) {
    const set = new Set(ids);
    pool = db.entries.filter(e => set.has(e.id));
    pool.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    ids.filter(id => !pool.some(e => e.id === id))
      .forEach(id => console.warn(`Warning: id "${id}" not found in data.json — skipping.`));
  } else {
    pool = db.entries.slice();
    if (category) pool = pool.filter(e => e.t === category);
    pool = pool.filter(hasNarratableText);
    pool.sort((a, b) => a.y - b.y);
    if (!overwrite) pool = pool.filter(e => !e.audio);
  }
  return count > 0 ? pool.slice(0, count) : pool;
}

// Calls ElevenLabs' timestamped endpoint, writes the decoded mp3 to outPath,
// and returns the character-level alignment for that exact input text.
async function ttsWithTimestamps(text, outPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: VOICE_SETTINGS
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  await fs.writeFile(outPath, Buffer.from(data.audio_base64, 'base64'));
  return data.alignment || null;
}

function chunkDuration(alignment, mp3Path) {
  const ends = alignment && alignment.character_end_times_seconds;
  if (ends && ends.length) return ends[ends.length - 1];
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3Path}"`).toString().trim();
    return parseFloat(out) || 0;
  } catch { return 0; }
}

function makeSilence(durationSec, outPath) {
  if (durationSec <= 0) return false;
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${durationSec.toFixed(2)} -q:a 9 "${outPath}"`, { stdio: 'inherit' });
  return true;
}

// Decodes/re-encodes every segment into one final audio file via ffmpeg's concat *filter*
// (not the concat demuxer) — this tolerates the mp3-vs-silence-mp3 format differences that broke
// stream-copy concat in testing. Final output is re-encoded to OUTPUT_EXT/OUTPUT_BITRATE
// (libmp3lame's default encoder for a .mp3 target) rather than stream-copied, since concat's
// filter graph always re-encodes its output anyway.
function concatSegments(files, audioOut, dir) {
  const rel = files.map(f => path.relative(dir, f));
  const inputs = rel.map(f => `-i "${f}"`).join(' ');
  const filterIn = rel.map((_, i) => `[${i}:a]`).join('');
  const filter = `${filterIn}concat=n=${rel.length}:v=0:a=1[out]`;
  execSync(`ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[out]" -c:a libmp3lame -b:a ${OUTPUT_BITRATE} "${path.basename(audioOut)}"`, { stdio: 'inherit', cwd: dir });
}

// Narrates one entry: heading (optional) + body per section, each its own
// timestamped TTS call, with silence gaps inserted between heading→body and
// between sections so nothing runs together. Returns the final audio path,
// total duration, and a `cues` array of {section, type, text, start, end}
// in seconds — the raw material for a sentence-highlighting player.
async function narrateEntry(entry, dir, baseName) {
  const parts = sectionParts(entry);
  const segmentFiles = [];
  const cues = [];
  let cumulative = 0;
  let tmpIndex = 0;
  const tmp = () => path.join(dir, `${baseName}.tmp${tmpIndex++}.mp3`);

  for (let si = 0; si < parts.length; si++) {
    const { heading, body } = parts[si];

    if (si > 0 && SECTION_PAUSE_SEC > 0) {
      const gap = tmp();
      makeSilence(SECTION_PAUSE_SEC, gap);
      segmentFiles.push(gap);
      cumulative += SECTION_PAUSE_SEC;
    }

    if (READ_HEADINGS && heading) {
      const hPath = tmp();
      const alignment = await ttsWithTimestamps(heading, hPath);
      segmentFiles.push(hPath);
      const dur = chunkDuration(alignment, hPath);
      cues.push({ section: si, type: 'heading', text: heading, start: round2(cumulative), end: round2(cumulative + dur) });
      cumulative += dur;

      if (HEADING_PAUSE_SEC > 0) {
        const gap = tmp();
        makeSilence(HEADING_PAUSE_SEC, gap);
        segmentFiles.push(gap);
        cumulative += HEADING_PAUSE_SEC;
      }
    }

    const bPath = tmp();
    const alignment = await ttsWithTimestamps(body, bPath);
    segmentFiles.push(bPath);
    const dur = chunkDuration(alignment, bPath);

    if (alignment && alignment.characters && alignment.characters.length) {
      splitSentences(body).forEach(sen => {
        const startIdx = Math.max(0, Math.min(sen.start, alignment.characters.length - 1));
        const endIdx = Math.max(0, Math.min(sen.end - 1, alignment.characters.length - 1));
        const start = alignment.character_start_times_seconds[startIdx] ?? 0;
        const end = alignment.character_end_times_seconds[endIdx] ?? dur;
        cues.push({ section: si, type: 'sentence', text: sen.text, start: round2(cumulative + start), end: round2(cumulative + end) });
      });
    } else {
      // No alignment returned (shouldn't normally happen) — fall back to one cue for the whole paragraph.
      cues.push({ section: si, type: 'sentence', text: body, start: round2(cumulative), end: round2(cumulative + dur) });
    }
    cumulative += dur;
  }

  const audioPath = path.join(dir, `${baseName}.${OUTPUT_EXT}`);
  concatSegments(segmentFiles, audioPath, dir);
  await Promise.all(segmentFiles.map(f => fs.unlink(f).catch(() => {})));

  return { audioPath, durationSec: round2(cumulative), cues };
}
function round2(n) { return Math.round(n * 100) / 100; }

function nextVersion(entry) {
  if (!entry.audio) return 1;
  const m = entry.audio.match(/-v(\d+)\.\w+$/);
  if (!m) return 1;
  // Only reached when overwrite=true (has-audio entries are already
  // filtered out above when overwrite=false), so this always creates a new
  // version file — it never silently replaces an existing one.
  return parseInt(m[1], 10) + 1;
}

async function main() {
  const db = await loadDb();
  const targets = candidateEntries(db);
  if (!targets.length) {
    console.log('Nothing to do — no entries matched the given ids/category, or all matches already have audio.');
    return;
  }
  await ensureLogHeader();
  console.log(`Processing ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} (read_headings=${READ_HEADINGS}, heading_pause=${HEADING_PAUSE_SEC}s, section_pause=${SECTION_PAUSE_SEC}s, voice_settings=${JSON.stringify(VOICE_SETTINGS)})...`);

  let changed = false;
  for (const entry of targets) {
    const ts = new Date().toISOString();

    if (entry.audio && !overwrite) {
      console.log(`Skip ${entry.id} — already has audio (rerun with overwrite=true to regenerate).`);
      await appendLogRow({
        id: entry.id, name: entry.n, action: 'Audio narration', status: 'skipped',
        timestamp: ts, filename: entry.audio, link: '', error: 'Already has audio; overwrite=false'
      });
      continue;
    }

    const folder = TYPE_FOLDERS[entry.t] || 'Other';
    const dir = path.join(AUDIO_ROOT, folder);
    await fs.mkdir(dir, { recursive: true });

    try {
      if (!hasNarratableText(entry)) throw new Error('Entry has no article text to narrate.');

      const version = nextVersion(entry);
      const baseName = `${entry.id}-v${version}`;
      console.log(`Generating audio for ${entry.id} (${entry.n})...`);
      const { audioPath, durationSec, cues } = await narrateEntry(entry, dir, baseName);

      const relAudio = path.join(AUDIO_ROOT, folder, path.basename(audioPath)).split(path.sep).join('/');
      const relTiming = relAudio.replace(new RegExp(`\\.${OUTPUT_EXT}$`), '.json');
      const timingPath = audioPath.replace(new RegExp(`\\.${OUTPUT_EXT}$`), '.json');
      await fs.writeFile(timingPath, JSON.stringify({ id: entry.id, audio: relAudio, durationSec, cues }, null, 1));

      entry.audio = relAudio;
      entry.audioTiming = relTiming; // new optional field — not yet in the schema doc, see chat note
      changed = true;

      await appendLogRow({
        id: entry.id, name: entry.n, action: 'Audio narration generated', status: 'success',
        timestamp: ts, filename: relAudio, link: `${SITE_BASE}/${relAudio}`, error: ''
      });
      console.log(`  Saved ${relAudio} (${durationSec}s, ${cues.length} cues) + ${relTiming}`);
    } catch (err) {
      console.error(`  Failed for ${entry.id}: ${err.message}`);
      await appendLogRow({
        id: entry.id, name: entry.n, action: 'Audio narration generated', status: 'error',
        timestamp: ts, filename: '', link: '', error: String(err.message || err).replace(/\n/g, ' ').slice(0, 500)
      });
    }
  }

  if (changed) { await saveDb(db); console.log('data.json updated.'); }
  else console.log('data.json unchanged (nothing succeeded).');
}

main().catch(err => { console.error(err); process.exit(1); });
