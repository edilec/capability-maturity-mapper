import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_ID, evaluateMaturity } from '../src/index.mjs';

test('library exports tool identity and injected deadline boundary', () => {
  assert.equal(TOOL_ID, 'capability-maturity-mapper');
  const rubric = { schemaVersion: '1', capabilities: [{ id: 'a', criteria: [{ id: 'c', dimension: 'controls', weight: 1, maxAgeDays: 30 }] }] };
  const evidence = { schemaVersion: '1', assessedAt: '2026-01-15T00:00:00Z', records: [{ criterionId: 'c', capturedAt: '2026-01-10T00:00:00Z', kind: 'verified', outcome: 'met', artifact: 'proof.txt' }] };
  assert.equal(evaluateMaturity(rubric, evidence, { artifactExists: () => true, deadline: 5, now: () => 5 }).status, 'pass');
  const timed = evaluateMaturity(rubric, evidence, { artifactExists: () => true, deadline: 4, now: () => 5 });
  assert.equal(timed.status, 'incomplete');
  assert.equal(timed.findings[0].ruleId, 'timeout');
});
