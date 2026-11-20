/**
 * Unit tests for the shared plumbing (node:test, run via `npm run test`).
 * ---------------------------------------------------------------------------
 * Synchronous assertions via node:assert — no floating promises, no mocks.
 * These are the checks that must hold for every future change to the lib.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunId } from '../src/lib/run-id.ts';
import { diffSnapshots } from '../src/lib/diff.ts';
import { toCsv } from '../src/lib/csv.ts';
import { sha256Hex, stableStringify, contentHash } from '../src/lib/hashing.ts';

test('computeRunId is deterministic for the same scenario set', () => {
  const a = computeRunId(['scn-core-001', 'scn-core-002'], '1.0.0');
  const b = computeRunId(['scn-core-002', 'scn-core-001'], '1.0.0');
  assert.equal(a, b, 'run id must not depend on scenario order');
  assert.match(a, /^offline-[0-9a-f]{10}$/);
});

test('computeRunId honours the override', () => {
  assert.equal(computeRunId(['scn-core-001'], '1.0.0', 'release-1'), 'release-1');
});

test('diffSnapshots reports added / removed / changed rows', () => {
  const before = {
    tables: {
      users: [
        { id: 'usr_1', name: 'Alice' },
        { id: 'usr_2', name: 'Bob' },
      ],
    },
  };
  const after = {
    tables: {
      users: [
        { id: 'usr_1', name: 'Alicia' },
        { id: 'usr_3', name: 'Carol' },
      ],
    },
  };
  const diff = diffSnapshots(before, after);
  assert.equal(diff.tables.users.added.length, 1);
  assert.equal(diff.tables.users.added[0].id, 'usr_3');
  assert.equal(diff.tables.users.removed.length, 1);
  assert.equal(diff.tables.users.removed[0].id, 'usr_2');
  assert.equal(diff.tables.users.changed.length, 1);
  assert.equal(diff.tables.users.changed[0].field, 'name');
  assert.equal(diff.tables.users.changed[0].before, 'Alice');
  assert.equal(diff.tables.users.changed[0].after, 'Alicia');
});

test('diffSnapshots reports no changes for identical snapshots', () => {
  const snap = { tables: { users: [{ id: 'usr_1', name: 'Alice' }] } };
  const diff = diffSnapshots(snap, snap);
  assert.equal(diff.tables.users.added.length, 0);
  assert.equal(diff.tables.users.removed.length, 0);
  assert.equal(diff.tables.users.changed.length, 0);
});

test('toCsv quotes fields containing commas, quotes and newlines', () => {
  const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'say "hi"' }]);
  assert.equal(csv, 'a,b\n"x,y","say ""hi"""\n');
});

test('toCsv renders booleans, numbers and nested objects deterministically', () => {
  const csv = toCsv(['flag', 'count', 'meta'], [{ flag: true, count: 3, meta: { z: 1, a: 2 } }]);
  assert.equal(csv, 'flag,count,meta\ntrue,3,"{""z"":1,""a"":2}"\n');
});

test('sha256Hex is stable and contentHash is key-order independent', () => {
  assert.equal(sha256Hex('abc'), sha256Hex('abc'));
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
  assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
});

test('stableStringify sorts object keys', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});
