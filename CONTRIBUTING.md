# Contributing

## Add a new scenario in 5 steps

1. **Copy an example.** `cp scenarios/_examples/scn-smoke-001.json scenarios/core/scn-core-031.json`
   (ids are `scn-<suite>-<3 digits>`, sequential within the suite).

2. **Write a genuine user problem.** `userProblem` must start from a real task
   ("Marcus Webb just confirmed Bolt want to negotiate…"), never a greeting.
   Pick a `persona` from the six seeded users.

3. **Add at least two assertions**, one deterministic (`tool-called`,
   `db-field-equals`, `db-consistency`, …) and one judged (`llm-rubric`).
   Assertion ids are `A01`, `A02`, … Reference real seed ids from
   `docs/BUILD-CONTRACT.md` §3 (`con_001`, `dls_002`, …).

4. **Validate.**

   ```bash
   npx tsx -e "import {parseScenario} from './scenarios/_schema.ts'; import {readFileSync} from 'node:fs'; parseScenario(JSON.parse(readFileSync('scenarios/core/scn-core-031.json','utf8')), 'x'); console.log('valid')"
   ```

5. **Run it.**

   ```bash
   npm run eval -- --suite core          # or --suite smoke / redteam
   npm run eval:hardened -- --suite core # must pass with bugs off
   ```

   A scenario is **fair** iff it passes in hardened mode. If it fails there,
   the assertion is wrong, not the agent.

## Ground rules

- British spelling in prose; camelCase in code.
- No `TODO`/`FIXME`/`your-key-here`/`example.com` — CI greps for them.
- No wall-clock timestamps in generated artefacts.
- Every scenario ships with `rationale` — why it exists, what it proves.
- `npm run verify` must stay green.
