# Decisions — the article pipeline, the writer, sources, ages and review (2026-10-09 / 10)

**Date:** 2026-10-09 (Friday) and 2026-10-10 (Saturday)
**Who decided:** Tom, in chat with Claude. Anything Claude proposed that Tom has not answered is under "OPEN" at the end, never in the numbered list.
**Relationship to older docs:** adds to `DECISIONS-2026-10-06-spoken-titles-and-ledger.md` and to the design in `ARTICLE-PIPELINE-DESIGN-2026-10-07.md`. Where it differs from either, THIS file wins, and says so below. What is built is in `content-generation-workflow-state.md`; the dated build history is in `PIPELINE-BUILD-LOG.md`.
**Status of code:** every item marked "built" was written and tested offline (mocked websites and models). None of the new code has yet run against a real model except Jerome, which has been run live on four subjects.

---

## The order of work

**D1. Finish the end-to-end pipeline first; proofing of existing articles comes later.** (Tom, 2026-10-09: "Let's worry about that later. We need to get the pipeline done.") "Proofing" means checking the 453 existing articles against sources and adding sources so they can be kept instead of rewritten. Deferred. The pipeline is Jerome (find sources) → Augustine (write) → Thomas (check) → recording → Tom approves.

**D2. Thomas is built before Augustine.** Claude proposed it; Tom said "Go". Reasons: Thomas mostly existed (`ledger-build`), it is the only way to judge Augustine's output with numbers, and checking an article against its own sources is also the proofing check for later. Status: built (v1.4, as a patch against the live v1.3 file).

## Sources

**D3. Proof comes only from the article's own links** (kept from Part 7 of the 2026-10-06 decisions). Jerome's pages that an article does not link are **suggestions only, never proof**. For articles Augustine writes this is automatic: he writes his links from Jerome's pages. For existing articles it is the deferred proofing question.

**D4. When sources disagree, the writer picks the winner and adds a review note; Tom makes the final decision.** (Tom: "I say pick the winner but add a note to review and I will look at it and make a final decision.") The higher-ranked tier wins; with equal rank the more specific, then the fuller source; a body speaking about itself on its own subject wins on that subject. Each note names both versions, both sources and the reason. Replaces the earlier proposal that he state both versions. Built.

**D5. Site approval is done by the pipeline's judge, Ignatius, not by Tom.** For an apparition or miracle Jerome finds the competent diocese's own website, code checks the page, and the site goes into `ignatius-queue.json` marked "waiting". Jerome never approves a site. Ignatius is **not built**; until he is, nothing in the queue is approved. Built: the lookup and the queue.

**D6. Every site in the source registry records when it was added and approved, and by whom.** Fields `addedAt`, `approvedAt`, `approvedBy` on each entry of `scripts/ledger-allowlist.json`; an "Approved" column on `SOURCE-ALLOWLIST.md`. The 49 enabled and 59 listed-only sites are dated from the repo's own git history (a workflow, dry run first); `approvedBy` stays empty for them. Built; the workflow has not been run.

**D7. The registry is the one list of trusted sites, read by both Jerome and Thomas through `scripts/services/registry.mjs`.** A tier with `canVerify: false` ("reported") can only ever give the status "reported", never "verified". Found on 2026-10-10: the live `ledger-build` was v1.3 and still used its own hard-coded list; v1.4 (the patch) fixes that. Built, not yet placed.

## Review and recording

**D8. Tom approves every new or rewritten article himself, and he reviews by LISTENING.** So the recording is made from the draft right away, **before** approval (this reverses stage 6 of the design, which had audio after the human gate). The draft lives in `drafts/<id>.json` and never touches the live article until approved; the recording goes live with the article, so nothing is re-recorded on approval. Not built: Thomas on a draft, the recording from a draft, the approval screen.

**D9. Narration stays on the free Kokoro voice permanently**, so recording a draft that is later rejected costs nothing. (Tom's notes give the final voice as `am_adam`; 223 of the 245 existing recordings are stamped `kokoro:af_heart`. Whether older recordings are redone is not decided here.) The repo is public, so GitHub Actions minutes are free.

## The writer (Augustine)

**D10. Augustine's model is Claude Sonnet (currently Sonnet 5.5, `claude-sonnet-5-5`), and he is the one role that does not swap models**, for a consistent voice. The other roles (Jerome, Thomas, Ignatius) may swap models to save money; Thomas is to be very capable. (2026-10-10: Claude had briefly set the default to Opus from an earlier note; Tom corrected it: "Sonnet is supposed to be Augustine's model.") `payload.model` can still choose another model for a one-off comparison, for example Opus on a few entries to see whether it is worth about double the writer cost.

**D11. The writing rules are `content-authoring-skill.md`, written by Claude and approved by Tom, not written by Tom.** Tom likes the style and quality. The writer reads an excerpt of them, `scripts/writer-rules.md`, which must be updated whenever the skill changes. Known gap: the Marian apparition approval rules section is missing from the Project copy of the skill; until it is restored the writer states no approval level that the sources do not state outright, and every apparition and miracle draft gets an "approval" review note.

**D12. "Quietly" is rationed, not banned.** Tom likes the word and it is overused: 56 uses in 48 of the 453 articles, up to 5 in one; some form of "quiet" in 111 articles. Limit: "quietly" once per article, the whole family twice, with synonyms given to the writer. The limits are lines in `scripts/writer-style.json` (add a line for any new overused word; no code change). Built.

**D13. Age at death is given for every saint where it can be, even if a date is fuzzy by a year or so; "died at about 87" is fine.** Code computes it, a model never does: exact only from two full dates, otherwise "(estimated age N)" from the years, a range or "c." giving the midpoint. **When the earliest and latest possible ages are more than 6 years apart, or there is no birth year, no age is given and NO review note is made** (Tom: "No note needed if age is left out"). The writer places the marker `[[AGE]]` and code fills it: "at about seventy-five". Built. A patch for existing saints (66 of 226 can be given an estimate from facts already present) is for Tom to apply in the app. **A computed age is not a sourced claim: when Thomas checks drafts he must strip it before the number check.** (Not yet done.) An older service, `scripts/services/age-backfill.mjs`, already exists in the repo and Claude has not read it; its rules must be compared with `lifespan.mjs` before both are used.

**D14. The writer's view of the sources is recorded.** Each draft stores whether the sources were too little, about right or too much, which he used, the gaps and what would have helped, plus per-source statistics. It changes nothing yet; it is evidence for D16. Built.

## The app

**D15. Image paths: fix the resolver, not the data.** The image workflow saves `Images/Saints/x.jpg` while the Images base setting ends in `/Images`, so the app built `…//Images/Images/Saints/…`. `resolveAsset()` in `index.html` now drops a repeated leading folder and collapses double slashes; older bare paths resolve as before; changing the base setting to the site root would break the older entries and must not be done. Delivered as `index.html` v565, built from v564; **not confirmed deployed**, and the live file must still say v564 before it is replaced.

## Later

**D16. Efficiency comes only after quality.** First: accurate, well-written, beautiful articles at a reasonable price. Then trim waste without lowering quality: ask the writer whether the sources were too little or too much and give him less; extract facts programmatically beforehand; cache the source block across retries; cap words per source; the Batch API (50% off). **Rule for deciding: change one thing at a time, run the same entries both ways, accept a saving only if Thomas's verified count does not fall, the form checks pass, and Tom cannot tell by listening.**

**D17. The full-library cost must be estimated, then a pilot run before anything large.** Estimate on 2026-10-09, with Augustine on Sonnet (D10): about **$240 expected, range $90 to $600**, for 453 entries. (A one-off run of the writer on Opus would roughly double the writer line, about $100 more over the whole library.) Still an estimate: the writer, Thomas and Ignatius lines have not been measured. A 10-entry pilot (about $5 to $10 at these prices), spend limits in the three vendors' consoles, and the Batch API come before any full run.

---

## OPEN: proposed, not yet decided by Tom

1. **The martyr code.** Tom wants a code on saints marking martyrdom so a badge can show on the card and the timeline can be filtered by martyrs, and wants how a person died recorded. Proposed: a boolean `martyr` on the entry, plus a "Manner of death" Quick Fact. **Not a `tags` field**: `tags` is already planned for Tom's own free-form flags (a tag plus a note). It needs an app change (a new field in the import, patch and editor code, a badge, a filter chip), so it waits for Tom's go-ahead and the current `index.html`. Data: 55 saints already have "Martyr" in their Title; 9 more (mostly apostles) describe a martyrdom without it. **Question for Tom:** do apostles martyred "by tradition" (Matthias, Philip, Simon, Jude, Barnabas, and others) count as martyrs for the badge? Claude recommends yes, with the tradition stated in the Manner of death fact.
2. **Does Tom want the writer to produce the Manner of death fact for every saint, or only martyrs?**
3. **An Augustine pilot workflow** (a Run form like Jerome's) so Tom can start a draft from his phone. Claude recommends building it next.
4. **Which `ledger-build` and bundle deliveries are already placed** (see the tracker in the state doc).
