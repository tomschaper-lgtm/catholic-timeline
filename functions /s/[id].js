// functions/s/[id].js — Cloudflare Pages Function: per-entry share page.
// VERSION: 1 (2026-09-24)
//
// Why this exists: Messages (and most chat apps) build a link's preview card by reading the
// linked page's Open Graph tags (og:title, og:image...). Every entry in the app lives on the
// same single page (index.html#entry-id), and the part after "#" is never sent to the server,
// so every shared link could only ever preview as the same generic "Catholic Timeline" card.
//
// The app now shares https://catholictimeline.org/s/<entry-id>. This function answers that
// address with a tiny page whose preview tags carry THAT entry's name, short description and
// picture \u2014 so the link arrives as one card with the saint's picture on it \u2014 and which
// immediately forwards a person who taps it to the real entry (/#<entry-id>).
//
// Deploy: repo path functions/s/[id].js (square brackets are part of the file name). Cloudflare
// Pages picks up the /functions folder automatically on the next push; no settings to change.
// It reads the site's own data.json, so new entries and pictures work without touching this.

const SITE_NAME = 'Catholic Timeline';
const FALLBACK_IMAGE = '/Images/heroLogo.jpg';

export async function onRequestGet({ params, request, env }) {
  const url = new URL(request.url);
  const origin = url.origin;
  const id = String(params.id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const target = origin + '/#' + id;

  let entry = null;
  let settings = {};
  try {
    const res = await env.ASSETS.fetch(new URL('/data.json', origin));
    if (res.ok) {
      const db = await res.json();
      entry = (db.entries || []).find(e => e && e.id === id) || null;
      settings = db.settings || {};
    }
  } catch (e) { /* fall through to a plain redirect */ }

  if (!entry) return Response.redirect(origin + '/', 302);

  const title = entry.n || SITE_NAME;
  const desc = plain(entry.d || '').slice(0, 280) || SITE_NAME;
  const image = absolute(resolveAsset(entry.img, settings.imageBase) || FALLBACK_IMAGE, origin);

  const html = `<!doctype html>
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
<meta property="og:url" content="${esc(url.href)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(url.href)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body style="background:#0B1630;color:#EFE6CE;font-family:Georgia,serif;text-align:center;padding:40px 20px">
<p><a style="color:#E8CD7E" href="${esc(target)}">${esc(title)} \u2014 ${SITE_NAME}</a></p>
</body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

// Same rules as index.html's resolveAsset(): absolute URLs, root paths and data: URIs pass
// through; relative paths get the site's image base (Manage \u2192 Import) if one is set.
function resolveAsset(path, base) {
  if (!path) return '';
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('/') || path.startsWith('data:')) return path;
  if (!base) return path;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}
// Preview crawlers need a full https:// address for the picture.
function absolute(path, origin) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('//')) return 'https:' + path;
  return origin + '/' + path.replace(/^\/+/, '');
}
function plain(s) {
  return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
