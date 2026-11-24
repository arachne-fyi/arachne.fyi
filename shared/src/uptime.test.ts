import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipMs, fightOutcome, union, uptimeSegments, type FightFacts } from './uptime.ts';

const S = 1000;
const T0 = 1_800_000_000_000;
const fight = (spawn: number, len: number, damage: number | null): FightFacts => ({
  spawnTs: T0 + spawn * S,
  deathTs: T0 + (spawn + len) * S,
  damage,
  damageTs: damage == null ? null : T0 + (spawn + len) * S + 500,
  interruptTs: null,
});
const LATE = T0 + 86_400_000;
const rel = (segs: { start: number; end: number }[]) =>
  segs.map((s) => [(s.start - T0) / S, (s.end - T0) / S]);

test('a damaged boss starts uptime at its spawn and it ends 30s after the last death', () => {
  assert.deepEqual(rel(uptimeSegments([fight(0, 10, 50_000)], LATE)), [[0, 40]]);
});

test('back-to-back damaged bosses form one segment', () => {
  const fights = [fight(0, 10, 50_000), fight(30, 10, 50_000), fight(65, 10, 20_000)];
  assert.deepEqual(rel(uptimeSegments(fights, LATE)), [[0, 105]]);
});

test('a boss that was not damaged stops uptime at its spawn', () => {
  const fights = [fight(0, 10, 50_000), fight(25, 10, 0), fight(50, 10, 50_000)];
  assert.deepEqual(rel(uptimeSegments(fights, LATE)), [
    [0, 25],
    [50, 90],
  ]);
});

test('a missing damage line counts as not damaged', () => {
  const fights = [fight(0, 10, 50_000), fight(25, 10, null)];
  assert.deepEqual(rel(uptimeSegments(fights, LATE)), [[0, 25]]);
});

test('a gap over 30s splits segments', () => {
  const fights = [fight(0, 10, 50_000), fight(100, 10, 50_000)];
  assert.deepEqual(rel(uptimeSegments(fights, LATE)), [
    [0, 40],
    [100, 140],
  ]);
});

test('low but non-zero damage still counts as taking part, though not as a kill', () => {
  const f = fight(0, 10, 500);
  assert.equal(fightOutcome(f), 'LOW_DAMAGE');
  assert.deepEqual(rel(uptimeSegments([f], LATE)), [[0, 40]]);
});

test('leaving mid-fight ends uptime at that moment with no grace', () => {
  const fights: FightFacts[] = [
    fight(0, 10, 50_000),
    { spawnTs: T0 + 20 * S, deathTs: null, damage: null, damageTs: null, interruptTs: T0 + 26 * S },
  ];
  assert.deepEqual(rel(uptimeSegments(fights, LATE)), [[0, 26]]);
});

test('an open fight extends a running segment up to now', () => {
  const fights: FightFacts[] = [
    fight(0, 10, 50_000),
    { spawnTs: T0 + 20 * S, deathTs: null, damage: null, damageTs: null, interruptTs: null },
  ];
  assert.deepEqual(rel(uptimeSegments(fights, T0 + 28 * S)), [[0, 28]]);
});

test('a death waiting for its damage line does not cut the segment', () => {
  const fights = [fight(0, 10, 50_000), fight(20, 5, null)];
  assert.deepEqual(rel(uptimeSegments(fights, T0 + 26 * S)), [[0, 26]]);
});

test('damage reported later than 5s after death is not a kill', () => {
  const f = fight(0, 10, 50_000);
  f.damageTs = f.deathTs! + 6_000;
  assert.equal(fightOutcome(f), 'MISSING_DAMAGE');
});

test('clip and union', () => {
  const a = [{ start: 0, end: 100 }];
  const b = [
    { start: 50, end: 150 },
    { start: 300, end: 400 },
  ];
  assert.equal(clipMs(b, 100, 350), 100);
  assert.deepEqual(union([a, b]), [
    { start: 0, end: 150 },
    { start: 300, end: 400 },
  ]);
});
