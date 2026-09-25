// scripts/build-share-pages.mjs — builds the per-entry share preview pages.
// VERSION: 1 (2026-09-25)
//
// For every public entry in data.json, writes s/<entry-id>.html: a tiny page whose Open Graph
// tags carry that entry's name, short description and picture, and which forwards anyone who
// opens it straight to the entry in the app (/#<entry-id>). The app's share button sends
// https://catholictimeline.org/s/<entry-id>; Messages reads these tags to build one link card
// with the saint's picture on it. Plain static files: they work on any hosting.
//
// Run by .github/workflows/share-pages.yml. Only rewrites pages whose content changed, and
// removes pages for entries that no longer exist (or are hidden for review).

import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://catholictimeline.org';
const SITE_NAME = 'Catholic Timeline';
const FALLBACK_IMAGE = '/Images/heroLogo.jpg';
const OUT_DIR = 's';

const db = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const settings = db.settings || {};
const entries = (db.entries || []).filter(e => e && e.id && !e.review);

fs.mkdirSync(OUT_DIR, { recursive: true });
let written = 0, unchanged = 0, removed = 0;
const keep = new Set();

for (const e of entries) {
  const id = String(e.id).replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) continue;
  const file = path.join(OUT_DIR, id + '.html');
  keep.add(id + '.html');
  const html = page(e, id);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === html) { unchanged++; continue; }
  fs.writeFileSync(file, html);
  written++;
}
for (const f of fs.readdirSync(OUT_DIR)) {
  if (f.endsWith('.html') && !keep.has(f)) { fs.unlinkSync(path.join(OUT_DIR, f)); removed++; }
}
console.log(`share pages: ${written} written, ${unchanged} unchanged, ${removed} removed (${entries.length} public entries)`);

function page(e, id) {
  const title = e.n || SITE_NAME;
  const desc = plain(e.d || '').slice(0, 280) || SITE_NAME;
  const image = absolute(resolveAsset(e.img, settings.imageBase) || FALLBACK_IMAGE);
  const pageUrl = SITE + '/s/' + id;
  const target = SITE + '/#' + id;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(title)} \u2014 ${SITE_NAME}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(title)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body style="background:#0B1630;color:#EFE6CE;font-family:Georgia,serif;text-align:center;padding:40px 20px">
<p><a style="color:#E8CD7E" href="${esc(target)}">${esc(title)} \u2014 ${SITE_NAME}</a></p>
</body></html>
`;
}
// Same rules as index.html's resolveAsset().
function resolveAsset(p, base) {
  if (!p) return '';
  if (/^(https?:)?\/\//i.test(p) || p.startsWith('/') || p.startsWith('data:')) return p;
  if (!base) return p;
  return base.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '');
}
function absolute(p) {
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('//')) return 'https:' + p;
  if (p.startsWith('data:')) return SITE + FALLBACK_IMAGE; // crawlers can't use inline images
  return SITE + '/' + p.replace(/^\/+/, '');
}
function plain(s) { return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
