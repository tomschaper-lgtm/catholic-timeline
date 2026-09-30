#!/usr/bin/env python3
"""Pronunciation audit for the Kokoro voice.

MODE=audit (default)
  1. Reads every article in data.json and counts which names from
     pronunciation/names-reference.json actually appear.
  2. Asks Kokoro how it would say each name (text-to-phonemes only, no audio, so it is fast) and
     compares that with the reference. Names that already match need no rule; they are recorded as
     "matches" so later audits skip them. Names that already have a rule, or were decided before,
     are skipped too.
  3. For every mismatch, speaks the name twice into ONE audition MP3: first as Kokoro says it now,
     then the reference version. Writes a numbered report next to it.
  4. Also lists capitalized words from the articles that Kokoro's dictionary does NOT know (it has
     to guess those), most frequent first, so new names can be added to the reference file.
  Output: audio/_tests/pronunciation-audition.mp3, audio/_tests/pronunciation-audition.txt,
          pronunciation/names-candidates.json, pronunciation/names-decisions.json

MODE=apply
  Reads names-candidates.json. Every candidate becomes a rule in the pronunciation file EXCEPT the
  numbers listed in REJECT (e.g. "3, 7, 12"). Decisions are recorded so nothing is proposed twice.
  The candidates file and audition MP3 are then removed.
"""
import json, os, re, sys, time, wave, subprocess
from collections import Counter

DATA_PATH = os.environ.get("DATA_PATH", "data.json")
REF_PATH = "pronunciation/names-reference.json"
RULES_PATH = "pronunciation/catholic-timeline-pronunciation.json"
DEC_PATH = "pronunciation/names-decisions.json"
CAND_PATH = "pronunciation/names-candidates.json"
OUT_DIR = "audio/_tests"
MP3_PATH = os.path.join(OUT_DIR, "pronunciation-audition.mp3")
TXT_PATH = os.path.join(OUT_DIR, "pronunciation-audition.txt")
VOICE = (os.environ.get("VOICE") or "af_heart").strip()
RATE = 24000


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def article_text(data):
    entries = data.get("entries", data) if isinstance(data, dict) else data
    parts = []
    for e in entries or []:
        parts.append(e.get("n", "") or "")
        for s in ((e.get("art") or {}).get("sections") or []):
            parts.append(s.get("h", "") or "")
            parts.append(s.get("b", "") or "")
    return re.sub(r"<[^>]+>", " ", " ".join(parts))


def norm(ps):
    """Loose comparison: ignore secondary stress, weak-vowel differences and a few US mergers, so
    only differences a listener would actually notice (stress position, full vowels, consonants)
    count as a mismatch."""
    ps = (ps or "").replace(" ", "").replace("ˌ", "")
    ps = re.sub(r"[ɪəᵻᵊʌ]", "ə", ps)
    ps = ps.replace("ɾ", "t").replace("ɜɹ", "əɹ")
    ps = re.sub(r"ɔ(?!ɹ)", "ɑ", ps)
    return ps


def rule_words(rules_doc):
    return {r.get("string_to_replace") for r in rules_doc.get("rules", [])}


def audit():
    ref = load(REF_PATH, {}).get("names", {})
    rules_doc = load(RULES_PATH, {"rules": []})
    decisions = load(DEC_PATH, {})
    text = article_text(load(DATA_PATH, {}))
    counts = Counter(re.findall(r"[A-Z][A-Za-z\u00C0-\u024F'-]+", text))

    have_rule = rule_words(rules_doc)
    todo = [n for n in sorted(ref) if counts[n] and n not in have_rule and n not in decisions]
    print("[audit] %d reference names, %d in articles, %d to check" %
          (len(ref), sum(1 for n in ref if counts[n]), len(todo)), flush=True)

    t0 = time.time()
    from kokoro import KPipeline
    pipe = KPipeline(lang_code="b" if VOICE.startswith(("bf_", "bm_")) else "a", repo_id="hexgrad/Kokoro-82M")
    print("[audit] Kokoro ready in %.1fs" % (time.time() - t0), flush=True)

    def kokoro_says(word):
        try:
            ps, _ = pipe.g2p(word)
            return (ps or "").strip()
        except Exception as e:  # never let one odd word stop the audit
            return "?(%s)" % e

    candidates, matched = [], []
    for name in todo:
        now = kokoro_says(name)
        want = ref[name]["ipa"]
        if now and norm(now) == norm(want):
            decisions[name] = "matches"
            matched.append(name)
        else:
            candidates.append({"n": len(candidates) + 1, "name": name, "ipa": want,
                               "say": ref[name].get("say", ""), "kokoro": now, "uses": counts[name]})

    # Words Kokoro's dictionary does not know (it has to guess them). Best effort: depends on the
    # library exposing its lexicon; if it doesn't, this section just says so.
    unknown_note, unknown = "", []
    try:
        lex = pipe.g2p.lexicon
        known = set(getattr(lex, "golds", {}) or {}) | set(getattr(lex, "silvers", {}) or {})
        if not known:
            raise AttributeError("no lexicon tables")
        for w, c in counts.most_common():
            if len(w) < 4 or w in ref or w in have_rule:
                continue
            if w in known or w.lower() in known or w.capitalize() in known:
                continue
            unknown.append((w, c))
            if len(unknown) >= 80:
                break
    except Exception as e:
        unknown_note = "(could not read Kokoro's dictionary: %s)" % e

    # Audition MP3: "<n>. <name as Kokoro says it>. <name, reference>."
    os.makedirs(OUT_DIR, exist_ok=True)
    import numpy as np
    chunks = []
    for c in candidates:
        line = "%d. %s. [%s](/%s/)." % (c["n"], c["name"], c["name"], c["ipa"])
        for r in pipe(line, voice=VOICE, speed=0.9, split_pattern=None):
            au = getattr(r, "audio", None)
            if au is None and isinstance(r, tuple):
                au = r[2]
            if au is not None:
                if hasattr(au, "detach"):
                    au = au.detach().cpu().numpy()
                chunks.append(np.asarray(au, dtype=np.float32).reshape(-1))
        chunks.append(np.zeros(int(1.0 * RATE), dtype=np.float32))
    if chunks:
        wav = MP3_PATH[:-4] + ".wav"
        pcm = (np.clip(np.concatenate(chunks), -1, 1) * 32767).astype("<i2")
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "44100",
                        "-c:a", "libmp3lame", "-b:a", "64k", MP3_PATH], check=True)
        os.remove(wav)
    elif os.path.exists(MP3_PATH):
        os.remove(MP3_PATH)

    lines = ["Pronunciation audition  %s  (voice %s)" % (time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), VOICE), ""]
    if candidates:
        lines += ["Each number is spoken twice: FIRST how Kokoro says it now, THEN the proposed version.",
                  "To approve all except the wrong ones, run the workflow again with mode = apply and",
                  "list the numbers to reject (e.g. 3, 7). Leave reject blank to approve all.", ""]
        for c in candidates:
            lines.append("%3d  %-15s proposed %-24s (%d uses)" % (c["n"], c["name"], c["say"], c["uses"]))
    else:
        lines.append("Nothing to audition: every reference name in the articles already matches or has a rule.")
    lines += ["", "Already correct, no rule needed (%d): %s" % (len(matched), ", ".join(matched) or "none"), ""]
    lines.append("Words in the articles Kokoro has to guess (not in its dictionary), most used first %s:" % unknown_note)
    lines += ["  %s (%d)" % (w, c) for w, c in unknown] or ["  none found"]
    with open(TXT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines), flush=True)

    save(CAND_PATH, {"voice": VOICE, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "candidates": candidates})
    save(DEC_PATH, decisions)


def apply():
    cand = load(CAND_PATH, None)
    if not cand or not cand.get("candidates"):
        sys.exit("No candidates to apply. Run the workflow with mode = audit first.")
    reject = {int(x) for x in re.findall(r"\d+", os.environ.get("REJECT", ""))}
    rules_doc = load(RULES_PATH, {"rules": []})
    decisions = load(DEC_PATH, {})
    have = rule_words(rules_doc)
    added, rejected = [], []
    for c in cand["candidates"]:
        if c["n"] in reject:
            decisions[c["name"]] = "rejected"
            rejected.append(c["name"])
            continue
        if c["name"] not in have:
            # Appended at the END: rules are tried in order, and multi-word rules such as
            # "Constantinople II" must keep priority over any single-word name rule.
            rules_doc["rules"].append({"string_to_replace": c["name"], "type": "alias", "alias": c["name"],
                                       "kokoro_ipa": c["ipa"], "case_sensitive": True, "word_boundaries": True})
        decisions[c["name"]] = "accepted"
        added.append(c["name"])
    save(RULES_PATH, rules_doc)
    save(DEC_PATH, decisions)
    for p in (CAND_PATH, MP3_PATH):
        if os.path.exists(p):
            os.remove(p)
    with open(TXT_PATH, "w", encoding="utf-8") as f:
        f.write("Applied %s\nAdded as rules (%d): %s\nRejected (%d): %s\n" % (
            time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), len(added), ", ".join(added) or "none",
            len(rejected), ", ".join(rejected) or "none"))
    print(open(TXT_PATH, encoding="utf-8").read())


if __name__ == "__main__":
    (apply if (os.environ.get("MODE") or "audit").strip().lower() == "apply" else audit)()
