# Capability Maturity Mapper

Score a user supplied rubric against dated local evidence of repeatability, controls and recovery. Verified, documented `met` criteria contribute to a weighted score; self ratings never do. Offline, read-only Node.js 22+ tool with no dependencies.

```sh
node bin/capability-maturity-mapper.mjs --root examples/pass --rubric rubric.json --evidence evidence.json
node bin/capability-maturity-mapper.mjs --root examples/fail --rubric rubric.json --evidence evidence.json
npm run check
```

The first command exits 0 with a score of 100. The second exits 1 because a documented control is not met. Missing, stale, ambiguous, self rated or inaccessible evidence exits 2 as `incomplete` and earns no verified credit. The output uses ordinal capability labels and logical source roles; raw capability names, criterion IDs and artifact paths stay private. `src/index.mjs` exports `TOOL_ID` and `evaluateMaturity` for direct use. See [rules and limits](docs/README.md).
