import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { CAPS, USD_PER_DAY, USD_TOTAL, capOf, daysBetween, overBudget, parseLimitsConfig } from "./limits";
import { MAX_TRANSCRIPT_CHARS, safetyNote, turns } from "./common";
import { CARD_LIMITS, fitTerms, lawNumberNotes, termList, unsaidNumbers } from "./interview";
import { isBusy, systemBlocks } from "./claude";
import { costUsd } from "./usage";
import { MODEL_ANSWER } from "./models";

test("config/limits overrides only well-formed numbers of known kinds", () => {
  const cfg = parseLimitsConfig({ claude: { user: 60, all: "lots" }, nope: { user: 1 }, photo: { ip: -1 }, usdPerDay: 50, usdTotal: "x", usdFrom: "2026-11-08" });
  assert.deepEqual(cfg, { caps: { claude: { user: 60 }, photo: {} }, usdPerDay: 50, usdFrom: "2026-11-08" });
  const c = capOf("claude", cfg);
  assert.equal(c.user, 60);
  assert.equal(c.all, CAPS.claude.all); // not set: the default
  assert.match(c.userMsg, /60 回まで/); // the message says the cap in force
  assert.equal(capOf("claude").user, CAPS.claude.user);
  assert.deepEqual(parseLimitsConfig(undefined), { caps: {} });
});

test("the bill stops at the day's or the period's budget", () => {
  assert.equal(overBudget(USD_PER_DAY - 0.01, 0), false);
  assert.equal(overBudget(USD_PER_DAY, 0), true);
  assert.equal(overBudget(1, USD_TOTAL), true);
  assert.equal(overBudget(45, 45, { caps: {}, usdPerDay: 60 }), false); // raised in config/limits
  assert.deepEqual(daysBetween("2026-11-05", "2026-11-07"), ["2026-11-07", "2026-11-06", "2026-11-05"]);
  assert.deepEqual(daysBetween("2026-11-08", "2026-11-07"), []);
  assert.equal(daysBetween("2020-01-01", "2026-11-07").length, 62); // bounded reads
});

test("publishing edits and status changes have their own cap", () => {
  assert.ok(CAPS.edit.user > 0 && CAPS.edit.all > 0);
  assert.notEqual(CAPS.edit.prefix, CAPS.publish.prefix);
});

test("an interview is bounded by its total length, not only by its turns", () => {
  const long = Array.from({ length: 6 }, () => ({ role: "veteran", text: "あ".repeat(3000) }));
  assert.throws(() => turns(long), /長すぎます/);
  const fits = Math.floor(MAX_TRANSCRIPT_CHARS / 3000); // answers of the screen's 3000 characters that still fit
  assert.equal(turns(Array.from({ length: fits }, () => ({ role: "veteran", text: "あ".repeat(3000) }))).length, fits);
});

test("safety notes also cover heights, power tools and panels", () => {
  assert.match(safetyNote("脚立で天井に配管する時は？") ?? "", /高所/);
  assert.match(safetyNote("サンダーで切る時のコツ") ?? "", /電動工具/);
  assert.match(safetyNote("分電盤にブレーカーを増設するには？") ?? "", /感電/);
  assert.equal(safetyNote("PF管の色の違いは？"), null);
});

const draft = { title: "PF管の支持", scene: "天井の隠ぺい配管", body: "PF管は2.5mおきにサドルで止める", reason: "", caution: "", tags: ["PF管", "支持", "間隔"] };

test("a draft's numbers the veteran never said are listed", () => {
  assert.deepEqual(unsaidNumbers(draft, [{ role: "veteran", text: "PFはな、2.5メートルおきに止めとけ" }]), []);
  assert.deepEqual(unsaidNumbers({ ...draft, body: "PF管は1.5mおきに止める" }, [{ role: "veteran", text: "PFはな、2.5メートルおきに止めとけ" }]), ["1.5"]);
});

test("a card's measured values that no related article has are noted at publishing", () => {
  const notes = lawNumberNotes(draft);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /「2.5m」/);
  assert.deepEqual(lawNumberNotes({ ...draft, body: "PF管は1.5mおきにサドルで止める" }), []);
});

test("the system prompt carries a cache breakpoint on its last part", () => {
  const b = systemBlocks(["instructions", "list"]);
  assert.equal(b.length, 2);
  assert.equal(b[0].cache_control, undefined);
  assert.deepEqual(b[1].cache_control, { type: "ephemeral" });
  assert.deepEqual(systemBlocks("one")[0], { type: "text", text: "one", cache_control: { type: "ephemeral" } });
});

test("rate limits and overload count as busy, other errors do not", () => {
  const err = (status: number) => Anthropic.APIError.generate(status, { type: "error" }, "x", new Headers());
  assert.equal(isBusy(err(429)), true);
  assert.equal(isBusy(err(529)), true);
  assert.equal(isBusy(err(400)), false);
  assert.equal(isBusy(new Error("x")), false);
});

test("writing the prompt cache is priced at 1.25 times the input", () => {
  assert.equal(costUsd(MODEL_ANSWER, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }), 2.5);
});

test("a card's words get a meaning only as written on the card, once each, and a bad list is refused", () => {
  const card = { title: "プルボの中は束ねる", scene: "天井裏", body: "線が多か時は、プルボで分けて結束する。", reason: "", caution: "" };
  const t = (word: string, meaning = "意味") => ({ word, meaning });
  assert.deepEqual(
    fitTerms([t(" プルボ ", "プルボックス。電線をまとめて通す箱"), t("多か時は", "多い時は"), t("プルボ"), t("プルボックス"), t("結束", "結束"), t(""), t("天井裏", "")], card),
    [
      { word: "プルボ", meaning: "プルボックス。電線をまとめて通す箱" }, // trimmed; the second プルボ is dropped
      { word: "多か時は", meaning: "多い時は" },
    ],
  ); // not on the card (プルボックス), a meaning that only repeats the word, an empty word or meaning: left out
  const many = ["プ", "ル", "ボ", "中", "束", "天", "井", "裏", "線"].map((w) => t(w, `${w}の意味`));
  assert.equal(fitTerms(many, card).length, CARD_LIMITS.terms); // at most 8 words
  assert.deepEqual(termList(undefined), []);
  assert.deepEqual(termList([{ word: "プルボ", meaning: "プルボックス" }]), [{ word: "プルボ", meaning: "プルボックス" }]);
  assert.throws(() => termList("プルボ"), /8個まで/);
  assert.throws(() => termList(Array.from({ length: 9 }, () => ({ word: "a", meaning: "b" }))), /8個まで/);
  assert.throws(() => termList([null]), /形式が違います/);
  assert.throws(() => termList([{ word: "プルボ", meaning: "" }]), /言葉の意味を入れてください/);
  assert.throws(() => termList([{ word: "プルボ", meaning: "長".repeat(CARD_LIMITS.meaning + 1) }]), /長すぎます/);
  assert.throws(() => termList([{ word: "長".repeat(CARD_LIMITS.word + 1), meaning: "x" }]), /長すぎます/);
});
