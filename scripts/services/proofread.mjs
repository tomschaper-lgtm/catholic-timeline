// scripts/services/proofread.mjs
//
// New service: "proofread". Sends one entity's article (art.sections + art.quotes + facts) to
// OpenAI for a factual/theological/editorial QC pass, per scripts/services/proofreader-skill.md
// (co-located with this file — read it for what's actually being asked of the model). Returns
// findings for a human to read in the app's Proofread Review screen; never writes to data.json
// and never proposes an edit — this is a report, not a patch. See the companion
// proofread-implementation-plan.md for the orchestrator.mjs registration and the index.html
// front-end pieces this needs (TK_SERVICES entry, batch pool, review renderer).
//
// ⚠ TWO THINGS TO CONFIRM AGAINST YOUR REAL scripts/services/sentence-reword.mjs BEFORE RELYING
// ON THIS IN PRODUCTION — that file wasn't available when this was drafted, so the OpenAI call
// below is written from first principles (verified against OpenAI's public Responses API docs),
// not copied from your existing, already-shaken-out PROVIDERS.openai implementation:
//   1. OPENAI_MODEL below is a placeholder. Copy the exact model id string sentence-reword.mjs
//      already sends for "GPT-5.6 Luna" — don't guess it independently a second time.
//   2. If sentence-reword.mjs already has a shared retry/token-escalation loop (the changelog
//      says it refactored to "one shared retry/token-escalation loop neither provider needs to
//      know about"), this file should call into that instead of the single-attempt version
//      below — worth extracting into scripts/services/lib/ai-providers.mjs now that a second
//      service needs it, rather than maintaining two copies of the same OpenAI-call logic.
// Everything else here (article-text assembly, JSON parsing/validation, the orchestrator
// contract) is self-contained and doesn't depend on that file.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(join(__dirname, 'proofreader-skill.md'), 'utf8');

// TODO: replace with the exact string sentence-reword.mjs uses for GPT-5.6 Luna.
const OPENAI_MODEL = process.env.OPENAI_PROOFREAD_MODEL || 'gpt-5.6-luna';
// Proofreading is a judgment task (weighing sourcing tiers, spotting doctrinal tension, catching
// misattributed quotes) — a meaningfully different job than sentence-reword's mechanical
// rewording, which is why that service ended up at reasoning.effort:'none'. Starting this one at
// 'low' rather than 'none' or matching 'low' by default; watch real output for the same failure
// v354's postmortem found (reasoning tokens quietly eating the visible-answer budget) before
// raising it, and remember reasoning tokens count against max_output_tokens same as here.
const REASONING_EFFORT = process.env.OPENAI_PROOFREAD_EFFORT || 'low';
const MAX_OUTPUT_TOKENS = parseInt(process.env.OPENAI_PROOFREAD_MAX_TOKENS || '4000', 10);

const ALLOWED_SEVERITIES = new Set(['ERROR', 'VERIFY', 'JUDGMENT']);
const ALLOWED_CATEGORIES = new Set([
  'FACT', 'DATE/CHRONOLOGY', 'QUOTE', 'TRADITION/LEGEND', 'CATHOLIC TEACHING',
  'SCRIPTURE', 'TERMINOLOGY', 'JUDGMENT/TONE', 'INTERNAL CONSISTENCY', 'MEANING/CLARITY'
]);

// Strips the same allowed-tag set json-import-skill.md documents for art.sections[].b
// (<b> <i> <u> <ul>/<ol>/<li> <br> <blockquote> <a href="...">) down to plain text, so the
// reviewer sees readable prose instead of markup. A cross-reference link's visible text survives;
// the entry: URL does not — Part 0 of proofreader-skill.md tells the reviewer that's deliberate.
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

// Builds the <ARTICLE> body the system prompt expects: one block per art.sections entry (exact
// heading + stripped body), then, if the entry has quotes, one final "Quoted Sources" block —
// each quote on its own numbered line, matching the numbering rule Part 0 spells out.
function buildArticleText(entry){
  const sections = (entry.art && entry.art.sections) || [];
  const parts = sections.map(sec =>
    '## ' + (sec.h || '').trim() + '\n\n' + stripHtmlForReview(sec.b)
  );
  const quotes = (entry.art && entry.art.quotes) || [];
  if(quotes.length){
    const lines = quotes.map((q, i) => (i + 1) + '. "' + (q.text || '').trim() + '" \u2014 ' + (q.source || '').trim());
    parts.push('## Quoted Sources\n\n' + lines.join('\n'));
  }
  // Quick Facts are real factual claims (dates, patronage, approval status, etc.), not just
  // formatting to check mechanically elsewhere — url is intentionally dropped, only label/value
  // matter to a factual read. See proofreader-skill.md Part 0 for the numbering rule this matches.
  const facts = entry.facts || [];
  if(facts.length){
    const lines = facts.map((f, i) => (i + 1) + '. ' + (f.label || '').trim() + ': ' + (f.value || '').trim());
    parts.push('## Quick Facts\n\n' + lines.join('\n'));
  }
  return parts.join('\n\n');
}

// Pulls the plain-text output out of a Responses API result. Walks the real `output` array
// rather than trusting a top-level `output_text` convenience field, since that's an SDK nicety,
// not something the raw REST response is guaranteed to include.
function extractOutputText(data){
  if(typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const items = Array.isArray(data.output) ? data.output : [];
  for(const item of items){
    if(item.type !== 'message' || !Array.isArray(item.content)) continue;
    const textPart = item.content.find(c => c.type === 'output_text' && typeof c.text === 'string');
    if(textPart) return textPart.text;
  }
  return '';
}

// Defensive JSON parse — strips a markdown fence if the model added one despite being told not
// to, same defensive habit as the artifacts JSON-parsing example. Throws (not returns null) on
// real failure, since a malformed response should surface as an error task, not a silent skip.
function parseFindingsJson(raw){
  const cleaned = String(raw || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if(parsed.verdict !== 'pass' && parsed.verdict !== 'findings'){
    throw new Error('Unexpected verdict value: ' + JSON.stringify(parsed.verdict));
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  findings.forEach((f, i) => {
    if(!ALLOWED_SEVERITIES.has(f.severity)) throw new Error('Finding ' + i + ': bad severity ' + JSON.stringify(f.severity));
    if(!ALLOWED_CATEGORIES.has(f.category)) throw new Error('Finding ' + i + ': bad category ' + JSON.stringify(f.category));
  });
  return { verdict: parsed.verdict, findings };
}

export async function runProofread(task, dataJson){
  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry) throw new Error('No entry found for entityId ' + task.entityId);

  const articleText = buildArticleText(entry);
  if(!articleText.trim()) throw new Error('Entry ' + entry.id + ' has no article text to proofread.');

  const apiKey = process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT,
      input: '<ARTICLE>\n' + articleText + '\n</ARTICLE>',
      reasoning: { effort: REASONING_EFFORT },
      max_output_tokens: MAX_OUTPUT_TOKENS
    })
  });

  if(!resp.ok){
    const bodyText = await resp.text().catch(() => '');
    throw new Error('OpenAI request failed (' + resp.status + '): ' + bodyText.slice(0, 500));
  }

  const data = await resp.json();
  const rawText = extractOutputText(data);
  if(!rawText) throw new Error('OpenAI returned no output text. Raw response: ' + JSON.stringify(data).slice(0, 500));

  let parsed;
  try{
    parsed = parseFindingsJson(rawText);
  }catch(err){
    // Surfaced as a task error (with the raw text attached) rather than silently discarded —
    // matches the existing error-review pattern: a human can read exactly what came back and
    // decide whether to retry.
    throw new Error('Could not parse OpenAI response as valid findings JSON: ' + err.message + '\n\nRaw response:\n' + rawText.slice(0, 1500));
  }

  const tokensUsed = (data.usage && data.usage.total_tokens) || 0;

  return {
    awaitingReview: true,
    result: {
      name: entry.n,
      verdict: parsed.verdict,
      findings: parsed.findings,
      model: OPENAI_MODEL
    },
    summary: parsed.verdict === 'pass'
      ? 'PASS \u2014 no issues found'
      : parsed.findings.length + ' finding(s) to review',
    provider: 'openai',
    tokensUsed
    // No filesToCommit: proofread never writes to data.json or the repo. The task's `result`
    // (committed as part of workLog.json, same as every other task) is the only output.
  };
}
