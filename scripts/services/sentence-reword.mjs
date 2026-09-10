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
//   - A sentence containing an `entry:` cross-reference link is still attempted, not skipped —
//     Claude is told exactly which link(s) to copy verbatim, and the reply is checked afterward
//     (extractEntryLinks/linksPreserved) to confirm every one actually survived character for
//     character before the fix is accepted. If even one didn't, the sentence is left untouched,
//     same outcome the old blanket per-paragraph skip gave, just arrived at after actually
//     trying rather than never attempting it — this used to give up on every long sentence in a
//     linked paragraph even when the link and the long sentence were different sentences entirely.
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
// Provider: defaults to Claude (ANTHROPIC_API_KEY), but a task's payload.provider === 'openai'
// routes every sentence in that task through GPT-5.6 Luna (OPENAI_API_KEY) instead — chosen per
// batch at Add Task time (index.html), not a global switch, so the two can be compared directly
// on the same real articles. Luna is a reasoning model whose reasoning tokens share the SAME
// output budget as its visible answer — reasoning.effort is set to 'none' here, not left at
// Luna's 'medium' default. This started as 'low' on the theory that a mechanical rewording task
// doesn't need deep reasoning; a real failure on St. Francis of Assisi then showed only 194
// output characters against a full 2000-token budget, which 'low' reasoning can't explain on its
// own — confirming reasoning tokens really were eating an unpredictable share of the same budget
// even at the lower setting. 'none' removes that variable entirely.
//
// Requires ANTHROPIC_API_KEY and/or OPENAI_API_KEY as repo secrets (whichever provider a given
// task actually uses), passed through by orchestrator.yml.


import { stripHtml } from '../lib/text.mjs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// A single named constant so bumping the model later is a one-line change.
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = 'gpt-5.6-luna';
const MAX_SENTENCE_WORDS = 40;
const TRACKED_TAGS = ['b', 'i', 'u', 'blockquote', 'a'];

function wordCount(rawText){
  const plain = stripHtml(rawText).replace(/\s+/g, ' ').trim();
  return plain ? plain.split(' ').length : 0;
}

// Every entry: cross-reference link inside a sentence, as its exact verbatim substring (opening
// tag through closing </a>, attributes and all). Used two ways: fed into the prompt so Claude
// knows exactly what to preserve untouched, and checked against the response afterward — see
// linksPreserved() below. Plain paragraphs without any link return an empty array, same as before.
function extractEntryLinks(text){
  const re = /<a\b[^>]*href\s*=\s*["']entry:[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  return text.match(re) || [];
}
// A sentence containing a link is no longer skipped outright — it's attempted like any other,
// then checked here: every link extracted from the ORIGINAL sentence must appear byte-for-byte,
// unchanged, somewhere in the REPLACEMENT. If even one doesn't (reworded, dropped, moved into a
// different tag), the whole replacement is rejected and the sentence is left untouched — same
// fail-safe instinct as hasBalancedTags, just verified after the call instead of guessed at
// before it. This is what recovers the sentences a blanket "paragraph has a link, skip it
// entirely" used to give up on without even trying.
function linksPreserved(originalLinks, replacement){
  return originalLinks.every(link => replacement.includes(link));
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

function buildPrompt(sentence, paragraph, links){
  const lines = [
    'You are reworking one over-length sentence in a Catholic saints-and-history article so it reads well aloud \u2014 the article is narrated as audio.',
    '',
    'Rules:',
    '- Split it into two or three sentences, each targeting 15\u201325 words; 35 is an acceptable rare stretch; never exceed 40 words in any resulting sentence.',
    '- Preserve the exact meaning and every fact \u2014 add nothing, remove nothing.',
    '- Preserve certainty-tier wording exactly as written (e.g. "tradition holds\u2026", "may have\u2026", "Scripture states\u2026") \u2014 never make a qualified claim read as more certain, or a certain claim read as hedged.',
    '- If the original sentence contains inline HTML tags (<b>, <i>, <u>, <blockquote>), preserve them, applied to the same words, across the rewritten sentences.'
  ];
  if(links && links.length){
    lines.push(
      '- This sentence contains ' + (links.length === 1 ? 'a cross-reference link' : links.length + ' cross-reference links') +
      ' that must be copied into your answer EXACTLY as shown below, character for character \u2014 same tag, same attributes, same visible text inside it, applied to the same words it currently marks. Do not reword, paraphrase, shorten, or move the text inside the link:'
    );
    links.forEach(link => lines.push('  ' + link));
  }
  lines.push(
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
  );
  return lines.join('\n');
}

// A crude but useful signal for the classic LLM degenerate-repetition failure mode: the same
// substantial chunk of text appearing more than once. Not a general repetition detector — just
// specific enough to flag "got stuck re-generating the same phrase," the leading suspect for why
// a task that should produce ~150 words ever gets anywhere near a 700+ token ceiling.
function looksRepetitive(text){
  const chunk = text.slice(0, 40);
  if(chunk.length < 40) return false;
  const re = new RegExp(chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return (text.match(re) || []).length >= 2;
}

// A properly finished rewording should end in real sentence-ending punctuation (allowing a
// trailing closing quote/paren after it). Anything else means the text was cut off before it
// finished, whatever the cause — this is a backstop that catches truncation even if stop_reason
// somehow doesn't flag it, not a replacement for that check.
function looksComplete(text){
  return /[.!?][)"'\u201D]*$/.test(text.trim());
}

// One "single attempt" function per provider — same signature (sentence, paragraph, links,
// maxTokens, apiKey), same return shape ({text, truncated}), same thrown-error shape (a plain
// Error, with .retryable set false only for a definite non-transient 4xx). The retry loop below
// is entirely provider-agnostic as a result — it doesn't know or care which one it's calling.
const PROVIDERS = {
  anthropic: {
    label: 'Claude',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    async call(sentence, paragraph, links, maxTokens, apiKey){
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: buildPrompt(sentence, paragraph, links) }]
        })
      });
      if(!res.ok){
        const errText = await res.text().catch(() => '');
        const err = new Error('Anthropic messages ' + res.status + ': ' + errText.slice(0, 300));
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      const data = await res.json();
      const text = (data.content || []).map(b => b.text || '').join('').trim();
      return { text, truncated: data.stop_reason === 'max_tokens' };
    }
  },
  openai: {
    label: 'GPT-5.6 Luna',
    apiKeyEnv: 'OPENAI_API_KEY',
    async call(sentence, paragraph, links, maxTokens, apiKey){
      const res = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: buildPrompt(sentence, paragraph, links),
          max_output_tokens: maxTokens,
          // 'none', not 'low' — a real failure on St. Francis of Assisi showed only 194 output
          // characters against a full 2000-token budget, which 'low' reasoning can't explain by
          // itself: that's nowhere near enough visible text to exhaust a budget that size on its
          // own, meaning something invisible (reasoning tokens, sharing this same budget) was
          // consuming nearly all of it first. A mechanical split-this-sentence task has no real
          // use for reasoning at any level — 'none' should leave the full budget available for
          // the actual answer instead of an unpredictable amount of it.
          reasoning: { effort: 'none' }
        })
      });
      if(!res.ok){
        const errText = await res.text().catch(() => '');
        const err = new Error('OpenAI responses ' + res.status + ': ' + errText.slice(0, 300));
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      const data = await res.json();
      const msgItem = (data.output || []).find(o => o.type === 'message');
      const textBlock = msgItem && (msgItem.content || []).find(c => c.type === 'output_text');
      const text = ((textBlock && textBlock.text) || '').trim();
      // Best-effort truncation signal, per OpenAI's documented incomplete-response shape — this
      // is a secondary check regardless: looksComplete() below is the real backstop, exactly as
      // it already is for Claude, so getting this exactly right isn't load-bearing on its own.
      const truncated = data.status === 'incomplete' ||
        (data.incomplete_details && data.incomplete_details.reason === 'max_output_tokens') ||
        (msgItem && msgItem.status && msgItem.status !== 'completed');
      return { text, truncated };
    }
  }
};

// Retries a transient failure (server error, rate limit, OR a truncated response) up to twice
// before giving up, with a short backoff — one bad call in a sequence of a dozen or more no
// longer costs a sentence its fix. Does NOT retry a 4xx that isn't a rate limit (bad request, bad
// key), since that would just fail the same way three times and waste the attempts.
//
// Truncation specifically: a dangling sentence fragment ("Pope Gelasius I, writing in" — nothing
// after it) reported in review meant a cut-off response was being accepted as if it were a
// finished one. Two checks guard against that — the provider's own truncation signal (the direct,
// mechanical signal a length cap was hit) and looksComplete() above (a backstop that catches an
// incomplete-looking reply regardless of why it's incomplete, and regardless of provider). What
// real runs then showed: a token-limit cutoff is usually deterministic, not transient — retrying
// with the exact same budget hits the exact same wall every time (three real, billed generations,
// three identical failures, zero chance of a different outcome). TOKEN_BUDGETS escalates the
// budget on each retry instead of repeating it, so a retry actually has room to finish where the
// first attempt didn't.
const TOKEN_BUDGETS = [700, 1200, 2000];
async function rewordSentence(sentence, paragraph, links, provider, apiKey){
  const p = PROVIDERS[provider] || PROVIDERS.anthropic;
  let lastErr;
  for(let attempt = 0; attempt < 3; attempt++){
    try{
      const { text, truncated } = await p.call(sentence, paragraph, links, TOKEN_BUDGETS[attempt], apiKey);
      if(truncated){
        const repetitive = looksRepetitive(text);
        lastErr = new Error(p.label + ' response hit its token limit before finishing (budget ' + TOKEN_BUDGETS[attempt] +
          ', generated ' + text.length + ' chars' + (repetitive ? ', looks like a repetition loop' : '') +
          ') \u2014 end of what it generated: "\u2026' + text.slice(-200) + '"');
      }else if(!text){
        lastErr = new Error(p.label + ' returned an empty response');
      }else if(!looksComplete(text)){
        lastErr = new Error(p.label + ' response looks cut off (doesn\u2019t end in sentence-ending punctuation): "' + text.slice(-60) + '"');
      }else{
        return text;
      }
    }catch(err){
      if(err && err.retryable === false){ lastErr = err; break; } // not transient — retrying won't help
      lastErr = err; // network blip or a retryable HTTP status — same backoff-and-retry as a truncation
    }
    if(attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s, then 2s
  }
  throw lastErr;
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */
export async function runSentenceReword(task, dataJson){
  const provider = (task.payload && task.payload.provider === 'openai') ? 'openai' : 'anthropic';
  const providerInfo = PROVIDERS[provider];
  const apiKey = process.env[providerInfo.apiKeyEnv];
  if(!apiKey) throw new Error('Missing ' + providerInfo.apiKeyEnv + ' secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

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
  let found = 0, reworded = 0, skippedTagMismatch = 0, apiErrors = 0, linkNotPreserved = 0;
  const apiErrorSamples = []; // first few actual error messages — surfaced in the review, not just a bare count

  for(let si = 0; si < sections.length; si++){
    const body = String(sections[si].b || '');
    const paragraphs = body.split('\n\n');
    let paraOffset = 0;

    for(const para of paragraphs){
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
              const links = extractEntryLinks(sentence);
              let replacement = null;
              // A small gap between consecutive calls, not just the retry backoff within one
              // sentence's own attempts — an article with many long sentences was firing every
              // call back-to-back with zero spacing, which a rate limit doesn't forgive just
              // because each individual call retries; if the account's per-minute limit is
              // still open on the NEXT sentence, that one fails too, cascading into exactly the
              // kind of high failure count this was built to prevent.
              if(found > 1) await new Promise(r => setTimeout(r, 400));
              try{
                replacement = await rewordSentence(sentence, para, links, provider, apiKey);
              }catch(apiErr){
                // One bad call doesn't stop the rest of this entity's sentences — reported in
                // the summary; a rerun of this same task will simply retry whatever's left,
                // since nothing about this task's own state is affected by a per-sentence miss.
                // The actual message is what was missing before: this used to just increment a
                // counter and throw the real reason away, leaving "a repeated API error" as the
                // only thing anyone could see — logged here (shows in the Action's own run log)
                // and sampled below (shows in the app itself, in the review's own note).
                const msg = String((apiErr && apiErr.message) || apiErr);
                console.error('Reword failed for "' + sentence.slice(0, 60) + '...": ' + msg);
                if(apiErrorSamples.length < 3) apiErrorSamples.push(msg.slice(0, 400));
                apiErrors++;
              }
              if(replacement && links.length && !linksPreserved(links, replacement)){
                // Asked Claude to preserve the link verbatim and it didn't (reworded, dropped, or
                // moved it) — don't risk a broken or mismatched cross-reference. The sentence is
                // left exactly as it was, same outcome as the old paragraph-level skip, just
                // arrived at after actually trying rather than never attempting it at all.
                linkNotPreserved++;
              }else if(replacement && replacement !== sentence){
                reworded++;
                const element = occurrence > 1 ? sentence + '@' + occurrence : sentence;
                patches.push(['article', element, 'U', replacement]);
              }
            }
          }
        }
      }
      paraOffset += para.length + 2; // '\n\n' separator
    }
    sectionOffset += body.length + 1; // '\u0000' separator
  }

  const summary = (found === 0)
    ? 'no sentences over ' + MAX_SENTENCE_WORDS + ' words found \u2014 nothing queued for review'
    : reworded + ' of ' + found + ' long sentence(s) reworded via ' + providerInfo.label + ' and queued for review' +
      (skippedTagMismatch ? ' \u00b7 ' + skippedTagMismatch + ' skipped (spans a formatting tag)' : '') +
      (apiErrors ? ' \u00b7 ' + apiErrors + ' call(s) failed after retries \u2014 ' + apiErrorSamples.join(' | ') : '') +
      (linkNotPreserved ? ' \u00b7 ' + linkNotPreserved + ' left untouched (contains a cross-reference link that didn\u2019t survive the rewording \u2014 fix by hand)' : '');

  const spawnedTasks = [];
  if(patches.length){
    const nowIso = new Date().toISOString();
    spawnedTasks.push({
      id: 'task-sentence-reword-' + entry.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      type: 'sentence-reword', entityId: entry.id, batchId: null, status: 'proposed',
      description: 'Reword ' + patches.length + ' long sentence' + (patches.length === 1 ? '' : 's') + ' \u2014 ' + entry.n,
      payload: {}, result: { name: entry.n, patches, apiErrors, apiErrorSamples, skippedTagMismatch, linkNotPreserved, provider, providerLabel: providerInfo.label }, error: null, createdAt: nowIso, updatedAt: nowIso
    });
  }

  return {
    result: {
      entityId: entry.id, name: entry.n,
      sentencesFound: found, sentencesReworded: reworded,
      skippedTagMismatch, apiErrors, apiErrorSamples, linkNotPreserved, provider, providerLabel: providerInfo.label
    },
    summary,
    spawnedTasks
  };
}
