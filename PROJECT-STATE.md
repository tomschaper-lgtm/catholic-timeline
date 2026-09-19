# Catholic Timeline — Project State

**Last updated:** 2026-09-19
**Version this reflects:** v427 (as delivered by Claude this session — confirm what's actually
pushed to `main`, since deploys happen on Tom's side)

**How this update was put together, and its confidence level:** the app's version history has
lived entirely in a changelog (now `CHANGELOG.md`, split out of `index.html`'s header comment
in v418 — see `app-engineering-skill.md`) rather than in this file, so this file had drifted
badly out of date (last touched at v155; the app is at v418). This refresh was reconstructed by
reading through that changelog plus `content-generation-workflow-state.md` (itself dated
2026-09-08, so slightly behind the very latest entries) — not by testing the live site feature
by feature. Treat "Built & Live" below as *changelog says this shipped*, not *verified working
right now*. Given how much history that involved, some detail or a since-reworked feature may
have been missed or misjudged — flag anything that reads wrong rather than assuming this is
now authoritative the way a freshly-written status doc would be.

**Update cadence:**
- *Built & Live* — update every version bump (same moment as the staging block entry).
- *Designed, Not Built* — update when a phase actually ships, not per-build.
- *Backlog* — update whenever something moves in or out.

This file answers "what's real right now" — for *how* anything works, follow the links out to the detailed doc rather than re-explaining it here.

---

## 1. Built & Live (as of v427)

**Task Automation (the orchestrator system) — the big area that grew the most since v155.**
`scripts/orchestrator.mjs` + `scripts/services/*.mjs`, queued through `workLog.json`, run from
the Task : Automation panel (Add Task / Task List / Review). Built-and-live services:
- **image-generate / image-finalize** — two-stage image pipeline (candidates → refined final),
  Picture Review and a second Final Review step with a Compare-to-original toggle, candidates
  never auto-deleted, redo/regenerate flow, failed-task error surfacing.
- **sentence-reword** — the long-sentence cleanup pass, redesigned from one-task-per-sentence to
  one-task-per-entity review; abbreviation-aware sentence splitting; a Model picker (Claude or
  GPT-5.6/OpenAI per batch); auto-approve now runs fully server-side with batched publishing
  (every 10 entities, not one commit per task) — see `content-generation-workflow-state.md` §4
  for the fuller design/status.
- **audio-generate** — audio recording brought in as a real orchestrator service (replacing
  older ad hoc generation), review-gated (native player + sentence-highlighting review screen,
  not direct-commit), Approve & Record integration with sentence-reword.
- **arbitrate/proofread (article review)** — the workflow `content-pipeline-vision.md` §3 called
  "next up" is now built and heavily refined: OpenAI critique → Claude defense → three-way
  compare/resolve, nav row with a debate counter, draggable resize grip, deferred/batched publish
  matching sentence-reword's pattern.
- **age-backfill** — the `Died (at age N)` fact backfill from the old backlog is done; also
  confirmed the `patches` micro-update format itself (`json-import-skill.md` Part 2) is built and
  in real use, both as this service's own result shape and via `index.html`'s own
  `patchTextInSections`, which server-side services port logic from directly.
- Shared Task List UI: All/Queued/Running/Review filters plus a type filter, swipe-to-delete,
  per-category batch selectors, live run feedback, a bounded `workLog.json` (auto-pruned) with a
  "Reset stuck" button for tasks that got stranded mid-run.

**Timeline / app UI**
- Category band labels/icons, timeline focus/glow system (`centerAndFocus()`/`setTimelineFocus()`),
  Carlo Acutis exhibition banner, triple-tap-to-link cross-referencing (Review Mode + Owner Tools).
- **Center-year readout** — a live "current year" badge locked to screen-center on the timeline
  axis, ticking through as the timeline scrolls; opened from Review-Mode-only to every visitor
  in v414 after several rounds of fixes (drift, visibility, masking, styling).
- **Ken Burns** slow zoom/drift on article hero photos — built at v213, was Review-Mode-only
  while being evaluated, opened to everyone in v414.
- **Landscape mode** (v413) — church dome image hidden, title shrunk, search box folded into a
  single compact header row alongside the title and hamburger/gear button.
- Content model: `entries`, `locations`, `documents`, `carloLinks` — paste-ready via the unified
  CMS JSON box, patches included (see above). See `json-import-skill.md`.

**Offline access (new this session, v415–v417)**
- `sw.js` (service worker) — network-first for the page and `data.json` (so the existing
  reload-driven update check is unaffected), stale-while-revalidate for images/audio in a
  separate cache. Proactively pulls every entry's image/audio (+ timing json) once every 24h,
  throttled, rather than only caching whatever's been viewed. Persistent storage requested.
  Broken-image self-heal on reconnect (browsers never retry a failed `<img>` on their own).
- PWA update detection: version-comment poll + gold pulse on the hamburger when a build is live,
  unaffected by the service worker's caching strategy (confirmed still relies on a plain reload
  reaching the network, deliberately preserved when the service worker was added).

**Changelog / engineering process (v418, revised v427)**
- Full changelog lives in `CHANGELOG.md`; `index.html`'s header keeps a minimal
  VERSION/DATE/CHANGES shape specifically because a GitHub Action parses it into `changelog.json`
  for the Logs tab — see `app-engineering-skill.md`. Entries use an Ask/Implementation format.
- **v427 changed where entries are first written.** They now go into a sentinel-delimited staging
  block in `index.html`'s header, and a daily job (`scripts/sync-changelog.mjs`, run by
  `.github/workflows/sync-changelog.yml`) files them into `CHANGELOG.md` and trims the block back
  to the newest few. Reason: `index.html` is the file a chat session can edit and hand back whole,
  `CHANGELOG.md` is not — so entries written straight to `CHANGELOG.md` kept getting skipped
  (v420–v426 were all missing from it until v427 backfilled them). The job prunes by version
  number, never by age, and refuses to prune anything not confirmed present in `CHANGELOG.md`, so
  it is safe to run twice a day or to miss a week. Full rationale in `app-engineering-skill.md`.
- Version bumps still touch exactly two places: `const APP_VERSION` in `index.html`, and a new
  entry at the top of that staging block (no longer `CHANGELOG.md` directly).

## 2. Designed, Not Built

| Item | Spec lives in | Status |
|---|---|---|
| Entity brainstorming (new records entering the catalog with human approval) | `content-pipeline-vision.md` §3 workflow #1 | Still not built — no changelog evidence found. |
| Image scene brainstorming / prompt generation as separate human-gated steps | `content-pipeline-vision.md` §3 workflows #4/#5 | Still not built — image-generate builds the scene/prompt internally, no separate brainstorm-and-choose step. |
| Image search / stock sourcing as an alternative to generation | `content-pipeline-vision.md` §3 workflow #7 | Still not built. |
| Real **images table** (multiple images/entity, gallery, source tracking) | `content-pipeline-vision.md` §3 | Still not built — single `img`/`imgCap` pair per entry remains the only image slot. |
| Cross-reference **generation** (AI proposes missing links, vs. today's pattern-matcher + manual triple-tap) | `content-generation-workflow-state.md` §6 | Still not built. |
| Event/location and document **generation** automation | `content-generation-workflow-state.md` §6 | Still not built — both tables are populated manually only. |
| Audio pronunciation-dictionary workflow (fix Roman-numeral/name mispronunciations) | `content-generation-workflow-state.md` §5 | Still not built as of that doc's last update (2026-09-08) — worth confirming nothing's changed since. |
| Gesture tuning (`vFling` etc.) | — | No changelog evidence of movement; still waiting on Tom's baseline swipe data. |

*Everything else that was in this table as of v155 — the content pipeline generally, `patches`, Locations & Documents schema — has since been built; see §1 above.*

## 3. Open Decisions (flagged, not resolved)

- **Image pipeline "two competing designs" (from v155-era notes) — resolved in practice, not on paper.** The GitHub-Actions-based orchestrator approach is what actually got built (image-generate/image-finalize, live and heavily used); no changelog evidence the separate Vercel/Supabase design was ever built or is still being considered. Worth an explicit line confirming that in `content-pipeline-vision.md` itself if it still frames this as open.

## 4. Backlog / Idea Stage

- Lightning storm video header (footage pending; ffmpeg crop confirmed feasible) — no changelog evidence of movement.
- Feast day gap-filling: 199 dates with no saint identified (notable misses: Clement I, Ephrem the Syrian, Peter Chrysologus, Peter Canisius, Pachomius, Gregory VII, Louis & Zélie Martin, André Bessette, Columbanus, John Cassian, others) — no changelog evidence of movement.
- Continue Eucharistic Miracle batch writing past ~1400s — status unconfirmed from the changelog; likely tracked in content sessions this app-engineering history doesn't cover.

---

## Skill docs (as of this update)

The content-authoring rules and the JSON/import mechanics used to live in one file, `timeline-entry-json-skill.md`. That file has been split into two, since a given task rarely needs both halves at once:

- **`content-authoring-skill.md`** — voice, the four-tier sourcing discipline, word-count targets, country/review-flag/age-at-death judgment calls, per-type Quick Facts vocabulary, the pre-delivery content checklist.
- **`json-import-skill.md`** — entry/location/document/carloLink JSON shapes and field reference (Part 1), plus the `patches` micro-update spec (Part 2, now built — see §1), the round-trip workflow, and format-only response rules.
- **`app-engineering-skill.md`** (added v418, extended v427) — engineering conventions for the app's own code, as opposed to the content above: the changelog convention (format, and the v427 staging-block-then-daily-sync flow), the two-places-to-bump-version rule, and why `index.html`'s header comment keeps a minimal VERSION/DATE/CHANGES shape rather than being trimmed to a bare pointer.

`timeline-entry-json-skill.md` should be removed from the Project once these two are added, so Claude isn't working from a stale combined copy alongside the split ones.

*Related docs: `content-authoring-skill.md` + `json-import-skill.md` (content and JSON format, respectively), `app-engineering-skill.md` (app code conventions), `content-pipeline-vision.md` (pipeline architecture — now significantly built, see §1/§2 above), `content-generation-workflow-state.md` (the more granular, content-generation-specific build status), `CLAUDE.md` (session instructions — should point here first).*
