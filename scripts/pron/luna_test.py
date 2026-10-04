#!/usr/bin/env python3
"""Luna test: how well does an OpenAI model guess the pronunciations Tom has already fixed by ear?

1. Takes every sound fix in pronunciation/catholic-timeline-pronunciation.json (rules with a
   kokoro_ipa — the ones picked by ear on pronounce.html). Those are the answers; the model never
   sees them.
2. For each phrase, finds a sentence it appears in (data.json) and asks the model, in batches, for
   the American English IPA a careful Catholic lector would use in that sentence.
3. Converts the model's IPA to Kokoro notation (same converter as the pronunciation story) and
   compares it with the saved fix the same way the story does: only differences a listener would
   notice count. Two baselines are scored on the same words: Claude's hand-written hints
   (names-hints.json) and Kokoro's own guess.
4. Records one listening file: for every word where the model disagrees with the saved fix,
   "Your fix: <word>. Luna: <word>." — a disagreement isn't automatically wrong (some names have
   two accepted pronunciations), so the ear decides.
Output: pronunciation/luna-test/report.md, results.json, differences.mp3 (+ .json with times).
Needs the repo secret OPENAI_API_KEY. Reads only; changes no pronunciation rules.
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error, wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pron_story import load, save, ipa_to_kokoro, norm, audio_of, RULES_PATH, HINT_PATH, DATA_PATH  # noqa: E402

MODEL = (os.environ.get("MODEL") or "gpt-6-luna").strip()
VOICE = (os.environ.get("VOICE") or "am_adam").strip()
RECORD = (os.environ.get("RECORD") or "yes").strip().lower() not in ("no", "0", "false")
API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
API_URL = os.environ.get("OPENAI_URL") or "https://api.openai.com/v1/chat/completions"
OUT_DIR = "pronunciation/luna-test"
BATCH = 25
SR = 24000

PROMPT = """You are a pronunciation coach for an English-language Catholic history narration, read by an
American narrator. For each item you get a word or phrase and the sentence it appears in.
Give how a careful, well-informed American Catholic lector would say it IN THAT SENTENCE:
- names of saints, popes, places and councils: the established English (anglicized) pronunciation
  used in American Catholic usage, when one exists; otherwise the native pronunciation as an
  English speaker would naturally say it;
- ordinary words: the pronunciation that fits the sentence (e.g. "records" as a verb vs a noun).
Answer with JSON only: {"items": [{"phrase": "...", "ipa": "...", "respell": "..."}]} in the same
order, one per item. "ipa": General American IPA with primary stress marks (ˈ), words separated by
single spaces, no slashes. "respell": a simple respelling with the stressed syllable in capitals,
e.g. KRAH-koof, sez-uh-REE-uh, GAHDZ WIL."""


def ask_model(items):
    body = {"model": MODEL, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": PROMPT},
                         {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)}]}
    last = None
    for attempt in range(4):
        req = urllib.request.Request(API_URL, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                out = json.loads(r.read().decode("utf-8"))
            text = out["choices"][0]["message"]["content"]
            text = re.sub(r"^```(?:json)?|```$", "", text.strip()).strip()
            got = json.loads(text).get("items", [])
            return got, out.get("usage", {})
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:400]
            if e.code in (400, 401, 403, 404):          # wrong key / no access to the model: retrying won't help
                sys.exit("[luna] The API refused the request (%d): %s" % (e.code, msg))
            last = "%d %s" % (e.code, msg)
        except Exception as e:
            last = str(e)
        time.sleep(5 * (attempt + 1))
    sys.exit("[luna] Giving up after 4 tries: %s" % last)


def context_sentence(phrase, text):
    pat = re.compile(r"(?<![\w'])" + re.escape(phrase) + r"(?![\w'])")
    m = pat.search(text)
    if not m:
        return ""
    a = max(text.rfind(". ", 0, m.start()), text.rfind("\n", 0, m.start()))
    b = min([x for x in (text.find(". ", m.end()), text.find("\n", m.end())) if x != -1] or [len(text)])
    return text[a + 1:b + 1].strip()[:400]


def to_kokoro(ipa, allowed):
    """Model IPA -> Kokoro notation, word by word (a phrase keeps its spaces)."""
    words = [w for w in re.split(r"\s+", (ipa or "").strip().strip("/[]")) if w]
    conv = [ipa_to_kokoro(w, allowed) for w in words]
    return " ".join(conv) if words and all(conv) else None


def verdict(guess, truth):
    if not guess:
        return "no answer"
    if norm(guess) == norm(truth):
        return "match"
    if norm(guess).replace("ˈ", "") == norm(truth).replace("ˈ", ""):
        return "stress differs"
    return "different"


def main():
    if not API_KEY:
        sys.exit("[luna] No OPENAI_API_KEY. Add it in the repo: Settings -> Secrets and variables -> Actions.")
    t0 = time.time()
    rules = load(RULES_PATH, {"rules": []}).get("rules", [])
    hints = load(HINT_PATH, {}).get("names", {})
    data = load(DATA_PATH, {})
    entries = data.get("entries", data) if isinstance(data, dict) else data
    text = "\n".join("\n".join([e.get("n", "") or ""] + [(s.get("h", "") or "") + "\n" + (s.get("b", "") or "")
                                for s in ((e.get("art") or {}).get("sections") or [])]) for e in entries or [])
    text = re.sub(r"<[^>]+>", " ", text)

    tests = [{"phrase": r["string_to_replace"], "truth": r["kokoro_ipa"]} for r in rules
             if r and r.get("kokoro_ipa") and r.get("string_to_replace")]
    if not tests:
        sys.exit("[luna] No saved sound fixes (rules with kokoro_ipa) to test against.")
    for t in tests:
        t["sentence"] = context_sentence(t["phrase"], text)
    print("[luna] %d saved fixes to test, model %s" % (len(tests), MODEL), flush=True)

    from kokoro import KPipeline
    import numpy as np
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    vocab = getattr(getattr(pipe, "model", None), "vocab", None) or {}
    allowed = set(vocab.keys()) | {" "} if vocab else set()

    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    for i in range(0, len(tests), BATCH):
        batch = tests[i:i + BATCH]
        got, u = ask_model([{"phrase": t["phrase"], "sentence": t["sentence"]} for t in batch])
        for k in usage:
            usage[k] += int(u.get(k, 0) or 0)
        by_phrase = {g.get("phrase"): g for g in got if isinstance(g, dict)}
        for j, t in enumerate(batch):
            g = by_phrase.get(t["phrase"]) or (got[j] if j < len(got) and isinstance(got[j], dict) else {})
            t["luna_ipa"], t["luna_respell"] = g.get("ipa", ""), g.get("respell", "")
            t["luna"] = to_kokoro(t["luna_ipa"], allowed)
        print("[luna] asked %d/%d" % (min(i + BATCH, len(tests)), len(tests)), flush=True)

    for t in tests:
        try:
            ps, _ = pipe.g2p(t["phrase"])
        except Exception:
            ps = ""
        t["kokoro"] = (ps or "").strip()
        h = hints.get(t["phrase"])
        t["claude"] = h.get("ipa") if h else None
        t["claude_say"] = h.get("say", "") if h else ""
        t["v_luna"] = verdict(t["luna"], t["truth"])
        t["v_kokoro"] = verdict(t["kokoro"], t["truth"])
        t["v_claude"] = verdict(t["claude"], t["truth"]) if t["claude"] else None

    def score(key, pool):
        n = len(pool)
        m = sum(1 for t in pool if t[key] == "match")
        s = sum(1 for t in pool if t[key] == "stress differs")
        return n, m, s

    n, lm, ls = score("v_luna", tests)
    _, km, ks = score("v_kokoro", tests)
    hint_pool = [t for t in tests if t["claude"]]
    hn, cm, cs = score("v_claude", hint_pool) if hint_pool else (0, 0, 0)
    ln_on_h, lm_on_h, _ = score("v_luna", hint_pool) if hint_pool else (0, 0, 0)
    pct = lambda a, b: ("%d%%" % round(100.0 * a / b)) if b else "—"

    # ---- listening file: every word where Luna disagrees with the saved fix ----
    os.makedirs(OUT_DIR, exist_ok=True)
    diffs = [t for t in tests if t["v_luna"] != "match"]
    listen = []
    if RECORD and diffs:
        pieces, pos = [np.zeros(int(SR * 0.3), dtype=np.float32)], 0.3
        def say(s):
            chunks = []
            try:
                for res in pipe(s, voice=VOICE, speed=0.95):
                    a = audio_of(res)
                    if a is not None and len(a):
                        chunks.append(np.asarray(a, dtype=np.float32))
            except Exception as e:
                print("[luna] could not say %r: %s" % (s, e), flush=True)
            return np.concatenate(chunks) if chunks else np.zeros(int(SR * 0.2), dtype=np.float32)
        def mark(phrase, ps):
            words, sounds = phrase.split(), (ps or "").split()
            if len(words) == len(sounds) and len(words) > 1:
                return " ".join("[%s](/%s/)" % (w, p) for w, p in zip(words, sounds))
            return "[%s](/%s/)" % (phrase, (ps or "").replace(" ", ""))
        for k, t in enumerate(diffs, 1):
            line = "%d. Your fix: %s. Luna: %s." % (k, mark(t["phrase"], t["truth"]),
                                                   mark(t["phrase"], t["luna"]) if t["luna"] else "no answer")
            a = say(line)
            listen.append({"n": k, "phrase": t["phrase"], "s": round(pos, 2), "e": round(pos + len(a) / SR, 2)})
            pieces += [a, np.zeros(int(SR * 0.9), dtype=np.float32)]
            pos += len(a) / SR + 0.9
        wav = "/tmp/luna-differences.wav"
        pcm = (np.clip(np.concatenate(pieces), -1, 1) * 32767).astype("<i2").tobytes()
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "48k",
                        OUT_DIR + "/differences.mp3"], check=True)
        save(OUT_DIR + "/differences.json", {"model": MODEL, "voice": VOICE, "items": listen})

    # ---- report ----
    L = ["# Luna pronunciation test", "",
         "Model **%s**, %s. Tested against **%d** pronunciations you saved by ear." % (MODEL, time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), n), "",
         "| Source | Same as your fix | Only the stress differs | Words scored |", "|---|---|---|---|",
         "| %s | %d (%s) | %d | %d |" % (MODEL, lm, pct(lm, n), ls, n),
         "| Kokoro's own guess | %d (%s) | %d | %d |" % (km, pct(km, n), ks, n)]
    if hint_pool:
        L.append("| Claude's hints (names-hints.json) | %d (%s) | %d | %d |" % (cm, pct(cm, hn), cs, hn))
        L.append("| %s, same %d words as Claude's hints | %d (%s) | | %d |" % (MODEL, hn, lm_on_h, pct(lm_on_h, ln_on_h), ln_on_h))
    L += ["", "\"Same\" means a listener wouldn't notice a difference (the comparison the pronunciation story uses).",
          "A disagreement isn't automatically wrong: some names have two accepted pronunciations. differences.mp3 plays",
          "\"Your fix ... Luna ...\" for each one, in the order of the table below, so you can judge by ear.", "",
          "Tokens used: %d in, %d out. Took %.0f s." % (usage["prompt_tokens"], usage["completion_tokens"], time.time() - t0), "",
          "## Where Luna differs from your fix", "",
          "| # | Word | Your fix | Luna (respelling) | Luna (IPA) | Verdict | Claude's hint | Kokoro's guess |", "|---|---|---|---|---|---|---|---|"]
    for k, t in enumerate(diffs, 1):
        L.append("| %d | %s | `%s` | %s | `%s` | %s | %s | %s |" % (
            k, t["phrase"], t["truth"], t["luna_respell"] or "—", t["luna_ipa"] or "—", t["v_luna"],
            ("`%s` (%s)" % (t["claude"], t["v_claude"])) if t["claude"] else "—", "`%s` (%s)" % (t["kokoro"], t["v_kokoro"])))
    L += ["", "## Where Luna matches your fix", "", ", ".join(t["phrase"] for t in tests if t["v_luna"] == "match") or "none", ""]
    with open(OUT_DIR + "/report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    save(OUT_DIR + "/results.json", {"model": MODEL, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    "summary": {"tested": n, "luna_match": lm, "luna_stress_only": ls, "kokoro_match": km,
                                                "claude_tested": hn, "claude_match": cm, "luna_match_on_claude_words": lm_on_h},
                                    "usage": usage, "items": tests})
    print("[luna] %s matched %d of %d (%s); Kokoro %d; Claude's hints %d of %d" % (MODEL, lm, n, pct(lm, n), km, cm, hn), flush=True)
    print("[luna] done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
