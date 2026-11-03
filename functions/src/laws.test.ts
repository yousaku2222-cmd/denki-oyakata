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

const ins = LAWS.find((l) => l.id === "409M50000400052-58")!;
test("a law sentence may not carry numbers its article does not have", () => {
  const q = "曲げ角度の合計が 270 度を超えてはならない";
  const out = enforceSources(
    [
      { text: "PF管の曲げは1区間で合計270度までです。", source: "law", lawId: pf.id, quote: q },
      { text: "PF管の曲げは1区間で合計360度までです。", source: "law", lawId: pf.id, quote: q }, // the quote is real, the number is not
      { text: "無資格でも活線作業ができます。", source: "law", lawId: pf.id, quote: "であること。ただし、" }, // too short to stand for a rule
      // e-Gov writes 〇・一メガオーム and 百五十ボルト: they still match 0.1MΩ and 150V
      { text: "対地電圧150V以下の電路は0.1MΩ以上です（電技省令第58条）。", source: "law", lawId: ins.id, quote: "百五十ボルト以下の場合｜〇・一メガオーム" },
    ],
    new Set(),
    new Set([pf.id, ins.id]),
  );
  assert.deepEqual(out.map((s) => s.source), ["law", "general", "general", "law"]);
});

test("a wisdom sentence may not carry numbers its card does not have", () => {
  const card = "PF管は90度の曲がりが3か所あったらプルボックスを入れる";
  const out = enforceSources(
    [
      { text: "曲がりが3か所あればプルボックスを入れます。", source: "wisdom", cardId: "pf" },
      { text: "曲がりが5か所まではそのままでよいです。", source: "wisdom", cardId: "pf" },
    ],
    new Set(["pf"]),
    new Set(),
    () => card,
  );
  assert.deepEqual(out.map((s) => s.source), ["wisdom", "general"]);
});
