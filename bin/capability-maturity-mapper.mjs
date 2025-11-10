#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { TOOL_ID, SEVERITY, report, evaluateMaturity } from '../src/index.mjs';

const MAX_BYTES = 262144, MAX_DEPTH = 4, MAX_RUNTIME_MS = 5000;
const usage = `Usage: ${TOOL_ID} --root DIR --rubric RELATIVE.json --evidence RELATIVE.json`;
const safeName = name => typeof name === 'string' && name.length > 0 && name.length <= 240 && !isAbsolute(name) && !name.split(/[\\/]/).includes('..') && !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(name);
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const finding = (ruleId, role, message) => ({ ruleId, severity: SEVERITY[ruleId], message, location: { file: role, pointer: '' } });

function readJson(root, name, role, deadline) {
  try {
    if (Date.now() > deadline) return { error: finding('timeout', role, 'Evaluation exceeded its runtime limit') };
    const path = realpathSync(resolve(root, name));
    if (!inside(root, path) || !statSync(path).isFile()) throw Error();
    if (statSync(path).size > MAX_BYTES) return { error: finding('input-too-large', role, 'Input exceeds 262144 bytes') };
    const bytes = readFileSync(path);
    if (bytes.length > MAX_BYTES) return { error: finding('input-too-large', role, 'Input exceeds 262144 bytes') };
    const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const stack = [[doc, 0]];
    while (stack.length) {
      if (Date.now() > deadline) return { error: finding('timeout', role, 'Evaluation exceeded its runtime limit') };
      const [value, depth] = stack.pop();
      if (depth > MAX_DEPTH) return { error: finding('depth-limit', role, 'JSON nesting exceeds depth four') };
      if (value !== null && typeof value === 'object') for (const child of Object.values(value)) if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
    }
    return { value: doc };
  } catch { return { error: finding('input-unavailable', role, 'Input could not be read, decoded or parsed') }; }
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(`${usage}\n`); return 0; }
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--root', '--rubric', '--evidence'].includes(argv[i]) || !argv[i + 1] || Object.hasOwn(args, argv[i])) { process.stderr.write(`${usage}\n`); return 2; }
    args[argv[i]] = argv[i + 1];
  }
  if (Object.keys(args).length !== 3 || !safeName(args['--rubric']) || !safeName(args['--evidence'])) { process.stderr.write(`${usage}\n`); return 2; }
  let root;
  try { root = realpathSync(args['--root']); if (!statSync(root).isDirectory()) throw Error(); }
  catch { process.stderr.write('Root must be a readable directory\n'); return 2; }
  const deadline = Date.now() + MAX_RUNTIME_MS;
  const rubric = readJson(root, args['--rubric'], '@rubric', deadline);
  const evidence = readJson(root, args['--evidence'], '@evidence', deadline);
  const errors = [rubric.error, evidence.error].filter(Boolean);
  const artifactExists = name => {
    if (!safeName(name)) return false;
    try { const path = realpathSync(resolve(root, name)); return inside(root, path) && statSync(path).isFile(); }
    catch { return false; }
  };
  const result = errors.length ? report(errors) : evaluateMaturity(rubric.value, evidence.value, { artifactExists, deadline });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`${result.status}: ${result.summary.checked} criteria, ${result.findings.length} findings\n`);
  return result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2;
}
process.exitCode = main(process.argv.slice(2));
