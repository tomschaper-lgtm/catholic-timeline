# Catholic Timeline — Changelog

Newest first. See `app-engineering-skill.md` for the format this follows going forward — a
short **Ask** (what Tom actually requested) separated from **Implementation** (the technical
how/why) — and for the rule that a version bump now touches exactly two places: the
`const APP_VERSION` line in `index.html`, and a new entry at the top of this file. The full
changelog text used to live as `index.html`'s entire header comment; as of v418 that content
lives here instead, with a short stub left in its place — see v418's own entry below for why
that stub is a few lines longer than a bare pointer.

Entries from v418 onward use the Ask/Implementation format below, one heading per version.
Everything from v417 and earlier is the original changelog exactly as it read in index.html's
header comment before this split — a single continuous running list rather than one heading
per version, with older entries folded in inline ("vNNN (unchanged): ...") once they'd aged
past needing full detail. Left as-is rather than retroactively restructured: rewriting old
entries into the new shape would mean guessing at context from sessions this one doesn't have
full visibility into, which risks misrepresenting decisions that were made for real reasons at
the time.

---

## v453 — 2026-09-22

**Ask:**
- Photo view Ken Burns: stop for 4s after every zoom, in or out.

**Implementation:**
- kenBurnsPhoto retimed to a 78s loop of three 26s rounds: 9s push-in to 1.5x, 4s hold, 9s
  pull-back to 1x (toward 3:00 / 7:00 / 11:00), 4s hold. Both zooms use one gentle curve,
  cubic-bezier(.45,0,.25,1), so each eases out of its stop and slows before arriving.

## v452 — 2026-09-22

**Ask:**
- Photo view Ken Burns: don't speed it up — go slow, slow down at the end of the zoom, stop 4s,
  then slowly zoom out, and repeat.

**Implementation:**
- kenBurnsPhoto retimed to a 66s loop of three 22s moves: 9s push-in to 1.5x on the eyes
  (ease-out, cubic-bezier(.25,.5,.3,1)), 4s hold, 9s ease-in-out pull-back to 1x. Pull-back
  directions (3:00 / 7:00 / 11:00) kept from v451.

## v451 — 2026-09-22

**Ask:**
- Photo view Ken Burns: zoom in and slow down at the end, pause about 2.5s, then go off in another
  direction each time (3:00, 7:00, 11:00...).

**Implementation:**
- kenBurnsPhoto rewritten as a 34.5s loop of three 11.5s moves: 4.5s push-in to 1.5x on the eyes
  (strong ease-out, cubic-bezier(.15,.6,.25,1)), 2.5s hold, 4.5s ease-in-out pull-back to 1x with
  the anchor sliding toward 3:00 (95% 50%), then 7:00 (28% 89%), then 11:00 (28% 11%). Per-keyframe
  timing functions; anchor snaps back to the eyes at scale 1 (invisible). No edges at any point.

## v450 — 2026-09-22

**Ask:**
- Full-screen photo view: fade in and out gently over 1.5s. Ken Burns should zoom much farther
  in, and zoom back out in a different direction.

**Implementation:**
- #photoView now hides with opacity/visibility (not display:none) so it can transition both ways;
  1.5s opacity fade, visibility delayed on close. The image src is released 1.5s after close
  (timer cleared if reopened mid-fade).
- kenBurnsPhoto rewritten as a 12s one-way loop: scale 1 → 1.5 anchored at 50% 38% (eyes), then
  back to 1 while the anchor slides to 82% 78%, so the pull-back drifts toward the lower right.
  Anchors stay inside the frame and scale never drops below 1, so no edges show; the loop seam is
  invisible because the anchor doesn't matter at scale 1.

## v449 — 2026-09-22

**Ask:**
- Portrait: a single tap on the article picture opens it full screen on the topmost layer, audio
  keeps playing, Ken Burns continues a bit faster, zoom focused slightly above center (where eyes
  usually are), filled edge to edge with no border. Another tap closes it.

**Implementation:**
- New body-level #photoView (z-index 10000, above the audio bar). object-fit:cover with
  object-position and transform-origin both at 50% 38%; new kenBurnsPhoto keyframes, 5s
  alternate (article drift is 8s), scale 1 → 1.14 only — never below 1, so no edges show.
  Honors prefers-reduced-motion like the existing effect.
- Opens from a single tap on .artimg (artBody) or on #flyPortrait (the visible flying copy),
  portrait only; landscape keeps the existing double-tap lightbox. Tap anywhere on the view closes.
- Fix needed for "audio continues": the article's tap-anywhere-to-pause handler now ignores taps
  on .artimg — otherwise opening the picture would have stopped the narration.
- #photoView added alongside #imgLightbox to the outside-click exclusions and the flying-portrait
  mask observer, so tapping it never closes the article and the corner badge hides beneath it.

## v448 — 2026-09-22

**Ask:**
- Right-align the switches — the Review row's switch sat past the right edge, out of line with
  the Offline Access and Owner Tools switches.

**Implementation:**
- The Review row has one extra item (the Show only pill), so at the standard 16px row gaps its
  contents ran wider than the sheet and pushed the switch off the edge. #reviewModeRow now uses
  10px gaps, the pill is slightly more compact (no extra right margin), and the label won't wrap.

## v447 — 2026-09-22

**Ask:**
- Settings Review row: "Review" and "13 pending" were drawn on top of each other. Just show
  "Review 13".

**Implementation:**
- The count moved inside the row's label span ("Review 13") instead of a separate .pMeta span —
  the separate span was overlapping the shrinking .pName and pushing the switch past the edge.
  Count text is now just the number (still shows 0).

## v446 — 2026-09-22

**Ask:**
- Nothing about review mode should show on the timeline screen. Move it into the Settings menu as
  one line: "Review · 13 pending", then a "Show only" pill. Must work with 0 pending too.

**Implementation:**
- Removed #reviewBanner (markup and CSS) from the timeline entirely.
- Settings row renamed "Review Mode" → "Review"; the meta now always shows "N pending" (including
  "0 pending"); #reviewOnlyBtn moved into the row as a light-theme "Show only" pill (.reviewOnlyPill,
  filled when on), between the count and the switch.
- The pill sits inside the row's <label>, so its click calls preventDefault/stopPropagation to keep
  it from also flipping the Review switch. Turning Show only on while Review is off turns Review on;
  turning Review off still clears Show only (existing setReviewMode behavior).

## v445 — 2026-09-21

**Ask:**
- Review Mode: replace the brown "Review Mode / Show Only Pending" bar with one pill ("Review" off,
  "Pending Only" on).
- Tapping the article year in Review Mode jumps to a new status block at the bottom: largest
  sentence word count, proofread status, Submit to Proofread, and a Flag Issue button (audio
  pronunciation/timing, image, facts, mark for review — each with a note and a "Remove from public
  view" switch).
- Facts flags feed a new fact-research service: several models (Claude, Luna, Gemini) each
  independently research the question and propose a Quick Fact (add/update) or a section
  (swap/insert by position), with source link and note. No voting — a picker screen shows each
  answer; Approve, Override, or Edit the one you like, and move an inserted section up/down.

**Implementation:**
- Pill: #reviewBanner loses its label and colored bar; #reviewOnlyBtn reads Review / Pending Only.
- New longestSentenceWordCount() (same splitting/skip rules as entryHasLongSentence). Article Status
  block in fillArticleBody (Review Mode + unlocked + real article). Submit to Proofread reuses
  tkQueueQuickTask('arbitrate'). Year tap handled by a delegated click on .ahYear.
- Flag modal (#flagModal, shares report-modal styling): writes a category-tagged note into
  entry.reviewNote; sets entry.review only if the switch is on (defaults on for "Mark for review"
  only); publishes; then queues audio-generate / image-generate / fact-research unless one is
  already pending. Facts shows a change-type picker (Quick Fact / Section) sent as
  payload.changeType. tkQueueQuickTask gained an optional payload override.
- New task type 'fact-research' (TK_SERVICES, addable:false). Review screen
  tkRenderFactResearchReview: preview built with the EXISTING tkRenderFacts/tkRenderArticle so
  preview and apply share one code path; tkRenderArticle extended to render whole-section swap and
  insert (heading + body). tkFactCandidateToPatch converts a candidate to the standard patch tuple:
  quickFact update with no matching label becomes an add (per Tom); section insert translates
  Tom's 1-based landing slot to applyOnePatch's "after section N" convention (N = position − 1).
  Approve applies via applyOnePatch; same deferred publish/worklog flags as arbitrate. Pills select
  + toggle the reason (method badge Searched/From memory, source link); misses listed below.
- Verified in Node against the real client functions: quick fact add / update / update-no-match,
  section swap, and insert at slots 1, 3, and append — preview and applied result match in every
  case. Not verified live.
- Server (separate files): scripts/services/fact-research.mjs (new) and a two-line
  orchestrator.mjs registration. Needs ANTHROPIC_API_KEY passed through orchestrator.yml env.

## v444 — 2026-09-20

**Ask:**
- Approve/Override in Arbitrate Review still feels slow on every tap — can decisions be batched
  and only actually published when closing the queue, e.g. every 20 articles?

**Implementation:**
- That batching already existed for the expensive half of this (v400's deferred content-publish:
  publishToGitHub()/data.json only fires for real on the last decision in a queue, or on exit).
  What it missed: saveWorkLog() — a SEPARATE GET+PUT to workLog.json for task status/bookkeeping —
  was unconditional in all three places that call it (tkResolveArbitrateDebate,
  tkSaveArbitrateEdit, and wlResolveTasks, which the sentence-reword/auto-approve flow also uses),
  regardless of whether content-publish itself was deferred. That's the real source of "every tap
  is slow" even with v400 already live: a full GitHub round-trip on every single Approve/Override/
  Edit tap, unrelated to content.
- New tkDeferredWorkLogIds/tkFlushDeferredWorkLog(), same shape as tkDeferredPublish/
  tkFlushDeferredPublish: accumulates every touched task id instead of saving immediately;
  tkFlushDeferredPublish() now flushes both together, so the three existing exit points
  (finishing the queue, tkGoList(), closeTaskPanel()) cover this for free — no new wiring needed
  at the call sites that already trigger a flush.
- Didn't build a fixed "publish every 20" — the existing deferral already collapses arbitrarily
  many decisions into exactly 1 round-trip at the true end of a session (or on early exit), which
  is strictly fewer network calls than a fixed batch size would produce.
- Also fixes the same problem for sentence-reword's manual approve/reject (tkResolveCurrent) and
  auto-approve, both of which go through wlResolveTasks — auto-approve was already batching
  content-publish at TK_AUTO_PUBLISH_BATCH_SIZE (10) but re-saving workLog.json on every poll
  regardless; it now batches both together at the same cadence.
- Verified by simulation (Node, not the live site): 20 sequential approvals through the same
  defer/flush logic now produce exactly 1 publishToGitHub() call and 1 saveWorkLog() call, versus
  1 and 20 before this fix.

## v443 — 2026-09-20

**Ask:**
- "Couldn't find this exact wording" still firing on the St. Vincent Ferrer / Helping End the
  Schism arbitrate debate, even after the tag-stripping and curly-quote fixes — diagnose and fix
  if possible.

**Implementation:**
- Diagnosis (not confirmed against arbitrate.mjs's own source, which isn't visible from this
  file): the debate's before-text (sentence #1-2) crosses a paragraph break — the raw Edit box
  showed it as two separate one-sentence paragraphs. Likely cause: the AI proposer reads the
  article as flowing prose (a paragraph gap collapsed to a plain space) when it quotes before/
  after, while the stored text keeps a literal "\n\n" between paragraphs, so an otherwise
  word-for-word match came out one character short.
- Couldn't just collapse "\n\n" to a space in tkStripInlineTagsTracked's output, though —
  tkRenderArbitrateArticle's own paragraph split depends on that literal gap surviving in
  plainFull, and collapsing it there would merge every paragraph in a section together for
  highlighting. New tkNthIndexOfFlexibleWs instead makes the SEARCH tolerant: each whitespace run
  in the needle matches one-or-more whitespace characters in the haystack, leaving plainFull
  itself untouched. Returns the real matched {index, length} rather than a bare index, since the
  matched span can now be longer than needle.length (a "\n\n" absorbing what was one space in the
  needle) — every caller was updated to use that length instead of assuming needle.length.
- Scoped to 'article'-kind debates only (tkFindDebateSpan, tkApplyDebateText's article branch);
  facts/quotes values are short single fields with no paragraphs to cross, so they keep
  tkNthIndexOf's exact match unchanged.
- Also fixed tkDebateShownText (prefills the Edit box): it was matching raw tkNthIndexOf directly
  against the UNTOUCHED raw HTML, never tag-stripped and never whitespace-flexible, so it fell
  back to the unmodified section any time a span touched a tag or crossed a paragraph gap — even
  after tkApplyDebateText itself was fixed for the tag case. Its own comment already claimed
  parity with tkApplyDebateText; it now actually has it, sharing the same tag-strip +
  flexible-whitespace match for the 'article' case.
- Verified against a reconstruction of the actual St. Vincent Ferrer text from Tom's screenshots
  (Node, not the live site — no access to the real stored entry): the new match correctly spans
  the `<a>` cross-reference link AND the paragraph gap, and the existing link-preservation rule in
  tkApplyDebateText correctly drops the Council of Constance link since the proposed replacement
  doesn't mention it by name. Not verified live — worth confirming this debate now resolves
  cleanly after deploying.

## v442 — 2026-09-20

**Ask:**
- Wire up the "Report an issue" button so submissions actually reach Tom.

**Implementation:**
- `WEB3FORMS_KEY` set to Tom's real Web3Forms access key, replacing the
  `PASTE_YOUR_WEB3FORMS_ACCESS_KEY_HERE` placeholder. No other logic in the report-modal flow
  changed — the fetch call, fields, and modal were already wired up in a prior version and just
  needed a real key. Submissions now deliver to the inbox tied to that Web3Forms account.

## v441 — 2026-09-20

**Ask:**
- Remove the small version number next to "Catholic Timeline" in the header.

**Implementation:**
- `#versionStamp` removed outright: the span from the `<h1>`, the line that set its text, the
  Owner-Tools visibility toggle in `updateManageVisibility()`, and its CSS block. It was already
  hidden from visitors, so this only changes what the owner sees.
- The running version is still on show in Settings ("Version up to Date  v441"), which is where
  to read it now — worth knowing, since the header stamp was how we'd been confirming which build
  was live from screenshots.

## v440 — 2026-09-20

**Ask:**
- The blank blue either side of the article in landscape should be gone — the timeline should
  show down both sides.

**Implementation:**
- The narrowing was on the wrong element. v437 narrowed `.artwrap`, the text column INSIDE the
  sheet, while the sheet itself (`#article.overlay`, in the `pointer:coarse` block) stayed
  `width:100%` full-bleed — so the text moved in but the blue still ran edge to edge. Corrected:
  `#article.overlay` is now `width:60%` centered in landscape, and v437's `.artwrap` cut is
  dropped since the column simply fills the narrower sheet now.
- Centered via auto side margins against the existing `left:0/right:0` rather than by adding a
  `translateX` to the transform. That transform is animated across four states here (base, open,
  peek, expanding) and the fly-portrait maths reads it; an over-constrained fixed box resolves to
  centered on auto margins, leaving all of them untouched.
- Checked that nothing in JS assumes the sheet spans the viewport — the portrait morph and
  sticky-backdrop code all measure via `getBoundingClientRect()`, so they follow the new width.
- Tapping the now-exposed timeline either side still closes the article, unchanged.

## v439 — 2026-09-20

**Ask:**
- v425's era-label behaviour was right; just a bit more padding as the label slides off. Revert
  if that isn't possible.

**Implementation:**
- Reverted v438 (`ERA_LABEL_MARGIN` back to 8). That was the wrong lever and a provable no-op for
  this case: simulating an era entering from the screen edge gives byte-identical label positions
  at 8 and 24, because the era-bounds clamp binds first and the viewport inset never gets a say.
- The gap Tom was actually describing is `.era span`'s own side padding — the clamp rests the
  SPAN's edge on the era divider, so that padding is the gap between divider and text. 8px -> 22px.
  Verified this one does move the gap, unlike v438's.
- No behavioural change otherwise: the v425 slide-off is exactly as it was.

## v438 — 2026-09-19

**Ask:**
- Era label edge padding (the min gap from the screen edge before a label starts riding off, per
  v425) should be 3x what it currently is — "Age of Martyrs" was reading flush against the edge.

**Implementation:**
- `ERA_LABEL_MARGIN` 8 -> 24. Single constant, used symmetrically on both edges in
  `updateEraLabels()`, so both sides got wider at once.

## v437 — 2026-09-19

**Ask:**
- Narrow the article box by 40% too, not just the fact box — the outer story container, still
  landscape only.

**Implementation:**
- `.artwrap` gets its own landscape-only rule: `max-width:432px` (40% off its 720px base),
  still centered by the `margin:0 auto` it already had. Portrait untouched.
- `.factbox`'s separate 60%-of-parent cut from v433 was dropped in favor of filling 100% of the
  now-narrower `.artwrap` — stacking both independent 40% cuts would have compounded to roughly
  260px, too narrow to read a label and its value side by side.

## v436 — 2026-09-19

**Ask:**
- Saints search box: ignore "st", "st.", "Saint", "Saints" as noise words.
- "ro be" should find Robert Bellarmine — space-separated fragments, all required, each
  matching anywhere (not as one contiguous substring).
- Apply the fragment matching to all search boxes.

**Implementation:**
- New shared `SEARCH_STOPWORDS` ('st','saint','saints','sts' — 'sts' added alongside Tom's four
  since `spDisplayName()` already treats it as the same honorific for display), `searchFragments()`
  and `fragmentsMatchAny()`, used by both `spRows()` and `brRows()`. Replaces their old
  `spNormalize(e.n).includes(q)` whole-string check, which required the ENTIRE query as one
  contiguous substring — "ro be" never matched "Robert Bellarmine" there before this.
- Real prior bug this fixes: entries store the name as "St. ___" literally, so a reader who
  typed "Saint" (spelled out, as many naturally would) got zero results — "saint" never appears
  as a substring of "st. ___". Verified: "saint augustine"/"st augustine" and "saints cosmas"
  now both find their entries; "st"/"saint"/"st." typed alone now fall back to showing
  everything (frags empty) rather than matching nothing.
- The timeline's own `#tlSearch` already did per-fragment AND-substring matching (each parsed
  term independently required, found anywhere in the field) — that part didn't need changing.
  Only the stopword drop was missing: `parseSearchQuery()` now skips a plain (unquoted,
  non-excluded) token via `isStopwordTerm()`, which tolerates the trailing period `fold()`
  leaves on "St." that `spNormalize()` would otherwise strip. A quoted `"saint"` is a deliberate
  whole-word search and is left alone.
- Left out of this pass, pending confirmation: the Manage-side search boxes (`#mSearch`,
  `#mfSearch`, `#logSearch`, `#lpSearch`) — CMS/owner tools rather than the three reader-facing
  list searches this was actually about. Say if any of those should get the same treatment.

## v435 — 2026-09-19

**Ask:**
- Slow the timeline travel animation down a little more.

**Implementation:**
- `animateScroll()`'s duration multiplier 2 -> 2.5 (v420 had doubled it from the original; this
  is a smaller further step, not another doubling). Range is now roughly 1050-2875ms by distance,
  up from 840-2300ms.

## v434 — 2026-09-19

**Ask:**
- Give every category a search box, with recent searches kept separate per category.

**Implementation:**
- Browse panel gains the same search shell as Saints (`#brSearch`/`#brSearchClear`/`#brRecentBox`),
  inside `.panelHead` for the same reason — the compact layout pulls it onto the title row. The
  `.listPanel .panelHead .spSearchWrap` layout rules were Saints-scoped and are now shared, so
  Browse's compact header is title + pill + search + × like Saints', answering v433's open
  question: no empty space and no Browse-only special case.
- `brRows()` filters on the entry name OR the category's own last-column value (`cfg.lastValue`),
  so "France" in Councils and "Poland" in Eucharistic Miracles match by the same text visible in
  the list. Verified across name and region matching.
- Recents are keyed per category — `ct-browse-recent-searches-c|p|u|m|e` — so Councils' history
  never appears while browsing Persecutions, and none of them mix with the Saints list
  (`ct-saints-recent-searches`) or the timeline's. Same promote-don't-duplicate and cap-at-5
  behaviour, and the term is pushed on a row tap, matching Saints.
- Placeholder is set per category on open ("Search councils", "Search persecutions", ...).
  Search clears on open; sort/filter/scroll still carry over as before.

## v433 — 2026-09-19

**Ask:**
- The compact slide-out treatment should cover every category, not just Saints.
- Undo v432's article-width reduction — the 40% was meant for the Quick Facts box (the bordered
  panel inside the story), and only in landscape.

**Implementation:**
- Reverted `.artwrap` to its original flat `max-width:720px`.
- `.factbox` instead gets `width:60%` centered under `@media (orientation: landscape)`. Portrait
  keeps full width, where there is no room to spare.
- Both left-slide list panels now carry a shared `listPanel` class, and the whole compact media
  block was retargeted from `.saintsPanel` to `.listPanel` and relocated below `.browsePanel`'s
  own base rules so its top/max-height overrides land without extra specificity. Browse rows are
  already `class="spRow brRow"`, so the shorter-row rule reached them unchanged.
- `setSpChipsOpen`/`syncSpChipBand` generalised to `setChipsOpen(prefix, on)`/`syncChipBand(prefix)`
  keyed on 'sp'/'br'; the old Saints names remain as thin wrappers so existing call sites read
  unchanged. Browse gets its own `#brChipBand` pill, wired to open/close/render the same way.
- A category with no chips of its own (Persecutions, Events today) hides its pill row rather than
  showing a dead control — `syncChipBand` sets `hidden` from whether any chip exists.
- `body.saintsPanelOpen` renamed `listPanelOpen` and now toggled by both panels, so the app title
  slides clear of either.

**Open question:** Browse has no search box, so its compact header is just title + pill + ×, with
the row that Saints spends on search left empty. Options: leave it (simplest), pull the pill up
onto the title line for Browse only, or give Browse a search box of its own. Say which.

## v432 — 2026-09-19

**Ask:**
- The All/Feast view reads "Saint's" in the compact layout — drop the possessive.
- Point the pill arrow down and make it slightly larger.
- The article overlay runs the full width of the screen; make it 40% narrower, centered.

**Implementation:**
- Compact hides the italic second half of the title, which left "Saint's Feast Day" as a bare,
  dangling "Saint's". `renderSaintsPanel()` now wraps only the apostrophe in a `.spPoss` span,
  which the compact media query drops — so the word reads "Saints" there and the full-height
  title is byte-identical to before. One string, no second copy to keep in step. Verified across
  all five title variants.
- `.spChipBandArrow` path flipped to a down triangle, 13px -> 16px.
- `.artwrap` max-width `720px` -> `min(720px, max(60vw, 340px))`: 40% narrower and still centered,
  with a 340px floor so it doesn't collapse to a column on a narrow portrait phone, and the old
  720px still acting as the ceiling on a wide desktop window. `#manage .artwrap`'s 900px override
  is untouched.

## v431 — 2026-09-19

**Ask:**
- Center the pill under the category word itself, tightly spaced.
- Bring the search box down so it is vertically centered against the category/pill pair.
- Take the panel all the way to the top, and move "Catholic Timeline" right so it stays visible
  while the panel is open.

**Implementation:**
- `.spChipPillRow` moved inside `.spTitleWrap`, which becomes a centered flex column in compact
  mode (`gap:3px`) — so the pill centers on the category word rather than on the panel, and the
  two read as one unit.
- `.panelHead` gets an explicit `align-items:center`, which puts the search box and the × on the
  vertical midline of the title+pill stack instead of level with the title alone.
- Compact `.saintsPanel` top `46px + safe-area` -> 0 and max-height -> `100vh`; rounded right
  corners unchanged.
- The panel now covers the header's left end, so `body.saintsPanelOpen h1` translates the app
  title right by half the panel's width, on the same easing curve and duration as the panel's own
  slide so the two move together. The class is toggled unconditionally in `openSaintsPanel()`/
  `closeSaintsPanel()`; only the compact media query has a rule for it, so it is inert elsewhere.

## v430 — 2026-09-19

**Ask:**
- Keep the sort column headers.
- Drop the gold band at the foot; move the category up nearer the top and put a gold pill with
  an arrow centered tightly underneath it. There was unused room at the top.
- Let the panel run to the full bottom of the site, keeping its rounded corners.
- Slightly shorter rows.

**Implementation:**
- `#spChipBand` moved out of the panel foot into a new `.spChipPillRow` directly under
  `.panelHead`, restyled from a full-width band into a centered rounded pill. While the sheet is
  up the row goes `visibility:hidden` rather than `display:none`, so the rows below it don't jump
  by its height each time the sheet opens.
- Compact `.saintsPanel` padding-top 22px -> 10px, `.panelHead` padding-bottom 18px -> 0, title
  26px -> 22px, and max-height from `100vh - 78px` to `100vh - 46px - safe-area-top` so the panel
  reaches the window foot. `border-radius:0 26px 26px 0` untouched.
- `.spRow` vertical padding 11px -> 8px in compact. `--rowH` is re-measured off a real row on
  every render, so the sticky group label and the infinite-loop maths follow automatically —
  there is no constant to keep in step.
- `.spListWrap` gains a safe-area bottom pad, since the list now ends at the physical screen edge
  rather than 78px above it.
- Budget check at the new numbers: ~10 rows at 540px viewport height, 6-7 on a landscape phone
  (390-430px) — up from roughly 4 before this pass. The sort header stays, as asked.

## v429 — 2026-09-19

**Ask:**
- When the Saints panel is short on space (ten rows or fewer), buy back room: drop the subtitle
  and move the search box up beside the title, ending before the close ×.
- Turn the chip bar into a sheet that slides up from the bottom and retires once a selection is
  made. The bottom quarter-inch becomes a gold band naming the selection in white with an arrow
  hinting at the sheet; the band disappears while the sheet is up, and the sheet reaches the
  very bottom.

**Implementation:**
- The Saints search box now lives inside `.panelHead` rather than as a sibling below it. At full
  height `.saintsPanel .panelHead` wraps it to its own full-width line (`order:3; flex:0 0 100%`)
  so nothing looks different; the compact layout re-orders it between title and × instead. Only
  this panel's markup moved — Browse and Task keep theirs as siblings.
- Compact layout is gated on `@media (max-height:760px)`, roughly where the fixed chrome stops
  leaving ten rows. Phones in portrait and tablets stay on the full layout; landscape phones and
  short desktop windows get the compact one.
- `.spChips` becomes `position:absolute; bottom:0` in compact mode, so the list keeps the height
  the bar used to take, and rides in on a transform under `.saintsPanel.chipsOpen`. New
  `#spChipBand` takes its place in flow.
- `setSpChipsOpen()`/`syncSpChipBand()` handle raise/dismiss and the label. The sheet closes on a
  chip pick, on Learn More, and on any pointerdown in the list. Both look their elements up by id
  rather than closing over consts — they are called from `renderSaintsPanel()`/
  `openSaintsPanel()`, defined earlier in the file, so a const declared at their own definition
  point would sit in its temporal dead zone for any call that ran first.

## v428 — 2026-09-19

**Ask:**
- Settings update row: show the version number right after "New Version", with the Update button
  still on the right. Drop the right-hand arrow on the up-to-date state, make the version number
  black like the rest of the row, and have it read "Version up to Date  v4NN".
- Make the Offline Access disclosure triangle bigger.

**Implementation:**
- `.pChev` removed from `#updateBtn`'s markup (the other two rows that navigate, Install and
  Manage, keep theirs). `setPendingReload()` no longer hides `#updateCur` — the version number
  now holds its slot in both states, so the row reads "Version up to Date  v427" or
  "New Version  v433  [Update]".
- `#updateCur` overrides `.pMeta`'s dimmed grey with #111827. It is the row's actual answer
  rather than a secondary note, unlike Review Mode's "13 pending", which stays grey.
- The up-to-date branch of `checkVersion()` now resets `#updateCur` to `APP_VERSION`; a previous
  check could otherwise leave a newer pending number sitting next to "Version up to Date".
- `.pCaret svg` 17px -> 24px.

## v427 — 2026-09-19

**Ask:**
- Put changelog entries in index.html's header in a set format, then have a daily service pull
  them into CHANGELOG.md and trim the header.

**Implementation:**
- New sentinel-delimited staging block in this header (see the prose above it), plus
  `scripts/sync-changelog.mjs` and `.github/workflows/sync-changelog.yml` running it daily.
- Entries start here rather than in CHANGELOG.md because index.html is the file a chat session
  can edit and hand back whole — v420-v426 had all shipped without ever reaching CHANGELOG.md.
  This release backfills them.
- Prunes by version number, never by age, and asserts every version it drops is present in
  CHANGELOG.md first: a run that fails for a week loses nothing, and a second run the same day is
  a no-op. Rewrites only the span between the sentinels; aborts if either is missing or doubled.

## v426 — 2026-09-19

**Ask:**
- Tapping the search box should place the cursor on the first tap, not the second.
- Any tap, drag or scroll outside the search box or its dropdown should close the dropdown.
- Readers who pinch-zoom get stuck; unzoom automatically on the common paths.

**Implementation:**
- `#tlSearch`'s focus handler no longer calls `runSearch()` inline. Building the dropdown
  synchronously while the browser was still settling focus is what made the first tap land the
  focus (recents appeared) without landing a usable caret. Deferred with `setTimeout(..., 0)`.
  Best-supported explanation rather than a confirmed one — `user-select`, stray `blur()` calls,
  the hamburger's outside-handler and the viewport-resize handler were all ruled out first, but
  this was not reproducible off-device.
- New `closeSearchResults()`, wired to a capture-phase document `pointerdown` (anything not
  inside `.searchwrap`) and to `viewport`'s scroll. Capture + pointerdown for the same reasons
  the hamburger menu's own outside-handler uses them: it still fires for handlers that
  stopPropagation, and for touch-scrolling that never produces a click. Also drops the keyboard.
- New `resetPageZoom()`. There is no API to set page zoom, so it momentarily adds
  `maximum-scale=1, user-scalable=no` to the viewport meta (making the browser snap back) and
  restores the original 350ms later, so pinch still works immediately after. Called from
  `focusEntry()` and `closeArticle()` — navigation moments, not a timer, so a deliberate zoom is
  never yanked away mid-read. No-op below scale 1.01.

## v425 — 2026-09-19

**Ask:**
- Era labels pop off screen all at once when the era gets cramped; they used to slide off
  holding their padding. Same in both directions.

**Implementation:**
- `updateEraLabels()` now clamps the label's center into its era's own bounds
  (`[eraLeft + w/2, eraRight - w/2]`) instead of hiding it when the visible slice is too narrow.
  While there is room the clamp doesn't bind and the label stays centered in the visible slice;
  once the slice narrows it comes to rest against its era's boundary and rides it off the screen
  edge. This is the same result the old `position:sticky` produced at the edges (its containing
  block did the clamping), now with the centered behaviour through the middle that sticky could
  not give. Era narrower than its own name at the current zoom falls back to the band's midpoint.
- Reverted v423/v424's opacity fade on `.era span` — nothing hides anymore.

## v424 — 2026-09-19

**Ask:**
- Offline Access should only appear when Owner Tools is on.
- Add a blue triangle after "Offline Access": tapping the row from the left edge through the
  triangle expands the note below and flips the triangle; remember the state. Tapping right of
  the triangle toggles the switch.
- The Font Size label should match the other rows' font face.

**Implementation:**
- `#offlineRow` and `#offlineNote` now follow `unlocked` in `updateManageVisibility()`, the same
  rule as Review Mode and Manage. Note this removes the only control that starts the service
  worker from ordinary visitors — anyone who already enabled it keeps it, since the stored
  `offline-access` preference and its registration are untouched.
- The row stopped being a `<label>`: a label wrapping the whole row claims every tap on it for
  the checkbox, caret included. It is now a plain div holding `.pDisclose` (tile + name + caret,
  a real button) and `.pSwitchHit` (a `<label for>` filling the rest out to the switch).
  Disclosure state persists in `localStorage` under `offline-note-open`, collapsed by default.
- `.pSpecimen` lost its `font-family:'EB Garamond'` override (it was deliberate once — the label
  doubled as a live size specimen). It still scales with the stepper, just in system-ui now.

## v423 — 2026-09-19

**Ask:**
- Era labels arrive chopped mid-word when an era scrolls in from the left.

**Implementation:**
- Superseded by v425 — see there. This release hid the label whenever its visible slice was
  narrower than the label itself, which stopped the chopping but introduced the popping v425
  fixes properly.

## v422 — 2026-09-19

**Ask:**
- Move the Update button onto the same line as the version row, replacing "Available".

**Implementation:**
- `#updateActionBtn` moved inside `#updateBtn` as an inline `.pUpdateInline` pill and is no
  longer its own button — a tap anywhere on the row already reaches the row's own handler, which
  reloads whenever `pendingReload` is true, so its separate click listener was removed.
  `setPendingReload()` now also hides `#updateCur` and `.pChev`, whose spot the pill takes. Label
  text shortened to "New Version".

## v421 — 2026-09-19

**Ask:**
- Era labels that have room should stay centered in the visible part of their band.

**Implementation:**
- `.era span` moved off `position:sticky` onto JS positioning via a new `updateEraLabels()`,
  scroll-driven like `updateBandIconFade()`/`updateCenterYearBadge()`. Sticky could only clamp to
  a flat offset from the screen edge, so an era wider than the viewport sat pinned at that edge
  for most of the scroll through it.

## v420 — 2026-09-19

**Ask:**
- Timeline travel should ease in and out, and run about twice as long.

**Implementation:**
- `animateScroll()`'s duration doubled (now roughly 840–2300ms by distance). The ease curve was
  already a slow-start/slow-end cubic; at the old 420–1150ms range it read as a near-linear snap.

## v419 — 2026-09-18

**Ask:**
- Settings → New Version Available: remove the explanatory paragraph below it, replace with a
  button that says "Update".
- New checkbox: "Offline Access" — stores the entire app on the phone.
- Service worker should only pull refresh data over Wi-Fi, not cellular.

**Implementation:**
- Settings panel: the `updateNote` paragraph ("Tap to reload. Unsaved Manage edits will be
  lost...", plus the iOS swipe-away fallback line) is gone entirely, replaced with
  `#updateActionBtn`, a dedicated "Update" button shown only while a reload is actually pending.
  `setUpdateNote()` is gone; `setPendingReload(bool)` now toggles both the flag and the button's
  visibility in one place. The row itself (`#updateBtn`) still reloads on tap too when pending,
  unchanged — the new button is an explicit, unambiguous second way to do the same thing, not a
  replacement wired differently underneath.
- Offline access is now opt-in, not automatic: a new "Offline Access" toggle in Settings (outside
  Owner Tools — this is for every visitor), off by default, persisted to localStorage. Turning it
  on registers `sw.js`, requests persistent storage, and kicks off the media warm-up; turning it
  off actually unregisters the service worker and clears both caches, so the switch reflects
  reality rather than just hiding a toggle while everything already pulled stays put. The
  always-on registration from v415 is gone — `enableOfflineAccess()`/`disableOfflineAccess()`
  now gate everything behind the stored preference, checked once on load and whenever the
  checkbox changes.
- Wi-Fi-only gating for the bulk media pull, via `isOnWifi()` (`navigator.connection.type`).
  **Real platform limitation, worth being direct about:** the Network Information API this
  relies on has never been implemented in Safari/iOS at all — Apple's own choice, for privacy
  reasons — so this can only actually distinguish Wi-Fi from cellular on Android Chrome.
  Everywhere else, including Tom's own iPhone, there is no way for a web page to ask this
  question, so `isOnWifi()` returns `true` (doesn't block) rather than silently prevent the
  offline feature from ever working on a platform that could never satisfy a stricter check. In
  practice, on iOS this restriction is a no-op — the honest fix, if wanted, is a native-level
  control (e.g. iOS's own Low Data Mode) rather than anything a web page can enforce itself. On
  a platform where it works, a bail for "not on Wi-Fi" does NOT count as a completed run (the
  24h throttle timestamp is only set after an actual attempt), so it retries next time this is
  called rather than sitting out a full day for a check that never got to run.

---

## v418 — 2026-09-18

**Ask:**
- Split the header changelog out of `index.html` into this file; leave one short comment behind
  explaining where to find it.
- Going forward, keep what Tom actually asked for separate from the technical implementation
  notes within each entry.
- Stop tracking version/date inside `index.html`'s comment.
- Write the new convention up in a project doc, and recommend which one it belongs in.

**Implementation:**
- Moved the entire former header comment — everything under "Full history through v417" below
  — into this file verbatim. No rewording, no retroactive reformatting into the Ask/
  Implementation shape; see the note above on why.
- Discovered mid-change, and worth flagging clearly: `index.html`'s Manage → Logs tab reads
  `changelog.json`, which a GitHub Action populates by parsing this exact header comment
  (VERSION/DATE/CHANGES) on every push to `main`. A bare pointer comment with no VERSION:/
  DATE:/CHANGES: labels would likely have gone right on being "successfully" pushed while
  silently breaking that Action, without anything here surfacing the failure. So the "stop
  tracking version/date" part of the ask is only partly done: the stub below keeps the
  VERSION/DATE/CHANGES *shape* (for that Action to keep parsing), but the CHANGES content
  itself is now just a one-line pointer rather than the full text. I can't see the Action's
  actual parsing logic from inside this file, so this is a reasonable-assumptions fix, not a
  verified one — worth confirming Logs still populates after the next push, and worth pointing
  me at the Action's YAML directly if a cleaner version (e.g. reading CHANGELOG.md instead) is
  wanted later.
- New doc: `app-engineering-skill.md`. Recommended over the alternatives already in the
  project — PROJECT-STATE.md explicitly delegates "how anything works" to linked docs rather
  than explaining process itself ("for *how* anything works, follow the links out to the
  detailed doc rather than re-explaining it here"), and content-authoring-skill.md /
  json-import-skill.md are both specifically about saint/entry content, not the app's own code.
  None of the four existing project docs are about engineering the app itself, which is what
  this rule (and future ones like it) actually govern. PROJECT-STATE.md's "Skill docs" section
  updated to list the new file alongside the other two, so it stays discoverable the same way.

---

## Full history through v417

*(Preserved exactly as it read in index.html's header comment prior to the v418 split above —
a single running list rather than one heading per version; older entries are folded in inline
once they'd aged past needing full detail, e.g. "v315/v314/v313 (unchanged): ...".)*

VERSION: 417
DATE: 2026-09-17T17:40:00-05:00
NOTE: this file has TWO version numbers and BOTH must be bumped every build — this comment, and
`const APP_VERSION`, which is what the app displays and what update-detection compares.
CHANGES:
- Offline access now proactively pulls images and audio too, not just whichever ones happen to
  get viewed (confirmed same-origin, so this is safe/expected to work for all of them). sw.js
  gained a second, separate cache for media using stale-while-revalidate (serve the cached copy
  instantly if there is one, refresh it in the background regardless) — kept deliberately apart
  from the page/data.json's network-first cache so neither strategy can interfere with the other.
  index.html now walks every entry's image/audio/timing-json on load and fetches each one
  (throttled, 4 at a time) so the service worker's fetch handler catches and caches them — once
  every 24h, not every single app open. Also requests persistent storage now that the media
  cache can genuinely grow to some size.
- Fixed an image that failed to load while offline staying broken even after the connection came
  back. A browser never retries a failed <img> on its own — added retryBrokenImages(), which
  resets `src` on anything currently broken, triggered on the 'online' event and, as a defensive
  second trigger since iOS Safari doesn't always fire connectivity events reliably, on
  visibilitychange too.
- Offline access: added sw.js (a new file — must be uploaded to the repo alongside this one, same
  folder as data.json) and registered it here. Caches the page and data.json so losing the
  connection shows the last-synced version instead of the site being unavailable. Deliberately
  network-first, not cache-first, so the existing reload-driven update check is unaffected — see
  sw.js's own comments, and the updated comment above checkVersion() below. Only registers on a
  real web host, never inside the Claude artifact sandbox.
- Two features opened up from Review Mode only to everyone: the center-year readout on the
  timeline axis, and the Ken Burns slow zoom/drift on article hero photos (the latter had been
  sitting behind Review Mode since v213 while it was being evaluated).
- Landscape mode: church dome image hidden, title shrunk, and the search box pulled up out of
  its own row (fixed-positioned to the header's left edge, since it lives in a separate DOM block
  below header) so search, "Catholic Timeline", and the hamburger/gear button all share one
  compact header row — giving the timeline the vertical room that used to go to a second row.
- Center-year badge font bumped one more point (16.5px → 17.5px).
- Tick label fade (the "400"/"500" hide-near-center effect) slowed and softened: .ticklbl's
  opacity transition went from .15s ease to .5s ease-in-out.
- Center-year badge: fade-safe-zone widened from 30px to 40px (CENTER_YEAR_SAFE_ZONE), and the
  number's own font size bumped one point (15.5px → 16.5px).
- Fixed the center-year badge sometimes showing a nearby "900"/"1000" tick label half cut off.
  The badge had a 130px min-width left over from the old gradient design, but the JS fade that
  replaced that gradient only hides a label within 30px of center — so a label sitting 30-65px
  out (still under the now-wider-than-that solid box, just outside the zone that fades it) was
  visually clipped by the box's edge instead of cleanly hidden. Removed the min-width; the badge
  now hugs its own text (padding only), which keeps it well inside the zone that already fades
  labels to invisible, so nothing can be partially covered again.
- Fixed era band titles ("EARLY MIDDLE AGES" etc.) sometimes not showing on screen at all, or
  showing off to one side instead of where expected. Root cause: .era had overflow:hidden, which
  made IT (rather than #viewport) the reference frame for its own label's position:sticky —
  since .era never actually scrolls on its own, the label just sat at its plain flex-centered
  position (the midpoint of that era's entire date range, which spans centuries and can be
  thousands of px wide), landing wherever that happened to fall relative to the current scroll
  position — often far off to one side. .era span's sticky rule (left:8px/right:8px) was already
  exactly the intended "slide freely, catch 8px from the screen edge, release once the era's own
  right boundary pushes it back into motion" behavior — it just couldn't reach its real scrolling
  ancestor. Removed .era's overflow:hidden and it now works as designed.
- Fixed the center-year badge sometimes showing a "400"/"500" tick label half-faded/half-sharp
  as it scrolled past. Cause: the old background gradient masked whatever pixels happened to sit
  under its fade zone, with no guarantee that lined up with a label's actual boundaries — a label
  straddling the zone showed partly clear, partly faded. Removed the gradient (badge background
  is now a flat solid fill) and replaced the masking with a per-label check instead: each
  .ticklbl now fades to fully hidden, as one atomic unit, once its own center comes within 30px
  of true screen-center (CENTER_YEAR_SAFE_ZONE), and fades back in once it clears that zone —
  .ticklbl's new `transition:opacity` is what turns that plain threshold snap into an actual fade
  rather than a hard pop. Still gated on Review Mode; ordinary visitors never run this check.
- Center-year badge, four tweaks:
  1. Background color-matched to .timehead's own background at that row (rgba(11,22,48,.97),
     the exact value its gradient lands on near its bottom edge) instead of a separately-guessed
     shade — the badge now reads as part of the surface rather than a pasted-on rectangle.
  2. Widened ~30% via an explicit min-width (130px, was implicit padding+text sizing only), so
     the transparent-to-solid fade begins further out from center.
  3. Replaced the plain vertical tick mark with a small downward-pointing notch that reads as
     the axis's own gold line bending down to a point — two stacked CSS border-triangles from
     one shared top-center origin (outer solid gold, inner solid navy matching the badge's own
     fill, sized/positioned so only a thin constant-width gold rim shows along the two slanted
     sides before converging to a solid gold tip). Positioned right at y:58, .axis's own
     border-bottom row, so it visually interrupts and bends that line rather than floating near it.
  4. Scroll-room padding at both ends of the whole timeline widened from 40/60 years to 250 years
     each side (START -60→-250, END 2070→2260, ERAS's first/last entries synced to match per the
     existing hand-sync note) — the old buffer wasn't enough for centerAndFocus() to truly center
     an entry near either edge at typical viewing zoom; scrollLeft would just clamp instead.
- Fixed the center-year badge (v405) not showing at all. It was placed AFTER #canvas in the
  markup, and #canvas is very tall — the whole vertical stack of every category lane. Sticky
  positioning only pins an element once scrolling has carried it PAST its natural, pre-stick flow
  position; with that natural position sitting below the entire tall canvas, the badge would only
  ever appear if scrolled all the way to the bottom of the timeline, which reads as "never shows"
  under normal use. Moved it to be #canvas's PRECEDING sibling instead (still zero-height, so no
  layout shift) — its natural position is now already at the very top, so it's pinned from the
  first frame regardless of vertical scroll. z-index:30 keeps it painting above #canvas either way.
- Fixed the center-year badge (v404) drifting instead of staying locked to the center of the
  screen. Root cause: it was nested inside .axis, and .axis's width is set in JS to match the
  ENTIRE scrollable canvas (thousands of px for a 2000-year span) — so the sticky left:0/right:0
  centering trick was resolving against that huge width instead of the actual screen width, and
  only appeared to work near wherever its "natural" flow position happened to fall. Moved it to a
  persistent sibling of #canvas (a direct child of #viewport) instead, so its containing block is
  the true visible viewport at all times — now genuinely locked to the center regardless of
  scroll position. Also no longer recreated on every render() call (it used to be torn down and
  rebuilt inside .axis's DOM on every re-render); it's static markup now, just its text updates.
- Fixed the axis's gold border-bottom line reading as dimmed directly under the badge. The badge's
  solid background previously extended the full 28px axis height, painting straight over that
  1px gold line where the two overlapped. Inset the badge 2px top and bottom so it never reaches
  that row — the line now stays fully bright the entire width, including behind the badge.
- Added the center-year readout on the timeline axis — Review Mode only (body.review-on;
  invisible to regular visitors), so it's an owner navigation aid, not a public feature. Shows
  whatever year sits at the true horizontal center of the screen and ticks through it live as
  the timeline is dragged/flung, via the existing centerYear()/scroll-driven update pattern
  (same rAF-throttled approach as the band-icon fade just above it in the code). Redesigned away
  from a pill-outline look: a solid dark plaque across the center 50% of the badge's own width,
  fading to fully transparent over the outer 25% on each side — no border/outline at all. Sits
  above the ordinary "400"/"500" century tick labels (z-index + DOM order), so one sliding
  underneath fades as it nears the gradient zone and disappears once it's under the solid center,
  purely from that stacking + gradient — no separate per-label fade logic needed. Stays centered
  on screen throughout the whole horizontal scroll range via `position:sticky; left:0; right:0`
  on a full-width child of .axis (the standard "sticky marker inside a horizontally-scrolling
  strip" trick), not JS-computed positioning, so it tracks scroll smoothly even during a fast
  fling. Font bumped slightly (13px → 15.5px) and bolded to stand out from the plain tick labels.
- Timeline viewport no longer rubber-bands vertically. Dragging past the top (or bottom) of the
  era band/axis/lanes stretched the whole canvas downward, revealing blank navy background above
  the era band before it snapped back — the classic iOS elastic-overscroll bounce, playing out on
  the .viewport div itself, not the page. `overscroll-behavior-y:contain` only stops that bounce
  from also chaining up to scroll the page (which can't scroll anyway, body is overflow:hidden) —
  it doesn't suppress the local bounce. Switched to `overscroll-behavior-y:none`, which suppresses
  the bounce itself. Normal vertical scrolling between category lanes (Saints/Councils/etc.) is
  untouched — this only removes the ability to drag past the actual top/bottom boundary.
- Auto-approve moved server-side for real this time. Tom: "I'm not going to do approvals" — v401's
  batching still depended on his phone's browser being open to do the actual approving and
  publishing; he doesn't want that dependency at all going forward, not just for the current
  backlog. Redesigned across three files:
  - index.html: the "Auto-approve split sentences" checkbox is read ONCE, at Add Task time, into
    the queued task's payload.autoApprove — a per-task decision made when queued, not something
    re-checked later by whatever the checkbox happens to say whenever the task eventually runs.
    The checkbox itself still lives here (Tom: "approval logic belongs in the index") — only the
    EXECUTION for an auto-approved task moves server-side. tkAutoApproveSentenceRewords() (the
    v401 client-side batched-publish mechanism) is untouched and still runs, but now only as a
    legacy fallback for tasks queued the old way (including ones already sitting in workLog.json)
    — a task queued with the new flag never reaches 'proposed' at all, so that function simply
    never sees it. Corrected the checkbox's label, which was no longer true.
  - scripts/services/sentence-reword.mjs: task.payload.autoApprove true skips the spawned-review-
    task path entirely. Applies its own patches directly to dataJson via a new
    applySentencePatchToSections/applyPatchesToEntry — a straight port of index.html's
    patchTextInSections (v397's relaxed anchor rule included) — clears stale audio, and returns
    dataDirty:true instead of spawning anything. Verified against the real link-bearing patches
    from the 2026-09-16 workLog: all 13 apply cleanly with every link intact; a synthetic partial-
    apply case (one patch matchable, one deliberately stale) applies the one it can and flags the
    entry for review via entry.review/reviewNote, same as the client-side v399 fix, rather than
    silently discarding the failure; a link-cutting span is still correctly refused. KNOWN GAP,
    stated plainly in the file: this clears entry.audio but does not delete the orphaned audio/
    timing files from the repo the way the client's publishToGitHub()\u2192purgeStaleAudioFiles()
    chain does — worth a follow-up if that becomes a real nuisance.
  - scripts/orchestrator.mjs: new DATA_COMMIT_BATCH_SIZE (10, env-overridable). A dataDirty task
    accumulates rather than commits immediately; once the count reaches the threshold, the commit
    happens and covers the whole group in one push. A final flush after the run handles a partial
    group at the end (7 of 10, say) — the server-side equivalent of tkFlushDeferredPublish (v398).
    Went further than a bare flush: if a batch's commit FAILS, every task already optimistically
    marked 'done' in that group is retroactively corrected to 'error' with an honest message,
    not left claiming success for content that never actually reached GitHub — the one prior task
    that triggered the attempt gets the same correction through the existing shared
    if(!published) path, so nothing is double-handled.
    Verified end-to-end in a sandboxed two-repo setup (a real bare "remote" to push to, not just
    reasoning about git): 13 tasks with a working remote produced exactly 2 content commits (10,
    then 3) with every task 'done' and all 13 entities actually present in the pushed data.json;
    the same 13 tasks with NO remote configured (forcing every push to fail) ended with all 13
    correctly marked 'error' and zero false "done" statuses; a 4-task run exercised the final-
    flush-only path with a working remote; DATA_COMMIT_BATCH_SIZE=3 confirmed the threshold is
    actually configurable, not hardcoded despite being named as a constant.
- Tom asked for automated reword approval that publishes every 10 articles instead of by hand.
  Auto-approve already existed (the checkbox); what was missing was batched publishing. Fixed:
  tkAutoApproveSentenceRewords() now always defers (wlResolveTasks(..., {deferPublish:true})) and
  decides for itself when to actually flush, once dirtyEntryIds — everything approved but not yet
  published, accumulated across however many poll cycles it took — reaches TK_AUTO_PUBLISH_BATCH_SIZE
  (10). Reuses tkDeferredPublish/tkFlushDeferredPublish exactly as manual approve (v398) and
  proofread (v400) already do, so the same safety net applies for free: finishing a run, backing
  out of Review, or closing the panel all still flush whatever's pending — a partial batch under 10
  when a run ends is never left stranded unpublished. Verified by simulation: 23 approvals trickling
  in across 8 poll cycles produced exactly 2 real batch publishes near size 10, plus one final flush
  for the last 1 — not 23 individual commits, and nothing left unpublished.
- Closed a gap this surfaced: publishToGitHub() and the audio-purge chain it calls on success
  (audioPathExistsOnGitHub, audioUrlExists, ghDeleteFile) were the one major network path that
  never got fetchTimeout in v392 — they only ever ran once per manual tap, so a hang was a rare
  annoyance, not a stuck-forever bug. Auto-approve now calls this chain unattended, repeatedly,
  for as long as a run keeps going, which is exactly the shape of bug v392 fixed everywhere else.
  All five raw fetch() calls in this chain now go through fetchTimeout, same 15s bound as the rest
  of the app, with AbortError worded as a timeout rather than a token/permissions problem.
- Extended v398's deferred-publish pattern to the proofread (arbitrate) review — Tom asked for the
  same treatment reword got. tkResolveArbitrateDebate('approve') and tkSaveArbitrateEdit() both
  used to publish on every single sentence decision; proofread review is per-SENTENCE rather than
  per-entity, so one article with several open debates meant several ~30s round-trips before even
  moving to the next task. Both now look ahead — other open debates in THIS article (open.length-1,
  since `open` still includes the current one at that point), then other tasks still queued behind
  it — and set the same tkDeferredPublish flag wlResolveTasks uses if anything remains, publishing
  for real only on the last decision. Reuses tkFlushDeferredPublish() as-is: tkGoList() and
  closeTaskPanel() already flush it on the way out, so no new wiring needed for leaving the queue
  early — one shared mechanism now covers both review flows.
  Verified by simulation: 2 articles with 3 and 1 open debates respectively (4 decisions total)
  now produce exactly 1 publish instead of 4.
- Found the actual mechanism behind "they keep going through and getting back in line, done but
  not marked as being done" — confirmed in wlApplyTaskToDb's own prior comment: "the task counts
  as applied as long as at least one patch actually landed." A sentence-reword task usually bundles
  several long-sentence fixes into one task. If some patches apply and one doesn't (stale match
  text, drift, a second task queued for the same entity before the first was resolved), the WHOLE
  task still landed as a clean 'approved' — the failed sub-note was computed and then thrown away,
  nothing recorded it. The entity still carries that one over-length sentence, so the next
  Add Task scan finds it again with zero explanation of why an "approved" entity is still eligible.
  Fix: wlApplyTaskToDb now returns partial:true when this happens, and (a) flags the entry via the
  existing review/reviewNote mechanism — visible in Review Mode immediately, including from an
  unattended auto-approve run nobody was watching the status line for — and (b) the status line
  itself now says "N only partially applied — flagged for review" instead of reporting a silent
  full success. Verified with a harness built from the real applyOnePatch/patchTextInSections/etc:
  a task with one matchable and one already-stale patch now applies the one that can, reports the
  one that can't instead of hiding it, and sets entry.review + reviewNote accordingly.
- Approve in the review queue is snappy again. v396 made every approve publish, which for manual
  tap-through meant a full GitHub round-trip (read data.json, merge, commit) per item — Tom
  measured ~30s per tap. Batched now: wlResolveTasks() takes deferPublish, and tkResolveCurrent
  looks ahead BEFORE resolving (the current item is still 'proposed' at that point, so scanning
  from the next index finds what's genuinely still awaiting a decision). Another item waiting ->
  skip the publish, keep moving. Last item in the queue -> publish for real, which covers every
  entry approved along the way, since publishToGitHub() always sends all dirty entries rather than
  just the latest. N approvals now cost 1 round-trip instead of N, landing identical content.
- Leaving the queue early can't strand anything: new tkDeferredPublish flag + tkFlushDeferredPublish(),
  called from BOTH tkGoList() (backing out to the list) and closeTaskPanel() (closing outright).
  Without that pair, walking away mid-queue would leave approved-but-unpublished entries — exactly
  the state that caused the re-queue loop diagnosed in v395/v396. Status line distinguishes the
  three outcomes: published, deferred ("publishing once you finish the queue"), or failed.
  Auto-approve is unaffected — it already resolved a whole batch in one wlResolveTasks() call, so
  it was always one publish per batch, not per item.
- Verified by simulation: 5 sequential approvals produce exactly 1 publish; exiting mid-queue after
  deferred approvals still produces exactly 1 (never 0).
- CORRECTION to v395/v396: I blamed sentence-reword.mjs for proposing patches on link-bearing
  sentences, and said its spec required skipping them. Reading the actual handler, that's wrong —
  it deliberately ATTEMPTS linked sentences (an improvement over an older blanket skip, per its own
  header comment), tells the model exactly which links to copy verbatim, and verifies afterward via
  extractEntryLinks/linksPreserved that every one survived byte-for-byte before proposing anything.
  The bug was on THIS side: patchTextInSections refused any match overlapping an <a> span at all,
  so the CMS discarded every carefully link-preserved rewrite the handler produced, and reported it
  as "text not found". 13 of the 46 proposed patches in the 2026-09-16 workLog were stuck on this.
- Fix: the anchor guard is now precise instead of blanket. A match that CUTS THROUGH a link
  (starts or ends mid-anchor) is still always refused — that could leave a broken half-link. A
  match that WHOLLY CONTAINS one or more links is allowed for a U patch provided every contained
  link appears byte-for-byte in the replacement — the same property the handler already verifies,
  re-checked here at apply time so the CMS never relies on the proposer being honest.
  locateTextInSections got the matching change (cuts-through still refused; containment allowed),
  since if the two disagree the review highlights sentences Approve then refuses.
  Verified against the real workLog: all 13 link-bearing patches now apply, every link intact in
  the result, and a deliberately link-cutting span is still refused.
- Tom asked whether this workflow was supposed to publish automatically. It was — and every review
  flow in the app DOES, except the one he was using. tkResolveImageFinal (image), tkResolveAudio
  (audio), and the arbitrate/sentence-edit screens all call publishToGitHub() the instant you
  approve. wlResolveTasks() — the sentence-reword approve path, including auto-approve — was the
  sole exception: it called saveDb() and told you to Publish manually. On a web host saveDb() is a
  NO-OP (read its body: artifact storage doesn't exist there, so it returns true having stored
  nothing), so an approved reword existed only in browser memory until a manual Publish. That is
  the actual origin of the v395 loop, one level deeper than v395 found it: unpublished rewords left
  data.json still long-sentenced, so the next scan re-queued the same entities, drafted patches
  against the original text, and those patches then failed against a session db already holding the
  new text. v395 made that failure harmless; this makes it not happen.
  Fix: wlResolveTasks() now calls publishToGitHub() after a successful approve, same position in
  the sequence as every other flow (db mutation → publish → workLog save). Approve only; rejecting
  changes no content so there's nothing to publish. Status messages updated accordingly — an
  approve now reports "published to GitHub — live in about a minute" or, if publishing fails, says
  plainly that it was NOT published and the next scan will re-queue those entries.
- The three earlier symptom-level items below (v393-v395) were all downstream of this one gap.
- DIAGNOSED from the actual workLog.json (not guessed from a video this time): the 13 stuck
  'proposed' sentence-reword tasks are not corrupt and their text is not missing. Each entity has
  exactly one 'done' generator task plus one 'proposed' review task, and the two that DID apply
  (St. Lucy, St. Catherine) look identical in every structural respect to the 13 that didn't — so
  it isn't a character-encoding or punctuation-normalization problem. The real mechanism is a
  publish loop: the sentence-reword service drafts patches against the REPO's data.json, but
  approving one only edits the in-session db — nothing reaches data.json until Publish. An entity
  approved-but-not-published therefore still looks un-reworded to the next scan, gets re-queued,
  and comes back with patches keyed to the ORIGINAL sentence that this session's db no longer
  contains, because it was already replaced. Every failing entity is one of the earliest processed
  (Anne & Joachim, Joseph, First Martyrs, Mark, Thomas, Philip, Luke...), i.e. the ones with the
  most chances to have gone round that loop.
  Fix: before calling a U patch failed, applyOnePatch now checks whether the patch's REPLACEMENT
  text is already present in the article. If it is, the work is already done — report success,
  change nothing, and let the task settle as approved instead of jamming at 'proposed' forever.
  Verified against the real workLog.json: the already-reworded case is now recognized, and a fresh
  article carrying the original sentence still applies normally.
- Separately: 13 of the 46 proposed patches have match text containing an <a href="entry:..."> 
  cross-reference link. patchTextInSections refuses those by design (rewriting across an anchor
  span could leave a broken half-link), so they could never have applied — but they were reported
  as "text not found," which sends you hunting for a mismatch that doesn't exist. They now report
  the actual reason. NOTE this is a handler-side bug worth fixing at source: per
  content-generation-workflow-state.md §4 the service is supposed to skip link-bearing paragraphs
  entirely, and it clearly isn't — scripts/services/sentence-reword.mjs needs that filter.
- New "Reset stuck (N)" button in the Task List bar, shown only when tasks are actually sitting at
  in_progress. Puts them all back to queued and saves workLog.json through the same path the review
  screens use. This exists because the automatic orphan reclaim added to scripts/orchestrator.mjs
  only helps if that updated script is deployed to the repo AND a run actually starts — neither is
  any use when you're looking at a screen full of Running rows that won't move and Run has nothing
  queued to pick up. This needs neither. Nothing is lost by resetting: a task stuck at in_progress
  never produced a result, which is what being stuck means.
- Likely root cause of the stuck-in-Running pile itself (not just its cleanup): before v393, the
  app re-ran auto-approve on EVERY poll of a live run, and that re-saved workLog.json to GitHub
  every ~3 seconds even when nothing applied. The orchestrator commits that same file per task.
  Two writers pushing to one file seconds apart is exactly the git race commitWorkLog's single
  pull--rebase retry is meant to absorb, and past that it gives up. A run that loses that race
  partway through leaves every task it had already claimed sitting at in_progress forever — which
  is precisely the 9/15 9:59p pile. v393 stopped the app's half of that collision; this build adds
  the manual cleanup for what the collision already stranded.
- Found the REAL cause of "does a few then gets stuck" this time, from the screen recording itself
  rather than reasoning about it: the status line was visibly alternating between "orchestrator
  running Xs" and a giant repeating "Approved 0 \u00b7 11 could not apply: text not found..." dump
  that named the SAME ~11 entries every time (Sts. Anne & Joachim, St. Joseph, First Martyrs, St.
  Mark, St. Thomas, St. Philip, St. Luke...), and the elapsed-seconds readout was barely moving —
  not frozen, just burning nearly all its time on a retry that could never succeed. Root cause: in
  wlResolveTasks(), a task whose patch fails to apply (wlApplyTaskToDb returns ok:false — its "old
  text" no longer exists in the article, almost always because it was already changed by an
  earlier patch or edit since this task was drafted) was NEVER marked as anything — it just stayed
  'proposed' forever. tkAutoApproveSentenceRewords() runs on every poll of a live Run (v390), so
  the SAME permanently-unfixable tasks got retried every ~3 seconds for the rest of the run,
  every single time re-fetching AND re-saving workLog.json even though NOTHING had changed (the
  save was unconditional, regardless of whether anything actually applied) — racing the
  orchestrator's own frequent commits to that same file for no reason, and burying the one status
  line Tom actually needed under a wall of the same 11 notes over and over.
  Fixed: new tkAutoApproveFailedIds (session-scoped Set) — a task that fails once is excluded from
  every later auto-approve attempt this session, so the retry storm can't recur. wlResolveTasks()
  now also skips saveWorkLog() entirely when nothing actually applied (true for BOTH the auto-
  approve path and a manual single-task Approve that fails) — previously it saved anyway and even
  told Tom the failed task was "merged into this session," which was simply wrong. Verified the
  Set-based skip logic against a standalone simulation (a task that always fails triggers exactly
  one save-skip cycle then never again; one that succeeds saves once and drops out of the
  'proposed' pool on its own) before shipping, not just by reading the code.
- On "all the logs were gone": most likely explanation is pruneCompletedTasks() in orchestrator.mjs
  (added a few versions back) doing exactly what it's built to do — it keeps only the 75 most
  recently-updated FINISHED tasks (done/approved/rejected/error) and permanently drops older ones,
  every single run, with no archive. With this many reword tasks processed across sessions lately,
  it's very plausible that's genuinely over 75 by now. Nothing in this video suggests a full wipe —
  the queued/proposed tasks it shows (St. Martin of Tours, St. Liborius, the 11 stuck ones) are all
  still present and accounted for, which argues against real data loss. If what you saw was
  older/finished history missing under All, that's this pruning; if queued or in-progress items
  themselves vanished, that's a different, more serious problem worth its own look — which was it?
- CORRECTION to v391: that fix's diagnosis was wrong. Tom clarified he never left the app — watched
  it stall in the foreground the whole time, then started recording — which rules out iOS tab
  suspension entirely; tkRefreshOnReturn() (still harmless, left in) was solving a problem that
  wasn't the one in the recording. The REAL bug: bare fetch() has no timeout in browsers, and
  nothing in this codebase's networking ever set one. That was a minor exposure when these calls
  only ever ran once per manual tap; v390 turned loadWorkLog()/saveWorkLog() into something called
  repeatedly, every few seconds, for the length of an entire Run (triggerWorkflow's onPoll,
  tkAutoApproveSentenceRewords riding along on every poll) — so a single stalled connection
  anywhere in that chain (flaky wifi, one slow GitHub response, nothing dramatic) now hangs the
  whole watch loop PERMANENTLY, since `await` on a promise that never settles blocks forever. Fixed
  properly this time: new fetchTimeout() (fetch + AbortController, 15s default) replaces the raw
  fetch() calls inside loadWorkLog(), saveWorkLog() (both its read and its write), and
  triggerWorkflow()'s three (dispatch, run-status poll, tkFetchStepsSummary) — every network call
  on this specific hot path now fails cleanly within a bounded time instead of hanging indefinitely.
  Also added a second, outer time bound around the onPoll call itself (safePoll, 20s) as defense in
  depth, so this loop can't freeze even from some future await added to that chain without its own
  timeout. Verified fetchTimeout itself against a real hung local connection (Node test harness,
  not just reasoning about it) before shipping: a fast response passes through untouched, a
  deliberately non-responding server gets cleanly aborted at exactly the configured timeout.
- Fixed: v390's live Run feedback would get permanently stuck on "Loading…" with a frozen
  elapsed-time readout if the phone was backgrounded (locked, or switched apps) for a while and
  then returned to — reported with a screen recording showing exactly that: an "117s so far"
  status that never moved for the whole clip. Root cause: iOS suspends a backgrounded tab's JS
  wholesale, so triggerWorkflow's watch loop and the loadWorkLog() fetch it was mid-flight on both
  just got abandoned — not slow, not erroring, simply never resumed. The actual GitHub Actions run
  is server-side and unaffected by any of this; only the client-side display was stuck. Rather than
  trying to make a background loop survive something iOS gives a web page no control over, added
  tkRefreshOnReturn(): fires one fresh loadWorkLog() the moment the tab becomes visible again while
  Task Automation is open (visibilitychange), plus a pageshow listener for the back-forward-cache
  restore case visibilitychange can miss on iOS Safari. Coming back to the app is now itself what
  un-sticks the display, rather than depending on whatever was running before you left.
- Task Automation: Run now gives live feedback while a batch is actually processing, instead of
  going quiet until you tap Refresh yourself. Two separate problems, both fixed: (1) triggerWorkflow()
  only ever showed the GitHub Actions job's own step name (Checkout, Install ffmpeg, "Run
  orchestrator"...) — and every task in a batch runs inside that SAME one step, from GitHub's point
  of view, so it never changed no matter how many tasks actually finished; (2) triggerWorkflow()'s
  watch loop only polled for ~60s by default (fine for the quick, fixed-length Resize/Convert
  workflows it was built for), then went silent even though a real orchestrator batch can easily
  run for several minutes — after that, the single loadWorkLog() call right after it returned was
  the only refresh you'd ever get, and anything that finished later needed a manual Refresh tap to
  see. Fixed both: triggerWorkflow() now takes an optional onPoll callback, called on the same ~3s
  cadence it already polls the run's own status at; the Run button passes loadWorkLog itself, so
  the task list's real counts and rows (Running ticking down, items landing in Review/Done) update
  live while the run is in flight, not just once at the very end. And the watch window is no
  longer a flat 60s for this button specifically — budgeted per requested task count (roughly 40s/
  task + 30s startup, capped at 30 minutes) so it keeps watching for as long as the batch could
  plausibly still be running, rather than giving up long before typical batches finish. Resize/
  Convert's own two triggerWorkflow() calls are untouched — still the ~60s default, no onPoll,
  since those really do finish in seconds and don't need either change.
- scripts/orchestrator.mjs: Running tab now shows the whole batch you asked for and counts down
  as each task finishes, instead of only ever showing whichever single task happens to be
  executing at that instant. Previously a task flipped to in_progress one at a time, right before
  its own turn — so "Run 10" only ever showed 1 in Running, never 10. Now the whole batch is
  claimed (flipped to in_progress) and committed in ONE shot before the loop starts processing
  any of them; the loop itself still runs strictly serially, exactly as before — this only changes
  WHEN each task's in_progress status becomes visible, not how the work is scheduled. If a task
  defers partway through (rate limit/budget), every task after it that hasn't been reached yet is
  un-claimed back to queued rather than sitting stuck at in_progress. A task whose type has no
  registered handler still always errors immediately, deferred or not, same as before. index.html
  itself needed no changes for this — Queued/Running already just filter on live task status (see
  tkStatusFiltered()); fixed a stale comment nearby claiming Queued includes in_progress, which
  hasn't been true since Queued and Running became separate chips.
- Fixed: the whole app was stuck on "Loading timeline…" forever — my own bug, introduced when the
  type-filter popup (#tkTypeModal) was added. Its markup was placed at the very end of the body,
  after the script's own closing tag, following #reportModal's lead. But #tkTypeModal's JS wiring
  (document.getElementById('tkTypeModalClose').addEventListener(...) etc.) runs early in the
  script, near tkRows() — long before the browser had parsed that far-down markup into the DOM.
  getElementById returned null, .addEventListener on null threw, and that uncaught error aborted
  the rest of the script's top-level execution, including everything below it that fetches
  data.json and replaces the loading placeholder — so NOTHING after that point ever ran, not just
  Task Automation. Fixed by moving #tkTypeModal's markup up next to #mgmtExitModal, before the
  script tag, so it already exists in the DOM by the time its listeners attach. (#reportModal and
  #disclaimerGate sit in the same after-the-script spot and their own wiring has the identical
  problem, but that wiring runs at the very end of the script, after everything else — not
  touched here, since it isn't what broke the timeline and wasn't part of this ask.)
- Task Automation: new "Auto-approve split sentences" checkbox on Task List, directly under
  Refresh/Run (Tom's ask — the choice belongs right where a run is started, not in a settings
  screen). Remembered on this device (localStorage tk-auto-approve-sentence-reword). When checked,
  any task that reaches status 'proposed' with type 'sentence-reword' gets resolved the moment the
  app learns about it — reusing wlResolveTasks() exactly as tapping Approve on that one item
  already did, same patch application via wlApplyTaskToDb/applyOnePatch, same actual outcome
  (task flips to 'approved', workLog.json saves to GitHub right away, the content change itself
  still waits for an explicit Publish same as manual approval always has — this skips the Review
  tap-through, not the publish step). New tkAutoApproveSentenceRewords(), called from the end of
  loadWorkLog() itself rather than only from the Run button's own click handler, so it also
  catches proposals already sitting there from an earlier or someone-else's run, not just ones
  from a run started in this exact session. Deliberately scoped to 'sentence-reword' only, by
  type, regardless of what Run's own service dropdown has selected — image-generate/finalize
  (picking a candidate) and arbitrate (an actual editorial debate) still always need a real look
  and are never auto-resolved by this checkbox.
- Task Automation: Task List now has a type filter alongside the existing All/Queued/Running/
  Review status chips. A pill at the right edge of the count row ("All types" at rest, the
  service name if exactly one is picked, or "N types") opens a popup listing every service
  registered in TK_SERVICES with a live count next to each — scoped to whichever status chip is
  currently active, so switching to Queued and reopening the popup shows queued-only counts, not
  the grand total. Any combination can be checked and Applied; it narrows the list ON TOP OF the
  status chip, not instead of it. New tkTypeFilter (a Set of type ids; empty = no restriction),
  tkStatusFiltered() split out of the old inline filter in tkRows() so the popup's own counts
  (tkTypeCounts()) stay independent of which types are currently checked — otherwise checking one
  type would zero out every other type's count in the same popup — tkTypeFilterIds() (TK_SERVICES'
  order first, then any stray task type not in TK_SERVICES), and the #tkTypeModal popup itself
  (new markup at body level, same reasoning #reportModal/#disclaimerGate already use: .taskPanel
  clips overflow, so a centered modal can't live inside it).
- scripts/orchestrator.mjs: workLog.json no longer grows without bound. Every run — including a
  no-op run that finds nothing queued — now prunes finished tasks (done/rejected/error only; NOT
  approved, NOT awaiting_review, both of which still need a human look) down to the 75 most-
  recently-updated, permanently deleting the rest with no archive (MAX_COMPLETED_KEPT,
  pruneCompletedTasks()). Also hand-applied this once to the live workLog.json itself (422 tasks
  \u2192 244) since the file had grown to ~1MB and was intermittently failing to load in-app with
  a JSON parse / "Unexpected EOF" error — almost certainly a fetch getting cut off mid-download on
  a mobile connection, which gets less likely to keep happening now that the file stays smaller.
- Fixed: opening ANY sentence-reword item in Review showed a blank, stuck panel — reported right
  after v384 shipped, but the bug itself predates that build and is unrelated to it (confirmed by
  diffing v384 against v383 — this line was already broken in v383). tkRenderSentenceRewordReview()
  referenced a variable named `preview` that was never declared anywhere in the function — it
  should have called tkPreviewSentencePatches(sections, patches) first and used that result, the
  way tkPreviewSentencePatches's own doc comment describes, but that call was missing entirely.
  The very first line of the function threw a ReferenceError, before the article ever got built,
  which is why the screen stayed blank rather than showing a broken article — nothing ever reached
  scroll.innerHTML. Likely shipped silently whenever tkRenderSentenceRewordReview and
  tkPreviewSentencePatches were first split into two functions and never actually exercised until
  today's batch of sentence-reword tasks got reviewed for the first time since. One-line fix: add
  the missing `const preview = tkPreviewSentencePatches(sections, patches);`.
- Approve lock bar's single "Record audio" checkbox is now a "Next step" dropdown (None / Record
  audio narration / Proofread article / Generate images, excluding whichever type is being
  approved), offered in the same two cases as before (a sentence-reword fix, or a task that just
  created a new entry with no audio yet). The choice is remembered per SOURCE task type
  (localStorage tk-next-step-choices, keyed by t.type) so the next time that same type comes up
  for Approve, the dropdown defaults to whatever was picked last time — e.g. picking "Proofread
  article" after a sentence-reword makes that the default for future sentence-reword approvals,
  not just "Record audio narration" forever. New TK_NEXT_STEP_CANDIDATES /
  tkLoadNextStepChoices() / tkSaveNextStepChoice() / tkQueueNextStepForEntity() (renamed and
  generalized from the old single-purpose tkQueueAudioForEntity()); tkResolveCurrent() now reads
  #tkOptNextStep's value instead of #tkOptAudio's checked state. Untouched: the per-sentence
  Arbitrate debate screen's own separate "Record audio" checkbox (tkArbAudioChk) — a different
  review flow this ask didn't touch.
- Not a code fix, a diagnosis: the "Record audio" batch picker jumping from year 65 straight to
  935 wasn't a sort bug — audioGeneratePool() already excludes any entry with an over-40-word
  sentence (entryHasLongSentence), and St. Simon the Zealot's article has five: 47, 56, 62, 63, and
  76 words. It's never been through a sentence-reword pass. The picker is correctly skipping to the
  next entry that's actually ready to record; the real fix is rewording Simon first.
- Fixed the floating audio-control pill (.audioBottomBar, z-index:151 — deliberately raised above
  the article/About panel a while back) rendering on top of the Task Automation panel, which sat
  at z-index:145. Task Automation is a full-screen, focused admin view; nothing should float over
  it. Bumped .taskPanel to 155 so it correctly hides the audio bar behind it instead.
- Fixed the actual root cause behind "couldn't find this exact wording" discussed a few versions
  back: this file's general-purpose stripHtml() replaces every tag with a SPACE, while the backend
  (arbitrate.mjs) removes <a>/<b>/<i>/<u> tags outright before the proposer ever reads the article
  — so a debated phrase touching a cross-reference link came out with an extra space here that the
  AI's own before/after text never had, breaking an otherwise word-for-word-correct match.
  New tkStripInlineTagsTracked() removes those same four tags the same way the backend does, while
  recording which raw-HTML index every kept plain-text character came from — that position map is
  what makes the rest of this possible. tkFindDebateSpan and tkRenderArbitrateArticle both switched
  to it (so display/highlighting and finding can never drift apart from each other), and
  tkApplyDebateText's article branch now splices into the real raw HTML using that same map
  instead of matching raw text directly.
- Tom's own proposed rule for the actual apply step, now built: any <a href="entry:...">LINKTEXT
  </a> inside the exact span being replaced gets re-wrapped around that same text in the new
  wording IF LINKTEXT survives verbatim in the proposed after-text; if the edit changed the linked
  words themselves, the link is simply allowed to go. Verified against the real St. Jude/James the
  Less example from his screenshot before shipping, not just reasoned through.
- The nav row (Prev/pills/Next) is now just as draggable as the thin grip bar for resizing the
  footer — Tom's ask, since the grip alone is a small target. Caught my own bug before shipping:
  my first pass tried to attach the drag listener directly to the nav row, but that row gets torn
  down and rebuilt on every render (it's part of #tkLockBar's own innerHTML), so the listener
  would've silently stopped working the moment a debate changed. Delegated through #tkLockBar
  itself instead, which stays stable across renders even though its contents don't — same fix
  shape as the swipe-navigation exclusion a few versions back. A touch starting on an actual
  button (the arrows, the proposer pill's details toggle) still isn't captured as a drag, same
  guard the grip itself already used.
- Two new public-facing features, neither gated behind Owner Tools — both for every visitor:
  - One-time disclaimer gate on first visit (localStorage-persisted, never shown again once
    dismissed): explains the site is under active review and points to "Report an issue."
  - "Report an issue" button at the end of every article (both the saint/event renderer and the
    Info/explainer-page renderer) opens an in-app form — message + optional reply email — that
    sends straight to Tom via Web3Forms, a form-to-email relay for static sites with no backend.
    No mailto:, no leaving the app. Requires a real Web3Forms access key in WEB3FORMS_KEY (still
    a placeholder — sign up free at web3forms.com, no password needed, and send the key over to
    have it baked in) before submissions will actually deliver; the button and form work and fail
    gracefully with a clear message either way.
- The version number in the header (visible next to "Timeline" in the title) was showing to every
  visitor, not just Tom — a plain developer detail with no reason to be public. Now hidden behind
  the same Owner Tools unlock as everything else in that group (updateManageVisibility), so it
  only ever shows on his own device once he's actually unlocked it.
- The "couldn't find this exact wording" warning only ever covered 'article'-kind debates — a
  Quick Facts or Quoted Sources debate whose text couldn't be located had no proactive warning at
  all, so pressing Approve just failed with an easy-to-miss message and nothing visibly happened.
  New tkDebateTextFound() unifies the check across all three kinds (facts/quotes checked the same
  way tkApplyDebateText itself will, before Approve is ever pressed) — the same warning box and
  auto-opened details panel article debates already get now cover facts/quotes debates too.
- Fixed the Details panel closing itself whenever the Proposed/Original pill was tapped. That
  pill fires through the same shared handler as tapping a highlighted sentence/card to jump focus
  to a different debate, which is meant to close a stale details panel — but the handler didn't
  distinguish "moved to a different debate" from "toggled the one already showing," so it closed
  the panel unconditionally either way. Now only resets it on an actual focus change.
- Removed swipe-down-to-close on the review view entirely. It only ever required being scrolled
  to the top when the drag started, which sounds narrow but wasn't in practice — starting a
  perfectly ordinary scroll from scrollTop 0, or just overshooting slightly while scrolling back
  up, kept closing the whole review out from under Tom. Horizontal swipe-between-tasks is
  unaffected. The X button in the header is the only way to close a review now.
- Likely root cause for "couldn't find this exact wording" firing intermittently: curly/smart
  quotes in the article's own typography vs. straight quotes in a model-generated `before` string
  (or vice versa) — an otherwise word-for-word-correct match failing over a single typographic
  character. tkNthIndexOf (the one function behind every before/after match — display AND the
  actual Approve/apply step) now normalizes curly quotes/apostrophes to straight ones on both
  sides before searching. Same-length substitution, so the index it returns still correctly
  locates the phrase in the real, unnormalized text. Doesn't touch the case where the article's
  own wording has genuinely changed since a task ran — that's a real "not found," still reported
  the same way.
- Fixed a real coordinate-drift bug in tkRenderArbitrateArticle explaining "sometimes bolds,
  sometimes doesn't": paragraph offsets were tracked by assuming every paragraph gap in the
  article is exactly two characters (offset += para.length + 2), while tkFindDebateSpan locates
  a debate's text by searching the same section's plain text directly. Any paragraph separated by
  something other than exactly "\n\n" silently pushed every offset after it out of sync with
  where the debate's span actually was, so the wrong sentence (or none) got the substitution —
  with the Proposed/Original pill still claiming to toggle something. Now locates each paragraph's
  true position directly in the same plain text tkFindDebateSpan searches (indexOf, not an
  assumed fixed width), so both stay in the same coordinate system by construction.
- This does not rule out a separate, backend-side possibility Tom raised: a proposal whose
  "after" text never actually differs from "before," which would show nothing to bold no matter
  how correctly this renders. The Details panel (tap the proposer's pill) shows Original/Proposed
  as plain text with no highlighting logic involved — worth checking there first if this recurs,
  since it tells the two cases apart.
- Fixed the real bug behind what looked like two separate reports (St. Clement I, then St. John
  the Apostle): an 'article' debate whose before-text can no longer be found verbatim in the
  section it names — the article moved since the task ran, or the model's own quoting drifted —
  used to fail completely silently. No highlight anywhere, no bold, the Proposed/Original toggle
  changing nothing, with zero indication anything was wrong. Now detected explicitly
  (tkFindDebateSpan already existed to locate the span; just needed its null case actually
  handled instead of just quietly rendering plain text) — shows a clear warning and auto-opens
  the Section/Original/Proposed details panel the very first time a broken debate is reached
  (still closeable, and won't re-force itself open if closed again on the same debate).
- Removed the standalone "Next →" line under Record audio entirely (added last version, now
  gone per Tom's follow-up) — the top-right arrow is the only Next control again.
- The proposer's own pill in the nav row (e.g. "OpenAI ✓") is now a tappable disclosure toggle:
  reveals a panel spelling out Section, sentence number, Original, and Proposed in plain text —
  the fallback for exactly the case Tom hit where the inline bolded diff shows nothing useful
  (the exact phrase couldn't be located in the current article, or a facts/quotes debate with a
  reasoning line that doesn't make the actual change obvious on its own). Resets closed whenever
  a different debate becomes current, however that happens (Prev/Next, or tapping a sentence/card
  elsewhere) — always describing whichever debate is actually on screen, never a stale one.
- Tightened the space between the grab bar and the nav row below it (8px top padding, was 14px).
- Found the actual source of the thin line under the resize grip: .tkArbLock never overrode the
  base .tkLockBar's own border-top, so that 1px grey line was rendering right at the seam between
  the grip and the footer beneath it the whole time. Explicitly turned it off for .tkArbLock.
- Grab bar itself: wider (60px, was 40px), thicker (6px, was 4px), and gold instead of grey.
- Arbitrate Review nav row: added a "1 of 3"-style debate counter in the gap between the Claude
  pill and the proposer/arbiter group (space-between naturally centers it with three children).
- Record audio and Next now share one row instead of stacking on two lines — the standalone
  "Next →" line is gone, folded into the end of the same line as the checkbox.
- Fixed two tangled issues Tom flagged from a screenshot: the generic "N of M · swipe left/right"
  hint every review screen gets is now suppressed specifically for Arbitrate Review — it was
  counting position across ALL queued review tasks (unrelated to this debate) and, sitting right
  after a Quick Facts card, looked like it was explaining that card's change when it wasn't. And
  it wasn't, because that was the real bug: Quick Facts/Quoted Sources debate cards never actually
  showed their before/after diff at all, just a bare label — they now get the same word-bolded
  diff treatment the article's sentences already have, toggleable the same way.
- Fixed swipe-to-close/swipe-between-tasks firing while interacting with the footer, most
  noticeably while trying to select text or move the cursor in the Arbitrate Review Edit box. The
  gesture listener was bound across the whole review view including the footer; it now ignores
  any touch that starts inside #tkLockBar entirely. Plain taps on the footer's own buttons/
  checkbox were never affected by this bug either way (no drag, no false-triggered swipe) and
  aren't affected by the fix.
- Arbitrate Review: tkArbitrateModelLabel now returns company names — "OpenAI" (was "Luna"),
  "Google" (was "Gemini") — everywhere it's used (the nav row's pills, the reasoning line's pill,
  the comment line's pill). One function, so this was the only edit needed. Left "Claude" as-is —
  it's naming the article's original author there, not standing in for "Anthropic" the way the
  other two now stand in for their companies, and didn't seem like the same kind of label. Say
  the word if that should change too.
- Arbitrate Review, third refinement pass:
  - Prev/Next arrows: bigger (46px, was 38px) and always full gold — the disabled attribute still
    blocks the tap at either end, it just no longer dims.
  - Proposed/Original toggle pill: white text now (was navy), same gold background either way.
  - Footer restructured into three regions so scrolling the reasoning/comment text never carries
    the nav row or the checkbox/buttons away with it: .tkArbNavSticky (Prev/pills/Next) and
    .tkArbBottomSticky (Record audio + buttons) are fixed in place via flex, only
    .tkArbScrollMid between them scrolls. .tkLockBar.tkArbLock itself is now a flex column with
    no padding of its own — the three regions each carry their own instead.
  - Added a plain-text "Next →" link right after the Record audio checkbox, doing the same thing
    as the top-right arrow — reachable without reaching back up to the nav row.
  - Resize grip: no more distinct strip color or border — it's the same tan as the footer beneath
    it now, so only the short grey bar itself reads as "drag here."
  - The word-level diff is now bolded (tkWordDiffBold: trims the longest common leading/trailing
    word-runs between before/after, bolding only what's actually different) — everything else in
    the sentence, before and after the change, stays normal weight. Replaces the flat pale-yellow/
    grey highlighting removed last version with something that still shows exactly what changed.
  - Removed the section-name line from the debate detail (redundant with the glow bar showing
    which sentence is under discussion). Added a proposer pill next to the reasoning line, same
    treatment the arbiter's pill already had next to their comment.
  - Edit box: now a flexible textarea filling whatever space the resizable footer gives it (drag
    the grip for more room to type) instead of a fixed small height, at the same 17px story-
    matching font. Prefills with whichever version is currently showing — tap Proposed, then Edit,
    edits the fix in place rather than starting over from Claude's original (tkDebateShownText,
    non-mutating sibling of the existing tkApplyDebateText).
- Settings: removed the redundant hamburger-menu Task : Automation row (a bottom-bar entry point
  already exists) and its now-dead click listener.
- Arbitrate Review, second refinement pass:
  - The pale-yellow/grey paragraph highlighting is gone entirely — replaced by a fixed, glowing
    gold bar flush with the true left edge of the screen (tkDebateGlowBar/tkUpdateDebateGlowBar),
    spanning the full height of whichever sentence or card is current, clamped to the visible
    scroll area and hidden once it scrolls out of view. Recalculated on every render, on scroll,
    and continuously while the new resize grip (below) is being dragged.
  - Proposed/Original toggle pill: same gold color for both states now, distinguished only by
    the word.
  - Header: the saint's name is now black, smaller (19px, was matching the year's 28px), and
    ellipsis-truncates rather than wrapping if it's ever too long for one line; top padding
    tightened, scoped to Arbitrate Review only (.tkArbSticky) so sentence-reword's own sticky
    header, which shares the base class, is unaffected.
  - The footer pane is now resizable: a thin drag handle (#tkResizeGrip) between the article and
    the footer lets the boundary move up/down, clamped so neither pane can be crushed to nothing,
    with the chosen height persisted (localStorage) so it stays put across sessions. The footer
    itself now scrolls its own content once it's taller than the height set. Scoped entirely to
    Arbitrate Review (the grip only activates, and the lock bar only gets a fixed height/scroll,
    when that screen is showing) — every other review screen's auto-height footer is unchanged.
  - Removed the "Replaces the recording this change invalidates" note under the Record audio
    checkbox.
- Settings menu: removed the Task : Automation row — Tom has a separate way in (the bottom-bar
  entry point already promoted for this in an earlier version), so it was a redundant second path.
- Arbitrate Review, full redesign pass based on real usage:
  - Header: year and name share one line at matching size (both use .tkRvYearBig); the small
    "N debates open / tap to preview" note line is gone entirely.
  - A Proposed/Original pill now sits top-right of the header — pale yellow for Proposed (the
    default), plain grey for Original — doubling as a toggle for whichever debate is current
    (shares the existing tap handling highlighted sentences and side cards already used).
  - The view now auto-scrolls to the current debate's sentence on open, on Prev/Next, and on any
    tap that changes which debate is current (tkScrollToCurrentDebate) — no more hunting through
    a long article to find what's being discussed.
  - Story text bumped from 14px to 17px, scoped to this screen only (.tkArbSections .tkPara)
    so sentence-reword's own review, which shares the base .tkPara/.tkSentSections classes, is
    unaffected.
  - Prev/Next are gold circles with white arrows; the Claude/proposer/arbiter pills sit directly
    between them (no "vs", no "Debate N of M" text) — Claude alone on the left, the proposer
    (checkmark — it always won arbitration by construction) and the arbiter grouped tight on the
    right, since the arbiter's ruling always sides with whichever proposal is shown here. All
    three pills are the same dark-navy/white styling now — no more gold "winner" highlight, since
    the position and checkmark already say who won.
  - Below that: the section name alone (no sentence number — the highlighted sentence above
    already shows which one), then the reasoning by itself (the old struck-through before/→after
    text block is gone — illegible per Tom, and redundant with the article's own highlighting),
    then, only if the arbiter left one, a pill with their name and their comment. All three lines
    read at the story's own size/color/font now, not the smaller grey metadata treatment other
    review screens use.
  - The whole footer got a warmer, higher-contrast background (#E4E1D2) instead of the barely-
    different-from-white default, applied/cleared via a class so it never leaks into other
    screens' footers.
  - Severity/category and the source citation are no longer shown in this footer — simplification
    per this pass; easy to reintroduce if they're missed in practice.
- Task List: swipe left on a row to reveal a red Delete button, standard iOS list pattern (tap
  elsewhere, or the row itself, to dismiss without deleting). One row open at a time; deleting
  removes the task from workLog.json entirely (a real cancel for a queued task, just clutter
  removal for anything finished) with no confirmation dialog \u2014 the swipe-then-tap already is
  the confirmation. New tkDeleteTask()/tkCloseSwipedRow(), touch handlers on #tkList mirroring
  the axis-lock pattern the review view's own swipe already used, and .tkRowWrap/.tkRowDeleteBtn
  CSS. Also fixed a real bug this surfaced in saveWorkLog(): its merge-on-conflict logic could
  only overlay a touched id's content onto the remote copy, never remove one, so a deleted task
  would silently reappear if a remote merge happened to trigger (e.g. an orchestrator commit
  landing in between) \u2014 saveWorkLog now takes an optional third deletedIds argument, stripped
  from the merged result explicitly. Every existing call site is unaffected (all pass exactly two
  arguments; the new one defaults to empty).
- Removed the retired standalone proofread service's now-dead code, rather than leaving it dormant
  as v362 did: proofreadPool(), its tkBatchPool() dispatch line, the Proofread Review title case,
  isProofreadReview, its render-body branch, its lock-bar branch, and tkResolveProofread() are all
  gone. Also caught a leftover TK_BATCH_OVERWRITE_LABEL['proofread'] entry v362's cleanup missed.
  scripts/services/proofread.mjs is deleted from the repo entirely (separate file, not shown in
  this diff); scripts/services/proofreader-skill.md is renamed to arbitrate-factcheck-skill.md
  and its header rewritten, since arbitrate.mjs still reads it as the shared base fact-check
  methodology for whichever model is proposing — nothing about its content changed otherwise.
- Collapsed Add Task's Proofread/Arbitrate split back into one option: "Proofread articles" now
  queues an 'arbitrate' task directly \u2014 the full OpenAI/Gemini debate always runs, nothing
  separate to pick. The plain single-model 'proofread' task type, its pool function, and its
  review screen are unchanged in the code but no longer reachable from Add Task (no dropdown
  option creates one anymore) \u2014 left in place rather than ripped out, since nothing depends on
  removing them and there's no behavior difference either way.
- Arbitrate Review screen, for the new "arbitrate" service (scripts/services/arbitrate.mjs,
  separate files, not shown in this diff). Whole article rendered with any debated sentence
  highlighted pale yellow (tkDebateSent) showing the arbitrated revision by default; tapping it
  (or a Quick Facts/Quoted Sources debate card, rendered separately since those aren't running
  prose to highlight within) previews the original in grey and focuses that debate in the sticky
  footer. Footer: Prev/Next through open debates, "Claude vs {proposer} \u2713" model badges with
  "{arbiter} ruled" credit (tkArbitrateModelLabel), the concern and any arbitrator comment, and
  Approve (applies the fix, purges stale audio, publishes, optional "Record audio" checkbox
  defaulted checked \u2014 queues via the existing tkQueueQuickTask) / Override (keeps Claude's
  original, no content change) / Edit (plain textarea, saved verbatim, no text-matching \u2014
  works even if the proposal's exact wording can no longer be found). A task finishes at 'done'
  once every debate on it is resolved, same as every other review screen. Added to the Add Task
  service dropdown and its own batch pool (arbitratePool(), same entry.qc.proofread signal
  proofreadPool() already reads, since both services write that same field).
- New service: proofread. Sends an entity's article (sections, quotes, Quick Facts) to OpenAI
  for a factual/theological/editorial QC pass — see scripts/services/proofread.mjs and
  proofreader-skill.md (new files, not shown in this diff). Added to the Add Task service
  dropdown (TK_SERVICES), its own batch pool (proofreadPool(), keyed off entry.qc.proofread
  rather than task history), a Proofread Review screen (numbered findings, reusing existing
  tkRvName/tkRvMeta/tkRvHead/tkNote styling — no new CSS needed), and a plain "Mark reviewed"
  lock-bar action (tkResolveProofread) since there's nothing to accept/reject, only to
  acknowledge. A clean PASS never reaches this screen at all — it finishes straight at 'done',
  same as sentence-reword's "nothing found" case; only a task with an actual finding opens for
  review. Needs the corresponding orchestrator.mjs registration (separate file) to actually run.
- Add Task's Start year/feast field only updated tkBatchStartIdx on 'change', which fires on
  blur — typing a year (e.g. 420) and tapping Add Task without first tapping away left the field
  showing 420 while the batch was silently still queuing from "earliest eligible" (year/feast
  0). Now also bound to 'input', so the position updates live as you type and no blur is needed.
  The old inline anonymous change handler is now the named tkApplyBatchStartValue(), bound to
  both events.
- Review Mode: new Generate Images / Record Audio quick-queue buttons on the article view, next
  to (independent of) the existing Approve/Delete bar — shown whenever Review Mode + Manage are
  unlocked for any entry with article text, not just one awaiting approval. One tap queues a
  task straight into workLog.json the same way the Task Automation panel's batch Add Task does,
  without leaving the article. Each button disables itself, with a title tooltip explaining why,
  when that entity already has a pending task of that type; Record Audio also disables when no
  Voice ID is set or the entry still has an unresolved 40+ word sentence (same gate
  audioGeneratePool() uses). New tkQueueQuickTask().

v358 CHANGES (unchanged from the version this build started from):
- A recorded-audio task that lands on "done" instead of the proper awaiting_review (most likely
  cause: an older, pre-review-gate audio-generate.mjs is what's actually deployed — see chat)
  used to open into a dead end: the article text with no audio player anywhere, no way to hear
  the recording without leaving the app for the live site. That fallback review branch now shows
  a player whenever the entry actually has audio, regardless of why the task didn't go through
  the normal review path — a straightforward defensive fix, independent of the root cause.

v357 CHANGES (unchanged from the version this build started from):
- Root-caused a real confusion: watching the orchestrator run live on GitHub showed it processing
  St. Hildegard when the Task List appeared to show St. Jerome "first." Traced to two unrelated
  orderings colliding — the orchestrator processes queued tasks strictly by array position
  (whatever order they physically sit in workLog.tasks), while the Task List sorts by date,
  newest first. Retrying a failed task flips its status back to queued in place without moving
  it, so an old task retried minutes ago still runs before one queued fresh yesterday — with no
  visual signal that these two orders could ever diverge.
- Queued and Running split into separate filter chips — in_progress tasks used to be invisible,
  lumped into the same "Queued" bucket as ones that hadn't started.
- The Queued view no longer sorts by date at all — it now shows true array/processing order, so
  "top of Queued" actually means "runs next," matching what the orchestrator will really do
  instead of what looked most recently added.
- New "Up next" line above the task list, driven by the current Run count/service selection —
  shows exactly which entities a Run right now would process, in real order, before you even
  press the button. New tkUpdateUpNext(), refreshed on every list render and on every count/
  service change.
- scripts/orchestrator.mjs (this file unchanged this version — logged here since the changelog is
  the unified record) and orchestrator.yml: workLog.json now commits twice per task — once the
  moment it flips to in_progress (before the handler even runs), once after its outcome is known
  — instead of once at the very end of the whole run. This is what makes any of the above
  meaningful on a live run: previously nothing in workLog.json changed until the entire batch
  finished, so refreshing mid-run showed nothing different no matter how good the UI got. New
  commitWorkLog() in orchestrator.mjs, mirroring commitFiles()' own git safety pattern but
  best-effort rather than fatal — a failed push here costs one visibility update, not the task's
  actual result, and orchestrator.yml's trailing commit step remains the final safety net.
  Traded-off cost, flagged plainly: meaningfully more git commits per run (up to 2\u00d7 the task
  count, on top of whatever content commits already happen) — worth it for a real run, but not
  free.

v356 CHANGES (unchanged from the version this build started from):
- triggerWorkflow() now shows live step-by-step status while a run is in progress — Checkout,
  Install ffmpeg, Run orchestrator, etc., each with its own \u2713/\u2717/\u23f3/\u00b7. This is
  genuinely real: GitHub's Jobs API returns live per-step status while a run is still going. Full
  log TEXT is NOT available the same way — confirmed via GitHub's own API docs and a long-standing
  community-reported issue that the logs endpoint 404s for the entire duration a job is running —
  so that's deliberately not attempted here; this shows structure (which step, what state), not
  console output. New tkFetchStepsSummary()/tkStepIcon(), tested against every real step state
  before shipping. Applies to every workflow this app triggers, not just the orchestrator, since
  triggerWorkflow() is shared by all of them.

v355 CHANGES (unchanged from the version this build started from):
- Fixed the floating system transport control (iOS's Now Playing widget) persisting over the
  Approve/Reject buttons after leaving an audio review. It tracks the <audio> element itself, not
  this app's view state — once it's played, replacing the element's HTML or navigating away
  doesn't make the OS drop it; only explicitly pausing, clearing src, and calling load() actually
  releases it. New tkStopAudioPlayer(), called before any review re-render and on every way out
  of one (tkGoList, closeTaskPanel).

v354 CHANGES (unchanged from the version this build started from):
- scripts/services/sentence-reword.mjs (this file unchanged this version — logged here since the
  changelog is the unified record): GPT-5.6 Luna's reasoning.effort dropped from 'low' to 'none'.
  A real failure on St. Francis of Assisi showed only 194 output characters against a full
  2000-token budget — far too little visible text to exhaust a budget that size on its own,
  meaning reasoning tokens (sharing the same budget) were eating most of it even at 'low'. 'none'
  removes that variable entirely rather than guessing at a still-nonzero effort level. Verified
  the request now actually sends reasoning.effort: 'none' before shipping.

v353 CHANGES (unchanged from the version this build started from):
- Sentence-reword can now run on GPT-5.6 Luna (OpenAI) instead of Claude, chosen per batch —
  scripts/services/sentence-reword.mjs (this file unchanged this version — logged here since the
  changelog is the unified record) refactored its single Claude-only call into a provider
  abstraction (new PROVIDERS map: Anthropic Messages API + OpenAI's current Responses API), with
  one shared retry/token-escalation loop neither provider needs to know about. Luna's own
  reasoning.effort is set explicitly to 'low' rather than left at its 'medium' default — it's a
  reasoning model whose reasoning tokens share the same output budget as the visible answer, and
  a mechanical rewording task has no real use for deep reasoning; leaving it at default risked
  rediscovering the exact max_tokens exhaustion just found and fixed on the Claude side, for a
  different reason. Requires a new OPENAI_API_KEY secret (orchestrator.yml now passes it through)
  — distinct from IMAGEGEN_API_KEY, matching content-pipeline-vision.md's own established naming
  (IMAGEGEN_API_KEY for images, OPENAI_API_KEY for text). Verified against both providers with
  mocked responses before shipping — correct endpoint, correct model, correct reasoning settings,
  both producing patches correctly.
- New Model picker on Add Task, shown only for "Reword long sentences" — remembered across
  sessions (joins the existing persisted Add Task fields). The provider that actually produced a
  given batch of fixes now shows in that review's own header, so two batches run on different
  models stay identifiable while comparing results.
- Fixed a latent gap found while wiring this: this app has no generic `.hidden{display:none}`
  rule — every hidden-toggleable element needs its own explicit selector — and the Overwrite
  checkbox row's hidden state never had one. Never surfaced before now since every batch type
  built so far has overwrite enabled, so it was never actually exercised in the hidden direction.
  Fixed alongside the new Model row's own selector.

v352 CHANGES (unchanged from the version this build started from):
- scripts/services/sentence-reword.mjs (unchanged this version — logged here since the changelog
  is the unified record): a max_tokens failure only ever recorded THAT it happened, never what
  Claude was actually generating when it got cut off — v351's budget escalation fixed the wasted-
  retry symptom but left the underlying "why does a ~150-word task ever need 700+ tokens" an open
  question. Now captures the actual content: a new looksRepetitive() heuristic flags the classic
  LLM degenerate-repetition failure (the same chunk of text repeating), and the error message
  includes the last 200 characters of what was actually generated, so the next real occurrence is
  visible instead of guessed at. Verified against a simulated repetition loop — correctly flagged,
  and the captured tail visibly shows the repeating phrase.

v351 CHANGES (unchanged from the version this build started from):
- Fixed the actual cause of St. Cyprian's 3 failures, now that the error-surfacing fix from
  v349 made it possible to see it at all: every one was stop_reason max_tokens, meaning the
  700-token budget was too small for that particular rewording, and all 3 retries used the exact
  same budget — a deterministic failure retried three times with zero chance of a different
  result, each one a real, billed generation. scripts/services/sentence-reword.mjs (unchanged
  this version — logged here since the changelog is the unified record) now escalates the budget
  per attempt (700 \u2192 1200 \u2192 2000, new TOKEN_BUDGETS) instead of repeating it. Verified
  against a mock where a 700-token budget truncates and a 1200-token retry succeeds — confirms
  the fix actually resolves this failure mode rather than just describing it better.

v350 CHANGES (unchanged from the version this build started from):
- Sentence-reword no longer blanket-skips an entire paragraph just because it contains a
  cross-reference link (scripts/services/sentence-reword.mjs, this file unchanged this version —
  logged here since the changelog is the unified record). That old rule gave up on every long
  sentence in a linked paragraph even when the link and the long sentence were entirely different
  sentences. Now: a sentence containing a link is still attempted, with the exact link(s) it must
  preserve spelled out in the prompt (buildPrompt's new links parameter); the reply is checked
  afterward (new extractEntryLinks/linksPreserved) to confirm every link survived character for
  character before the fix is accepted. If even one didn't, the sentence is left untouched — same
  outcome the old skip gave, just reached after actually trying instead of never attempting it.
  Tracked tags (hasBalancedTags) now include <a>, so a split that tears an anchor tag in half is
  still caught the same fail-safe way as before. Renamed result field skippedEntryLink →
  linkNotPreserved to match what it now actually measures; review note wording updated to match.
  Verified against a mocked run with one link preserved correctly, one dropped, and one plain
  sentence before shipping — 2 of 3 recovered instead of the old blanket 1 of 3.

v349 CHANGES (unchanged from the version this build started from):
- Fixed a real gap in scripts/services/sentence-reword.mjs (this file itself unchanged this
  version — logged here since the changelog is the unified record): a failed reword call was
  counted but its actual error message was thrown away, leaving "a repeated API error" as the
  only thing visible anywhere — not even in the Action's own run log. Now logs every failure via
  console.error and keeps the first 3 actual messages (apiErrorSamples), shown directly in the
  review screen's own note instead of a bare count.
- Added a 400ms gap between consecutive sentence-reword API calls (not just the existing retry
  backoff within one sentence's own attempts) — a likely cause of a high failure rate on an
  article with many long sentences: calls fired back-to-back with zero spacing can cascade into
  repeated rate-limit failures if the account's per-minute limit is still open on the next
  sentence, which 3 retries with a short backoff doesn't reliably clear.

v348 CHANGES (unchanged from the version this build started from):
- Audio recording is now review-gated instead of direct-commit. scripts/services/audio-generate.mjs
  still writes and commits the audio+timing files (so they exist and can be listened to) but no
  longer touches entry.audio/entry.audioTiming or commits data.json — the task now finishes
  awaiting_review instead of done, same three-way status split image-generate/image-finalize
  already use. Article text and images stay fully live throughout; only the audio itself waits.
- New audio review screen: a native player plus a sentence-highlighting display — every cue
  (heading and sentence) from the take's own result.cues rendered as its own span, highlighted in
  sync with playback via timeupdate, tap any sentence to seek there directly. This is a review-
  scoped parallel to the public article view's own wireSentenceCues()/light-bar system (not a
  shared instance of it — that one's tightly bound to the main article view's specific DOM and
  auto-scroll, which doesn't apply to a separate overlay never open at the same time), driven
  directly off the task's own result rather than a separately-fetched timing.json. New
  tkCueIndexForTime/tkSetActiveCue/tkRenderAudioReviewArticle, tested against mock cue data before
  shipping. Player source uses rawAssetUrl() (raw.githubusercontent.com) rather than the deployed
  site, so there's no GitHub Pages deploy-lag wait before a just-generated take can be reviewed.
- Approve (tkResolveAudio) sets entry.audio/entry.audioTiming and publishes — same pattern
  tkResolveFinal already uses for entry.img. Reject deletes the rejected take's two files via
  ghDeleteFile (the same helper sentence-reword's own audio-purge uses) rather than leaving them
  as orphaned dead weight in the repo, since nothing in data.json ever pointed at them.
- Panel title for an awaiting_review task now reads "Audio Review" specifically for audio-generate
  instead of the previously-hardcoded "Picture Review", which was only ever accurate when
  image-generate was the sole service that reached this status.

v347 CHANGES (unchanged from the version this build started from):
- Add Task's own selector state (Service, Category, Order by, Quantity, Overwrite) now remembered
  across sessions, same pattern as the GitHub token / audio settings — new tkAddFormFields via
  prefillTkAddForm()/saveTkAddFormSettings(), localStorage key tk-add-form-settings. Deliberately
  excludes the typed Start year/feast value itself: pool composition shifts as tasks get approved,
  so a remembered position would go stale fast — Start always resets to "earliest eligible."

v346 CHANGES (unchanged from the version this build started from):
- Audio recording brought into Task Automation as a real orchestrator service, replacing the
  separate "Record Audio Narration" batch form that triggered generate-audio.yml directly outside
  workLog.json. New scripts/services/audio-generate.mjs, a port of the standalone
  scripts/generate-audio.mjs into the one-task-per-entity handler pattern (ElevenLabs timestamped
  TTS per section, ffmpeg silence-gap + concat, cue-building, nextVersion() file naming — all
  carried over) — registered in orchestrator.mjs's SERVICE_HANDLERS. orchestrator.yml now installs
  ffmpeg unconditionally and passes through ELEVENLABS_API_KEY. Not ported: audio-log.csv (this
  follows every other service's convention of reporting through task.result/summary in the app
  itself, not a separate file nothing else reads). Also not ported, deliberately left standalone
  and unchanged: "List ElevenLabs Voices & Models" (a one-off lookup, no entity/review concept)
  and "Repair Audio Timing Gaps" (a maintenance tool for old timing files) — neither fits the
  per-entity task model this service implements.
- New audioGeneratePool() (index.html) — genuinely new selection this app didn't have before:
  entries with article text, nothing left over 40 words (entryHasLongSentence, same check
  sentenceRewordPool uses), and no audio yet unless "Regenerate even entries that already have
  audio" is checked. Registered as a batch service (Category/Start/Quantity, same picker as
  every other) — audio-generate joins TK_SERVICES/TK_BATCH_TYPES/TK_BATCH_HAS_OVERWRITE/
  TK_BATCH_OVERWRITE_LABEL.
- Voice & pacing settings fields (Import tab) now travel with each task instead of being read
  from env vars — new tkAudioPayload() captures them into task.payload at Add Task time, since a
  generic orchestrator run has no per-service custom inputs the old dedicated workflow_dispatch
  form had. The settings card itself is slimmed to just those fields (Voice ID through Narrate
  Headings) — the old category/count/start-year-or-feast picker, its preview, and the "Record
  Audio" button are gone, superseded by Task Automation's own Add Task. feastSortKeyOf() (the
  Saint feast-day sort helper this card's old picker also used) is preserved and now shared by
  sentenceRewordPool/audioGeneratePool. Settings now save on every change (same fix pattern as
  the GitHub token) rather than only on the old button's click, which no longer exists.
- Approve & Record: the "Record audio" checkbox on a proposed task's Approve screen — previously
  shown disabled with "not wired up yet" — is now live. Broadened beyond its original
  entryCreated-only case to also cover sentence-reword specifically: approving a reword always
  clears the entity's existing audio (see wlApplyTaskToDb), so this offers to queue a fresh
  recording right there, defaulting to checked since that's meant to be the routine path, not an
  occasional opt-in. New tkQueueAudioForEntity(), called from tkResolveCurrent() when checked.
  Requires a Voice ID configured first — shown disabled with that reason otherwise.
- New sync hook: Task List's Run button now also calls syncAudioStatusFromGitHub() after a run
  finishes, since audio-generate commits directly (no client-side apply step the way sentence-
  reword/image review have) and this session's db.entries had no other way to learn a run just
  recorded new narration.
- Not yet built: the ElevenLabs pronunciation-dictionary workflow (flag a mispronunciation, build
  a phrase-scoped rule, push to ElevenLabs, mirror in a repo file) — this was only ever designed
  in conversation, never implemented; still pending, deliberately out of scope for this pass.

v345 CHANGES (unchanged from the version this build started from):
- Sentence-reword: fixed a real bug in scripts/services/sentence-reword.mjs (this file itself is
  unchanged this version — logged here since the changelog is the unified record across both) —
  a reworded sentence could come back truncated mid-thought ("Pope Gelasius I, writing in" with
  nothing after it) and get spliced into the article as if it were a finished replacement.
  rewordSentence() never checked whether the API's response had actually finished. Now checks
  two things: the API's own stop_reason === 'max_tokens' (the direct, mechanical signal a length
  cap was hit — confirmed this really is a token-budget issue, not Claude producing bad content)
  and a new looksComplete() backstop (does the text end in real sentence-ending punctuation),
  which would catch an incomplete reply regardless of cause. Either one now retries with the same
  budget rather than accepting the fragment; max_tokens also raised 500 \u2192 700 for headroom.
  Verified against three mocked failure scenarios plus the normal path before shipping.

v344 CHANGES (unchanged from the version this build started from):
- Sentence-reword: found a second, likely bigger source of "long sentences that just never got
  touched" than the API-retry gap fixed last version — a paragraph containing an entry: cross-
  reference link is (correctly, per spec) never reworded at all, but scripts/services/
  sentence-reword.mjs previously skipped it with zero record, indistinguishable from "this
  paragraph never had a long sentence in the first place." New skippedEntryLink counter: still
  never touches a linked paragraph, but now checks (without fixing) whether it actually contained
  an over-length sentence, and reports the count in the parent scan task's summary, the child
  review task's own result, and a new note in the review screen itself (same place the apiErrors
  note from last version shows, both able to appear together). Old tasks predate this field and
  won't show the note, correctly — nothing new to report for them.

v343 CHANGES (unchanged from the version this build started from):
- Approve/Reject buttons (and the lock bar around them) taller, more padding — scoped to
  .tkLockBtns specifically so Add Task's own buttons elsewhere are untouched.
- Sentence-reword: scripts/services/sentence-reword.mjs's rewordSentence() now retries a
  transient failure (5xx, 429, or a network error) up to twice with backoff before giving up,
  instead of silently skipping that one sentence on the first hiccup. On a long article
  processing a dozen-plus sentences sequentially, one bad call was likely on any given run — this
  is almost certainly why a clearly over-length sentence was sitting unfixed while others nearby
  got caught. Does not retry a plain 4xx (bad request, bad key), since that would just fail the
  same way three times. Any sentence that still fails after retries now also surfaces directly in
  the review screen itself (new apiErrors/skippedTagMismatch on the child task's own result,
  threaded through tkRenderSentenceRewordReview's new third argument) rather than only in the
  parent scan task's summary — a red note under the fixed-count line saying how many, and that
  rejecting and requeuing will retry them. Old tasks predate these result fields and simply won't
  show the note, which is correct — there's nothing new to report for them.

v342 CHANGES (unchanged from the version this build started from):
- Task List's single "Task" column split into two: Task (which service — "Reword long
  sentences", "Finalize images", "Age backfill" — fixed width, ellipses if it doesn't fit, plain
  non-sortable header) and Entry (which saint/entry, if any — the old column's flexible width and
  what "sort by name" now actually sorts). Previously one blended column mixed entry names
  ("St. Andrew") with descriptions that happened to have an entry name baked in ("Finalize image
  for St. John Chrysostom"), which read inconsistently and couldn't be sorted by either piece
  cleanly. New tkServiceLabel()/tkEntryName() helpers; tkTaskName() (the review screen's own
  fallback header) is unchanged. A scan task with no entry (age-backfill-scan run manually) shows
  an em dash in the Entry column rather than a blank cell or its own id.

v341 CHANGES (unchanged from the version this build started from):
- Sentence-reword review, three refinements from real usage:
  - Fixed: a multi-sentence replacement from one patch rendered as one solid block of yellow
    instead of alternating shade by shade — the shade was keyed to patchIndex, not sentence
    position. Now driven by the same single running counter as the grey alternation, so yellow
    alternates sentence-to-sentence exactly like the surrounding unchanged prose does, patch
    boundaries or not.
  - Corrected/Original toggle changed from per-section to one shared state for the whole
    article: tapping any section's button now flips every section together (via
    #tkSentSections' own data-mode) and relabels every button to say what's currently showing
    ("Corrected" / "Original") rather than what tapping would do. CSS scoped to .tkSentHasFix
    specifically, so an unfixed section (single view only) is never hidden by the shared toggle.
  - Sticky header redesigned: year now leads, big and gold (matching the main timeline article
    view's own hierarchy) with the name underneath in the same sans-serif the "Task" panel
    title uses (previously the reverse, name large and serif). The "Fixed sections" checkbox
    (renamed from "Show only fixed sections") and its "N of M fixed" count moved into the same
    sticky block, on one line, so the filter stays reachable without scrolling back up.

v340 CHANGES (unchanged from the version this build started from):
- Settings tab reorganized/retired:
  - Removed "Suggest Next Batch to Work On", "Instruct Claude", and "Draft Article with Claude"
    entirely — HTML, click handlers, and the shared callClaude()/extractJson()/FACT_HINTS helpers
    they alone depended on. All three called the Anthropic API directly with no key attached,
    which only ever worked while this file ran as a claude.ai artifact — on this deployed site
    they've been non-functional the whole time, not just unused. (Draft Article had already been
    display:none since v282 for exactly this reason and was never actually reachable.)
  - Media Base Paths moved from Settings into Import, right after Publish to GitHub — pure
    relocation, every reference to it is by element id so no JS changed.
  - The now-empty Settings tab (panel-settings) removed entirely, along with its entry in
    MGMT_TAB_TITLES.
  - The bottom nav slot that opened Settings now opens Task Automation directly instead (same
    panel as the hamburger menu's Task : Automation row, same icon) — closes Manage first so
    the two full-screen overlays are never shown stacked. The generic tab-switching listener is
    now scoped to .mgmtTab[data-tab] specifically, since this button deliberately has no
    data-tab (it navigates away rather than switching to a sibling panel).

v339 CHANGES (unchanged from the version this build started from):
- GitHub token: switched persistence from the 'change' event (fires on blur) to 'input' (fires on
  every keystroke) — navigating straight from that field to Task Automation wasn't reliably
  blurring it first on every mobile browser, so v336's fix still wasn't sticking for that path.
- Sentence-reword review, redesigned around three real problems with the whole-article Before/
  After toggle from v334: no way to jump straight to what changed, comparing before/after meant
  losing your scroll position, and no way to tell "nothing to compare" from "the tool found
  nothing" at a glance.
  - Every section now renders BOTH its original and reworded text into the DOM up front (only
    the reworded text if it has no fix — nothing to compare there). A small Original/Corrected
    toggle sits right in that section's own header, only when it has a fix, and flips a
    data-mode attribute via CSS — no re-render, so nothing else on screen moves and scroll
    position never resets, exactly the "swap in place" behavior asked for.
  - New "Show only fixed sections" checkbox, remembered across sessions via localStorage
    (tk-sentence-hide-unfixed) — also a pure CSS toggle (hides .tkSentSection elements without
    the .tkSentHasFix class), so switching it doesn't re-render or move anything either.
  - tkRenderSentenceSections \u2192 tkRenderSentenceSectionSet: now returns {html, hasFix} per
    section instead of one combined string, so the caller can decide per-section whether to
    render one view or both.
  - Removed the old single global Before/After toggle (tkSentenceShowBefore/-For, #tkToggleSentenceView)
    entirely — fully superseded by the per-section version.
  - New sticky, larger name+year header (tkRvSticky/tkRvNameBig/tkRvYearBig) for this review
    specifically, replacing the plain tkRvName/tkRvMeta it used to share with every other review
    type — position:sticky against #tkReviewScroll's own scroll context, so it stays visible while
    scrolling a potentially long article section by section.
  - New delegated listeners for the toggle buttons and the checkbox, bound once (alongside
    tkChips' own) rather than per-render, since neither needs re-binding after a toggle — only a
    task switch actually changes the DOM they're delegating from.

v338 CHANGES (unchanged from the version this build started from):
- Task Automation's All/Queued/Review filter chips now have icons (2x2 grid, clock, document
  with checkmark) matching Tom's reference mockup — plain inline SVG (new .tkChipIcon wrapper),
  same technique most of the app already uses, reusing the existing .spChip column layout
  (icon above label) and .spChip.active color rule, so active/inactive state recolors both the
  icon and label together automatically via currentColor. The clock icon reuses a path already
  drawn elsewhere in the file rather than redrawing it. No new art assets — this component's own
  precedent of custom commissioned PNG-mask icons (Saints/Councils/Eucharistic Miracles chip
  bars) was considered but skipped here, since a grid/clock/document are simple enough shapes
  that hand-drawn line art matches fine without needing bespoke art.

v337 CHANGES (unchanged from the version this build started from):
- Fixed: sentence splitting broke on abbreviations ("St. Augustine" → two fake sentences at "St."),
  affecting both what counts as an over-length sentence server-side and how the review displays
  sentence boundaries. New shared SENTENCE_ABBREVIATIONS list (St./Sts./Dr./Mr./Fr./c./i.e./e.g./
  A.D./etc. and more) — a candidate boundary is skipped when the word right before the period is
  a known abbreviation, in tkSplitSentencesForDisplay (index.html), the batch-eligibility heuristic
  paragraphHasLongSentence (now reuses that same function instead of its own cruder split), and
  splitIntoSentences (scripts/services/sentence-reword.mjs) — all three kept in exact agreement so
  what's detected server-side, what's offered in the batch preview, and what's shown in review all
  draw the same boundaries.

v336 CHANGES (unchanged from the version this build started from):
- Fixed: sentence-reword's batch picker was offering entries that already have recorded audio —
  the original spec (skip those by default in a bulk sweep, since approving a fix purges the
  recording) never actually got carried into sentenceRewordPool() when this was rebuilt against
  the real Task Automation system. Restored, via the same "Regenerate even entries that already
  have one" checkbox image-generate uses — relabeled per type (TK_BATCH_OVERWRITE_LABEL) so it
  reads correctly for either "already has an image" or "already has recorded audio". Unchecked by
  default; switching Service now also resets it rather than carrying a stale check to a type it
  wasn't set on.
- Fixed: the GitHub token only ever got saved to localStorage from inside the unrelated "Save to
  GitHub (Publish)" button. Since Manage's fields are re-read fresh from localStorage every time
  the panel opens (prefillGh()), anyone using Task Automation without also happening to click that
  Publish button would find their token quietly gone next time Manage opened. Now saved on blur as
  soon as it's entered, independent of which button gets pressed afterward.

v335 CHANGES (unchanged from the version this build started from):
- Sentence-reword review: a proposal left over from before v334 (old single result.patch shape,
  one task per sentence) now says plainly that it predates the current review and to reject and
  requeue that entity, instead of silently rendering as if zero sentences needed fixing — which
  was indistinguishable from a task that genuinely found nothing.

v334 CHANGES (unchanged from the version this build started from):
- Sentence-reword review redesigned from one-task-per-sentence to one-task-per-entity, whole
  article at a time:
  - scripts/services/sentence-reword.mjs now bundles every long-sentence fix for an entity into a
    single `result.patches` array on one spawned `proposed` task, instead of spawning a separate
    task per fix. A paragraph with three long sentences is now one review, not three.
  - New review renderer (tkRenderSentenceRewordReview + tkPreviewSentencePatches +
    tkRenderSentenceSections + tkSplitSentencesForDisplay, plus a read-only locateTextInSections
    alongside patchTextInSections) shows the WHOLE article, not just the one changed paragraph.
    Every sentence is wrapped in its own span: one a patch actually touches goes yellow —
    alternating between two shades by patch index, so two edits sitting near each other read as
    distinct blocks rather than blurring into one — and every other untouched sentence gets a
    faint grey background, purely so its length is visible without counting words.
  - New "Show original" / "Show reworded" toggle (tkSentenceShowBefore, same local-view-only
    reset-per-task pattern as image review's tkFinalShowOriginal), defaulting to the reworded
    view. Before flips to the untouched original with the same sentences that would change still
    marked, so you can compare either direction without leaving the screen.
  - wlApplyTaskToDb() now applies either shape: a single result.patch (age-backfill and anything
    else unchanged) or sentence-reword's result.patches array, applied in order — a patch that
    fails to match is reported and skipped rather than aborting the ones that did.
  - Approve/Reject and the audio-purge-on-approve behavior are unchanged — sentence-reword still
    lands on the generic 'proposed' lock bar, and clearing entry.audio still only fires once at
    least one patch actually applied.

v333 CHANGES (unchanged from the version this build started from):
- New service: "sentence-reword". Reworked the sentence-length cleanup pass (previously a manual
  chat-based batch job) into a proper Task Automation service, following the same patterns the
  existing age-backfill-scan and image-generate services already use, rather than as a separate
  parallel system:
  - Registered in TK_SERVICES ("Reword long sentences") and TK_BATCH_TYPES, so Add Task offers
    the same Category/Start/Quantity batch picker image-generate uses. New sentenceRewordPool()
    (+ entryHasLongSentence()/paragraphHasLongSentence() heuristics) feeds it — same shape as
    imageCandidatePool(), including honoring the shared feast-day/year Order-by control.
  - One task per entity, handled server-side by the new scripts/services/sentence-reword.mjs.
    Scans each section's paragraphs (skipping any paragraph containing an entry: cross-reference
    link entirely), finds sentences over 40 words, asks Claude to reword just that sentence, and
    spawns one `proposed` task per fix — each carrying a single-edit patches-format tuple
    (['article', matchText, 'U', replacement]). This is the exact same shape age-backfill's
    spawned tasks already use, so it needed zero changes to renderTaskReview(), tkRenderArticle(),
    tkResolveCurrent(), or applyOnePatch() — the existing review/approve screen just works.
  - tkHasPendingTask() now also checks 'proposed' status (harmless for image-generate/finalize,
    which never reach that status) so a batch doesn't re-offer an entity that already has an
    unresolved reword proposal sitting in review.
  - The "Regenerate even entries that already have one" checkbox is hidden for sentence-reword
    (new TK_BATCH_HAS_OVERWRITE map) — there's no "overwrite" concept here, an entry either still
    has a sentence over 40 words or it doesn't. The "(regenerating)" note in the batch preview
    list is now also gated to image-generate only, for the same reason.
  - Audio invalidation: approving a sentence-reword proposal (wlApplyTaskToDb) clears the entry's
    audio field in memory alongside the text patch, so both publish together in the same
    data.json commit. New ghDeleteFile() + purgeStaleAudioFiles() then walk that entity's
    versioned audio+timing file pairs and delete them — but only called from publishToGitHub()
    AFTER its data.json commit already succeeded, never before, so there's no window where a live
    entry points at an already-deleted file.
  - Requires an ANTHROPIC_API_KEY repo secret (orchestrator.yml now passes it through) — the
    rewording itself runs on Claude alone, no OpenAI call.
  - Retires the parallel standalone sentence-reword system (separate workQueue.sentenceReword.json,
    its own Action, its own review panel) built in an earlier session before this one — that
    system never matched the app's real Task Automation architecture and should be deleted (see
    chat for the exact file list).

v332 CHANGES (unchanged from the version this build started from):
- Final image review now has a "Compare to original" toggle \u2014 flips the main image between
  the finished result and the medium-quality candidate that was actually used as the reference
  for the very first refinement pass (winningOriginal, new field on the image-finalize result,
  propagated forward unchanged through any later redo so it always points at the true original
  regardless of how many refinement rounds happened). Stays available after Approve too: an
  approved image-finalize task (status done, result.decision === 'approve') now also renders
  through the same review branch, toggle included, purely for viewing \u2014 the Approve/Redo/Back
  to candidates buttons only show while still pending. isFinalReview split into isFinalPending
  (drives the action buttons) and the broader isFinalReview (drives what's shown on screen).
  Tasks approved before this version won't have winningOriginal on their result, so the toggle
  button simply doesn't render for those \u2014 no error, nothing to compare against.

- A failed task (image-generate or image-finalize erroring out — an OpenAI 500, etc.) now shows
  its actual error message when you open it in Review, instead of falling through to the plain
  article-preview branch just because it has a valid entityId. New isErrorReview branch in
  renderTaskReview(), checked ahead of the entry/summary branches so this applies regardless of
  type. If it's a failed image-finalize, whatever reference image(s) it was using are shown too
  (they were never deleted — see below). Lock bar offers a single Retry button (new
  tkRetryTask()): a task's payload never changes once created, so retrying is just clearing the
  error and setting it back to queued for the next orchestrator run to pick up.
- Fixed a real bug behind a report that a redo note ("change the pope's expression") had no
  effect: scripts/services/image-finalize.mjs's refinement prompt told the model to preserve the
  reference image "as closely as possible... don't redesign the scene," with no carve-out for a
  note asking for a specific change — that blanket instruction was likely winning out over the
  note. Now states the note as an explicit exception when one is present.
- Candidates are no longer deleted at any point (previously image-finalize deleted the two medium
  candidates once the high-quality version was written). They're left in the repo so a person can
  come back later and reconsider the original pick, not just nudge the most recent result. The
  original pair (originalA/originalB in the task payload) is carried forward through every redo,
  so it stays reachable no matter how many refinement rounds happen. Final review now shows both
  originals below the current result, with a "Back to candidates" button (new
  tkRestartFromCandidates()) that re-opens the same Winner/Neither picker Picture Review used the
  first time — no new OpenAI call, since both images already exist on disk.
  Note: this is "kept indefinitely," not an actual time-based sweep — nothing currently deletes
  old candidates even after an entry is approved. Storage cost is trivial at this catalog's scale,
  but say the word if an actual cleanup pass (a real few-days-old sweep, or delete-on-approve)
  turns out to matter later; it isn't built yet.

- Added a second review step for images: previously image-finalize wrote the high-quality image
  and linked it into the entry automatically, with no human check on the refined result (only the
  earlier medium-quality candidate pick was reviewed). image-finalize now stops at
  awaiting_review instead — Picture Review shows the finished image with Approve / Redo. Approve
  sets the entry's img field and publishes immediately, no extra orchestrator run needed. Redo
  queues another image-finalize pass using the same final image as the new reference (the two
  original medium candidates are already gone by this point, deleted the first time this entity
  was finalized), carrying any notes typed in to steer the next attempt. New function
  tkResolveFinal() alongside the existing tkResolveImage(); renderTaskReview() now branches on
  image-finalize's awaiting_review state as well as image-generate's.
- Companion change in scripts/services/image-finalize.mjs (not this file): no longer sets
  entry.img or reports done itself; returns awaitingReview instead. Also now asks OpenAI for
  JPEG output directly (output_format/output_compression) instead of PNG, matching the same
  change already made in image-generate.mjs, so no PNG is ever written to the repo and no image
  library is needed to convert one after the fact.
- Fixed: image-finalize tasks (created by Picture Review's Winner button) had no way to be run
  directly — "image-finalize" was missing from TK_SERVICES entirely, so the Run panel's type
  filter dropdown only ever offered "Generate images" or "Age backfill." A run filtered to
  "Generate images" correctly reported nothing to do and left finalize tasks sitting at queued
  indefinitely, which looked stuck but wasn't \u2014 "Any service" would have picked them up the
  whole time. Added "Finalize images" as a selectable Run filter. Marked addable:false so it does
  NOT appear in Add Task's Service dropdown \u2014 a manually-added finalize task would have no
  entityId or candidate path and just fail, since this type only makes sense as Picture Review
  creates it.
- Fixed the Add Task batch selector's Prev/Next buttons showing literal "\u25c0"/"\u25b6" text
  instead of glyphs \u2014 those were JS-style escapes written directly into HTML, where they're
  never interpreted. Now uses &larr;/&rarr;, matching the existing audio card's own buttons.
- Added an explicit Order-by control (Feast day / Year) for the Saints category in the batch
  selector \u2014 previously Saints was silently locked to feast-day order the way the audio card
  always has been, with no way to queue images in plain chronological order instead. Hidden for
  every other category, where year is the only ordering that makes sense.
- Add Task now has a real batch selector for services that queue one task per entity, instead of
  only a bare Service+Description form. Category / Start (year, or feast day for Saints, with
  Prev/Next stepping) / Quantity / an Overwrite-equivalent, plus a live preview of what's about to
  be queued \u2014 built by generalizing the existing audio-recording card's own selector logic
  rather than reimplementing it. "image-generate" is the first service wired to it
  (imageCandidatePool(): needs article text, has no image yet unless the box is checked, matches
  the chosen category, and isn't already queued/running/awaiting review for this entity). Queuing
  a batch adds one task per resolved entity in a single save. The plain description form still
  applies to scan-type services like age-backfill, unchanged. Adding a future batch service
  (audio-generate, proofread) means one line in TK_BATCH_TYPES and one pool function alongside
  imageCandidatePool() \u2014 nothing else in the shared selector changes.
- Picture Review: Task Automation's review queue now handles image-generate tasks (status
  "awaiting_review") alongside the existing text-diff review for age-backfill-style proposals.
  Shows one candidate at a time via a direct raw.githubusercontent.com URL (so it's visible the
  moment the orchestrator commits it, not after Cloudflare's deploy lag). "Other image" toggles
  the candidate shown (local only, no save). "Winner" queues an image-finalize task for the
  chosen candidate plus any notes typed in; "Neither" re-queues a fresh image-generate for the
  same entity with the notes as guidance. Backing services: scripts/services/image-generate.mjs
  (candidates) and the new scripts/services/image-finalize.mjs (high-quality refinement pass via
  OpenAI's image-edit endpoint, using the winning candidate as reference so composition survives;
  patches the entry's img field and cleans up both candidate files once done).
- Registered "image-generate" as a known service (Task Automation's Run/Add Task dropdowns) and
  added an icon/title for the new awaiting_review status.
- Publish to GitHub and the Task : Automation panel's save no longer overwrite data.json/
  workLog.json wholesale. Both now re-fetch the current remote copy right before committing and
  overlay only what THIS browser session actually created, edited, or deleted — tracked via two
  new session sets (dirtyEntryIds/deletedEntryIds) touched at every point that mutates
  db.entries (manual editor save/delete, review Approve/Delete, the legacy Instruct Claude
  importer, Paste JSON's entries/patches import, and Task Automation's review-approve path).
  Anything a session never touched now always defers to the freshly-fetched remote version.
  Fixes a real data-loss path: previously, two people using the CMS over the same stretch of
  time — not even at the same instant — could have the second publish silently erase everything
  the first one had already committed, since the sha check only ever caught a same-instant
  collision, not two sessions each holding a copy that went stale over minutes or hours. Settings/
  locations/documents/carloLinks are unchanged (still a plain overwrite) — not part of the
  concurrent-review workflow today.
- The v323 attempt at the oversized-name bug in the Paste JSON results rows didn't actually fix
  it (confirmed by screenshot) — giving the nested name span its own font-size:inherit wasn't
  enough, for a cause not fully pinned down (the sibling .mImportSummaryLine, a single
  non-nested element with its own explicit font-size, rendered fine throughout). Rather than
  keep guessing at the exact mechanism, removed the nested bold-name span construction entirely:
  each row is now one plain text run (icon + full note text) with a single explicit
  font-size:14px, matching the one pattern that was already rendering correctly. No more nested
  spans left in that structure for a font-size or font-weight quirk to ride in on.
- v323 (unchanged): Paste JSON summary lines now omit "Imported"/"Carlo links"/"Patches" whenever
  that table had nothing to report, each present line gets its own line break, and patches read
  "X success, Y failed" instead of "X applied, Y skipped".
- v317 (unchanged): export search list styling, term highlighting, match count; Audio URL
  rename; Carlo Links export button removed.
- v316 (unchanged): Export tab search box filtering the export set.
- v315/v314/v313 (unchanged): search syntax, article highlighting, "=" full-text search.
