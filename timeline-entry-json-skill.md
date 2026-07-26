# Skill: Drafting Entries for the Catholic Church Timeline (JSON Import Format)

Give this document to Claude (add it to the Project's knowledge, or paste it into a chat) whenever you want Claude to draft new or updated timeline entries as JSON. You then copy the JSON, open the timeline's **⚙ Manage** screen, paste it into **Paste JSON (Add / Update Only)**, and press **Apply**. Existing entries are updated, new ones are added — nothing is ever deleted or replaced by this import.

---

## Output format

Respond with a single JSON object in this shape (a bare array `[ ... ]` of entries also works):

```json
{
  "v": 1,
  "entries": [
    {
      "id": "st-augustine-430",
      "y": 430,
      "n": "St. Augustine",
      "t": "s",
      "r": "africa",
      "country": "Algeria",
      "d": "A brilliant, restless young man who spent his twenties chasing worldly ambition, unlawful love, and a heretical sect that seemed to promise easy answers to the problem of evil, all while his mother wept and prayed for his return. In a Milanese garden, reduced to tears over his own divided will, he heard a child's voice telling him to take up and read, and opened Scripture to the very words that broke his resistance for good. He became, as bishop of the small African town of Hippo, the single most influential theologian the Western Church has ever produced. He shows every restless heart that has ever wandered far from God exactly what he wrote himself: that God has made us for Himself, and our heart is restless until it rests in Him.",
      "art": {
        "sections": [
          { "h": "A Mother's Tears and a Son's Ambition", "b": "Born in 354 at <b>Tagaste</b> in Roman North Africa to a pagan father and a devoutly Christian mother, <b>Monica</b>, Augustine received an excellent classical education...\n\nThroughout these years of wandering, his mother's response was neither despair nor rejection but an unbroken campaign of tears and prayer that followed him, quite literally, across the sea." },
          { "h": "A Teacher Drawn to Milan", "b": "..." },
          { "h": "A Voice in the Garden", "b": "..." },
          { "h": "Bishop of Hippo", "b": "..." },
          { "h": "A Life Laid Bare, and a City of God", "b": "..." },
          { "h": "Legacy", "b": "..." }
        ],
        "quotes": [
          { "text": "Thou hast made us for Thyself, O Lord, and our heart is restless until it rests in Thee.", "source": "St. Augustine, Confessions I, 1" }
        ],
        "links": [
          { "label": "New Advent: St. Augustine of Hippo", "url": "https://www.newadvent.org/cathen/02084a.htm" }
        ]
      },
      "facts": [
        { "label": "Feast day", "value": "August 28" },
        { "label": "Born", "value": "354, Tagaste (Numidia)" },
        { "label": "Died", "value": "430, Hippo Regius" },
        { "label": "Title", "value": "Bishop, Doctor of the Church" },
        { "label": "Patronage", "value": "Theologians, printers, brewers" },
        { "label": "Major works", "value": "Confessions; City of God" }
      ],
      "tier": 1,
      "alt": ["Augustine of Hippo", "Aurelius Augustinus"],
      "img": "",
      "imgCap": "",
      "audio": ""
    }
  ]
}
```

## Field reference

| Field | Required | Meaning |
|---|---|---|
| `id` | For **updates**: yes, and it must match the entry's *exact existing id* — never guess a slug. For **new** entries: omit it (the app generates a slug of name + year). | Matching key. If `id` matches an existing entry, that entry is updated; otherwise the entry is added. |
| `y` | yes | Year, AD (integer). Use the entry's anchor year (death year for saints, opening year for councils, apparition year, etc.). Note: the app's importer requires either a matching `id` *or* both `n` and `y` to add a new entry — always include `y` even on updates, since an id mismatch will otherwise cause the entry to be silently skipped rather than added. |
| `n` | yes | Display name, e.g. `"St. Thérèse of Lisieux"`. |
| `t` | yes | Type key: `s` Saint · `c` Council · `p` Persecution · `m` Marian Apparition · `u` Eucharistic Miracle · `e` Event. |
| `r` | yes | Region key: `rome` (Rome & Italy) · `west` (Western Europe) · `brit` (Britain & Ireland) · `east` (Byzantium & E. Europe) · `holy` (Holy Land & Mid-East) · `africa` · `americas` · `asia` (Asia & Oceania). |
| `country` | recommended | Plain modern country name only — e.g. `"Italy"`, `"Spain"`, `"Poland"`, `"Algeria"` — no city, no historical polity name. Used to drive country-shape/flag display on themed cards (currently the Eucharistic Miracle card; may extend to other types later). See rules below. |
| `d` | yes | Short description for the detail card: **four sentences**, vivid and specific rather than encyclopedic — written in the warm, personalist voice described below, not a dry summary. |
| `art` | recommended | The full article: `sections`, `quotes`, `links` (see below). |
| `facts` | no | **Quick Facts** panel on the article: array of `{ "label": "...", "value": "..." }` (add `"url": "..."` to make a value a link). Order preserved. Use the per-type labels below. A city/state "Location" fact (e.g. `"Turin, Italy"`) can still live here as prose — `country` is the separate, standardized field for the shape/flag lookup. |
| `tier` | no | Zoom prominence, integer 1–3. `1` = always visible (default). `2` = appears once zoomed in. `3` = appears only at deep zoom. Keeps the timeline uncluttered as it grows. Omit to mean 1. |
| `alt` | no | Array of alternate names/nicknames for the search box, e.g. `["JPII", "Karol Wojtyła"]`, `["Edith Stein"]`. Search folds accents automatically, so unaccented spellings are not needed. |
| `img` / `imgCap` | no | Direct `https` image URL and its caption (or a repo-relative path like `images/augustine.jpg` on the hosted site). Leave `""` if none. |
| `audio` | no | Direct `https` URL (or repo-relative path) to a recorded narration file. Leave `""` if none. |

### Rules for `country`

- Use the **modern** country name as it exists today, not a historical empire, kingdom, or diocese name — e.g. a 4th-century North African saint gets `"Algeria"` or `"Tunisia"` (wherever the ancient city now lies), not "Roman Africa" or "Numidia."
- One country only. For a person, event, or miracle tied to a single clear place, this is straightforward.
- **For people who moved around** (missionary saints, popes, martyrs who traveled): use the country where they spent the **most time in their life**. If time is roughly split or unclear, default to the **country where they died**.
- For entries spanning a modern border region or disputed territory, pick the country that holds the specific site today and note any ambiguity in the article text, not in this field.
- Leave `""` only when genuinely unplaceable (e.g. a title-only entry with no fixed location); prefer a best-effort country over leaving it blank.

### Updates vs. additions

- **To update an existing entry**, include its exact `id` plus *only* the fields being changed (e.g. `{"id": "st-augustine-430", "y": 430, "country": "Algeria"}`). Untouched fields are preserved. Note: if you include `art`, it replaces the whole `art` object, so include all of its sections/quotes/links, not just the changed section.
- **To add a new entry**, include `y`, `n`, `t`, `r`, `d` (and ideally `art` and `country`) with no `id`.
- **Always verify the exact `id` before updating.** Never guess a slug from the name and year — a mismatched id causes the app to silently attempt an *add* instead of an *update*, which then gets skipped if `y` is missing, with no visible error. When updating existing entries, work from the app's own exported "JSON — Filtered" file so ids are known exactly, rather than reconstructing them.

### Article conventions (`art`) — voice and depth

**Voice: write as if it were John Paul II.** This means warm, personalist, and theologically rich prose — not a dry encyclopedia entry. Address the reader's heart as well as their mind. Use direct, exhortatory language that draws out the saint's significance for a believer's own life today ("we recognize in [name] something every honest seeker knows..."; "he shows us still..."; "she remains, for every mother who has ever prayed for a wayward child, a companion..."). Favor phrases like "total gift of self," "the mystery of...," "a life given wholly to God," and first-person-plural reflection ("we," "us") woven naturally through the narrative sections, especially at section openings and closings. Never fabricate quotes and attribute them to John Paul II specifically — this is a stylistic register to write in, not a license to invent his words. Stay factually accurate and well-sourced throughout; warmth of voice is never a substitute for historical care.

- **6–7 sections, 600–900 words total** — this is now the standard depth for every saint, not just tier-1 figures. Each section has a heading `h` and body `b`. Cover, as fits the subject: early life and context, the pivotal turn or conversion, the central work or struggle of their life, a vivid dramatic scene or trial, their death, and a closing "Legacy" section that draws out what the saint still says to believers today.
- Paragraphs within `b` are separated by `\n\n` (blank line).
- Body text may use **simple HTML** for readability — allowed tags only: `<b>`, `<i>`, `<u>`, `<ul>`/`<ol>` with `<li>`, `<br>`, `<blockquote>`, `<a href="https://…">`. Anything else is stripped. Use sparingly and purposefully: bold key names and dates, italicize titles of works, use lists for enumerations.
- **quotes**: 0–4 authentic, attributed quotations (exact quoted text, never paraphrase or invent), each `{ "text": "...", "source": "..." }`.
- **links**: source links so all text can be verified — New Advent (Catholic Encyclopedia) first when an article exists, then vatican.va / papal documents / other reputable Catholic sources. Up to 4. Always verify the exact New Advent URL by search before writing; never guess or reuse a URL from memory.

### Short description (`d`) — the teaser

`d` is now **four sentences**, not one or two — vivid, specific, and written in the same warm voice as the article, functioning as a compelling hook rather than a bare summary. It should give a strong sense of who the person was and why they still matter, not just their dates and title.

### Quick Facts (`facts`) — per-type vocabulary

`facts` is a small structured panel of label/value pairs rendered near the top of the article (an infobox). Storing these as data — rather than burying them in prose — is what will later allow beautifully themed, per-type article cards. Keep each **value short** (a date, a name, a place); omit any fact you cannot verify. Use the labels appropriate to the entry's type:

- **Saint (`s`)**: Feast day · Born · Died · Title (Doctor of the Church, Martyr, Virgin, Pope, etc.) · Beatified · Canonized · Patronage · Religious order · Major works · Attributes in art
- **Council (`c`)**: Ecumenical number (e.g. *21st ecumenical*) · Convoked by · Location · Dates · Condemned · Defined · Key documents · Sessions
- **Persecution (`p`)**: Regime or ruler · Region · Span of years · Cause · Notable martyrs · Estimated toll · Ended by
- **Marian Apparition (`m`)**: Seer(s) · Location · Date(s) · Title of Our Lady · Words/message · **Approval status** (diocesan or papal, with year) · Feast day · Shrine
- **Eucharistic Miracle (`u`)**: Location · Date · What occurred · Scientific findings · Approval status · Where venerated
- **Event (`e`)**: Date · Location · Key figures · Significance · Related document or decree

Labels are free text, but prefer these standard labels so future themed cards can rely on them — keep spelling and casing exactly as above (always "Feast day", always "Approval status").

### Prominence tiers (`tier`) and search names (`alt`)

The timeline declutters by zoom, like a map: only `tier: 1` entries show when zoomed out, and `2`/`3` appear as the user zooms in. When adding or curating many entries, assign tiers so the fully-zoomed-out view stays legible — reserve `1` for figures and events a newcomer expects (e.g. Pentecost, Nicaea I, Augustine, Aquinas, Trent, Vatican II, Guadalupe, Lourdes, Fatima), `2` for well-known but secondary entries, and `3` for specialists' entries. If unsure, leave `tier` off (defaults to always-visible).

Add `alt` names whenever an entry is commonly known by another name: regnal vs. birth names (`"Karol Wojtyła"` for John Paul II), nicknames (`"JPII"`, `"the Little Flower"`), or a secular name (`"Edith Stein"`).

### In the manual editor

The **⚙ Manage** editor has boxes for these. Quick Facts: one fact per line as `label :: value`, or `label :: value :: url` to make the value a link. Prominence: a 1–3 dropdown. Alternate names: comma-separated. Country: a single plain-text field. Example facts box:

```
Feast day :: October 1
Born :: 1873, Alençon
Died :: 1897, Lisieux
Title :: Doctor of the Church
Canonized :: 1925, by Pius XI
```

## Editorial guidelines

Write from a faithful Catholic perspective, in the warm, personalist, John Paul II-style voice described above. Use New Advent's Catholic Encyclopedia as the first reference and vatican.va, papal documents, and other magisterial sources as supplements. Be precise with dates, canonization dates, and the approval status of apparitions (note diocesan vs. papal recognition where relevant). Search the web to verify facts and URLs before writing — every New Advent link must be confirmed by search, never reused from memory or guessed. Quotations must be authentic and exactly worded.

## Response rules for Claude

1. Respond with **valid JSON only** — no markdown fences, no commentary before or after (or, if in a chat, put the JSON in a single code block so it is easy to copy).
2. Escape correctly: newlines inside strings as `\n`, quotation marks inside strings as `\"`.
3. Batch size: with the deeper 600–900-word articles, **5 full-article entries per response** is a comfortable standard; go up to 7 for well-documented figures needing less research, and split larger jobs into multiple batches.
4. When updating, ask for (or work from) the exported "JSON — Filtered" file so the exact `id` values are known, rather than guessing ids. This is not optional — a guessed id that doesn't match causes a silent, invisible failure on import.
5. Before writing, validate the JSON (parse it) and confirm every entry lands within the 600–900 word / 6–7 section target before delivering it.

## The round-trip workflow

1. In the timeline, set the category/region filters to the batch you want to work on, open **⚙ Manage** → **JSON — Filtered**, and **Copy All**.
2. Paste that JSON to Claude with instructions (e.g. "Write full articles for these entries, following the timeline JSON skill").
3. Copy Claude's JSON output.
4. Back in **⚙ Manage** → **Paste JSON (Add / Update Only)** → paste → **Apply**. The status line reports how many entries were added and updated — check it, since a silent skip is possible if an id doesn't match and `y` is missing.
5. **Publish** (hosted site): open **⚙ Manage → Publish to GitHub**, and press **Save to GitHub**. Your live site updates in about a minute. (Or periodically take a full backup with **JSON — All Entries** → Copy All → save the text somewhere safe.)
