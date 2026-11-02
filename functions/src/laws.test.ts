import { test } from "node:test";
import assert from "node:assert/strict";
import { LAWS, quoteIsInOriginal, searchLaws } from "./laws";
import { enforceSources } from "./ask";

const pf = LAWS.find((l) => l.id === "shiyo-2.3.3")!;

test("a quote copied from the original passes even across PDF line breaks", () => {
  assert.ok(quoteIsInOriginal("曲げ角度の合計が 270 度を超えてはならない", pf.text));
});

test("a reworded or changed quote fails", () => {
  assert.equal(quoteIsInOriginal("曲げ角度の合計が 360 度を超えてはならない", pf.text), false);
  assert.equal(quoteIsInOriginal("曲げは合計270度まで", pf.text), false);
  assert.equal(quoteIsInOriginal("270度", pf.text), false); // too short to mean anything
});

test("law search finds the right articles from site words", () => {
  assert.ok(searchLaws("PF管 支持 間隔 隠ぺい").some((l) => l.id === "shiyo-2.3.3"));
  assert.ok(searchLaws("資格が無くても出来る 軽微な工事").some((l) => l.id === "335CO0000000260-1"));
  assert.ok(searchLaws("絶縁抵抗 何MΩ 低圧").some((l) => l.id === "409M50000400052-58"));
});

test("law sentences are verified or downgraded", () => {
  const out = enforceSources(
    [
      { text: "a", source: "law", lawId: pf.id, quote: "「分岐回路の配管 1 区間の屈曲箇所は、4 箇所以下とし」" },
      { text: "b", source: "law", lawId: pf.id, quote: "屈曲箇所は5箇所までよい" },
      { text: "c", source: "law", lawId: "kaishaku-17", quote: "A種接地工事は、次の各号によること。" }, // not offered to the model
    ],
    new Set(),
    new Set([pf.id]),
  );
  assert.deepEqual(out.map((s) => [s.source, s.verified ?? false]), [["law", true], ["general", false], ["general", false]]);
});
