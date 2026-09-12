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
// task (once the moment it flips to in_progress, before the handler even runs, and once after its
// outcome is known), via commitWorkLog(). This used to be a single write at the very end, on the
// theory that it's bookkeeping, not content. That theory was right about safety (it does merge
// safely on the CMS side, see saveWorkLog in index.html) but wrong about visibility: a single
// end-of-run write meant nobody watching mid-run could tell which task was actually running, or
// see anything change until the whole batch finished. Best-effort, not fatal — a failed workLog
// push here just costs one visibility update; orchestrator.yml's own trailing commit step is
// still the final safety net for whatever a per-task push missed.

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
    writeSummary('Orchestrator run: no queued tasks' + scope + ' found.');
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

  for(const task of batch){
    const handler = SERVICE_HANDLERS[task.type];
    task.updatedAt = nowIso();

    if(!handler){
      task.status = 'error';
      task.error = 'No service registered for type "' + task.type + '"';
      summaryLines.push('\u2717 ' + task.id + ' (' + task.type + '): no handler registered');
      commitWorkLog(workLog, 'No handler for ' + task.id);
      continue;
    }

    // Once one task defers, the budget is gone for this run — the rest of the batch is left
    // untouched at `queued` rather than each being tried and failing the same way.
    if(deferredCount > 0){
      deferredCount++;
      continue;
    }

    task.status = 'in_progress';
    // Committed BEFORE the (potentially slow) handler call, not after — this is the whole point:
    // someone watching the app mid-run sees THIS task, by name, as in_progress, rather than
    // whatever workLog.json still said from before the run started. Best-effort (see
    // commitWorkLog) — a failed push here doesn't stop the run, it just costs one visibility
    // update that the next commit supersedes anyway.
    commitWorkLog(workLog, 'Start ' + task.id);

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

  writeFileSync(WORKLOG_PATH, JSON.stringify(workLog, null, 2) + '\n');

  const skipped = queued.length - batch.length;
  if(skipped > 0){
    summaryLines.push('', skipped + ' additional queued task(s) left for next run (max_tasks=' + MAX_TASKS + ').');
  }

  writeSummary(summaryLines.join('\n'));
  console.log(summaryLines.join('\n'));
}

main().catch(err => { console.error(err); process.exit(1); });
