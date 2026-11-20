# src/lib — shared plumbing

Pure, dependency-light helpers every other module (runner, verifier, judges,
observability, triage, red team) builds on. Nothing here talks to the network
or the clock: every function is deterministic, so artefacts regenerated from
the same inputs are byte-identical. Offline behaviour is the only behaviour —
there is no live mode in this directory.

## Modules

| File         | Does                                                                                  | Key exports                                                          |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `env.ts`     | Zod-validated environment (offline defaults; live keys demanded only in live mode)    | `loadEnv`, `requireLiveKey`, `Env`                                   |
| `config.ts`  | Repo root, ports, suites, latent bug flags, model price table, transcript CSV columns | `REPO_ROOT`, `SUITES`, `BUG_FLAGS`, `PRICES`, `CSV_COLUMNS`          |
| `csv.ts`     | RFC-4180 CSV writing with the repo's cell-rendering rules                             | `toCsv`, `writeCsv`                                                  |
| `hashing.ts` | SHA-256 plus canonical (key-sorted) JSON serialisation                                | `sha256Hex`, `stableStringify`, `contentHash`                        |
| `json-io.ts` | Key-order-preserving JSON / NDJSON file IO with `mkdir -p`                            | `readJson`, `writeJson`, `writeNdjson`, `appendNdjson`, `fileExists` |
| `cost.ts`    | Cost meter with a ceiling; list-price estimates                                       | `CostMeter`, `estimateCostUsd`                                       |
| `diff.ts`    | Field-level diff of two DB snapshots                                                  | `diffSnapshots`                                                      |
| `run-id.ts`  | Deterministic run id from scenario ids + code version                                 | `computeRunId`                                                       |
| `logger.ts`  | One-line structured logger to stdout/stderr                                           | `createLogger`                                                       |

The frozen data contracts these helpers consume live in `src/contracts/`
(`DbSnapshot`, `DbDiff`, `Suite`, and the rest); this directory only reads them.

## Run it alone

Nothing needs building — `tsx` runs TypeScript directly:

```bash
npx tsx -e 'import { computeRunId } from "./src/lib/run-id.ts";
console.log(computeRunId(["s2", "s1"], "v1"));'
```

Quality gates (see `package.json` for the script names):

```bash
npx tsc --noEmit
npx eslint . --max-warnings 0
npx prettier --check src/lib
```

## Inputs and outputs

- **Inputs:** a `NodeJS.ProcessEnv` (for `env.ts`), file paths (for the IO
  helpers), and the frozen contract types (for `diff.ts`).
- **Outputs:** plain values and files: UTF-8 JSON (two-space indent, LF,
  trailing newline), NDJSON, CSV (LF, trailing newline, no BOM), and log lines
  on stdout/stderr. No timestamps are ever embedded — ordering is by id.

## Notes

- `PRICES` holds published list prices and is used for cost **estimates only**
  in live mode; it is never a live pricing API call.
- Money in the contracts is integer cents; `cost_usd` in CSV renders with
  exactly two decimals.
- Spelling in these docs and in prose comments is British; identifiers follow
  JavaScript convention (`normalizeCandidate`).
