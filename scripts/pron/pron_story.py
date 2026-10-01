#!/usr/bin/env python3
"""Pronunciation story: hear every hard name once, flag only the ones that sound wrong.

1. Collects every capitalized name from the articles (data.json). Possessives ("Paul's") and
   plurals are folded into the plain word; words that also appear in lowercase ("Churches") are
   ordinary words and skipped; Roman numerals are left to the numeral rules.
2. Asks Kokoro, word by word, whether it found the word in its dictionary or had to guess.
   Dictionary words (Paul, Rome, October...) are dropped: those entries come from human-made
   dictionaries. Kept: words Kokoro guesses, names with accents, and names in names-reference.json
   that Kokoro says differently from the reference. Words that already have a rule, or were
   already decided on the review page, are skipped.
3. Gives each kept word its best known pronunciation, in this order: names-reference.json, the
   hand-written names-hints.json, Wiktionary's English pronunciation (WikiPron data, downloaded
   here), else Kokoro's own guess.
4. Writes short silly sentences, 2-3 names each, most-used words first, in chapters of
   CHAPTER_SIZE words, and records each chapter with VOICE (sentence by sentence, so the page knows
   when each sentence starts).
Output: pronunciation/story/story.json + chapter-NN.mp3, listened to on the phone at
pronounce.html?story=1 (Manage -> Import -> "Listen for mispronunciations").
"""
import json, os, random, re, shutil, subprocess, sys, time, unicodedata, urllib.request, wave
from collections import Counter

DATA_PATH = os.environ.get("DATA_PATH", "data.json")
REF_PATH = "pronunciation/names-reference.json"
HINT_PATH = "pronunciation/names-hints.json"
RULES_PATH = "pronunciation/catholic-timeline-pronunciation.json"
DEC_PATH = "pronunciation/names-decisions.json"
OUT_DIR = "pronunciation/story"
VOICE = (os.environ.get("VOICE") or "am_adam").strip()
CHAPTER_SIZE = max(20, int(os.environ.get("CHAPTER_SIZE") or 120))
MAX_WORDS = int(os.environ.get("MAX_WORDS") or 0)
DRY_RUN = os.environ.get("DRY_RUN") == "1"          # build the list and story, skip the audio
WIKIPRON_URLS = [
    "https://raw.githubusercontent.com/CUNY-CL/wikipron/master/data/scrape/tsv/eng_latn_us_broad.tsv",
    "https://raw.githubusercontent.com/CUNY-CL/wikipron/main/data/scrape/tsv/eng_latn_us_broad.tsv",
]
SR = 24000
GAP = 0.45            # seconds of silence between sentences


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")


def article_text(data):
    entries = data.get("entries", data) if isinstance(data, dict) else data
    parts = []
    for e in entries or []:
        parts.append(e.get("n", "") or "")
        for s in ((e.get("art") or {}).get("sections") or []):
            parts.append(s.get("h", "") or "")
            parts.append(s.get("b", "") or "")
    return re.sub(r"<[^>]+>", " ", " \n ".join(parts))


# ---------- 1. the words ----------
TOKEN = re.compile(r"[^\W\d_]+(?:['\u2019-][^\W\d_]+)*")
ROMAN = re.compile(r"[IVXLCDM]+")


def pieces(tok):
    tok = re.sub(r"['\u2019]s$", "", tok)
    return [p for p in tok.split("-") if p]


def stems(w):
    l = w.lower()
    out = set()
    for a, b in (("ies", "y"), ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("ing", ""), ("ing", "e")):
        if l.endswith(a) and len(l) > len(a) + 2:
            out.add(l[: -len(a)] + b)
    return out


def collect(text):
    counts, lower = Counter(), set()
    for tok in TOKEN.findall(text):
        for p in pieces(tok):
            if p[0].islower():
                lower.add(p.lower())
            elif len(p) >= 3 and not ROMAN.fullmatch(p) and not p.isupper():
                counts[p] += 1
    names = Counter()
    for w, c in counts.items():
        if w.lower() in lower or stems(w) & lower:
            continue                                   # an ordinary word that starts a sentence
        names[w] += c
    return names


def has_accent(w):
    return any(unicodedata.combining(ch) for ch in unicodedata.normalize("NFD", w)) or any(ch in w for ch in "łŁøØßæÆœŒđĐ")


def norm(ps):
    """Loose comparison, as in the audit: only differences a listener would notice."""
    ps = (ps or "").replace(" ", "").replace("ˌ", "")
    ps = re.sub(r"[ɪəᵻᵊʌ]", "ə", ps)
    ps = ps.replace("ɾ", "t").replace("ɜɹ", "əɹ")
    ps = re.sub(r"ɔ(?!ɹ)", "ɑ", ps)
    return ps


# ---------- 3. Wiktionary (WikiPron) -> Kokoro notation ----------
def load_wikipron():
    last = None
    for url in WIKIPRON_URLS:
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                txt = r.read().decode("utf-8")
            d = {}
            for line in txt.splitlines():
                p = line.split("\t")
                if len(p) >= 2 and p[0].strip():
                    d.setdefault(p[0].strip().lower(), p[1].strip())
            return d, url
        except Exception as e:  # no internet / file moved: carry on without it
            last = e
    return {}, "not available (%s)" % last


VOWELS = set("AIOWYæɑɔəɛɪiuʊʌɜᵊ")
MULTI = [("d͡ʒ", "ʤ"), ("t͡ʃ", "ʧ"), ("dʒ", "ʤ"), ("tʃ", "ʧ"), ("eɪ", "A"), ("aɪ", "I"), ("oʊ", "O"), ("aʊ", "W"),
         ("ɔɪ", "Y"), ("əʊ", "O"), ("ɝ", "ɜɹ"), ("ɚ", "əɹ"), ("ɜː", "ɜɹ")]
SINGLE = {"r": "ɹ", "g": "ɡ", "ɫ": "l", "ɒ": "ɑ", "ɐ": "ə", "ɘ": "ə", "ɵ": "ə", "ɨ": "ɪ", "ʉ": "u", "e": "A", "o": "O",
          "a": "ɑ", "ʍ": "w", "x": "k", "ç": "h", "ʔ": "", "ɾ": "t", "y": "u", "ø": "ɜ", "œ": "ɛ", "ʁ": "ɹ", "ɲ": "nj",
          "ʎ": "lj", "ɣ": "ɡ", "β": "b", "χ": "h", "ɬ": "l"}


def ipa_to_kokoro(ipa, allowed):
    s = (ipa or "").strip().strip("/[]")
    s = s.replace(" ", "").replace(".", "").replace("ː", "").replace("ˑ", "").replace("(", "").replace(")", "")
    s = s.replace("'", "ˈ").replace("ˈˈ", "ˈ")
    s = re.sub(r"([nlmɹ])\u0329", r"ə\1", s)                     # syllabic n, l, m
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if not unicodedata.combining(ch) or ch == "\u0361")
    out, i = [], 0
    while i < len(s):
        for a, b in MULTI:
            if s.startswith(a, i):
                out.append(b); i += len(a); break
        else:
            ch = s[i]
            out.append(SINGLE.get(ch, ch)); i += 1
    flat = "".join(out).replace("\u0361", "")
    # Wiktionary puts the stress mark at the start of the syllable; Kokoro wants it on the vowel.
    res, pend = "", ""
    for ch in flat:
        if ch in "ˈˌ":
            pend = ch if not pend or ch == "ˈ" else pend
            continue
        if ch in VOWELS and pend:
            res += pend; pend = ""
        res += ch
    if not any(ch in VOWELS for ch in res):
        return None
    if "ˈ" not in res:                                   # one-syllable words come without a mark
        k = next(i for i, ch in enumerate(res) if ch in VOWELS)
        res = res[:k] + "ˈ" + res[k:].replace("ˌ", "")
    if allowed and any(ch not in allowed for ch in res):
        return None
    return res


# ---------- 4. the silly story ----------
TEMPLATES = [   # mostly two or three names per sentence; a few one-name lines for variety
    "{a} waved at {b}.", "{a} borrowed a ladder from {b}.", "Nobody warned {a} about {b} and the goat.",
    "{a} and {b} shared a pickle.", "Then {a} sat on a cake with {b}.", "{a} sang loudly to {b} and {c}.",
    "A duck followed {a} and {b} all day.", "{a} lost a sock near {b}.", "{a}, {b}, and {c} missed the bus.",
    "{a} painted {b} bright green.", "{a} sneezed, and {b} laughed.", "The cat chose {a} over {b}.",
    "{a} baked bread for {b} and {c}.", "Why did {a} hide the spoons from {b}?", "{a} told {b} a long joke.",
    "Even {a} liked the soup.", "{a} rode a mule to {b}.", "{a} found a frog near {b}.",
    "Then {a}, {b}, and {c} took a nap.", "{a} and {b} counted the pigeons twice.", "{a} tripped over {b}.",
    "A parrot kept shouting {a}.", "{a} wrote {b} a letter about turnips.", "Tea with {a} and {b} went badly.",
    "{a} and {b} argued about hats.", "{a} hummed while {b} danced.", "The wind blew {a} toward {b}.",
    "{a} bought three melons from {b}.", "Everyone clapped for {a} and {b}.", "{a} kept a goose named {b}.",
    "{a} and {b} chased {c} around the barn.", "Later, {a} pushed {b} into a pond.", "{a} whistled at {b}.",
    "{a} knitted {b} a scarf.", "{a} juggled lemons for {b} and {c}.", "Even the dog barked at {a}.",
    "{a} hid behind {b} and {c}.", "Who invited {a} and {b} to lunch?", "{a} gave {b} a muddy boot.",
    "{a} and {b} counted sheep with {c}.", "A bee chased {a} home to {b}.", "{a} snored while {b} ate supper.",
    "{a} and {c} sold {b} a broken wagon.", "{a}, {b}, and {c} sang off key.", "{a} raced {b} to the well.",
]


def slots(t):
    return len(re.findall(r"\{[abc]\}", t))


def build_sentences(words, rng):
    """words: list of word dicts in order. Returns sentences: [{parts:[str|{"w":name}], names:[...]}]."""
    out, i = [], 0
    pool = []
    while i < len(words):
        if not pool:
            pool = TEMPLATES[:]
            rng.shuffle(pool)
        left = len(words) - i
        pick = next((t for t in pool if slots(t) <= left), None)
        if pick is None:
            pick = next(t for t in TEMPLATES if slots(t) == 1)
        else:
            pool.remove(pick)
        n = slots(pick)
        use = words[i:i + n]
        i += n
        parts = []
        for k, piece in enumerate(re.split(r"(\{[abc]\})", pick)):
            if re.fullmatch(r"\{[abc]\}", piece):
                parts.append({"w": use["abc".index(piece[1])]["name"]})
            elif piece:
                parts.append(piece)
        out.append({"parts": parts, "names": [w["name"] for w in use]})
    return out


def spoken(sentence, by_name):
    """Text for Kokoro: names with a chosen pronunciation become [Name](/sounds/)."""
    s = ""
    for p in sentence["parts"]:
        if isinstance(p, dict):
            w = by_name[p["w"]]
            s += "[%s](/%s/)" % (w["name"], w["ipa"]) if w["src"] != "kokoro" and w["ipa"] else w["name"]
        else:
            s += p
    return s


def plain(sentence):
    return "".join(p["w"] if isinstance(p, dict) else p for p in sentence["parts"])


# ---------- audio ----------
def audio_of(res):
    a = getattr(res, "audio", None)
    if a is None and isinstance(res, (tuple, list)) and len(res) >= 3:
        a = res[2]
    if a is None:
        return None
    return a.detach().cpu().numpy() if hasattr(a, "detach") else a


def main():
    t0 = time.time()
    data = load(DATA_PATH, {})
    ref = load(REF_PATH, {}).get("names", {})
    hints = load(HINT_PATH, {}).get("names", {})
    rules = load(RULES_PATH, {"rules": []}).get("rules", [])
    decisions = load(DEC_PATH, {})
    have_rule = {r.get("string_to_replace") for r in rules if r}

    names = collect(article_text(data))
    print("[story] %d distinct names in the articles" % len(names), flush=True)

    from kokoro import KPipeline
    import numpy as np
    pipe = KPipeline(lang_code="b" if VOICE.startswith(("bf_", "bm_")) else "a", repo_id="hexgrad/Kokoro-82M")
    print("[story] Kokoro ready in %.1fs" % (time.time() - t0), flush=True)

    vocab = getattr(getattr(pipe, "model", None), "vocab", None) or {}
    allowed = set(vocab.keys()) if vocab else set()

    lex = getattr(pipe.g2p, "lexicon", None)
    known_set = set()
    if lex is not None:
        known_set = set(getattr(lex, "golds", {}) or {}) | set(getattr(lex, "silvers", {}) or {})
    ratings_seen = Counter()

    def kokoro_info(word):
        try:
            ps, toks = pipe.g2p(word)
        except Exception:
            return "", None
        rating = None
        for tk in toks or []:
            r = getattr(tk, "rating", None)
            if r is None:
                r = getattr(getattr(tk, "_", None), "rating", None)
            if r is not None:
                rating = r if rating is None else min(rating, r)
        ratings_seen[rating] += 1
        return (ps or "").strip(), rating

    def in_dictionary(word, rating):
        if rating is not None:
            return rating >= 3                       # 4 = gold dictionary, 3 = silver; lower = guessed
        forms = {word, word.lower(), word.capitalize()} | stems(word)
        return any(f in known_set for f in forms)

    wiki, wiki_src = load_wikipron()
    print("[story] Wiktionary pronunciations: %d (%s)" % (len(wiki), wiki_src), flush=True)

    kept, why = [], Counter()
    for name, uses in names.most_common():
        if name in have_rule or name in decisions:
            why["already decided"] += 1
            continue
        own, rating = kokoro_info(name)
        if not own:
            why["Kokoro could not read"] += 1
            continue
        known = in_dictionary(name, rating)
        r = ref.get(name)
        if r and r.get("ipa"):
            if norm(own) == norm(r["ipa"]):
                why["reference: Kokoro already right"] += 1
                continue
            word = {"name": name, "uses": uses, "kokoro": own, "src": "reference", "ipa": r["ipa"], "say": r.get("say", ""),
                    "bible": r.get("bible", "")}
        elif known and not has_accent(name):
            why["in Kokoro's dictionary"] += 1
            continue
        else:
            h = hints.get(name)
            wk = ipa_to_kokoro(wiki.get(name.lower()), allowed) if name.lower() in wiki else None
            if h and h.get("ipa"):
                word = {"name": name, "uses": uses, "kokoro": own, "src": "claude", "ipa": h["ipa"], "say": h.get("say", "")}
            elif wk:
                word = {"name": name, "uses": uses, "kokoro": own, "src": "wiktionary", "ipa": wk, "say": "",
                        "wiki": wiki.get(name.lower())}
            else:
                word = {"name": name, "uses": uses, "kokoro": own, "src": "kokoro", "ipa": own, "say": ""}
        kept.append(word)
        why["kept: " + word["src"]] += 1
    if MAX_WORDS and len(kept) > MAX_WORDS:
        kept = kept[:MAX_WORDS]
    print("[story] ratings seen: %s" % dict(ratings_seen), flush=True)
    for k, v in sorted(why.items()):
        print("[story]   %-34s %d" % (k, v), flush=True)
    print("[story] %d words go in the story" % len(kept), flush=True)

    by_name = {w["name"]: w for w in kept}
    rng = random.Random(7)
    chapters = []
    for c in range(0, len(kept), CHAPTER_SIZE):
        group = kept[c:c + CHAPTER_SIZE]
        chapters.append({"n": len(chapters) + 1, "sentences": build_sentences(group, rng),
                         "uses": [group[0]["uses"], group[-1]["uses"]]})

    if os.path.isdir(OUT_DIR):
        for f in os.listdir(OUT_DIR):
            if f.startswith("chapter-") and f.endswith(".mp3"):
                os.remove(os.path.join(OUT_DIR, f))
    os.makedirs(OUT_DIR, exist_ok=True)

    for ch in chapters:
        t1 = time.time()
        fname = "chapter-%02d.mp3" % ch["n"]
        ch["audio"] = OUT_DIR + "/" + fname
        if DRY_RUN:
            for s in ch["sentences"]:
                s["t"] = plain(s)
            continue
        pieces_, pos = [np.zeros(int(SR * 0.3), dtype=np.float32)], 0.3
        for s in ch["sentences"]:
            s["t"] = plain(s)
            chunks = []
            try:
                for res in pipe(spoken(s, by_name), voice=VOICE, speed=1.0):
                    a = audio_of(res)
                    if a is not None and len(a):
                        chunks.append(np.asarray(a, dtype=np.float32))
            except Exception as e:
                print("[story] could not say %r: %s" % (s["t"], e), flush=True)
            a = np.concatenate(chunks) if chunks else np.zeros(int(SR * 0.2), dtype=np.float32)
            s["s"] = round(pos, 2)
            pos += len(a) / SR
            s["e"] = round(pos, 2)
            pieces_.append(a)
            pieces_.append(np.zeros(int(SR * GAP), dtype=np.float32))
            pos += GAP
        wav = os.path.join("/tmp", fname.replace(".mp3", ".wav"))
        pcm = (np.clip(np.concatenate(pieces_), -1, 1) * 32767).astype("<i2").tobytes()
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "48k",
                        os.path.join(OUT_DIR, fname)], check=True)
        os.remove(wav)
        ch["seconds"] = round(pos, 1)
        print("[story] chapter %d: %d words, %d sentences, %.0fs of audio, made in %.0fs" %
              (ch["n"], sum(len(s["names"]) for s in ch["sentences"]), len(ch["sentences"]), pos, time.time() - t1), flush=True)

    save(OUT_DIR + "/story.json", {
        "about": "Pronunciation story. Built by scripts/pron/pron_story.py; listened to at pronounce.html?story=1.",
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "voice": VOICE, "wikipron": wiki_src, "counts": dict(why),
        "words": {w["name"]: {k: v for k, v in w.items() if k != "name"} for w in kept},
        "chapters": chapters,
    })
    print("[story] done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
