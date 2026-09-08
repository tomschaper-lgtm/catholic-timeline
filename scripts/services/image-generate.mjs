// scripts/services/image-generate.mjs
//
// Service: "image-generate"
//
// One task = one entity. Builds a short scene request from the entry's own fields (name, year,
// feast day / location / region as appropriate for its type), appends the master art-direction
// instructions from IMAGE_INSTRUCTIONS.md, and generates TWO candidate images at medium quality
// via OpenAI's gpt-image-2. All the actual scene design — period, setting, composition, style —
// lives in IMAGE_INSTRUCTIONS.md, not in this file; this file only ever supplies the identifying
// facts OpenAI has no way to know on its own.
//
// This never touches data.json and never picks a winner — it hands back two files and asks to be
// reviewed. Picture Review (in the app) is where a human chooses, at which point a separate
// "image-finalize" task takes over.
//
// Requires IMAGE_INSTRUCTIONS.md to exist in the repo root, and IMAGEGEN_API_KEY set as a repo
// secret and passed through by the orchestrator workflow.

import { readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { stripHtml } from '../lib/text.mjs';

const MASTER_INSTRUCTIONS_PATH = 'Image_Generation.md';

const TYPE_FOLDERS = { s: 'Saints', c: 'Councils', p: 'Persecutions', m: 'Marian', u: 'Eucharistic', e: 'Events' };

// Fallback only — used when an entry has no explicit "Location"/"Region" Quick Fact to draw on.
// Not meant to be precise, just enough for OpenAI to place the scene roughly correctly.
const REGION_NAMES = {
  rome: 'Italy', west: 'Western Europe', brit: 'Britain and Ireland',
  east: 'Byzantium and Eastern Europe', holy: 'the Holy Land',
  africa: 'Africa', americas: 'the Americas', asia: 'Asia and Oceania'
};

function getFact(entry, label){
  const f = (entry.facts || []).find(f => f.label === label);
  return f ? f.value : '';
}
function locationOf(entry){
  return getFact(entry, 'Location') || REGION_NAMES[entry.r] || '';
}

// The six category lead-ins, confirmed with Tom — every one names "Catholic ___" up front since
// OpenAI has no built-in notion of this project. This is just the identifying header line;
// the actual scene is picked by the model itself, per Image_Generation.md \u00a71-3, using the
// full article text appended after it in the final prompt (see articleText() below).
export function buildSceneRequest(entry, note){
  let line;
  switch(entry.t){
    case 's': {
      const feast = getFact(entry, 'Feast day') || 'unknown';
      line = `Catholic saint - ${entry.n}, ${entry.y} AD, feast day ${feast}. Follow the included Md file.`;
      break;
    }
    case 'c':
      line = `Catholic Church council - ${entry.n}, convened ${entry.y} AD at ${locationOf(entry)}. Follow the included Md file.`;
      break;
    case 'p': {
      const region = getFact(entry, 'Region') || REGION_NAMES[entry.r] || '';
      line = `Catholic historical persecution - ${entry.n}, ${region}, ${entry.y} AD. Follow the included Md file.`;
      break;
    }
    case 'm':
      line = `Catholic Marian apparition - ${entry.n}, ${entry.y} AD, at ${locationOf(entry)}. Follow the included Md file.`;
      break;
    case 'u':
      line = `Catholic Eucharistic miracle - ${locationOf(entry)}, ${entry.y} AD. Follow the included Md file.`;
      break;
    case 'e':
    default:
      line = `Catholic historical event - ${entry.n}, ${entry.y} AD at ${locationOf(entry)}. Follow the included Md file.`;
      break;
  }
  if(note && note.trim()) line += `\nExtra note to consider: "${note.trim()}"`;
  return line;
}

// Section 1 of Image_Generation.md ("Read the Article First") and \u00a73 ("Choose the Most
// Meaningful Scene") both depend on the model actually having the article in front of it — this
// wasn't part of the original design and would have silently made those sections do nothing.
// Headings included, since \u00a73 explicitly favors scenes tied to named events, and a heading is
// often the clearest signal of which event a section covers.
export function articleText(entry){
  const sections = (entry.art && entry.art.sections) || [];
  return sections
    .map(s => {
      const heading = stripHtml(s.h || '').replace(/\s+/g, ' ').trim();
      const body = stripHtml(s.b || '').replace(/\s+/g, ' ').trim();
      if(!body) return '';
      return (heading ? heading + '\n' : '') + body;
    })
    .filter(Boolean)
    .join('\n\n');
}

async function generateOneImage(prompt, quality, apiKey){
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1024x1536', quality })
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    throw new Error('OpenAI images/generations ' + res.status + ': ' + errText.slice(0, 300));
  }
  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */
export async function runImageGenerate(task, dataJson){
  const apiKey = process.env.IMAGEGEN_API_KEY;
  if(!apiKey) throw new Error('Missing IMAGEGEN_API_KEY secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry){
    return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };
  }

  let masterInstructions;
  try{ masterInstructions = readFileSync(MASTER_INSTRUCTIONS_PATH, 'utf8'); }
  catch(e){ throw new Error(MASTER_INSTRUCTIONS_PATH + ' not found in repo root.'); }

  const note = (task.payload && task.payload.notes) || '';
  const headerLine = buildSceneRequest(entry, note);
  const article = articleText(entry);
  const prompt = [
    masterInstructions.trim(),
    '---',
    headerLine,
    article ? 'ARTICLE:\n' + article : '(No article text on file for this entry — use only the identifying details above and historically plausible detail per the guidelines.)'
  ].join('\n\n');

  const folder = TYPE_FOLDERS[entry.t] || 'Other';
  const dir = path.join('Images', folder);
  await fsp.mkdir(dir, { recursive: true });
  const pathA = path.join(dir, entry.id + '-candidate-a.png').split(path.sep).join('/');
  const pathB = path.join(dir, entry.id + '-candidate-b.png').split(path.sep).join('/');

  // Two separate calls, not one call asking for n=2 — keeps each candidate independently
  // retryable later and means a failure on one doesn't cost the other.
  const [bufA, bufB] = await Promise.all([
    generateOneImage(prompt, 'medium', apiKey),
    generateOneImage(prompt, 'medium', apiKey)
  ]);
  await fsp.writeFile(pathA, bufA);
  await fsp.writeFile(pathB, bufB);

  return {
    awaitingReview: true,
    result: {
      entityId: entry.id, name: entry.n,
      candidateA: pathA, candidateB: pathB,
      sceneRequest: headerLine, note
    },
    summary: 'generated 2 candidates for ' + entry.n,
    filesToCommit: [pathA, pathB]
  };
}
