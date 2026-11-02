import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCards } from "./search";
import { enforceSources } from "./ask";

const base = { scene: "", body: "", reason: "", caution: "", tags: [] as string[] };
const cards = [
  { ...base, id: "pf", title: "PF管を曲げすぎると通線できない", body: "90度の曲がりが3か所あったらプルボックスを入れる", tags: ["PF", "合成樹脂可とう電線管"] },
  { ...base, id: "bk", title: "100V用と200V用の安全ブレーカを間違えない", body: "形が同じなので表示を確かめる", tags: ["ブレーカ"] },
];

test("finds the PF card from colloquial wording", () => {
  const r = searchCards("PF管って何回まで曲げていい？", cards);
  assert.equal(r[0]?.card.id, "pf");
});

test("returns nothing for an unrelated question", () => {
  assert.equal(searchCards("今日の天気は？", cards).length, 0);
});

test("wisdom sentences pointing at unknown cards fall back to general", () => {
  const out = enforceSources(
    [
      { text: "a", source: "wisdom", cardId: "pf" },
      { text: "b", source: "wisdom", cardId: "made-up" },
      { text: "c", source: "law" },
    ],
    new Set(["pf"]),
  );
  assert.deepEqual(out.map((s) => s.source), ["wisdom", "general", "general"]);
});
