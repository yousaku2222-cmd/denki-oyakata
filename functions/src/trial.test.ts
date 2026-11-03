import { test } from "node:test";
import assert from "node:assert/strict";
import { callerIp } from "./limits";
import { cacheKey, normalizeQuestion, type Card } from "./ask";
import { spaceOf, spacesOf } from "./common";

test("callerIp takes the address Google appended, not what the caller sent", () => {
  assert.equal(callerIp("203.0.113.7"), "203.0.113.7");
  assert.equal(callerIp("1.2.3.4, 203.0.113.7"), "203.0.113.7"); // a forged front entry is ignored
  assert.equal(callerIp("9.9.9.9, 203.0.113.7, 35.191.1.2"), "203.0.113.7"); // Google's proxy after it is skipped
  assert.equal(callerIp(undefined, "198.51.100.1"), "198.51.100.1");
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
  assert.deepEqual(spacesOf({ trial: true }, "u1"), ["demo", "trial_u1"]);
  assert.deepEqual(spacesOf({}, "u1"), ["demo"]);
});
