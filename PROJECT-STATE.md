# Catholic Timeline — Project State

**Last updated:** 2026-08-16
**Current live version:** v155

**Update cadence:**
- *Built & Live* — update every version bump (same moment as the changelog block).
- *Designed, Not Built* — update when a phase actually ships, not per-build.
- *Backlog* — update whenever something moves in or out.

This file answers "what's real right now" — for *how* anything works, follow the links out to the detailed doc rather than re-explaining it here.

---

## 1. Built & Live (as of v155)

- Category band labels/icons: bolder labels, sticky icon tiles, jitter fixed.
- Timeline focus/glow system: shared `centerAndFocus()`/`setTimelineFocus()` across tap, search, feast-of-day, article close.
- PWA update detection: `visibilitychange`-triggered service worker refresh, gold pulse on hamburger when a new version is live.
- Eucharistic Miracle articles: batch-written chronologically through ~1400s.
- iPhone install instructions: 4-step flow, platform-detected.
- Article sheet drag handle: full-width top band, drags/dismisses regardless of scroll position.
- Carlo Acutis exhibition banner: renders after Quick Facts, before story sections (v153).
- **Triple-tap-to-link (v154, fixed v155):** in Review Mode + Owner Tools, triple-tapping a word in an article opens a picker — tapped word, ◀/▶ to extend it, a search box reusing the timeline's own name/`alt` matching, OK/Cancel. Queues a cross-reference link for the reading session (dotted marker shown in place); closing the article with links queued prompts "Save N link(s)?" and, on confirm, applies them through the existing manual-link-list mechanism and auto-publishes to GitHub immediately. v155 fixed the picker being swallowed by the "tap outside closes the card" handler.
- Content model: `entries`, `locations`, `documents`, `carloLinks` — all paste-ready via the unified CMS JSON box. See `json-import-skill.md`.
- ~185 seed entries; ongoing batch article-writing effort (Eucharistic Miracles, feast-day gaps).

## 2. Designed, Not Built

| Item | Spec lives in | Status |
|---|---|---|
| Content pipeline (queue → AI → staging → human resolve → merge), all 9+ workflows | `content-pipeline-vision.md` | Fully designed. Nothing built. |
| → Article review (critique/defense/resolve) | `content-pipeline-vision.md` §3 | **Next up.** Step one: add `OPENAI_API_KEY` secret, build critique-only Action against `workQueue.articleReview.json`. |
| **`patches` micro-update format** — surgical single-field/element edits (`[section, element, operation, value]`) as an alternative to resending whole objects for a small fix | `json-import-skill.md` Part 2 | Spec fully designed and locked. Parser not yet built into `index.html`'s Paste JSON handler — next real build task. |
| Locations & Documents schema | `json-import-skill.md` | Fully designed, paste-ready in the CMS. Not populated at scale yet. |
| True offline launch (service worker) | — (discussed, not written up) | ~30-line `sw.js` + small `index.html` addition. Must cooperate with existing update-check feature. |
| Gesture tuning (`vFling` etc.) | — | HUD-calibrated default is ~10x too low. Waiting on Tom's baseline swipe data. |

## 3. Open Decisions (flagged, not resolved)

- **Image pipeline has two competing designs on record:** an earlier separate Vercel/Supabase image-generation/review site, and the GitHub-Actions-based image workflows (scene brainstorm → prompt → acquisition → review) now folded into `content-pipeline-vision.md`. These haven't been reconciled — worth explicitly deciding one before either gets built, rather than building both.

## 4. Backlog / Idea Stage

- Lightning storm video header (footage pending; ffmpeg crop confirmed feasible).
- Feast day gap-filling: 199 dates with no saint identified (notable misses: Clement I, Ephrem the Syrian, Peter Chrysologus, Peter Canisius, Pachomius, Gregory VII, Louis & Zélie Martin, André Bessette, Columbanus, John Cassian, others).
- Continue Eucharistic Miracle batch writing past ~1400s.
- `Died (at age N)` fact backfill: 85 entries have a computed value ready to apply (see `died-age-updates.json` from the age-computation pass) — a good first real test case for the `patches` format once it's built, since it's 85 single-field edits.

---

## Skill docs (as of this update)

The content-authoring rules and the JSON/import mechanics used to live in one file, `timeline-entry-json-skill.md`. That file has been split into two, since a given task rarely needs both halves at once:

- **`content-authoring-skill.md`** — voice, the four-tier sourcing discipline, word-count targets, country/review-flag/age-at-death judgment calls, per-type Quick Facts vocabulary, the pre-delivery content checklist.
- **`json-import-skill.md`** — entry/location/document/carloLink JSON shapes and field reference (Part 1), plus the new `patches` micro-update spec (Part 2), the round-trip workflow, and format-only response rules.

`timeline-entry-json-skill.md` should be removed from the Project once these two are added, so Claude isn't working from a stale combined copy alongside the split ones.

*Related docs: `content-authoring-skill.md` + `json-import-skill.md` (content and JSON format, respectively), `content-pipeline-vision.md` (pipeline architecture), `CLAUDE.md` (session instructions — should point here first).*
