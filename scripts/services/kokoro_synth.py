#!/usr/bin/env python3
"""Kokoro (Python) batch synthesizer, called by tts-kokoro.mjs.

Reads a JSON job file:  { "voice": "af_heart", "speed": 1.0, "out_dir": "...",
                          "items": [ {"id": "0", "text": "..."}, ... ] }
Speaks each item as ONE utterance and writes <out_dir>/<id>.wav (24 kHz, mono, 16-bit), plus
<out_dir>/results.json with each item's audio length, generation time and the phonemes Kokoro used.

The Python Kokoro front end (misaki) is what gives us: inline [word](/IPA/) pronunciation markup,
and context-aware choices for words like "records" (verb vs noun). Text is passed through exactly as
given, so anything written as [word](/phonemes/) is honored.
"""
import json, os, sys, time, wave

import numpy as np

RATE = 24000


def to_numpy(a):
    if hasattr(a, "detach"):
        a = a.detach().cpu().numpy()
    return np.asarray(a, dtype=np.float32).reshape(-1)


def main():
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    voice = job.get("voice") or "af_heart"
    speed = float(job.get("speed") or 1.0)
    out_dir = job["out_dir"]
    items = job.get("items") or []
    os.makedirs(out_dir, exist_ok=True)

    t0 = time.time()
    from kokoro import KPipeline
    lang = "b" if voice.startswith(("bf_", "bm_")) else "a"  # a = American, b = British English
    pipeline = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    print("[kokoro] python engine ready in %.1fs (voice %s, speed %s)" % (time.time() - t0, voice, speed), flush=True)

    results = []
    total_audio = 0.0
    t_all = time.time()
    for n, it in enumerate(items, 1):
        t1 = time.time()
        pieces, phonemes = [], []
        item_speed = float(it.get("speed") or speed)   # 2026-10-01: a piece may carry its own speed (the prayer)
        for r in pipeline(it["text"], voice=voice, speed=item_speed, split_pattern=None):
            au = getattr(r, "audio", None)
            ps = getattr(r, "phonemes", None)
            if au is None and isinstance(r, tuple):
                ps, au = r[1], r[2]
            if au is not None:
                pieces.append(to_numpy(au))
                if len(pieces) > 1:
                    pieces.insert(len(pieces) - 1, np.zeros(int(0.15 * RATE), dtype=np.float32))
            if ps:
                phonemes.append(ps)
        if not pieces:
            raise RuntimeError("Kokoro returned no audio for: " + it["text"][:80])
        audio = np.concatenate(pieces)
        wav_path = os.path.join(out_dir, "%s.wav" % it["id"])
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm.tobytes())
        seconds = len(audio) / RATE
        total_audio += seconds
        results.append({"id": it["id"], "wav": wav_path, "seconds": seconds,
                        "gen": time.time() - t1, "phonemes": " ".join(phonemes)})
        if n % 10 == 0 or n == len(items):
            print("[kokoro] %d/%d pieces | %.0fs of audio | %.0fs elapsed" %
                  (n, len(items), total_audio, time.time() - t_all), flush=True)

    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)
    print("[kokoro] done: %.0fs of audio in %.0fs (%.2fx real time)" %
          (total_audio, time.time() - t_all, (time.time() - t_all) / total_audio if total_audio else 0), flush=True)


if __name__ == "__main__":
    main()
