// scripts/orchestrator.mjs
//
// The one runner. Reads workLog.json, picks up queued tasks (up to MAX_TASKS_PER_RUN,
// optionally filtered to a single TASK_TYPE), dispatches each to the service handler
// registered for its `type`, and writes results back — either directly to the task (for a
// scan-type task that produces a summary) or as newly spawned tasks (e.g. one per entity a
// scan qualified).
//
// Adding a new service later means: write a new file in scripts/services/, import it below,
// add one line to SERVICE_HANDLERS. Nothing else in this file changes.
//
// THREE WAYS A TASK CAN FINISH, and they are deliberately different:
//   • done            — the work is complete and needs no further human decision.
//   • awaiting_review — the work produced something (e.g. two candidate images) that a human
//                       must pick between before it's really finished. Shows up in the app's
//                       review surfaces, not the plain done list.
//   • error           — something broke. The task stops, carries its error, and shows red.
//   • deferred        — nothing broke; the run simply ran out of budget (API tokens, rate
//                       limit, time). The task goes back to `queued` exactly as it was, and the
//                       run leaves a plain-language notice on the log. Running out of tokens is
//                       a normal operating condition when you queue 50 items and ask for 5, not
//                       a failure, and it must never look like one — otherwise the list fills
//                       with red rows that only mean "try again later".
// A handler signals deferral by returning { deferred: true, reason: '...' } or by throwing an
// error whose `deferred` property is true. A handler signals awaiting_review by returning
// { awaitingReview: true, result, summary, filesToCommit? } instead of the plain-done shape.
//
// COMMITTING CONTENT FILES (data.json, images, audio): a handler that touches any of these
// returns `filesToCommit` — the exact repo-relative paths it wrote or changed — and this file
// commits+pushes just those paths right after that one task, not once at the end of the whole
// batch. That's deliberate, not incidental: the longer a change sits uncommitted in memory, the
// more likely someone else (another run, or a person publishing from the CMS) has moved the repo
// underneath it by the time it finally commits. Per-task commits shrink that window from "the
// whole run" to "one task." If a push is rejected because the repo moved since this task started,
// one `git pull --rebase` is attempted; if that still fails, the task is marked `error` (not
// silently retried and not silently dropped) with a message telling you to just rerun the
// orchestrator — the underlying work already happened, only the publish step needs redoing.
//
// workLog.json itself is committed the same way now, not once at the end of the run — twice per
// batch at minimum (once the moment the whole batch is claimed, before any handler runs, and once
// per task as its own outcome becomes known), via commitWorkLog(). This used to be a single write
// at the very end, on the theory that it's bookkeeping, not content. That theory was right about
// safety (it does merge safely on the CMS side, see saveWorkLog in index.html) but wrong about
// visibility: a single end-of-run write meant nobody watching mid-run could tell which tasks were
// actually running, or see anything change until the whole batch finished. Best-effort, not fatal
// — a failed workLog push here just costs one visibility update; orchestrator.yml's own trailing
// commit step is still the final safety net for whatever a per-task push missed.
//
// BATCH CLAIMING: the whole batch is flipped to `in_progress` and committed in ONE shot, BEFORE
// the loop below processes any of them — not one task at a time as each one's turn starts. This
// is what lets the app's Running tab show the whole batch (10 → 9 → 8… as each one actually
// finishes) rather than only ever showing whichever single task happens to be executing at that
// instant. The loop itself still runs strictly serially, exactly as before — this only changes
// WHEN each task's in_progress status becomes visible (all at once, up front) rather than
// changing how the work itself is scheduled. If a task defers partway through (budget/rate-limit
// exhausted), every task after it in the batch that hasn't been reached yet is un-claimed back to
// `queued` (see the deferredCount>0 branch below) — they were only ever tentatively claimed, and
// never got their turn.
//
// PRUNING: workLog.json only ever grows unless something trims it — every task, forever, is a
// permanent record by default. Once a task is finished (done, rejected, or error — anything that
// isn't still queued/in_progress/awaiting_review) it doesn't need to live in the live file
// indefinitely; it's history, not something the app or a person is waiting on. Every run, after
// all task processing is done, pruneCompletedTasks() keeps only the MAX_COMPLETED_KEPT
// most-recently-updated finished tasks and drops the rest — permanently, no archive file. This
// runs on every invocation (including a no-op run that found nothing queued) so the file can't
// quietly grow past the point where a phone on a flaky connection can fetch it in one piece.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { execSync } from 'node:child_process';
import { runAgeBackfillScan } from './services/age-backfill.mjs';
import { runImageGenerate } from './services/image-generate.mjs';
import { runImageFinalize } from './services/image-finalize.mjs';
import { runSentenceReword } from './services/sentence-reword.mjs';
import { runAudioGenerate } from './services/audio-generate.mjs';
import { runArbitrate } from './services/arbitrate.mjs';

const WORKLOG_PATH = process.env.WORKLOG_PATH || 'workLog.json';
const DATA_PATH = process.env.DATA_PATH || 'data.json';
const SUMMARY_PATH = process.env.SUMMARY_PATH || 'scripts/work-summary.txt';
const MAX_TASKS = parseInt(process.env.MAX_TASKS_PER_RUN || '5', 10);
const TASK_TYPE = (process.env.TASK_TYPE || '').trim(); // '' = any service

// How many finished tasks to keep, and which statuses count as "finished" for that purpose.
// awaiting_review is deliberately excluded — it's still waiting on a human decision, not history.
const MAX_COMPLETED_KEPT = parseInt(process.env.MAX_COMPLETED_KEPT || '75', 10);
const FINISHED_STATUSES = new Set(['done', 'rejected', 'error']);

// Register each service's task type -> handler function here. A handler may be async.
const SERVICE_HANDLERS = {
  'age-backfill-scan': runAgeBackfillScan,
  'image-generate': runImageGenerate,
  'image-finalize': runImageFinalize,
  'sentence-reword': runSentenceReword,
  'audio-generate': runAudioGenerate,
  'arbitrate': runArbitrate,
};

function nowIso(){ return new Date().toISOString(); }

function writeSummary(text){
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  writeFileSync(SUMMARY_PATH, text.endsWith('\n') ? text : text + '\n');
}

// Keeps only the MAX_COMPLETED_KEPT most-recently-updated finished tasks (see FINISHED_STATUSES)
// and drops the rest from workLog.tasks outright — no archive. Tasks that aren't finished
// (queued, in_progress, awaiting_review) are never touched by this, regardless of age. Order of
// the surviving tasks is left exactly as it was; this only decides which finished tasks survive,
// not how they're arranged. Returns the number of tasks removed, purely for the run summary.
function pruneCompletedTasks(workLog){
  const finished = workLog.tasks.filter(t => FINISHED_STATUSES.has(t.status));
  if(finished.length <= MAX_COMPLETED_KEPT) return 0;

  const keepIds = new Set(
    [...finished]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, MAX_COMPLETED_KEPT)
      .map(t => t.id)
  );

  const before = workLog.tasks.length;
  workLog.tasks = workLog.tasks.filter(t => !FINISHED_STATUSES.has(t.status) || keepIds.has(t.id));
  return before - workLog.tasks.length;
}

// Writes the in-memory dataJson to disk (if it changed) and commits exactly the given file
// paths — never a blanket `git add -A`, so a handler can only ever affect the files it actually
// named. Returns true on success, false if the push couldn't be reconciled and the caller should
// treat this task as needing a rerun rather than as done.
function commitFiles(dataJson, filePaths, message){
  if(!filePaths || !filePaths.length) return true;
  if(filePaths.includes(DATA_PATH)){
    writeFileSync(DATA_PATH, JSON.stringify(dataJson, null, 1) + '\n');
  }
  const addArgs = filePaths.map(p => '"' + p + '"').join(' ');
  try{
    execSync('git add ' + addArgs, { stdio: 'inherit' });
    // Nothing to commit is not an error — a handler can legitimately report success without
    // having changed a tracked file's bytes (rare, but shouldn't crash the run).
    try{ execSync('git diff --cached --quiet'); return true; }catch(_e){ /* there IS a staged diff, fall through to commit */ }
    execSync('git commit -m ' + JSON.stringify(message), { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
    return true;
  }catch(err){
    console.warn('Push failed, attempting one rebase-and-retry: ' + err.message);
    try{
      execSync('git pull --rebase --autostash', { stdio: 'inherit' });
      execSync('git push', { stdio: 'inherit' });
      return true;
    }catch(err2){
      try{ execSync('git rebase --abort', { stdio: 'ignore' }); }catch(_e){}
      console.error('Could not publish after rebase retry: ' + err2.message);
      return false;
    }
  }
}

// Same git safety pattern as commitFiles, but always for the one file, and best-effort rather
// than fatal: a failed workLog.json push here is a lost visibility update, not lost work — the
// task's real outcome already lives in the return value the caller has in hand, and the final
// write at the end of the whole run (see bottom of main()) still captures it either way. Logging
// a warning and moving on is the right response, not aborting an otherwise-healthy run over a
// status update that will get written again in a few seconds anyway.
function commitWorkLog(workLog, message){
  writeFileSync(WORKLOG_PATH, JSON.stringify(workLog, null, 2) + '\n');
  try{
    execSync('git add "' + WORKLOG_PATH + '"', { stdio: 'inherit' });
    try{ execSync('git diff --cached --quiet'); return true; }catch(_e){ /* there IS a staged diff, fall through to commit */ }
    execSync('git commit -m ' + JSON.stringify(message), { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
    return true;
  }catch(err){
    console.warn('workLog.json push failed, attempting one rebase-and-retry: ' + err.message);
    try{
      execSync('git pull --rebase --autostash', { stdio: 'inherit' });
      execSync('git push', { stdio: 'inherit' });
      return true;
    }catch(err2){
      try{ execSync('git rebase --abort', { stdio: 'ignore' }); }catch(_e){}
      console.warn('Could not publish workLog.json update after rebase retry (continuing anyway): ' + err2.message);
      return false;
    }
  }
}

async function main(){
  const workLog = JSON.parse(readFileSync(WORKLOG_PATH, 'utf8'));
  let dataJson = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

  if(!Array.isArray(workLog.tasks)){
    throw new Error('workLog.json is missing a "tasks" array.');
  }

  // Any notice from a previous run is cleared here: it described that run's budget, and
  // leaving it up after a fresh run would misreport the current state.
  delete workLog.notice;

  const queued = workLog.tasks.filter(t =>
    t.status === 'queued' && (!TASK_TYPE || t.type === TASK_TYPE)
  );
  const batch = queued.slice(0, MAX_TASKS);

  if(batch.length === 0){
    const scope = TASK_TYPE ? ' of type "' + TASK_TYPE + '"' : '';
    console.log('No queued tasks' + scope + '. Nothing to do.');
    const prunedCount = pruneCompletedTasks(workLog);
    const summaryText = 'Orchestrator run: no queued tasks' + scope + ' found.' +
      (prunedCount > 0 ? ' Pruned ' + prunedCount + ' completed task(s) beyond the last ' + MAX_COMPLETED_KEPT + '.' : '');
    writeSummary(summaryText);
    writeFileSync(WORKLOG_PATH, JSON.stringify(workLog, null, 2) + '\n');
    return;
  }

  const summaryLines = [
    'Orchestrator run: ' + nowIso(),
    'Requested: up to ' + MAX_TASKS + (TASK_TYPE ? ' of type "' + TASK_TYPE + '"' : ' of any type'),
    ''
  ];
  let deferredCount = 0;
  let deferredReason = '';

  // Claim the whole batch as in_progress in one commit, before any handler runs — see BATCH
  // CLAIMING in the file-header comment. Tasks whose type has no registered handler are claimed
  // too; the loop below flips them to `error` on its first touch, same as always, just a moment
  // later than before.
  const claimedAt = nowIso();
  batch.forEach(task => { task.status = 'in_progress'; task.updatedAt = claimedAt; });
  summaryLines.push('Claimed ' + batch.length + ' task' + (batch.length === 1 ? '' : 's') + ' as in_progress.', '');
  commitWorkLog(workLog, 'Claim batch: ' + batch.length + ' task' + (batch.length === 1 ? '' : 's') +
    (TASK_TYPE ? ' (' + TASK_TYPE + ')' : ''));

  for(const task of batch){
    const handler = SERVICE_HANDLERS[task.type];

    if(!handler){
      task.status = 'error';
      task.error = 'No service registered for type "' + task.type + '"';
      task.updatedAt = nowIso();
      summaryLines.push('\u2717 ' + task.id + ' (' + task.type + '): no handler registered');
      commitWorkLog(workLog, 'No handler for ' + task.id);
      continue;
    }

    // Once one task in this batch has deferred, the run's budget is gone — every task from here
    // on is un-claimed back to `queued` (it was only ever tentatively claimed by the batch-claim
    // commit above) rather than attempted and failed the same way. No commit here per task; the
    // reverted statuses ride along in the same final writeFileSync/commit every run already does
    // at the bottom of main().
    if(deferredCount > 0){
      task.status = 'queued';
      task.updatedAt = nowIso();
      deferredCount++;
      continue;
    }

    // Already `in_progress` from the batch-claim commit above — no separate per-task "Start"
    // commit anymore. Each task's own commit below (Finish/Defer/error) is what flips IT OUT of
    // Running individually, one at a time, as it actually finishes; that's what makes the
    // Running count visibly step down as the batch works through.
    try{
      const out = (await handler(task, dataJson, workLog)) || {};

      if(out.deferred){
        task.status = 'queued';           // back exactly as it was — not an error
        task.updatedAt = nowIso();
        deferredCount++;
        deferredReason = out.reason || 'the service ran out of budget';
        summaryLines.push('\u23f8 ' + task.id + ' (' + task.type + '): deferred \u2014 ' + deferredReason);
        commitWorkLog(workLog, 'Defer ' + task.id);
        continue;
      }

      // Publish whatever this task wrote (data.json fields, image files, audio files) BEFORE
      // marking the task finished — a task should never claim to be done/awaiting_review while
      // its actual output is still sitting uncommitted in this run's working copy.
      let published = true;
      if(out.filesToCommit && out.filesToCommit.length){
        const msg = (out.awaitingReview ? 'Generate candidates' : 'Apply') + ' — ' + task.id;
        published = commitFiles(dataJson, out.filesToCommit, msg);
      }

      if(!published){
        task.status = 'error';
        task.error = 'Generated successfully but could not publish \u2014 the repo changed underneath this run. Rerun the orchestrator to retry (this will redo the generation).';
        task.updatedAt = nowIso();
        summaryLines.push('\u2717 ' + task.id + ' (' + task.type + '): generated but publish failed, see error');
        commitWorkLog(workLog, 'Publish failed for ' + task.id);
        continue;
      }

      task.status = out.awaitingReview ? 'awaiting_review' : 'done';
      task.result = out.result;
      task.error = null;
      task.updatedAt = nowIso();
      summaryLines.push(
        (out.awaitingReview ? '\u23f3 ' : '\u2713 ') + task.id + ' (' + task.type + '): ' + out.summary
      );
      if(out.spawnedTasks && out.spawnedTasks.length){
        workLog.tasks.push(...out.spawnedTasks);
        summaryLines.push('  \u2192 spawned ' + out.spawnedTasks.length + ' task(s), status "proposed"');
      }
      commitWorkLog(workLog, 'Finish ' + task.id + ' (' + task.status + ')');
    }catch(err){
      if(err && err.deferred){
        task.status = 'queued';
        task.updatedAt = nowIso();
        deferredCount++;
        deferredReason = err.message || 'the service ran out of budget';
        summaryLines.push('\u23f8 ' + task.id + ' (' + task.type + '): deferred \u2014 ' + deferredReason);
        commitWorkLog(workLog, 'Defer ' + task.id);
        continue;
      }
      task.status = 'error';
      task.error = String((err && err.stack) || err);
      task.updatedAt = nowIso();
      summaryLines.push('\u2717 ' + task.id + ' (' + task.type + '): ' + err.message);
      commitWorkLog(workLog, 'Error on ' + task.id);
    }
  }

  if(deferredCount > 0){
    // Plain language, no jargon — this is read in the app by someone deciding whether to try
    // again, not by someone debugging.
    workLog.notice = deferredCount + ' task' + (deferredCount === 1 ? '' : 's') +
      ' left queued: ' + deferredReason + '. Nothing failed \u2014 run again later to pick up where this stopped.';
    summaryLines.push('', workLog.notice);
  }

  const prunedCount = pruneCompletedTasks(workLog);
  if(prunedCount > 0){
    summaryLines.push('', 'Pruned ' + prunedCount + ' completed task(s) (done/rejected/error) beyond the last ' + MAX_COMPLETED_KEPT + ' \u2014 not archived.');
  }

  writeFileSync(WORKLOG_PATH, JSON.stringify(workLog, null, 2) + '\n');

  const skipped = queued.length - batch.length;
  if(skipped > 0){
    summaryLines.push('', skipped + ' additional queued task(s) left for next run (max_tasks=' + MAX_TASKS + ').');
  }

  writeSummary(summaryLines.join('\n'));
  console.log(summaryLines.join('\n'));
}

main().catch(err => { console.error(err); process.exit(1); });
