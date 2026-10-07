// scripts/services/ledger-build.mjs
//
// MODULE DATE: 2026-10-06 (Tuesday) · v1.1 — v1 plus two changes: (1) pages a model discovers are only
// SUGGESTIONS and never count as proof, and discovery is off unless payload.discover is true; (2) the
// allowlist is widened to the official tier, with a tier recorded on every source. Written against orchestrator_9.mjs and
// fact-research_2.mjs as uploaded 2026-10-06. If either has changed since, ask for a refresh before
// relying on the handler contract or the provider-call code below. Tested with mocked fetch/models
// only (the build sandbox has no network); never run against live APIs or live source sites.
//
// Service: "ledger-build" — build the source-proof ledger (see source-proof-ledger-spec.md) for
// existing articles, backward from their current text. It never rewrites an article and never
// edits data.json unless payload.writeQc is true.
//
// TASK SHAPE (queue by hand in workLog.json until the app's Add Task knows this type):
//   { id, type: 'ledger-build', status: 'queued', entityId: '<first id>',
//     payload: { entityIds: ['st-augustine-430', ...],   // up to MAX_ENTRIES_PER_TASK; or just entityId
//                force: false,        // true = rebuild even if the stored articleHash still matches
//                discover: false,     // true = ask Gemini to SUGGEST allowlisted pages for the report (never used as proof)
//                writeQc: false,      // true = also write a small summary into entry.qc.ledger
//                models: { extractor: 'modelId', prover: 'modelId', judge: 'modelId' } } }  // optional
//
// PIPELINE PER ARTICLE (spec sections 5-8):
//   1. Link pass (no model): fetch each art.links URL on the allowlist; require HTTP 200; require
//      the entry's name to appear on the page. Pages that fail are recorded in sourceHealth and not used.
//   2. Only if payload.discover is true and no cited page survived: Gemini (search on) may propose allowlisted
//      URLs; code fetches and checks them. They go in ledger.suggestedSources and are NEVER used as proof,
//      because a reader following the article's own links could not find them. Claims stay unsourced, with a
//      note naming the page; add the link to the article to make it count.
//   3. Extract claims (Claude): one call, verbatim sentence + restated claim + kind + keys. Code
//      confirms every sentence really appears in its section and drops any that don't.
//      art.quotes are added in code as kind "quote" claims (no model involved).
//   4. Code match: every number in a claim must appear somewhere in the fetched sources, or the claim
//      is "unsourced" with checks.missingNumbers set (this is what should catch a changed number).
//   5. Prover (Gemini, no search): sees claim + the top-ranked passages from the fetched pages (ranked
//      in code) and copies an exact excerpt. Code verifies the excerpt (on the page, short, contains
//      the claim's numbers and at least one name). Up to MAX_PROOF_ATTEMPTS, feeding back the reason.
//   6. Blind judge (OpenAI, different provider from the prover): sees only claim + excerpt.
//   7. Status: verified | disputed | unsourced | traditional.
//   The claim text is never modified by the loop, so revisions[] stays empty in this mode.
//
// OUTPUT: ledger/<entry-id>.json per article (one file each, no write collisions), returned via
// filesToCommit so the orchestrator commits them right after the task. The UI must say "Source
// excerpt", never "Verified" — these checks do not establish doctrine or that the source is right.
//
// articleHash (for the future viewer to compare in the browser): first 16 hex chars of SHA-256 over
//   JSON.stringify({ s: sections.map(s => [s.h || '', s.b || '']),
//                    q: (art.quotes || []).map(q => q.text || ''),
//                    f: (facts || []).map(f => [f.label || '', f.value || '']) })
// Section numbers in claims are 1-based; Quick Facts claims use section "facts", quote-block claims "quotes".
//
// KNOWN LIMITS (v1):
//   • Number matching is on digits plus spelled numbers three..ninety-nine. "one"/"two" and ordinals
//     ("fourth century") are not matched. Centuries and Roman numerals are not checked.
//   • Contradiction is only detected by the prover volunteering it or the judge saying "not".
//   • Claims the extractor never lists are not covered; ledger.uncovered lists article sentences that
//     contain a digit but match no claim, as a cheap measure of that gap.
//   • Source pages are plain text from the page body, site menus included; a name can "appear" in a menu.
//
// Requires ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY (already passed in orchestrator.yml).
// A missing key fails the task with a clear message rather than silently skipping a role.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const LEDGER_DIR = process.env.LEDGER_DIR || 'ledger';
const CACHE_DIR = process.env.LEDGER_CACHE_DIR || '.cache/ledger-sources';
const DATA_PATH = process.env.DATA_PATH || 'data.json';
const MINIFY = process.env.LEDGER_MINIFY === '1';

// Domains a source may come from (www. and other subdomains allowed). Edit here to change.
const ALLOWLIST_APPROVED = ['newadvent.org', 'vatican.va', 'franciscanmedia.org', 'ewtn.com', 'vaticannews.va', 'britannica.com'];
// Official / institutional sites (tier A in source-domain-report-2026-10-06.md): shrines, orders, bishops'
// conference, governments. Authoritative for their own subject, but interested parties: the ledger shows
// the tier so a reader can tell. oca.org (Orthodox) and parliament.uk (legislation facts only) are the two
// judgment calls; delete a line to drop one. Tiers B-E are NOT allowed as proof.
const ALLOWLIST_OFFICIAL = ['usccb.org', 'vaticanstate.va', 'basilicasanpietro.va', 'lourdes-france.org', 'lasalette.cef.fr',
  'knockshrine.ie', 'banneux-nd.be', 'fatima.pt', 'virgendeguadalupe.org.mx', 'championshrine.org', 'daughtersofcharity.com',
  'missionariesofcharity.org', 'kolbeshrine.org', 'thedivinemercy.org', 'katharinedrexel.org', 'rscj.org', 'jesuits.org',
  'opusdei.org', 'duomodiorvieto.it', 'wa.catedraldevalencia.es', 'sainte-bernadette-soubirous-nevers.com', 'pastorinhos.com',
  'oca.org', 'parliament.uk'];
// Hosts that match a listed domain but are NOT wanted (bible.usccb.org is the NAB text; you use Douay-Rheims).
const EXCLUDED_HOSTS = ['bible.usccb.org'];
const ALLOWLIST = ALLOWLIST_APPROVED.concat(ALLOWLIST_OFFICIAL);

const MAX_ENTRIES_PER_TASK = 15;
const MAX_SOURCES_PER_ENTRY = 6;
const MAX_CLAIMS_PER_ENTRY = 60;
const CLAIMS_PER_PROVER_CALL = 8;
const CLAIMS_PER_JUDGE_CALL = 15;
const MAX_PROOF_ATTEMPTS = 3;
const MAX_EXCERPT_WORDS = 30;
const MAX_QUOTE_EXCERPT_WORDS = 90;
const FETCH_TIMEOUT_MS = 20000;
const FETCH_GAP_MS = 600;          // minimum gap between requests to the same host
const MAX_PAGE_CHARS = 600000;
const TOKEN_BUDGETS = [4000, 8000, 12000];

// Judge must be a different provider than the prover (spec open question 1). Change modelId freely;
// payload.models can override per task.
const ROLES = {
  extractor: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  prover:    { provider: 'google',    modelId: 'gemini-3.5-flash-lite' },
  judge:     { provider: 'openai',    modelId: 'gpt-5.6-luna' }
};

let tokensUsed = 0;

// ---------------------------------------------------------------------------------------------
// Providers — same endpoints/auth as fact-research.mjs (copied, not imported, so each service
// file stands alone). Search is only ever turned on for source discovery.
// ---------------------------------------------------------------------------------------------

function httpError(label, res, errText){
  const err = new Error(label + ' ' + res.status + ': ' + String(errText).slice(0, 300));
  err.status = res.status;
  err.retryable = res.status >= 500 || res.status === 429;
  return err;
}

async function callAnthropic(systemPrompt, userInput, maxTokens, apiKey, model, search){
  const body = { model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userInput }] };
  if(search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw httpError('Anthropic messages', res, await res.text().catch(() => ''));
  const data = await res.json();
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n').trim();
  const truncated = data.stop_reason === 'max_tokens';
  const used = ((data.usage && data.usage.input_tokens) || 0) + ((data.usage && data.usage.output_tokens) || 0);
  return { text, truncated, used };
}

async function callOpenAI(systemPrompt, userInput, maxTokens, apiKey, model, search){
  const body = { model, instructions: systemPrompt, input: userInput, max_output_tokens: maxTokens, reasoning: { effort: 'low' } };
  if(search) body.tools = [{ type: 'web_search' }];
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw httpError('OpenAI responses', res, await res.text().catch(() => ''));
  const data = await res.json();
  const text = (data.output || [])
    .filter(o => o.type === 'message')
    .flatMap(o => (o.content || []).filter(c => c.type === 'output_text').map(c => c.text || ''))
    .join('\n').trim();
  const truncated = data.status === 'incomplete' ||
    (data.incomplete_details && data.incomplete_details.reason === 'max_output_tokens');
  return { text, truncated, used: (data.usage && data.usage.total_tokens) || 0 };
}

// Search grounding can't be combined with responseMimeType json, so search-on asks for JSON in the
// prompt only and extractJson pulls it out.
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
  if(!res.ok) throw httpError('Gemini generateContent', res, await res.text().catch(() => ''));
  const data = await res.json();
  const cand = (data.candidates || [])[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map(p => p.text || '').join('').trim();
  return { text, truncated: !!(cand && cand.finishReason === 'MAX_TOKENS'), used: (data.usageMetadata && data.usageMetadata.totalTokenCount) || 0 };
}

const PROVIDERS = {
  anthropic: { keyEnv: 'ANTHROPIC_API_KEY', call: callAnthropic },
  openai:    { keyEnv: 'OPENAI_API_KEY',    call: callOpenAI },
  google:    { keyEnv: 'GEMINI_API_KEY',    call: callGoogle }
};

function extractJson(raw){
  const s = String(raw || '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if(start === -1 || end <= start) throw new Error('no JSON object in response');
  return JSON.parse(s.slice(start, end + 1));
}

// One role's call with escalating token budget. Rate-limit / quota failures that survive every
// attempt are marked deferred, so the orchestrator treats them as "try again later", not an error.
async function callJson(roleCfg, systemPrompt, userInput, search){
  const prov = PROVIDERS[roleCfg.provider];
  const apiKey = process.env[prov.keyEnv];
  if(!apiKey) throw new Error('Missing ' + prov.keyEnv + ' secret (needed for ' + roleCfg.provider + ').');
  let lastErr;
  for(let attempt = 0; attempt < TOKEN_BUDGETS.length; attempt++){
    try{
      const { text, truncated, used } = await prov.call(systemPrompt, userInput, TOKEN_BUDGETS[attempt], apiKey, roleCfg.modelId, !!search);
      tokensUsed += used || 0;
      if(truncated) lastErr = new Error(roleCfg.provider + ' hit its token limit (budget ' + TOKEN_BUDGETS[attempt] + ')');
      else if(!text) lastErr = new Error(roleCfg.provider + ' returned no output text.');
      else{
        try{ return extractJson(text); }
        catch(_e){ lastErr = new Error(roleCfg.provider + ' response did not contain valid JSON: ' + text.slice(0, 300)); }
      }
    }catch(err){
      lastErr = err;
      if(err && err.retryable === false) break;
    }
    if(attempt < TOKEN_BUDGETS.length - 1) await sleep(1000 * (attempt + 1));
  }
  if(lastErr && (lastErr.status === 429 || /quota|credit|billing/i.test(String(lastErr.message)))){
    lastErr.deferred = true;
  }
  throw lastErr;
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------------------------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', eacute: '\u00e9',
  egrave: '\u00e8', agrave: '\u00e0', ouml: '\u00f6', uuml: '\u00fc', auml: '\u00e4', ccedil: '\u00e7' };

function decodeEntities(s){
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => { try{ return String.fromCodePoint(parseInt(h, 16)); }catch(_e){ return ' '; } })
    .replace(/&#(\d+);/g, (_m, d) => { try{ return String.fromCodePoint(parseInt(d, 10)); }catch(_e){ return ' '; } })
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}

// Article HTML -> plain text. Tags dropped, entities decoded, paragraph breaks kept.
function stripHtml(s){
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Whole web page -> plain text.
function htmlToText(html){
  let t = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const RE_COMPOUND = new RegExp('\\b(' + Object.keys(TENS).join('|') + ')[-\\s](' + Object.keys(UNITS).join('|') + ')\\b', 'g');
// "one" and "two" are left as words on their own (too common to mean a quantity); they still work
// inside compounds like twenty-one.
const SINGLE = Object.assign({}, TEENS, TENS);
['three','four','five','six','seven','eight','nine'].forEach(k => { SINGLE[k] = UNITS[k]; });
const RE_SINGLE = new RegExp('\\b(' + Object.keys(SINGLE).join('|') + ')\\b', 'g');

// Normal form used for every comparison: no accents, lowercase, straight quotes/dashes, spelled
// numbers as digits, single spaces. norm(norm(x)) === norm(x).
function norm(s){
  let t = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  t = t.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2015\u2212]/g, '-');
  t = t.replace(RE_COMPOUND, (_m, a, b) => String(TENS[a] + UNITS[b]));
  t = t.replace(RE_SINGLE, (_m, w) => String(SINGLE[w]));
  return t.replace(/\s+/g, ' ').trim();
}

function numericKeys(text){
  return [...new Set(norm(text).match(/\d+/g) || [])];
}

function hasNumber(normText, k){
  return new RegExp('(?<!\\d)' + k + '(?!\\d)').test(normText);
}

function trimPunct(s){
  return String(s || '').replace(/^[^A-Za-z0-9\u00c0-\u024f"'(\[]+/, '').replace(/[^A-Za-z0-9\u00c0-\u024f"')\].!?]+$/, '').trim();
}

function wordCount(s){ return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

const ABBREV = /\b(St|Sts|Bl|Fr|Mt|Dr|Jr|Sr|c|ca|cf|vs|No|Nos|Ven|Mgr|Msgr|Rev|Fr|Abp|Bp)\.$/i;

function splitSentences(text){
  const out = [];
  for(const para of String(text || '').split(/\n+/)){
    const parts = para.split(/(?<=[.!?]["')\]\u201d\u2019]?)\s+(?=["'(\[\u201c\u2018]?[A-Z0-9])/);
    let carry = '';
    for(const p of parts){
      const piece = carry ? carry + ' ' + p : p;
      if(ABBREV.test(piece.trim())){ carry = piece; continue; }
      carry = '';
      if(piece.trim()) out.push(piece.trim());
    }
    if(carry.trim()) out.push(carry.trim());
  }
  return out;
}

// Merge sentences into ~300-700 character passages for retrieval.
function chunkText(text){
  const sents = splitSentences(text);
  const chunks = [];
  let cur = '';
  for(const s of sents){
    if(cur && (cur.length + s.length) > 700){ chunks.push(cur); cur = s; }
    else cur = cur ? cur + ' ' + s : s;
    if(cur.length >= 300){ chunks.push(cur); cur = ''; }
  }
  if(cur) chunks.push(cur);
  return chunks;
}

const STOPWORDS = new Set(['that','this','with','from','were','which','their','there','have','been','also','into','after','before','when','they','them','than','then','will','would','could','about','these','those','while','where','what','whom','whose','such','only','other','over','under','some','many','most','more','both','each','very']);

function contentTokens(s){
  return [...new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOPWORDS.has(t)))];
}

// ---------------------------------------------------------------------------------------------
// Source pages
// ---------------------------------------------------------------------------------------------

const pageCache = new Map();   // url -> Promise<fetchResult>, so one run never downloads a URL twice
const lastHit = new Map();     // host -> timestamp of last request, for the politeness gap

function hostOf(url){ try{ return new URL(url).hostname.toLowerCase(); }catch(_e){ return ''; } }

function hostMatches(h, list){ return list.some(d => h === d || h.endsWith('.' + d)); }

function onAllowlist(url){
  const h = hostOf(url);
  return !!h && !hostMatches(h, EXCLUDED_HOSTS) && hostMatches(h, ALLOWLIST);
}

// 'approved' = the original six; 'official' = institutional sites added in v1.1.
function tierOf(url){
  const h = hostOf(url);
  return hostMatches(h, ALLOWLIST_APPROVED) ? 'approved' : 'official';
}

function cachePathFor(url){
  return CACHE_DIR + '/' + createHash('sha1').update(url).digest('hex') + '.json';
}

async function pace(host){
  const wait = (lastHit.get(host) || 0) + FETCH_GAP_MS - Date.now();
  if(wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

// Returns { url, ok, http, text, note }. Only a clean HTTP 200 HTML/text page is ok.
function fetchSource(url){
  if(!pageCache.has(url)) pageCache.set(url, doFetchSource(url));
  return pageCache.get(url);
}

async function doFetchSource(url){
  const cp = cachePathFor(url);
  try{
    if(existsSync(cp)){
      const c = JSON.parse(readFileSync(cp, 'utf8'));
      if(c && c.ok && c.text) return c;
    }
  }catch(_e){ /* bad cache file: just refetch */ }

  const host = hostOf(url);
  try{
    await pace(host);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'CatholicTimelineLedgerBot/1.0 (+https://catholictimeline.org)', 'Accept': 'text/html,text/plain;q=0.9' }
    });
    if(res.status !== 200) return { url, ok: false, http: res.status, text: '', note: 'HTTP ' + res.status };
    const ctype = res.headers.get('content-type') || '';
    if(!/html|text\/plain|xml/i.test(ctype)) return { url, ok: false, http: 200, text: '', note: 'not a text page (' + ctype.slice(0, 40) + ')' };
    const buf = Buffer.from(await res.arrayBuffer());
    let charset = (/charset=([\w-]+)/i.exec(ctype) || [])[1];
    if(!charset) charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
    let html;
    try{ html = new TextDecoder(charset || 'utf-8').decode(buf); }catch(_e){ html = buf.toString('utf8'); }
    const text = htmlToText(html).slice(0, MAX_PAGE_CHARS);
    if(text.length < 200) return { url, ok: false, http: 200, text: '', note: 'page has almost no text (may need JavaScript)' };
    const out = { url, ok: true, http: 200, text, note: '' };
    try{ mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cp, JSON.stringify(out)); }catch(_e){ /* cache is optional */ }
    return out;
  }catch(err){
    return { url, ok: false, http: 0, text: '', note: 'fetch failed: ' + String((err && err.message) || err).slice(0, 120) };
  }
}

const NAME_STOP = new Set(['saint','saints','blessed','pope','council','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','church','catholic','holy','feast','lady','martyrs','companions','apparition','miracle','event','venerable','great','under','with','from','the','and']);

function nameTokens(name){
  return norm(String(name || '').replace(/\(.*?\)/g, '')).split(/[^a-z0-9]+/).filter(t => t.length > 3 && !NAME_STOP.has(t));
}

function namePresence(name, normText){
  const toks = nameTokens(name);
  if(!toks.length) return 'unknown';
  const hits = toks.filter(t => normText.includes(t)).length;
  return hits === toks.length ? 'full' : hits ? 'partial' : 'none';
}

// Fetch + health-check a list of URLs. Returns { pages, health }.
async function gatherPages(entry, urls){
  const pages = [], health = [];
  for(const url of [...new Set(urls)].slice(0, MAX_SOURCES_PER_ENTRY)){
    if(!onAllowlist(url)){ health.push({ url, ok: false, note: 'not an approved source (outside the allowed domains)' }); continue; }
    const f = await fetchSource(url);
    if(!f.ok){ health.push({ url, ok: false, http: f.http, note: f.note }); continue; }
    const normText = norm(f.text);
    const presence = namePresence(entry.n, normText);
    if(presence === 'none'){
      health.push({ url, ok: false, http: f.http, namePresent: 'none', note: 'wrong page: the entry name does not appear' });
      continue;
    }
    health.push({ url, ok: true, http: f.http, namePresent: presence, chars: f.text.length, tier: tierOf(url) });
    pages.push({ url, plain: f.text, normText, chunks: chunkText(f.text).map(t => ({ text: t, n: norm(t) })) });
  }
  return { pages, health };
}

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------

const EXTRACTOR_PROMPT = `You list the checkable factual claims in an article for "Catholic Timeline", a reference site on the history of the Catholic Church. You change nothing and correct nothing; a separate process checks each claim against sources.

You receive JSON: the entry name and year, numbered sections (plain text), and Quick Facts.

For every checkable claim, output:
- "section": the section number, or "facts" for a Quick Fact.
- "sentence": the ONE sentence the claim comes from, copied verbatim, character for character, punctuation included. For a Quick Fact use exactly "Label: Value". If a sentence is garbled or broken, copy it as is and still list its claim. Never repair it.
- "text": the claim restated in 25 words or fewer. Keep every number, date, name and place the sentence asserts. No pronouns.
- "kind": one of date, person, place, number, event, attribution, quote, doctrine, tradition. Use "tradition" when the sentence rests on tradition, legend or a pious account rather than documented history. For "quote", "text" is the exact quoted words copied from the sentence.
- "keys": the names, places, titles, numbers and dates that appear in the sentence and that a supporting source must contain, exactly as written there.

One sentence may carry several claims. Skip sentences with nothing checkable (devotion, rhetoric, transitions). Include every date, number, place, named person, event, attribution and doctrinal statement. List Quick Facts too.

Respond with ONLY a JSON object, no preamble, no code fences:
{ "claims": [ { "section": 1, "sentence": "...", "text": "...", "kind": "date", "keys": ["..."] } ] }`;

const PROVER_PROMPT = `You find the proof for factual claims about Catholic history in source passages. You receive JSON with a list of claims. Each has: cid, claim, sentence, kind, keys, optionally previousFailure (why your last attempt was rejected), and passages (each with a url and text). The passages are the ONLY material you may use. Do not use your own knowledge.

For each claim, choose ONE passage that directly supports it and copy an excerpt from that passage:
- The excerpt must be copied exactly, character for character, from the passage. No ellipses, no paraphrase, no joining of separate sentences.
- At most 25 words (for kind "quote", the full quoted words are required instead).
- It must contain every number and date in the claim, and at least one of the named people or places in "keys".
- If previousFailure is present, fix that specific problem or choose a different passage.
- If no passage supports the claim, say found:false. If a passage clearly says something that contradicts the claim, return found:false, contradicts:true, with the url and the contradicting excerpt (copied exactly). Never stretch a passage to fit.

Respond with ONLY a JSON object, no preamble, no code fences:
{ "results": [ { "cid": "c1", "found": true, "url": "https://...", "excerpt": "..." }, { "cid": "c2", "found": false, "contradicts": false, "reason": "..." } ] }`;

const JUDGE_PROMPT = `You judge whether a short source excerpt supports a claim. You see only the claim and the excerpt. Use nothing else, and do not use outside knowledge.

For each item answer exactly one of:
- "supports": the excerpt states or clearly entails the whole claim, including its dates, numbers and names.
- "partial": it supports part of the claim but not all of it, or leaves a detail unconfirmed.
- "not": it does not support the claim, or contradicts it.

Respond with ONLY a JSON object, no preamble, no code fences:
{ "verdicts": [ { "cid": "c1", "verdict": "supports", "reason": "one short sentence" } ] }`;

const DISCOVER_PROMPT = `You suggest web pages for checking facts in an article about a Catholic saint or event. Search the web. Propose at most 3 page URLs, ONLY from these domains: ${ALLOWLIST.join(', ')}. Prefer the New Advent Catholic Encyclopedia article on the subject. Only propose a URL you actually found in search results. Respond with ONLY a JSON object, no preamble: { "urls": ["https://..."] }`;

// ---------------------------------------------------------------------------------------------
// Article -> claims
// ---------------------------------------------------------------------------------------------

function articleParts(entry){
  const art = entry.art || {};
  const sections = (art.sections || []).map((s, i) => ({ n: i + 1, h: String(s.h || ''), plain: stripHtml(s.b) }));
  const facts = (entry.facts || []).map(f => ({ label: String(f.label || '').trim(), value: String(f.value || '').trim() }))
    .filter(f => f.label && f.value);
  const quotes = (art.quotes || []).filter(q => q && q.text).map(q => ({ text: String(q.text), source: String(q.source || '') }));
  return { sections, facts, quotes };
}

function articleHash(entry){
  const art = entry.art || {};
  const payload = JSON.stringify({
    s: (art.sections || []).map(s => [s.h || '', s.b || '']),
    q: (art.quotes || []).map(q => q.text || ''),
    f: (entry.facts || []).map(f => [f.label || '', f.value || ''])
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

async function extractClaims(entry, parts, roleCfg){
  const input = JSON.stringify({
    entry: { name: entry.n, year: entry.y },
    sections: parts.sections.map(s => ({ section: s.n, heading: s.h, text: s.plain })),
    quickFacts: parts.facts.map(f => f.label + ': ' + f.value)
  }, null, 1);
  const parsed = await callJson(roleCfg, EXTRACTOR_PROMPT, input, false);
  const raw = Array.isArray(parsed.claims) ? parsed.claims : [];

  const kinds = new Set(['date','person','place','number','event','attribution','quote','doctrine','tradition']);
  const secNorm = new Map(parts.sections.map(s => [String(s.n), norm(s.plain)]));
  const factNorm = new Set(parts.facts.map(f => norm(f.label + ': ' + f.value)));
  const claims = [];
  let rejected = 0;

  for(const c of raw){
    const sentence = String((c && c.sentence) || '').trim();
    const text = String((c && c.text) || '').trim();
    const section = c && (c.section === 'facts' ? 'facts' : parseInt(c.section, 10));
    if(!sentence || !text || !section){ rejected++; continue; }
    const ns = norm(sentence);
    const found = section === 'facts' ? factNorm.has(ns) : (secNorm.get(String(section)) || '').includes(ns);
    if(!found){ rejected++; continue; }                    // the model did not copy the sentence verbatim
    const kind = kinds.has(c.kind) ? c.kind : 'event';
    if(kind === 'quote' && !ns.includes(norm(text))){ rejected++; continue; }
    // Keys must really be in the sentence; numbers come from the restated claim, and only the ones
    // the sentence also contains (stops a model inventing a number that then can't be found).
    const keys = (Array.isArray(c.keys) ? c.keys : []).map(k => String(k).trim())
      .filter(k => norm(k).length >= 3 && !/^\d+$/.test(norm(k)) && ns.includes(norm(k)));
    const nums = numericKeys(text).filter(n => hasNumber(ns, n));
    claims.push({ section, sentence, text, kind, keys: [...new Set(keys)], nums });
    if(claims.length >= MAX_CLAIMS_PER_ENTRY) break;
  }

  // Quote-block quotes: added in code, no model. Proof must contain the whole quote.
  parts.quotes.forEach(q => {
    claims.push({ section: 'quotes', sentence: q.text, text: q.text, kind: 'quote', keys: [], nums: [], quoteSource: q.source });
  });

  claims.forEach((c, i) => { c.cid = 'c' + (i + 1); });
  return { claims, rejected, modelClaims: raw.length };
}

// Sentences that carry a digit but match no claim's sentence: a cheap read on what the extractor missed.
function findUncovered(parts, claims){
  const covered = claims.map(c => norm(c.sentence));
  const out = [];
  for(const s of parts.sections){
    for(const sent of splitSentences(s.plain)){
      const ns = norm(sent);
      if(!/\d/.test(ns)) continue;
      if(covered.some(c => c.includes(ns) || ns.includes(c))) continue;
      out.push({ section: s.n, sentence: sent });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matching and proof
// ---------------------------------------------------------------------------------------------

// Highest-scoring passages across all fetched pages for one claim.
function pickPassages(claim, pages, n){
  const claimToks = contentTokens(claim.sentence + ' ' + claim.text);
  const scored = [];
  for(const p of pages){
    for(const ch of p.chunks){
      const nc = ch.n;
      let score = 0;
      for(const k of claim.nums) if(hasNumber(nc, k)) score += 3;
      for(const k of claim.keys) if(nc.includes(norm(k))) score += 3;
      if(claimToks.length){
        const set = new Set(nc.split(/[^a-z0-9]+/));
        score += 5 * (claimToks.filter(t => set.has(t)).length / claimToks.length);
      }
      if(score > 0) scored.push({ score, url: p.url, text: ch.text });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map(s => ({ url: s.url, text: s.text }));
}

// Code's check of a proposed excerpt. Returns { ok, reason, url, excerpt }.
function verifyExcerpt(claim, url, excerptRaw, pages){
  const excerpt = trimPunct(excerptRaw);
  const isQuote = claim.kind === 'quote';
  const cap = isQuote ? MAX_QUOTE_EXCERPT_WORDS : MAX_EXCERPT_WORDS;
  if(!excerpt || excerpt.length < 12) return { ok: false, reason: 'excerpt is empty or too short' };
  if(wordCount(excerpt) > cap) return { ok: false, reason: 'excerpt is ' + wordCount(excerpt) + ' words; the limit is ' + cap };
  const ne = norm(excerpt);
  const pref = pages.find(p => p.url === url);
  let page = pref && pref.normText.includes(ne) ? pref : pages.find(p => p.normText.includes(ne));
  if(!page) return { ok: false, reason: 'excerpt was not found word for word on any fetched page (copy it exactly, no ellipses or paraphrase)' };
  if(isQuote){
    if(!ne.includes(norm(claim.text))) return { ok: false, reason: 'the excerpt must contain the whole quoted text of the claim exactly' };
  }else{
    const missing = claim.nums.filter(k => !hasNumber(ne, k));
    if(missing.length) return { ok: false, reason: 'excerpt does not contain the number(s) ' + missing.join(', ') + ' from the claim' };
    if(claim.keys.length && !claim.keys.some(k => ne.includes(norm(k)))){
      return { ok: false, reason: 'excerpt contains none of the claim\'s names: ' + claim.keys.join('; ') };
    }
  }
  return { ok: true, url: page.url, excerpt };
}

function chunkArray(arr, n){
  const out = [];
  for(let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function proveClaims(claims, pages, roleCfg){
  const state = new Map();                 // cid -> { reason, proof, contradicts }
  let pending = claims.slice();
  for(let attempt = 0; attempt < MAX_PROOF_ATTEMPTS && pending.length; attempt++){
    const nextPending = [];
    for(const batch of chunkArray(pending, CLAIMS_PER_PROVER_CALL)){
      const input = JSON.stringify({ claims: batch.map(c => ({
        cid: c.cid, claim: c.text, sentence: c.sentence, kind: c.kind, keys: c.keys.concat(c.nums),
        previousFailure: (state.get(c.cid) || {}).reason || undefined,
        passages: pickPassages(c, pages, 4 + 2 * attempt)
      })) }, null, 1);
      const parsed = await callJson(roleCfg, PROVER_PROMPT, input, false);
      const byCid = new Map((Array.isArray(parsed.results) ? parsed.results : []).map(r => [String(r && r.cid), r]));
      for(const c of batch){
        const r = byCid.get(c.cid);
        const st = state.get(c.cid) || {};
        if(!r){ st.reason = 'no result returned for this claim'; state.set(c.cid, st); nextPending.push(c); continue; }
        if(r.found === false){
          if(r.contradicts && r.excerpt){
            const v = verifyExcerpt(Object.assign({}, c, { nums: [], keys: [] }), r.url, r.excerpt, pages);
            if(v.ok){ st.contradicts = { url: v.url, excerpt: v.excerpt }; }
          }
          st.reason = 'prover found no supporting passage' + (r.reason ? ': ' + String(r.reason).slice(0, 160) : '');
          state.set(c.cid, st); nextPending.push(c); continue;
        }
        const v = verifyExcerpt(c, String(r.url || ''), String(r.excerpt || ''), pages);
        if(v.ok){ st.proof = { url: v.url, excerpt: v.excerpt }; st.reason = ''; state.set(c.cid, st); }
        else{ st.reason = v.reason; state.set(c.cid, st); nextPending.push(c); }
      }
    }
    pending = nextPending;
  }
  return state;
}

async function judgeClaims(items, roleCfg){
  const verdicts = new Map();              // cid -> { verdict, reason }
  for(const batch of chunkArray(items, CLAIMS_PER_JUDGE_CALL)){
    const parsed = await callJson(roleCfg, JUDGE_PROMPT,
      JSON.stringify({ items: batch.map(i => ({ cid: i.cid, claim: i.claim, excerpt: i.excerpt })) }, null, 1), false);
    for(const v of (Array.isArray(parsed.verdicts) ? parsed.verdicts : [])){
      const verdict = ['supports', 'partial', 'not'].includes(v && v.verdict) ? v.verdict : null;
      if(verdict) verdicts.set(String(v.cid), { verdict, reason: String(v.reason || '').slice(0, 200) });
    }
  }
  return verdicts;
}

// ---------------------------------------------------------------------------------------------
// One article
// ---------------------------------------------------------------------------------------------

async function discoverUrls(entry, roleCfg){
  try{
    const parsed = await callJson(roleCfg, DISCOVER_PROMPT, JSON.stringify({ name: entry.n, year: entry.y }), true);
    return (Array.isArray(parsed.urls) ? parsed.urls : []).map(u => String(u).trim()).filter(onAllowlist).slice(0, 3);
  }catch(err){
    if(err && err.deferred) throw err;
    return [];                              // discovery is a bonus; failing it just leaves claims unsourced
  }
}

async function buildLedger(entry, opts, roles){
  const parts = articleParts(entry);
  const hash = articleHash(entry);

  // 1 & 2. Sources
  const linkUrls = ((entry.art && entry.art.links) || []).map(l => l && l.url).filter(Boolean);
  const { pages, health } = await gatherPages(entry, linkUrls);
  // Suggestions only (v1.1): pages a model finds are checked and listed, but never added to `pages`, so the
  // prover and judge never see them. Proof must come from the article's own links.
  let suggestedSources = [];
  if(!pages.length && opts.discover){
    const urls = (await discoverUrls(entry, roles.prover)).filter(u => !linkUrls.includes(u));
    if(urls.length){
      const g = await gatherPages(entry, urls);
      suggestedSources = g.health.map(h => Object.assign({}, h, { note: h.ok ? 'loads and mentions the entry; add it to the article\'s links to use it' : h.note }));
    }
  }
  const noPageReason = !linkUrls.length ? 'the article has no source links'
    : 'none of the article\'s links could be used as proof (see sourceHealth)';
  const goodSuggestion = suggestedSources.find(h => h.ok);

  // 3. Claims
  const ex = await extractClaims(entry, parts, roles.extractor);
  const claims = ex.claims;

  // 4. Number check in code, against everything fetched
  const allNorm = pages.map(p => p.normText).join(' ');
  const out = [];
  const toProve = [];
  for(const c of claims){
    const rec = { cid: c.cid, section: c.section, sentence: c.sentence, text: c.text, kind: c.kind, status: 'unsourced', sources: [] };
    if(c.quoteSource) rec.note = 'quote block, source given in article: ' + c.quoteSource;
    out.push({ rec, c });
    if(!pages.length){
      rec.note = (rec.note ? rec.note + ' | ' : '') + noPageReason + (goodSuggestion ? '; possible source: ' + goodSuggestion.url + ' (add it to the article\'s links for it to count)' : '');
      continue;
    }
    if(c.kind !== 'quote'){
      const missing = c.nums.filter(k => !hasNumber(allNorm, k));
      if(missing.length){
        rec.checks = { missingNumbers: missing };
        rec.note = 'number(s) ' + missing.join(', ') + ' not found in any fetched source';
        continue;
      }
      // Soft flag only: names the sources never mention. Does not change status by itself (a model's
      // key can be a phrase the source words differently); the judge still rules, and the counts show it.
      const missingNames = c.keys.filter(k => !allNorm.includes(norm(k)));
      if(missingNames.length){
        rec.checks = { missingNames };
        rec.note = (rec.note ? rec.note + ' | ' : '') + 'name(s) not found in any fetched source: ' + missingNames.join('; ');
      }
    }
    toProve.push(c);
  }

  // 5. Prover with code verification
  const proofs = toProve.length ? await proveClaims(toProve, pages, roles.prover) : new Map();

  // 6. Blind judge over everything that has a verified excerpt
  const judgeItems = [];
  for(const { c } of out){
    const st = proofs.get(c.cid);
    if(st && st.proof) judgeItems.push({ cid: c.cid, claim: c.text, excerpt: st.proof.excerpt });
  }
  const verdicts = judgeItems.length ? await judgeClaims(judgeItems, roles.judge) : new Map();

  // 7. Status
  for(const { rec, c } of out){
    const st = proofs.get(c.cid);
    const v = verdicts.get(c.cid);
    if(st && st.proof){
      rec.sources = [{ url: st.proof.url, excerpt: st.proof.excerpt, match: 'exact', tier: tierOf(st.proof.url) }];
      if(v){ rec.judge = v.verdict; if(v.verdict !== 'supports' && v.reason) rec.note = v.reason; }
      else{ rec.note = 'judge returned no verdict'; }
      if(c.kind === 'tradition') rec.status = 'traditional';
      else rec.status = v && v.verdict === 'supports' ? 'verified' : 'disputed';
      if(rec.status === 'disputed' && !v) rec.status = 'unsourced';
    }else if(st && st.contradicts){
      rec.sources = [{ url: st.contradicts.url, excerpt: st.contradicts.excerpt, match: 'exact', tier: tierOf(st.contradicts.url) }];
      rec.status = c.kind === 'tradition' ? 'traditional' : 'disputed';
      rec.note = 'prover reports this source contradicts the claim';
    }else{
      if(c.kind === 'tradition') rec.status = 'traditional';
      if(st && st.reason) rec.note = (rec.note ? rec.note + ' | ' : '') + st.reason;
    }
    if(!rec.note) delete rec.note;
  }

  const recs = out.map(o => o.rec);
  const counts = { total: recs.length, verified: 0, disputed: 0, unsourced: 0, traditional: 0 };
  recs.forEach(r => { counts[r.status]++; });
  const missingNumbers = recs.filter(r => r.checks && r.checks.missingNumbers).length;
  const missingNames = recs.filter(r => r.checks && r.checks.missingNames).length;
  const uncovered = findUncovered(parts, claims);

  const ledger = {
    id: entry.id,
    name: entry.n,
    articleHash: hash,
    checkedAt: new Date().toISOString().slice(0, 10),
    generator: 'ledger-build v1.1 (2026-10-06)',
    models: { extractor: roles.extractor.modelId, prover: roles.prover.modelId, judge: roles.judge.modelId },
    sourceHealth: health,
    claims: recs,
    summary: Object.assign({}, counts, { missingNumbers, missingNames, uncoveredSentences: uncovered.length,
      extractorRejected: ex.rejected, suggestedSources: suggestedSources.filter(h => h.ok).length }),
    flags: [],
    humanReview: { status: 'pending', date: null }
  };
  if(uncovered.length) ledger.uncovered = uncovered;
  if(suggestedSources.length) ledger.suggestedSources = suggestedSources;
  return ledger;
}

// ---------------------------------------------------------------------------------------------
// Handler — signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
// ---------------------------------------------------------------------------------------------

function safeFileId(id){ return String(id).replace(/[^a-zA-Z0-9._-]/g, '_'); }

function resolveRoles(payload){
  const roles = {};
  for(const k of Object.keys(ROLES)){
    roles[k] = Object.assign({}, ROLES[k]);
    const o = payload.models && payload.models[k];
    if(typeof o === 'string' && o.trim()) roles[k].modelId = o.trim();
  }
  if(roles.judge.provider === roles.prover.provider){
    throw new Error('The judge must be a different provider than the prover (spec: blind judge).');
  }
  return roles;
}

export async function runLedgerBuild(task, dataJson){
  const payload = task.payload || {};
  const ids = (Array.isArray(payload.entityIds) && payload.entityIds.length ? payload.entityIds : [task.entityId]).filter(Boolean);
  if(!ids.length) return { result: null, summary: 'skipped \u2014 no entityId or payload.entityIds on this task' };
  if(ids.length > MAX_ENTRIES_PER_TASK){
    return { result: null, summary: 'skipped \u2014 ' + ids.length + ' entries on one task; the limit is ' + MAX_ENTRIES_PER_TASK };
  }
  const opts = { discover: payload.discover === true, force: !!payload.force, writeQc: !!payload.writeQc };
  const roles = resolveRoles(payload);

  tokensUsed = 0;
  mkdirSync(LEDGER_DIR, { recursive: true });
  const files = [];
  const entries = [];
  let stoppedEarly = '';
  let dataTouched = false;

  for(const id of ids){
    const entry = (dataJson.entries || []).find(e => e.id === id);
    if(!entry){ entries.push({ id, outcome: 'skipped', note: 'no entry with this id' }); continue; }
    if(!(entry.art && Array.isArray(entry.art.sections) && entry.art.sections.length)){
      entries.push({ id, name: entry.n, outcome: 'skipped', note: 'no article sections yet' }); continue;
    }
    const path = LEDGER_DIR + '/' + safeFileId(id) + '.json';
    if(!opts.force && existsSync(path)){
      try{
        const prev = JSON.parse(readFileSync(path, 'utf8'));
        if(prev && prev.articleHash === articleHash(entry)){
          entries.push({ id, name: entry.n, outcome: 'current', note: 'ledger already matches the article text' }); continue;
        }
      }catch(_e){ /* unreadable ledger: rebuild */ }
    }
    try{
      const ledger = await buildLedger(entry, opts, roles);
      writeFileSync(path, (MINIFY ? JSON.stringify(ledger) : JSON.stringify(ledger, null, 1)) + '\n');
      files.push(path);
      if(opts.writeQc){
        entry.qc = entry.qc || {};
        const s = ledger.summary;
        entry.qc.ledger = { status: (s.disputed || s.unsourced) ? 'review' : 'clean', verified: s.verified, disputed: s.disputed,
          unsourced: s.unsourced, traditional: s.traditional, total: s.total, checkedAt: ledger.checkedAt, articleHash: ledger.articleHash };
        dataTouched = true;
      }
      entries.push({ id, name: entry.n, outcome: 'built', file: path, summary: ledger.summary,
        sources: ledger.sourceHealth.filter(h => h.ok).length + '/' + ledger.sourceHealth.length + ' sources usable' });
    }catch(err){
      if(err && err.deferred){ stoppedEarly = String(err.message || 'rate limit or credits exhausted'); 
        if(!files.length && !entries.some(e => e.outcome === 'built')) throw err;
        entries.push({ id, name: entry.n, outcome: 'not done', note: 'stopped: ' + stoppedEarly });
        break;
      }
      entries.push({ id, name: entry.n, outcome: 'error', note: String((err && err.message) || err).slice(0, 300) });
    }
  }

  const built = entries.filter(e => e.outcome === 'built');
  const tot = { total: 0, verified: 0, disputed: 0, unsourced: 0, traditional: 0, missingNumbers: 0, missingNames: 0, uncoveredSentences: 0 };
  built.forEach(e => Object.keys(tot).forEach(k => { tot[k] += (e.summary && e.summary[k]) || 0; }));
  const remaining = stoppedEarly ? ids.slice(ids.indexOf((entries[entries.length - 1] || {}).id)) : [];

  const parts = [];
  if(built.length){
    parts.push(built.length + ' ledger' + (built.length === 1 ? '' : 's') + ': ' + tot.total + ' claims \u2014 ' +
      tot.verified + ' verified, ' + tot.traditional + ' traditional, ' + tot.disputed + ' disputed, ' + tot.unsourced +
      ' unsourced (' + tot.missingNumbers + ' with numbers absent from sources; ' + tot.missingNames + ' claims name something no source mentions); ' + tot.uncoveredSentences + ' digit-bearing sentences with no claim');
  }
  const other = entries.filter(e => e.outcome !== 'built');
  if(other.length) parts.push(other.map(e => (e.name || e.id) + ': ' + e.outcome + (e.note ? ' (' + e.note + ')' : '')).join('; '));
  if(stoppedEarly) parts.push('stopped early \u2014 ' + stoppedEarly + '; re-queue ' + remaining.join(', '));

  const outcome = {
    result: { entries, totals: tot, models: roles, stoppedEarly: stoppedEarly || undefined, remaining: remaining.length ? remaining : undefined },
    summary: parts.join(' | ').slice(0, 900) || 'nothing to build',
    provider: [...new Set(Object.values(roles).map(r => r.provider))].join('+'),
    tokensUsed
  };
  const commit = files.slice();
  if(dataTouched) commit.push(DATA_PATH);
  if(commit.length) outcome.filesToCommit = commit;
  return outcome;
}

// Exposed for the offline test harness only.
export const __test = { norm, numericKeys, hasNumber, splitSentences, chunkText, verifyExcerpt, articleHash, stripHtml, htmlToText, namePresence };
