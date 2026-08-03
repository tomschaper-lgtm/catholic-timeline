#!/usr/bin/env node
// scripts/resize-images.mjs
//
// Shrinks any image under images/ whose long edge exceeds MAX_DIM, and re-compresses it.
// Aspect ratio is always preserved exactly — sharp's `fit: 'inside'` scales proportionally
// to fit within a bounding box, it never crops and never stretches. Images already at or
// under MAX_DIM are left completely untouched, so this is safe to run repeatedly (idempotent):
// once an image has been shrunk, a second run finds nothing left to do.
//
// Run automatically by .github/workflows/resize-images.yml on every push that touches
// images/**, and can also be triggered manually from the Actions tab (workflow_dispatch) —
// use that once to sweep every image already in the repo.

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const IMAGES_DIR = 'images';
// The article hero displays at up to 720 CSS px wide (.artwrap max-width). MAX_DIM covers
// that at 2x retina with some headroom, without keeping full-camera-resolution originals.
const MAX_DIM = 1600;
const JPEG_QUALITY = 84;

const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (exts.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function processImage(file) {
  const buffer = fs.readFileSync(file);
  const meta = await sharp(buffer).metadata();
  const { width, height } = meta;
  if (!width || !height) return false;
  if (Math.max(width, height) <= MAX_DIM) return false; // already small enough — leave it alone

  const ext = path.extname(file).toLowerCase();
  let pipeline = sharp(buffer).resize({
    width: MAX_DIM,
    height: MAX_DIM,
    fit: 'inside',            // scales proportionally to fit inside MAX_DIM x MAX_DIM —
    withoutEnlargement: true, // never crops, never stretches, never upscales
  });
  if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  else if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === '.webp') pipeline = pipeline.webp({ quality: JPEG_QUALITY });

  const outBuffer = await pipeline.toBuffer();
  // Only overwrite if it actually saved space. Resizing a very simple/small-palette PNG can
  // occasionally not shrink further; in that rare case leave the original file as-is.
  if (outBuffer.length < buffer.length) {
    fs.writeFileSync(file, outBuffer);
    const outMeta = await sharp(outBuffer).metadata();
    return { file, before: buffer.length, after: outBuffer.length, fromDim: `${width}x${height}`, toDim: `${outMeta.width}x${outMeta.height}` };
  }
  return false;
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.log('No images/ directory found — nothing to do.');
    return;
  }
  const files = walk(IMAGES_DIR);
  console.log(`Scanning ${files.length} image(s) under ${IMAGES_DIR}/...`);
  const changed = [];
  for (const file of files) {
    try {
      const result = await processImage(file);
      if (result) changed.push(result);
    } catch (err) {
      console.error(`Skipped ${file}: ${err.message}`);
    }
  }
  if (!changed.length) {
    console.log('Nothing needed resizing — all images already within bounds.');
    return;
  }
  console.log(`Resized ${changed.length} image(s):`);
  changed.forEach(c => {
    const savedKb = ((c.before - c.after) / 1024).toFixed(0);
    console.log(`  ${c.file}  (${c.fromDim} \u2192 ${c.toDim}, saved ~${savedKb} KB)`);
  });
}

main();
