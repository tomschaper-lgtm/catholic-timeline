// scripts/tests/orchestrator-registration.test.mjs
// MODULE DATE: 2026-10-10 (Saturday) · guard for the two-line change that registers the writer in scripts/orchestrator.mjs.
// The change is a find-and-replace patch whose find strings still exist after it is applied, so applying it a second time would register the service twice and
// break the orchestrator. This test fails in that case, so the delivery is refused instead of committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = fileURLToPath(new URL('../orchestrator.mjs', import.meta.url));
const count = (s, re) => (s.match(re) || []).length;

test('the orchestrator imports and registers the article writer exactly once', () => {
  assert.ok(existsSync(p), 'scripts/orchestrator.mjs not found');
  const s = readFileSync(p, 'utf8');
  assert.equal(count(s, /import \{ runArticleWrite \} from '\.\/services\/article-writer\.mjs';/g), 1, 'the import must appear exactly once');
  assert.equal(count(s, /'article-write':\s*runArticleWrite/g), 1, 'the task type must be registered exactly once');
  assert.equal(count(s, /'ledger-build':\s*runLedgerBuild/g), 1, 'ledger-build must still be registered exactly once');
});
