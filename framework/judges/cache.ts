/**
 * Content-hash cache for live judge calls.
 * ---------------------------------------------------------------------------
 * Keyed on `contentHash({scenarioId, answer, rubricId, model})`, so re-running
 * the same judgement against the same answer is free: the stored verdict is
 * replayed instead of calling the model again.
 *
 * The cache is persisted as newline-delimited JSON so it is append-only and
 * byte-stable across runs (no wall-clock, ordering by insertion).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { contentHash } from '../../src/lib/hashing.ts';
import type { JudgeVerdict } from '../../src/contracts/types.ts';

export interface CacheEntry {
  key: string;
  verdict: JudgeVerdict;
  hits: number;
}

/** Deterministic cache key over the four values that fully define a judgement. */
export function cacheKey({
  scenarioId,
  answer,
  rubricId,
  model,
}: {
  scenarioId: string;
  answer: string;
  rubricId: string;
  model: string;
}): string {
  return contentHash({ scenarioId, answer, rubricId, model });
}

/**
 * In-memory + persisted cache. Writes are appended to `path` as NDJSON;
 * `save()` rewrites the whole file from the map so the file stays compact and
 * deduped by key. `load()` replays the file into the map.
 */
export class JudgeCache {
  private entries = new Map<string, JudgeVerdict>();

  constructor(public readonly path: string) {}

  /** Return the cached verdict for `key`, or `undefined` when absent. */
  get(key: string): JudgeVerdict | undefined {
    const cached = this.entries.get(key);
    if (cached === undefined) return undefined;
    return { ...cached, cached: true };
  }

  /** Store a freshly computed verdict under `key` (not yet marked cached). */
  set(key: string, verdict: JudgeVerdict): void {
    this.entries.set(key, { ...verdict, cached: false });
  }

  /** Number of distinct keys held. */
  get size(): number {
    return this.entries.size;
  }

  /** Replay the persisted cache file into memory. Silent when the file is absent. */
  load(): void {
    if (!existsSync(this.path)) return;
    const text = readFileSync(this.path, 'utf8').trimEnd();
    if (text.length === 0) return;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const entry = JSON.parse(trimmed) as CacheEntry;
      this.entries.set(entry.key, entry.verdict);
    }
  }

  /** Persist the whole map to `path`, creating parent directories. */
  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const entries: CacheEntry[] = [];
    for (const [key, verdict] of this.entries) {
      entries.push({ key, verdict, hits: 1 });
    }
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const body = entries.map((entry) => JSON.stringify(entry)).join('\n');
    writeFileSync(this.path, entries.length === 0 ? '' : `${body}\n`, 'utf8');
  }
}
