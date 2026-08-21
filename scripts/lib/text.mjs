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

// Loose text-equality check used when aligning a timing file's actual cues
// against the sentence list splitSentences() derives from an entry's
// current article text. Strips exactly the artifacts THREE known
// generation-time bugs leave behind, plus ordinary whitespace differences —
// nothing broader than that, so a genuine wording difference still reads as
// a real mismatch rather than being normalized away:
//   1. a leaked backslash immediately before a quote (the v202
//      double-escaping finding)
//   2. a stray leading quote character inherited from a swallowed previous
//      sentence (this bug)
//   3. a stray space directly before punctuation, left wherever a
//      cross-reference link (<a href="entry:…">) sits immediately before
//      punctuation in the source prose — generate-audio.mjs's own
//      tag-stripping leaves a space at that boundary (the v195 finding,
//      shared verbatim with the app's own normalizeCueSearchText() so the
//      two never disagree about what counts as "the same text")
export function normalizeForMatch(s) {
  return (s || '')
    .replace(/\\(?=["'\u201c\u201d\u2018\u2019])/g, '')
    .replace(/^[\s"'\u201c\u201d\u2018\u2019]+/, '')
    .replace(/\s+([,.;:!?)\]}'"\u201d\u2019])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
