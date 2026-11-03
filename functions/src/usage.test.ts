import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd, jstDay } from "./usage";
import { MODEL_ANSWER, MODEL_ROUTER } from "./models";

test("costUsd prices input, output and cache reads per million tokens", () => {
  assert.equal(costUsd(MODEL_ANSWER, { input_tokens: 1_000_000, output_tokens: 0 }), 2);
  assert.equal(costUsd(MODEL_ANSWER, { input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 }), 1.2);
  assert.ok(Math.abs(costUsd(MODEL_ROUTER, { input_tokens: 2000, output_tokens: 200 }) - 0.0003) < 1e-12);
});

test("an unknown model is counted at the top price, not for free", () => {
  assert.equal(costUsd("claude-unknown", { input_tokens: 1_000_000, output_tokens: 0 }), 4);
});

test("jstDay turns over at midnight in Japan, not in UTC", () => {
  assert.equal(jstDay(Date.parse("2026-11-08T14:59:00Z")), "2026-11-08");
  assert.equal(jstDay(Date.parse("2026-11-08T15:00:00Z")), "2026-11-09");
});
