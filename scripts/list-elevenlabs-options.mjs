// Fetches your available ElevenLabs voices and models and writes a readable
// table to the GitHub Actions job summary (and stdout, as a fallback), so
// you can find a voice_id/model_id to paste into the narration workflow
// without leaving GitHub. Also doubles as an API-key sanity check — if the
// key is missing/invalid you'll see that immediately here.

import fs from 'node:fs/promises';

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) { console.error('Missing ELEVENLABS_API_KEY secret.'); process.exit(1); }

async function getJson(url) {
  const res = await fetch(url, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const [voicesData, modelsData] = await Promise.all([
    getJson('https://api.elevenlabs.io/v1/voices'),
    getJson('https://api.elevenlabs.io/v1/models')
  ]);
  const voices = voicesData.voices || [];
  const models = Array.isArray(modelsData) ? modelsData : (modelsData.models || []);

  let md = `## ElevenLabs Voices (${voices.length})\n\n`;
  md += '| Name | Voice ID | Category | Description |\n|---|---|---|---|\n';
  voices.forEach(v => {
    const desc = (v.description || '').replace(/\|/g, '/').slice(0, 90);
    md += `| ${v.name || ''} | \`${v.voice_id}\` | ${v.category || ''} | ${desc} |\n`;
  });

  md += `\n## ElevenLabs Models (${models.length})\n\n`;
  md += '| Name | Model ID | Languages |\n|---|---|---|\n';
  models.forEach(m => {
    const langs = (m.languages || []).map(l => (l && (l.name || l)) || '').filter(Boolean).slice(0, 6).join(', ');
    md += `| ${m.name || ''} | \`${m.model_id}\` | ${langs} |\n`;
  });

  md += '\nCopy a `Voice ID` into the narration workflow\'s `voice_id` field, and (optionally) a `Model ID` into `model_id`.\n';

  console.log(md);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await fs.appendFile(summaryPath, md);
}

main().catch(err => { console.error('ERROR: ' + err.message); process.exit(1); });
