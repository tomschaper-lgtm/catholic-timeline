// scripts/services/fact-research.mjs
//
// Service: "fact-research" — answer one flagged question about one entry, independently, several
// ways at once.
//
// Created only by the app's Flag Issue button (category "Facts"), which queues:
//   { type: 'fact-research', entityId, payload: { question, changeType } }
// where changeType is Tom's own pick in the flag modal: 'quickFact' or 'section'.
//
// Each provider in RESEARCHERS gets the SAME job — the article as JSON, the question, the change
// type — does its own research, and answers in one fixed JSON shape. No judge, no voting, no
// revision rounds (this deliberately replaces the earlier propose/verify debate design): every
// usable answer becomes one candidate, and Tom picks one (or Edits it) on the Fact Research review
// screen. Several models landing on the same answer independently is the signal; the app never
// auto-applies anything, and this service never touches data.json — candidates live only in the
// task's result in workLog.json until Tom approves one in the app.
//
// Candidate shape (what the app's tkFactCandidateToPatch / tkRenderFactResearchReview read):
//   {
//     model: 'claude' | 'openai' | 'google',   // key the app maps to Claude / Luna / Gemini
//     modelId: 'gpt-5.6-luna', ...              // the exact model string, for the record
//     changeType: 'quickFact' | 'section',
//     quickFact: { mode: 'add' | 'update', label, value },                   // quickFact only
//     section:   { mode: 'swap' | 'insert', heading, body, position },       // section only
//                //   swap: section #position (1-based) is replaced — heading AND body
//                //   insert: new section lands AT slot #position; the rest shift down one
//     sourceUrl, sourceNote,
//     method: 'search' | 'memory'
//   }
// A provider that couldn't find a supportable answer returns found:false — that's recorded in
// result.misses (shown on the review screen), never turned into a candidate.
//
// SWAPPING MODELS: edit RESEARCHERS below — add/remove an entry or bump a .modelId. The app
// renders however many candidates come back.
//
// Requires ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY as repo secrets AND passed through as
// env vars in orchestrator.yml. A missing key just drops that one researcher (recorded as a miss),
// it doesn't fail the task.

// ---------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a careful research assistant for "Catholic Timeline", a reference site on the history of the Catholic Church written from a faithful Catholic perspective.

You will receive JSON with: the entry's name and year, the full article (numbered sections, plus Quick Facts), the owner's QUESTION about something the article is missing or may have wrong, and the CHANGE TYPE the owner wants the answer delivered as.

Your job:
1. Research the question. Prefer, in order: New Advent's Catholic Encyclopedia (newadvent.org), vatican.va and other magisterial sources, the Roman Martyrology, then reputable scholarly or Catholic reference works. Avoid wikis, forums, and devotional sites that don't cite sources.
2. Be precise with dates, places, and titles. Where sources disagree or the account is traditional rather than documented, say so in the wording itself ("According to tradition...", "c. 1024").
3. Deliver ONE answer, in exactly the requested change type, matching the article's existing voice and style.
4. If you cannot find an answer you can stand behind, say so (found: false). Do not guess.

Change type rules:
- "quickFact": a short label/value row for the Quick Facts table. Label is 1-3 words in the style of the existing labels (e.g. "Died", "Ordained", "Canonized"). Value is brief ("Martyred by hanging, 1024, Rome"). Use mode "update" ONLY if a fact with that exact label already exists and you are correcting it; otherwise mode "add".
- "section": either "swap" (rewrite an existing section in full — heading and body — to incorporate the answer; position = that section's number) or "insert" (a new section; position = the slot number it should occupy, e.g. 3 means it becomes the third section and the rest shift down). Body is plain prose, paragraphs separated by a blank line (\\n\\n), no markdown, no HTML. Keep a swapped section close to its original length and content apart from the addition; a new section is 1-2 short paragraphs.

Respond with ONLY a JSON object, no preamble, no code fences:
{
  "found": true,
  "changeType": "quickFact" | "section",
  "quickFact": { "mode": "add" | "update", "label": "...", "value": "..." },
  "section": { "mode": "swap" | "insert", "heading": "...", "body": "...", "position": 3 },
  "sourceUrl": "https://... (the single best source you actually used; empty string if none)",
  "sourceNote": "1-2 sentences: where you found this and anything uncertain about it",
  "method": "search" | "memory"
}
Include only the object ("quickFact" or "section") that matches the requested change type. Set "method" to "search" only if you actually consulted live web results this time; "memory" if you answered from prior knowledge. If you cannot answer: { "found": false, "sourceNote": "why not" }.`;

// ---------------------------------------------------------------------------------------------
// Providers — same endpoints/auth as arbitrate.mjs, each with web search turned on where the
// agreed design calls for it. Each returns { text, truncated, tokensUsed }.
// ---------------------------------------------------------------------------------------------

async function callAnthropic(systemPrompt, userInput, maxTokens, apiKey, model, search){
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userInput }]
  };
  if(search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    const err = new Error('Anthropic messages ' + res.status + ': ' + errText.slice(0, 300));
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  const data = await res.json();
  // With search on, the answer can arrive split across several text blocks between tool calls —
  // join them all; extractJson below pulls the object out of whatever surrounds it.
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n').trim();
  const truncated = data.stop_reason === 'max_tokens';
  const tokensUsed = ((data.usage && data.usage.input_tokens) || 0) + ((data.usage && data.usage.output_tokens) || 0);
  return { text, truncated, tokensUsed };
}

async function callOpenAI(systemPrompt, userInput, maxTokens, apiKey, model, search){
  const body = {
    model,
    instructions: systemPrompt,
    input: userInput,
    max_output_tokens: maxTokens,
    reasoning: { effort: 'low' }
  };
  if(search) body.tools = [{ type: 'web_search' }];
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    const err = new Error('OpenAI responses ' + res.status + ': ' + errText.slice(0, 300));
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  const data = await res.json();
  const text = (data.output || [])
    .filter(o => o.type === 'message')
    .flatMap(o => (o.content || []).filter(c => c.type === 'output_text').map(c => c.text || ''))
    .join('\n').trim();
  const truncated = data.status === 'incomplete' ||
    (data.incomplete_details && data.incomplete_details.reason === 'max_output_tokens');
  const tokensUsed = (data.usage && data.usage.total_tokens) || 0;
  return { text, truncated, tokensUsed };
}

// Google Search grounding can't be combined with responseMimeType 'application/json' (arbitrate's
// setting), so with search on this asks for JSON in the prompt only and extracts it from the text.
async function callGoogle(systemPrompt, userInput, maxTokens, apiKey, model, search){
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userInput }] }],
    generationConfig: { maxOutputTokens: maxTokens }
  };
  if(search) body.tools = [{ google_search: {} }];
  else body.generationConfig.responseMimeType = 'application/json';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    const err = new Error('Gemini generateContent ' + res.status + ': ' + errText.slice(0, 300));
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  const data = await res.json();
  const cand = (data.candidates || [])[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map(p => p.text || '').join('').trim();
  const truncated = cand && cand.finishReason === 'MAX_TOKENS';
  const tokensUsed = (data.usageMetadata && data.usageMetadata.totalTokenCount) || 0;
  return { text, truncated, tokensUsed };
}

// `key` is what the app's review screen maps to a display name (claude → Claude, openai → Luna,
// google → Gemini). `search: false` for Claude matches the agreed design (it answers from memory
// and says so via method:"memory"); flip it to true to give Claude live web search too.
const RESEARCHERS = [
  { key: 'claude', name: 'anthropic', modelId: 'claude-sonnet-4-6',     keyEnv: 'ANTHROPIC_API_KEY', call: callAnthropic, search: false },
  { key: 'openai', name: 'openai',    modelId: 'gpt-5.6-luna',          keyEnv: 'OPENAI_API_KEY',    call: callOpenAI,    search: true },
  { key: 'google', name: 'google',    modelId: 'gemini-3.5-flash-lite', keyEnv: 'GEMINI_API_KEY',    call: callGoogle,    search: true }
];

// Search-backed answers run longer than arbitrate's plain proofreads (tool-call chatter counts
// against the budget on some providers), so budgets start higher.
const TOKEN_BUDGETS = [4000, 8000, 12000];

// ---------------------------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------------------------

// Pulls the JSON object out of a response that may carry prose or code fences around it
// (common once search is on — some providers narrate before answering).
function extractJson(raw){
  const s = String(raw || '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if(start === -1 || end <= start) throw new Error('no JSON object in response');
  return JSON.parse(s.slice(start, end + 1));
}

function str(v){ return typeof v === 'string' ? v.trim() : ''; }

// Returns { candidate } for a usable answer, { miss } for found:false, or throws on a malformed
// one. Anything that doesn't match the change type Tom asked for is rejected rather than
// "fixed up" — a candidate the review screen can't preview faithfully is worse than none.
function normalizeAnswer(parsed, researcher, changeType, sectionCount){
  if(parsed && parsed.found === false){
    return { miss: { model: researcher.key, modelId: researcher.modelId, note: str(parsed.sourceNote) || 'No supportable answer found.' } };
  }
  const base = {
    model: researcher.key,
    modelId: researcher.modelId,
    changeType,
    sourceUrl: str(parsed.sourceUrl),
    sourceNote: str(parsed.sourceNote),
    method: parsed.method === 'search' ? 'search' : 'memory'
  };
  // A model that claims "search" without search tools enabled is corrected to "memory" — the
  // review screen's Searched/From memory badge must be honest.
  if(!researcher.search) base.method = 'memory';

  if(changeType === 'quickFact'){
    const qf = parsed.quickFact || {};
    const label = str(qf.label), value = str(qf.value);
    if(!label || !value) throw new Error('quickFact missing label or value');
    return { candidate: Object.assign(base, { quickFact: { mode: qf.mode === 'update' ? 'update' : 'add', label, value } }) };
  }
  const sec = parsed.section || {};
  const heading = str(sec.heading), body = str(sec.body);
  const mode = sec.mode === 'insert' ? 'insert' : sec.mode === 'swap' ? 'swap' : '';
  let position = parseInt(sec.position, 10);
  if(!mode) throw new Error('section.mode must be swap or insert');
  if(!heading || !body) throw new Error('section missing heading or body');
  if(!(position >= 1)) throw new Error('section.position must be a positive integer');
  // Clamp rather than reject: swap can't target past the last section; insert can land at most
  // one past it (= append).
  position = Math.min(position, mode === 'swap' ? Math.max(1, sectionCount) : sectionCount + 1);
  return { candidate: Object.assign(base, { section: { mode, heading, body: stripHtml(body), position } }) };
}

function stripHtml(s){
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Escalating-budget retry, same philosophy as arbitrate.mjs's callWithRetry, but succeeds on
// "contains a parseable JSON object" rather than "is pure JSON", since search responses can wrap
// the object in prose.
async function researchWithRetry(researcher, userInput){
  const apiKey = process.env[researcher.keyEnv];
  if(!apiKey){ const e = new Error('Missing ' + researcher.keyEnv + ' secret.'); e.tokensUsed = 0; throw e; }
  let lastErr, totalTokens = 0;
  for(let attempt = 0; attempt < TOKEN_BUDGETS.length; attempt++){
    try{
      const { text, truncated, tokensUsed } = await researcher.call(SYSTEM_PROMPT, userInput, TOKEN_BUDGETS[attempt], apiKey, researcher.modelId, researcher.search);
      totalTokens += tokensUsed;
      if(truncated) lastErr = new Error(researcher.name + ' hit its token limit (budget ' + TOKEN_BUDGETS[attempt] + ')');
      else if(!text) lastErr = new Error(researcher.name + ' returned no output text.');
      else{
        try{ return { parsed: extractJson(text), tokensUsed: totalTokens }; }
        catch(parseErr){ lastErr = new Error(researcher.name + ' response did not contain valid JSON: ' + text.slice(0, 300)); }
      }
    }catch(err){
      lastErr = err;
      if(err && err.retryable === false) break;
    }
    if(attempt < TOKEN_BUDGETS.length - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  lastErr.tokensUsed = totalTokens;
  throw lastErr;
}

// The article as the models see it: numbered sections (position matters — it's how a section
// answer says where it goes), plain text, plus Quick Facts. Links/emphasis stripped, same
// reasoning as arbitrate's buildArticleText.
function buildInput(entry, question, changeType){
  const sections = ((entry.art && entry.art.sections) || []).map((s, i) => ({
    position: i + 1,
    heading: str(s.h),
    body: stripHtml(s.b)
  }));
  return JSON.stringify({
    entry: { name: entry.n, year: entry.y },
    question,
    changeType,
    article: {
      sections,
      quickFacts: (entry.facts || []).map(f => ({ label: str(f.label), value: str(f.value) }))
    }
  }, null, 2);
}

// ---------------------------------------------------------------------------------------------
// Handler — signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
// ---------------------------------------------------------------------------------------------

export async function runFactResearch(task, dataJson){
  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry) return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };

  const payload = task.payload || {};
  const question = str(payload.question);
  const changeType = payload.changeType === 'section' ? 'section' : 'quickFact';
  if(!question) return { result: null, summary: 'skipped \u2014 no question in the task payload' };

  const sectionCount = ((entry.art && entry.art.sections) || []).length;
  if(changeType === 'section' && !sectionCount){
    return { result: null, summary: 'skipped \u2014 ' + entry.n + ' has no article sections to add to yet' };
  }

  const userInput = buildInput(entry, question, changeType);

  // Independent by design — all researchers run concurrently, none sees another's answer.
  const settled = await Promise.allSettled(RESEARCHERS.map(r => researchWithRetry(r, userInput)));

  const candidates = [];
  const misses = [];
  let tokensUsed = 0;
  settled.forEach((s, i) => {
    const r = RESEARCHERS[i];
    if(s.status === 'rejected'){
      tokensUsed += (s.reason && s.reason.tokensUsed) || 0;
      misses.push({ model: r.key, modelId: r.modelId, note: 'Failed: ' + String((s.reason && s.reason.message) || s.reason).slice(0, 300) });
      return;
    }
    tokensUsed += s.value.tokensUsed || 0;
    try{
      const out = normalizeAnswer(s.value.parsed, r, changeType, sectionCount);
      if(out.candidate) candidates.push(out.candidate);
      else misses.push(out.miss);
    }catch(err){
      misses.push({ model: r.key, modelId: r.modelId, note: 'Unusable answer: ' + err.message });
    }
  });

  const result = {
    name: entry.n,
    question,
    changeType,
    candidates,
    misses,
    models: RESEARCHERS.map(r => r.modelId)
  };

  // Nothing at all to choose from: finish as done (not awaiting_review — there's no decision to
  // make), with the misses recorded so Tom can see why in the task list.
  if(!candidates.length){
    return {
      awaitingReview: false,
      result,
      summary: 'No researcher found a supportable answer \u2014 ' + misses.map(m => m.model + ': ' + m.note).join(' | ').slice(0, 400),
      provider: RESEARCHERS.map(r => r.name).join('+'),
      tokensUsed
    };
  }

  return {
    awaitingReview: true,
    result,
    summary: candidates.length + ' of ' + RESEARCHERS.length + ' researchers answered \u2014 ready to pick',
    provider: RESEARCHERS.map(r => r.name).join('+'),
    tokensUsed
    // No filesToCommit / dataDirty: candidates live in workLog.json only; data.json changes only
    // when Tom approves one in the app.
  };
}
