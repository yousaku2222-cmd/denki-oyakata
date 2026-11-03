import { test } from "node:test";
import assert from "node:assert/strict";
import { ipKey, today } from "./limits";
import { cacheKey, normalizeQuestion, type Card } from "./ask";
import { spaceOf } from "./common";

test("ipKey reads the address Google appended, not what the caller sent", () => {
  const real = ipKey("203.0.113.7", undefined);
  assert.equal(ipKey("1.2.3.4, 203.0.113.7", undefined), real); // a forged front entry does not change the key
  assert.equal(ipKey("9.9.9.9, 8.8.8.8, 203.0.113.7, 35.191.1.2", undefined), real); // Google's proxy after it is skipped
  assert.notEqual(ipKey("198.51.100.1", undefined), real);
  assert.equal(ipKey(undefined, "203.0.113.7"), real);
  assert.match(real, /^[0-9a-f]{16}$/); // never the address itself
});

test("the day turns at midnight in Japan", () => {
  assert.equal(today(Date.parse("2026-11-07T14:59:59Z")), "2026-11-07");
  assert.equal(today(Date.parse("2026-11-07T15:00:00Z")), "2026-11-08");
});

test("the same question in other spacing or punctuation shares a saved answer", () => {
  assert.equal(normalizeQuestion("PF管って 何回まで曲げていい？"), normalizeQuestion("PF管って何回まで曲げていい"));
  assert.equal(normalizeQuestion("ＰＦ管って何回まで曲げていい?"), normalizeQuestion("PF管って何回まで曲げていい？"));
  assert.notEqual(normalizeQuestion("PF管って何回まで曲げていい？"), normalizeQuestion("CD管って何回まで曲げていい？"));
});

test("a saved answer goes stale when the cards change", () => {
  const card = (id: string, ms: number) => ({ id, updatedAt: { toMillis: () => ms } }) as unknown as Card;
  const a = cacheKey("PF管", [card("a", 1), card("b", 2)]);
  assert.equal(cacheKey("PF管", [card("b", 2), card("a", 1)]).ver, a.ver); // order does not matter
  assert.notEqual(cacheKey("PF管", [card("a", 1), card("b", 3)]).ver, a.ver); // an edited card
  assert.notEqual(cacheKey("PF管", [card("a", 1)]).ver, a.ver); // a card made private
  assert.notEqual(cacheKey("PF管", [card("a", 1), card("b", 2), card("c", 4)]).ver, a.ver); // a new card
});

test("trial mode can only ever pick the caller's own space", () => {
  assert.equal(spaceOf({}, "u1"), "demo");
  assert.equal(spaceOf({ trial: "yes" }, "u1"), "demo");
  assert.equal(spaceOf({ trial: true }, "u1"), "trial_u1");
});
