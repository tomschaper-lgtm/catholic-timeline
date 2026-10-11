# Documents — what we have, what each is for, and how to keep them in order

**Last updated:** 2026-10-10 (Saturday)
**Status:** CURRENT. Start here. If you are a Claude chat that has just been given this Project, read this file first, then the documents under "Read these first".

---

## Why this file exists

By 2026-10-10 there were twelve documents, several saying "nothing is built yet" about things that had since been built, two documents each claiming to be the project's state, and the build history of the pipeline buried inside its design doc. Nothing was wrong with any one document; there was just no map and no rule for where new information goes. This is the map and the rules.

## The rules

1. **One home for each kind of information.**
   - **State** (what is built, designed, next): `content-generation-workflow-state.md` for the content pipeline; `PROJECT-STATE.md` for the app and hosting.
   - **Design** (how it is meant to work): `ARTICLE-PIPELINE-DESIGN-2026-10-07.md`. Stable; changes only when the design changes.
   - **Decisions** (what Tom ruled): one `DECISIONS-<date>-<topic>.md` per batch of rulings, numbered, each saying who decided and what it replaces. Never edit an old one; write a new one that says it supersedes it.
   - **Build log** (what was built, when, with what test counts): `PIPELINE-BUILD-LOG.md`, append-only, newest at the end.
   - **Rules for doing the work** (skills): `content-authoring-skill.md` (what to write), `json-import-skill.md` (import format), `DELIVERY-INSTRUCTIONS.md` (how Claude hands over files).
   - **Generated or reference data**: `SOURCE-ALLOWLIST.md` (generated from the registry; never edit by hand), `CHANGELOG.md` (the app's changelog, fed by a daily service).
2. **Every document starts with the same three lines:** `Last updated` (date), `Status` (CURRENT, STALE, SUPERSEDED BY …, or HISTORICAL), and what version of the code it `Reflects`. A document without them is assumed stale.
3. **Never delete history and never leave a wrong status line.** A superseded document gets a banner at its top pointing to its replacement; it is not removed or rewritten.
4. **After any build:** (a) add a build-log entry; (b) change that item's status row in the state document; (c) if Tom ruled on something, add or extend a decisions file; (d) change the "Last updated" date on each document touched. Four small edits, in that order, in the same delivery as the code.
5. **The repo is the master copy.** The Project's knowledge holds uploaded copies that do NOT update themselves. After documents change, re-upload the changed ones (the "Read these first" set is small on purpose). When a copy in the Project and the repo disagree, the repo wins.

---

## The map (as of 2026-10-10)

| Document | Kind | What it is | Status | What to do |
|---|---|---|---|---|
| `DOCS-INDEX.md` | Map | This file | CURRENT | Update the table when a document is added, retired or goes stale. |
| `content-generation-workflow-state.md` | State | Per area: built, designed or idea; the pipeline stage table; deliveries and where they stand; next steps; what we are waiting on | CURRENT (rewritten 2026-10-10; the 09-08 version said sentence-rewording and the ledger were not built) | Update after every build (rule 4). |
| `PROJECT-STATE.md` | State | The app: hosting, built and live features, designed-not-built, open decisions, things tried and reverted | **STALE.** Dated 2026-09-27 and reflects v495; the app is now v565 and has gained the Progress dashboard, QC statuses, arbitrate review, task type filter and more | Needs a refresh; Claude needs the current `index.html` changelog and Tom's confirmations. Do not rely on it for anything after v495. |
| `ARTICLE-PIPELINE-DESIGN-2026-10-07.md` | Design | The article pipeline from source search to recording: roles, stages, run log, storage and Scripture rules, category rules | CURRENT as a design (cleaned 2026-10-10; its build history moved out; status line fixed) | Two 2026-10-09 rulings change it: recording before approval, and Tom approving by listening; see the 10-09 decisions file. |
| `PIPELINE-BUILD-LOG.md` | Build log | Dated entries: each Jerome version and live run, the registry, Thomas v1.4, Augustine v0.1 and v0.2, with test counts | CURRENT, append-only | Add an entry per build. |
| `DECISIONS-2026-10-06-spoken-titles-and-ledger.md` | Decisions | Spoken titles, the first `ledger-build`, the planned article-write (Part 3), v562, the Scripture standard (NABRE), the source registry | CURRENT for its topics. **Part 3 (article-write, "nothing built") is superseded** by the design doc and by the 10-09 decisions. `PROJECT-STATE.md` is out of date on its topics. | Leave as history. |
| `DECISIONS-2026-10-09-pipeline-writer.md` | Decisions | Tom's rulings of 2026-10-09 and 10: order of work, source conflicts, approval by listening, Kokoro, Augustine on Sonnet, "quietly", age at death, efficiency later, the cost estimate; and the OPEN questions | CURRENT | Add a new dated file for the next batch of rulings; do not edit this one except to close an OPEN item. |
| `source-proof-ledger-spec.md` | Spec | The source-proof ledger and the tap-a-sentence viewer, dated 2026-09-28 | **PARTLY STALE.** Its status line says "nothing built yet"; `ledger-build` (the ledger half) has since been built and is at v1.3, with v1.4 ready. The viewer is still not built. | Add a banner saying so (not yet done; see below). |
| `content-pipeline-vision.md` | Vision | The original nine-workflow architecture | **HISTORICAL.** Its status line says "design only, nothing built yet". Still useful for the shared-engine idea. | Add a banner pointing to the state document (not yet done). |
| `content-authoring-skill.md` | Skill | Voice, sourcing tiers, word counts, dates, Quick Facts, country, age rules | CURRENT. Written by Claude and approved by Tom. **Known gap:** the Marian apparition approval rules section is missing from the Project copy. | Restore the section from Tom's own copy. When this changes, update `scripts/writer-rules.md` too. |
| `json-import-skill.md` | Skill | The Paste-JSON import format: tables, fields, ids, the `patches` micro-update format | CURRENT (v562) | A new entry field (such as `martyr`) needs the app's import and patch code and this document updated together. |
| `app-engineering-skill_md.md` | Skill (fragment) | The changelog convention only; its own text says the full `app-engineering-skill.md` is not in the Project | **FRAGMENT** | Upload the full `app-engineering-skill.md` from the repo, or merge this fragment into it. |
| `DELIVERY-INSTRUCTIONS.md` | Rules | How Claude delivers files when it cannot push to GitHub: bundles, patches, protected files, tests | CURRENT (v3.5) | Update when the delivery method changes. |
| `SOURCE-ALLOWLIST.md` | Generated | The trusted-sites table with descriptions and (after the dates workflow runs) approval dates | CURRENT in structure; the Approved column appears after the Registry dates workflow is run | Never edit by hand; edit `scripts/ledger-allowlist.json`. |
| `CHANGELOG.md` | App changelog | 121 KB of app changes, newest first | CURRENT (fed by a daily service) | Too big to load into every chat; use only to look up a version. |
| `scripts/writer-rules.md`, `scripts/writer-style.json` | Config (repo only) | The writer's house rules (a verbatim excerpt of the authoring skill) and the words he may use only a limited number of times | CURRENT | Edit to change how Augustine writes; no code change needed. |
| `CLAUDE.md` (repo) | Instructions | Listed among the repo's skill docs in the project notes | **NOT SEEN** in these chats | Tom to upload if it should be part of the picture. |

**Memory (separate from documents).** Claude's project memory holds Tom's preferences and a running list of what he has said about the app and the pipeline. It is not a substitute for a document: anything a future chat must rely on belongs in a decisions file or the state document.

---

## Read these first (the small set to keep in the Project's knowledge)

In this order; about 145 KB in total, under half of the whole set (about 310 KB, 120 KB of it the changelog):

1. `DOCS-INDEX.md`
2. `content-generation-workflow-state.md`
3. `DECISIONS-2026-10-09-pipeline-writer.md` and `DECISIONS-2026-10-06-spoken-titles-and-ledger.md`
4. `ARTICLE-PIPELINE-DESIGN-2026-10-07.md`
5. `DELIVERY-INSTRUCTIONS.md`
6. `content-authoring-skill.md` and `json-import-skill.md` when writing or importing content

**Keep out of every chat unless needed:** `CHANGELOG.md` (121 KB), `SOURCE-ALLOWLIST.md` (33 KB), `PIPELINE-BUILD-LOG.md` (31 KB), `content-pipeline-vision.md`, `source-proof-ledger-spec.md`.

---

## Known inconsistencies still to fix

1. `PROJECT-STATE.md` is a month of changes behind (v495 against v565).
2. Status banners are still to be added to `source-proof-ledger-spec.md` and `content-pipeline-vision.md`. They were not done in this delivery because those two files may or may not be in the repo, and a bundle that patches a file that is not there is refused whole; Tom to say where they live, or send them, and the banners follow.
3. The apparition approval section is missing from `content-authoring-skill.md`.
4. The full `app-engineering-skill.md` is not in the Project.
5. `age-backfill.mjs` (older, in the repo) and `lifespan-backfill.mjs` (new) overlap; their rules must be compared before both are used.
6. Two copies of every document exist (repo and Project); only the repo is kept current automatically.
