# Skill: Content Authoring for the Catholic Church Timeline

Governs *what to write and how to judge it* — voice, sourcing discipline, word-count targets, and every editorial judgment call (country, review flag, age-at-death, which facts to include, which links to cite). For *how to format that content as importable JSON* — entry/location/document/carloLink shapes, ids, the patches mechanism — see the companion doc `json-import-skill.md`. That doc's field reference and this doc's judgment calls describe the same fields from two angles; where they overlap, this doc governs *content*, the other governs *shape*.

---

## Voice: write as if it were John Paul II

Warm, personalist, theologically rich prose — not a dry encyclopedia entry. Address the reader's heart as well as their mind. Use direct, exhortatory language that draws out the saint's significance for a believer's own life today ("we recognize in [name] something every honest seeker knows..."; "he shows us still..."; "she remains, for every mother who has ever prayed for a wayward child, a companion..."). Favor phrases like "total gift of self," "the mystery of...," "a life given wholly to God," and first-person-plural reflection ("we," "us") woven naturally through the narrative, especially at section openings and closings. Never fabricate quotes and attribute them to John Paul II specifically — this is a stylistic register to write in, not a license to invent his words. Stay factually accurate and well-sourced throughout; warmth of voice is never a substitute for historical care.

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

Keep qualification brief and natural, not academic: *"A venerable tradition holds that James preached in Spain before returning to Jerusalem"* reads better than a flat, overconfident claim.

## Short description (`d`) — the teaser

Four sentences, vivid and specific, same warm voice as the article — a compelling hook, not a bare summary. Should give a strong sense of who the person was and why they still matter, not just dates and title.

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

## Age at death — when it's solid enough to compute

Append `(at age N)` to a `Died` fact only when both years are firmly established:

- Both birth year *and* death year must be independently well-attested — not a `c.` estimate, not "traditionally," not one of two disputed dates. If either carries that kind of qualification, leave the age off.
- **Years only known (the normal case)**: age = death year − birth year.
- **Exact month+day known on both ends**: compute the true age — subtract birth year from death year, then subtract one more if the death fell before that year's birthday (e.g. Augustine, born 13 November 354, died 28 August 430, is *75* not 76 — his birthday hadn't come around yet).
- If the birth date is unknown entirely, omit the age — don't estimate a birth year to back into one.

## Quick Facts — which facts to include, per type

`facts` is a small structured infobox. Keep each **value short**; omit any fact you cannot verify. Use the labels appropriate to the entry's type, spelled and cased exactly as below so future themed cards can rely on them:

- **Saint (`s`)**: Feast day · Born · Died · Title (Doctor of the Church, Martyr, Virgin, Pope, etc.) · Beatified · Canonized · Patronage · Religious order · Major works · Attributes in art
- **Council (`c`)**: Ecumenical number (e.g. *21st ecumenical*) · Convoked by · Location · Dates · Condemned · Defined · Key documents · Sessions
- **Persecution (`p`)**: Regime or ruler · Region · Span of years · Cause · Notable martyrs · Estimated toll · Ended by
- **Marian Apparition (`m`)**: Seer(s) · Location · Date(s) · Title of Our Lady · Words/message · **Approval status** (diocesan or papal, with year) · Feast day · Shrine
- **Eucharistic Miracle (`u`)**: Location · Date · What occurred · Scientific findings · Approval status · Where venerated
- **Event (`e`)**: Date · Location · Key figures · Significance · Related document or decree

## Prominence (`tier`) and search names (`alt`) — judgment

Reserve `tier: 1` for figures a newcomer expects (Pentecost, Nicaea I, Augustine, Aquinas, Trent, Vatican II, Guadalupe, Lourdes, Fatima), `2` for well-known but secondary entries, `3` for specialists' entries. If unsure, leave `tier` off (defaults to always-visible).

Add `alt` names whenever an entry is commonly known by another name: regnal vs. birth names, nicknames, a secular name.

## Editorial guidelines, restated

Write from a faithful Catholic perspective, in the warm, personalist voice above. New Advent's Catholic Encyclopedia first, vatican.va/papal documents/other magisterial sources as supplements. Be precise with dates, canonization dates, and apparition approval status. Quotations authentic and exactly worded — prefer exact quoted text over paraphrase when quoting saints or magisterial documents. Search the web to verify facts and URLs before writing — every New Advent link confirmed by search, never guessed or reused from memory.

## Pre-delivery checklist (content quality)

Before delivering any draft:
- Every biographical claim correctly leveled (Scripture / early testimony / long-standing tradition / later legend); no debated identity stated as settled; no interior motive, emotion, or sparse-account detail invented — qualify or omit, never pad for word count.
- Word count within its tiered target, with the corresponding section count.
- Any `Died (at age N)` fact appears only where both years are solid per the rule above — cut it rather than guess.
- For any Eucharistic Miracle (`t: "u"`) entry: confirm no `miracolieucaristici.org` link ended up in `art.links` (that link lives in the separate `carloLinks` table — see `json-import-skill.md`).
- `links` reads as genuine further reading for the subject, not just the sources actually cited in the prose — check it isn't artificially capped at the old 4-link habit when the subject supports more.

(For JSON validity, batch size, and import-format checks, see the equivalent checklist in `json-import-skill.md`.)
