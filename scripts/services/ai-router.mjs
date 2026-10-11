// ai-router.mjs (2026-10-11) — every AI call goes through here.
//
// ai/models.json lists the models with their prices and a tier (1 simple, 2 standard, 3 deep),
// and maps each job ("pron-pick", "roman-i", "pron-vote", …) to the tier it needs. For a job, the
// router uses the CHEAPEST model whose tier is at least the job's, among providers that have a key
// (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY); if that call fails it tries the next cheapest.
// Models without a price come after priced ones. Change a job's tier or a price in models.json —
// nothing here needs editing.
//
// Every call's tokens and cost (at the listed prices) are kept; flushUsage() appends them to
// ai/usage/<year-month>.jsonl and returns that path so the caller commits it with its work.

import fs from 'node:fs/promises';
import path from 'node:path';

const MODELS_FILE = 'ai/models.json';
const KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
export const PROVIDER_NAMES = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
// Used only if ai/models.json is missing, so nothing breaks before it's uploaded.
const FALLBACK = { jobs: {}, models: [
  { provider: 'anthropic', id: 'claude-sonnet-5-5', tier: 2, in: 2, out: 10 },
  { provider: 'openai', id: 'gpt-6-luna', tier: 2, in: null, out: null },
  { provider: 'gemini', id: 'gemini-flash-latest', tier: 2, in: null, out: null } ] };

let registry = null;
const usage = [];

export async function loadModels(){
  if(registry) return registry;
  try{ registry = JSON.parse(await fs.readFile(MODELS_FILE, 'utf8')); }catch(e){ registry = FALLBACK; }
  registry.jobs = registry.jobs || {};
  registry.models = (registry.models || []).filter(m => m && m.id && m.provider && !m.off);
  return registry;
}
export function hasKey(provider){ return !!process.env[KEYS[provider]]; }

// A rough cost of one typical call, used only to rank models: 4 parts input to 1 part output.
const rankCost = (m) => (m.in == null || m.out == null) ? Infinity : (m.in * 4 + m.out);

// The models to try for a job, cheapest first. provider: only that provider's models.
export async function modelsFor(job, provider){
  const reg = await loadModels();
  const tier = Number(reg.jobs[job]) || 2;
  return reg.models
    .filter(m => (Number(m.tier) || 1) >= tier && hasKey(m.provider) && (!provider || m.provider === provider))
    .sort((a, b) => rankCost(a) - rankCost(b) || (Number(a.tier) || 1) - (Number(b.tier) || 1));
}

// One call to one model. Returns the reply text; records tokens and cost.
export async function callModel(m, system, user, job){
  const key = process.env[KEYS[m.provider]];
  if(!key) throw new Error('no ' + KEYS[m.provider] + ' secret');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 120000);
  try{
    let r, j, text = '', inTok = 0, outTok = 0;
    if(m.provider === 'anthropic'){
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.id, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }) });
      j = await r.json();
      if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      text = (j.content || []).map(c => c.text || '').join('');
      inTok = (j.usage && j.usage.input_tokens) || 0; outTok = (j.usage && j.usage.output_tokens) || 0;
    }else if(m.provider === 'openai'){
      r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: ctl.signal,
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.id, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
      j = await r.json();
      if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      inTok = (j.usage && j.usage.prompt_tokens) || 0; outTok = (j.usage && j.usage.completion_tokens) || 0;
    }else{
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m.id) + ':generateContent', { method: 'POST', signal: ctl.signal,
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json' } }) });
      j = await r.json();
      if(!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      const c = (j.candidates || [])[0];
      text = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
      inTok = (j.usageMetadata && j.usageMetadata.promptTokenCount) || 0; outTok = (j.usageMetadata && j.usageMetadata.candidatesTokenCount) || 0;
    }
    const cost = (m.in == null || m.out == null) ? null : Math.round((inTok * m.in + outTok * m.out) / 1e6 * 1e6) / 1e6;
    usage.push({ at: new Date().toISOString(), job: job || '', provider: m.provider, model: m.id, in: inTok, out: outTok, cost });
    return text;
  }finally{ clearTimeout(timer); }
}

// Ask for a job: the cheapest suitable model, then the next if it fails. provider limits the choice.
// Returns { text, model, provider, by } — by is the provider's display name. Throws if all fail.
export async function ask(job, system, user, provider){
  const list = await modelsFor(job, provider);
  if(!list.length) throw new Error('no model available for ' + job + (provider ? ' from ' + PROVIDER_NAMES[provider] : ''));
  const errors = [];
  for(const m of list){
    try{ return { text: await callModel(m, system, user, job), model: m.id, provider: m.provider, by: PROVIDER_NAMES[m.provider] }; }
    catch(e){ errors.push(m.id + ': ' + String(e.message || e).slice(0, 100)); }
  }
  throw new Error(errors.join('; '));
}

// The JSON object inside a reply (models sometimes wrap it in ``` fences or add a sentence).
export function jsonOf(text){
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if(a < 0 || b <= a) throw new Error('no JSON in answer');
  return JSON.parse(t.slice(a, b + 1));
}

// Spending so far in this run.
export function usageSummary(){
  const total = usage.reduce((s, u) => s + (u.cost || 0), 0);
  const unpriced = usage.filter(u => u.cost == null).length;
  return { calls: usage.length, cost: Math.round(total * 10000) / 10000, unpriced };
}
// Append this run's calls to ai/usage/<YYYY-MM>.jsonl; returns its path (to commit), or null.
export async function flushUsage(){
  if(!usage.length) return null;
  const file = path.join('ai', 'usage', new Date().toISOString().slice(0, 7) + '.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, usage.map(u => JSON.stringify(u)).join('\n') + '\n');
  usage.length = 0;
  return file;
}
