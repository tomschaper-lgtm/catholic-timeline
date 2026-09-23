// sw.js — Catholic Timeline offline support.
// VERSION: 1  (2026-09-23) — first real implementation. index.html has called this file since
// v415, but it never existed in the repo, so Settings \u2192 Offline Access silently did nothing.
//
// Deploy: repo root, next to index.html. Only runs when the visitor turns on Offline Access
// (index.html registers it; turning the switch off unregisters it and deletes every cache).
//
// Strategy, by request type:
//   • The page itself (navigations, index.html) and data.json \u2014 NETWORK-FIRST. Online, you
//     always get the latest from the server, so the normal "reload to update" flow and the
//     Settings version check keep working exactly as before. Offline, the last saved copy.
//     Keys ignore the query string (data.json is fetched as data.json?t=<timestamp>, and the
//     version check adds ?cachebust=...), so there is one saved copy of each, not thousands.
//   • Images and the sentence-timing .json files \u2014 STALE-WHILE-REVALIDATE: answer from the
//     saved copy instantly, refresh it in the background when online.
//   • Audio \u2014 CACHE-FIRST with RANGE support. iPhone Safari never asks for a whole audio file;
//     it asks for byte ranges ("bytes=0-1", then "bytes=65536-..."). A service worker that only
//     hands back whole files makes audio silently fail offline. Here: if the file is saved, the
//     requested slice is cut from it and returned as a proper 206 Partial Content. If it isn't
//     saved yet, the range request goes straight to the network (so playback starts at normal
//     speed) and the WHOLE file is downloaded and saved in the background for next time.
//     Audio file names are versioned (-v1, -v2 ...), so a saved file never needs re-checking.
//   • Google Fonts \u2014 stale-while-revalidate, so the typefaces still render offline.
//   • Everything else (GitHub API, Web3Forms, any POST/PUT) \u2014 not touched at all.

const VERSION = 'v1';
const SHELL = 'ct-shell-' + VERSION;   // page + data.json
const MEDIA = 'ct-media-' + VERSION;   // images, audio, timing files
const FONTS = 'ct-fonts-' + VERSION;   // Google Fonts css + font files
const KEEP = [SHELL, MEDIA, FONTS];

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg|avif)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus)$/i;

// ---------------------------------------------------------------------------------------
// Install / activate
// ---------------------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Each saved separately so one failure (say, a missing logo) can't abort the whole install.
    await Promise.all(['./', 'index.html', 'data.json'].map(async (url) => {
      try{
        const res = await fetch(url, { cache: 'no-store' });
        if(res.ok) await cache.put(shellKey(new URL(url, self.registration.scope)), await clean(res));
      }catch(e){ /* offline during install — fine, it fills in on the next online visit */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('ct-') && !KEEP.includes(n)).map(n => caches.delete(n)));
    // Take control of the already-open page right away, so index.html's bulk download
    // (warmMediaCache) goes through this worker on the very first run, not the second.
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if(req.mode === 'navigate' || (sameOrigin && isPagePath(url))){
    event.respondWith(networkFirst(req, SHELL, shellKey(url)));
    return;
  }
  if(sameOrigin && /(^|\/)data\.json$/i.test(url.pathname)){
    event.respondWith(networkFirst(req, SHELL, shellKey(url)));
    return;
  }
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    event.respondWith(staleWhileRevalidate(req, FONTS, req.url));
    return;
  }
  if(!sameOrigin) return; // any other outside host: leave it alone
  if(AUDIO_EXT.test(url.pathname)){
    event.respondWith(audio(event, req));
    return;
  }
  if(IMAGE_EXT.test(url.pathname) || isTimingJson(url)){
    event.respondWith(staleWhileRevalidate(req, MEDIA, mediaKey(url)));
    return;
  }
  // Anything else same-origin (manifest, icons, sw.js itself...) — default browser behavior.
});

function isPagePath(url){
  const scopePath = new URL(self.registration.scope).pathname;
  return url.pathname === scopePath || /(^|\/)index\.html$/i.test(url.pathname);
}
function isTimingJson(url){
  return /\.json$/i.test(url.pathname) && /\/audio\//i.test(url.pathname);
}
// One saved copy per file, regardless of cache-busting query strings.
function shellKey(url){
  const u = new URL(url);
  u.search = ''; u.hash = '';
  const scopePath = new URL(self.registration.scope).pathname;
  if(u.pathname === scopePath) u.pathname = scopePath + 'index.html';
  return u.href;
}
function mediaKey(url){
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

// A response that went through a redirect can't be handed back for a page load on iOS
// ("Response served by service worker has redirections"), and some browsers refuse to store
// it at all. Rebuilding it drops that flag while keeping body, status and headers.
async function clean(res){
  if(!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// ---------------------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------------------
async function networkFirst(req, cacheName, key){
  const cache = await caches.open(cacheName);
  try{
    const res = await fetch(req);
    if(res.ok){
      const toStore = await clean(res.clone());
      cache.put(key, toStore).catch(() => {});
      return res.redirected ? clean(res) : res;
    }
    // A server error while "online" — prefer the saved copy if there is one.
    const saved = await cache.match(key);
    return saved || res;
  }catch(e){
    const saved = await cache.match(key);
    if(saved) return saved;
    // Offline page load with no exact match: fall back to the saved app page.
    if(req.mode === 'navigate'){
      const page = await cache.match(shellKey(new URL('index.html', self.registration.scope)));
      if(page) return page;
    }
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName, key){
  const cache = await caches.open(cacheName);
  const saved = await cache.match(key);
  const refresh = fetch(req).then(async (res) => {
    // ok (200) or opaque (cross-origin font files, status 0) are both worth keeping.
    if(res.ok || res.type === 'opaque') await cache.put(key, await clean(res.clone()));
    return res;
  });
  if(saved){
    refresh.catch(() => {}); // background refresh; failures offline are expected
    return saved;
  }
  return refresh;
}

// ---------------------------------------------------------------------------------------
// Audio: cache-first, with byte-range support
// ---------------------------------------------------------------------------------------
async function audio(event, req){
  const url = new URL(req.url);
  const key = mediaKey(url);
  const cache = await caches.open(MEDIA);
  const saved = await cache.match(key);
  const range = req.headers.get('range');

  if(saved){
    return range ? sliceRange(saved, range) : saved;
  }

  // Not saved yet. Save the WHOLE file in the background (never a partial one), and answer
  // this request from the network directly so playback isn't held up by the full download.
  event.waitUntil((async () => {
    try{
      const full = await fetch(key, { cache: 'no-store' });
      if(full.ok && full.status === 200) await cache.put(key, await clean(full));
    }catch(e){ /* offline or missing — try again next time */ }
  })());
  return fetch(req);
}

// Builds a 206 Partial Content from a whole saved file, for the byte range Safari asked for.
async function sliceRange(savedRes, rangeHeader){
  const blob = await savedRes.blob();
  const size = blob.size;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if(!m){
    return new Response(blob, { status: 200, headers: audioHeaders(savedRes, size) });
  }
  let start, end;
  if(m[1] === '' && m[2] !== ''){        // "bytes=-500" = the last 500 bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }else{
    start = Number(m[1] || 0);
    end = m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if(start >= size || start > end){
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const part = blob.slice(start, end + 1);
  const headers = audioHeaders(savedRes, part.size);
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  return new Response(part, { status: 206, statusText: 'Partial Content', headers });
}

function audioHeaders(savedRes, length){
  const h = new Headers();
  h.set('Content-Type', savedRes.headers.get('Content-Type') || 'audio/mpeg');
  h.set('Content-Length', String(length));
  h.set('Accept-Ranges', 'bytes');
  return h;
}
