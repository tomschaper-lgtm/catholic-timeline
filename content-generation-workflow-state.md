# Catholic Timeline — Content Generation: State & Roadmap

**Last updated:** 2026-10-10 (Saturday) · rewritten; the 2026-09-08 version was badly out of date (it said sentence-rewording and the ledger were not built)
**Status:** CURRENT. This is the ONE place that says **what is built, what is only designed, and what is next.** Design is in `ARTICLE-PIPELINE-DESIGN-2026-10-07.md`, Tom's rulings are in the `DECISIONS-*.md` files, the dated build history is in `PIPELINE-BUILD-LOG.md`, and `DOCS-INDEX.md` says which document is for what.
**Reflects:** the repo as Tom last described it, plus everything built in the 2026-10-08 to 10-10 chats. **Whether the deliveries listed in section 8 are placed in the repo is NOT known** and is the first thing to confirm.

**How sure each line is**
- **[LIVE]** running in production, per Tom or confirmed in the repo.
- **[LIVE-TESTED]** has run for real (GitHub Actions, real APIs) in a pilot, results reviewed.
- **[BUILT]** written and tested offline (fake websites and fake models), not yet run for real.
- **[DESIGNED]** a written spec, no code.
- **[IDEA]** discussed only.

---

## 1. At a glance

| Service (task type) | File | Status | Notes |
|---|---|---|---|
| `image-generate`, `image-finalize` | `scripts/services/` | [LIVE] | Section 5. |
| `sentence-reword` | `scripts/services/sentence-reword.mjs` | [LIVE] per Tom | Runs on OpenAI "Luna"; auto-approve path is server-side. |
| `arbitrate` (proofread) | `scripts/services/` | [LIVE] per Tom | Luna and Gemini debate; Tom reviews; never auto-applied. |
| `fact-research` | not found | [DESIGNED] | Revised: several models research independently, Tom picks one candidate. Build not confirmed. |
| `sentence-length-audit`, `age-backfill`, `repair-cue-gaps` | `scripts/` | [LIVE] per the Sept 28 notes | `age-backfill` overlaps the new `lifespan-backfill`; see section 7. |
| `audio-generate` (Kokoro + ElevenLabs) | `scripts/services/audio-generate.mjs` | [LIVE] for Kokoro | Section 6. |
| `ledger-build` ("Thomas") | `scripts/services/ledger-build.mjs` | v1.3 in the repo (confirmed 2026-10-10); v1.4 [BUILT] | Section 4. |
| `source-find` ("Jerome") | `scripts/services/source-finder.mjs` | [LIVE-TESTED] | Four live runs. Section 3. |
| `article-write` ("Augustine") | `scripts/services/article-writer.mjs` | [BUILT] | Never run with a real model. Section 3. |
| Ignatius (judge) | none | [DESIGNED] | Queue file exists; he does not. |
| Thomas on a draft; recording from a draft; approval screen; one task that chains the stages | none | [DESIGNED] | Section 3. |

---

## 2. Shared infrastructure

**[LIVE]** `scripts/orchestrator.mjs` (generic runner, started by `workflow_dispatch`), `scripts/services/*.mjs` (one handler per task type) and `workLog.json` (the queue), shown in the app's Task Automation panel (Add Task, Task List, Review). A handler is called `handler(task, dataJson, workLog)` and returns a result, a summary, a provider and token count, and either `filesToCommit` (the orchestrator commits them) or `awaitingReview: true` (a person must decide). Errors are captured on the task and are retryable. Per Tom's notes: the orchestrator keeps only the 75 most recently updated finished tasks; the Task List has a type filter; the "auto-approve split sentences" path batch-commits `data.json` every 10 entities.

**[BUILT, this session]** two cross-cutting helpers every new service uses: `scripts/services/registry.mjs` (the one reader of the source registry `scripts/ledger-allowlist.json`) and `scripts/services/article-log.mjs` (a short readable record of every article's work: steps, minutes, tokens per model; dollars are worked out from `scripts/pricing.json` when viewed, so a corrected price fixes old numbers). `scripts/pricing.json` holds only prices read from the vendors' own pages (Anthropic, Google, OpenAI).

**[BUILT]** `scripts/services/place-files.mjs` and its workflow: Claude's chat sandbox cannot push to GitHub, so Claude hands over a **bundle** (one JSON file) that Tom uploads to the top folder of the repo; the workflow places the files, runs the bundle's tests, and commits only if they pass. Large files are changed with find-and-replace **patches**, never replaced. Rules for this are in `DELIVERY-INSTRUCTIONS.md`.

**[DESIGNED, not needed yet]** per-type queue files, a per-entity stage map, a dependency table, and a generalized review screen (design vision, `content-pipeline-vision.md`). Only worth building when one workflow must wait for another.

---

## 3. The article pipeline (new subjects and rewrites)

The chain, in the order work flows. Every stage logs its tokens to `article-log.json`.

| # | Role | What it does | Status |
|---|---|---|---|
| 1 | **Jerome** (`source-find`) | Searches the web for pages about the subject, keeps only registry-approved sites, ranks them, picks the best 3 to 4 across different perspectives, applies the editorial rules per category (a Blessed is "not canonized", an apparition always goes to review), and saves `sources/<entry-id>.json`. For apparitions and miracles also finds the diocese's own website and queues it for Ignatius. | [LIVE-TESTED] on St. Augustine, St. Pachomius, Blessed Michael McGivney and Our Lady of Akita, $0.06 to $0.18 each on Haiku 5.5. |
| 2 | **Ignatius** (judge) | Decides unjudged sites in `ignatius-queue.json` and the cases Jerome cannot decide. | [DESIGNED]. |
| 3 | **Augustine** (`article-write`) | Writes ONE draft from Jerome's pages only, on Claude Sonnet 5.5 (the one role that does not swap models). Picks the winner when sources disagree and writes a review note. Code checks the 40-word sentence limit, length tier, American dates, quotations word for word in a source, Quick Fact labels, rationed words ("quietly"), and age at death; up to 3 attempts with the reasons fed back; saved anyway if still failing. Writes `drafts/<entry-id>.json`, never `data.json`. Also records his view of the sources. | [BUILT]. |
| 4 | **Thomas** (`ledger-build`) | Checks every claim in an article against its own linked sources: a model lists the claims, a second finds a word-for-word excerpt, a third judges blind; numbers are matched by code. Status per claim: verified, reported, traditional, disputed, unsourced. | v1.3 in the repo; v1.4 [BUILT] (reads the registry, "reported" tier, Jerome's file, measured cost). **Cannot yet check a DRAFT** (it reads `data.json` only). |
| 5 | **Recorder** | Records the draft with Kokoro right away so Tom can listen before approving. | [DESIGNED]. Needs a patch to `audio-generate.mjs` (current copy needed). |
| 6 | **Approval** | Tom listens, reads the review notes and Thomas's counts, approves or rejects. Approval merges the draft into `data.json` and the recording goes live with it. | [DESIGNED]. The orchestrator already has an `awaiting_review` finish; the app needs a resolver screen for it. |
| 7 | **One task** that runs stages 1 to 6 in a row per article | | [DESIGNED]. |

**Rules in force** (full text in `DECISIONS-2026-10-09-pipeline-writer.md`): the writer picks winners and flags them; nothing goes live without Tom; Tom reviews by listening; proof only from the article's own links; Kokoro permanently; the writer stays on one model; proofing existing articles is deferred.

**How a run is started today.** Jerome: from the phone, GitHub → Actions → "Jerome pilot" → Run workflow, with dropdowns for model and category (workflow `.github/workflows/jerome-pilot.yml`). Augustine and Thomas-on-drafts have **no run form yet**.

**Cost** (an estimate; the writer, Thomas and Ignatius lines are not yet measured). Jerome is measured at $0.06 to $0.18 per entry on Haiku 5.5, about 90% of it web-search charges. Whole library of 453 entries with Augustine on Sonnet 5.5: **about $240 expected, about $90 to $600 range**, no audio (Kokoro is free; the repo is public so Actions minutes are free). The Batch API would take 50% off the Claude parts. A 10-entry pilot and spend limits in the vendors' consoles come before any full run.

**Known gaps in this part:** the Marian apparition approval rules are missing from the Project copy of `content-authoring-skill.md`; the registry has no trusted source yet for apparition approval status; page text is stored in `sources/` only for sites Tom marks `"storage": "full"` (none yet), so the writer and Thomas fetch the pages again.

---

## 4. Fact-checking and quality control

- **`ledger-build` (Thomas), the source-proof ledger.** v1.3 [LIVE in the repo; the Add Task option "Build source ledger" runs it per category]. v1.4 [BUILT] is a 20-edit patch (bundle `patch-thomas-v1.4`): the registry decides which sites count, a tier that cannot verify gives "reported", Jerome's saved pages are used, unlinked ones are suggestions, tokens per role are logged. The tap-a-sentence viewer that shows a reader the proof (`source-proof-ledger-spec.md`) is [DESIGNED], not built; it must say "Source excerpt", never "Verified".
- **`arbitrate`** [LIVE] per Tom: two models debate each fix; only upheld proposals reach Tom.
- **`sentence-reword`** [LIVE] per Tom: never exceed 40 words, no exception; skips paragraphs with an `entry:` link; approving purges the entry's audio, because reworded text invalidates the recording.
- **`fact-research`** [DESIGNED] (revised).
- **Progress dashboard** and per-entry `qc` status: per Tom's notes the Progress page replaced the Logs tab and tracks Proofread, Audio recorded, Images and Pronunciation checked. The status of the `qc` object was not re-checked in this chat.

## 5. Images

[LIVE] two stages as orchestrator handlers. `image-generate` makes two candidates from a scene prompt built off the article and the master instructions (`Image_Generation.md`), shown in Picture Review. `image-finalize` refines the winner with OpenAI `images/edits` and comes back `awaiting_review`; Approve links it into the entry's `img`. Redo, Back to candidates and Compare to original exist. Candidates are kept indefinitely (no cleanup job).
**2026-10-10 fix:** the image-select workflow saves `Images/Saints/x.jpg` but the Images base setting ends in `/Images`, so the card showed nothing; `resolveAsset()` in `index.html` v565 now drops the repeated folder (see decision D15). [BUILT, not confirmed deployed.]
[DESIGNED, not built]: a real images table (hero, inline, gallery), image scene brainstorming, image search/stock sourcing, image review as its own step.

## 6. Audio and pronunciation

[LIVE] `audio-generate.mjs`: two engines, Kokoro (free, run in GitHub Actions, voice written `kokoro:<voice>`) and ElevenLabs (its credits are exhausted). **Tom's decision: Kokoro permanently.** 245 of the 453 entries have audio; 223 are stamped `kokoro:af_heart`; Tom's notes give the final voice as `am_adam` (whether older recordings are redone is not decided). Narration order: the article's name, a short pause, the article, the closing prayer ("<name>, pray for us"; an article can set its own with a `[prayer]` line, spoken but never shown). Spoken titles (Roman numerals as regnal ordinals, "the second") and a pronunciation table loaded through Manage → Paste JSON are built (v562); "records" is always the verb. Per Tom's notes a "pronunciation checked" flag is set only after he has listened to a whole recording.
[DESIGNED]: the mass mispronunciation finder (hard names in a short story, flag by touch), the word-by-word pronunciation picker, recording as a queue task, and **recording from a draft** (stage 5 above).

## 7. Other services and ideas

- **Age at death.** The 2026-09-08 plan was 85 entries with a computed age ready to apply. Today 87 saints show an age. **[BUILT, new]** `lifespan.mjs` computes an age with a 6-year tolerance and Augustine uses it; `lifespan-backfill.mjs` builds a Manage → Paste JSON patch (`ages-patch.json`) giving 66 more saints an estimated age. **An older `scripts/services/age-backfill.mjs` exists in the repo and has not been read in this chat**; compare its rules with `lifespan.mjs` before applying the patch.
- **Martyr code and badge.** [IDEA with a proposal, waiting on Tom]; see OPEN item 1 in `DECISIONS-2026-10-09-pipeline-writer.md`. Needs an `index.html` change.
- **Cross-references.** Mechanical side [LIVE]: Auto-Link Cross-References, and triple-tap-to-link in Review Mode. The AI proposal side is [DESIGNED].
- **Locations and documents tables** [DESIGNED], paste-ready, not populated at scale.
- **Feast-day gaps** (199 dates with no saint identified) and **brainstorming new entries** [DESIGNED / manual].
- **Catholic Calendar tab**, **daily readings**, **splitting `index.html` into a public site and a CMS**, **iOS Shortcuts push to GitHub** [IDEA].
- **Efficiency phase** [IDEA, deliberately later]: decision D16.

---

## 8. Deliveries from the 2026-10-09 / 10 chats, and how to tell if each is placed

Claude cannot see the repo, so for each delivery here is a quick check Tom can make on GitHub (does this file exist?). **Tom: please confirm which are placed; this table is then updated.** Place in this order; the first bundle brings everything up to date and is safe to place even if some earlier ones were.

| Order | Delivery | What it contains | Placed? check |
|---|---|---|---|
| 1 | `catchup-2026-10-10` bundle | The latest version of every new or changed script, test, rule file and document from these chats | `scripts/services/lifespan.mjs` exists |
| 2 | `patch-thomas-v1.4` bundle | Patch to the live `ledger-build.mjs` and `pricing.json` | `ledger-build.mjs` header says v1.4 |
| 3 | `patch-orchestrator-article-write` bundle | Registers `article-write` in the orchestrator (two lines) | `orchestrator.mjs` mentions `runArticleWrite` |
| 4 | by hand: `.github/workflows/jerome-pilot.yml` (v2.5) | Run form with dropdowns; commits log, queue and sources | header says v2.5 |
| 5 | by hand: `.github/workflows/registry-dates.yml` | Dates the registry from git history (run Dry run first) | file exists |
| 6 | by hand: `index.html` v565 | The image-path fix | **only if the live file still says VERSION: 564**; otherwise send the current file |
| 7 | in the app: `ages-patch.json` | 66 estimated ages (Manage → Paste JSON → Apply) | not before the `age-backfill` comparison (section 7) |

---

## 9. Next, in order

1. **Confirm the placement table** (section 8), then run a first real Augustine draft: Jerome on one entry, then Augustine on the same entry. Needs an Augustine run form first.
2. Build the **Augustine pilot workflow** (a Run form like Jerome's).
3. **Thomas on a draft**, including stripping the computed age before the number check.
4. **Recording from a draft** (needs the current `audio-generate.mjs`).
5. The **approval screen** in the app (needs the current `index.html`).
6. **One task** that runs the stages in a row, and **Ignatius**.
7. The **martyr code** (after Tom's answers), the **log viewer** and a "Find sources" batch option in the app.
8. A 10-entry pilot with measured cost, then the efficiency phase (D16).

**Waiting on Tom:** which deliveries are placed; the martyr questions (apostles by tradition; Manner of death for every saint or only martyrs); a go-ahead for the Augustine pilot workflow; the current `ledger-build`, `audio-generate.mjs`, `index.html`, and `age-backfill.mjs` when we reach them.
