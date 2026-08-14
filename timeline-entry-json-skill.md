# Skill: Drafting Entries for the Catholic Church Timeline (JSON Import Format)

Give this document to Claude (add it to the Project's knowledge, or paste it into a chat) whenever you want Claude to draft new or updated timeline content as JSON — entries, locations, and/or documents. You then copy the JSON, open the timeline's **⚙ Manage** screen, paste it into **Paste JSON (Add / Update / Delete)**, and press **Apply**. Matching ids are updated, new ones are added — nothing is deleted unless you explicitly say so (see the deletion keys below).

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
        { "label": "Died", "value": "430, Hippo Regius (at age 75)" },
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
| `review` | no | Set `true` to hold a draft entry back from publication (see **Review flag** below). Omit or set `false` for a finished, publishable entry. |
| `reviewNote` | no | Short plain-text note explaining *why* an entry is held (see **Review flag** below). Only meaningful alongside `review: true` — omit it entirely on a finished entry, and clear it if you're setting `review` back to `false` on an update. |
| `updatedAt` | never set by Claude | Auto-stamped by the app itself the moment an entry is added or updated — not something to include in JSON you draft. If a paste happens to carry one, the app ignores it and uses the real save time instead. Shown so the owner can see what changed recently; not part of the content you're responsible for. |

### Review flag (`review`) — holding drafts back from publication

Any entry can carry `"review": true`. This marks it as a draft: it is excluded from the public timeline, from search, and from visitor-facing counts, but it still lives in `data.json` like any other entry. In the app, a **Review Mode** toggle — in the hamburger settings menu (next to Owner Tools, showing the pending count right on the row) and also in ⚚ Manage → Entries — shows held-for-review entries in place: a dashed amber ring on the timeline, and a "Pending" tag in the Manage entry list, so the owner can check them before approving.

Note this is a visibility convenience, not a security control — a held entry is not hidden from anyone who has the raw `data.json` or Export Backup.

**When Claude should set `"review": true`:**
- The sourced material is thin enough that the entry had to run well under its word-count tier, or leans heavily on tradition-level qualification throughout
- The entry touches a historically sensitive narrative (e.g. a medieval host-desecration account tied to antisemitic blood-libel accusations) where Claude has applied extra care in framing but the owner should confirm the treatment before it goes live
- Claude is not fully confident in a date, location, or identification and wants the owner's eyes on it before publication
- The owner has asked for a batch to be held pending their review generally

**`reviewNote` — write the actual concern down.** Whenever Claude sets `"review": true`, it should also set `"reviewNote"` to a short, plain-language explanation of the specific concern (a sentence or two — "Only ancient source is a four-line epigram; the popular narrative comes from an 1854 novel, not history" is more useful than "sourcing is thin"). This note is not just for the chat reply — it's saved on the entry itself and displayed directly on the article, in an amber box right before the story, any time the entry is held for review. That's what lets the owner review an entry on its own, later, without needing to scroll back to find whatever Claude said about it in chat at the time.

To publish a held entry: clear the checkbox in the manual editor (this also clears `reviewNote` automatically), send an update with `"review": false`, or — fastest — use the **Approve** button now shown at the bottom of the article itself when a held entry is open (an unlocked owner only). A matching **Delete** button sits next to it for entries that shouldn't be published at all. Both save and publish immediately, not deferred to a later CMS exit.

When submitting a batch with any `review: true` entries, Claude should still call this out explicitly in its reply (which entries, and why) separate from the JSON itself, in addition to setting `reviewNote` on the entry — the two aren't a substitute for each other; the chat note is what the owner sees right now, `reviewNote` is what travels with the entry so the concern isn't lost track of later.

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

- **Word count is tiered by the figure's significance, not fixed at one number:**
  - **Standard figures**: target **600–750 words**.
  - **Major figures** (where additional material is genuinely historically or spiritually significant — e.g. Augustine, Aquinas, Francis of Assisi, Teresa of Ávila): may reach **900–1,000 words**. Never exceed 1,000.
  - **Lesser figures** (thin, well-documented lives with little more to responsibly say): **400–600 words** is appropriate and complete — do not pad.
  - **Word count is never a reason to add speculative or weakly sourced material.** If the sourced material runs short of a target, let the entry run short; qualify or omit per the sourcing-discipline rules below rather than invent to fill space.
  - **6–7 sections** remains the standard structure for entries in the 600–1,000 word range; lesser figures at 400–600 words may run 5–6 sections. Each section has a heading `h` and body `b`. Cover, as fits the subject: early life and context, the pivotal turn or conversion, the central work or struggle of their life, a vivid dramatic scene or trial, their death, and a closing "Legacy" section that draws out what the saint still says to believers today.
- Paragraphs within `b` are separated by `\n\n` (blank line).
- Body text may use **simple HTML** for readability — allowed tags only: `<b>`, `<i>`, `<u>`, `<ul>`/`<ol>` with `<li>`, `<br>`, `<blockquote>`, `<a href="https://…">`. Anything else is stripped. Use sparingly and purposefully: bold key names and dates, italicize titles of works, use lists for enumerations.
- **quotes**: 0–4 authentic, attributed quotations (exact quoted text, never paraphrase or invent), each `{ "text": "...", "source": "..." }`.
- **links**: source links so all text can be verified — New Advent (Catholic Encyclopedia) first when an article exists, then vatican.va / papal documents / other reputable Catholic sources. Up to 4. Always verify the exact New Advent URL by search before writing; never guess or reuse a URL from memory.
- **Eucharistic Miracle (`t: "u"`) entries do NOT include a Carlo Acutis link in `art.links`.** As of v147, that link lives in its own separate table — see **Carlo Acutis Links table** below — so it can render in its own dedicated section on the article rather than get lumped into "Sources & Further Reading." Never add `miracolieucaristici.org` to an entry's `art.links`; every `t: "u"` entry instead needs exactly one row in `carloLinks`, with `status` set to `"found"` (a verified individual page) or `"pending"` (a note on what was searched and why nothing was located yet).

### Cross-reference links between entries (`entry:` links)

Article body text (`art.sections[].b`) can link to another entry in the catalog using the app's internal scheme: `<a href="entry:{id}">visible text</a>` — tapping it navigates straight to that entry's article inside the app, no page reload. There are two ways these get created:

1. **Auto-Link Cross-References** (Manage → Export tab, no AI, pattern matching only) — scans every article for another entry's whole display name (honorifics stripped, so "Pope St. Leo the Great" also matches "Leo the Great") or an `alt` name, and links the first mention per article. Preview reports what would change before anything is touched; Apply writes it; Remove All Links strips every `entry:` link back to plain text, leaving the words themselves in place. Good for a first broad pass, but it only catches literal name matches — it has no way to know that "Saul" is St. Paul, that "the beloved disciple" is St. John, or that a bare "Mary" should mean the Blessed Virgin specifically rather than Mary Magdalene or Mary of Bethany.

2. **Manual link list** — for links the auto-matcher can't make safely. Pasted into the exact same **Paste JSON** box as entries (it auto-detects the format: if what's pasted isn't valid JSON but every line carries the format below, it's treated as a link list instead). One link per line:
   ```
   entryId :: exact text :: targetId
   ```
   Add an optional 4th field to choose which occurrence of that text to link, if it appears more than once in the article (default: first). The `exact text` must match the article body **verbatim, including case** — copy it from the actual text rather than retyping it from memory. Existing links and self-references are skipped automatically, so re-sending a list that already applied does no harm.

**When drafting a brand-new entry**, embed `entry:` links directly in the prose as you write the article — you already know, while writing, which other entries in the catalog it should reference, so there's no reason to also write a separate link-list line for it. **When adding links to an already-published article you are not otherwise rewriting**, send a manual link list instead of the full updated `art` object — it is dramatically shorter than re-pasting an entire article body just to wrap a few words in an anchor tag, and it carries no risk of accidentally altering wording elsewhere in the article in the process of retyping it.

Whichever method creates a link, the same discipline applies: link a name or reference only the **first time it appears** in a given article, never link an entry to itself, and only link something meaningfully — the specific person, place, or event being referenced, not a passing category word like "a council" or "an apparition."

### Historical certainty & sourcing discipline

The JPII voice is confident and vivid — that confidence must attach to the *prose*, never to unverified *facts*. Before a biographical detail goes in an article, place it in one of four tiers and word it accordingly:

| Tier | What it covers | Wording to use |
|---|---|---|
| **A. Scripture** | Explicitly stated in the biblical text | State directly. Do not add motives, emotions, chronology, or circumstances Scripture doesn't give. |
| **B. Early testimony** | Church Fathers, Eusebius, Irenaeus, Jerome, other identifiable ancient sources | "Ancient Christian tradition records…" / "Early Christian writers testify…" |
| **C. Long-standing tradition** | Widely received Catholic or local tradition, no early documentary source | "A venerable tradition holds…" / "Catholic tradition has commonly identified…" |
| **D. Later legend/devotion** | Medieval or later embellishment | "Later tradition relates…" / "Medieval tradition associated…" — and if it's weakly sourced or adds little, cut it rather than qualify it. |

Additional standing rules:

- **Never resolve a debated identity as settled.** (Bartholomew/Nathanael, Matthew/Levi, the several Jameses, Mary Magdalene/Mary of Bethany, etc.) Use "traditionally identified with…," "although Scripture does not explicitly identify the two…," "the precise identification remains historically debated."
- **Doctrine ≠ historical reconstruction.** Defined dogma (perpetual virginity, Immaculate Conception, Assumption, Christ's two natures, apostolic authority) can be stated with full confidence — but doctrine doesn't by itself settle an undefined historical detail (e.g. Mary's perpetual virginity doesn't determine the exact relationship of every biblical "brother" of Jesus).
- **Don't invent interior states.** No "he was devastated," "she immediately understood," "he knew at that moment" without a source. If needed for narrative flow, qualify it: "he may have…," "the scene suggests…," "it is easy to understand why…"
- **Don't fill sparse accounts with plausible detail** — occupation, wealth, age, appearance, exact travel routes, invented conversations, precise cause of death — unless it's sourced. Beautiful prose should never rest on an invented fact.
- **Martyrdom accounts**: separate well-attested martyrdom from traditional location, traditional method, and later iconography (e.g. "Ancient tradition holds that Andrew was martyred by crucifixion at Patras. The distinctive X-shaped cross became prominent in later Christian tradition" — not stated as eyewitness fact).
- **Archaeology**: never say a site was "proved," "confirmed," or "identified" as a biblical person's tomb/relics/house unless the evidence genuinely warrants it. Prefer "traditionally associated with…," "a site long associated with…," "the identification remains uncertain."
- **Watch superlatives and absolutes** — first, only, oldest, largest, greatest, universally, always, every, certainly. These are frequent, easily-avoidable error sources; verify before using.
- **Modern scholarship ≠ Church teaching.** Frame source-critical or dating questions (Markan priority, authorship debates, etc.) as "many modern scholars hold…," not as settled doctrine.
- **Private revelations** need a traceable source, must be explicitly labeled as private revelation, and must never be implied as binding on the faithful. If a claimed vision, message, or miracle can't be sourced reliably, omit it — don't repeat it just because it's on a devotional site.
- **A Catholic source ≠ historical proof.** A shrine website or popular biography can accurately report that "the Church venerates this tradition" without that establishing "historical evidence shows this occurred." Keep the two distinct.

Keep qualification brief and natural, not academic. *"A venerable tradition holds that James preached in Spain before returning to Jerusalem"* reads better than a flat "James preached in Spain," and is more honest — that's the target register throughout.

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

**Age at death — append it to `Died`, but only on solid dates.** For saints (and anyone else with a Born/Died pair), add `(at age N)` to the end of the `Died` value once both years are firmly established — this is purely a convenience so the owner never has to do the subtraction by hand. The bar for "solid":

- Both the birth year *and* the death year must be independently well-attested — not a `c.` estimate, not "traditionally," not one of two disputed dates. If either year carries any of that qualification, leave the age off rather than compute it from a guess.
- When only years are known (the normal case), compute the age as death year minus birth year — e.g. `354` to `430` → `(at age 75)`. This is the conventional shorthand and is what most reference sources mean when they cite someone's age at death without a precise day-count.
- When exact birth and death dates (month and day, not just year) are both known, compute the true age — subtract birth year from death year, then subtract one more if the death fell before that year's birthday. This is why Augustine is *75*, not 76, at his death (born 13 November 354, died 28 August 430 — his birthday hadn't come around yet that year).
- If the birth date is unknown entirely (common for early martyrs and many saints before the high medieval period), just omit the age — don't estimate a birth year to back into one.

```json
{ "label": "Born", "value": "1873, Alençon" },
{ "label": "Died", "value": "1897, Lisieux (at age 24)" }
```

### Prominence tiers (`tier`) and search names (`alt`)

The timeline declutters by zoom, like a map: only `tier: 1` entries show when zoomed out, and `2`/`3` appear as the user zooms in. When adding or curating many entries, assign tiers so the fully-zoomed-out view stays legible — reserve `1` for figures and events a newcomer expects (e.g. Pentecost, Nicaea I, Augustine, Aquinas, Trent, Vatican II, Guadalupe, Lourdes, Fatima), `2` for well-known but secondary entries, and `3` for specialists' entries. If unsure, leave `tier` off (defaults to always-visible).

Add `alt` names whenever an entry is commonly known by another name: regnal vs. birth names (`"Karol Wojtyła"` for John Paul II), nicknames (`"JPII"`, `"the Little Flower"`), or a secular name (`"Edith Stein"`).

### In the manual editor

The **⚙ Manage** editor has boxes for these. Quick Facts: one fact per line as `label :: value`, or `label :: value :: url` to make the value a link. Prominence: a 1–3 dropdown. Alternate names: comma-separated. Country: a single plain-text field. Example facts box:

```
Feast day :: October 1
Born :: 1873, Alençon
Died :: 1897, Lisieux (at age 24)
Title :: Doctor of the Church
Canonized :: 1925, by Pius XI
```

## Locations table — geographic/temporal waypoints (separate from entries)

A second, separate JSON table tracks *where and when* things happened for a given entry, to eventually feed a map view. It's a flat array, not nested inside `entries`, so the app can list every waypoint across the whole catalog without walking each entry's article content.

### Output format

```json
{
  "v": 1,
  "locations": [
    {
      "id": "st-augustine-430-loc1",
      "entityId": "st-augustine-430",
      "seq": 1,
      "date": "354",
      "eventDesc": "Born",
      "detail": "",
      "locationName": "Tagaste, Numidia (modern Souk Ahras, Algeria)",
      "lat": 36.286,
      "lng": 7.951
    },
    {
      "id": "st-augustine-430-loc2",
      "entityId": "st-augustine-430",
      "seq": 2,
      "date": "386",
      "eventDesc": "Conversion in the garden",
      "detail": "Hearing a child's voice telling him to take up and read, Augustine opened Scripture to a passage that broke his years of resistance to conversion.",
      "locationName": "Milan, Italy",
      "lat": 45.4642,
      "lng": 9.19
    }
  ]
}
```

### Field reference

| Field | Required | Meaning |
|---|---|---|
| `id` | no | Unique row id — convention `{entityId}-loc{seq}`. Omit it for new rows and the app generates it this way automatically; include the exact existing `id` when updating a specific row. |
| `entityId` | yes | Must exactly match an existing entry's `id`. Never guess. Required by the app — a row missing it is rejected (skipped, and reported) rather than stored incomplete. |
| `seq` | recommended | Integer, 1-based, in narrative/chronological order. Order by `seq`, not by `date` — many `date` values are approximate ("c. 386") or share a year. Omit it and the app assigns the next number for that `entityId` automatically, but supplying it yourself keeps multi-location batches predictable. |
| `date` | yes | Display string — a year, a range, or "traditionally, c. 386." Not required to be a strict ISO date. |
| `eventDesc` | yes | **Short phrase**, a few words — e.g. `"Born"`, `"Became Bishop of Hippo"`, `"Died"`, `"First apparition"`. This is the pin label. |
| `detail` | no | **Longer explanation**, 1–3 sentences, only when the waypoint needs context a reader wouldn't already have. Leave `""` for self-explanatory beats (born, died, ordained, became bishop). Use it for turning points, disputed points, or anything that benefits from a sentence or two of "why this place/moment matters." |
| `locationName` | yes | Human-readable place name, modern-day where possible — `"Milan, Italy"`, not a defunct polity name. |
| `lat` / `lng` | yes | Decimal degrees. Verify by search rather than estimating from memory for anywhere obscure. Required by the app — a row missing either, or with a non-numeric value, is rejected (skipped, and reported).|

### How many locations per entry

| Type | Typical count | Notes |
|---|---|---|
| Eucharistic Miracle (`u`) | **1** | Matches the entry's own date/place — no separate research needed. |
| Marian Apparition (`m`) | 1 (rarely 2) | The apparition site; a second row only if there were genuinely distinct sites. |
| Event (`e`) | 1 (rarely 2–3) | Extra rows only if the event itself unfolded across locations. |
| Council (`c`) | 1 (rarely 2–3) | Extra rows only if sessions genuinely moved cities (e.g. Trent's Trent/Bologna sessions). |
| Persecution (`p`) | 1–3 | Pin specific, well-attested sites tied to named events or martyrs — never try to represent a whole province or empire as one dot. |
| Saint (`s`), standard | 2–5 | One row per major geographic beat the article already covers — birth, pivotal turn, main ministry, death. Not every place they ever set foot. |
| Saint (`s`), major traveling figure | **up to 20** | Reserved for figures whose significance is substantially bound up in movement — missionary saints, apostles, popes with extensive travel (e.g. St. Paul's journeys, St. John Paul II's pontificate). Still highlights only, never a full itinerary — the goal is to show the shape and pace of their movement over time, not document every stop. |

**Highlights, not itineraries, throughout.** Even at 20 rows for a figure like Paul or John Paul II, each row should mark something that mattered — a founding, a turning point, a significant document, a major event — not a comprehensive travel log.

### Round-trip workflow (locations)

Locations are paste-ready now, in the **same box** as entries — Manage → Import → **Paste JSON** auto-detects what you send it, per item, by shape: an item carrying `entityId` (and no `type`) is a location, everything else is an entry. So a single paste can include `{"entries":[...], "locations":[...]}` together, or you can send them separately — both work.

Deleting a location uses `"locationDeletions": ["st-augustine-430-loc2"]`, kept separate from entries' `"deletions"` since a bare id string alone can't reveal which table it belongs to.

There's still no map view — the data just isn't rendered anywhere visitor-facing yet — but it's genuinely stored and safe to send.

## Documents table — prayers and other written works (separate from entries)

A third flat top-level array, alongside `entries` and `locations`, for prayers and longer written works (encyclicals, papal bulls, conciliar documents, spiritual classics) — the kind of thing you'd want to say "here's what this saint wrote, and here's where to read or buy it" about. Each document links to **at most one** entry via an **optional** `entityId` — a document can belong to no entry at all (a general prayer not tied to a particular saint), but never to more than one. To show "documents related to this saint," filter the table by `entityId`, the same way you would for locations.

There are two shapes, chosen by `type`:

- **`"prayer"`** — short enough that the **entire text** belongs in the record itself (`fullText`).
- **`"work"`** — too long to embed. Store bibliographic info instead: page count, a brief sample excerpt, and links to read or buy it.

### Output format

```json
{
  "v": 1,
  "documents": [
    {
      "id": "prayer-anima-christi",
      "entityId": "",
      "type": "prayer",
      "title": "Anima Christi",
      "author": "Traditionally attributed to an unknown 14th-century author",
      "difficulty": 1,
      "genre": "Prayer",
      "occasion": "Before/after receiving the Eucharist",
      "dateWritten": "14th century",
      "fullText": "Soul of Christ, sanctify me.\nBody of Christ, save me.\n...",
      "links": [
        { "label": "EWTN: Anima Christi", "url": "https://..." }
      ]
    },
    {
      "id": "doc-lumen-gentium",
      "entityId": "vatican-ii-1965",
      "type": "work",
      "title": "Lumen Gentium",
      "author": "Second Vatican Council",
      "difficulty": 4,
      "genre": "Conciliar Constitution",
      "dateWritten": "1964",
      "pageCount": 96,
      "sample": "A brief, exact quotation — never more than a sentence or two.",
      "links": [
        { "label": "Full text on vatican.va", "url": "https://..." },
        { "label": "Buy a print edition", "url": "https://amazon.com/..." }
      ]
    }
  ]
}
```

### Field reference

| Field | Required | Meaning |
|---|---|---|
| `id` | no | Convention: `{entityId}-doc{seq}` if `entityId` is given, otherwise a slug of the title. Omit it and the app generates one (de-duplicating title-slug collisions automatically); include the exact existing `id` when updating. |
| `entityId` | no | At most one entry's `id` — omit or leave `""` for a document tied to no particular entry. Never a list. |
| `type` | yes | `"prayer"` or `"work"`. If omitted or anything else, the app defaults it to `"work"` and flags the row — so always set this explicitly. |
| `title` | yes | The one field the app actually requires — a document with no title is rejected. |
| `author` | recommended | Free text, hedged the same way as everything else in this skill: `"Traditionally attributed to..."`, `"Unknown"`, or a name. Doesn't have to match `entityId`'s name — a conciliar document's `entityId` is the Council, but its `author` might read `"Second Vatican Council"`. |
| `difficulty` | recommended | Integer 1–5. See rubric below. |
| `genre` | recommended | Free text format/classification — `"Prayer"`, `"Encyclical"`, `"Papal Bull"`, `"Conciliar Constitution"`, `"Spiritual Classic"`, etc. |
| `dateWritten` | recommended | Display string — a year, a century, or a qualified guess ("traditionally, 14th century"). |
| `links` | recommended | Same `{label, url}` shape as an entry's `art.links`. For a `"work"`, prefer the official free text (vatican.va, New Advent) first, then a purchasable edition (Amazon or similar) if one exists. Up to 4, same discipline as entry links. |
| `fullText` | prayer only | The complete prayer, `\n` for line breaks. See the copyright note below before reproducing anything not clearly traditional/public domain. |
| `occasion` | prayer only | When/why it's prayed — `"Morning Offering"`, `"Before Communion"`, `"For the dying"`. |
| `pageCount` | work only | Approximate total pages of the published work. |
| `sample` | work only | A brief excerpt, **not** a substitute for `fullText` — see the copyright note below. Omit rather than pad if you don't have a genuinely worthwhile short passage. |

### Difficulty rubric (1–5)

Rate consistently against this scale rather than by gut feel each time:

| Level | What it means | Example |
|---|---|---|
| **1** | Short, everyday language, no background needed | Our Father, Hail Mary, Grace Before Meals |
| **2** | Slightly longer or more formal, still accessible to anyone | Prayer to St. Michael, Memorare, a papal message written for general audiences |
| **3** | Some theological vocabulary or sustained argument; benefits from context but needs no prior study | Most encyclicals, pastoral letters, *Story of a Soul* |
| **4** | Dense theological/philosophical prose, technical vocabulary, assumes some doctrinal or philosophical background | Conciliar dogmatic constitutions, *Dark Night of the Soul*, *Summa* excerpts in translation |
| **5** | Scholarly — original-language nuance matters, heavy doctrinal/historical/philosophical background needed | Patristic treatises, untranslated technical theology, conciliar canons read closely in the original |

### Copyright note — `fullText` vs. `sample`

Traditional prayers with no identifiable living author or long-expired copyright (the Our Father, the Memorare, most saints' personal prayers) are fine to reproduce in full under `fullText`. A modern composed prayer or hymn text by an identifiable, still-in-copyright author needs the same caution as any other copyrighted text — don't reproduce it in full; treat it more like a `"work"` with a link out instead. `sample` on a `"work"` should stay to a genuinely brief, exact quotation (a sentence or two) — it exists to give a flavor of the writing, not to substitute for reading the source, and Vatican documents remain copyrighted by the Holy See even though vatican.va hosts them freely.

### `review` flag does not currently apply here

The `review`/held-for-review mechanism described earlier is implemented for **entries only**. Locations and documents have no review workflow in the app yet — anything pasted into either table publishes immediately (in the sense that it's stored and would ship on the next **Save to GitHub**). Keep that in mind for anything sensitive enough that you'd normally hold it back.

### Round-trip workflow (documents)

Same unified **Paste JSON** box as entries and locations. The auto-detect rule checked first: an item with `"type":"prayer"` or `"type":"work"` is a document — this is checked *before* the entityId-means-location rule, since a document's `entityId` is optional and can't be used on its own to rule out a location. Delete with `"documentDeletions": ["doc-id-here"]`.

## Carlo Acutis Links table — the exhibition link for Eucharistic Miracle entries (separate from entries)

A fourth flat top-level table, `carloLinks`, holding exactly one row per Eucharistic Miracle (`t: "u"`) entry: its link into St. Carlo Acutis's *Miracles of the Eucharist* exhibition (miracolieucaristici.org). This link used to live inside an entry's `art.links` as a standing fourth link — as of v147 it doesn't; it lives here instead, so the article can render it in its own dedicated section (violet accent, host-and-chalice icon, "See Carlo's Work") rather than buried in the generic "Sources & Further Reading" list.

### Output format

```json
{
  "v": 1,
  "carloLinks": [
    {
      "id": "miracle-of-lanciano-750-carlo",
      "entityId": "miracle-of-lanciano-750",
      "status": "found",
      "url": "https://www.miracolieucaristici.org/en/liste/scheda_b.html?nat=italia&wh=lanciano"
    },
    {
      "id": "em-turin-1453-carlo",
      "entityId": "em-turin-1453",
      "status": "pending",
      "note": "Searched the Italy country list on miracolieucaristici.org for \"Turin\"/\"Torino\", 1453 — no individual scheda found under an obvious slug as of Aug 2026."
    }
  ]
}
```

### Field reference

| Field | Required | Meaning |
|---|---|---|
| `id` | no | Row id. Omit it and the app generates `{entityId}-carlo` automatically; include the exact existing `id` when updating a specific row. |
| `entityId` | yes | Must exactly match an existing entry's `id`. A row whose `entityId` doesn't match any entry is skipped (reported, not silently dropped). |
| `status` | yes | `"found"` — a verified individual exhibition page exists; renders the dedicated card section. `"pending"` — still researching; renders nothing to visitors (see below). |
| `url` | `status: "found"` only | The exact individual `miracolieucaristici.org` page for that miracle — never the bare homepage, never a general country/list page. Always verify by search before writing; never guess or reuse a URL from memory. |
| `note` | `status: "pending"` only | Short, plain-language note on what was searched and why nothing was found yet (e.g. "checked the Italy list under 'Turin' and '1453' — no scheda found"). Only shown to the owner, in Review Mode — never to visitors — so the gap is tracked without ever surfacing as a broken or empty state on a public page. |

### Behavior on the article

- `status: "found"` → the dedicated Carlo Acutis section renders, always.
- `status: "pending"`, or **no row at all** for that entity — nothing renders to a visitor. When the site's Review Mode is on, the section instead shows an amber dashed box with the `note` (or a generic placeholder if `note` is empty), so the owner can see at a glance which entries still need research without it ever being visible publicly.

### Every Eucharistic Miracle entry needs a row — no exceptions

When drafting or updating any `t: "u"` entry, always send a matching `carloLinks` row in the same response: `status: "found"` with a verified URL if you located the individual page, or `status: "pending"` with a `note` if you searched and came up empty. Never leave an entry with no row at all — a missing row and a `"pending"` row behave identically to a visitor, but only the `"pending"` row with a note travels the research status forward for the owner to pick back up later, the same principle behind `reviewNote` on held entries.

### Updating and deleting

To update a row, send its exact existing `id` (or `entityId`, if `id` is unknown — the app matches on `id` first, falling back to `entityId`) with the fields you're changing. To delete a row entirely, send `{"carloLinkDeletions": ["row-id"]}`. `carloLinks` and `carloLinkDeletions` can travel alone, or combined with `entries`/`deletions` in the same JSON object — the app applies deletions before adds for both tables independently.

### Auditing what's left

Because `status` is a plain field on each row, there's no separate progress tracker to maintain: export the whole table (**⚙ Manage → Export → JSON — Carlo Links**) at any point and every `"pending"` row is visible directly in the output, alongside a short summary count of found vs. pending. Paste that export to Claude to pick a fresh batch of research back up.

## Editorial guidelines

Write from a faithful Catholic perspective, in the warm, personalist, John Paul II-style voice described above. Use New Advent's Catholic Encyclopedia as the first reference and vatican.va, papal documents, and other magisterial sources as supplements. Be precise with dates, canonization dates, and the approval status of apparitions (note diocesan vs. papal recognition where relevant). Search the web to verify facts and URLs before writing — every New Advent link must be confirmed by search, never reused from memory or guessed. Quotations must be authentic and exactly worded. Apply the historical certainty and sourcing rules above throughout: label tradition as tradition, never resolve a debated identity as settled, and omit rather than invent when a detail can't be verified.

## Response rules for Claude

1. Respond with **valid JSON only** — no markdown fences, no commentary before or after (or, if in a chat, put the JSON in a single code block so it is easy to copy). Entries, locations, documents, and Carlo Acutis links can travel in the same JSON object (`{"entries":[...], "locations":[...], "documents":[...], "carloLinks":[...]}`) or separately — the app sorts them by shape either way.
2. Escape correctly: newlines inside strings as `\n`, quotation marks inside strings as `\"`.
3. Batch size: with articles in the 400–1,000-word tiered range, **5 full-article entries per response** is a comfortable standard; go up to 7 for well-documented figures needing less research or for lesser figures at the shorter end of the range, and split larger jobs into multiple batches. Locations, documents, and Carlo Acutis link rows are lighter-weight — a batch of entries can usually carry its locations, related documents, and (for any `t: "u"` entries in the batch) their `carloLinks` row alongside it in the same response without counting separately against that limit.
4. When updating, ask for (or work from) the exported "JSON — Filtered" file so the exact `id` values are known, rather than guessing ids. This is not optional — a guessed id that doesn't match causes a silent, invisible failure on import.
5. Before writing, validate the JSON (parse it) and confirm every entry lands within its tiered word-count target (600–750 standard, 900–1,000 for major figures, 400–600 for lesser figures — never exceeding 1,000) and the corresponding section count before delivering it. Also confirm every biographical claim is correctly leveled (Scripture / early testimony / long-standing tradition / later legend), that no debated identity is stated as settled, and that no interior motive, emotion, or sparse-account detail has been invented — qualify or omit rather than assert, never pad for word count. Confirm any `Died (at age N)` fact only appears where both years are solid (see **Age at death** above) — cut it rather than guess. For any `t: "u"` entry, confirm `art.links` carries **no** miracolieucaristici.org link and that a matching `carloLinks` row is included, with `status: "found"` and a verified individual URL, or `status: "pending"` and a note.

## The round-trip workflow

1. In the timeline, set the category/region filters to the batch you want to work on, open **⚙ Manage** → **JSON — Filtered**, and **Copy All**.
2. Paste that JSON to Claude with instructions (e.g. "Write full articles for these entries, following the timeline JSON skill").
3. Copy Claude's JSON output — this may include `entries`, `locations`, `documents`, and `carloLinks` together.
4. Back in **⚙ Manage** → **Paste JSON (Add / Update / Delete)** → paste → **Apply**. This single box handles all four tables, auto-detected by shape (a `carloLinks`/`carloLinkDeletions` key routes to that table specifically, regardless of whether `entries` is present in the same paste). The status line reports activity as separate clauses, only for whichever tables were actually touched — check it, since a silent skip is possible if an id doesn't match and a required field (`y` for entries, `entityId`/`lat`/`lng` for locations, `title` for documents, `entityId`/`status` for Carlo links) is missing.
5. **Publish** (hosted site): open **⚙ Manage → Publish to GitHub**, and press **Save to GitHub**. Your live site updates in about a minute. (Or periodically take a full backup with **JSON — All Entries**, **JSON — All Locations**, **JSON — All Documents**, and **JSON — Carlo Links** → Copy All → save the text somewhere safe.)
