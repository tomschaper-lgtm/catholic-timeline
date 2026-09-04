#!/usr/bin/env node
// scripts/convert-photo-pngs.mjs
//
// v2: broadened from "heavy PNGs only" to "anything under images/ that isn't already a JPEG."
// The trigger was two new .heic photos (iPhone's default format) for the Jacinta/Francisco
// entries, but the brief was general: scan the whole folder, convert whatever isn't JPEG,
// regardless of size. So the old MIN_BYTES_TO_CONVERT gate is gone — a small WebP or BMP gets
// converted too, not just multi-megabyte photos. (Filename kept as convert-photo-pngs.mjs
// rather than renamed, since that's what the Action and any button in the app call by name.)
//
// PNG is lossless and compresses noisy photographic content very poorly — that's why
// resize-images.mjs's palette-PNG pass only shaves a little off a real photo saved as PNG.
// JPEG is built for exactly that case and is typically 5-10x smaller at a visually identical
// quality. This script finds every non-JPEG image under images/, converts it to JPEG, and —
// since the filename changes — updates every matching `img` field in data.json in the same
// pass, so no entry's photo silently breaks.
//
// HEIC/HEIF is handled separately from everything else. sharp's prebuilt binaries advertise
// ".heic" as a recognized suffix, but decoding real iPhone HEIC (HEVC-coded) files with the
// plain `npm install sharp` binary reliably fails with "Unsupported compression" — full HEIC
// support needs a globally-installed libvips built against libheif/libde265/x265, which a
// bare `npm install` in CI does not give you. heic-convert (pure JS, via a WASM libheif) works
// the same everywhere without any of that, so HEIC/HEIF are decoded with it and then handed to
// sharp — as a lossless intermediate PNG buffer, not heic-convert's own JPEG output — so there
// is exactly one JPEG encode, at this script's own quality setting, not two lossy passes.
//
// This does NOT run automatically in CI (unlike resize-images.mjs). Changing a filename is a
// bigger deal than shrinking one in place, so this is meant to be run deliberately, reviewed
// (it prints exactly what it did), and committed by hand like any other change.
//
// USAGE (from the repo root, after checking out your repo):
//   npm install sharp heic-convert
//   node scripts/convert-photo-pngs.mjs
//   git diff   # review: renamed image files + the data.json edits
//   git add -A && git commit -m "Convert non-JPEG photos to JPEG" && git push

import sharp from 'sharp';
import heicConvert from 'heic-convert';
import fs from 'fs';
import path from 'path';

const IMAGES_DIR = 'Images'; // the legacy capitalized folder where your photos actually live
const DATA_JSON = 'data.json';
const JPEG_QUALITY = 84;

// Anything with one of these extensions gets scanned. .jpg/.jpeg are the target format, so
// they're deliberately absent — a file already in that format is left alone.
const HEIC_EXTS = new Set(['.heic', '.heif']);
const SHARP_EXTS = new Set(['.png', '.webp', '.tif', '.tiff', '.bmp', '.gif']);
const CONVERTIBLE_EXTS = new Set([...HEIC_EXTS, ...SHARP_EXTS]);

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full));
    } else if (CONVERTIBLE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

async function convert(file) {
  const ext = path.extname(file).toLowerCase();
  const buffer = fs.readFileSync(file);

  const newFile = file.slice(0, -ext.length) + '.jpg';
  if (fs.existsSync(newFile)) {
    // Don't clobber an unrelated file that already happens to have this name — surface it
    // instead of guessing which one should win.
    return { file, skipped: `target ${newFile} already exists — left as ${ext}` };
  }

  // HEIC/HEIF can't reliably go through sharp directly (see the header comment) — decode with
  // heic-convert to a lossless PNG buffer first, then let sharp do the actual JPEG encode below
  // like every other format, so quality/orientation handling stays in one place.
  let sharpInput = buffer;
  if (HEIC_EXTS.has(ext)) {
    sharpInput = await heicConvert({ buffer, format: 'PNG' });
  }

  const img = sharp(sharpInput);
  const meta = await img.metadata();

  if (meta.hasAlpha) {
    // Real transparency (a logo, an icon with a see-through background, etc). Converting to
    // JPEG would flatten it onto a solid color and could look wrong — skip it. Rare among
    // article photos; worth a manual look if one turns up here.
    return { file, skipped: 'has transparency — left as ' + ext };
  }
  if (meta.pages && meta.pages > 1) {
    // An animated GIF (or multi-page TIFF) — JPEG has no equivalent, converting would silently
    // keep only the first frame. Left alone rather than quietly losing the animation.
    return { file, skipped: `${meta.pages} frames/pages (animated?) — left as ${ext}` };
  }

  // autoOrient() reads the EXIF Orientation tag (when there is one) and bakes the rotation into
  // the pixels before the tag is dropped, so a sideways phone photo comes out upright. It's a
  // no-op when there's no orientation tag to act on, which is the normal case for the PNG buffer
  // heic-convert just produced — HEIC's own rotation is typically already baked in by the time
  // it's decoded, so this is a safety net for the other formats, not a fix for HEIC specifically.
  const outBuffer = await img.autoOrient().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();

  fs.writeFileSync(newFile, outBuffer);
  fs.unlinkSync(file);
  return { file, newFile, before: buffer.length, after: outBuffer.length, wasHeic: HEIC_EXTS.has(ext) };
}

// Rewrites data.json's `img` field for every entry that pointed at a renamed file. Matches on
// the filename regardless of how the path is written (repo-relative like "images/x.heic", with
// or without a leading slash, any of the convertible extensions) so it doesn't matter exactly
// how your img fields are formatted today.
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
  // Old basename -> new basename, straight string swap rather than an extension-only regex, so
  // this works no matter which of the convertible extensions the original file had.
  const byOldName = new Map(renames.map(r => [path.basename(r.file), path.basename(r.newFile)]));
  let updated = 0;
  entries.forEach(e => {
    if (!e.img) return;
    const base = path.basename(e.img);
    if (byOldName.has(base)) {
      e.img = e.img.replace(base, byOldName.get(base));
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

// Second, separate pass: catches ANY entry whose `img` points at a file that doesn't exist on
// disk — not just the ones this run's convert() calls renamed. A file can go stale for reasons
// this script never touched: a manual rename in the GitHub web UI, a typo, some other tool.
//
// Only acts when exactly one same-name-different-extension candidate exists in that file's own
// folder. Zero candidates or more than one both get reported instead of guessed at — same
// "never guess, never silent" rule this project already applies to patch matching and entry
// ids (see json-import-skill.md). Picking the wrong one of two same-named files silently would
// be worse than leaving the entry broken and visible.
function healBrokenImageRefs() {
  if (!fs.existsSync(DATA_JSON)) return;
  const raw = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
  const entries = Array.isArray(raw) ? raw : raw.entries;
  if (!Array.isArray(entries)) return;

  let healed = 0;
  const unresolved = [];
  const ambiguous = [];

  entries.forEach(e => {
    if (!e.img) return;
    if (/^https?:\/\//i.test(e.img)) return; // hosted elsewhere — not a repo file to check
    const relPath = e.img.replace(/^\//, ''); // tolerate a leading slash either way
    if (fs.existsSync(relPath)) return; // already resolves — nothing to heal

    const dir = path.dirname(relPath);
    const stem = path.basename(relPath, path.extname(relPath));
    if (!fs.existsSync(dir)) {
      unresolved.push({ id: e.id, img: e.img, reason: 'folder does not exist' });
      return;
    }

    // Extension-agnostic on purpose — any file sharing the exact same name (case-sensitive,
    // extension aside) counts as a candidate, not just the formats this script converts.
    const candidates = fs.readdirSync(dir).filter(f => path.basename(f, path.extname(f)) === stem);

    if (candidates.length === 0) {
      unresolved.push({ id: e.id, img: e.img, reason: 'no file with that name under any extension' });
    } else if (candidates.length > 1) {
      ambiguous.push({ id: e.id, img: e.img, candidates: candidates.map(c => path.join(dir, c).split(path.sep).join('/')) });
    } else {
      const newPath = path.join(dir, candidates[0]).split(path.sep).join('/');
      const ext = path.extname(candidates[0]).toLowerCase();
      // In the normal case this candidate is already .jpg, since the walk()/convert() pass
      // above already converted every recognized non-JPEG format in Images/ regardless of
      // whether data.json referenced it yet. A non-JPEG match here means an extension this
      // script doesn't recognize (e.g. .jfif, .avif) — pointed at as-is, flagged so it isn't
      // silently left unconverted without a paper trail.
      e.img = newPath;
      healed++;
      const note = CONVERTIBLE_EXTS.has(ext) || ext === '.jpg' || ext === '.jpeg'
        ? ''
        : `  [${ext} isn't a format this script converts — left as-is]`;
      console.log(`  Healed: ${e.id}  ${relPath}  ->  ${newPath}${note}`);
    }
  });

  if (healed > 0) {
    fs.writeFileSync(DATA_JSON, JSON.stringify(raw, null, 2));
  }
  console.log(`\nImage reference check: ${healed} healed, ${unresolved.length} still broken, ${ambiguous.length} ambiguous.`);
  unresolved.forEach(u => console.log(`  BROKEN: ${u.id}  ${u.img}  (${u.reason})`));
  ambiguous.forEach(a => console.log(`  AMBIGUOUS: ${a.id}  ${a.img}  candidates: ${a.candidates.join(', ')}  — left untouched, pick one by hand`));
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.log('No images/ directory found — nothing to do.');
    return;
  }
  const files = walk(IMAGES_DIR);
  console.log(`Found ${files.length} non-JPEG image(s) under ${IMAGES_DIR}/ (png/webp/tiff/bmp/gif/heic/heif), converting...`);
  const converted = [];
  const skipped = [];
  const errors = [];
  for (const file of files) {
    try {
      const result = await convert(file);
      (result.skipped ? skipped : converted).push(result);
    } catch (err) {
      errors.push({ file, message: err.message });
      console.error(`Error on ${file}: ${err.message}`);
    }
  }
  if (skipped.length) {
    console.log(`\nSkipped:`);
    skipped.forEach(s => console.log(`  ${s.file}  (${s.skipped})`));
  }
  if (!converted.length) {
    console.log('\nNothing converted.');
  } else {
    console.log(`\nConverted ${converted.length} image(s) to JPEG:`);
    converted.forEach(c => {
      const savedKb = ((c.before - c.after) / 1024).toFixed(0);
      const savedPct = ((1 - c.after / c.before) * 100).toFixed(0);
      const note = c.wasHeic ? '  [was HEIC — worth a quick look for correct orientation]' : '';
      console.log(`  ${c.file} -> ${c.newFile}  (${(c.before / 1024 / 1024).toFixed(1)}MB -> ${(c.after / 1024).toFixed(0)}KB, ~${savedPct}% smaller)${note}`);
    });
  }
  if (errors.length) {
    console.log(`\n${errors.length} file(s) errored and were left untouched — see the Error lines above.`);
  }
  if (converted.length) updateDataJson(converted);
  healBrokenImageRefs();
}

main();
