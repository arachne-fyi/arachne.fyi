import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podiumSlots } from './podium.ts';

test('podium keys never repeat, whatever the ids and gaps', () => {
  for (let players = 0; players <= 4; players++) {
    for (let start = 0; start <= 3; start++) {
      const rows = Array.from({ length: players }, (_, i) => ({ userId: start + i }));
      for (const order of [rows, [...rows].reverse()]) {
        const keys = podiumSlots(order).map((s) => s.key);
        assert.equal(new Set(keys).size, keys.length, `${players} players from id ${start}: ${keys}`);
      }
    }
  }
});

test('first place stands in the middle', () => {
  const s = podiumSlots([{ userId: 7 }, { userId: 8 }, { userId: 9 }]);
  assert.deepEqual(s.map((x) => x.place), [2, 1, 3]);
  assert.equal(s[1]!.row!.userId, 7);
});
