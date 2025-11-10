export const TOOL_ID = 'capability-maturity-mapper';
export const SEVERITY = Object.freeze({
  'input-unavailable': 'warning', 'input-invalid': 'warning', 'input-too-large': 'warning',
  'depth-limit': 'warning', 'record-limit': 'warning', 'timeout': 'warning',
  'evidence-missing': 'warning', 'evidence-stale': 'warning', 'evidence-ambiguous': 'warning',
  'self-rating-unverified': 'warning', 'artifact-unavailable': 'warning', 'evidence-future': 'warning',
  'criterion-not-met': 'error'
});
const own = (o, k) => Object.hasOwn(o, k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clean = s => typeof s === 'string' && s.length >= 1 && s.length <= 80 && /^[A-Za-z0-9_.-]+$/.test(s);
const iso = s => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s.replace('Z', '.000Z');
const keys = (o, allowed) => obj(o) && Object.keys(o).every(k => allowed.includes(k));
const finding = (ruleId, file, pointer, message) => ({ ruleId, severity: SEVERITY[ruleId], message, location: { file, pointer } });

export function report(findings, checked = 0, capabilities = []) {
  findings.sort((a, b) => cmp(a.location.file, b.location.file) || cmp(a.location.pointer, b.location.pointer) || cmp(a.ruleId, b.ruleId));
  const status = findings.some(f => f.severity === 'warning') ? 'incomplete' : findings.some(f => f.severity === 'error') ? 'fail' : 'pass';
  return { schemaVersion: '1', tool: TOOL_ID, status, summary: { checked, errors: findings.filter(f => f.severity === 'error').length, warnings: findings.filter(f => f.severity === 'warning').length }, findings, capabilities };
}

export function evaluateMaturity(rubric, evidence, options = {}) {
  const artifactExists = options.artifactExists ?? (() => false);
  const deadline = options.deadline ?? Infinity;
  const now = options.now ?? (() => Date.now());
  const expired = () => deadline !== Infinity && now() > deadline;
  if (expired()) return report([finding('timeout', '@rubric', '', 'Evaluation exceeded its runtime limit')]);
  if (!keys(rubric, ['schemaVersion', 'capabilities']) || rubric.schemaVersion !== '1' || !Array.isArray(rubric.capabilities) || rubric.capabilities.length === 0 || rubric.capabilities.length > 100) return report([finding('input-invalid', '@rubric', '', 'Rubric shape is invalid')]);
  if (!keys(evidence, ['schemaVersion', 'assessedAt', 'records']) || evidence.schemaVersion !== '1' || !iso(evidence.assessedAt) || !Array.isArray(evidence.records)) return report([finding('input-invalid', '@evidence', '', 'Evidence shape is invalid')]);
  const criteria = [];
  const capIds = new Set(), criterionIds = new Set();
  for (const [ci, cap] of rubric.capabilities.entries()) {
    if (!keys(cap, ['id', 'criteria']) || !clean(cap.id) || capIds.has(cap.id) || !Array.isArray(cap.criteria) || cap.criteria.length === 0) return report([finding('input-invalid', '@rubric', `/capabilities/${ci}`, 'Capability shape is invalid')]);
    capIds.add(cap.id);
    for (const [ri, c] of cap.criteria.entries()) {
      if (!keys(c, ['id', 'dimension', 'weight', 'maxAgeDays']) || !clean(c.id) || criterionIds.has(c.id) || !['repeatability', 'controls', 'recovery'].includes(c.dimension) || !Number.isInteger(c.weight) || c.weight < 1 || c.weight > 10 || !Number.isInteger(c.maxAgeDays) || c.maxAgeDays < 0 || c.maxAgeDays > 3650) return report([finding('input-invalid', '@rubric', `/capabilities/${ci}/criteria/${ri}`, 'Criterion shape is invalid')]);
      criterionIds.add(c.id);
      criteria.push({ ...c, cap: ci, ordinal: ri });
    }
  }
  if (criteria.length > 1000 || evidence.records.length > 1000) return report([finding('record-limit', '@rubric', '', 'Criterion or evidence record limit exceeded')]);
  const byCriterion = new Map();
  for (const [index, record] of evidence.records.entries()) {
    if (!keys(record, ['criterionId', 'capturedAt', 'kind', 'outcome', 'artifact']) || !clean(record.criterionId) || !criterionIds.has(record.criterionId) || !iso(record.capturedAt) || !['verified', 'self-rated'].includes(record.kind) || !['met', 'not-met'].includes(record.outcome) || (record.kind === 'verified' && (typeof record.artifact !== 'string' || !record.artifact)) || (record.kind === 'self-rated' && record.artifact !== undefined)) return report([finding('input-invalid', '@evidence', `/records/${index}`, 'Evidence record shape is invalid')]);
    const list = byCriterion.get(record.criterionId) ?? [];
    list.push({ ...record, ordinal: index });
    byCriterion.set(record.criterionId, list);
  }
  const findings = [], scored = [];
  for (const [ci, cap] of rubric.capabilities.entries()) {
    let verifiedWeight = 0, totalWeight = 0, verified = 0;
    for (const [ri, criterion] of cap.criteria.entries()) {
      if (expired()) return report([finding('timeout', '@rubric', '', 'Evaluation exceeded its runtime limit')]);
      totalWeight += criterion.weight;
      const records = byCriterion.get(criterion.id) ?? [];
      const pointer = `/capabilities/${ci}/criteria/${ri}`;
      if (records.length === 0) { findings.push(finding('evidence-missing', '@rubric', pointer, 'Criterion has no evidence record')); continue; }
      if (records.length > 1) { findings.push(finding('evidence-ambiguous', '@rubric', pointer, 'Criterion has multiple unordered evidence records')); continue; }
      const record = records[0];
      if (record.kind === 'self-rated') { findings.push(finding('self-rating-unverified', '@evidence', `/records/${record.ordinal}`, 'Self rating is not verified evidence')); continue; }
      const age = Date.parse(evidence.assessedAt) - Date.parse(record.capturedAt);
      if (age < 0) { findings.push(finding('evidence-future', '@evidence', `/records/${record.ordinal}`, 'Evidence date is after assessment')); continue; }
      if (age > criterion.maxAgeDays * 86400000) { findings.push(finding('evidence-stale', '@evidence', `/records/${record.ordinal}`, 'Evidence exceeds criterion maximum age')); continue; }
      if (!artifactExists(record.artifact)) { findings.push(finding('artifact-unavailable', '@evidence', `/records/${record.ordinal}`, 'Evidence artifact is unavailable inside root')); continue; }
      if (record.outcome === 'not-met') { findings.push(finding('criterion-not-met', '@evidence', `/records/${record.ordinal}`, 'Documented criterion outcome is not met')); continue; }
      verifiedWeight += criterion.weight;
      verified++;
    }
    scored.push({ capability: `capability-${ci + 1}`, assessmentDate: evidence.assessedAt.slice(0, 10), score: Math.round(verifiedWeight * 10000 / totalWeight) / 100, verifiedCriteria: verified, totalCriteria: cap.criteria.length });
  }
  return report(findings, criteria.length, scored);
}
