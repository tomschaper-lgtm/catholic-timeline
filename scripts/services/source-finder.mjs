// scripts/services/source-finder.mjs
//
// MODULE DATE: 2026-10-08 (Thursday) · v0.9.3 — "Jerome", LAYERS 1 + 2 + 3 (existence check; search a wide pool of sources, including several kinds of perspective; pick the best 3-4 and check there is enough; does it fit the category).
// Written against orchestrator.mjs / ledger-build.mjs v1.4 as uploaded to the Project 2026-10-07.
// Design: ARTICLE-PIPELINE-DESIGN-2026-10-07.md, section 4.1 and section 9. Layer 1 uses no AI and no
// network. Layer 2 calls Anthropic web search and fetches pages; it was tested with MOCKED search and
// fetch only (the build sandbox has no network) and has NEVER been run live. Treat the first live run
// as a pilot. Layer 3 (added v0.3) uses no AI and no network: it reads the pages layer 2 already fetched.
//
// WHAT THIS FILE DOES TODAY
//   Layer 1: decide whether the subject is already on the timeline.
//   Layer 2: find candidate source pages. Pass A searches ONLY the enabled allowlist domains
//            (Anthropic web search with allowed_domains). Only if the allowlist did not yield enough
//            verify-capable text (layer 3 rules: sufficiency.minWordsVerifyCapable, on
//            newSubjectMinDomains sites) does pass B search the open web. One good source can be enough.
//            PERSPECTIVE LANES (v0.5): sites have different strengths (biography, theology, Church documents,
//            primary texts, feast and devotion, an independent check). Even when the word target is met, Jerome
//            runs up to perspectives.maxExtraSearches extra allowlist searches for lanes this category should
//            have but does not yet (rules: perspectives). Lanes are Claude's starting guess; Tom edits them.
//            POOL (v0.6): Jerome keeps hunting until it has rules.selection.poolTarget substantive approved pages
//            (or hits the fetch caps), because layer 3 then picks only the best few from the pool. In rewrite mode the
//            entry's existing article links are tried first. The model only SUGGESTS URLs; code fetches
//            every page itself and records HTTP status, word count, and whether the subject's name is
//            really on the page. Pages from domains not in the registry are marked "unjudged" and are
//            never treated as proof: they wait for Ignatius (source-judge, not built) and Tom.
//   Layer 3: decide whether there is enough verify-capable material to write from, and whether the
//            subject passes the category rules (scripts/category-rules.json, editable). Output status:
//              ready          enough material, category passes: proceed to writing
//              needs_decision a person must look (unjudged pages that might make it enough, or the
//                             category rules say review: not canonized, scandal, apparition/miracle, ...)
//              too_thin       something usable was found but not enough, and nothing pending could fix it
//              not_found      nothing usable
//            SELECTION (v0.6): from everything found, layer 3 picks the best 3-4 pages (maxSelected 4): one per
//            lane in priority order first, then by score; the writer is given those, the rest are listed as
//            alsoFound. The enough-to-write check runs on the SELECTED pages: if only one qualifies, its word
//            count must pass the floor on its own.
//            ORCHESTRATOR + ARTICLE LOG (v0.9): runJerome(task, data) is the entry point for the orchestrator (task type
//            'source-find'). It runs runSourceFinder, adds Jerome's steps to article-log.json (scripts/services/article-log.mjs),
//            returns filesToCommit so the orchestrator commits the log, and stores only a compact result on the task (the
//            long per-page records stay out of workLog.json). Token use is counted by model for the cost column.
//            LIVE-PILOT FIXES (v0.8, after the first real run on St. Augustine): sites that refuse automated
//            fetching (HTTP 403, e.g. britannica.com) are listed in the rules (fetchBlockedDomains) and are never
//            searched or counted; a lane can exclude paths of a site (CCEL hosts encyclopedias that are not primary
//            texts); lane picks now fill all the selected slots before score does; the result carries timing and
//            the number of web searches (for the article log and for cost).
//            ANCIENT SAINTS (v0.7): for a saint up to the year limit, "venerated" is judged by DIFFERENT KINDS of
//            evidence (Roman liturgy, early calendars, the East, early witnesses, feast, tomb and relics, church
//            dedications, patronage), counted by type, with cautions (legendary, removed from the calendar).
//            Layer 3 finds EVIDENCE (short lowercased excerpts near the subject's name) for a person to
//            look at. It cannot prove a claim, and it does NOT check that two sources agree on who the
//            person is (same dates, same facts): that is Ignatius's and Aquinas's job. Not built: Ignatius,
//            and writing sources/<entry-id>.json. Page text is held in memory for layer 3 and is never
//            put in the returned result.
//
// TWO MODES
//   mode "new"     payload { name, category?, year? }   -> existence check (exact, alt names, fuzzy)
//   mode "rewrite" task.entityId (or payload.entityId)  -> NO existence check; the caller already
//                  knows the entry, so id/name/category/year are read from data.json as given.
//
// OUTCOMES (layer 1)
//   exists          exact name, alternate name, or id matched exactly one entry. Stop: nothing to write.
//   possible_match  nothing exact, but a close name (or an ambiguous exact one) exists. A human looks
//                   at `matches` and says "same subject" or "different". Never auto-resolved either way.
//   new_subject     nothing close. Layer 2 (search) is where this goes next.
//   rewrite_ready   rewrite mode, entry found.
//   error           bad input (no name, unknown entityId).
//
// MATCHING RULES (all deterministic, see fold() and scoreMatch())
//   - Case, accents, punctuation, "St."/"Saint"/"Pope"/"Blessed", "the", "of", "and" are ignored.
//   - Roman numerals become digits and MUST agree: "Celestine I" never matches "Celestine V" at
//     the exact level, and a numeral on only one side caps the score below the confident tier.
//   - Fuzzy = best of character similarity, shared-word overlap, and "one name contained in the
//     other". Score >= 0.80 is a "fuzzy" match, 0.60-0.79 is "weak"; both yield possible_match so a
//     typo ("Agustine") or a descriptor ("Augustine of Hippo") asks a human instead of silently
//     creating a duplicate. Category is reported (categoryMatch) but never filters.
//
// RULES FILE: scripts/category-rules.json (override with CATEGORY_RULES_PATH). If it is missing, layers 1
// and 2 still run and layer 3 reports an error instead of guessing.
//
// TASK SHAPE (when the orchestrator registers it; not registered yet):
//   { id, type: 'source-finder', status: 'queued', entityId?: '<id>',
//     payload: { mode: 'new'|'rewrite', name?: 'St. Bertha', category?: 's', year?: 723 } }
//   Registering = one import + one SERVICE_HANDLERS line in orchestrator.mjs. It writes no files and
//   uses no model, so it returns { result, summary } with no filesToCommit.
//
// CLI (for testing by hand):
//   node scripts/services/source-finder.mjs "Augustine of Hippo" --category s
//   node scripts/services/source-finder.mjs --rewrite st-augustine-430
//   DATA_PATH=path/to/data.json overrides the default data.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recordJerome, LOG_PATH, renderJob, loadPricing } from './article-log.mjs';

const DATA_PATH = process.env.DATA_PATH || 'data.json';
const T_FUZZY = 0.8;
const T_WEAK = 0.6;
const MAX_MATCHES = 5;

// Words that carry no identity. Dropped before comparing.
const STOP = new Set(['st', 'saint', 'saints', 'sts', 'ss', 'blessed', 'bl', 'venerable', 'pope',
  'the', 'of', 'de', 'and']);

// Roman numerals that appear in papal/regnal names. Limited on purpose: a lowercase "li", "mi" or
// "di" must never be read as a number.
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11,
  XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20, XXI: 21,
  XXII: 22, XXIII: 23 };

// ---------------------------------------------------------------------------------------------
// Name folding
// ---------------------------------------------------------------------------------------------

// Accents and special letters -> plain ASCII ("Wojtyła" -> "Wojtyla"). Shared by names and page text.
function asciiFold(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0141\u0142]/g, 'l').replace(/[\u00d8\u00f8]/g, 'o').replace(/[\u0110\u0111\u00d0\u00f0]/g, 'd')
    .replace(/[\u00c6\u00e6]/g, 'ae').replace(/[\u0152\u0153]/g, 'oe').replace(/\u00df/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// -> { tokens: [..identity words..], nums: [..digit strings..], key: 'canonical comparison string' }
export function fold(s) {
  const t = asciiFold(s)
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]s\b/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  const raw = t ? t.split(/\s+/) : [];
  const tokens = [];
  const nums = [];
  raw.forEach((w, i) => {
    const up = w.toUpperCase();
    const isLast = i === raw.length - 1;
    // Uppercase anywhere ("John Paul II"), or any case as the last word of a 2+ word name
    // ("celestine i"), and only for the listed numerals.
    if (ROMAN[up] && (w === up || (isLast && raw.length >= 2))) { nums.push(String(ROMAN[up])); return; }
    const lw = w.toLowerCase();
    if (/^\d+$/.test(lw)) { nums.push(String(parseInt(lw, 10))); return; }
    if (STOP.has(lw)) return;
    tokens.push(lw);
  });
  return { tokens, nums, key: tokens.join(' ') + (nums.length ? ' #' + nums.join('.') : '') };
}

// ---------------------------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------------------------

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const sameNums = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// 0..1. q and e are fold() results (query, entry-name).
export function scoreMatch(q, e) {
  const qs = q.tokens.join(' ');
  const es = e.tokens.join(' ');
  if (!qs || !es) return 0;
  const sq = new Set(q.tokens);
  const se = new Set(e.tokens);
  const inter = [...sq].filter(x => se.has(x)).length;
  const dice = (2 * inter) / (sq.size + se.size);
  const levr = 1 - lev(qs, es) / Math.max(qs.length, es.length);
  let cont = 0;
  if (inter > 0) {
    if (inter === se.size) cont = se.size >= 2 ? 0.85 : 0.7;        // whole entry name sits inside the query
    else if (inter === sq.size) cont = sq.size >= 2 ? 0.85 : 0.6;   // whole query sits inside the entry name
  }
  let score = Math.max(dice, levr, cont);
  // Numerals are identity: "Celestine I" is not "Celestine V".
  if (q.nums.length && e.nums.length && !sameNums(q.nums, e.nums)) score = Math.min(score, 0.5);
  else if (q.nums.length !== e.nums.length && (q.nums.length === 0 || e.nums.length === 0)) score = Math.min(score, 0.79);
  return score;
}

// ---------------------------------------------------------------------------------------------
// Existence check
// ---------------------------------------------------------------------------------------------

const brief = (e, level, score, via) => ({
  id: e.id, name: e.n, category: e.t || null, year: e.y == null ? null : e.y, region: e.r || null,
  level, score: Math.round(score * 100) / 100, via: via || null
});

// entries: data.json entries array. opts: { category, year }.
// Returns { level, matches[], ... } where level is exact|alt|id|fuzzy|weak|none.
export function checkExistence(name, entries, opts = {}) {
  const q = fold(name);
  if (!q.tokens.length && !q.nums.length) return { level: 'none', matches: [], note: 'name has no usable words' };
  const qSlug = String(name || '').trim().toLowerCase();
  const exact = [];
  const alt = [];
  const byId = [];
  const scored = [];

  for (const e of entries || []) {
    if (!e || !e.id) continue;
    if (qSlug && e.id.toLowerCase() === qSlug) { byId.push(brief(e, 'id', 1, 'id')); continue; }
    const en = fold(e.n);
    if (en.key && en.key === q.key) { exact.push(brief(e, 'exact', 1, e.n)); continue; }
    let altHit = null;
    for (const a of (Array.isArray(e.alt) ? e.alt : [])) {
      const af = fold(a);
      if (af.key && af.key === q.key) { altHit = a; break; }
    }
    if (altHit) { alt.push(brief(e, 'alt', 1, altHit)); continue; }
    // Fuzzy: best score over the display name and every alternate name.
    let best = scoreMatch(q, en);
    let via = e.n;
    for (const a of (Array.isArray(e.alt) ? e.alt : [])) {
      const s = scoreMatch(q, fold(a));
      if (s > best) { best = s; via = a; }
    }
    if (best >= T_WEAK) scored.push(brief(e, best >= T_FUZZY ? 'fuzzy' : 'weak', best, via));
  }

  const decorate = list => list.map(m => ({
    ...m,
    categoryMatch: opts.category ? m.category === opts.category : null,
    yearDelta: (opts.year != null && m.year != null) ? Math.abs(Number(opts.year) - m.year) : null
  }));

  scored.sort((a, b) => b.score - a.score);
  const hard = [...byId, ...exact, ...alt];
  if (hard.length) {
    const level = byId.length ? 'id' : exact.length ? 'exact' : 'alt';
    return { level, matches: decorate(hard.concat(scored).slice(0, MAX_MATCHES)), ambiguous: hard.length > 1 };
  }
  if (scored.length) {
    const level = scored[0].level; // fuzzy or weak
    return { level, matches: decorate(scored.slice(0, MAX_MATCHES)), ambiguous: false };
  }
  return { level: 'none', matches: [], ambiguous: false };
}

// ---------------------------------------------------------------------------------------------
// Subject resolution (both modes)
// ---------------------------------------------------------------------------------------------

export function findSubject(input, dataJson) {
  const entries = (dataJson && dataJson.entries) || [];
  const mode = input.mode === 'rewrite' || (!input.mode && input.entityId && !input.name) ? 'rewrite' : 'new';
  const note = 'Layer 1 result (who the subject is). Sources are searched and assessed in layers 2-3 whenever search is on; see the search and layer3 fields.';

  if (mode === 'rewrite') {
    const id = input.entityId;
    if (!id) return { outcome: 'error', mode, reason: 'rewrite mode needs an entityId' };
    const e = entries.find(x => x.id === id);
    if (!e) return { outcome: 'error', mode, reason: 'no entry with id ' + id };
    return {
      outcome: 'rewrite_ready', mode,
      subject: { id: e.id, name: e.n, category: e.t || null, year: e.y == null ? null : e.y, region: e.r || null,
        hasArticle: !!(e.art && Array.isArray(e.art.sections) && e.art.sections.length) },
      note
    };
  }

  const name = String(input.name || '').trim();
  if (!name) return { outcome: 'error', mode, reason: 'new mode needs a name' };
  const subject = { name, category: input.category || null, year: input.year == null ? null : Number(input.year) };
  const chk = checkExistence(name, entries, subject);

  if (chk.level === 'exact' || chk.level === 'alt' || chk.level === 'id') {
    if (chk.ambiguous && subject.category) {
      // The caller said what kind of thing this is; if that picks exactly one exact match, use it.
      const hard = chk.matches.filter(m => m.level === chk.level);
      const same = hard.filter(m => m.categoryMatch === true);
      if (same.length === 1) {
        return { outcome: 'exists', mode, subject, level: chk.level, match: same[0], matches: chk.matches,
          note: 'several entries share this name; the category picked one' };
      }
    }
    if (chk.ambiguous) {
      return { outcome: 'possible_match', mode, subject, level: chk.level, matches: chk.matches,
        reason: 'more than one entry matches this name exactly; a human must pick' };
    }
    return { outcome: 'exists', mode, subject, level: chk.level, match: chk.matches[0], matches: chk.matches };
  }
  if (chk.level === 'fuzzy' || chk.level === 'weak') {
    return { outcome: 'possible_match', mode, subject, level: chk.level, matches: chk.matches,
      reason: chk.level === 'fuzzy' ? 'a very similar name is already on the timeline'
        : 'a partly similar name is already on the timeline' };
  }
  return { outcome: 'new_subject', mode, subject, matches: [], note };
}

// ---------------------------------------------------------------------------------------------
// LAYER 2 — find candidate sources
// ---------------------------------------------------------------------------------------------

const ALLOWLIST_PATH = process.env.LEDGER_ALLOWLIST_PATH || 'scripts/ledger-allowlist.json';
const CACHE_DIR = process.env.SOURCE_CACHE_DIR || '.cache/source-finder';
const MIN_ALLOWLIST_SOURCES = 2;   // FALLBACK only (used when no layer 3 rules are given): fewer usable allowlisted pages than this -> widen to the open web
const MAX_FETCH_PER_PASS = 8;
const MAX_SEARCHES = 3;
const FETCH_TIMEOUT_MS = 20000;
const FETCH_GAP_MS = 600;          // minimum gap between requests to the same host
const MAX_PAGE_CHARS = 600000;
const FINDER_MODEL = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

const CATEGORY_LABEL = { s: 'saint', c: 'ecumenical council', p: 'persecution of Christians',
  m: 'Marian apparition', u: 'Eucharistic miracle', e: 'event in the history of the Catholic Church' };

// Never fetched, even in the open-web pass (the registry rules: no Wikipedia or mirrors, blogs, forums,
// social media). Hosts match with all their subdomains.
const NEVER_HOSTS = ['wikipedia.org', 'wikimedia.org', 'wikiwand.com', 'dbpedia.org', 'reddit.com', 'quora.com',
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'pinterest.com', 'youtube.com',
  'youtu.be', 'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com', 'tumblr.com', 'linkedin.com'];

let tokensUsed = 0;
// This run's search-call tokens, for the cost column. input = NEW input as the API reports it (cache reads and writes are separate).
// Requests whose whole prompt (input + cache read + cache write) is over LONG_PROMPT_TOKENS go in `long`, because some models
// (Haiku 5.5) charge a higher price for those. The bucket split is harmless for models that do not.
const LONG_PROMPT_TOKENS = 100000;
export const newTally = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, long: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
let usageTally = newTally();
export function addUsage(t, u) {
  const i = (u && u.input_tokens) || 0, o = (u && u.output_tokens) || 0, cr = (u && u.cache_read_input_tokens) || 0, cw = (u && u.cache_creation_input_tokens) || 0;
  const b = (i + cr + cw) > LONG_PROMPT_TOKENS ? t.long : t;
  b.input += i; b.output += o; b.cacheRead += cr; b.cacheWrite += cw;
}
const lastHit = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wordCount = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const hostMatches = (h, list) => list.some(d => h === d || h.endsWith('.' + d));

export function loadRegistry(path = ALLOWLIST_PATH) {
  if (!existsSync(path)) throw new Error('allowlist registry not found at ' + path + ' (commit scripts/ledger-allowlist.json first)');
  const r = JSON.parse(readFileSync(path, 'utf8'));
  if (!(r && r.tiers && Array.isArray(r.domains))) throw new Error('allowlist registry at ' + path + ' is not in the expected shape');
  return r;
}

// Most specific registry entry for a host (bible.usccb.org beats usccb.org).
export function regEntry(reg, host) {
  let best = null;
  for (const e of reg.domains) {
    if (host === e.domain || host.endsWith('.' + e.domain)) { if (!best || e.domain.length > best.domain.length) best = e; }
  }
  return best;
}

// https only, a real hostname, no IPs, no localhost, no credentials, no fragment.
export function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^\d+(\.\d+){3}$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  u.hash = '';
  return u.toString();
}

// Domains the search is restricted to in pass A: enabled, and not Scripture (a Bible text says nothing about a saint's life).
export function allowedDomains(reg) {
  return reg.domains.filter(e => e.enabled !== false && e.tier !== 'scripture').map(e => e.domain);
}

// ---- text utilities (copied from ledger-build so each service stands alone) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', eacute: '\u00e9',
  egrave: '\u00e8', agrave: '\u00e0', ouml: '\u00f6', uuml: '\u00fc', auml: '\u00e4', ccedil: '\u00e7' };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (_e) { return ' '; } })
    .replace(/&#(\d+);/g, (_m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (_e) { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}
function htmlToText(html) {
  let t = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
const plainWords = s => asciiFold(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---- page fetch (real) ----
async function realFetchPage(url) {
  const cp = CACHE_DIR + '/' + createHash('sha1').update(url).digest('hex') + '.json';
  try { if (existsSync(cp)) { const c = JSON.parse(readFileSync(cp, 'utf8')); if (c && c.ok && c.text) return c; } } catch (_e) { /* refetch */ }
  const host = new URL(url).hostname.toLowerCase();
  try {
    const wait = (lastHit.get(host) || 0) + FETCH_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    const res = await fetch(url, {
      redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'CatholicTimelineSourceBot/1.0 (+https://catholictimeline.org)', 'Accept': 'text/html,text/plain;q=0.9' }
    });
    if (res.status !== 200) return { url, ok: false, http: res.status, text: '', note: 'HTTP ' + res.status };
    const ctype = res.headers.get('content-type') || '';
    if (!/html|text\/plain|xml/i.test(ctype)) return { url, ok: false, http: 200, text: '', note: 'not a text page (' + ctype.slice(0, 40) + ')' };
    const buf = Buffer.from(await res.arrayBuffer());
    let charset = (/charset=([\w-]+)/i.exec(ctype) || [])[1];
    if (!charset) charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
    let html;
    try { html = new TextDecoder(charset || 'utf-8').decode(buf); } catch (_e) { html = buf.toString('utf8'); }
    const text = htmlToText(html).slice(0, MAX_PAGE_CHARS);
    if (text.length < 200) return { url, ok: false, http: 200, text: '', note: 'page has almost no text (may need JavaScript)' };
    const out = { url, ok: true, http: 200, text, note: '' };
    try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cp, JSON.stringify(out)); } catch (_e) { /* cache is optional */ }
    return out;
  } catch (err) {
    return { url, ok: false, http: 0, text: '', note: 'fetch failed: ' + String((err && err.message) || err).slice(0, 120) };
  }
}

// ---- web search (real): Anthropic web_search; URLs are harvested from the tool-result blocks, not from the
// model's prose, so nothing the model merely says can become a candidate. ----
async function realSearch({ query, allowedDomains, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret (needed for source search).');
  const tool = { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES };
  if (allowedDomains && allowedDomains.length) tool.allowed_domains = allowedDomains;
  const body = {
    model: model || FINDER_MODEL.modelId, max_tokens: 2000, tools: [tool],
    system: 'You locate web pages. Always use the search tool; never answer from memory. Search with different wording each time. Reply with one short line saying what you searched.',
    messages: [{ role: 'user', content: query }]
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = new Error('Anthropic search ' + res.status + ': ' + String(await res.text().catch(() => '')).slice(0, 300));
    err.status = res.status;
    if (res.status === 429 || /quota|credit|billing/i.test(err.message)) err.deferred = true;
    throw err;
  }
  const data = await res.json();
  tokensUsed += ((data.usage && data.usage.input_tokens) || 0) + ((data.usage && data.usage.output_tokens) || 0);
  addUsage(usageTally, data.usage);
  const results = [];
  let searches = 0;
  for (const b of data.content || []) {
    if (b.type === 'server_tool_use') searches++;
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r && r.type === 'web_search_result' && r.url) results.push({ url: r.url, title: r.title || '' });
    }
  }
  return { results, searches };
}

// ---- classify + fetch one candidate ----
// status: approved (enabled in the registry) | unjudged (domain not in the registry; waits for Ignatius)
//       | disabled (registry says off; not fetched) | blocked (never-allowed host; not fetched)
export async function examine(cand, subject, reg, deps) {
  const url = safeUrl(cand.url);
  if (!url) return { url: String(cand.url), status: 'blocked', usable: false, note: 'not a plain https page on a real host' };
  const host = new URL(url).hostname.toLowerCase();
  const out = { url, title: cand.title || '', domain: host, via: cand.via || null };
  if (hostMatches(host, NEVER_HOSTS)) return { ...out, status: 'blocked', usable: false, note: 'a never-allowed kind of site' };
  const e = regEntry(reg, host);
  if (e && e.enabled === false) return { ...out, status: 'disabled', tier: e.tier, usable: false, note: 'listed in the registry but not enabled' };
  out.status = e ? 'approved' : 'unjudged';
  if (e) { out.tier = e.tier; out.canVerify = !(reg.tiers[e.tier] && reg.tiers[e.tier].canVerify === false); }

  const f = await deps.fetchPage(url);
  out.http = f.http;
  if (!f.ok) return { ...out, usable: false, note: f.note || 'fetch failed' };

  const text = plainWords(f.text);
  const toks = fold(subject.name).tokens;
  const need = toks.length > 3 ? Math.ceil(toks.length * 0.75) : toks.length;
  const hits = toks.filter(t => new RegExp('\\b' + t + '\\b').test(text)).length;
  const lead = toks.slice().sort((a, b) => b.length - a.length)[0];
  out.words = wordCount(f.text);
  out.fetchedAt = new Date().toISOString();
  out.hash = createHash('sha256').update(f.text).digest('hex').slice(0, 16);
  out.namePresent = toks.length ? hits >= need : null;
  out.mentions = lead ? (text.match(new RegExp('\\b' + lead + '\\b', 'g')) || []).length : 0;
  out.titleHasName = toks.length ? toks.every(t => plainWords(cand.title || '').split(' ').includes(t)) : false;
  out.usable = !!out.namePresent;
  if (!out.usable) out.note = 'the subject\'s name does not appear on the page';
  // Page text for layer 3: in memory only (non-enumerable, so it never reaches JSON, logs or the result).
  Object.defineProperty(out, 'text', { value: asciiFold(f.text).toLowerCase().replace(/\s+/g, ' '), enumerable: false });
  return out;
}

const queryFor = (subject, variant, lane) => {
  const label = CATEGORY_LABEL[subject.category] || 'subject';
  if (variant === 'lane') return 'Find pages ' + lane.ask + ' this ' + label + ' in Catholic history: "' + subject.name + '"' +
    (subject.year != null ? ' (around the year ' + subject.year + ')' : '') + '.';
  if (variant === 'more') return 'Find additional in-depth pages about this ' + label + ' in Catholic history: "' + subject.name + '"' +
    (subject.year != null ? ' (around the year ' + subject.year + ')' : '') + '. Look for the full life or history, sources, and primary texts, not short summaries.';
  return 'Find web pages that give a substantial account of this ' + label + ' in Catholic history: "' + subject.name + '"' +
    (subject.year != null ? ' (around the year ' + subject.year + ')' : '') + '. Prefer reference works, official Church sources and long-form biographies.';
};

// ---------------------------------------------------------------------------------------------
// Perspective lanes (Tom's rule: different sites have different strengths; gather several kinds)
// ---------------------------------------------------------------------------------------------

const siteSpec = x => (typeof x === 'string' ? { domain: x } : x);

// Which lane does this URL belong to? A site with a pathPrefix is more specific than a whole-domain site,
// so path matches are tried first. A page belongs to at most one lane.
export function laneOf(url, lanes) {
  let u;
  try { u = new URL(url); } catch (_e) { return null; }
  const host = u.hostname.toLowerCase();
  const hostOk = d => host === d || host.endsWith('.' + d);
  const excluded = x => (x.exclude || []).some(pre => u.pathname.startsWith(pre));   // parts of a site that are NOT this kind of page
  for (const lane of lanes) for (const raw of lane.sites || []) { const x = siteSpec(raw); if (x.pathPrefix && hostOk(x.domain) && u.pathname.startsWith(x.pathPrefix) && !excluded(x)) return lane.id; }
  for (const lane of lanes) for (const raw of lane.sites || []) { const x = siteSpec(raw); if (!x.pathPrefix && hostOk(x.domain) && !excluded(x)) return lane.id; }
  return null;
}

// The lanes this category should have, in priority order; null when the rules define none (feature off).
export function perspectivePlan(rules, category) {
  const p = rules && rules.perspectives;
  if (!p || p.enabled === false || !p.lanes) return null;
  const order = (p.byCategory && p.byCategory[category]) || [];
  const blocked = (rules.fetchBlockedDomains || []).map(d => String(d).toLowerCase());
  const isBlocked = d => blocked.some(b => d === b || d.endsWith('.' + b));
  // a lane whose every site refuses automated fetching can never be filled: leave it out instead of wasting searches on it
  const lanes = order.filter(id => p.lanes[id]).map(id => ({ id, ...p.lanes[id] }))
    .filter(l => (l.sites || []).some(raw => !isBlocked(siteSpec(raw).domain.toLowerCase())));
  if (!lanes.length) return null;
  return { lanes, maxExtraSearches: p.maxExtraSearches == null ? 2 : p.maxExtraSearches, maxFetchPerLane: p.maxFetchPerLane || 4,
    minWords: p.minWordsPerLane == null ? 300 : p.minWordsPerLane, minMentions: p.minMentionsPerLane == null ? 1 : p.minMentionsPerLane,
    minLanesForRich: p.minLanesForRich == null ? 3 : p.minLanesForRich };
}

// Words gathered per lane from approved, usable pages that are really about the subject. A normal lane needs
// verify-capable pages; a contextOnly lane accepts any approved page (it adds perspective, never proof).
export function laneCoverage(sources, plan) {
  const cov = {};
  for (const lane of plan.lanes) cov[lane.id] = { id: lane.id, label: lane.label, contextOnly: !!lane.contextOnly, words: 0, pages: 0 };
  for (const s of sources || []) {
    if (!s.usable || s.status !== 'approved') continue;
    const id = laneOf(s.url, plan.lanes);
    if (!id) continue;
    const lane = plan.lanes.find(l => l.id === id);
    if (!lane.contextOnly && !s.canVerify) continue;
    if ((s.mentions || 0) < plan.minMentions) continue;
    cov[id].words += s.words || 0;
    cov[id].pages += 1;
  }
  for (const id of Object.keys(cov)) cov[id].covered = cov[id].words >= plan.minWords;
  return cov;
}

// The enabled registry domains behind a lane (searches are restricted to these).
function laneDomains(lane, reg, isBlocked = () => false) {
  const out = new Set();
  for (const raw of lane.sites || []) {
    const x = siteSpec(raw);
    const e = regEntry(reg, x.domain);
    if (e && e.enabled !== false && e.tier !== 'scripture' && !isBlocked(x.domain)) out.add(x.domain);
  }
  return [...out];
}


// subject: { name, category, year, links?[] }.  opts: { allowlistOnly, minWords?, targetWords?, minMentions?, minDomains?, perspectives?, poolTarget?, blockedDomains?, model }.
// From the layer 3 rules: minWords = floor (enough to write from; below it the open web is searched too),
// targetWords = plenty (below it a second allowlist search runs), minMentions = how often the name must appear
// for a page to count as substantive. Without minWords the old "MIN_ALLOWLIST_SOURCES usable pages" rule applies.
// deps (all optional, for tests): { registry, search({query, allowedDomains}), fetchPage(url) }.
export async function findSources(subject, opts = {}, deps = {}) {
  const reg = deps.registry || loadRegistry();
  const d = { fetchPage: deps.fetchPage || realFetchPage, search: deps.search || realSearch };
  const seen = new Set();
  const sources = [];
  const passes = [];

  const runPass = async (kind, cands, note, maxFetch = MAX_FETCH_PER_PASS) => {
    const fresh = [];
    for (const c of cands) {
      const u = safeUrl(c.url) || String(c.url);
      if (seen.has(u)) continue;
      seen.add(u);
      fresh.push(c);
    }
    let fetched = 0;
    const got = [];
    for (const c of fresh) {
      const url = safeUrl(c.url);
      const needsFetch = url && !hostMatches(new URL(url).hostname.toLowerCase(), NEVER_HOSTS);
      if (needsFetch && fetched >= maxFetch) { got.push({ url: c.url, status: 'skipped', usable: false, note: 'fetch limit for this pass reached' }); continue; }
      const ex = await examine({ ...c, via: kind }, subject, reg, d);
      if (ex.http !== undefined) fetched++;
      got.push(ex);
    }
    sources.push(...got);
    passes.push({ kind, note, seen: fresh.length, fetched, usable: got.filter(g => g.usable).length });
  };
  const usableApproved = () => sources.filter(s => s.usable && s.status === 'approved').length;
  // SUBSTANTIVE material = a page on an approved, verify-capable site that is really about the subject
  // (the name appears at least opts.minMentions times), not a passing mention. Layer 3 rules decide the
  // numbers; without them (opts.minWords unset) the old "MIN_ALLOWLIST_SOURCES usable pages" rule applies.
  const substantivePages = () => sources.filter(s => s.usable && s.status === 'approved' && s.canVerify && (s.mentions || 0) >= (opts.minMentions || 0));
  const subWords = () => substantivePages().reduce((n, s) => n + (s.words || 0), 0);
  const sitesOk = () => new Set(substantivePages().map(s => baseDomain(s.domain))).size >= (opts.minDomains || 1);
  // enough = the floor (enough to write from); rich = the target (plenty to write from).
  const enoughApproved = () => opts.minWords == null ? usableApproved() >= MIN_ALLOWLIST_SOURCES : (subWords() >= opts.minWords && sitesOk());
  const poolCount = () => sources.filter(s => s.usable && s.status === 'approved' && (s.mentions || 0) >= (opts.minMentions || 0)).length;
  const richApproved = () => opts.targetWords == null ? enoughApproved() : (subWords() >= opts.targetWords && sitesOk() && poolCount() >= (opts.poolTarget || 0));

  // Sites that refuse automated fetching (HTTP 403) are never searched; a search that includes them only wastes fetches.
  const blockedList = (opts.blockedDomains || []).map(x => String(x).toLowerCase());
  const isBlocked = dm => blockedList.some(b => dm === b || dm.endsWith('.' + b));
  const allowed = () => allowedDomains(reg).filter(dm => !isBlocked(dm.toLowerCase()));
  let webSearches = 0, searchCalls = 0;
  const countSearch = r => { searchCalls++; webSearches += (r && r.searches) || 0; return r; };

  // Pass 0 (rewrite only): the links the article already cites.
  if (Array.isArray(subject.links) && subject.links.length) {
    await runPass('existing-links', subject.links.map(u => ({ url: typeof u === 'string' ? u : u.url, title: typeof u === 'string' ? '' : (u.label || '') })), 'links already in the article');
  }
  // Pass A: allowlist only.
  if (!richApproved()) {
    const r = countSearch(await d.search({ query: queryFor(subject), allowedDomains: allowed(), model: opts.model }));
    await runPass('allowlist', r.results, 'search restricted to ' + allowed().length + ' enabled domains (' + (r.searches || 0) + ' searches)');
  }
  // Pass A2: still short of the TARGET (plenty of material)? One more allowlist search, worded differently,
  // so thin pages do not stop the hunt while better pages are still out there. Only runs when a target is set.
  if (opts.targetWords != null && !richApproved()) {
    const r = countSearch(await d.search({ query: queryFor(subject, 'more'), allowedDomains: allowed(), model: opts.model }));
    await runPass('allowlist-more', r.results, 'second allowlist search, different wording (' + (r.searches || 0) + ' searches); substantive words so far ' + subWords());
  }
  // Lane passes (v0.5): the word target says nothing about VARIETY. For each lane this category should have but
  // does not yet (in priority order, at most maxExtraSearches in all), one allowlist search restricted to that
  // lane's sites. Runs even when the target is already met, and in rewrite mode too.
  if (opts.perspectives) {
    const plan = opts.perspectives;
    let used = 0;
    for (const lane of plan.lanes) {
      if (used >= plan.maxExtraSearches) break;
      if (laneCoverage(sources, plan)[lane.id].covered) continue;
      const doms = laneDomains(lane, reg, dm => isBlocked(dm.toLowerCase()));
      if (!doms.length) continue;
      used++;
      const r = countSearch(await d.search({ query: queryFor(subject, 'lane', lane), allowedDomains: doms, model: opts.model }));
      await runPass('lane:' + lane.id, r.results, 'perspective search: ' + lane.label + ' (' + doms.length + ' sites; ' + (r.searches || 0) + ' searches)', plan.maxFetchPerLane);
    }
  }
  // Pass B: open web, only when the allowlist came up short.
  let widened = false;
  if (!enoughApproved() && !opts.allowlistOnly) {
    widened = true;
    const r = countSearch(await d.search({ query: queryFor(subject), allowedDomains: null, model: opts.model }));
    await runPass('open-web', r.results, 'open web (' + (r.searches || 0) + ' searches); new domains are unjudged until Ignatius and Tom decide');
  }

  const counts = {
    usableApproved: usableApproved(),
    usableUnjudged: sources.filter(s => s.usable && s.status === 'unjudged').length,
    unusable: sources.filter(s => !s.usable).length,
    totalWordsUsable: sources.filter(s => s.usable).reduce((n, s) => n + (s.words || 0), 0)
  };
  return { widened, passes, counts, webSearches, searchCalls, sources };
}

// ---------------------------------------------------------------------------------------------
// Selection: from the whole pool, the best few pages (Tom's rule: search wide, provide the best 3-4)
// ---------------------------------------------------------------------------------------------

export function selectSources(sources, rules, category) {
  const cfg = rules.selection || {};
  const maxSel = cfg.maxSelected || 4, maxDom = cfg.maxPerDomain || 2, maxCtx = cfg.maxContextOnly == null ? 1 : cfg.maxContextOnly;
  const W = cfg.weights || { words: 40, mentions: 30, titleHasName: 10 };
  const tw = cfg.tierWeight || {};
  const plan = perspectivePlan(rules, category);
  const minM = plan ? plan.minMentions : 1;
  const score = s => Math.round(((Math.min(s.words || 0, cfg.maxWordsCredited || 6000) / (cfg.maxWordsCredited || 6000)) * (W.words || 0) +
    (Math.min(s.mentions || 0, cfg.maxMentionsCredited || 20) / (cfg.maxMentionsCredited || 20)) * (W.mentions || 0) +
    (s.titleHasName ? (W.titleHasName || 0) : 0) + (tw[s.tier] || 0)) * 10) / 10;
  const cands = (sources || [])
    .filter(s => s.usable && s.status === 'approved' && (s.mentions || 0) >= minM)
    .map(s => ({ s, lane: plan ? laneOf(s.url, plan.lanes) : null, score: score(s) }))
    .sort((a, b) => b.score - a.score);
  const picks = [], dom = {};
  let ctx = 0;
  const can = c => picks.length < maxSel && !picks.includes(c) && (dom[baseDomain(c.s.domain)] || 0) < maxDom && (c.s.canVerify || ctx < maxCtx);
  const add = c => { picks.push(c); dom[baseDomain(c.s.domain)] = (dom[baseDomain(c.s.domain)] || 0) + 1; if (!c.s.canVerify) ctx++; };
  if (plan) for (const lane of plan.lanes) {            // one per lane, best first, in the category's priority order
    if (picks.length >= maxSel) break;
    const c = cands.find(x => x.lane === lane.id && can(x));
    if (c) add(c);
  }
  for (const c of cands) if (can(c)) add(c);
  if (!picks.some(c => c.s.canVerify)) {                // never hand over context only
    const v = cands.find(c => c.s.canVerify);
    if (v) { picks.sort((a, b) => a.score - b.score); if (picks.length >= maxSel) picks[0] = v; else picks.push(v); }
  }
  picks.sort((a, b) => b.score - a.score);
  const brief = c => ({ url: c.s.url, title: c.s.title, domain: c.s.domain, tier: c.s.tier, lane: c.lane, canVerify: !!c.s.canVerify,
    words: c.s.words, mentions: c.s.mentions, score: c.score });
  return { picked: picks.map(c => c.s), selected: picks.map(brief),
    alsoFound: cands.filter(c => !picks.includes(c)).map(c => ({ url: c.s.url, domain: c.s.domain, lane: c.lane, words: c.s.words, score: c.score })) };
}

// ---------------------------------------------------------------------------------------------
// LAYER 3 — is there enough to write from, and does the subject fit its category?
// No AI, no network. Reads the pages layer 2 fetched and scripts/category-rules.json.
// ---------------------------------------------------------------------------------------------

const RULES_PATH = process.env.CATEGORY_RULES_PATH || 'scripts/category-rules.json';

export function loadRules(path = RULES_PATH) {
  if (!existsSync(path)) throw new Error('category rules not found at ' + path + ' (commit scripts/category-rules.json first)');
  const r = JSON.parse(readFileSync(path, 'utf8'));
  if (!(r && r.sufficiency && r.categories)) throw new Error('category rules at ' + path + ' are not in the expected shape');
  return r;
}

const baseDomain = host => String(host || '').toLowerCase().split('.').slice(-2).join('.');

// Short lowercased excerpts where a pattern matches within `window` characters of the subject's name.
// One excerpt per pattern, at most `max` in all. A bad pattern in the rules file is skipped, not fatal.
export function evidence(text, patterns, lead, window = 300, max = 3) {
  const found = [];
  if (!text || !lead) return found;
  const leadRe = new RegExp('\\b' + lead + '\\b');
  for (const p of patterns || []) {
    let re;
    try { re = new RegExp(p, 'gi'); } catch (_e) { continue; }
    let m, guard = 0;
    while ((m = re.exec(text)) && guard++ < 300) {
      if (m[0] === '') { re.lastIndex++; continue; }
      const a = Math.max(0, m.index - window), b = Math.min(text.length, m.index + m[0].length + window);
      if (leadRe.test(text.slice(a, b))) {
        found.push(text.slice(Math.max(0, m.index - 70), Math.min(text.length, m.index + m[0].length + 70)).trim());
        break;
      }
    }
    if (found.length >= max) break;
  }
  return found;
}

// subject: { name, category, year }.  found: the result of findSources().  opts: { mode: 'new'|'rewrite' }.
export function assess(subject, found, rules, opts = {}) {
  const mode = opts.mode === 'rewrite' ? 'rewrite' : 'new';
  const suff = rules.sufficiency;
  const window = rules.window || 300;
  const toks = fold(subject.name).tokens;
  const generic = new Set((rules.genericNameWords || []).map(w => plainWords(w)));
  const specific = toks.filter(t => !generic.has(t));
  const lead = (specific.length ? specific : toks).slice().sort((a, b) => b.length - a.length)[0];
  const usable = (found.sources || []).filter(s => s.usable);
  const verify = usable.filter(s => s.status === 'approved' && s.canVerify);
  const reported = usable.filter(s => s.status === 'approved' && !s.canVerify);
  const unjudged = usable.filter(s => s.status === 'unjudged');
  const sum = list => list.reduce((n, s) => n + (s.words || 0), 0);
  const minM = suff.minMentionsPerPage || 0;
  const selection = selectSources(found.sources, rules, subject.category);
  // The enough-to-write-from check runs on the SELECTED pages only: what the writer will actually be given.
  const substantive = selection.picked.filter(s => s.canVerify && (s.mentions || 0) >= minM);   // really about the subject, not a passing mention
  const verifyWords = sum(substantive);
  const domains = new Set(substantive.map(s => baseDomain(s.domain)));
  const minDomains = mode === 'new' ? Math.max(1, suff.newSubjectMinDomains || 1) : 1;
  const enough = verifyWords >= suff.minWordsVerifyCapable && domains.size >= minDomains;
  const rich = suff.targetWordsVerifyCapable != null ? (verifyWords >= suff.targetWordsVerifyCapable && domains.size >= minDomains) : enough;
  const sufficiency = { verifyCapableWords: verifyWords, minWords: suff.minWordsVerifyCapable, targetWords: suff.targetWordsVerifyCapable,
    substantivePages: substantive.length, independentVerifyDomains: domains.size, minDomains, enough, rich,
    reportedPages: reported.length, unjudgedPages: unjudged.length };
  const flags = [];
  const decisions = [];
  const out = { mode, sufficiency, flags, decisions };

  if (!usable.length) { out.status = 'not_found'; out.reason = 'no page was fetched that names the subject'; return out; }
  out.selection = { selected: selection.selected, alsoFound: selection.alsoFound };
  if (selection.selected.length < (((rules.selection || {}).targetSelected) || 3)) flags.push('few_sources');

  // Perspective coverage (reported, never blocking): which kinds of site did we manage to hear from?
  const plan = perspectivePlan(rules, subject.category);
  if (plan) {
    const cov = laneCoverage(found.sources || [], plan);
    const covered = plan.lanes.filter(l => cov[l.id].covered).map(l => ({ id: l.id, label: l.label, words: cov[l.id].words, pages: cov[l.id].pages, ...(l.contextOnly ? { contextOnly: true } : {}) }));
    const missing = plan.lanes.filter(l => !cov[l.id].covered).map(l => l.id);
    out.perspectives = { wanted: plan.lanes.map(l => l.id), covered, missing };
    if (covered.length < Math.min(plan.minLanesForRich, plan.lanes.length)) flags.push('narrow_perspective');
  }

  // 1. Enough to write from?
  if (!enough) {
    const withUnjudged = verifyWords + sum(unjudged);   // unjudged pages are assumed substantive until Ignatius looks
    if (unjudged.length && withUnjudged >= suff.minWordsVerifyCapable) {
      out.status = 'needs_decision';
      decisions.push({ kind: 'unjudged_sources', urls: unjudged.map(s => s.url),
        reason: 'approved sources alone are too thin (' + verifyWords + ' of ' + suff.minWordsVerifyCapable + ' words), but these unjudged pages might make it enough; Ignatius and Tom decide whether they can be used' });
      out.reason = decisions[0].reason;
    } else {
      out.status = 'too_thin';
      out.reason = verify.length
        ? 'only ' + verifyWords + ' words of real material (need ' + suff.minWordsVerifyCapable + ') on ' + domains.size + ' verify-capable site(s)' + (domains.size < minDomains ? '; need ' + minDomains + ' independent sites' : '')
        : 'nothing found that can verify: ' + (reported.length ? reported.length + ' reported-tier page(s) cannot carry verification' : unjudged.length + ' unjudged page(s) are not yet approved');
    }
    return out;
  }
  if (domains.size === 1) flags.push('single_source');
  if (!rich) flags.push('thin_material');

  // 2. Category rules. Evidence comes from verify-capable pages only.
  const reasons = [];            // { kind, text }
  const ev = {};
  let basis = null;
  const cat = rules.categories[subject.category];
  const joined = verify.map(v => v.text || '').join(' ');
  const find = pats => evidence(joined, pats, lead, window);

  const nameWords = ' ' + plainWords(subject.name) + ' ';
  const scandalHit = ((rules.scandal && rules.scandal.nameTerms) || []).find(t => nameWords.includes(' ' + plainWords(t) + ' '));
  if (scandalHit) reasons.push({ kind: 'scandal', text: 'the name suggests a scandal ("' + scandalHit + '"); scandals go to review' });

  if (!cat) {
    reasons.push({ kind: 'category', text: 'category "' + subject.category + '" is not in the rules file' });
  } else if (cat.kind === 'saint') {
    const yr = subject.year;
    const partial = [];            // veneration signals that were found but did not add up to a basis
    const qualified = [];          // every basis that qualified, in priority order (the first becomes verdict.basis)
    for (const [name, b] of Object.entries(cat.bases || {})) {
      if (b.maxYear != null && !(yr != null && yr <= b.maxYear)) continue;
      if (b.signals) {
        // Different KINDS of evidence, not one phrase (see category-rules.json, ancient_veneration).
        const sig = {};
        for (const [type, def] of Object.entries(b.signals)) {
          const h = find(def.patterns);
          if (h.length) sig[type] = { strength: def.strength, excerpts: h };
        }
        // SITE signals: evidence that is where a page lives (an Orthodox site's own entry for him), not what it says.
        for (const v of verify) {
          let u;
          try { u = new URL(v.url); } catch (_e) { continue; }
          const host = u.hostname.toLowerCase(), path = u.pathname.toLowerCase();
          for (const sd of b.siteSignals || []) {
            if (!(host === sd.domain || host.endsWith('.' + sd.domain))) continue;
            if (sd.pathPrefix && !path.startsWith(sd.pathPrefix)) continue;
            if (sd.nameInSlug && !(lead && path.includes(lead))) continue;
            if ((v.mentions || 0) < (sd.minMentions || 1)) continue;
            const def = b.signals[sd.signal];
            if (!def) continue;
            const slot = sig[sd.signal] || (sig[sd.signal] = { strength: def.strength, excerpts: [] });
            if (slot.excerpts.length < 4) slot.excerpts.push('[site] ' + sd.label + ': ' + v.url);
          }
        }
        const types = Object.keys(sig);
        if (!types.length) continue;
        const cautions = find(b.cautions);
        const rule = b.accept || {};
        const strong = types.filter(t => sig[t].strength === 'strong');
        const decisive = (rule.decisiveTypes || []).some(t => sig[t]);
        const meets = decisive || (types.length >= (rule.minDistinctTypes == null ? 2 : rule.minDistinctTypes) && strong.length >= (rule.minStrong == null ? 1 : rule.minStrong));
        ev[name] = { signals: sig, ...(cautions.length ? { cautions } : {}) };
        if (meets && !cautions.length) { qualified.push(name); if (!basis) basis = name; }
        else if (cautions.length) partial.push('veneration signals found (' + types.join(', ') + ') but the sources raise doubt about the person; a human must decide');
        else partial.push(strong.length ? 'only one kind of veneration signal (' + types.join(', ') + '); ' + (rule.minDistinctTypes || 2) + ' different kinds are needed'
          : 'no strong veneration signal (only ' + types.join(', ') + '); at least one strong kind is needed');
        continue;
      }
      const hits = find(b.patterns);
      if (hits.length) { ev[name] = hits; qualified.push(name); if (!basis) basis = name; }
    }
    if (qualified.length > 1) ev.also_qualified = qualified.slice(1);
    if (!basis) {
      const nc = {};
      for (const [name, pats] of Object.entries(cat.notCanonized || {})) { if (name.startsWith('_')) continue; const h = find(pats); if (h.length) nc[name] = h; }
      if (Object.keys(nc).length) { ev.not_canonized = nc; reasons.push({ kind: 'basis', text: 'not canonized: the sources suggest ' + Object.keys(nc).join(' / ').replace(/_/g, ' ') + ' status, and no basis for sainthood was found' }); }
      else if (partial.length) reasons.push({ kind: 'basis', text: partial.join('; ') + '; no other basis for sainthood found' });
    else reasons.push({ kind: 'basis', text: 'no basis for sainthood found near the name (New Testament figure, ancient veneration, or formal canonization)' });
    }
  } else if (cat.kind === 'review') {
    let sig = cat.signals;
    if (typeof sig === 'string') sig = (rules.categories[sig.replace(/^same as /, '')] || {}).signals;
    const sigs = {};
    for (const [name, pats] of Object.entries(sig || {})) { const h = find(pats); if (h.length) sigs[name] = h; }
    if (Object.keys(sigs).length) ev.approval_signals = sigs;
    reasons.push({ kind: 'basis', text: cat.reason || 'this category is set to review' });
  } else if (cat.kind === 'reject') {
    reasons.push({ kind: 'reject', text: cat.reason || 'this category is not accepted' });
  }
  // kind "accept": nothing further to check

  // In rewrite mode the basis checks are advisory (the entry already exists); a scandal still blocks.
  const blocking = reasons.filter(r => r.kind === 'scandal' || r.kind === 'reject' || mode === 'new' || rules.enforceBasisChecksInRewrite === true);
  const advisory = reasons.filter(r => !blocking.includes(r));
  out.verdict = { action: blocking.some(r => r.kind === 'reject') ? 'reject' : blocking.length ? 'review' : 'accept',
    basis, reasons: blocking, ...(advisory.length ? { advisory } : {}), evidence: ev };
  if (advisory.length) flags.push('category_advisory');

  if (out.verdict.action === 'accept') { out.status = 'ready'; }
  else {
    out.status = 'needs_decision';
    decisions.push({ kind: 'category_' + out.verdict.action, reason: blocking.map(r => r.text).join('; ') });
    out.reason = decisions[decisions.length - 1].reason;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Orchestrator handler (not registered yet). Layer 2 writes no files; layer 1 uses no model.
// payload: { mode, name, category, year, entityId, confirmNew, search, allowlistOnly, model }
//   confirmNew: after a possible_match, a human says "different subject"; proceed to search.
//   search:     false = layer 1 only.
//   assess:     false = skip layer 3 (default: layer 3 runs after a search).
// ---------------------------------------------------------------------------------------------

export async function runSourceFinder(task, dataJson, deps = {}) {
  const p = task.payload || {};
  tokensUsed = 0;
  usageTally = newTally();
  const out = findSubject({ mode: p.mode, name: p.name, category: p.category, year: p.year, entityId: p.entityId || task.entityId }, dataJson);

  const proceed = p.search !== false && (out.outcome === 'new_subject' || out.outcome === 'rewrite_ready' ||
    (out.outcome === 'possible_match' && p.confirmNew === true));
  let found = null;
  if (proceed) {
    const subject = out.outcome === 'rewrite_ready'
      ? { name: out.subject.name, category: out.subject.category, year: out.subject.year,
          links: ((((dataJson.entries || []).find(e => e.id === out.subject.id) || {}).art || {}).links || []) }
      : out.subject;
    const tStart = Date.now();
    let rules = null, rulesError = null;
    try { rules = deps.rules || loadRules(); } catch (err) { rulesError = String((err && err.message) || err).slice(0, 300); }
    const mode = out.outcome === 'rewrite_ready' ? 'rewrite' : 'new';
    const opts = { allowlistOnly: p.allowlistOnly === true, model: p.model };
    if (rules) { opts.minWords = rules.sufficiency.minWordsVerifyCapable; opts.targetWords = rules.sufficiency.targetWordsVerifyCapable; opts.minMentions = rules.sufficiency.minMentionsPerPage || 0; opts.minDomains = mode === 'new' ? Math.max(1, rules.sufficiency.newSubjectMinDomains || 1) : 1; opts.perspectives = perspectivePlan(rules, subject.category); opts.poolTarget = (rules.selection && rules.selection.poolTarget) || 0; opts.blockedDomains = rules.fetchBlockedDomains || []; }
    try {
      found = await findSources(subject, opts, deps);
    } catch (err) {
      if (err && err.deferred) throw err;
      out.search = { error: String((err && err.message) || err).slice(0, 300) };
    }
    if (found) {
      out.search = found;
      out.timing = { seconds: Math.round((Date.now() - tStart) / 100) / 10, webSearches: found.webSearches || 0, searchCalls: found.searchCalls || 0,
        pagesFetched: (found.passes || []).reduce((n, x) => n + (x.fetched || 0), 0),
        model: p.model || FINDER_MODEL.modelId, inputTokens: usageTally.input, outputTokens: usageTally.output,
        cacheReadTokens: usageTally.cacheRead, cacheWriteTokens: usageTally.cacheWrite,
        ...(usageTally.long.input || usageTally.long.output || usageTally.long.cacheRead || usageTally.long.cacheWrite
          ? { longPrompt: { inputTokens: usageTally.long.input, outputTokens: usageTally.long.output, cacheReadTokens: usageTally.long.cacheRead, cacheWriteTokens: usageTally.long.cacheWrite } } : {}) };
      out.layer2 = found.counts.usableApproved + found.counts.usableUnjudged > 0 ? 'candidates_found' : 'no_candidates';
      if (p.assess !== false) {
        try { if (!rules) throw new Error(rulesError); out.layer3 = assess(subject, found, rules, { mode }); }
        catch (err) { out.layer3 = { status: 'error', reason: String((err && err.message) || err).slice(0, 300) }; }
      }
    }
  }

  const cnt = found ? found.counts : null;
  let summary;
  switch (out.outcome) {
    case 'exists': summary = out.subject.name + ' is already on the timeline as ' + out.match.name + ' (' + out.match.id + ', ' + out.level + ' match)'; break;
    case 'possible_match': summary = out.subject.name + ': similar entries exist (' + out.matches.map(m => m.name + ' ' + m.score).join(', ') + ')' +
      (found ? ' — proceeded because confirmNew was set' : ' — needs a human look; re-queue with confirmNew:true if it is a different subject'); break;
    case 'new_subject': summary = out.subject.name + ' is not on the timeline'; break;
    case 'rewrite_ready': summary = 'rewrite of ' + out.subject.name + ' (' + out.subject.id + ')'; break;
    default: summary = 'error — ' + out.reason;
  }
  if (cnt) summary += ' | sources: ' + cnt.usableApproved + ' usable allowlisted, ' + cnt.usableUnjudged + ' usable unjudged, ' +
    cnt.unusable + ' unusable, ' + cnt.totalWordsUsable + ' words' + (found.widened ? ' (widened to open web)' : '') +
    (out.layer3 ? ' | layer 3: ' + out.layer3.status + (out.layer3.reason ? ' — ' + out.layer3.reason : '') + (out.layer3.flags && out.layer3.flags.length ? ' [' + out.layer3.flags.join(', ') + ']' : '') : '') +
    (out.layer3 && out.layer3.selection ? ' | selected ' + out.layer3.selection.selected.length + ' of ' + (out.layer3.selection.selected.length + out.layer3.selection.alsoFound.length) + ' pages' : '') +
    (out.layer3 && out.layer3.perspectives ? ' | perspectives ' + out.layer3.perspectives.covered.length + '/' + out.layer3.perspectives.wanted.length +
      ' (' + out.layer3.perspectives.covered.map(c => c.id).join(', ') + (out.layer3.perspectives.missing.length ? '; missing ' + out.layer3.perspectives.missing.join(', ') : '') + ')' : '');
  else if (out.search && out.search.error) summary += ' | source search failed: ' + out.search.error;
  return { result: out, summary: summary.slice(0, 900), provider: found ? FINDER_MODEL.provider : 'none', tokensUsed };
}

// ---------------------------------------------------------------------------------------------
// Orchestrator entry point (task type 'source-find').  The orchestrator calls handler(task, dataJson, workLog).
//   task.payload: the same fields as runSourceFinder, plus  jobId (links this run to the article job's log; defaults to the
//   task id) and requestedBy (optional name shown in the log).
// Adds Jerome's steps to article-log.json and returns filesToCommit: [that file] so the orchestrator commits it.
// A failure to write the log never fails the task: it is reported in the summary instead.
// ---------------------------------------------------------------------------------------------

// What is kept on the task in workLog.json: everything a person or the next step needs, minus the long per-page records.
export function compactResult(r) {
  const c = { ...r };
  if (c.search && c.search.sources) c.search = { widened: c.search.widened, passes: c.search.passes, counts: c.search.counts, webSearches: c.search.webSearches, searchCalls: c.search.searchCalls };
  return c;
}

export async function runJerome(task, dataJson, _workLog, deps = {}) {
  const out = await runSourceFinder(task, dataJson, deps);
  const logPath = deps.logPath || LOG_PATH;
  let note = '';
  const filesToCommit = [];
  try {
    recordJerome({ result: out.result, task, logPath, now: deps.now });
    filesToCommit.push(logPath);
  } catch (err) {
    note = ' | article log not written: ' + String((err && err.message) || err).slice(0, 120);
  }
  return { ...out, result: compactResult(out.result), summary: (out.summary + note).slice(0, 900), ...(filesToCommit.length ? { filesToCommit } : {}) };
}

// ---------------------------------------------------------------------------------------------
// CLI:  node scripts/services/source-finder.mjs "St. Bertha" --category s [--year 723] [--search] [--confirm-new] [--log] [--job <id>] [--model <model id>]
//       node scripts/services/source-finder.mjs --rewrite st-augustine-430 [--search]
// Without --search only layer 1 runs (no network). --search needs ANTHROPIC_API_KEY.
// ---------------------------------------------------------------------------------------------

async function cli(argv) {
  const args = argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const rewrite = get('--rewrite');
  const name = args.find((a, i) => !a.startsWith('--') && !['--category', '--year', '--rewrite', '--job', '--model'].includes(args[i - 1]));
  const dataJson = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const task = { payload: rewrite
    ? { mode: 'rewrite', entityId: rewrite, search: args.includes('--search'), model: get('--model') }
    : { mode: 'new', name, category: get('--category'), year: get('--year'), search: args.includes('--search'),
        confirmNew: args.includes('--confirm-new'), model: get('--model') } };
  const out = await runSourceFinder(task, dataJson);
  console.log(out.summary);
  console.log(JSON.stringify(out.result, null, 2));
  if (args.includes('--log')) {                                // add this run to article-log.json (the pilot workflow commits it)
    const job = recordJerome({ result: out.result, task: { payload: { ...task.payload, jobId: get('--job') } } });
    console.error('\n' + renderJob(job, loadPricing()).join('\n'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) cli(process.argv).catch(e => { console.error(e.message || e); process.exit(1); });
