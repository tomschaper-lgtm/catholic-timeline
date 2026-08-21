// Shared text-processing helpers used by both the audio-generation script
// (generate-audio.mjs) and the cue-gap repair script (repair-cue-gaps.mjs).
// Kept in one place so the two never drift apart on what counts as "a
// sentence" — a mismatch there is exactly what caused the gap bug this file
// fixes (see repair-cue-gaps.mjs for the retroactive repair of files already
// generated under the old, narrower splitter).

export function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ');
}

// Naive but effective sentence splitter — splits after ./!/? plus whitespace
// or end of string.
//
// FIX (see cue-repair-log / audit note): a run of closing punctuation — a
// straight or curly quote, or a closing parenthesis/angle-quote — is now
// allowed to sit between the terminal mark and the required whitespace/end.
// Previously, a sentence ending in a quotation (`...from their sins."`) was
// never recognized as complete, because the period was immediately followed
// by `"` rather than whitespace. The splitter would then run past the end
// of that sentence looking for a later period that WAS followed by
// whitespace, silently merging the real sentence boundary away and leaving
// the orphaned closing quote stuck to the front of whatever sentence came
// next. That produced two visible symptoms downstream: a genuine timing gap
// (the dropped sentence never got its own cue, even though it was narrated)
// and a stray leading quote/backslash character on the cue right after it.
const CLOSERS = '"\'\u201d\u2019)\u203a\u00bb';
const SENTENCE_RE = new RegExp(`[^.!?]+[.!?]+[${CLOSERS}]*(\\s+|$)`, 'g');

export function splitSentences(text) {
  const re = new RegExp(SENTENCE_RE); // fresh copy — this instance owns lastIndex
  const sentences = [];
  let m;
  let lastIndex = 0;
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

// Loose text-equality check used to align a timing file's actual cues
// against the sentence list splitSentences() derives from an entry's
// current article text. Strips everything except letters and digits —
// all punctuation, all quote styles (straight/curly), dashes, double
// spaces, the leaked backslash/quote artifacts two separate generation
// bugs leave behind — collapsing each sentence down to its bare words.
//
// This is deliberately much looser than a "diff": once two sentences agree
// on their words, cosmetic differences (typography, a stray artifact
// character, whitespace) shouldn't make a real cue look like a gap. Actual
// content differences — different words, a sentence genuinely added or
// removed — still fail to match, because the words themselves differ, not
// just the punctuation around them.
//
// The repair script uses this ONLY to decide whether an actual cue
// corresponds to a given expected sentence. Once it does, the cue's stored
// text is overwritten with the current, exact expected text (see
// repair-cue-gaps.mjs's "corrected" pass) — so matching loosely never
// leaves loose text behind; it's the mechanism for making the file exact
// again, not a replacement for exactness.
export function normalizeLoose(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
