# Article Pipeline — Build Log

**Last updated:** 2026-10-10 (Saturday)
**What this is:** the dated, append-only record of what was built and learned, newest at the END (it was section 12 of `ARTICLE-PIPELINE-DESIGN-2026-10-07.md` until 2026-10-10, moved here word for word).
**What it is not:** it does not say what is built TODAY (that is `content-generation-workflow-state.md`), what the design is (`ARTICLE-PIPELINE-DESIGN-2026-10-07.md`) or what Tom decided (the `DECISIONS-*.md` files). It says what happened, when, and with what test counts.
**Rule:** add a new entry at the end after every build or live run. Never rewrite an old entry; if it turns out to be wrong, add a correcting entry.

---

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

- **2026-10-09 — v0.9.3: what the first Pachomius run taught (a false negative).** St. Pachomius (founder of Christian monasticism,
  venerated East and West for 1,600 years) came back with "no basis for sainthood found". Causes, all visible in the saved result:
  (1) the Orthodox Church in America's own entry for him was fetched, verify-capable and named him 29 times, but an Orthodox site does
  not write "the Orthodox Church commemorates him", so no phrase matched; (2) Vatican News had his saint-of-the-day page; (3) the one
  text signal found (Roman Martyrology) was about his BROTHER, because a relative's sentence sat within the name window; (4) the
  caution word "legendary" matched a translator's note about a legendary ANGEL in the Lausiac History and blocked acceptance.
  Fixes: **site signals** in the rules (a verify-capable page on oca.org under /saints/, or Vatican News /en/saints/, or Franciscan
  Media /saint-of-the-day/, whose web address contains the saint's name, counts as that signal: OCA = eastern, strong; the other two
  = a feast day, medium); **cautions tightened** (the bare words "legendary" and "historicity" are gone; a caution now has to speak
  of the person or the calendar); step 4 of the log now says why ("advice only (rewrite): no basis for sainthood found..."); when
  both veneration and canonization qualify, veneration leads and the other is recorded as also qualified; the log's closing line
  now reads "Total working time" (it is the steps' own time; GitHub's run time adds about a minute of setup, and one run lost 3m20s
  in checkout). Replaying the real Pachomius sources through the new rules: ready, basis ancient veneration, no flags, even as a new
  subject. **Known limits:** a relative's or namesake's sentence can still trigger a text signal (the excerpt shown to a person is
  how it gets caught), a namesake's saint page can match a site signal, and the Franciscan Media path is a guess not yet seen on a
  real run. 26 log tests, 108 Jerome tests pass.

- **2026-10-09 — FIRST NEW-SUBJECT RUN: Blessed Michael McGivney** (Haiku 5.5; 1.9 min; 16 web searches; $0.18, of which $0.16 is
  search charges). 24 usable pages on 13 sites, but only 656 words from approved, verify-capable sites (floor 1,000), so the run
  stopped at "needs a decision: approved sources are too thin, unjudged pages might make it enough". That is the design working: the
  pipeline refused to treat unvetted pages as proof of a subject the registry knows little about. Two gaps found and fixed in v0.9.4:
  (1) thin material used to END the checks, so the Blessed check ("not canonized") never ran; the category result is now worked out
  and reported beside the sufficiency result ("too thin ... ALSO: not canonized"); (2) the log did not say WHICH unjudged sites could
  help, so a person could not tell what to approve; it now lists them. The open-web passes cost most of the 16 searches; a niche
  subject costs about twice an Augustine run. Approving a site means adding it to scripts/ledger-allowlist.json (a protected file:
  by hand or from the app, never in a bundle). 27 log tests, 112 Jerome tests pass.

- **2026-10-09 — Our Lady of Akita (rewrite, Haiku 5.5; 1.0 min; 10 web searches; $0.12) and v0.9.5.** Only ONE verify-capable page was
  found (EWTN's text of the message, 1,723 words); everything else was reported-tier news (National Catholic Register, OSV, Aleteia,
  Detroit Catholic, EWTN News). Result: "ready" (the 1,000-word floor was met) but flagged few_sources, single_source, thin_material and
  narrow_perspective. The approved list simply has nothing on how Akita's approval stands, and the approval wording sits in reported
  articles, which the approval check did not read, so it found no approval evidence at all. Two lane searches (history, devotion) found
  nothing about Akita on their sites yet used 6 of the 10 searches (about $0.06), and 38 candidate pages (mostly vaticannews.va,
  newadvent.org and franciscanmedia.org pages not about Akita) were skipped by the fetch cap. v0.9.5: (1) a lane search now uses ONE web
  search (rules: perspectives.searchesPerLane); (2) for apparitions and miracles, approval wording found on REPORTED pages is shown as
  `approval_signals_reported`, clearly separate from verified evidence, as leads to check against the bishop's or the Dicastery's own
  statement (never proof, never changes the verdict); (3) the review reason is short enough to read in the log. **Still open:** the
  registry has no source for apparition approval status. Candidates for a person to consider approving: the diocese that issued the
  decision, the Dicastery's published documents, or the shrine's own site; none was checked here. 27 log tests, 118 Jerome tests pass.

- **2026-10-09 — v0.9.6: the diocese lookup and the Ignatius queue; and dates on the approved-sources list** (both Tom's requests).
  (1) **Diocese lookup.** For apparitions and miracles (rules: `authorityLookup`, categories m and u) Jerome makes one extra model call, with up to
  2 web searches, asking which diocese judges the subject and what its OWN website is (not a parish, news site, Wikipedia or pilgrim blog). Code
  then fetches the page and checks that it loads, names the diocese's place, and reads like a church site (at least 3 church words, in several
  languages). The reply never counts on its own. Result: `authority` on the run, a log line "Handed to Ignatius: Diocese website ...", and, for a site
  not on the registry, an item in `ignatius-queue.json` marked `waiting` with a ready registry entry (`suggestedEntry`: tier official, with
  why/useFor/limits). Sites already approved, switched off or never allowed are reported but not queued. **Jerome only proposes; IGNATIUS decides**
  (he is not built: the queue just waits; nothing is approved on his behalf). A site Ignatius has already decided is never queued again; a site
  already waiting just gains the new subject. (2) **Approval dates.** Every registry entry now carries `addedAt` (put on the list), `approvedAt`
  (first enabled; null while only listed) and `approvedBy`. The 49 enabled sites and 59 listed-only sites are dated from the repository's own
  history by the "Registry dates" workflow (dry run first); `approvedBy` stays empty for them because the committer of a file is not necessarily
  the approver. Future approvals are stamped by `stampApproval` / `entryFromQueueItem` / `addApproved` (`scripts/services/registry-dates.mjs`), which
  refuse an approval that names nobody. SOURCE-ALLOWLIST.md gets an "Approved" column in its six enabled-source tables (not in the not-enabled
  tables) and its date line is refreshed. **Not built:** Ignatius himself; checking the lookup on a real run; a "Listed on" column for the
  not-enabled tables. 30 log tests, 127 Jerome tests, 18 lookup tests, 14 registry-date tests pass.

- **2026-10-09 — v0.9.7: Jerome's handoff file, `sources/<entry-id>.json`** (the interface between Jerome and everything after him; Tom: "we need to get
  the pipeline done"; proofing and keeping existing articles is later). `scripts/services/sources-file.mjs`: runJerome (the orchestrator task) and the
  pilot now save one file per entry, following the 2026-10-07 storage decision (sections 9-10): a manifest line per chosen page (url, title, domain,
  tier, lane, words, mentions, score, hash, fetchedAt), the verdict, flags and covered/missing perspectives, the apparition authority in short form,
  the `unsure` pages that could make the material enough (for Ignatius), and `alsoFound`. **Full page text is stored only for a registry source whose
  entry has `"storage": "full"`** (Tom's per-source decision; nothing has that field yet, so for now every file is manifest-only and the writer and
  verifier fetch the pages again, which is free); Scripture is never stored whatever the setting; the lowercased copy Jerome analyses is never stored.
  The id is the timeline's own id for a rewrite, slug(name)-year for a new subject; an id that is not a plain file name is refused. `getSourceTexts`
  returns each page's text (stored or fetched again) with a drift note: `same`, `changed` (still returned: the web moves) or `unavailable` (no text, so a
  caller can stop instead of writing from nothing). No file is written when no search ran. **Next in the pipeline:** wire `ledger-build` (Thomas) to
  read these files instead of the article's own links, then the writer (Augustine), the reworder, Ignatius, audio. 13 file tests, 133 Jerome tests pass.

- **2026-10-09 — THOMAS (ledger-build) v1.4: registry, Jerome's handoff, measured cost.** Tom: "Go" (build Thomas before Augustine; reasons: it mostly
  exists, it is the only way to judge Augustine's output, and it doubles as the proofing check for existing articles later). **Finding first: the
  live `ledger-build.mjs` was v1.3 and did NOT read the registry** (the "v1.4 registry" in the 2026-10-06 decisions notes had not reached the repo; the
  project copy was v1.1). Thomas still used his own hard-coded list of about 30 sites, so a page Jerome picked from a registry-only site would have been
  refused as "not an approved source". Changes (a 20-edit find-and-replace patch against the live file, so nothing else is touched): (1) **The registry
  decides** which sites may be used and at what tier, through `scripts/services/registry.mjs`, the one reader now shared with Jerome (Jerome re-exports it);
  the built-in lists remain the fallback if the registry is missing or damaged, and `ledger.allowlist.from` says which was used; a site listed but switched
  off is reported as "listed in the allowlist but not enabled". (2) **A tier with `canVerify:false` ("reported") gives status `reported`, never `verified`**
  (a rejected excerpt is still `disputed`). (3) **Jerome's file:** stored text (sources set to storage "full") is used as stored for pages the article
  links; Jerome's pages the article does NOT link are `suggestedSources` (`from: "Jerome"`), never proof, which keeps the rule from Part 7 of the
  decisions notes (proof only from the article's own links: a reader following those links must be able to find it). For articles Augustine writes this
  is automatic, because he will write his links from Jerome's pages; for existing articles it is the proofing question, set aside for later. A linked page
  whose length differs from Jerome's by more than a quarter is flagged `changed` (hashes cannot be compared: Jerome and Thomas extract page text
  differently). `payload.useSources:false` ignores the file. (4) **Measured cost:** tokens are tallied per role from each provider's own usage report
  (Gemini thinking tokens and OpenAI reasoning tokens count as output; cached input is separate) into `ledger.usage`, and a Thomas job (kind `check`) with a
  step per role is written to `article-log.json`, so dollars come from `scripts/pricing.json`, which now has verified prices for `gemini-3.5-flash-lite`
  ($0.30/$2.50, Google's own page) and `gpt-5.6-luna` ($0.20/$1.20, OpenAI's own page). The full-library estimate can now be replaced with measured numbers
  after a pilot. 20 offline tests for the patched file (fake websites and fake Anthropic, Google and OpenAI endpoints), 5 registry tests, 33 log tests.
  **Not done:** a UI for `reported` (the ledger viewer is still unbuilt, and must say "Source excerpt", never "Verified"); the existing 3-model design is
  unchanged; Thomas has still never run against the live APIs (everything above is offline-tested).

- **2026-10-09 — AUGUSTINE (article-writer) v0.1, and four decisions from Tom.** (1) **When sources disagree, Augustine picks the winner** (higher-ranked tier first;
  equal rank: more specific, then fuller; a body speaking about itself on its own subject wins on that subject), writes only the winning version into the
  article, and adds a review note naming both versions, their sources and why; **Tom makes the final decision.** (2) **Nothing goes live without Tom's approval.**
  (3) **Tom reviews by LISTENING, so the recording is made right away from the draft, before approval** (this reverses stage [6] of section 4, where audio came
  after the human gate). (4) **Voice stays Kokoro permanently** (223 of 245 existing recordings are `kokoro:af_heart`; ElevenLabs credits are exhausted), so a
  rejected draft's recording costs nothing. (5) **"Quietly" is rationed:** the existing articles use it 56 times in 48 of 453 (up to 5 in one), and some form of
  "quiet" in 111 of 453 (up to 6); `scripts/writer-style.json` limits "quietly" to 1 and the family to 2 per article, each with synonyms given to the writer
  up front and again if he goes over; Tom likes the word, so the limit is a ration, not a ban, and any further tic word is one new line in that file.
  **Built:** `scripts/services/article-writer.mjs` (service `article-write`: reads `sources/<id>.json`, writes `drafts/<id>.json`, never touches data.json),
  `scripts/services/article-checks.mjs` (code, not the model, enforces: 40-word sentence limit, length tier, American dates, quotations word for word in a source,
  Quick Fact labels and age forms, rationed words, allowed HTML; up to 3 attempts with the reasons fed back; after the last the draft is saved anyway as
  `needs_work`), `scripts/writer-rules.md` (a VERBATIM excerpt of content-authoring-skill.md; update it when the skill changes), tokens per attempt in
  `article-log.json` (default model claude-sonnet-5-5; `payload.model` overrides). Links are built by code from the pages he was given, never from model text; a
  miracolieucaristici.org source is not linked (that link belongs in carloLinks) and a note says so; apparitions and miracles always get an "approval" review
  note; Jerome's own warnings become a "sources" note. **Known gap:** the authoring skill's Marian apparition approval rules section is missing from the Project
  copy (its own comment says so); until Tom restores it Augustine states no approval level that the sources do not state outright. **Not built yet, in order:**
  Thomas on a DRAFT (ledger-build reads drafts/<id>.json), the recording from a draft (patch audio-generate), the final "awaiting review" step with the player,
  notes and Approve / Reject in the app (the orchestrator already has an `awaiting_review` finish; the app needs a resolver for it), and one task that runs the
  stages in a row. 16 writer tests, 16 checks tests, 36 log tests.

- **2026-10-09 — AUGUSTINE v0.2: age at death, and the model's view of the sources.** (1) **Age at death** (Tom: readers want to know whether a saint died old or young;
  an estimate is fine; a year or two out does not matter). `scripts/services/lifespan.mjs` reads the Born and Died facts and works out the age with NO model: exact only
  from two full dates; otherwise estimated from the years, a range or "c." giving the midpoint, rounded down; **no age when the earliest and latest possible ages are more
  than 6 years apart** (the tolerance is a setting; a wider guess would mislead), when there is no birth year or only a century, or when the result is implausible; BC to AD
  has no year 0. Augustine writes the Born and Died facts as the sources give them and the marker `[[AGE]]` once in the story of the death; code puts "(at age N)" or
  "(estimated age N)" on the Died fact and replaces the marker with "at the age of seventy-five" or "at about seventy-five" (or drops it). A missing or doubled marker sends
  the draft back; no computable age gives a review note saying why. A computed age is not a sourced claim: **when Thomas is taught to check drafts, he must strip the age from
  Quick Fact claims before the number check (it is not in any source) and may verify the arithmetic by code instead.** (2) **Existing saints:** of 226, 87 already show an age,
  126 have a Died fact without one and 10 have none; `scripts/services/lifespan-backfill.mjs` builds a patch for Manage > Paste JSON > Apply with one edit per saint
  (`["facts","Died","U", ...]`, nothing else touched): 66 saints can be given an estimated age from facts already there, 60 have no usable birth year, 2 are too uncertain.
  (3) **Source feedback:** each draft stores the model's own opinion of the sources (`sourceFeedback`: too little / about right / too much, which he used, gaps, what would
  have helped) and `sourceStats` (words, tier, used or not), and the log shows it. It changes nothing yet; it is the evidence for the efficiency phase below.
- **EFFICIENCY PHASE (Tom, 2026-10-09; LATER: first accurate, well written, beautiful articles at a reasonable price, then trim the waste without lowering quality).**
  Ideas he named: ask Augustine whether the sources were too little or too much, where the gaps are, what would be better for him (done as data collection above); give him less
  if it is too much; extract facts programmatically beforehand and give him a list of facts, whatever helps. Other levers already visible in the numbers: the writer's input is the
  biggest single cost (60,000+ tokens of source pages per attempt, sent again on every retry); caching the source block across retries; a cap on words per source; dropping pages
  he reports unused; the Anthropic Batch API (50% off, slower); a cheaper model for pre-extraction. **Rule for deciding: change one thing at a time and run the SAME entries both
  ways; accept a saving only if Thomas's verified count does not fall, the form checks still pass, and Tom, listening, cannot tell the difference.** Because every step now logs its
  tokens, each experiment has a measured price.
- **2026-10-10 — Augustine v0.3: model default corrected, and the "no age" note removed.** Tom asked that no review note be made when an age at death is left out (done: the reason is
  kept in `draft.lifespan` and the log, not in a note). Claude then set the writer's default model to Opus from an earlier note; **Tom corrected it the same day: Sonnet is
  Augustine's model.** Default is `claude-sonnet-5-5` again (it had briefly been `claude-opus-5-5` in a working copy; no delivery went out with Opus). `payload.model` still
  lets a task choose another model. The documents were reorganized the same day (see `DOCS-INDEX.md`): the build history left the design doc for this file, and the state and
  decisions documents were written. 26 writer tests, 38 log tests; the whole suite (13 test files) passes: 299 tests.

