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

test("a saved answer goes stale when the cards' contents change, not when they are only saved again", () => {
  const card = (id: string, body: string, ms = 1) => ({ id, title: id, scene: "", body, reason: "", caution: "", tags: [], showAuthorName: true, authorName: "", updatedAt: { toMillis: () => ms } }) as unknown as Card;
  const a = cacheKey("PF管", [card("a", "x"), card("b", "y")]);
  assert.equal(cacheKey("PF管", [card("b", "y"), card("a", "x")]).ver, a.ver); // order does not matter
  assert.equal(cacheKey("PF管", [card("a", "x", 5), card("b", "y", 9)]).ver, a.ver); // saved again (or hidden and shown again) unchanged
  assert.notEqual(cacheKey("PF管", [card("a", "x"), card("b", "y2")]).ver, a.ver); // an edited card
  assert.notEqual(cacheKey("PF管", [card("a", "x")]).ver, a.ver); // a card made private
  assert.notEqual(cacheKey("PF管", [card("a", "x"), card("b", "y"), card("c", "z")]).ver, a.ver); // a new card
  const before = process.env.K_REVISION;
  process.env.K_REVISION = "another-deploy";
  assert.equal(cacheKey("PF管", [card("a", "x"), card("b", "y")]).ver, a.ver); // a deploy alone keeps the saved answers
  if (before === undefined) delete process.env.K_REVISION;
  else process.env.K_REVISION = before;
});

test("trial mode can only ever pick the caller's own space", () => {
  assert.equal(spaceOf({}, "u1"), "demo");
  assert.equal(spaceOf({ trial: "yes" }, "u1"), "demo");
  assert.equal(spaceOf({ trial: true }, "u1"), "trial_u1");
  assert.deepEqual(spacesOf({ trial: true }, "u1"), ["demo", "trial_u1"]);
  assert.deepEqual(spacesOf({}, "u1"), ["demo"]);
});
