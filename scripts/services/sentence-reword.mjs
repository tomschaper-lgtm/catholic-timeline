// scripts/services/sentence-reword.mjs
//
// Service: "sentence-reword"
//
// One task = one entity, queued via Task Automation's Add Task batch selector (Category/Start/
// Quantity — the same picker shape image-generate uses; see sentenceRewordPool() in index.html).
// This handler scans every section's `b` field for a paragraph containing a sentence over 40
// words, asks Claude to reword just that one sentence into shorter ones, and — if it finds any —
// spawns exactly ONE `proposed` task for the whole entity, carrying every fix as a `patches`
// array (['article', matchText, 'U', replacement] tuples). Reviewing that one task shows the
// WHOLE article at once (index.html's tkRenderSentenceRewordReview), not one screen per sentence
// — a paragraph with three long sentences is one decision, not three. This task itself never
// touches data.json — only an approved child does, and only once a human taps Approve.
//
// Scope, per content-authoring-skill.md's "Sentence length — write for the ear" section:
//   - `art.sections[].b` only. Never `quotes`, `facts`, or anything else.
//   - Never exceed 40 words — no exception tier (the old manual chat-based cleanup pass allowed
//     one sentence under 60 per article; that carve-out is deliberately not carried over here).
//   - A paragraph containing an `entry:` cross-reference link is skipped in its entirety, so a
//     rewrite can never land mid-link or shift which word carries the link. Other paragraphs in
//     the same section remain eligible.
//   - Meaning and certainty-tier wording ("tradition holds…", "may have…") must survive exactly —
//     this is a mechanical split for the ear, never a chance to re-research or re-word content.
//   - Applies to existing/seed entries only in practice: a freshly-drafted entry that already
//     follows the word-count rule simply has nothing here to flag, so it never enters the pool.
//
// Audio invalidation: approving this task's bundled patches also clears the entity's `audio`
// field and queues its recorded files for deletion — see wlApplyTaskToDb() and
// publishToGitHub() in index.html. Nothing about that lives here; this handler only ever
// proposes text changes.
//
// Requires ANTHROPIC_API_KEY as a repo secret, passed through by orchestrator.yml.


import { stripHtml } from '../lib/text.mjs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// A single named constant so bumping the model later is a one-line change.
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const MAX_SENTENCE_WORDS = 40;
const TRACKED_TAGS = ['b', 'i', 'u', 'blockquote'];

function wordCount(rawText){
  const plain = stripHtml(rawText).replace(/\s+/g, ' ').trim();
  return plain ? plain.split(' ').length : 0;
}

// A paragraph containing an entry: cross-reference link is left alone entirely, per the spec
// above — this mirrors the plain existence check the app itself would make, not the fuller
// anchor-span math applyOnePatch() does when it actually applies a patch later.
function paragraphHasEntryLink(paragraphRaw){
  return /href\s*=\s*["']entry:/i.test(paragraphRaw);
}

// Titles, honorifics, and other common abbreviations that end in a period but do NOT end a
// sentence. Lowercase, no trailing period — the check strips it before comparing. Without this,
// "St. Paul" or "Dr. Smith" splits into two fake sentences (and, worse, could get counted or
// matched as its own over-length fragment) since a period-space-capital is otherwise
// indistinguishable from a real sentence boundary. Keep this identical to the same constant in
// index.html's tkSplitSentencesForDisplay — the review has to mark the same sentence boundaries
// this handler actually matched against, or what's highlighted won't line up with what changed.
const SENTENCE_ABBREVIATIONS = new Set([
  'st','sts','ss','dr','mr','mrs','ms','fr','msgr','bl','ven','abp','card','rev',
  'gen','col','capt','lt','sgt','maj','adm','prof','pres','gov','sen','rep','hon',
  'vs','etc','al','no','vol','ch','v','c','ca','ed','eds','tr','pp',
  'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec',
  'i.e','e.g','a.d','b.c','a.m','p.m','u.s','u.k'
]);

// Heuristic sentence boundary: punctuation, then whitespace, then what looks like the start of a
// new sentence — except when the word right before the punctuation is a known abbreviation
// (St., Dr., c., etc.), in which case that's not really a boundary and scanning continues. Still
// imperfect on anything not in the list above, and on mid-sentence quotes — that's acceptable
// here, since a wrong split just means Claude sees a slightly different chunk than a human would
// call "one sentence," and every resulting proposal is reviewed before it touches anything.
function splitIntoSentences(paragraphRaw){
  const boundary = /[.!?]\s+(?=[A-Z0-9"'\u201C(])/g;
  const out = [];
  let start = 0, m;
  while((m = boundary.exec(paragraphRaw))){
    const cutAt = m.index + 1; // right after the punctuation mark
    const wordMatch = /(?:^|[^A-Za-z.])((?:[A-Za-z]\.)*[A-Za-z]+)\.$/.exec(paragraphRaw.slice(start, cutAt));
    const word = wordMatch ? wordMatch[1].toLowerCase() : '';
    if(SENTENCE_ABBREVIATIONS.has(word)) continue; // not a real sentence boundary — keep scanning
    out.push(paragraphRaw.slice(start, cutAt).trim());
    start = boundary.lastIndex;
  }
  const last = paragraphRaw.slice(start).trim();
  if(last) out.push(last);
  return out.filter(Boolean);
}

// A sentence chunk that opens a tracked tag without closing it (or vice versa) means the
// sentence-boundary regex sliced through a <b>/<i>/<u>/<blockquote> span rather than around it.
// Rather than risk asking Claude to reword a fragment and reinsert it with mismatched tags, this
// candidate is skipped outright — the sentence stays exactly as-is and can still be fixed by hand
// later. Fails safe: the cost is one missed automation, never corrupted markup.
function hasBalancedTags(text){
  return TRACKED_TAGS.every(tag => {
    const opens = (text.match(new RegExp('<' + tag + '(\\s[^>]*)?>', 'gi')) || []).length;
    const closes = (text.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
    return opens === closes;
  });
}

// How many times matchText already occurs at-or-before charIndex in the full article text (all
// section bodies concatenated in order) — mirrors the left-to-right, section-by-section counting
// applyOnePatch()'s patchTextInSections() does client-side, so the @N this handler writes lands
// on the same occurrence the reviewer sees marked and the same one Approve will actually touch.
// (It doesn't replicate that function's one further rule — skipping an occurrence that sits
// inside an <a href="entry:…"> span — since a sentence long enough to trigger this workflow
// essentially never recurs verbatim inside a link elsewhere in the same article, and a human
// reviews every proposal before Approve regardless.)
function occurrenceAt(fullText, matchText, charIndex){
  let count = 0, from = 0;
  while(true){
    const found = fullText.indexOf(matchText, from);
    if(found === -1 || found > charIndex) break;
    count++;
    if(found === charIndex) break;
    from = found + 1;
  }
  return count;
}

function buildPrompt(sentence, paragraph){
  return [
    'You are reworking one over-length sentence in a Catholic saints-and-history article so it reads well aloud \u2014 the article is narrated as audio.',
    '',
    'Rules:',
    '- Split it into two or three sentences, each targeting 15\u201325 words; 35 is an acceptable rare stretch; never exceed 40 words in any resulting sentence.',
    '- Preserve the exact meaning and every fact \u2014 add nothing, remove nothing.',
    '- Preserve certainty-tier wording exactly as written (e.g. "tradition holds\u2026", "may have\u2026", "Scripture states\u2026") \u2014 never make a qualified claim read as more certain, or a certain claim read as hedged.',
    '- If the original sentence contains inline HTML tags (<b>, <i>, <u>, <blockquote>), preserve them, applied to the same words, across the rewritten sentences.',
    '- Do not merge this sentence with anything before or after it \u2014 only rework the text given below.',
    '- Return ONLY the replacement text \u2014 no preamble, no surrounding quotation marks, no explanation, no markdown.',
    '',
    'Full paragraph, for context only (do not rewrite anything outside the quoted sentence):',
    '"""',
    paragraph,
    '"""',
    '',
    'The sentence to rework, exactly as it appears above:',
    '"""',
    sentence,
    '"""',
    '',
    'Return only its replacement.'
  ].join('\n');
}

async function rewordSentence(sentence, paragraph, apiKey){
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: buildPrompt(sentence, paragraph) }]
    })
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    throw new Error('Anthropic messages ' + res.status + ': ' + errText.slice(0, 300));
  }
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('').trim();
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */
export async function runSentenceReword(task, dataJson){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry){
    return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };
  }

  const sections = (entry.art && entry.art.sections) || [];
  // Null-byte separator: won't appear in real article prose, so occurrenceAt() can treat the
  // whole article as one string without a section boundary ever masquerading as a text match.
  const fullText = sections.map(s => String(s.b || '')).join('\u0000');

  let sectionOffset = 0;
  const patches = []; // every fix for this entity, bundled into one review instead of one task each
  let found = 0, reworded = 0, skippedTagMismatch = 0, apiErrors = 0;

  for(let si = 0; si < sections.length; si++){
    const body = String(sections[si].b || '');
    const paragraphs = body.split('\n\n');
    let paraOffset = 0;

    for(const para of paragraphs){
      if(!paragraphHasEntryLink(para)){
        for(const sentence of splitIntoSentences(para)){
          if(wordCount(sentence) > MAX_SENTENCE_WORDS){
            found++;
            if(!hasBalancedTags(sentence)){
              skippedTagMismatch++;
            }else{
              const sentIdxInPara = para.indexOf(sentence);
              if(sentIdxInPara !== -1){
                const charIndex = sectionOffset + paraOffset + sentIdxInPara;
                const occurrence = occurrenceAt(fullText, sentence, charIndex);
                let replacement = null;
                try{
                  replacement = await rewordSentence(sentence, para, apiKey);
                }catch(apiErr){
                  // One bad call doesn't stop the rest of this entity's sentences — reported in
                  // the summary; a rerun of this same task will simply retry whatever's left,
                  // since nothing about this task's own state is affected by a per-sentence miss.
                  apiErrors++;
                }
                if(replacement && replacement !== sentence){
                  reworded++;
                  const element = occurrence > 1 ? sentence + '@' + occurrence : sentence;
                  patches.push(['article', element, 'U', replacement]);
                }
              }
            }
          }
        }
      }
      paraOffset += para.length + 2; // '\n\n' separator
    }
    sectionOffset += body.length + 1; // '\u0000' separator
  }

  const summary = found === 0
    ? 'no sentences over ' + MAX_SENTENCE_WORDS + ' words found \u2014 nothing queued for review'
    : reworded + ' of ' + found + ' long sentence(s) reworded and queued for review' +
      (skippedTagMismatch ? ' \u00b7 ' + skippedTagMismatch + ' skipped (spans a formatting tag)' : '') +
      (apiErrors ? ' \u00b7 ' + apiErrors + ' call(s) failed, rerun this task to retry those' : '');

  const spawnedTasks = [];
  if(patches.length){
    const nowIso = new Date().toISOString();
    spawnedTasks.push({
      id: 'task-sentence-reword-' + entry.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      type: 'sentence-reword', entityId: entry.id, batchId: null, status: 'proposed',
      description: 'Reword ' + patches.length + ' long sentence' + (patches.length === 1 ? '' : 's') + ' \u2014 ' + entry.n,
      payload: {}, result: { name: entry.n, patches }, error: null, createdAt: nowIso, updatedAt: nowIso
    });
  }

  return {
    result: {
      entityId: entry.id, name: entry.n,
      sentencesFound: found, sentencesReworded: reworded,
      skippedTagMismatch, apiErrors
    },
    summary,
    spawnedTasks
  };
}
