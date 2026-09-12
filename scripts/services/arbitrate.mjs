// scripts/services/arbitrate.mjs
//
// Service: "arbitrate" — the three-way debate pipeline.
//
// One task = one entity. Claude already wrote the article (that's just what's in data.json —
// this service never calls Claude to "defend" it, by design). Runs the SAME propose-then-judge
// cycle twice, with roles swapped, against the two providers in PAIR below:
//
//   Pass A: PAIR[0] fact-checks the article and proposes fixes; PAIR[1] judges each one.
//   Pass B: PAIR[1] fact-checks the SAME original article independently; PAIR[0] judges those.
//
// Two independent proposers means two independent sets of eyes on the article, not one
// fact-checker plus one pure referee — the whole point of running it both directions. Both
// passes read the same untouched article (neither depends on the other's output, and nothing
// is ever applied automatically), so they run concurrently via Promise.all rather than one
// after another. A pass whose proposer finds nothing (verdict: "pass") skips its judge call
// entirely — no point spending a second API call arbitrating an empty list — so a clean article
// can cost as little as two calls total, not necessarily four.
//
// Only a proposal its judge actually sided with becomes a "debate" bundled into the one review
// task for this entity — a proposal where the judge upheld the original resolves silently,
// same "only surface an actual decision" rule the app's other review screens all follow. A task
// can end up with debates from both directions mixed together; each debate carries its own
// proposedBy/arbitratedBy model names (not a single task-wide pair) since which one played which
// role flips between debates within the same task.
//
// Known behavior, not yet handled: if both directions independently flag the same underlying
// issue, it can surface as two separate debate cards rather than one merged one. Not deduplicated
// here — add it later if that turns out to be annoying in practice, rather than build fuzzy
// text-matching across passes speculatively now.
//
// SWAPPING MODELS AS PRICES CHANGE: everything runs off the two-provider PAIR array below — one
// swap point, not two roles that could drift out of sync. Change which two entries are in PAIR
// (or edit a provider's own .model string to bump versions within a company) and both directions
// automatically use whatever's there.
//
// Requires OPENAI_API_KEY (already in your repo) and GEMINI_API_KEY (new — add it under repo
// Settings → Secrets → Actions, and to orchestrator.yml). ANTHROPIC_API_KEY is wired in below
// too, unused by PAIR's current two entries, but ready the moment either slot points at Claude.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Reuses the shared fact-check methodology doc for the proposer role's base instructions — see
// arbitrate-factcheck-skill.md's own header for why it isn't called "proofreader-skill.md"
// anymore (the standalone proofread service it was originally written for is retired).
const PROPOSE_SYSTEM_PROMPT =
  readFileSync(join(__dirname, 'arbitrate-factcheck-skill.md'), 'utf8') + '\n\n---\n\n' +
  readFileSync(join(__dirname, 'arbitrate-propose-appendix.md'), 'utf8');
const JUDGE_SYSTEM_PROMPT = readFileSync(join(__dirname, 'arbitrate-judge-skill.md'), 'utf8');

// ---------------------------------------------------------------------------------------------
// Providers. Each has a consistent call(systemPrompt, userInput, maxTokens, apiKey, model) shape
// returning { text, truncated, tokensUsed } — see callWithRetry below for how these get used.
// Any provider here can play either role (proposer or arbitrator) — see PAIR below.
// ---------------------------------------------------------------------------------------------

async function callAnthropic(systemPrompt, userInput, maxTokens, apiKey, model){
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userInput }]
    })
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    const err = new Error('Anthropic messages ' + res.status + ': ' + errText.slice(0, 300));
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  const data = await res.json();
  const textBlock = (data.content || []).find(c => c.type === 'text');
  const text = ((textBlock && textBlock.text) || '').trim();
  const truncated = data.stop_reason === 'max_tokens';
  const tokensUsed = ((data.usage && data.usage.input_tokens) || 0) + ((data.usage && data.usage.output_tokens) || 0);
  return { text, truncated, tokensUsed };
}

// Same endpoint/shape as the real scripts/services/sentence-reword.mjs's OpenAI path.
async function callOpenAI(systemPrompt, userInput, maxTokens, apiKey, model){
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: userInput,
      max_output_tokens: maxTokens,
      reasoning: { effort: 'low' } // a judgment task either way this plays, not mechanical
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
  const truncated = data.status === 'incomplete' ||
    (data.incomplete_details && data.incomplete_details.reason === 'max_output_tokens');
  const tokensUsed = (data.usage && data.usage.total_tokens) || 0;
  return { text, truncated, tokensUsed };
}

// Gemini 3.5 Flash-Lite's generateContent endpoint. Thinking is off by default for this model
// (cheap/fast is the whole point of the "Lite" tier) — left unset here rather than requesting a
// thinking level, matching that default rather than paying for reasoning either role needs here.
async function callGoogle(systemPrompt, userInput, maxTokens, apiKey, model){
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userInput }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json'
      }
    })
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

const PROVIDERS = {
  anthropic: { name: 'anthropic', model: 'claude-sonnet-4-6', keyEnv: 'ANTHROPIC_API_KEY', call: callAnthropic },
  openai:    { name: 'openai',    model: 'gpt-5.6-luna',      keyEnv: 'OPENAI_API_KEY',    call: callOpenAI },
  google:    { name: 'google',    model: 'gemini-3.5-flash-lite', keyEnv: 'GEMINI_API_KEY', call: callGoogle }
};
// THE swap point. Both directions (each proposes while the other arbitrates) are derived from
// this one array — see runArbitrate below. Change which two entries are listed here to change
// which two companies debate each other; edit a provider's own .model string above to bump
// versions within the same company.
const PAIR = [PROVIDERS.openai, PROVIDERS.google];

const TOKEN_BUDGETS = [3000, 5000, 8000];
const ALLOWED_SEVERITIES = new Set(['ERROR', 'VERIFY', 'JUDGMENT']);
const ALLOWED_CATEGORIES = new Set([
  'FACT', 'DATE/CHRONOLOGY', 'QUOTE', 'TRADITION/LEGEND', 'CATHOLIC TEACHING',
  'SCRIPTURE', 'TERMINOLOGY', 'JUDGMENT/TONE', 'INTERNAL CONSISTENCY', 'MEANING/CLARITY'
]);
const ALLOWED_KINDS = new Set(['article', 'facts', 'quotes']);

function stripFence(raw){
  return String(raw || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}

// Generic escalating-budget retry, same philosophy as sentence-reword.mjs: a
// length cutoff is usually deterministic, so retrying at a bigger budget beats repeating the
// same one. Works identically for any of the three providers above, in either role.
async function callWithRetry(provider, systemPrompt, userInput){
  const apiKey = process.env[provider.keyEnv];
  if(!apiKey) throw new Error('Missing ' + provider.keyEnv + ' secret.');
  let lastErr, totalTokens = 0;
  for(let attempt = 0; attempt < TOKEN_BUDGETS.length; attempt++){
    try{
      const { text, truncated, tokensUsed } = await provider.call(systemPrompt, userInput, TOKEN_BUDGETS[attempt], apiKey, provider.model);
      totalTokens += tokensUsed;
      if(truncated){
        lastErr = new Error(provider.name + ' hit its token limit (budget ' + TOKEN_BUDGETS[attempt] + ')');
      }else if(!text){
        lastErr = new Error(provider.name + ' returned no output text.');
      }else{
        try{
          JSON.parse(stripFence(text));
          return { text, tokensUsed: totalTokens };
        }catch(parseErr){
          lastErr = new Error(provider.name + ' response doesn\u2019t parse as JSON, likely cut off.');
        }
      }
    }catch(err){
      if(err && err.retryable === false){ lastErr = err; break; }
      lastErr = err;
    }
    if(attempt < TOKEN_BUDGETS.length - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  lastErr.tokensUsed = totalTokens;
  throw lastErr;
}

// Same HTML-stripping/section-building approach the (now-retired) standalone proofread service
// used. Same behavior: strip the allowed tag set to plain text preserving paragraph/list breaks,
// append Quoted Sources and Quick Facts as numbered pseudo-sections — see
// arbitrate-factcheck-skill.md Part 0 for the full rationale.
function stripHtmlForReview(html){
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\u2022 ')
    .replace(/<a\s+[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function buildArticleText(entry){
  const sections = (entry.art && entry.art.sections) || [];
  const parts = sections.map(sec => '## ' + (sec.h || '').trim() + '\n\n' + stripHtmlForReview(sec.b));
  const quotes = (entry.art && entry.art.quotes) || [];
  if(quotes.length){
    const lines = quotes.map((q, i) => (i + 1) + '. "' + (q.text || '').trim() + '" \u2014 ' + (q.source || '').trim());
    parts.push('## Quoted Sources\n\n' + lines.join('\n'));
  }
  const facts = entry.facts || [];
  if(facts.length){
    const lines = facts.map((f, i) => (i + 1) + '. ' + (f.label || '').trim() + ': ' + (f.value || '').trim());
    parts.push('## Quick Facts\n\n' + lines.join('\n'));
  }
  return parts.join('\n\n');
}

function parseProposalJson(raw){
  const parsed = JSON.parse(stripFence(raw));
  if(parsed.verdict !== 'pass' && parsed.verdict !== 'findings'){
    throw new Error('Unexpected verdict value: ' + JSON.stringify(parsed.verdict));
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  findings.forEach((f, i) => {
    if(!ALLOWED_SEVERITIES.has(f.severity)) throw new Error('Finding ' + i + ': bad severity ' + JSON.stringify(f.severity));
    if(!ALLOWED_CATEGORIES.has(f.category)) throw new Error('Finding ' + i + ': bad category ' + JSON.stringify(f.category));
    if(!ALLOWED_KINDS.has(f.kind)) throw new Error('Finding ' + i + ': bad kind ' + JSON.stringify(f.kind));
    if(typeof f.before !== 'string' || typeof f.after !== 'string') throw new Error('Finding ' + i + ': missing before/after');
  });
  return { verdict: parsed.verdict, findings };
}

function parseVerdictsJson(raw, expectedCount){
  const parsed = JSON.parse(stripFence(raw));
  if(!Array.isArray(parsed) || parsed.length !== expectedCount){
    throw new Error('Expected ' + expectedCount + ' verdict(s), got ' + (Array.isArray(parsed) ? parsed.length : typeof parsed));
  }
  parsed.forEach((v, i) => {
    if(v.winner !== 'original' && v.winner !== 'revised') throw new Error('Verdict ' + i + ': bad winner ' + JSON.stringify(v.winner));
  });
  return parsed;
}

// One full propose-then-judge cycle in one direction. Returns only the debates the judge sided
// with the revision on, each carrying its own proposedBy/arbitratedBy — never a task-wide pair,
// since a task can bundle debates from both directions.
async function runDebatePass(proposer, arbitrator, articleText){
  const { text: proposeRaw, tokensUsed: proposeTokens } =
    await callWithRetry(proposer, PROPOSE_SYSTEM_PROMPT, '<ARTICLE>\n' + articleText + '\n</ARTICLE>');
  let proposed;
  try{
    proposed = parseProposalJson(proposeRaw);
  }catch(err){
    throw new Error(proposer.name + ' response failed validation: ' + err.message + '\n\nRaw response:\n' + proposeRaw.slice(0, 1500));
  }

  if(proposed.verdict !== 'findings' || !proposed.findings.length){
    // Nothing to arbitrate \u2014 skip the judge call entirely rather than spend a second API call
    // on an empty list.
    return { debates: [], tokensUsed: proposeTokens, proposedCount: 0 };
  }

  const judgeInput = JSON.stringify(proposed.findings.map((f, i) => ({
    index: i, section: f.section, sentence: f.sentence, category: f.category, severity: f.severity,
    before: f.before, after: f.after, concern: f.concern
  })));
  const { text: judgeRaw, tokensUsed: judgeTokens } = await callWithRetry(arbitrator, JUDGE_SYSTEM_PROMPT, judgeInput);
  let verdicts;
  try{
    verdicts = parseVerdictsJson(judgeRaw, proposed.findings.length);
  }catch(err){
    throw new Error(arbitrator.name + ' response failed validation: ' + err.message + '\n\nRaw response:\n' + judgeRaw.slice(0, 1500));
  }

  const debates = proposed.findings
    .map((f, i) => Object.assign({}, f, {
      winner: verdicts[i].winner,
      comment: verdicts[i].comment || '',
      proposedBy: proposer.model,
      arbitratedBy: arbitrator.model
    }))
    .filter(d => d.winner === 'revised');

  return { debates, tokensUsed: proposeTokens + judgeTokens, proposedCount: proposed.findings.length };
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */
export async function runArbitrate(task, dataJson){
  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry) return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };

  const articleText = buildArticleText(entry);
  if(!articleText.trim()) return { result: null, summary: 'skipped \u2014 ' + entry.n + ' has no article text yet' };

  // Both directions read the same untouched article and don't depend on each other's output, so
  // they run concurrently rather than one after another.
  const [passA, passB] = await Promise.all([
    runDebatePass(PAIR[0], PAIR[1], articleText),
    runDebatePass(PAIR[1], PAIR[0], articleText)
  ]);

  const debates = [...passA.debates, ...passB.debates];
  const tokensUsed = passA.tokensUsed + passB.tokensUsed;
  const totalProposed = passA.proposedCount + passB.proposedCount;

  entry.qc = entry.qc || {};
  entry.qc.proofread = debates.length ? 'findings' : 'pass';
  entry.qc.proofreadAt = new Date().toISOString();
  entry.qc.proofreadModel = PAIR.map(p => p.model).join(' + ');

  return {
    awaitingReview: debates.length > 0,
    result: {
      name: entry.n,
      verdict: debates.length ? 'findings' : 'pass',
      debates,
      models: PAIR.map(p => p.model)
    },
    summary: debates.length
      ? debates.length + ' change(s) won arbitration \u2014 ready to review'
      : (totalProposed
          ? 'PASS after arbitration \u2014 ' + totalProposed + ' flagged across both directions, none held up'
          : 'PASS \u2014 neither direction found anything'),
    provider: PAIR.map(p => p.name).join('+'),
    tokensUsed,
    filesToCommit: ['data.json']
  };
}
