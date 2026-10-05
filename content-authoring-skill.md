# Skill: Content Authoring for the Catholic Church Timeline

Governs *what to write and how to judge it* — voice, sourcing discipline, word-count targets, and every editorial judgment call (country, review flag, age-at-death, which facts to include, which links to cite). For *how to format that content as importable JSON* — entry/location/document/carloLink shapes, ids, the patches mechanism — see the companion doc `json-import-skill.md`. That doc's field reference and this doc's judgment calls describe the same fields from two angles; where they overlap, this doc governs *content*, the other governs *shape*.

---

## Voice: write as if it were John Paul II

Warm, personalist, theologically rich prose — not a dry encyclopedia entry. Address the reader's heart as well as their mind. Use direct, exhortatory language that draws out the saint's significance for a believer's own life today ("we recognize in [name] something every honest seeker knows..."; "he shows us still..."; "she remains, for every mother who has ever prayed for a wayward child, a companion..."). Favor phrases like "total gift of self," "the mystery of...," "a life given wholly to God," and first-person-plural reflection ("we," "us") woven naturally through the narrative, especially at section openings and closings. Never fabricate quotes and attribute them to John Paul II specifically — this is a stylistic register to write in, not a license to invent his words. Stay factually accurate and well-sourced throughout; warmth of voice is never a substitute for historical care.

## Sentence length — written to be heard

Every article is narrated as well as read, so sentences must work for the ear.

- **Hard limit: 40 words per sentence** in article sections — no exceptions. This is the same limit the sentence-reword service enforces afterward; writing within it means no rework. The reword service skips paragraphs that contain an `entry:` link, so a long sentence there is never fixed later — get those right the first time.
- **Aim for an average of about 18–22 words.** Mix lengths: a long sentence followed by a short one carries the voice; three long ones in a row lose the listener.
- **One main idea per sentence.** If a sentence needs two em-dash asides or a semicolon to hold together, split it.
- **Keep the subject close to its verb.** Don't park a long clause between them ("Gregory, who had for decades served as the power behind several popes and who…, was acclaimed").
- **Avoid phrasings that read one way and sound another.** A listener can't re-read. Check sentences where a noun could be heard as a verb or a phrase could attach to the wrong word (*"born to a family of humble standing in Tuscany"* can be heard as someone standing in Tuscany — *"born to a humble family in Tuscany"* can't).
- **Parentheses sparingly.** Narration can't show brackets; put the aside in its own short sentence instead.

The JPII voice is about warmth and depth, not sentence length. Rich prose and short sentences are compatible.

## Word count, tiered by significance

- **Standard figures**: **600–750 words**.
- **Major figures** (Augustine, Aquinas, Francis of Assisi, Teresa of Ávila, and similar): **900–1,000 words**. Never exceed 1,000.
- **Lesser figures** (thin, well-documented lives with little more to responsibly say): **400–600 words** — do not pad.
- **Word count is never a reason to add speculative or weakly sourced material.** If sourced material runs short, let the entry run short; qualify or omit per the sourcing rules below rather than invent to fill space.
- **6–7 sections** is standard for 600–1,000-word entries; lesser figures at 400–600 words may run 5–6. Cover, as fits the subject: early life and context, the pivotal turn or conversion, the central work or struggle, a vivid dramatic scene or trial, their death, and a closing "Legacy" section on what the saint still says to believers today.

## Quotes and links — what to select, not how to format

- **Quotes**: 0–4 authentic, attributed quotations, exact wording, never paraphrased or invented.
- **Links are "Sources & Further Reading," not a citation list.** The section header in the app already says this — write to it. Don't limit `links` to only the handful of sources actually quoted or paraphrased in the article; include genuinely useful further-reading material for someone who finishes the article and wants to go deeper, even if that source wasn't directly drawn on. New Advent (Catholic Encyclopedia) first when an article exists, then vatican.va / papal documents / other reputable Catholic sources. **Up to 6–8** where the subject supports it — a well-documented figure with real further-reading value shouldn't be capped at 4 just because only a couple of sources were used to write the piece; a thin entry with little else written about it may still only warrant 1–2 and that's fine. Every link verified by search before writing — never guess a URL or reuse one from memory, whether it was cited from or not.
- (For the `quotes`/`links` JSON array shape, see `json-import-skill.md`.)

## Cross-reference links — when and what to link

**When drafting a brand-new entry**, embed `entry:` links directly in the prose as you write — you already know, while writing, which other catalog entries it should reference. **When adding links to an already-published article you aren't otherwise rewriting**, don't resend the whole article — use the manual link list or a `patches` `article` edit instead (see `json-import-skill.md` for both mechanisms).

Whichever method creates the link: link a name or reference only the **first time it appears** in a given article, never link an entry to itself, and only link something meaningfully — the specific person, place, or event being referenced, not a passing category word like "a council" or "an apparition."

## Historical certainty & sourcing discipline

The JPII voice is confident and vivid — that confidence must attach to the *prose*, never to unverified *facts*. Before a biographical detail goes in an article, place it in one of four tiers and word it accordingly:

| Tier | What it covers | Wording to use |
|---|---|---|
| **A. Scripture** | Explicitly stated in the biblical text | State directly. Do not add motives, emotions, chronology, or circumstances Scripture doesn't give. |
| **B. Early testimony** | Church Fathers, Eusebius, Irenaeus, Jerome, other identifiable ancient sources | "Ancient Christian tradition records…" / "Early Christian writers testify…" |
| **C. Long-standing tradition** | Widely received Catholic or local tradition, no early documentary source | "A venerable tradition holds…" / "Catholic tradition has commonly identified…" |
| **D. Later legend/devotion** | Medieval or later embellishment | "Later tradition relates…" / "Medieval tradition associated…" — and if weakly sourced or adds little, cut it rather than qualify it. |

Additional standing rules:

- **Never resolve a debated identity as settled.** (Bartholomew/Nathanael, Matthew/Levi, the several Jameses, Mary Magdalene/Mary of Bethany, etc.) Use "traditionally identified with…," "although Scripture does not explicitly identify the two…," "the precise identification remains historically debated."
- **Doctrine ≠ historical reconstruction.** Defined dogma can be stated with full confidence — but doctrine doesn't by itself settle an undefined historical detail.
- **Don't invent interior states.** No "he was devastated," "she immediately understood" without a source. If needed for narrative flow, qualify it: "he may have…," "the scene suggests…"
- **Don't fill sparse accounts with plausible detail** — occupation, wealth, age, appearance, exact travel routes, invented conversations, precise cause of death — unless sourced.
- **Martyrdom accounts**: separate well-attested martyrdom from traditional location, traditional method, and later iconography.
- **Archaeology**: never say a site was "proved," "confirmed," or "identified" as a biblical person's tomb/relics/house unless the evidence genuinely warrants it.
- **Watch superlatives and absolutes** — first, only, oldest, largest, greatest, universally, always, every, certainly. Verify before using.
- **Modern scholarship ≠ Church teaching.** Frame source-critical or dating questions as "many modern scholars hold…," not settled doctrine.
- **Private revelations** need a traceable source, must be explicitly labeled as private revelation, must never be implied as binding. If a claimed vision, message, or miracle can't be sourced reliably, omit it.
- **A Catholic source ≠ historical proof.** A shrine website can accurately report "the Church venerates this tradition" without that establishing "historical evidence shows this occurred."

Keep qualification brief and natural, not academic: *"A venerable tradition holds that James preached in Spain before returning to Jerusalem"* reads better than a flat, overconfident *"James preached in Spain"* — and better than a hedge-laden academic paragraph.

## Country — judgment rules

- Use the **modern** country name, not a historical empire, kingdom, or diocese — a 4th-century North African saint gets `"Algeria"` or `"Tunisia"`, not "Roman Africa."
- One country only.
- **For people who moved around**: use the country where they spent the **most time in their life**. If unclear, default to the **country where they died**.
- For a border/disputed region, pick the country holding the specific site today; note ambiguity in the article text, not the field.
- Leave `""` only when genuinely unplaceable; prefer a best-effort country over blank.

## Review flag — when to hold an entry back

Set `"review": true` when:
- Sourced material is thin enough the entry ran well under its word-count tier, or leans heavily on tradition-level qualification throughout.
- The entry touches a historically sensitive narrative (e.g. a medieval host-desecration account tied to antisemitic blood-libel accusations) where extra care was applied but the owner should confirm the treatment before it goes live.
- Not fully confident in a date, location, or identification and want the owner's eyes on it first.
- The owner asked for a batch to be held pending review generally.

**`reviewNote` — write the actual concern down.** A sentence or two, specific: "Only ancient source is a four-line epigram; the popular narrative comes from an 1854 novel, not history" is more useful than "sourcing is thin." This is saved on the entry and shown on the article itself — it's what lets the owner review later without needing to scroll back through chat.

When submitting a batch with any `review: true` entries, call it out explicitly in the chat reply too (which entries, and why) — the chat note and `reviewNote` aren't a substitute for each other.

(For how the flag and note fields work mechanically — clearing, the Approve/Delete buttons — see `json-import-skill.md`.)

## Age at death — when and how to add it

An age goes at the end of the `Died` fact, in exactly one of two forms:

- **`(at age 75)`** — only when the age is certain.
- **`(estimated age 62)`** — when it can be reasonably worked out but not known exactly.
- **No age at all** when the birth year is unknown and can't be bounded. Never invent a birth year to produce one.

Work it out like this:

| What the sources give | How to compute | Write |
|---|---|---|
| Full birth **and** death dates (day and month on both ends) | Death year − birth year, then subtract 1 if the death came before that year's birthday | `(at age N)` |
| Firm years only (the usual case) | Death year − birth year. (The true age may be one less — the birthday may not have come yet — which is why this is an estimate.) | `(estimated age N)` |
| A year marked *c.*, *traditionally*, or two disputed years (e.g. *c. 1020/1025*) | Take the earliest and latest possible ages, use the midpoint, rounded down | `(estimated age N)` |
| No birth year, or nothing to bound it | — | no age |

Examples:
- Augustine — born November 13, 354, died August 28, 430: 430 − 354 = 76, but his November birthday hadn't come by August, so **`(at age 75)`**.
- Born 1182, died 1226, no days known: **`(estimated age 44)`**.
- Gregory VII — born c. 1020/1025, died 1085: possible ages 60–65, midpoint 62½, rounded down → **`(estimated age 62)`**.

Two traps:
- **Crossing from BC to AD: there is no year 0.** Add the two years, then subtract 1 — born 4 BC, died AD 30 → 4 + 30 − 1 = **33**.
- **Use one calendar for both dates.** Compute in the calendar the sources give (Julian before 1582 in most of Europe); never mix a Julian birth date with a Gregorian death date.

Show the estimate's basis in the `Born` fact itself (*"c. 1020/1025, Tuscany, Italy"*), so a reader can see why the age is estimated.

## Quick Facts — which facts to include, per type

`facts` is a small structured infobox. Keep each **value short**; omit any fact you cannot verify. Dates in fact values follow **Date formatting** below (*"Feast day: October 13"*, *"Died: August 28, 430, Hippo, Algeria (at age 75)"*). Use the labels appropriate to the entry's type, spelled and cased exactly as below so future themed cards can rely on them:

- **Saint (`s`)**: Feast day · Born · Died · Title (Doctor of the Church, Martyr, Virgin, Pope, etc.) · Beatified · Canonized · Patronage · Religious order · Major works · Attributes in art
- **Council (`c`)**: Ecumenical number (e.g. *21st ecumenical*) · Convoked by · Location · Dates · Condemned · Defined · Key documents · Sessions
- **Persecution (`p`)**: Regime or ruler · Region · Span of years · Cause · Notable martyrs · Estimated toll · Ended by
- **Marian Apparition (`m`)**: Seer(s) · Location · Date(s) · Title of Our Lady · Words/message · **Approval status** (diocesan or papal, with year) · Feast day · Shrine
- **Eucharistic Miracle (`u`)**: Location · Date · What occurred · Scientific findings · Approval status · Where venerated
- **Event (`e`)**: Date · Location · Key figures · Significance · Related document or decree

<!-- MISSING SECTION: Marian apparition approval rules (approval before/after the DDF's May 17, 2024 Norms;
     "Status can be revised", e.g. Our Lady of All Nations). It was in an earlier copy of this file and is
     not in this one — restore it from your own copy, writing the 2024 date as "May 17, 2024". -->

## Prominence (`tier`) and search names (`alt`) — judgment

Reserve `tier: 1` for figures a newcomer expects (Pentecost, Nicaea I, Augustine, Aquinas, Trent, Vatican II, Guadalupe, Lourdes, Fatima), `2` for well-known but secondary entries, `3` for specialists' entries. If unsure, leave `tier` off (defaults to always-visible).

Add `alt` names whenever an entry is commonly known by another name: regnal vs. birth names, nicknames, a secular name.

## Editorial guidelines, restated

Write from a faithful Catholic perspective, in the warm, personalist voice above. New Advent's Catholic Encyclopedia first, vatican.va/papal documents/other magisterial sources as supplements. Be precise with dates, canonization dates, and apparition approval status, and write every date as described in **Date formatting** below. Quotations authentic and exactly worded — prefer exact quoted text over paraphrase when quoting saints or magisterial documents. Search the web to verify facts and URLs before writing — every New Advent link confirmed by search, never guessed or reused from memory.

## Date formatting

Write every date in **American order** — in article prose, headings, the short description, and Quick Facts:

| Case | Write | Not |
|---|---|---|
| Full date | December 28, 1065 | 28 December 1065 · 28th December 1065 · 12/28/1065 |
| Full date, sentence continues | dedicated on December 28, 1065, by the bishop | …December 28, 1065 by the bishop |
| Day and month, no year | October 13 | 13 October · October 13th |
| Month and year | December 1065 | December, 1065 |
| Range in one month | June 8–9, 597 | 8–9 June 597 |
| Range across months | May 30–June 2, 1431 | 30 May–2 June 1431 |
| Range across years | December 28, 1065–January 5, 1066 | |
| Before Christ | March 15, 44 BC | 15 March 44 BC |
| Approximate | c. 1020 (the year only) | circa 1020 · ca. 1020 |

- **No ordinals** with dates: "December 28", never "December 28th" or "the 28th of December".
- **Use an en dash (–) in ranges**, with no spaces.
- **Exception — quotations:** a date inside a quotation from a source keeps the source's exact wording ("On 28 December 1065 the church was hallowed"). Never "correct" a quote.
- The recording service converts day-month dates to American order before narrating, as a safety net — but write them correctly in the first place, because the safety net doesn't reach quotations and can't fix every phrasing.

## Pre-delivery checklist (content quality)

Before delivering any draft:
- Every biographical claim correctly leveled (Scripture / early testimony / long-standing tradition / later legend); no debated identity stated as settled; no interior motive, emotion, or sparse-account detail invented — qualify or omit, never pad for word count.
- Word count within its tiered target, with the corresponding section count.
- No sentence in an article section over 40 words; average around 18–22; no sentence that sounds ambiguous read aloud.
- Any age on a `Died` fact follows **Age at death** exactly: `(at age N)` only when both full dates are known, `(estimated age N)` when computed from years or bounded estimates, otherwise none. BC-to-AD spans subtract one (no year 0).
- Every date is in American order (**Date formatting**), except inside quotations.
- For any Eucharistic Miracle (`t: "u"`) entry: confirm no `miracolieucaristici.org` link ended up in `art.links` (that link lives in the separate `carloLinks` table — see `json-import-skill.md`).
- `links` reads as genuine further reading for the subject, not just the sources actually cited in the prose — check it isn't artificially capped at the old 4-link habit when the subject supports more.

(For JSON validity, batch size, and import-format checks, see the equivalent checklist in `json-import-skill.md`.)
