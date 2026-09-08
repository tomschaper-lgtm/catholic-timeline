// scripts/services/image-finalize.mjs
//
// Service: "image-finalize"
//
// Runs after a human picks a winner in Picture Review, and again each time a human sends a
// finalized image back for another pass. Takes the reference image (the winning candidate the
// first time; the previous final image on a redo) and asks OpenAI to refine it to high quality
// via the images/edits endpoint (image-to-image, not a fresh text-to-image call) so the
// composition, subject, clothing, and setting already chosen survive into the result rather than
// being reinterpreted from scratch. Writes straight to the entry's permanent image path — but
// does NOT touch the entry's `img` field or delete the reference candidates itself. This is a
// human checkpoint, not the end of the line: it comes back as `awaiting_review` so a person can
// approve it (which is what actually links it into the entry) or send it back again. See
// tkResolveFinal() in index.html for that step.
//
// task.payload: { candidatePath, otherCandidatePath, notes }
// candidatePath is the reference image to refine from — a medium-quality candidate the first
// time, or the previous final image itself on a redo (see tkResolveFinal). otherCandidatePath is
// only ever the OTHER medium candidate from the first pass, cleaned up here since it's never
// used again either way; a redo passes null for it (nothing left to clean up).

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

  // The reference is spent either way — this pass just superseded it — EXCEPT when it's a redo
  // reading from finalPath itself, since that's the file just written above; deleting it now
  // would delete the very output this task exists to produce.
  if(payload.candidatePath !== finalPath) await unlinkQuiet(payload.candidatePath);
  if(payload.otherCandidatePath && payload.otherCandidatePath !== finalPath){
    await unlinkQuiet(payload.otherCandidatePath);
  }

  // Deliberately NOT setting entry.img or returning plain "done" here — a human still has to
  // approve this before it's linked into the entry. See the header comment above.
  return {
    awaitingReview: true,
    result: { entityId: entry.id, name: entry.n, finalPath },
    summary: 'refined image for ' + entry.n + ', awaiting approval',
    filesToCommit: Array.from(new Set(
      [finalPath, payload.candidatePath, payload.otherCandidatePath].filter(Boolean)
    ))
  };
}
