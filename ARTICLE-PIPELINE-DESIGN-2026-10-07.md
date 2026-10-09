# Article Pipeline — Design Doc (source-finding through recording)

**Project:** Catholic Timeline (catholictimeline.org)
**Owner:** Tom
**Date:** 2026-10-07
**Status:** Design only, agreed in a voice conversation. Nothing built yet. Build order: each
service built and tested standalone, against real inputs, before anything is chained together in
the orchestrator.

---

## 1. Why this exists

Two goals pull against each other if one model does both at once: writing well, and being provably
factual. The fix is to never ask one pass to do both. A writer writes freely from a fixed, bounded
set of sources. A separate checker (the ledger, already built) verifies every claim against those
same sources afterward. Nothing grades its own homework.

This doc extends that idea backward, to where the sources themselves come from, and forward, to
how a fix loop and recording complete the chain — plus a concrete real-world trigger: a site
visitor who searches for a saint who isn't on the timeline yet, and taps a "Suggest a Saint"
button.

## 2. Guiding decisions (from conversation)

- **Separate, independently testable services**, each with one job, chained by the orchestrator
  only once each stage is built and tested alone — the same way `ledger-build` was built standalone
  before anything used it.
- **The writer never grades itself.** A different stage (the researcher — `ledger-build`) checks
  the writer's claims, on a different model than the writer, same discipline the ledger's prover
  and judge already follow (different providers so neither checks its own work).
- **The fix loop is a patch, not a rewrite.** The writer only touches sentences the researcher
  flagged.
- **Source trust is judged once, by its own service, not re-litigated inline.** The source-finder
  finds candidates; a separate source-judge decides if a candidate belongs in the registry, at
  what tier. Once judged, a domain's verdict stands — no automatic re-review. (A human can always
  edit it later through the Allowed Sources page.)
- **New sources never self-promote to "trusted enough to verify."** A source-judge verdict in a
  tier that can mark claims verified still needs human confirmation before it can do so — the same
  `confirm:true` gate the Allowed Sources page (v565) already enforces.
- **A real human gate stays before publish**, at least at first. Everything upstream can run
  unattended; a "run the whole pipeline" action fires all stages back to back and lands at a review
  screen rather than auto-publishing silently.
- **A full run log is part of the design, not an add-on.** Every stage is named and reports what it
  did and found; the run produces a single readable record a person can open afterward and follow
  start to finish. See §5.
- **Tom is open to rewriting existing articles**, not just writing new ones, once this pipeline is
  solid.

## 2a. Names for the roles

Each stage is also given a real name, a patron saint matched to the job, so the run log (§5)
reads like a short, human account rather than a stack of generic labels — "Jerome found three
sources, handed off to Ignatius" rather than "source-finder: outcome ready."

| Name | Role | Why this patron |
|---|---|---|
| **Jerome** | Source-finder (stage 1) | Patron of scholars, librarians and translators — the obvious fit for digging up source material. |
| **Ignatius** | Source-judge (stage 1a) | Known for discernment — literally the practice of testing whether something can be trusted, which is exactly what judging a new domain's tier is. |
| **Augustine** | Writer, first draft and fix pass (stages 2 and 4) | One of the Church's most prolific and reflective writers (Confessions); fits "drafts the article" and "revises it" better than a patronage borrowed from elsewhere. |
| **Aquinas** | Researcher (stage 3 — `ledger-build`) | Built his theology by weighing sources and objections one by one before concluding anything — the same claim-by-claim discipline the ledger check already follows. |

The recorder (stage 6, `audio-generate`) and the human gate (stage 5) are not given names here —
they are not judgment roles the way the first four are, and `audio-generate` already has its own
identity in the app. Worth revisiting if that ever feels inconsistent in practice.

Note that Augustine does both writing stages: the fix pass is the same writing skill, just now
responding to Aquinas's findings instead of starting from the sources alone. This keeps the log
readable as a real back-and-forth: "Augustine drafted it. Aquinas found two issues. Augustine fixed
them. Aquinas confirmed."

## 3. The real-world trigger this is designed around

A visitor on the live site searches for a saint who isn't there, and taps a **"Suggest a Saint"**
button, typing in a name (e.g. "Saint Bertha"). That request is the first input to this whole
chain — thin, unverified, possibly misspelled, not a title Tom typed himself — so the first stage
has to be able to fail it honestly, not force an article out of nothing.

## 4. The chain, stage by stage

```
  visitor / Tom
       |  (category + title)
       v
  [1] SOURCE-FINDER  (Jerome) --------> [1a] SOURCE-JUDGE  (Ignatius) (only for domains not already in the registry)
       |  (sources, or an honest "no")
       v
  [2] WRITER, first draft  (Augustine)
       |  (draft article, sources-bounded)
       v
  [3] RESEARCHER  (Aquinas)  ( = ledger-build, already built )
       |  (pass/fail claim list)
       v
  [4] WRITER, fix pass  (Augustine again)  <-- loop back to [3] once or twice if claims still fail
       |  (clean draft)
       v
  [5] HUMAN GATE  (publish decision — at least at first)
       |
       v
  [6] RECORDER  ( = audio-generate, already built )
```

Every box above also writes one entry to the run log — see §5 — so the whole vertical path down
this diagram reads back as a single story afterward, not just a pass/fail at the end.

### [1] Source-finder — Jerome

**Input:** a category (`s` `c` `p` `m` `u` `e` — the same six type keys entries already use) and a
title/name string. Thin and unverified when it comes from the public "Suggest a Saint" button;
exact and deliberate when Tom queues it himself.

**Step 0 — already-exists check (runs before any search).** Checks the title against
`data.json`: exact name match, then `alt` (alternate names), then a looser fuzzy match, so a
differently-spelled request for an existing entry ("Saint Bertha" vs. "St. Bertha of Blangy")
doesn't get treated as new. If it matches, **stop here** and report which entry it is — no search
is run at all. (Expected to be the single most common outcome of the public button: most "missing"
saints are probably already on the timeline under a different spelling.)

**Step 1 — search, allowlist first.** If genuinely new, search `scripts/ledger-allowlist.json`'s
enabled domains for the subject.

**Step 2 — widen if the allowlist comes up empty.** Tom's call: yes, widen the search beyond the
current registry when nothing credible turns up there — this is the intended way new, legitimate
sources enter the system, not an edge case to avoid. Any domain found this way that isn't already
in the registry is **not** trusted on the spot; it's handed to the source-judge (§4.1a) before it
can be used as a proof source. This mirrors `ledger-build`'s existing `discover` mode, where
AI-found pages are suggestions only, never proof, until accepted — generalized here to mean
"accepted" = "the source-judge approved it."

**Scripture is a standing source, not something Jerome searches for.** The Bible is always
available to him, on every subject, rather than being one search result among others he might or
might not surface — fitting, given his own patronage as a translator of Scripture. The standing
translation is the **NABRE** (Tom's decision, 2026-10-07: it is the text heard at Mass), matching the
registry's one `scripture`-tier domain, `bible.usccb.org`. See §10 for how it is quoted and stored.

**Step 3 — assess "enough to write from."** Tom's rule, stated directly: "if it finds one source
and there's just not much to build an article... I'll fail that one." A numeric threshold (exact
numbers set once this is built, reviewed against real cases) — e.g. at least two usable sources, or
one from a verify-capable tier, with enough combined text to support a real article per
`content-authoring-skill.md`'s word-count targets.

**Four outcomes:**

| Outcome | Meaning | What happens next |
|---|---|---|
| `exists` | Title (or a close alt/fuzzy match) is already an entry | Report the existing entry id. Stop. |
| `not_found` | No credible source anywhere, allowlist or wider search | Report an honest refusal. Stop. |
| `too_thin` | Subject is real, but not enough material clears the threshold | Report what little was found, and why it doesn't clear the bar. Stop; a human can override later if more material surfaces. |
| `ready` | Enough sources found (and any new ones judged) | Hand off sources + fetched text to the writer. |

### [1a] Source-judge — Ignatius

**Input:** one candidate domain the source-finder found that is not already in
`scripts/ledger-allowlist.json`.

**Job:** exactly what was done by hand earlier in this project for `ccel.org`,
`catholic-hierarchy.org`, `stpaulcenter.com` and `miracolieucaristici.org` — identify the operator,
decide if that operator is real and accountable, decide if the content is original or a copy of
another source, and assign a tier using the existing tier ladder (`approved` / `scripture` /
`primary` / `reference` / `official` / `reported`). Same admission test already written into
`SOURCE-ALLOWLIST.md` §"What a source must pass to be added."

**Output:** a proposed registry entry, written via the same `sources` `add` op the Allowed Sources
page (v565) already uses — **always `enabled:false`**, with `vetted` stating "proposed by
source-judge `<date>`, not yet confirmed by a person." A judged tier that can mark claims verified
still needs a human to review and enable it — the registry already refuses to let an unconfirmed
entry into a verify-capable tier on its own.

**Runs once per domain.** Tom's decision: "once it's verified, we'll assume it's going to stay
verified" — no automatic re-check later. A human can still edit it by hand through the Allowed
Sources page if circumstances change.

### [2] Writer (first draft) — Augustine

**Input:** only the sources the source-finder (and source-judge, where relevant) approved — three
or four pages, their fetched text. Nothing else. The model is told explicitly not to introduce
facts outside this set.

**Output:** a draft article in the normal `art.sections` / `quotes` / `links` shape, following
`content-authoring-skill.md` for voice and word-count targets. Free to write well — it carries no
burden of proving anything as it goes.

Alongside the draft, Augustine also returns a **flagged-words list**: names or terms in what he just
wrote that he judges likely to trip up text-to-speech — unusual saints' names, foreign terms,
Roman numerals, that kind of thing. Plain words only, **no suggested pronunciation** — Tom already
has that covered separately (see the pronunciation-dictionary work under audio generation), so this
list exists purely so he knows what to listen for when the recording comes back, not to propose a
fix itself.

**Model choice:** pick for prose quality, independent of which model does source-finding or
judging.

### [3] Researcher — Aquinas ( = `ledger-build`, already built )

**Input:** the draft from stage 2, and only the same sources it was given — not the full internet,
not the allowlist at large.

**Output:** the same per-claim ledger `ledger-build` already produces — `verified` / `reported` /
`disputed` / `unsourced` / `traditional` — which doubles here as the fix list for stage 4.

### [4] Writer (fix pass) — Augustine, again

**Input:** the draft plus *only* the researcher's fail list (disputed + unsourced claims).

**Output:** a patched draft, with just the failing sentences softened, corrected or cut. Loops back
to stage 3 once or twice; after that, whatever still fails lands at the human gate flagged, rather
than looping indefinitely or silently publishing with known gaps.

### [5] Human gate

A real stop here, at least for now. Everything before this point can run unattended end to end; a
"run the whole pipeline" action fires stages 1 through 4 back to back and lands at a review screen
(reusing the existing resolution-UI patterns from image and arbitrate review) instead of silently
going live.

### [6] Recorder ( = `audio-generate`, already built )

Once the article clears the human gate, queue audio generation exactly as it already works today.

## 5. The run log

**Ask:** a readable record of the whole run — who (which stage/service) did what and found what —
not just a final pass/fail.

**Shape.** One run = one log, keyed by a run id, stored the same way `ledger/<id>.json` is stored
today: a plain JSON file (e.g. `pipeline-runs/<run-id>.json`), human-readable, not folded into
`data.json`. Each stage appends ONE entry as it finishes, in order, so the file reads top to bottom
as the actual story of the run:

```json
{
  "runId": "2026-10-07-bertha-01",
  "category": "s",
  "title": "Saint Bertha",
  "requestedBy": "visitor-suggestion",
  "startedAt": "2026-10-07T14:02:00Z",
  "steps": [
    { "stage": "source-finder", "name": "Jerome", "startedAt": "...", "finishedAt": "...",
      "outcome": "ready", "summary": "Jerome found 3 sources: newadvent.org (approved), ... Rejected 2 pages (blog, no named author).",
      "detail": { "accepted": [ "...urls..." ], "rejected": [ { "url": "...", "reason": "..." } ] } },
    { "stage": "source-judge", "name": "Ignatius", "startedAt": "...", "finishedAt": "...",
      "outcome": "proposed", "summary": "Ignatius reviewed abbaye-x.fr: operator confirmed (Benedictine abbey website); proposed tier 'official', enabled:false pending confirmation.",
      "detail": { "domain": "abbaye-x.fr", "tier": "official", "vetted": "..." } },
    { "stage": "writer-draft", "name": "Augustine", "startedAt": "...", "finishedAt": "...",
      "outcome": "drafted", "summary": "Augustine drafted a 412-word article, 3 sections, 2 quotes, 4 links.", "detail": { } },
    { "stage": "researcher", "name": "Aquinas", "startedAt": "...", "finishedAt": "...",
      "outcome": "2 disputed, 1 unsourced of 14 claims", "summary": "Aquinas flagged 3 claims out of 14.", "detail": { "ledgerFile": "ledger/saint-bertha-xxx.json" } },
    { "stage": "writer-fix", "name": "Augustine", "startedAt": "...", "finishedAt": "...",
      "outcome": "patched 3 of 3 flagged claims", "summary": "Augustine fixed all 3 of Aquinas's flagged claims.", "detail": { } },
    { "stage": "researcher", "name": "Aquinas", "startedAt": "...", "finishedAt": "...",
      "outcome": "0 disputed, 0 unsourced of 14 claims", "summary": "Aquinas confirmed the article clean on re-check.", "detail": { } },
    { "stage": "human-gate", "name": null, "startedAt": "...", "finishedAt": null,
      "outcome": "awaiting review", "summary": "Queued for Tom's review.", "detail": { } }
  ],
  "status": "awaiting_review"
}
```

**Fields every step carries, no matter the stage:** `stage` (the technical id, e.g.
`source-finder`), `name` (the patron name for that run — Jerome, Ignatius, Augustine, Aquinas; `null`
for the un-named human-gate/recorder steps, see §2a), `startedAt`/`finishedAt`, `outcome` (short,
structured — the kind of thing that could become a status chip in a UI later), `summary` (one or
two human sentences written in the role's voice, e.g. "Augustine fixed all 3 of Aquinas's flagged
claims" — this is the part Tom reads), `detail` (whatever that stage's own real output was, e.g. the
ledger file path, the list of rejected sources and why).

**Why a step-by-step append, not one big result at the end:** it is readable mid-run, not just
after — if a run stalls or fails at stage 3, the log already shows exactly what stages 1 and 2 did,
rather than losing that record because the run never reached a "final" write. It also means a
retried stage (e.g. the fix-loop running twice) shows as two honest log entries, not a single
entry silently overwritten.

**UI, later:** a per-run log view is a natural fit for the same resolution-UI shell already used by
image/arbitrate review — not designed in this doc, but the log's shape above (ordered steps, each
with a short summary) is deliberately close to what a simple timeline-style screen could render
directly, so building that view later should be straightforward once the data exists.

## 6. What's actually new to build

- **New:** source-finder (stage 1), including its already-exists check, allowlist search, wider
  search, and the "enough to write from" threshold.
- **New:** source-judge (stage 1a) — its judgment logic is largely a restatement of work already
  done by hand for four real domains this session; this service formalizes that into a repeatable,
  documented process.
- **New, but small:** the fix-pass writer (stage 4) — the researcher already produces the fail
  list it needs; this stage just needs to accept that list as input and touch only what it names.
- **New, but small:** the run log itself — a shared helper any stage can call to append one entry,
  used by every stage above.
- **Already built, reused as-is or with minor pointing changes:** the plain writer (stage 2, new
  prompt engineering against a fixed source set), the researcher (stage 3 — `ledger-build`), the
  recorder (stage 6 — `audio-generate`).
- **Already built:** the registry and its guards (`scripts/ledger-allowlist.json`, `srcApplyOps`,
  the Allowed Sources page) that stages 1a and 5 both lean on.

## 7. Build order (agreed)

Build and test each stage standalone, with real inputs, before chaining anything:

1. **Source-finder first** — the one true gap, and everything downstream depends on its output
   being trustworthy. Test against real titles, including ones that should fail each of the four
   ways (`exists`, `not_found`, `too_thin`, `ready`). Build its run-log entries from day one, so
   the log format is proven before other stages need to match it.
2. **Source-judge**, tested against real domains the source-finder actually surfaces.
3. **Writer, tested standalone** against a fixed, hand-picked set of sources (not yet the
   source-finder's own output) — isolates "does it write well and stay inside the sources" from
   "did the source-finder hand it anything good."
4. **Researcher** — already built; point it at a draft instead of a live article and confirm it
   behaves the same way.
5. **Fix-pass writer**, tested against real ledger fail-lists from step 4.
6. **Only then**, wire stages 1 through 6 together in the orchestrator, with the human gate at
   stage 5 kept in place, and the run log stitched across all six.

## 8. Open questions (not yet decided)

- Exact numeric thresholds for "enough to write from" in the source-finder.
- How the public "Suggest a Saint" button's `not_found` / `too_thin` outcomes are shown to a
  visitor (a plain message? silently queued for Tom? both?).
- Whether `too_thin` subjects are held for later reconsideration if more material surfaces, or
  simply dropped.
- Exact model choice per stage (principle agreed — pick per stage, different providers for writer
  vs. researcher — specific models not yet picked).
- Whether "run the whole pipeline" is a button inside Task Automation or a new panel.
- Whether the run log needs its own UI now or can wait — the data shape is designed either way.


## 9. Decisions added in text session (2026-10-07, after the voice call)

**Two modes for Jerome.** *New article:* existence check first (exact, alternate names, fuzzy), then search. *Rewrite:* no existence check; the caller supplies `id`, name, category and year, and Jerome goes straight to gathering sources.

**When a decision comes to Tom.** Jerome sorts what he finds into approved sources (already in the registry or judged by Ignatius) and unsure sources (new or foreign domains Ignatius cannot confidently place).
- Approved sources alone are enough to write from: proceed; unsure sources are left out.
- Approved sources alone are NOT enough, but they would be enough if the unsure sources were used: the run stops at outcome `needs_decision` and comes to Tom.
- Not enough even with the unsure sources: `too_thin` or `not_found`, as before.

**What Tom sees (Ignatius's report).** For each unsure source: verdict, reason, pros and cons, and a copyright line (likely public domain / copyrighted / unclear, with the reason). Tom then approves it (as `reported` or higher), or rejects it. Until he does, nothing is written from it. Ignatius's text is stored with the source in the file below.

**Source storage: one file per entry, everything in it.** `sources/<entry-id>.json`, holding metadata and full fetched text together:
```
{ "entryId", "mode": "new|rewrite", "subject": {name, category, year},
  "builtAt", "finder": "source-finder vX",
  "outcome": "exists|not_found|too_thin|needs_decision|ready",
  "totalWords",
  "sources": [ { "n", "url", "title", "domain", "tier",
                 "status": "approved|unsure|rejected",
                 "fetchedAt", "words", "hash", "text",
                 "ignatius": { "verdict", "reason", "pros": [], "cons": [],
                             "copyright": { "likely": "public_domain|copyrighted|unclear",
                                            "reason", "recommendedStorage": "full|excerpts" } } } ] }
```
The per-source `words` and the `totalWords` give the too-thin threshold a concrete number.

**Still open:** repo visibility and copyright (full text of modern sites in a public repo); foreign-language sources need translation before Augustine writes from them or Aquinas checks against them.


## 10. Storage and Scripture rules (2026-10-07)

**Tom decides, per source, whether full text is stored.** He knows which sources are copyrighted, so
this is a human setting, not something the pipeline infers. Each registry entry gets a `storage`
field: `"full"` (public domain — e.g. newadvent.org, ccel.org — full text may be saved in
`sources/<entry-id>.json`) or `"excerpts"` (default for anything not explicitly set — only the
manifest, a content hash, the short per-claim excerpts the ledger already keeps, and an archive
snapshot link). Open: the field needs adding to `ledger-allowlist.json` and the Allowed Sources page.

**Ignatius advises on copyright; Tom decides.** Tom cannot reliably tell public domain from copyrighted
by looking at a site (old text on a website is not automatically public domain; a modern translation,
commentary or editorial layer usually is not). So `excerpts` is the default for every source, and full
text is an upgrade Tom grants, never a status he must rule out. Each source in Ignatius's report
(\u00a79) carries a `copyright` object: `likely` (`public_domain` | `copyrighted` | `unclear`), a
`reason` (publication date, modern translation or commentary, any terms the site states), and a
`recommendedStorage` (`full` only when likely public domain; otherwise `excerpts`). It is a
recommendation, not legal advice. Tom switches a source to `full` only when Ignatius says likely
public domain and Tom agrees; `unclear` stays on `excerpts`. A wrong call costs the full-text copy,
not legal exposure.

**Scripture (NABRE) is never stored.** The repo, run logs, ledger files and Actions logs hold only
the reference (e.g. Luke 1:26-38), the `bible.usccb.org` link, a pass/fail result, and the short
phrase Augustine actually quotes in the article. Workers may fetch the verse at run time to check a
quote, but fetched NABRE text must never be written to any file or printed to a log.

**NABRE quoting terms (USCCB permissions page, checked 2026-10-07).** Quotes must be verbatim
(capitalization, punctuation, verse structure) and carry the copyright acknowledgment. No permission
is needed for under 5,000 words in print, sound or eBook form, but web and digital-application use is
a separate category that needs a license; unframed links to bible.usccb.org need none. Whether this
site counts is unresolved. **Action for Tom:** write to the CCD's Associate Director, Permissions,
describing a free PWA with short NABRE quotes and TTS audio narration.


## 11. Foreign-language sources (2026-10-07)

Translation is easy (a Claude model does it inside the pipeline; no separate service). The risk is
verification: a mistranslation must not pass as `verified`. Rule: each source records its `language`;
a foreign source is translated once; the ledger excerpt keeps the **original-language sentence beside
the English**; claims verified through a translation are marked as such for spot-check at the human
gate (they still count as verified); Augustine paraphrases and cites a foreign source, or quotes it
labeled as Tom's translation, never verbatim as if it were the original.

## 12. Build status

- **2026-10-07 — source-finder v0.1 (Jerome, layer 1: existence check)** built and tested.
  Files: `scripts/services/source-finder.mjs`, `scripts/tests/source-finder.test.mjs` (14 tests, all pass,
  including against the real data.json). Not registered in the orchestrator. Layers 2 (search) and 3
  ("enough to write from") not built. Layer 1 outcomes: `exists`, `possible_match`, `new_subject`,
  `rewrite_ready`, `error`. Ambiguous exact matches go to a human unless the category picks exactly one.
- **2026-10-07 — source-finder v0.2 (Jerome, layers 1 + 2: find candidate sources)** built; 27 tests pass
  (layer 2 against MOCKED search/fetch only; **never run live**). Pass A searches only the enabled allowlist
  domains (Anthropic web search `allowed_domains`, Scripture tier excluded); pass B (open web) runs only if
  fewer than 2 usable allowlisted pages were found (provisional threshold `MIN_ALLOWLIST_SOURCES`). Rewrite
  mode tries the article's existing links first. URLs are harvested from the search tool's result blocks,
  never from the model's prose; code fetches every page and records status, words, hash, whether the name is
  on the page, and mentions. Domains not in the registry are `unjudged` (wait for Ignatius and Tom); Wikipedia,
  blogs, forums and social media are blocked and never downloaded. A `possible_match` only proceeds to search
  when a human re-queues it with `confirmNew: true`. Not built: layer 3 (ready / too_thin / not_found, and the
  real-person and category checks), Ignatius, `sources/<entry-id>.json`, orchestrator registration.
  **Open:** what status counts for the Saint category (canonized only, or also blessed / venerable /
  servant of God)?


- **2026-10-08 — source-finder v0.3 (Jerome, layers 1 + 2 + 3)** built; 52 tests pass (including against the
  real data.json). Layer 3 uses no AI and no network. New file `scripts/category-rules.json` holds the editable
  rules (word minimum, scandal name list, per-category handling, patterns, generic name words). Layer 3 statuses:
  `ready`, `needs_decision` (unjudged pages that might make it enough, or a category review), `too_thin`,
  `not_found`. One verify-capable source can be enough: minimum 1,000 words (provisional); a single independent
  site is flagged `single_source`; reported-tier and unjudged pages never count. Layer 2 now stops searching
  once the allowlist alone has enough verify-capable text (it used to want 2 pages). Saint basis (New Testament,
  ancient veneration up to year 1000, formal canonization) is found by patterns near the saint's name; none
  found = review, "not canonized" when Blessed/Venerable/Servant-of-God signals appear. Scandal names, apparitions
  and miracles always go to review (the last with approval-signal excerpts attached). In rewrite mode the basis
  checks are advisory only; a scandal still blocks. Page text stays in memory; only short lowercased excerpts
  near a match reach the result.
  **Known limits:** layer 3 does not check that sources agree on who the person is (dates, facts); the scandal
  list only catches obvious names; patterns are English-only and have never met real pages; layer 2 and 3 have
  never been run live. **Still not built:** Ignatius, `sources/<entry-id>.json`, orchestrator registration.

- **2026-10-08 — source-finder v0.4:** "plenty of material", judged by quality, not site count (Tom's rule).
  Two numbers in `category-rules.json`: floor `minWordsVerifyCapable` 1,000 (ready) and target
  `targetWordsVerifyCapable` 4,000 (provisional). Only SUBSTANTIVE pages count toward either: verify-capable
  pages where the name appears at least `minMentionsPerPage` (3, provisional) times, so a long page that only
  brushes the name is not material. Below the target, Jerome runs one more allowlist search worded differently
  (pass `allowlist-more`); the open web is still searched only when the floor is not met. A ready entry under
  the target is flagged `thin_material`. Fetch caps still apply (8 pages per pass). 57 tests pass.

- **2026-10-08 — source-finder v0.5: perspective lanes** (Tom's rule: sites have different strengths, so keep
  looking for different kinds even after the word target is met). `category-rules.json` now has `perspectives`:
  six lanes (history & biography; theological reflection, context only; Church documents & teaching; primary
  texts; feast, devotion & liturgy; independent historical check), each listing its sites (New Advent is split by
  path: /cathen/ = encyclopedia, /fathers/ and /summa/ = primary texts), and a priority order per category.
  After the allowlist passes, Jerome runs one restricted search for each lane the category should have but lacks,
  at most 3 extra searches, at most 4 pages each. Only sites enabled in the registry are searched. A lane is
  covered at 300 words of approved pages really about the subject; the theology lane is context only (reported-tier
  sites such as stpaulcenter.com, franciscan.edu, wordonfire.org, catholic.com add perspective but never verify).
  Layer 3 reports covered and missing lanes and flags `narrow_perspective` under 3 lanes; it never blocks.
  Every list and number is provisional. Not yet covered: apparitions and miracles have no "official shrine" lane
  (the official-tier shrine sites are many and each is about one subject). 68 tests pass.

- **2026-10-08 — source-finder v0.6: search wide, provide the best 3-4** (Tom's rule). New `selection` block in
  `category-rules.json`. Layer 2 keeps hunting until it has `poolTarget` (8, provisional) substantive approved
  pages or hits the fetch caps. Layer 3 then picks at most `maxSelected` (4): first the best page of each lane in
  the category's priority order (so the pages are different kinds), then the best of the rest; at most 2 pages per
  site, at most 1 context-only page, always at least one verify-capable page. Score = words + name mentions + name
  in title + tier weight. Output: `layer3.selection.selected` (what the writer gets) and `alsoFound` (the rest,
  kept for reference). The enough-to-write check (floor 1,000 words, target 4,000) now runs on the SELECTED pages
  only, so a lone qualifying page must pass the floor by its own word count. Fewer than 3 selected = `few_sources`
  flag (informational). Not changed: sainthood-basis evidence is still read from every verify-capable page, not
  just the selected ones. 77 tests pass.

- **2026-10-08 — source-finder v0.7: signal types for ancient saints** (Tom's idea: look at churches, hospitals,
  city names; a pre-1000 saint need not be canonized). The "ancient veneration" basis in `category-rules.json` is
  now a set of signal types, each with a strength: strong = Roman Martyrology / General Calendar / Roman Canon;
  early calendars (Philocalian, Hieronymian); venerated in the East; early written witness. Medium = a feast day is
  kept; tomb, catacomb, relics; churches dedicated to the saint. Weak = patronage, hospital and city names.
  Accepted when two different kinds are found near the name and at least one is strong, and no caution appears
  (legendary, historicity doubted, removed from the calendar, apocryphal). One kind alone, only medium kinds, or
  only weak kinds go to review and the reason says which. Counted by type, not by page, so copies of one claim are
  one signal. `decisiveTypes` (empty) would let a single kind settle it. Limits: text cannot show whether a
  dedication is early or modern; patterns are English-only and have never met real pages; no site in the registry
  yet is built for the Martyrology or early dedications. 87 tests pass.

- **2026-10-08 — FIRST LIVE RUN of Jerome (St. Augustine rewrite, GitHub Actions, about 2.9 minutes).** Real search
  and real fetches worked. Result: 18 usable approved pages and 89,759 words, status `ready`, 4 of 18 pages selected,
  5 of 6 lanes covered, saint basis accepted as ancient veneration (the Orthodox Church commemorates him, a feast day,
  relics). What it taught: (1) britannica.com refuses automated fetching (HTTP 403 on 6 pages), so the independent
  check lane could never fill; (2) 42 candidate pages were skipped by the per-pass fetch cap, mostly vaticannews.va
  and britannica.com; (3) lanes are assigned by site, which is crude: CCEL hosts encyclopedias that are not primary
  texts, and EWTN's library holds saint biographies as well as Church documents; (4) the pattern "contemporary
  account" matched a passage about the Vandal invasion, not veneration; (5) "patron saint of" matched Augustine of
  Canterbury, a different saint, so namesakes can slip into weak signals; (6) the pool-then-select step took three
  biographies and a theology page and no primary text. **v0.8 fixes:** `fetchBlockedDomains` in the rules (britannica.com;
  such sites are not searched and a lane whose only sites are blocked is dropped); a lane site may `exclude` paths
  (CCEL encyclopedias); lane picks now fill every one of the selected slots before score does; the early-witness
  pattern "contemporary account" is removed; the result now carries `timing` (seconds, web searches, pages
  fetched) for the article log and for cost. **Still open:** lane coverage is met by an index page (CCEL's author list)
  without real primary text; a namesake check; a fetchable independent-history site to replace britannica.com;
  per-page content kind (Ignatius's job). 93 tests pass.

- **2026-10-08 — v0.9: Jerome in the orchestrator, and the article log** (Tom's ask: a short readable record of each
  article job, kept a while, with the time each step took and, later, its cost). Built: `runJerome(task, data)` in
  source-finder.mjs, registered as task type `source-find` by a two-line patch to scripts/orchestrator.mjs (an import and one
  SERVICE_HANDLERS line); `scripts/services/article-log.mjs`; `article-log.json` at the repo root (newest 200 jobs, nothing older
  than 90 days; both are guesses, set in the module); `scripts/pricing.json`. A job has numbered steps (who, text, time, raw usage:
  model, input and output tokens, web searches). Steps are written by code from real numbers, never by an AI. Dollars are worked
  out when the log is shown, from pricing.json, so a price change corrects every old job. Confirmed on Anthropic's pricing page
  (2026-10-08): web search is $10 per 1,000 searches plus token cost; web fetch is free (Jerome fetches with its own code). NOT
  confirmed: the per-token price for claude-sonnet-4-6 (it is not in the current-models table of aipricing.guru, the third-party
  aggregator Tom pointed to on 2026-10-08; $3 in / $15 out is assumed, `verified:false`, costs show an asterisk until Tom confirms).
  That aggregator lists Claude Sonnet 5.5 at $2 in / $10 out and Opus 5.5 at $4 / $20 (entered, unverified); its Haiku 5.5 row had
  scrambled columns, so Haiku is not priced. The pilot workflow has a `model` box to compare models on the same subject. The task keeps a compact result in workLog.json (no per-page records). The Jerome
  pilot workflow now logs and commits article-log.json. A live Augustine run would have read: 11 web searches, 2.9 min, $0.11 in
  search costs (tokens were not recorded then). **Not built:** the Log view in the website (needs index.html), the Add Task option
  for `source-find` in the app, steps for the writer, verifier, reworder and recorder (they call addStep with the same jobId),
  events such as "Tom approved a new site". The placing service gained PATCH mode (v0.2): small edits applied to the file as it is
  in the repo now, refused if the text to find is missing or ambiguous. 100 source-finder tests, 18 log tests, 34 placing tests pass.

- **2026-10-09 — v0.9.2: verified prices, cache and long-prompt costing.** Tom opened Anthropic's own pricing page (and sent
  screenshots); every price in `scripts/pricing.json` now comes from it and is marked verified: Sonnet 4.6 $3 / $15 (so the
  assumed price was right and the first live run's $0.38 was correct), Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20, Fable 5.1 $10 / $50,
  Haiku 5.5 $0.10 / $0.50 for prompts up to 100,000 tokens and $0.50 / $2.50 above (each request is priced on its own, and the
  prompt counts cache reads and writes). Cache writes (5-minute) are 1.25x the input price and cache reads 0.1x (0.05x on
  Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1). Web search is $10 per 1,000 searches; web fetch is free. The log now records
  new input, output, cache reads and cache writes separately, and requests over 100,000 tokens in their own bucket.
  **Do not compare models by price per token:** the page says Claude 4.7 and later models use a tokenizer that makes about 30% more
  tokens for the same text, so Sonnet 5.5 is only about 10% cheaper per job than Sonnet 4.6, not a third. Estimates for the first
  Augustine run (7 searches, 78.8k in, 5.1k out on 4.6): Sonnet 4.6 $0.38 (actual), Sonnet 5.5 about $0.34, Haiku 5.5 about
  $0.08; the $0.07 of search charges is the same for all. Caching is requested per API call (one `cache_control` field at the
  top of the request), not an account setting; it will pay off for the writer, verifier and reworder, which re-send the same
  pages. 24 log tests, 102 Jerome tests pass.

## 13. Sufficiency, category rules and visitor input (2026-10-07, not yet built)

**Status key:** CONFIRMED = Tom said so. PROPOSED = Claude's suggestion, not yet answered by Tom. OPEN = a question Tom has not decided.

**Layer 3 sufficiency (CONFIRMED in principle; the ~1,000-word figure is provisional).** One good source can be enough. Enough = at least one source at a verify-capable
tier (approved, official, primary) with enough on-subject text to carry the article; provisionally about
twice the target article length (roughly 1,000 words). A `reported`-tier source alone is never enough.
Augustine's article length scales to the material. A single-source article is flagged "single source" at
the human gate.

**Per-category rules (verdict: accept / review / reject; a review always carries a reason Tom sees).**
Rules to live in an editable file like the source registry, not in code.
- **Saint (CONFIRMED: three bases, per Tom's correction).** Accepted on one of three bases, and Jerome records which: (1) New Testament figure (Scripture
  plus liturgical veneration); (2) ancient veneration (Roman Martyrology, General Roman Calendar, or a Catholic
  Encyclopedia saint entry; no decree exists for early saints); (3) formal canonization (decree and date found
  in a source). None found = review. Augustine states the basis accurately ("venerated since antiquity") and
  never invents a canonization date; Aquinas requires a source for any canonization date.
- **Blessed / venerable / servant of God (PROPOSED).** Review, reason "not canonized". If Tom approves, the article must
  state the status so it cannot be mistaken for a saint.
- **Scandals (CONFIRMED).** Scandal entries go to review, reason "scandal", so Tom sees each one before it is
  written. Ordinary Church history is still OPEN: Tom has not said how it is handled, and how the pipeline
  recognizes a scandal (versus a hard but ordinary event) is not yet defined.
- **Marian apparitions and Eucharistic miracles (PROPOSED, revised after reading the 2024 norms on vatican.va).**
  The DDF "Norms for Proceeding in the Discernment of Alleged Supernatural Phenomena" (17 May 2024, in force
  19 May 2024, replacing the 1978 norms) change the wording. What the text says: the diocesan bishop judges, the
  Dicastery gives final approval, and the bishop announces "in agreement with the Dicastery"; the six possible
  conclusions are Nihil obstat, Prae oculis habeatur, Curatur, Sub mandato, Prohibetur et obstruatur, and
  Declaratio de non supernaturalitate (Art. 18); as a rule no authority declares a phenomenon of supernatural
  origin, even with a Nihil obstat (par. 11, 23), though the Pope may authorize a special procedure; a Nihil
  obstat does not make it an object of faith (par. 12); most shrines never had any official declaration. Alleged
  Eucharistic miracles are covered (Art. 7 §4, 11 §3). So my earlier four levels ("Holy See approved" and the
  rest) overstated what approval means. Proposed levels, to be recorded in Quick Facts in the source's own words:
  (1) judgment under the 2024 norms, naming the formula and "in agreement with the Dicastery"; (2) approval or
  recognition under the earlier practice, naming who and when, with Holy See acts (feast, coronation, shrine
  status, papal visit) listed as facts and never as approval of the supernatural; (3) devotion or tradition only,
  no formal judgment; (4) any cautionary or negative conclusion, or contested: review. Augustine never writes
  "approved" without naming the authority, and never says the Church declared an apparition or miracle
  authentic or supernatural unless a source says exactly that. Open: whether older approvals (Lourdes, Fatima,
  Guadalupe) get a separate wording; the norms do not address them. Until Tom confirms these levels, layer 3
  sends every apparition and miracle to review with the evidence it found.
- **Anything else that does not clearly fit (PROPOSED).** Review, with the reason it is unclear and why it could fit.

**Where approval/status is shown (CONFIRMED).** In the entry's existing Quick Facts (`facts`), not a new schema field and
not on the timeline icon. The app already has an "Approval status" fact on 117 entries and a "Canonized" fact
on 60. Icon brightness (bright = higher approval, dim = local) was considered and dropped for now; the detail
goes in Quick Facts. New entries should still begin the line with a fixed label (Holy See approved / Local
bishop approved / Tradition only; Saint / Blessed) so icon treatment or filtering can be added later without
re-reading free text.

**Stage 0: visitor input screen (PROPOSED; for the "Suggest a Saint" flow).** Runs before Jerome. (1) Cheap code checks:
length limit, no URLs, no odd characters, per-visitor rate limit. (2) A model screen for profanity, sexual
content, insults, prank names and anything that reads as an instruction; typed text is always data, never an
instruction. It judges the input, not the topic (a name like "clergy abuse crisis" passes). (3) The visitor
gets a neutral refusal that does not say what tripped it; the attempt is logged for Tom. (4) Nothing a visitor
suggests publishes on its own; it always lands at the human gate.
