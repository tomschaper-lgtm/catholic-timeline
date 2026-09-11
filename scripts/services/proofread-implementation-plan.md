# Implementing "proofread" — plan

Two files are ready to drop in: `proofreader-skill.md` (the system prompt) and `proofread.mjs`
(the handler), both meant to live together in `scripts/services/`. This doc covers the two
remaining pieces — the one-line orchestrator registration, and the index.html front-end (Add
Task entry, batch pool, Review screen) — plus the open decisions worth settling before it goes
live.

## 1. orchestrator.mjs (small, exact)

```js
import { runProofread } from './services/proofread.mjs';
```
added alongside the other service imports, and
```js
'proofread': runProofread,
```
added to `SERVICE_HANDLERS`. Nothing else in that file changes — this is exactly the "write one
handler, add one line" extension point the vision doc described.

**orchestrator.yml needs nothing new** — `OPENAI_API_KEY` is already passed through for
sentence-reword's OpenAI path.

## 2. index.html — front end

Everything below follows the exact conventions `image-generate`/`sentence-reword`/`audio-generate`
already established (TK_SERVICES → TK_BATCH_TYPES → a pool function → tkBatchPool → the review
render/lock-bar branches). Landmarked by what's currently on each line so you can find the spot;
treat these as a drafted patch to review, not a guaranteed byte-for-byte diff — I haven't run this
against your actual file.

**TK_SERVICES** (~line 6445) — add after the `audio-generate` entry:
```js
{ id: 'proofread', label: 'Proofread articles' }
```

**TK_BATCH_TYPES** (~line 6461):
```js
const TK_BATCH_TYPES = { 'image-generate': true, 'sentence-reword': true, 'audio-generate': true, 'proofread': true };
```

**TK_BATCH_HAS_OVERWRITE / TK_BATCH_OVERWRITE_LABEL** (~line 6465):
```js
const TK_BATCH_HAS_OVERWRITE = { 'image-generate': true, 'sentence-reword': true, 'audio-generate': true, 'proofread': true };
const TK_BATCH_OVERWRITE_LABEL = {
  ...,
  'proofread': 'Re-check entries already proofread'
};
```

**New pool function**, alongside `audioGeneratePool()` (~line 6598) — needs a small helper first
since "already done" for proofread means "has any past proofread task," not a field on the entry
itself (proofread never writes to data.json):
```js
function hasBeenProofread(entityId){
  return ((wlData && wlData.tasks) || []).some(t =>
    t.type === 'proofread' && t.entityId === entityId &&
    (t.status === 'done' || t.status === 'awaiting_review' || t.status === 'approved'));
}
function proofreadPool(){
  const category = document.getElementById('tkBatchCategory').value;
  const includeChecked = document.getElementById('tkBatchOverwrite').checked;
  const pool = db.entries
    .filter(e => articleStats(e).wordCount > 0)
    .filter(e => !category || e.t === category)
    .filter(e => !tkHasPendingTask(e.id, ['proofread']))
    .filter(e => includeChecked || !hasBeenProofread(e.id))
    .slice();
  if(tkIsFeastMode()){
    return pool.sort((a, b) => {
      const ka = feastSortKeyOf(a), kb = feastSortKeyOf(b);
      return (ka.month - kb.month) || (ka.day - kb.day) || a.n.localeCompare(b.n);
    });
  }
  return pool.sort((a, b) => a.y - b.y);
}
```

**tkBatchPool()** (~line 6601) — add:
```js
if(type === 'proofread') return proofreadPool();
```

**Panel title** (~line 7187) — extend the existing special-case ternary (same pattern as
audio-generate's `' : Audio Review'`):
```js
document.getElementById('tkTitleSecond').textContent =
  (t.status === 'awaiting_review' && t.type === 'audio-generate') ? ' : Audio Review' :
  (t.status === 'awaiting_review' && t.type === 'proofread') ? ' : Proofread Review' :
  (TK_TITLES[t.status] || ' : Task');
```

**New boolean** (~line 7205, alongside `isAudioReview`):
```js
const isProofreadReview = t.type === 'proofread' && t.status === 'awaiting_review';
```

**Render body branch** — add an `else if(isProofreadReview)` alongside `isImageReview`/
`isFinalReview`/`isAudioReview`. Findings as styled cards, not a raw JSON dump — severity color
via a class, same naming style as `tkNote err`:
```js
} else if(isProofreadReview){
  const r = t.result || {};
  const findings = r.findings || [];
  body = '<div class="tkRvName">' + esc(r.name || tkTaskName(t)) + '</div>' +
    '<div class="tkRvMeta">' + esc(t.entityId) + ' \u00b7 ' + esc(r.model || '') + ' \u00b7 ' + esc(tkShortDate(t.updatedAt || t.createdAt)) + '</div>' +
    (r.verdict === 'pass'
      ? '<p class="tkNote ok">PASS \u2014 no issues found.</p>'
      : findings.map(f =>
          '<div class="tkFinding tkFinding-' + esc((f.severity || '').toLowerCase()) + '">' +
            '<div class="tkFindingHead">' + esc(f.severity) + ' \u00b7 ' + esc(f.category) + '</div>' +
            '<div class="tkFindingLoc">' + esc(f.section) + ', sentence ' + esc(f.sentence) + '</div>' +
            '<div class="tkFindingText">\u201c' + esc(f.text) + '\u201d</div>' +
            '<div class="tkFindingConcern">' + esc(f.concern) + '</div>' +
            '<div class="tkFindingFix"><b>Suggested:</b> ' + esc(f.suggestedCorrection) + '</div>' +
            (f.source && f.source !== 'Not externally verified' ? '<div class="tkFindingSource">' + esc(f.source) + '</div>' : '') +
          '</div>'
        ).join(''));
```
(Needs three small CSS rules for `.tkFinding`, `.tkFinding-error`/`.tkFinding-verify`/
`.tkFinding-judgment`, and `.tkNote.ok` — a simple left-border-color treatment matching the
existing `.tkNote.err` pattern is enough; not drafted here since I don't have your CSS block in
front of me.)

**Lock bar branch** — proofread has nothing to accept/reject (no patch, no file to publish), so
one plain acknowledgment button is enough, modeled on `isAudioReview`'s lock-bar branch but
without the entry-field/publish step:
```js
if(isProofreadReview){
  lock.innerHTML =
    '<div class="tkLockBtns">' +
      '<button class="tkBtn go" id="tkAckProofread">Mark reviewed</button>' +
    '</div>';
  document.getElementById('tkAckProofread').addEventListener('click', () => tkResolveProofread());
  return;
}
```

**New resolve function**, alongside `tkResolveAudio` — same shape, but skips the
`entry.audio = ...` + `publishToGitHub()` steps entirely, since there's nothing to publish:
```js
async function tkResolveProofread(){
  const t = tkTask(tkReviewIds[tkReviewIdx]);
  if(!t) return;
  const btn = document.getElementById('tkAckProofread');
  if(btn) btn.disabled = true;
  t.status = 'done';
  t.updatedAt = new Date().toISOString();
  const saved = await saveWorkLog('Reviewed proofread findings for ' + (t.result && t.result.name || t.entityId), [t.id]);
  if(!saved || saved.ok === false){
    if(btn) btn.disabled = false;
    wlSetLog('Marked reviewed, but the task list didn\u2019t update \u2014 refresh and it should show as done.', true);
    return;
  }
  let next = tkReviewIdx + 1;
  while(next < tkReviewIds.length){
    const nt = tkTask(tkReviewIds[next]);
    if(nt && (nt.status === 'proposed' || nt.status === 'awaiting_review' || nt.status === 'error')) break;
    next++;
  }
  if(next >= tkReviewIds.length){ tkGoList(); return; }
  tkReviewIdx = next;
  renderTaskPanel();
}
```

## 3. Open decisions before this ships

1. **Exact OpenAI model id string.** `proofread.mjs` has a placeholder
   (`OPENAI_PROOFREAD_MODEL` env var, default `'gpt-5.6-luna'`). Paste
   `scripts/services/sentence-reword.mjs` and I'll wire the exact model string (and, ideally, the
   same shared retry/token-escalation code) instead of the from-scratch Responses API call
   `proofread.mjs` currently has.
2. **Reasoning effort.** Started at `'low'` (proofreading needs more judgment than sentence-reword's
   mechanical rewording, which runs at `'none'`) — worth watching the first real batch's token
   usage the same way v354's postmortem caught sentence-reword's budget problem, before trusting it.
3. **Scope of the pool.** Drafted to offer every article-bearing entry once, re-offering only when
   "Re-check entries already proofread" is ticked. Worth deciding whether entries still held with
   `review: true` should be included or excluded by default — I left them included, on the theory
   that proofreading is itself part of getting a held entry ready to approve.
4. **Batch size.** No reason to differ from the existing default of 5 per run, unless article
   length makes OpenAI calls here noticeably slower/pricier than the other services — worth
   checking after the first real run.

## 4. Suggested first test

Before wiring any of the front-end pieces: queue one `proofread` task by hand in `workLog.json`
(entityId set to something you already know has an issue), run the orchestrator with
`task_type=proofread max_tasks=1`, and read the resulting `task.result` directly in
`workLog.json`. That confirms the OpenAI call, the JSON parsing, and the finding shape are all
correct before any UI depends on them — the same incremental way image-generate and sentence-reword
each got shaken out over several small version bumps rather than landing complete in one build.
