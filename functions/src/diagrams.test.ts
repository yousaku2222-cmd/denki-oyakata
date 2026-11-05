import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getLawById, normalizeForQuote, quoteIsInOriginal } from "./laws";

// 「図で見る」 (web/src/Diagrams.tsx) draws only the numbers in web/src/diagramFacts.ts: check them against the originals.
// That file has no imports and only erasable types, so Node loads it as it is (a variable path keeps tsc out of it).
type Fact = { lawId: string; when: string[]; sources: string[] };
type Facts = {
  BEND_FACTS: (Fact & { bends: number; total: number; each: number })[];
  SUPPORT_FACTS: (Fact & { meters: number })[];
  factFor: <T extends Fact>(facts: T[], lawId: string, quote: string) => T | undefined;
};
const FILE = join(__dirname, "..", "..", "web", "src", "diagramFacts.ts");
const load = (): Promise<Facts> => import(pathToFileURL(FILE).href);

/** The number stands alone in the words (1 is not taken from 1.5, nor 27 from 270). */
const hasNumber = (words: string, n: number) => new RegExp(`(?<![0-9.])${String(n).replace(".", "\\.")}(?!\\.?[0-9])`).test(normalizeForQuote(words));

test("every number in a figure is in the words of its article", async () => {
  const { BEND_FACTS, SUPPORT_FACTS } = await load();
  const all: [Fact, number[]][] = [...BEND_FACTS.map((f): [Fact, number[]] => [f, [f.bends, f.total, f.each]]), ...SUPPORT_FACTS.map((f): [Fact, number[]] => [f, [f.meters]])];
  for (const [f, nums] of all) {
    const law = getLawById(f.lawId);
    assert.ok(law, `${f.lawId} is not in laws.json`);
    for (const s of f.sources) assert.ok(quoteIsInOriginal(s, law.text), `${f.lawId}: 「${s}」 is not in the original`);
    for (const n of nums) assert.ok(f.sources.some((s) => hasNumber(s, n)), `${f.lawId}: ${n} is not in its source words`);
  }
});

test("the number check does not take a number out of a bigger one", () => {
  assert.equal(hasNumber("その取付け間隔は 1.5ｍ以下とする", 1), false);
  assert.equal(hasNumber("その取付け間隔は 1.5ｍ以下とする", 1.5), true);
  assert.equal(hasNumber("曲げ角度の合計が 270 度", 27), false);
});

test("a quote calls for the figure of what it says", async () => {
  const { BEND_FACTS, SUPPORT_FACTS, factFor } = await load();
  // quotes from real answers (docs/accuracy.md)
  assert.equal(factFor(BEND_FACTS, "shiyo-2.3.3", "屈曲箇所は、4 箇所以下とし")?.total, 270);
  assert.equal(factFor(BEND_FACTS, "shiyo-2.3.3", "曲げ角度の合計が 270 度を超えては")?.bends, 4);
  assert.equal(factFor(SUPPORT_FACTS, "shiyo-2.3.4", "サドル、クリップ、ハンガ等を使用し、その取付け間隔は 1ｍ以下とする。")?.meters, 1);
  assert.equal(factFor(SUPPORT_FACTS, "shiyo-2.4.3", "管の支持は、サドル、ハンガ等を使用し、その取付け間隔は、1.5ｍ以下とする。")?.meters, 1.5);
  assert.equal(factFor(SUPPORT_FACTS, "kaishaku-158", "管の支持点間の距離は1.5m以下とし")?.meters, 1.5);
  // another rule of the same article gets no figure
  assert.equal(factFor(SUPPORT_FACTS, "shiyo-2.3.3", "屈曲箇所は、4 箇所以下とし"), undefined);
  assert.equal(factFor(SUPPORT_FACTS, "shiyo-2.3.3", "1ｍ以下の間隔で鉄筋に結束し"), undefined);
  assert.equal(factFor(BEND_FACTS, "shiyo-2.4.4", "管を支持する金物は、鋼製とし"), undefined);
  assert.equal(factFor(SUPPORT_FACTS, "kaishaku-158", "合成樹脂管内では、電線に接続点を設けないこと。"), undefined);
});
