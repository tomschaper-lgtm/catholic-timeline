# CLAUDE.md — Guide for Claude Code working in this repository

## What this project is
"Two Millennia — A Timeline of the Catholic Church." A single-file, static website
hosted on GitHub Pages. There is **no server** and **no build step**.

- `index.html` — the entire app (HTML + CSS + vanilla JS). This is the code.
- `data.json` — the database (the source of truth for all content). The site reads it at load.
- `images/` and `audio/` — media referenced by entries (repo-relative paths like `images/augustine.jpg`).

The live site: https://tomschaper-lgtm.github.io/catholic-timeline/
`index.html` and `data.json` must stay at the **repo root** (Pages serves `index.html`).

`index.html` auto-detects its environment: inside a Claude artifact it uses artifact
storage; served from the web it fetches `data.json`. **Do not remove that data.json fetch path.**

## How to make changes
- **Content** (add/edit saints, councils, articles, facts): edit `data.json` only.
- **Features/bug fixes** (app behavior, layout): edit `index.html`.
- Always work on a **feature branch** and open a **pull request** for review. Never push to `main` directly.
- Pages auto-deploys `main` after merge; the live site updates in ~1 minute.
- Use clear commit messages, e.g. `content: add 12 early martyrs` or `feat: feast-day-today panel`.

## Hard constraints (do not break)
- `data.json` must remain **valid JSON**. Validate before committing.
- Keep `index.html` a **single self-contained file** — no external JS/CSS build, no frameworks.
- Do **not** add outbound network calls except to `api.anthropic.com` (used by the in-app AI
  buttons) and `api.github.com` (used by the in-app Publish button). Other fetches are blocked
  in the Claude artifact sandbox and should be avoided.
- If you edit the `<script>`, sanity-check JS syntax (e.g. `node --check`) before committing.

## Entry schema (each object in data.json "entries")
```
id      string  slug of name + year (see rule below). Required for updates; generated for new.
y       int     year AD (anchor year: death for saints, opening for councils, apparition year…)
n       string  display name, e.g. "St. Augustine"
t       string  type key: s=Saint c=Council p=Persecution m=Marian u=Eucharistic e=Event
r       string  region: rome west brit east holy africa americas asia
d       string  short description, 1–2 sentences, plain text (detail card)
art     object  { sections:[{h,b}], quotes:[{text,source}], links:[{label,url}] }
facts   array   [{label,value}] or [{label,value,url}] — Quick Facts panel
tier    int     1=always visible (default) · 2=appears when zoomed in · 3=deep zoom only
alt     array   alternate names/nicknames for search, e.g. ["JPII","Karol Wojtyła"]
img     string  image URL or repo-relative path (or "")
imgCap  string  image caption (or "")
audio   string  narration URL or repo-relative path (or "")
```
**id slug rule:** lowercase `n`, replace any run of non `[a-z0-9]` with `-`, trim leading/trailing
`-`, append `-` + `y`, cut to 80 chars. Example: "St. Augustine", 430 → `st-augustine-430`.

## Article conventions (art)
- 5–8 sections, ~900–1400 words total; go into real depth (context, life/events, teaching,
  controversy/aftermath, legacy).
- Paragraphs in a body `b` separated by a blank line (`\n\n`).
- Simple HTML allowed in bodies: `<b> <i> <u> <ul>/<ol><li> <br> <blockquote> <a href="https://…">`.
  Everything else is stripped. Use sparingly.
- quotes: 0–4 **authentic, exactly-worded** quotations with attribution. Never invent or paraphrase a quote.
- links: New Advent (newadvent.org) first when it exists, then vatican.va / magisterial sources. Up to 4.

## Facts vocabulary (prefer these labels; keep spelling/casing exact)
- Saint: Feast day · Born · Died · Title · Beatified · Canonized · Patronage · Religious order · Major works · Attributes in art
- Council: Ecumenical number · Convoked by · Location · Dates · Condemned · Defined · Key documents
- Persecution: Regime or ruler · Region · Span of years · Cause · Notable martyrs · Estimated toll · Ended by
- Marian: Seer(s) · Location · Date(s) · Title of Our Lady · Words/message · Approval status · Feast day · Shrine
- Eucharistic: Location · Date · What occurred · Scientific findings · Approval status · Where venerated
- Event: Date · Location · Key figures · Significance · Related document
Keep values short; omit any fact you cannot verify.

## Tiers and search names
- Reserve `tier: 1` for figures/events a newcomer expects (Pentecost, Nicaea I, Augustine, Aquinas,
  Trent, Vatican II, Guadalupe, Lourdes, Fatima). Use 2 for secondary, 3 for specialists' entries.
  If unsure, omit `tier` (defaults to always-visible). This keeps the zoomed-out view legible.
- Add `alt` names whenever an entry is known by another name (regnal/birth names, nicknames, secular names).

## Editorial stance
Write from a faithful Catholic perspective. Primary reference New Advent's Catholic Encyclopedia,
supplemented by vatican.va and magisterial sources. Be precise with dates, canonization dates, and
the approval status of apparitions (diocesan vs. papal, with year). Verify facts and URLs; include
source links so text can be checked against primaries.

## When adding many entries
Batch and keep `data.json` sorted/consistent; ensure unique `id`s; prefer editing `data.json`
directly over regenerating the whole file, to keep diffs small and reviewable.
