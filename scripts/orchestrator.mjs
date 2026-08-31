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
// TWO WAYS A TASK CAN NOT FINISH, and they are deliberately different:
//   • error     — something broke. The task stops, carries its error, and shows red.
//   • deferred  — nothing broke; the run simply ran out of budget (API tokens, rate limit,
//                 time). The task goes back to `queued` exactly as it was, and the run leaves
//                 a plain-language notice on the log. Running out of tokens is a normal
//                 operating condition when you queue 50 items and ask for 5, not a failure,
//                 and it must never look like one — otherwise the list fills with red rows
//                 that only mean "try again later".
// A handler signals deferral by returning { deferred: true, reason: '...' } or by throwing an
// error whose `deferred` property is true.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { runAgeBackfillScan } from './services/age-backfill.mjs';

const WORKLOG_PATH = process.env.WORKLOG_PATH || 'workLog.json';
const DATA_PATH = process.env.DATA_PATH || 'data.json';
const SUMMARY_PATH = process.env.SUMMARY_PATH || 'scripts/work-summary.txt';
const MAX_TASKS = parseInt(process.env.MAX_TASKS_PER_RUN || '5', 10);
const TASK_TYPE = (process.env.TASK_TYPE || '').trim(); // '' = any service

// Register each service's task type -> handler function here.
const SERVICE_HANDLERS = {
  'age-backfill-scan': runAgeBackfillScan,
};

function nowIso(){ return new Date().toISOString(); }

function writeSummary(text){
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  writeFileSync(SUMMARY_PATH, text.endsWith('\n') ? text : text + '\n');
}

function main(){
  const workLog = JSON.parse(readFileSync(WORKLOG_PATH, 'utf8'));
  const dataJson = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

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

  const newTasks = [];
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
      continue;
    }

    // Once one task defers, the budget is gone for this run — the rest of the batch is left
    // untouched at `queued` rather than each being tried and failing the same way.
    if(deferredCount > 0){
      deferredCount++;
      continue;
    }

    task.status = 'in_progress';

    try{
      const out = handler(task, dataJson, workLog) || {};
      if(out.deferred){
        task.status = 'queued';           // back exactly as it was — not an error
        task.updatedAt = nowIso();
        deferredCount++;
        deferredReason = out.reason || 'the service ran out of budget';
        summaryLines.push('\u23f8 ' + task.id + ' (' + task.type + '): deferred \u2014 ' + deferredReason);
        continue;
      }
      task.status = 'done';
      task.result = out.result;
      task.error = null;
      task.updatedAt = nowIso();
      summaryLines.push('\u2713 ' + task.id + ' (' + task.type + '): ' + out.summary);
      if(out.spawnedTasks && out.spawnedTasks.length){
        newTasks.push(...out.spawnedTasks);
        summaryLines.push('  \u2192 spawned ' + out.spawnedTasks.length + ' task(s), status "proposed"');
      }
    }catch(err){
      if(err && err.deferred){
        task.status = 'queued';
        task.updatedAt = nowIso();
        deferredCount++;
        deferredReason = err.message || 'the service ran out of budget';
        summaryLines.push('\u23f8 ' + task.id + ' (' + task.type + '): deferred \u2014 ' + deferredReason);
        continue;
      }
      task.status = 'error';
      task.error = String((err && err.stack) || err);
      task.updatedAt = nowIso();
      summaryLines.push('\u2717 ' + task.id + ' (' + task.type + '): ' + err.message);
    }
  }

  workLog.tasks.push(...newTasks);

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

main();
