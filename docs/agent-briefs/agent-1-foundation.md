# Agent 1 — Foundation (tooling + shared plumbing)

You own: `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`,
`.gitignore`, `.env.example`, `.github/workflows/**`, `LICENSE`, `src/lib/**`
(EXCEPT `src/lib/assertions.ts`, which the orchestrator owns).

You do NOT own: `package.json` (scripts/deps are frozen — request changes in
your report), `src/contracts/**` (read-only), `tests/**`, `scripts/**`.

## Context

The repo is `agent-qa-lab`, ESM, TypeScript strict, Node ≥ 20, no transpiler
gymnastics. `tsx` runs TS directly, `tsc --noEmit` typechecks, `node --import
tsx --test tests/` runs unit tests. Read `docs/BUILD-CONTRACT.md` §9–§10 and
`src/contracts/types.ts` before writing anything.

## Deliverables

### 1. `tsconfig.json`

`strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution:
NodeNext`, `verbatimModuleSyntax: true`, `noEmit: true`, `skipLibCheck: true`,
`types: ["node"]`, `include: ["**/*.ts"]`, `exclude: ["node_modules", "runs",
"reports", "docs", "dist"]`. Imports must use explicit `.ts` extensions
(NodeNext requirement) — that is the house style, e.g.
`import { sha256Hex } from './hashing.ts'`.

### 2. `eslint.config.js` (ESM flat config)

`typescript-eslint` recommended + strict (no `any` without a comment, no
unused vars, `no-floating-promises`, `no-misused-promises`), plus
`eslint-config-prettier` equivalent: just set `linterOptions` and ignore
formatting rules (Prettier owns formatting — do NOT add eslint-plugin-prettier,
it is not installed). Ignore `node_modules`, `runs`, `reports`, `dist`,
`framework/promptfoo/**` (promptfoo's own JS style), `apps/under-test/ui/**`
if it exists. Every file must pass `--max-warnings 0`.

### 3. `.prettierrc` + `.prettierignore`

Prettier 3, `printWidth 100`, `singleQuote true`, `semi true`, `trailingComma
all`, `arrowParens always`, `endOfLine lf`. Ignore `node_modules`, `runs`,
`reports`, `dist`, `pnpm-lock.yaml`, `package-lock.json`.

### 4. `.gitignore`

`node_modules/`, `runs/` EXCEPT `runs/latest/.gitkeep` (commit the directory
with a `.gitkeep` so a fresh clone still has it), `reports/*.md` EXCEPT
`.gitkeep`, `data/`, `*.sqlite`, `dist/`, `.env`, `test-results/`,
`playwright-report/`, `.DS_Store`, `coverage/`.

### 5. `.env.example`

Every environment variable the repo reads, with empty values and a comment
explaining each and whether it is required (nothing but the defaults is
required for offline mode). Vars: `EVAL_MODE` (offline|live, default offline),
`MAX_RUN_COST_USD` (default 2), `APP_PORT` (4799), `PLAYWRIGHT_APP_PORT`
(4731), `RUN_ID` (optional override), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`. NO fake keys, no `your-key-here`.

### 6. `src/lib/env.ts` — environment validation with zod

```ts
export interface Env {
  evalMode: 'offline' | 'live';
  maxRunCostUsd: number;
  appPort: number;
  playwrightAppPort: number;
  runId?: string;
  anthropicKey?: string;
  openaiKey?: string;
  linearKey?: string;
  linearTeamId?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseHost: string;
}
export function loadEnv(source?: NodeJS.ProcessEnv): Env;
export function requireLiveKey(
  env: Env,
  key: 'anthropic' | 'openai' | 'linear' | 'langfuse',
): string;
```

- Read from `process.env` (the runner calls `process.loadEnvFile()` itself when
  `.env` exists — do not read files here).
- `requireLiveKey` throws a clear, actionable error when a live-mode key is
  missing (name the variable, say offline mode is the default).
- Zod schema for the validated subset; parse, don't validate by hand.

### 7. `src/lib/config.ts`

- `REPO_ROOT` (from `import.meta.url` — no hardcoded absolute paths),
  `APP_PORT = 4799`, `PLAYWRIGHT_APP_PORT = 4731`.
- `SUITES: Record<Suite, { dir: string; description: string }>` — smoke →
  `scenarios/smoke`, core → `scenarios/core`, redteam → `scenarios/redteam`.
- `BUG_FLAGS: readonly string[]` = the four latent bug flags in
  `docs/ARCHITECTURE.md` ("The four latent bugs"): `BUG_STALE_ROLE_CACHE`,
  `BUG_PARTIAL_LINE_ITEM_WRITE`, `BUG_UNLOGGED_TOOL_SPAN`,
  `BUG_HALLUCINATED_FALLBACK`.
- `PRICES`: list price table (USD per 1M tokens) for `claude-sonnet-4-5`,
  `claude-haiku-4-5`, `gpt-4o-mini`, `gpt-4o` — used only for cost _estimates_
  in live mode; a comment must say estimates are list-price based.
- `CSV_COLUMNS`: the 14 transcript columns from BUILD-CONTRACT §8, in order.

### 8. `src/lib/csv.ts`

```ts
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string;
export function writeCsv(path: string, columns: string[], rows: Record<string, unknown>[]): void;
```

RFC-4180 quoting (quotes doubled, fields with `,` `"` `\n` quoted), LF line
endings, trailing newline, no BOM, header row first. Cell rendering rules:
`null/undefined` → empty string; numbers → plain (`0`, `210000`, `0.12` for
costs — costs must render with exactly 2 decimals); booleans → `true`/`false`;
objects/arrays → `JSON.stringify`. Unit-testable pure functions.

### 9. `src/lib/hashing.ts`

```ts
export function sha256Hex(input: string): string;
export function stableStringify(value: unknown): string; // object keys sorted
export function contentHash(value: unknown): string; // sha256Hex(stableStringify(value))
```

Use `node:crypto`. Deterministic across runs and platforms.

### 10. `src/lib/json-io.ts`

```ts
export function readJson<T>(path: string): T;
export function writeJson(path: string, value: unknown): void; // 2-space indent, LF, trailing newline, mkdir -p
export function writeNdjson(path: string, values: unknown[]): void;
export function appendNdjson(path: string, value: unknown): void;
export function fileExists(path: string): boolean;
```

`writeJson` must key-preserving (do NOT sort keys — key order is meaningful in
report output) but stable given the same input object.

### 11. `src/lib/cost.ts`

```ts
export class CostMeter {
  constructor(public readonly ceilingUsd: number) {}
  add(usd: number): void;
  get totalUsd(): number;
  get exceeded(): boolean;
  assertWithinBudget(): void; // throws a polite, specific Error when exceeded
}
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number; // uses PRICES; unknown model → 0
```

### 12. `src/lib/diff.ts`

```ts
export function diffSnapshots(before: DbSnapshot, after: DbSnapshot): DbDiff;
```

`DbDiff` is in `src/contracts/types.ts`. Rules: rows keyed by their `id` field
(rows without `id` are compared by `JSON.stringify` of the whole row); per
table report `added`, `removed`, `changed` (only fields that actually differ);
tables present in neither snapshot are omitted; iterate tables alphabetically
for deterministic output.

### 13. `src/lib/run-id.ts`

```ts
export function computeRunId(scenarioIds: string[], codeVersion: string, override?: string): string;
```

`offline-<10 hex chars of sha256(sorted ids joined + codeVersion)>`, or the
override when provided.

### 14. `src/lib/logger.ts`

Tiny structured logger: `createLogger(name)` returning `{ info, warn, error,
debug }`, one line per message `LEVEL name message` (+ JSON detail object when
passed), writes to stderr for warn/error and stdout for info/debug, no ANSI
when `!process.stdout.isTTY`.

### 15. `.github/workflows/ci.yml`

On push + pull_request. Job on `ubuntu-latest`, Node matrix `[20, 22]`, `npm ci`,
then `npm run lint`, `npm run typecheck`, `npm run test`, `npm run eval:smoke`,
`npm run report`, `npx playwright test --config framework/playwright/
playwright.config.ts --list`, then `npx tsc --noEmit` covered by typecheck.
`actions/setup-node` with `cache: npm`. Fail the build on any non-zero exit.
Add a step that greps for forbidden leftovers and fails on any hit: `TODO`,
`FIXME`, `your-key-here`, `example.com`, `XXX` — search only tracked text
files under `src apps scenarios framework scripts tests docs` (use `grep -RnE`
and let non-zero exit fail the step).

### 16. `LICENSE`

MIT, copyright `2026 Praveenkumar P`.

## Acceptance (run these, paste output)

```bash
npx tsc --noEmit
npx eslint . --max-warnings 0
npx prettier --check src/lib .eslintrc.js eslint.config.js
npx tsx -e "import {diffSnapshots} from './src/lib/diff.ts'; ..."   # your own quick check
```

Plus one inline check of `toCsv` quoting (`a,b` → `"a,b"`, embedded quote →
`""`) and `computeRunId` stability across two calls.

## Report

Use the format from `docs/agent-briefs/_common.md` §7. If `tsconfig` options
conflict with code the other agents are writing, do not "fix" their code —
report the conflict.
