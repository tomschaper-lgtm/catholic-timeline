// scripts/services/age-backfill.mjs
//
// Service: "age-backfill-scan"
//
// Scans every Saint (t:"s") entry in data.json. For each one, checks whether
// the Born and Died Quick Facts are BOTH firm enough (per
// content-authoring-skill.md's "Age at death" rule) to compute a
// "(at age N)" suffix on Died. If so, spawns an individual
// "age-backfill-apply" task carrying the computed patch, left at status
// "proposed" for a human to review in the Work Log.
//
// Design principle: never guess. Any hedge language, range, missing year,
// or missing month/day-precision mismatch means the entry is SKIPPED, not
// estimated. A skip is silent to the timeline but counted in the scan
// summary so you can see how many were left out and why.

const HEDGE_RE = /\bc\.|\bca\.|\bcirca\b|\btraditionally\b|\bpossibly\b|\bprobably\b|\bperhaps\b|\buncertain\b|\baround\b|\bapprox/i;
const RANGE_RE = /(\d{3,4})\s*(?:[-\u2013\/]|\bor\b)\s*(\d{3,4})/i;
const ALREADY_HAS_AGE_RE = /\(at age \d+\)/i;
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_DAY_RE = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\s+(\\d{1,2})\\b`, 'i');
const YEAR_RE = /\b(\d{3,4})\b/;

/**
 * Parse a free-text Quick Facts date string (e.g. "August 28, 430" or
 * "c. 354" or "1225-1274") into a firmness verdict plus, if firm, the
 * year and (when present) month/day.
 */
function parseDateFact(raw) {
  if (!raw || typeof raw !== 'string') return { firm: false, reason: 'missing' };
  const text = raw.trim();

  if (HEDGE_RE.test(text)) return { firm: false, reason: 'hedge language' };
  if (RANGE_RE.test(text)) return { firm: false, reason: 'range or disputed pair' };

  const yearMatch = text.match(YEAR_RE);
  if (!yearMatch) return { firm: false, reason: 'no parseable year' };
  const year = parseInt(yearMatch[1], 10);

  const mdMatch = text.match(MONTH_DAY_RE);
  let month = null;
  let day = null;
  if (mdMatch) {
    month = MONTH_NAMES.indexOf(mdMatch[1].toLowerCase()) + 1;
    day = parseInt(mdMatch[2], 10);
  }

  return { firm: true, year, month, day, raw: text };
}

/**
 * Compute age at death. Uses the true birthday-aware calculation when
 * month+day are known on BOTH ends; otherwise falls back to plain year
 * subtraction, per the authoring rule.
 */
function computeAge(born, died) {
  if (born.month && born.day && died.month && died.day) {
    let age = died.year - born.year;
    const birthdayHadArrived =
      died.month > born.month || (died.month === born.month && died.day >= born.day);
    if (!birthdayHadArrived) age -= 1;
    return { age, precise: true };
  }
  return { age: died.year - born.year, precise: false };
}

function getFact(entry, label) {
  if (!Array.isArray(entry.facts)) return null;
  const f = entry.facts.find((f) => f.label === label);
  return f ? f.value : null;
}

/**
 * Handler signature expected by scripts/orchestrator.mjs:
 *   (task, dataJson, workLog) => { result, spawnedTasks, summary }
 */
export function runAgeBackfillScan(task, dataJson) {
  const saints = (dataJson.entries || []).filter((e) => e.t === 's');

  const skipCounts = {
    noBornFact: 0,
    noDiedFact: 0,
    alreadyHasAge: 0,
    bornNotFirm: 0,
    diedNotFirm: 0,
    impossibleAge: 0,
  };

  const spawnedTasks = [];
  const nowIso = new Date().toISOString();

  for (const entry of saints) {
    const bornRaw = getFact(entry, 'Born');
    const diedRaw = getFact(entry, 'Died');

    if (!bornRaw) { skipCounts.noBornFact++; continue; }
    if (!diedRaw) { skipCounts.noDiedFact++; continue; }
    if (ALREADY_HAS_AGE_RE.test(diedRaw)) { skipCounts.alreadyHasAge++; continue; }

    const born = parseDateFact(bornRaw);
    if (!born.firm) { skipCounts.bornNotFirm++; continue; }

    const died = parseDateFact(diedRaw);
    if (!died.firm) { skipCounts.diedNotFirm++; continue; }

    const { age, precise } = computeAge(born, died);

    // Sanity guard — never propose a nonsensical age. This should only
    // trip if the two facts refer to different people/events; treat it
    // as "not firm" for reporting purposes.
    if (age < 0 || age > 120) { skipCounts.impossibleAge++; continue; }

    const newDied = `${diedRaw} (at age ${age})`;

    spawnedTasks.push({
      id: `task-age-backfill-apply-${entry.id}`,
      type: 'age-backfill-apply',
      entityId: entry.id,
      batchId: task.id,
      status: 'proposed',
      description: `Apply computed age (${age}) to Died fact for ${entry.n}`,
      payload: { bornRaw, diedRaw },
      result: {
        name: entry.n,
        oldDied: diedRaw,
        newDied,
        age,
        precise,
        patch: ['facts', 'Died', 'U', newDied],
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      error: null,
    });
  }

  const qualified = spawnedTasks.length;
  const skippedTotal = saints.length - qualified;

  const summary =
    `checked ${saints.length} saints, ${qualified} qualified, ${skippedTotal} skipped ` +
    `(no Born: ${skipCounts.noBornFact}, no Died: ${skipCounts.noDiedFact}, ` +
    `already has age: ${skipCounts.alreadyHasAge}, Born not firm: ${skipCounts.bornNotFirm}, ` +
    `Died not firm: ${skipCounts.diedNotFirm}, impossible age: ${skipCounts.impossibleAge})`;

  return {
    result: {
      totalSaints: saints.length,
      qualified,
      skipped: skipCounts,
    },
    spawnedTasks,
    summary,
  };
}
