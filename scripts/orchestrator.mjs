// scripts/orchestrator.mjs
//
// The one runner. Reads workLog.json, picks up queued tasks (up to
// MAX_TASKS_PER_RUN), dispatches each to the service handler registered
// for its `type`, and writes results back — either directly to the task
// (for a scan-type task that produces a summary) or as newly spawned
// tasks (e.g. one per entity a scan qualified).
//
// Adding a new service later means: write a new file in scripts/services/,
// import it below, add one line to SERVICE_HANDLERS. Nothing else in this
// file changes.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { runAgeBackfillScan } from './services/age-backfill.mjs';

const WORKLOG_PATH = process.env.WORKLOG_PATH || 'workLog.json';
const DATA_PATH = process.env.DATA_PATH || 'data.json';
const SUMMARY_PATH = process.env.SUMMARY_PATH || 'scripts/work-summary.txt';
const MAX_TASKS = parseInt(process.env.MAX_TASKS_PER_RUN || '5', 10);

// Register each service's task type -> handler function here.
const SERVICE_HANDLERS = {
  'age-backfill-scan': runAgeBackfillScan,
};

function nowIso() {
  return new Date().toISOString();
}

function writeSummary(text) {
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  writeFileSync(SUMMARY_PATH, text.endsWith('\n') ? text : text + '\n');
}

function main() {
  const workLog = JSON.parse(readFileSync(WORKLOG_PATH, 'utf8'));
  const dataJson = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

  if (!Array.isArray(workLog.tasks)) {
    throw new Error('workLog.json is missing a "tasks" array.');
  }

  const queued = workLog.tasks.filter((t) => t.status === 'queued');
  const batch = queued.slice(0, MAX_TASKS);

  if (batch.length === 0) {
    console.log('No queued tasks. Nothing to do.');
    writeSummary('Orchestrator run: no queued tasks found.');
    return;
  }

  const newTasks = [];
  const summaryLines = [`Orchestrator run: ${nowIso()}`, ''];

  for (const task of batch) {
    const handler = SERVICE_HANDLERS[task.type];
    task.updatedAt = nowIso();

    if (!handler) {
      task.status = 'error';
      task.error = `No service registered for type "${task.type}"`;
      summaryLines.push(`\u2717 ${task.id} (${task.type}): no handler registered`);
      continue;
    }

    task.status = 'in_progress';

    try {
      const { result, spawnedTasks, summary } = handler(task, dataJson, workLog);
      task.status = 'done';
      task.result = result;
      task.error = null;
      task.updatedAt = nowIso();
      summaryLines.push(`\u2713 ${task.id} (${task.type}): ${summary}`);
      if (spawnedTasks && spawnedTasks.length) {
        newTasks.push(...spawnedTasks);
        summaryLines.push(`  \u2192 spawned ${spawnedTasks.length} task(s), status "proposed"`);
      }
    } catch (err) {
      task.status = 'error';
      task.error = String((err && err.stack) || err);
      task.updatedAt = nowIso();
      summaryLines.push(`\u2717 ${task.id} (${task.type}): ${err.message}`);
    }
  }

  workLog.tasks.push(...newTasks);
  writeFileSync(WORKLOG_PATH, JSON.stringify(workLog, null, 2) + '\n');

  const skipped = queued.length - batch.length;
  if (skipped > 0) {
    summaryLines.push('', `${skipped} additional queued task(s) left for next run (MAX_TASKS_PER_RUN=${MAX_TASKS}).`);
  }

  writeSummary(summaryLines.join('\n'));
  console.log(summaryLines.join('\n'));
}

main();
