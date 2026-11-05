import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { LAWS, getLawById } from "./laws";
import { CheckFields, CheckItem, LEGAL_SOURCES, SPEC_SOURCES, SavedCheck, cardSentences, checkItems, isLegal, keptSentences, lawCandidates, shownCard, splitSentences } from "./lawcheck";

const card: CheckFields = {
  title: "コンセントの取り替えは資格なしでよか",
  scene: "",
  body: "資格がなくてもコンセントの取り替えくらいはしてよか。電源を切ってから付け替える。\n「プルボ」は使わん。",
  reason: "簡単な作業やけん。",
  caution: "",
};
const PF = "shiyo-2.3.3";
const LICENSE = "335AC0000000139-3";
const pfQuote = "曲げ角度の合計が 270 度を超えてはならない";
const licQuote = "第二種電気工事士」という。）でなければ、一般用電気工作物等に係る電気工事の作業";

test("a field is cut into its sentences as written", () => {
  assert.deepEqual(splitSentences("一つ目。二つ目！\n三つ目「プルボ」です。」\n\n四つ目"), ["一つ目。", "二つ目！", "三つ目「プルボ」です。」", "四つ目"]);
  assert.deepEqual(splitSentences("  \n。"), []);
  const s = cardSentences(card);
  assert.deepEqual(s.map((x) => x.field), ["title", "body", "body", "body", "reason"]);
  for (const x of s) assert.ok(card[x.field].includes(x.text)); // each one is on the card word for word
});

test("a card about licences is checked against 電気工事士法 第3条", () => {
  assert.ok(lawCandidates(card, []).some((l) => l.id === LICENSE));
  assert.ok(lawCandidates({ title: "PF管の曲げ", scene: "", body: "PF管は曲がり3つでプルボックスを入れる。", reason: "", caution: "" }, ["PF"]).some((l) => l.id === PF));
});

test("only sentences of the card, articles given and quotes in the original keep their mark", () => {
  const s = cardSentences(card);
  const out = checkItems(
    [
      { n: 2, verdict: "differs", lawId: LICENSE, quote: licQuote, note: "条文では、電気工事士でなければこの作業はできません。確かめてください。" },
      { n: 2, verdict: "same", lawId: LICENSE, quote: licQuote, note: "" }, // once each
      { n: 1, verdict: "same", lawId: LICENSE, quote: "資格が無くても良いとする。", note: "" }, // not in the original: dropped
      { n: 3, verdict: "differs", lawId: LICENSE, quote: "言い換えた引用です、原文にはありません", note: "条文と違うかもしれません。" }, // 要確認
      { n: 4, verdict: "stricter", lawId: PF, quote: pfQuote, note: "" }, // an article that was not given
      { n: 5, verdict: "unrelated", lawId: "", quote: "", note: "" },
      { n: 9, verdict: "same", lawId: LICENSE, quote: licQuote, note: "" }, // no such sentence
      { n: 1, verdict: "differs", lawId: LICENSE, quote: licQuote, note: "" }, // a difference with nothing to say
    ],
    s,
    new Set([LICENSE]),
  );
  assert.deepEqual(
    out.map((x) => [x.n, x.verdict, x.lawId, x.field]),
    [
      [2, "differs", LICENSE, "body"],
      [3, "unsure", "", "body"],
    ],
  );
  assert.equal(out[0].text, "資格がなくてもコンセントの取り替えくらいはしてよか。");
  assert.match(out[0].label, /電気工事士法 第3条/);
  assert.equal(out[1].quote, "");
  assert.deepEqual(out.map((x) => x.legal), [true, true], "電気工事士法 is law; 要確認 keeps the kind of the article the AI named");
  const spec = checkItems([{ n: 3, verdict: "differs", lawId: PF, quote: "原文に無い引用です、照合で外れます", note: "仕様書と違うかもしれません。" }], s, new Set([PF]));
  assert.equal(spec[0].legal, false, "a 要確認 against 標準仕様書 is not law");
});

test("laws and the public works standard are told apart by the source, for every article in laws.json", () => {
  for (const l of LAWS) assert.ok(LEGAL_SOURCES.has(l.lawName) !== SPEC_SOURCES.has(l.lawName), `${l.id}: put 「${l.lawName}」 in LEGAL_SOURCES or SPEC_SOURCES`);
  for (const l of LAWS) assert.equal(isLegal(l), !l.id.startsWith("shiyo-"), l.id);
  assert.equal(isLegal(getLawById(LICENSE)!), true);
  assert.equal(isLegal(getLawById("kaishaku-158")!), true, "電技解釈 counts as law");
  assert.equal(isLegal(getLawById(PF)!), false);
  assert.equal(isLegal({ ...getLawById(PF)!, lawName: "まだどちらにも入れていない基準" }), true, "an unknown source: the safe side");
});

test("young workers get the checked card without its ⚠️ and 🔍 sentences", () => {
  const sentences = cardSentences(card);
  const item = (n: number, verdict: CheckItem["verdict"], legal = true): CheckItem => ({ n, field: sentences[n - 1].field, text: sentences[n - 1].text, verdict, lawId: legal ? LICENSE : PF, label: "", quote: verdict === "unsure" ? "" : legal ? licQuote : pfQuote, note: "x", legal });
  const saved: SavedCheck = { at: Timestamp.fromMillis(1_000), sentences, items: [item(2, "differs"), item(3, "same"), item(4, "unsure")] };

  const r = shownCard(saved, card);
  assert.ok(r.ok);
  assert.equal(r.fields.body, "電源を切ってから付け替える。"); // the line left empty goes too
  assert.equal(r.fields.title, card.title);
  assert.equal(r.fields.reason, card.reason);
  assert.equal(r.hidden, 2);
  assert.deepEqual(r.summary, { checkedAt: 1_000 }, "only that it was checked: no counts on the public card");
  assert.ok(!JSON.stringify(r.fields).includes("資格がなくても") && !JSON.stringify(r.fields).includes("プルボ"));

  // a sentence the veteran took out on the screen is simply gone; spaces and line breaks left behind do not count
  const taken = { ...card, body: card.body.replace(sentences[1].text, "　") };
  const t = shownCard(saved, taken);
  assert.ok(t.ok);
  assert.equal(t.fields.body, "電源を切ってから付け替える。");
  assert.equal(t.hidden, 1);

  // the title or the body left with nothing: refused (the veteran rewords and checks again)
  assert.deepEqual(shownCard({ ...saved, items: [item(1, "differs")] }, card), { ok: false, why: "empty" });
  assert.deepEqual(shownCard({ ...saved, items: [item(2, "differs"), item(3, "unsure"), item(4, "differs")] }, card), { ok: false, why: "empty" });

  // not checked, or changed after the check (a word changed, a sentence added, the title rewritten): refused
  assert.deepEqual(shownCard(undefined, card), { ok: false, why: "unchecked" });
  assert.deepEqual(shownCard(saved, { ...card, reason: "簡単な作業やけんね。" }), { ok: false, why: "unchecked" });
  assert.deepEqual(shownCard(saved, { ...card, caution: "足した文。" }), { ok: false, why: "unchecked" });
  assert.deepEqual(shownCard(saved, { ...card, title: "コンセントの取り替え" }), { ok: false, why: "unchecked" });
  assert.deepEqual([...(keptSentences(sentences, taken) ?? [])], [1, 3, 4, 5]);

  // against 標準仕様書 (not law): left on the card for young workers, with a note on that sentence
  const spec = shownCard({ ...saved, items: [item(2, "differs"), item(3, "differs", false), item(4, "unsure", false)] }, card);
  assert.ok(spec.ok);
  assert.equal(spec.fields.body, "電源を切ってから付け替える。\n「プルボ」は使わん。");
  assert.equal(spec.hidden, 1);
  assert.deepEqual(spec.specDiffers, [{ field: "body", text: "電源を切ってから付け替える。" }]);
  // a check saved before the kind was kept: held back (the safe side)
  const old = shownCard({ ...saved, items: [{ ...item(3, "differs"), legal: undefined as unknown as boolean }] }, card);
  assert.ok(old.ok && old.hidden === 1 && !old.specDiffers.length);

  // nothing marked: the card goes out as written
  const clean = shownCard({ ...saved, items: [item(3, "same")] }, card);
  assert.ok(clean.ok);
  assert.deepEqual(clean.fields, card);
  assert.equal(clean.hidden, 0);
  // no Claude (local runs): it can be published, with no badge
  const dummy = shownCard({ ...saved, items: [], dummy: true }, card);
  assert.ok(dummy.ok);
  assert.equal(dummy.summary, null);
});

test("the card's ✅ / 🟦 sentences go out with their article, never a held-back or taken-out one", () => {
  const f: CheckFields = { title: "PF管の曲げ", scene: "", body: "PF管の曲げは合計270度までにしとる。うちは180度までにしとる。資格がなくてもコンセントの取り替えはしてよか。", reason: "", caution: "" };
  const sentences = cardSentences(f);
  const pf = getLawById(PF)!;
  const it = (n: number, verdict: CheckItem["verdict"], lawId: string, quote: string, legal = true): CheckItem => ({ n, field: sentences[n - 1].field, text: sentences[n - 1].text, verdict, lawId, label: "古い名前", quote, note: verdict === "differs" ? "x" : "", legal });
  const saved: SavedCheck = {
    at: Timestamp.fromMillis(2_000),
    sentences,
    items: [it(2, "same", PF, pfQuote, false), it(3, "stricter", PF, pfQuote, false), it(4, "differs", LICENSE, licQuote)],
  };
  const r = shownCard(saved, f);
  assert.ok(r.ok);
  assert.deepEqual(r.lawRefs, [
    { field: "body", text: "PF管の曲げは合計270度までにしとる。", verdict: "same", lawId: PF, label: `${pf.short} ${pf.article}【${pf.heading}】`, quote: pfQuote },
    { field: "body", text: "うちは180度までにしとる。", verdict: "stricter", lawId: PF, label: `${pf.short} ${pf.article}【${pf.heading}】`, quote: pfQuote },
  ], "the label is made again from the article; the ⚠️ sentence is not there");
  assert.ok(!JSON.stringify(r.lawRefs).includes("資格がなくても"));

  // taken out on the screen after the check: not on the card, so not linked
  const taken = shownCard(saved, { ...f, body: f.body.replace("うちは180度までにしとる。", "") });
  assert.ok(taken.ok);
  assert.deepEqual(taken.lawRefs.map((x) => x.verdict), ["same"]);

  // a quote no longer in the original (or never was): not linked
  const wrong = shownCard({ ...saved, items: [it(2, "same", PF, "原文に無い引用です、照合で外れます")] }, f);
  assert.ok(wrong.ok && wrong.lawRefs.length === 0);

  // no Claude, or no article related to any sentence: no links and no badge
  const dummy = shownCard({ ...saved, dummy: true }, f);
  assert.ok(dummy.ok && dummy.lawRefs.length === 0 && dummy.summary === null);
  const none = shownCard({ ...saved, items: [] }, f);
  assert.ok(none.ok && none.lawRefs.length === 0 && none.summary === null);
});
