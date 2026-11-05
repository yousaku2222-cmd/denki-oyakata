import { test } from "node:test";
import assert from "node:assert/strict";
import { LAWS, quoteSentence } from "./laws";
import { conclusionChecked, enforceSources, polarityFlipped } from "./ask";
import type { Sentence } from "./common";

const g17 = LAWS.find((l) => l.id === "kaishaku-17")!;
const pf = LAWS.find((l) => l.id === "shiyo-2.3.3")!;

test("a law sentence's numbers are checked against the quoted sentence, not the whole article", () => {
  const d = "接地抵抗値は、100Ω（低圧電路において、地絡を生じた場合に0.5秒以内に当該電路を自動的に遮断する装置を施設するときは、500Ω）以下であること。";
  const out = enforceSources(
    [
      { text: "D種接地工事の接地抵抗値は100Ω以下です。", source: "law", lawId: g17.id, quote: d },
      // 10Ω is in 第17条 (A種), but not in the D種 sentence that was quoted
      { text: "D種接地工事の接地抵抗値は10Ω以下です。", source: "law", lawId: g17.id, quote: d },
      // the article's own number is a place, not a value; a bare 17 is not
      { text: "電技解釈第17条では、D種は100Ω以下です。", source: "law", lawId: g17.id, quote: d },
      { text: "D種は17Ω以下です。", source: "law", lawId: g17.id, quote: d },
      // a number from the same sentence as the quote (1 区間) still counts
      { text: "PF管の曲げは1区間で合計270度までです。", source: "law", lawId: pf.id, quote: "曲げ角度の合計が 270 度を超えてはならない" },
    ],
    new Set(),
    new Set([g17.id, pf.id]),
  );
  assert.deepEqual(out.map((s) => s.source), ["law", "general", "law", "general", "law"]);
});

test("quoteSentence is the sentence of the original around the quote", () => {
  assert.match(quoteSentence("曲げ角度の合計が 270 度を超えてはならない", pf.text), /^\(3\)分岐回路の配管1区間の屈曲箇所は、4箇所以下とし、曲げ角度の合計が270度を超えてはならない。$/);
  assert.equal(quoteSentence("どこにも無い文", pf.text), "どこにも無い文");
});

const s = (text: string, source: Sentence["source"] = "law"): Sentence => ({ text, source });
const answer = [s("PF管の支持点間の距離は1.5m以下です。"), s("曲げ角度の合計は270度以下です。"), s("現場では1mおきに止めると安心です。", "general")];

test("a conclusion passes when its numbers are in the sentences it names", () => {
  assert.equal(conclusionChecked("支持は1.5m以下、曲げは合計270度までです。", [1, 2], answer), "支持は1.5m以下、曲げは合計270度までです。");
});

test("a conclusion is dropped for look-alike numbers, kanji numbers, length and unnamed sentences", () => {
  assert.equal(conclusionChecked("支持は5m以下、曲げは合計70度までです。", [1, 2], answer), null); // 5 from 1.5, 70 from 270
  assert.equal(conclusionChecked("支持は二メートル以下です。", [1], answer), null); // 二 → 2, not in the sentences
  assert.equal(conclusionChecked("支持は1.5m以下です。".repeat(10), [1], answer), null); // over 90 characters
  assert.equal(conclusionChecked("支持は1.5m以下です。", [], answer), null); // names no sentence
  assert.equal(conclusionChecked("支持は1.5m以下です。", [9], answer), null); // names a sentence that is not there
  assert.equal(conclusionChecked("1mおきに止めます。", [1], answer), null); // the 1m is only in a sentence it did not name
});

test("a conclusion is not built on general knowledge alone (unless there is a calculation)", () => {
  assert.equal(conclusionChecked("1mおきに止めると安心です。", [3], answer), null);
  assert.equal(conclusionChecked("1mおきに止めると安心です。", [3], answer, "支持間隔の判定: 1m … ○"), "1mおきに止めると安心です。");
});

test("a conclusion may not turn can into cannot, or back", () => {
  const lic = [s("第二種電気工事士でなければ、一般用電気工作物の電気工事の作業に従事できません。"), s("軽微な作業は資格がなくても従事できます。")];
  assert.equal(conclusionChecked("資格がなくても、配線の工事はできません。", [1], lic), "資格がなくても、配線の工事はできません。");
  assert.equal(conclusionChecked("第二種電気工事士でなくても作業できます。", [1], lic), null); // the sentence only says cannot
  assert.equal(conclusionChecked("軽微な作業もできません。", [2], lic), null); // the sentence never says no
  assert.equal(polarityFlipped("270度以下です。", "270度を超えてはならない。"), false); // a rule's limit said the other way round is fine
});
