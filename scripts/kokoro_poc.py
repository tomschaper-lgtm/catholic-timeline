#!/usr/bin/env python3
"""Kokoro (Python) proof of concept.

Speaks each LINE of TEXT with the Python Kokoro pipeline, joins the lines into one MP3 with a short
pause between them, and writes a report showing (a) how long each line took to generate and (b) the
PHONEMES Kokoro actually used for each line. The phonemes are the useful part: they show whether
inline [word](/IPA/) markup was honored and how "records" (verb vs noun) was decided.

Nothing here touches the app or the recording pipeline. It only writes two files:
  audio/_tests/kokoro-poc.mp3
  audio/_tests/kokoro-poc-report.txt
Settings come from environment variables: TEXT (one line per utterance), VOICE (default af_heart),
SPEED (default 1.0), OUT_DIR (default audio/_tests).
"""
import os, sys, time, wave, subprocess

t_start = time.time()
TEXT = os.environ.get("TEXT", "").strip()
VOICE = os.environ.get("VOICE", "af_heart").strip() or "af_heart"
SPEED = float(os.environ.get("SPEED", "1.0") or 1.0)
OUT_DIR = os.environ.get("OUT_DIR", "audio/_tests")
PAUSE_SEC = 0.7
RATE = 24000

lines = [l.strip() for l in TEXT.splitlines() if l.strip()]
if not lines:
    sys.exit("No text given.")

import numpy as np
t0 = time.time()
from kokoro import KPipeline
lang = "b" if VOICE.startswith(("bf_", "bm_")) else "a"   # a = American English, b = British
pipeline = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
load_sec = time.time() - t0

def to_numpy(a):
    if hasattr(a, "detach"):
        a = a.detach().cpu().numpy()
    return np.asarray(a, dtype=np.float32).reshape(-1)

report = []
report.append("Kokoro Python proof of concept")
report.append("voice=%s speed=%s lang=%s | import+model load %.1fs" % (VOICE, SPEED, lang, load_sec))
report.append("")
chunks = []
total_audio = 0.0
total_gen = 0.0
for i, line in enumerate(lines, 1):
    t0 = time.time()
    pieces, phonemes = [], []
    # split_pattern=None: the whole line is one utterance (Kokoro still chunks very long text itself)
    for r in pipeline(line, voice=VOICE, speed=SPEED, split_pattern=None):
        ps = getattr(r, "phonemes", None)
        au = getattr(r, "audio", None)
        if au is None and isinstance(r, tuple):
            ps, au = r[1], r[2]
        if au is not None:
            pieces.append(to_numpy(au))
        if ps:
            phonemes.append(ps)
    gen = time.time() - t0
    if not pieces:
        report.append("%d | NO AUDIO | %s" % (i, line))
        continue
    audio = np.concatenate(pieces)
    dur = len(audio) / RATE
    total_audio += dur
    total_gen += gen
    chunks.append(audio)
    chunks.append(np.zeros(int(PAUSE_SEC * RATE), dtype=np.float32))
    report.append("%d | gen %.1fs | audio %.1fs | %.2fx" % (i, gen, dur, gen / dur if dur else 0))
    report.append("   text:     " + line)
    report.append("   phonemes: " + " ".join(phonemes))
    report.append("")

if not chunks:
    sys.exit("Kokoro produced no audio.")

os.makedirs(OUT_DIR, exist_ok=True)
wav_path = os.path.join(OUT_DIR, "kokoro-poc.wav")
mp3_path = os.path.join(OUT_DIR, "kokoro-poc.mp3")
pcm = (np.clip(np.concatenate(chunks[:-1]), -1, 1) * 32767).astype("<i2")
with wave.open(wav_path, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path, "-ac", "1", "-ar", "44100",
                "-c:a", "libmp3lame", "-b:a", "64k", mp3_path], check=True)
os.remove(wav_path)

report.append("TOTAL: %.1fs of audio generated in %.1fs (%.2fx real time) | whole script %.1fs" %
              (total_audio, total_gen, (total_gen / total_audio) if total_audio else 0, time.time() - t_start))
report.append("MP3: %s (%d KB)" % (mp3_path, os.path.getsize(mp3_path) // 1024))
with open(os.path.join(OUT_DIR, "kokoro-poc-report.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(report) + "\n")
print("\n".join(report))
