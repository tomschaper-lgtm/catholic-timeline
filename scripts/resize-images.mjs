#!/usr/bin/env node
// scripts/resize-images.mjs
//
// Shrinks/recompresses any image under images/ that's either oversized in pixel dimensions
// (long edge over MAX_DIM) OR just heavy for its size (over MAX_BYTES — this catches a PNG
// or a low-compression JPEG that's already small in pixels but still huge in file size, which
// a dimension-only check would silently skip). Aspect ratio is always preserved exactly —
// sharp's `fit: 'inside'` scales proportionally to fit within a bounding box, it never crops
// and never stretches, and never runs at all on an image already within MAX_DIM.
//
// File extensions are never changed (so nothing in data.json ever needs updating): JPEGs stay
// JPEGs, PNGs stay PNGs (recompressed with palette quantization, which is near-lossless for
// most images but can meaningfully shrink a photo saved as PNG without touching its format).
//
// Idempotent — once a file has been optimized, a second run finds nothing left to save and
// leaves it alone.
//
// Run automatically by .github/workflows/resize-images.yml on every push that touches
// images/**, and can also be triggered manually from the Actions tab (workflow_dispatch) —
// use that once to sweep every image already in the repo.

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const IMAGES_DIR = 'Images'; // the legacy capitalized folder where your photos actually live
// The article hero displays at up to 720 CSS px wide (.artwrap max-width). MAX_DIM covers
// that at 2x retina with some headroom, without keeping full-camera-resolution originals.
const MAX_DIM = 1600;
// Trigger recompression even when dimensions are already fine, if the file itself is just
// heavy (e.g. a PNG, or a JPEG saved at near-100% quality). ~300KB is already generous for a
// photo at MAX_DIM — a healthy target after processing is closer to 150-350KB.
const MAX_BYTES = 400 * 1024;
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
  const oversizedDims = Math.max(width, height) > MAX_DIM;
  const heavyFile = buffer.length > MAX_BYTES;
  if (!oversizedDims && !heavyFile) return false; // already small in both dimension and size — leave it alone

  const ext = path.extname(file).toLowerCase();
  let pipeline = sharp(buffer).resize({
    width: MAX_DIM,
    height: MAX_DIM,
    fit: 'inside',            // scales proportionally to fit inside MAX_DIM x MAX_DIM —
    withoutEnlargement: true, // never crops, never stretches, never upscales (a no-op if already smaller)
  });
  if (ext === '.jpg' || ext === '.jpeg') {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  } else if (ext === '.png') {
    // Palette quantization gives PNGs a real size win (near-lossless for photos) without
    // changing the file format/extension, so nothing in data.json needs to change.
    pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality: 90 });
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: JPEG_QUALITY });
  }

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
