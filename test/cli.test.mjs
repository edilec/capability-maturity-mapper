import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../bin/capability-maturity-mapper.mjs';

const cli = new URL('../bin/capability-maturity-mapper.mjs', import.meta.url).pathname;
const rubric = { schemaVersion: '1', capabilities: [{ id: 'private-capability', criteria: [
  { id: 'repeat', dimension: 'repeatability', weight: 1, maxAgeDays: 30 },
  { id: 'control', dimension: 'controls', weight: 1, maxAgeDays: 30 },
  { id: 'restore', dimension: 'recovery', weight: 1, maxAgeDays: 30 }
] }] };
const evidence = { schemaVersion: '1', assessedAt: '2026-01-15T00:00:00Z', records: ['repeat', 'control', 'restore'].map(criterionId => ({ criterionId, capturedAt: '2026-01-10T00:00:00Z', kind: 'verified', outcome: 'met', artifact: 'proof.txt' })) };
function run(r = rubric, e = evidence, edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'maturity-test-'));
  try {
    writeFileSync(join(root, 'rubric.json'), JSON.stringify(r));
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(e));
    writeFileSync(join(root, 'proof.txt'), 'synthetic evidence');
    edit(root);
    const out = spawnSync(process.execPath, [cli, '--root', root, '--rubric', 'rubric.json', '--evidence', 'evidence.json'], { encoding: 'utf8' });
    return { ...out, report: out.stdout ? JSON.parse(out.stdout) : null };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('documented evidence scores deterministically without leaking identifiers', () => {
  const a = run(), b = run();
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.report.tool, 'capability-maturity-mapper');
  assert.equal(a.report.capabilities[0].score, 100);
  assert.equal(a.report.capabilities[0].assessmentDate, '2026-01-15');
  assert.ok(!a.stdout.includes('private-capability'));
});
test('self rating cannot increase verified maturity', () => {
  const e = structuredClone(evidence);
  e.records[0] = { criterionId: 'repeat', capturedAt: '2026-01-10T00:00:00Z', kind: 'self-rated', outcome: 'met' };
  const out = run(rubric, e);
  assert.equal(out.status, 2);
  assert.equal(out.report.capabilities[0].score, 66.67);
  assert.ok(out.report.findings.some(f => f.ruleId === 'self-rating-unverified'));
});
test('documented not-met criterion lowers score and fails assessment', () => {
  const e = structuredClone(evidence);
  e.records[0].outcome = 'not-met';
  const out = run(rubric, e);
  assert.equal(out.status, 1);
  assert.equal(out.report.capabilities[0].score, 66.67);
  assert.ok(out.report.findings.some(f => f.ruleId === 'criterion-not-met'));
});
test('missing evidence and stale evidence are explicit gaps', () => {
  const e = structuredClone(evidence);
  e.records.pop();
  e.records[0].capturedAt = '2025-01-01T00:00:00Z';
  const out = run(rubric, e);
  assert.equal(out.status, 2);
  assert.equal(out.report.capabilities[0].score, 33.33);
  assert.deepEqual(out.report.findings.map(f => f.ruleId).sort(), ['evidence-missing', 'evidence-stale']);
});
test('out-of-root artifact is incomplete without content disclosure', () => {
  const outside = mkdtempSync(join(tmpdir(), 'maturity-outside-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'PRIVATE_SENTINEL');
    const out = run(rubric, evidence, root => symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt')));
    const e = structuredClone(evidence);
    e.records[0].artifact = 'escape.txt';
    const escaped = run(rubric, e, root => symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt')));
    assert.equal(out.status, 0);
    assert.equal(escaped.status, 2);
    assert.ok(escaped.report.findings.some(f => f.ruleId === 'artifact-unavailable'));
    assert.ok(!escaped.stdout.includes('PRIVATE_SENTINEL'));
  } finally { rmSync(outside, { recursive: true, force: true }); }
});
test('unknown option has empty stdout', () => {
  const out = spawnSync(process.execPath, [cli, '--unknown'], { encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.equal(out.stdout, '');
});
test('criterion bound is quiet at 1000 and incomplete at 1001', () => {
  const criteria = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, dimension: 'controls', weight: 1, maxAgeDays: 30 }));
  const r = { schemaVersion: '1', capabilities: [{ id: 'bulk', criteria }] };
  const e = { schemaVersion: '1', assessedAt: '2026-01-15T00:00:00Z', records: criteria.map(c => ({ criterionId: c.id, capturedAt: '2026-01-10T00:00:00Z', kind: 'verified', outcome: 'met', artifact: 'proof.txt' })) };
  assert.equal(run(r, e).status, 0);
  r.capabilities[0].criteria.push({ id: 'overflow', dimension: 'controls', weight: 1, maxAgeDays: 30 });
  const over = run(r, e);
  assert.equal(over.status, 2);
  assert.ok(over.report.findings.some(f => f.ruleId === 'record-limit'));
});
test('JSON container depth four accepted and fifth level incomplete', () => {
  assert.equal(run().status, 0);
  const r = structuredClone(rubric);
  r.capabilities[0].criteria[0].extra = {};
  const over = run(r);
  assert.equal(over.status, 2);
  assert.ok(over.report.findings.some(f => f.ruleId === 'depth-limit'));
});
test('evidence age is accepted at N days and stale at N plus one', () => {
  const e = structuredClone(evidence);
  e.records[0].capturedAt = '2025-12-16T00:00:00Z';
  assert.equal(run(rubric, e).status, 0);
  e.records[0].capturedAt = '2025-12-15T00:00:00Z';
  const old = run(rubric, e);
  assert.equal(old.status, 2);
  assert.ok(old.report.findings.some(f => f.ruleId === 'evidence-stale'));
});
test('JSON byte boundary and strict UTF-8 protect input evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'maturity-bytes-'));
  try {
    const base = JSON.stringify(rubric);
    writeFileSync(join(root, 'rubric.json'), base + ' '.repeat(262144 - Buffer.byteLength(base)));
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
    writeFileSync(join(root, 'proof.txt'), 'synthetic evidence');
    const invoke = () => spawnSync(process.execPath, [cli, '--root', root, '--rubric', 'rubric.json', '--evidence', 'evidence.json'], { encoding: 'utf8' });
    assert.equal(invoke().status, 0);
    writeFileSync(join(root, 'rubric.json'), base + ' '.repeat(262145 - Buffer.byteLength(base)));
    const over = invoke();
    assert.equal(over.status, 2);
    assert.ok(JSON.parse(over.stdout).findings.some(f => f.ruleId === 'input-too-large'));
    writeFileSync(join(root, 'rubric.json'), Buffer.from([0xff]));
    const badUtf8 = invoke();
    assert.equal(badUtf8.status, 2);
    assert.equal(JSON.parse(badUtf8.stdout).status, 'incomplete');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('injected CLI deadline accepts 5000 milliseconds and times out at 5001', () => {
  const root = mkdtempSync(join(tmpdir(), 'maturity-clock-'));
  try {
    writeFileSync(join(root, 'rubric.json'), JSON.stringify(rubric));
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
    writeFileSync(join(root, 'proof.txt'), 'synthetic evidence');
    const args = ['--root', root, '--rubric', 'rubric.json', '--evidence', 'evidence.json'];
    const invoke = clock => {
      let stdout = '';
      const code = main(args, clock, { write: s => { stdout += s; } }, { write: () => {} });
      return { code, report: JSON.parse(stdout) };
    };
    let calls = 0;
    assert.equal(invoke(() => calls++ === 0 ? 100 : 5100).code, 0);
    calls = 0;
    const beyond = invoke(() => calls++ === 0 ? 100 : 5101);
    assert.equal(beyond.code, 2);
    assert.ok(beyond.report.findings.some(f => f.ruleId === 'timeout'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
