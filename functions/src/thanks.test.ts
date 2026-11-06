import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { LAW_CHECK_VER, db } from "./common";
import { BLOCKED_MSG, hideThanks, sendThanks, thanksVerdict, type ThanksJudge } from "./thanks";
import { milestonesOf, myCards } from "./interview";
import { monthBefore, myQuestions } from "./box";

test("only a clear yes lets a thanks go", () => {
  assert.equal(thanksVerdict({ ok: true, reason: "" }), "ok");
  assert.equal(thanksVerdict({ ok: false, reason: "悪口" }), "no");
  assert.equal(thanksVerdict(null), "failed");
  assert.equal(thanksVerdict("broken"), "failed");
  assert.equal(thanksVerdict({ ok: "yes" }), "failed");
});

test("milestones: only those reached; the ones among thanks from before helps were kept have no date", () => {
  const day = (n: number) => Date.UTC(2026, 10, n);
  const cards = [
    { publishedAt: day(1), fromQuestion: false, helpedCount: 8 },
    { publishedAt: day(3), fromQuestion: true, helpedCount: 4 },
    { publishedAt: null, fromQuestion: false, helpedCount: 0 }, // a draft
  ];
  // 12 thanks, 3 of them from before helps: the 1st is undated, the 10th is the 7th dated one
  const helps = Array.from({ length: 9 }, (_, i) => day(4 + i));
  assert.deepEqual(milestonesOf(cards, helps), [
    { kind: "firstHelp", at: null },
    { kind: "firstCard", at: day(1) },
    { kind: "firstAnswer", at: day(3) },
    { kind: "help10", at: day(10) },
  ]);
  assert.deepEqual(milestonesOf([], []), []);
  assert.equal(monthBefore("2026-01"), "2025-12");
  assert.equal(monthBefore("2026-11"), "2026-10");
});

// The rest needs the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
const emu = { skip: !process.env.FIRESTORE_EMULATOR_HOST && "needs the Firestore emulator" };
const ok: ThanksJudge = async () => ({ ok: true, reason: "" });

/** A veteran's published card (authorId in cardPrivate), and an answer that used it, as ask and markHelped leave it. */
async function setup(opts: { helped?: boolean; legacyAuthor?: boolean } = {}) {
  const vet = `vet-${randomUUID()}`, young = `young-${randomUUID()}`;
  const card = db.collection("cards").doc();
  const now = Timestamp.now();
  await card.set({ companyId: "demo", title: "プルボの中は束ねる", status: "published", lawCheckVer: LAW_CHECK_VER, helpedCount: 1, triggerQuestionId: null, triggerAskerName: null, updatedAt: now, publishedAt: now, ...(opts.legacyAuthor ? { authorId: vet } : {}) });
  if (!opts.legacyAuthor) await db.collection("cardPrivate").doc(card.id).set({ authorId: vet });
  const answer = db.collection("answers").doc();
  await answer.set({ companyId: "demo", askerId: young, question: "プルボの中は？", grounded: true, usedCardIds: [card.id], helped: opts.helped ?? true, createdAt: now });
  return { vet, young, cardId: card.id, answerId: answer.id };
}
const thanksOf = async (answerId: string) => (await db.collection("thanks").where("answerId", "==", answerId).get()).docs;

test("a thanks reaches the card's veteran once, with the veteran's id and not the young worker's in the reply", emu, async () => {
  const s = await setup();
  assert.deepEqual(await sendThanks({ answerId: s.answerId, text: "  おかげで通線できました！  " }, s.young, undefined, ok), { sent: true });
  const [t] = await thanksOf(s.answerId);
  assert.deepEqual(t.get("authorIds"), [s.vet]);
  assert.deepEqual(t.get("cardIds"), [s.cardId]);
  assert.equal(t.get("text"), "おかげで通線できました！");
  assert.equal(t.get("companyId"), "demo");
  assert.equal(t.get("hidden"), false);
  // a second time on the same answer: refused, nothing more written
  await assert.rejects(sendThanks({ answerId: s.answerId, text: "もう一回" }, s.young, undefined, ok), /もう届けてあります/);
  assert.equal((await thanksOf(s.answerId)).length, 1);

  const mine = await myCards({}, s.vet);
  assert.deepEqual(mine.thanks.map((x) => x.text), ["おかげで通線できました！"]);
  assert.equal(mine.thanks[0].cardTitle, "プルボの中は束ねる");
  assert.ok(!JSON.stringify(mine).includes(s.young), "the young worker's id is not in the reply");
});

test("a card from before cardPrivate: the author is found on the card", emu, async () => {
  const s = await setup({ legacyAuthor: true });
  await sendThanks({ answerId: s.answerId, text: "助かりました" }, s.young, undefined, ok);
  assert.deepEqual((await thanksOf(s.answerId))[0].get("authorIds"), [s.vet]);
});

test("not delivered: someone else's answer, before 助かった, an answer without a card", emu, async () => {
  const s = await setup();
  await assert.rejects(sendThanks({ answerId: s.answerId, text: "助かりました" }, `stranger-${randomUUID()}`, undefined, ok), /自分が聞いた答え/);
  const before = await setup({ helped: false });
  await assert.rejects(sendThanks({ answerId: before.answerId, text: "助かりました" }, before.young, undefined, ok), /助かった/);
  const general = db.collection("answers").doc();
  await general.set({ askerId: s.young, usedCardIds: [], helped: true, createdAt: Timestamp.now() });
  await assert.rejects(sendThanks({ answerId: general.id, text: "助かりました" }, s.young, undefined, ok), /親方の知恵/);
  assert.equal((await thanksOf(s.answerId)).length + (await thanksOf(before.answerId)).length, 0);
});

test("not delivered: a link, a 'no' from the check, a check that failed (and the answer can still be thanked)", emu, async () => {
  const s = await setup();
  let asked = 0;
  const counting: ThanksJudge = async () => (asked++, { ok: true, reason: "" });
  for (const text of ["詳しくは https://example.com で", "ｗｗｗ．example．com 見て", "<b>ありがとう</b>"]) {
    assert.deepEqual(await sendThanks({ answerId: s.answerId, text }, s.young, undefined, counting), { sent: false, reason: BLOCKED_MSG });
  }
  assert.equal(asked, 0); // refused by the rules, without asking Claude
  const no: ThanksJudge = async () => ({ ok: false, reason: "電話番号" });
  assert.deepEqual(await sendThanks({ answerId: s.answerId, text: "電話して 090-1234-5678" }, s.young, undefined, no), { sent: false, reason: BLOCKED_MSG });
  const broken: ThanksJudge = async () => {
    throw new Error("broken reply");
  };
  const failed = await sendThanks({ answerId: s.answerId, text: "助かりました" }, s.young, undefined, broken);
  assert.equal(failed.sent, false);
  const odd: ThanksJudge = async () => ({ verdict: "fine" });
  assert.equal((await sendThanks({ answerId: s.answerId, text: "助かりました" }, s.young, undefined, odd)).sent, false);
  assert.equal((await thanksOf(s.answerId)).length, 0);
  // none of these used up the answer
  assert.deepEqual(await sendThanks({ answerId: s.answerId, text: "助かりました" }, s.young, undefined, ok), { sent: true });
});

test("hideThanks: only a veteran it went to can hide it; a hidden one, or one to another's card, is not shown", emu, async () => {
  const s = await setup();
  const other = await setup();
  await sendThanks({ answerId: s.answerId, text: "助かりました" }, s.young, undefined, ok);
  await sendThanks({ answerId: other.answerId, text: "ほかの親方へ" }, other.young, undefined, ok);
  const [t] = await thanksOf(s.answerId);
  await assert.rejects(hideThanks({ thanksId: t.id }, s.young), /あなた宛て/);
  await assert.rejects(hideThanks({ thanksId: t.id }, other.vet), /あなた宛て/);
  await assert.rejects(hideThanks({ thanksId: "no-such-thanks" }, s.vet), /あなた宛て/);
  assert.equal((await myCards({}, s.vet)).thanks.length, 1);
  assert.ok(!(await myCards({}, s.vet)).thanks.some((x) => x.text === "ほかの親方へ"));
  await hideThanks({ thanksId: t.id }, s.vet);
  assert.equal((await db.collection("thanks").doc(t.id).get()).get("hidden"), true);
  assert.equal((await myCards({}, s.vet)).thanks.length, 0);
});

test("a judge's thanks (trial) reaches the veteran only in the judge's own space", emu, async () => {
  const s = await setup();
  await sendThanks({ answerId: s.answerId, text: "審査員から", trial: true }, s.young, undefined, ok);
  assert.equal((await thanksOf(s.answerId))[0].get("companyId"), `trial_${s.young}`);
  assert.equal((await myCards({}, s.vet)).thanks.length, 0);
});

test("わたしの記録: the same question is one, another device's answers and ungrounded ones are not counted", emu, async () => {
  const me = `young-${randomUUID()}`, you = `young-${randomUUID()}`;
  const at = (ms: number) => Timestamp.fromMillis(ms);
  const now = Date.now();
  const add = (askerId: string, question: string, grounded: boolean, ms = now, companyId = "demo") => db.collection("answers").add({ askerId, question, grounded, companyId, usedCardIds: [], helped: false, createdAt: at(ms) });
  await add(me, "PF管は何回まで曲げていい？", true, now - 60_000);
  await add(me, "PF管は 何回まで曲げていい", true); // the same question again
  await add(me, "VE管のサドルの間隔は？", true);
  await add(me, "朝礼は何時？", false); // no source behind it
  await add(me, "審査員の試し", true, now, `trial_${me}`); // a trial space this call does not read
  await add(you, "ほかの人の質問", true);
  const { stats } = await myQuestions({}, me);
  assert.equal(stats.understood.total, 2);
  assert.deepEqual(stats.understood.recent.map((r) => r.text).sort(), ["PF管は何回まで曲げていい？", "VE管のサドルの間隔は？"]);
  assert.equal(stats.understood.recent.find((r) => r.text.startsWith("PF"))?.at, now - 60_000); // dated by the first time
  assert.equal(stats.grownHelped, 0);
  // in its own trial space, the judge's answers count too
  assert.equal((await myQuestions({ trial: true }, me)).stats.understood.total, 3);
});

test("わたしの記録: cards born from my questions, counted by the young workers they helped", emu, async () => {
  const me = `young-${randomUUID()}`;
  const q = await db.collection("questions").add({ companyId: "demo", askerId: me, alsoAskerIds: [], status: "answered", text: "朝礼は？", createdAt: Timestamp.now() });
  const base = { companyId: "demo", triggerQuestionId: q.id, lawCheckVer: LAW_CHECK_VER };
  await db.collection("cards").add({ ...base, status: "published", helpedCount: 3 });
  await db.collection("cards").add({ ...base, status: "private", helpedCount: 5 }); // hidden: not counted
  assert.equal((await myQuestions({}, me)).stats.grownHelped, 3);
});
