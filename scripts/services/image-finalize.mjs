// scripts/services/image-finalize.mjs
//
// Service: "image-finalize"
//
// Runs after a human picks a winner in Picture Review. Takes the winning medium-quality
// candidate as a reference image, asks OpenAI to refine it to high quality via the images/edits
// endpoint (image-to-image, not a fresh text-to-image call) so the composition, subject,
// clothing, and setting the reviewer actually chose survive into the final version rather than
// being reinterpreted from scratch. Writes the final image, patches the entry's `img` field, and
// deletes both candidate files — the finalized image supersedes them either way, so there's
// nothing left for them to be a draft of.
//
// task.payload: { winningCandidate: 'a'|'b', candidatePath, otherCandidatePath, notes }

import { readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildSceneRequest, articleText } from './image-generate.mjs';

const MASTER_INSTRUCTIONS_PATH = 'Image_Generation.md';
const TYPE_FOLDERS = { s: 'Saints', c: 'Councils', p: 'Persecutions', m: 'Marian', u: 'Eucharistic', e: 'Events' };

async function unlinkQuiet(p){
  try{ await fsp.unlink(p); }catch(e){ /* already gone, or never committed — fine either way */ }
}

/**
 * Handler signature expected by scripts/orchestrator.mjs: (task, dataJson) => outcome
 */
export async function runImageFinalize(task, dataJson){
  const apiKey = process.env.IMAGEGEN_API_KEY;
  if(!apiKey) throw new Error('Missing IMAGEGEN_API_KEY secret (add it under repo Settings \u2192 Secrets \u2192 Actions).');

  const entry = (dataJson.entries || []).find(e => e.id === task.entityId);
  if(!entry){
    return { result: null, summary: 'skipped \u2014 no entry with id ' + task.entityId };
  }

  const payload = task.payload || {};
  if(!payload.candidatePath) throw new Error('task carries no candidatePath \u2014 nothing to finalize.');

  let masterInstructions;
  try{ masterInstructions = readFileSync(MASTER_INSTRUCTIONS_PATH, 'utf8'); }
  catch(e){ throw new Error(MASTER_INSTRUCTIONS_PATH + ' not found in repo root.'); }

  const headerLine = buildSceneRequest(entry, payload.notes || '');
  const article = articleText(entry);
  const promptParts = [
    masterInstructions.trim(),
    '---',
    headerLine,
    article ? 'ARTICLE:\n' + article : '(No article text on file for this entry.)',
    'This is a refinement pass on an already-chosen reference image. Preserve its composition, ' +
      'subject, clothing, setting, and camera framing as closely as possible \u2014 raise the ' +
      'quality and finish, don\u2019t redesign the scene.'
  ];
  const prompt = promptParts.join('\n\n');

  // The candidate this reads is already JPEG (image-generate.mjs writes candidates that way) —
  // sent as-is, no local re-encoding needed. output_format/output_compression ask OpenAI to hand
  // back JPEG too, so the refined result never exists as a PNG either. See image-generate.mjs
  // for why this is done server-side instead of with a local image library.
  const imgBuf = await fsp.readFile(payload.candidatePath);
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  form.append('output_format', 'jpeg');
  form.append('output_compression', '90');
  form.append('image', new Blob([imgBuf], { type: 'image/jpeg' }), 'reference.jpg');

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    body: form
  });
  if(!res.ok){
    const errText = await res.text().catch(() => '');
    throw new Error('OpenAI images/edits ' + res.status + ': ' + errText.slice(0, 300));
  }
  const data = await res.json();
  const finalBuf = Buffer.from(data.data[0].b64_json, 'base64'); // already JPEG bytes

  const folder = TYPE_FOLDERS[entry.t] || 'Other';
  const finalPath = path.join('Images', folder, entry.id + '.jpg').split(path.sep).join('/');
  await fsp.mkdir(path.dirname(finalPath), { recursive: true });
  await fsp.writeFile(finalPath, finalBuf);

  // The candidates are spent either way — this session picked one and it's now been superseded
  // by the refined version above, so nothing is left for either draft to be "the" copy of.
  await unlinkQuiet(payload.candidatePath);
  if(payload.otherCandidatePath) await unlinkQuiet(payload.otherCandidatePath);

  entry.img = finalPath;

  return {
    result: { entityId: entry.id, name: entry.n, img: finalPath },
    summary: 'finalized image for ' + entry.n,
    filesToCommit: ['data.json', finalPath, payload.candidatePath, payload.otherCandidatePath].filter(Boolean)
  };
}
