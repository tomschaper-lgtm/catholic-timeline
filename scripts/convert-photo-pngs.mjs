#!/usr/bin/env node
// scripts/convert-photo-pngs.mjs
//
// PNG is lossless and compresses noisy photographic content very poorly — that's why
// resize-images.mjs's palette-PNG pass only shaves a little off a real photo saved as PNG.
// JPEG is built for exactly that case and is typically 5-10x smaller at a visually identical
// quality. This script finds PNGs under images/ that are heavy AND don't rely on real
// transparency (i.e. are photos, not logos/icons with a transparent background), converts
// them to JPEG, and — since the filename changes — updates every matching `img` field in
// data.json in the same pass, so no entry's photo silently breaks.
//
// This does NOT run automatically in CI (unlike resize-images.mjs). Changing a filename is a
// bigger deal than shrinking one in place, so this is meant to be run deliberately, reviewed
// (it prints exactly what it did), and committed by hand like any other change.
//
// USAGE (from the repo root, after checking out your repo):
//   npm install sharp
//   node scripts/convert-photo-pngs.mjs
//   git diff   # review: renamed image files + the data.json edits
//   git add -A && git commit -m "Convert heavy photo PNGs to JPEG" && git push

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const IMAGES_DIR = 'images';
const DATA_JSON = 'data.json';
const MIN_BYTES_TO_CONVERT = 300 * 1024; // only worth converting a PNG this large or bigger
const JPEG_QUALITY = 84;

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (path.extname(entry.name).toLowerCase() === '.png') out.push(full);
  }
  return out;
}

async function convert(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < MIN_BYTES_TO_CONVERT) return null; // small PNGs (icons, simple graphics) — leave alone
  const meta = await sharp(buffer).metadata();
  if (meta.hasAlpha) {
    // Real transparency (a logo, an icon with a see-through background, etc). Converting to
    // JPEG would flatten it onto a solid color and could look wrong — skip it. Rare among
    // article photos; worth a manual look if one turns up here.
    return { file, skipped: 'has transparency — left as PNG' };
  }
  const outBuffer = await sharp(buffer).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  const newFile = file.replace(/\.png$/i, '.jpg');
  fs.writeFileSync(newFile, outBuffer);
  fs.unlinkSync(file);
  return { file, newFile, before: buffer.length, after: outBuffer.length };
}

// Rewrites data.json's `img` field for every entry that pointed at a renamed file. Matches
// on the filename regardless of how the path is written (repo-relative like "images/x.png",
// with or without a leading slash) so it doesn't matter exactly how your img fields are
// formatted today.
function updateDataJson(renames) {
  if (!fs.existsSync(DATA_JSON)) {
    console.log(`\nNo ${DATA_JSON} found at the repo root — skipping the reference update.`);
    console.log('If your data file lives elsewhere, update these paths by hand:');
    renames.forEach(r => console.log(`  ${r.file}  ->  ${r.newFile}`));
    return;
  }
  const raw = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
  const entries = Array.isArray(raw) ? raw : raw.entries;
  if (!Array.isArray(entries)) {
    console.log(`\n${DATA_JSON} didn't parse into an entries array — skipping the reference update.`);
    return;
  }
  const byOldName = new Map(renames.map(r => [path.basename(r.file), path.basename(r.newFile)]));
  let updated = 0;
  entries.forEach(e => {
    if (!e.img) return;
    const base = path.basename(e.img);
    if (byOldName.has(base)) {
      e.img = e.img.replace(/\.png$/i, '.jpg');
      updated++;
    }
  });
  if (updated > 0) {
    fs.writeFileSync(DATA_JSON, JSON.stringify(raw, null, 2));
    console.log(`\nUpdated ${updated} entr${updated === 1 ? 'y' : 'ies'} in ${DATA_JSON} to point at the new .jpg files.`);
  } else {
    console.log(`\nNo entries in ${DATA_JSON} referenced the renamed files — nothing to update there.`);
  }
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.log('No images/ directory found — nothing to do.');
    return;
  }
  const pngs = walk(IMAGES_DIR);
  console.log(`Found ${pngs.length} PNG(s) under ${IMAGES_DIR}/, checking which are worth converting...`);
  const converted = [];
  const skipped = [];
  for (const file of pngs) {
    try {
      const result = await convert(file);
      if (!result) continue;
      (result.skipped ? skipped : converted).push(result);
    } catch (err) {
      console.error(`Error on ${file}: ${err.message}`);
    }
  }
  if (skipped.length) {
    console.log(`\nSkipped (has transparency):`);
    skipped.forEach(s => console.log(`  ${s.file}`));
  }
  if (!converted.length) {
    console.log('\nNothing converted.');
    return;
  }
  console.log(`\nConverted ${converted.length} PNG(s) to JPEG:`);
  converted.forEach(c => {
    const savedKb = ((c.before - c.after) / 1024).toFixed(0);
    const savedPct = ((1 - c.after / c.before) * 100).toFixed(0);
    console.log(`  ${c.file} -> ${c.newFile}  (${(c.before / 1024 / 1024).toFixed(1)}MB -> ${(c.after / 1024).toFixed(0)}KB, ~${savedPct}% smaller)`);
  });
  updateDataJson(converted);
}

main();
