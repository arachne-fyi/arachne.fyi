import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinsToMoney } from './catalog.ts';

test('real money: one cookie of coins costs 325 gems of the 1,800-gem pack', () => {
  const cookie = 13_000_000;
  assert.ok(Math.abs(coinsToMoney(cookie, cookie, 'GBP') - (325 / 1800) * 13.63) < 1e-9);
  assert.ok(Math.abs(coinsToMoney(cookie, cookie, 'USD') - (325 / 1800) * 17.99) < 1e-9);
  assert.ok(Math.abs(coinsToMoney(10 * cookie, cookie, 'GBP') - 10 * (325 / 1800) * 13.63) < 1e-9);
});

test('real money: no cookie price means nothing to show', () => {
  assert.equal(coinsToMoney(1_000_000, 0, 'GBP'), 0);
});
