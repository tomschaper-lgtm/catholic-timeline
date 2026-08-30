#!/usr/bin/env node
// scripts/work-articles.js
//
// Reads the Work List (db.tasks) in data.json, finds open tasks that are NOT
// image or audio tasks, drafts/updates the article for each matching entry
// using the real Claude API (server-side key, no artifact trick needed),
// and writes the result back into data.json. Meant to be run by GitHub
// Actions, which then opens a PR with the changes for review.
//
// Image and audio task types are deliberately skipped here — they get their
// own handler scripts later. This script only ever touches article content.

const fs = require('node:fs');
const path = require('node:path');

const DATA_PATH = path.join(__dirname, '..', 'data.json');
const SUMMARY_PATH = path.join(__dirname, 'work-summary.txt');
const MAX_TASKS_PER_RUN = parseInt(process.env.MAX_TASKS_PER_RUN || '5', 10);
const MODEL = 'claude-sonnet-4-6';
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Add it as a GitHub Actions secret named ANTHROPIC_API_KEY.');
  process.exit(1);
}

const TYPE_NAMES = { s: 'Saint', c: 'Ecumenical Council', p: 'Persecution', e: 'Event', m: 'Marian Apparition', u: 'Eucharistic Miracle' };
const FACT_HINTS = {
  s: 'Feast day; Born; Died; Title (e.g. Doctor of the Church, Martyr, Virgin, Pope); Beatified; Canonized; Patronage; Religious order; Major works; Attributes in art',
  c: 'Ecumenical number (e.g. 21st ecumenical); Convoked by; Location; Dates; Condemned; Defined; Key documents; Number of sessions',
  p: 'Regime or ruler; Region; Span of years; Cause; Notable martyrs; Estimated toll; Ended by',
  m: 'Seer(s); Location; Date(s); Title of Our Lady; Words or message; Approval status (diocesan or papal, with year); Feast day; Shrine',
  u: 'Location; Date; What occurred; Scientific findings; Approval status; Where venerated',
  e: 'Date; Location; Key figures; Significance; Related document or decree'
};

function isImageTask(t) { return /image|photo|picture/i.test(t || ''); }
function isAudioTask(t) { return /audio|narration|voice|tts/i.test(t || ''); }

// ---- Claude API helper: mirrors the in-app callClaude(), but with a real key ----
async function callClaude(userContent, maxTokens) {
  const messages = [{ role: 'user', content: userContent }];
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    if (!resp.ok) {
      let msg = 'HTTP ' + resp.status;
      try { const e = await resp.json(); if (e && e.error && e.error.message) msg = e.error.message; } catch (ignore) {}
      throw new Error(msg);
    }
    const data = await resp.json();
    if (data.stop_reason === 'pause_turn') {
      // Long-running web search paused the turn; send it back to continue.
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('Reply was cut off before finishing (max_tokens)');
    }
    return (data.content || []).map(b => (b.type === 'text' ? b.text : '')).join('');
  }
  throw new Error('Web search ran too long across retries');
}

function extractJson(text) {
  const clean = String(text).replace(/```json|```/g, '').trim();
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('No JSON found in the reply');
  return JSON.parse(clean.slice(s, e + 1));
}

function buildPrompt(entry, task) {
  const extra = task.notes ? '\nAdditional instruction from the work-list task: ' + task.notes : '';
  return 'Write an in-depth reference article on "' + entry.n + '" (' + (TYPE_NAMES[entry.t] || entry.t) + ', AD ' + entry.y + ', Catholic Church history). ' +
    'Search newadvent.org (Catholic Encyclopedia) first as the primary source; supplement with vatican.va, papal documents, or other reputable Catholic sources. Write from a faithful Catholic perspective, factual and precise with dates.' + extra + '\n' +
    'Respond ONLY with raw JSON, no fences:\n' +
    '{"sections":[{"h":"heading","b":"paragraphs separated by \\n\\n"}],"quotes":[{"text":"authentic quote","source":"attribution"}],"links":[{"label":"New Advent: ...","url":"https://www.newadvent.org/..."}],"facts":[{"label":"...","value":"..."}],"country":"..."}\n' +
    'Aim for depth: roughly 5-8 sections and about 900-1400 words total. Cover, as fits the subject: historical context and background; the life story or the events in detail; teaching, doctrine, or significance; controversies, opposition, or aftermath; and legacy, canonization, or veneration. Section bodies may use simple HTML (<b>, <i>, <u>, <ul>/<ol> with <li>, <br>) sparingly and purposefully.\n' +
    'quotes: 0-4 authentic, exactly-worded quotations with attribution — never invent or paraphrase a quotation.\n' +
    'links: New Advent first if it exists, then vatican.va or other reputable Catholic sources (up to 4 total).\n' +
    'facts: a Quick Facts list suited to this type. Use these labels where they genuinely apply — ' + (FACT_HINTS[entry.t] || FACT_HINTS.e) + '. Keep each value short. Omit any fact you cannot verify.';
}

async function main() {
  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  db.tasks = db.tasks || [];

  const openArticleTasks = db.tasks
    .filter(t => !t.completed && !isImageTask(t.taskType) && !isAudioTask(t.taskType))
    .slice(0, MAX_TASKS_PER_RUN);

  const touched = [];
  const failed = [];

  if (!openArticleTasks.length) {
    console.log('No open article tasks found.');
  }

  for (const task of openArticleTasks) {
    const entry = task.entityId ? db.entries.find(e => e.id === task.entityId) : null;
    if (!entry) {
      console.log('Skipping task ' + task.id + ': no entry matches entityId "' + task.entityId + '" (this script only updates existing entries, it does not create new ones yet)');
      continue;
    }

    console.log('Working on: ' + entry.n + ' (' + entry.y + ') — task: ' + task.taskType);
    try {
      const text = await callClaude(buildPrompt(entry, task), 8000);
      const parsed = extractJson(text);
      entry.art = {
        sections: parsed.sections || (entry.art && entry.art.sections) || [],
        quotes: parsed.quotes || [],
        links: parsed.links || []
      };
      if (parsed.facts) entry.facts = parsed.facts;
      if (parsed.country) entry.country = parsed.country;
      task.completed = new Date().toISOString().slice(0, 10);
      touched.push(entry.n + ' — ' + task.taskType);
      console.log('  done');
    } catch (err) {
      failed.push(entry.n + ' — ' + task.taskType + ' (' + err.message + ')');
      console.error('  FAILED: ' + err.message + ' (left incomplete, will retry next run)');
    }
  }

  const summaryLines = [];
  if (touched.length) {
    summaryLines.push('Articles written/updated:');
    touched.forEach(t => summaryLines.push('- ' + t));
  }
  if (failed.length) {
    summaryLines.push('');
    summaryLines.push('Failed (left open for retry):');
    failed.forEach(t => summaryLines.push('- ' + t));
  }
  if (!summaryLines.length) summaryLines.push('No open article tasks this run.');
  fs.writeFileSync(SUMMARY_PATH, summaryLines.join('\n') + '\n');

  if (touched.length) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 1));
    console.log('data.json updated.');
  } else {
    console.log('No changes to write.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
