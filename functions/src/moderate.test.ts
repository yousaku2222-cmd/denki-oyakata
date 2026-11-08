import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db, type CardDoc } from "./common";
import { setShownJudge, shownVerdict, type ShownJudge } from "./moderate";
import { readSeeds, sendToBox } from "./box";
import { publishCard, setCardStatus } from "./interview";
import { cardSentences, termsText, type SavedCheck } from "./lawcheck";
import { today } from "./limits";

test("only real item numbers are taken from the reply; a reply of the wrong shape is a failed check", () => {
  assert.deepEqual(shownVerdict({ bad: [], reason: "" }, 2), []);
  assert.deepEqual(shownVerdict({ bad: [1, 1, 5, -1, 0.5], reason: "x" }, 2), [1]);
  assert.equal(shownVerdict(null, 2), "failed");
  assert.equal(shownVerdict({ reason: "x" }, 2), "failed");
  assert.equal(shownVerdict({ bad: ["1"] }, 2), "failed");
});

// The rest needs the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
const emu = { skip: !process.env.FIRESTORE_EMULATOR_HOST && "needs the Firestore emulator" };
// a stand-in for Claude: flags any item with the word 「悪口」 in it
const judge: ShownJudge = async (items) => ({ bad: items.flatMap((t, i) => (t.includes("悪口") ? [i] : [])), reason: "" });
const failing: ShownJudge = async () => {
  throw new Error("busy");
};
const boxCount = async (uid: string) => ((await db.collection("usage").doc(`${today()}_box_${uid}`).get()).get("count") as number | undefined) ?? 0;

test("insulting words do not go in the box, even sent as they are; a failed check sends nothing either", emu, async () => {
  const uid = `mod-${randomUUID()}`;
  try {
    setShownJudge(judge);
    await assert.rejects(sendToBox({ text: `親方への悪口 ${uid}`, confirmed: true, trial: true }, uid), /親方に届けられない言葉/);
    await assert.rejects(sendToBox({ text: `PF管の支持は？ ${uid}`, askerName: "悪口太郎", confirmed: true, trial: true }, uid), /親方に届けられない言葉/);
    setShownJudge(failing);
    await assert.rejects(sendToBox({ text: `PF管の支持は？ ${uid}`, confirmed: true, trial: true }, uid), /確かめられなかった/);
    assert.equal((await db.collection("questions").where("askerId", "==", uid).get()).size, 0);
    // blocked words keep their counts (resending them is not free); the failed check gave its count back
    assert.equal(await boxCount(uid), 2);
    setShownJudge(judge);
    const r = await sendToBox({ text: `触ったら死ぬぞ、と言われたけど何ボルト？ ${uid}`, confirmed: true, trial: true }, uid);
    assert.ok("questionId" in r && r.questionId);
  } finally {
    setShownJudge(undefined);
  }
});

const words = { title: "プルボの中は束ねる", scene: "天井裏", body: "線が多か時は、プルボで分けて結束する。", reason: "", caution: "", plain: "", terms: [], tags: ["プルボ"] };
async function checkedDraft(uid: string, w: typeof words) {
  const ref = db.collection("cards").doc();
  const now = Timestamp.now();
  await ref.set({ companyId: `trial_${uid}`, ...w, status: "draft", authorName: "", showAuthorName: false, confirmations: [], helpedCount: 0, viewCount: 0, triggerQuestionId: null, triggerAskerName: null, triggerQuestionText: null, transcript: [], createdAt: now, updatedAt: now, publishedAt: null } as Partial<CardDoc>);
  const saved: SavedCheck = { at: now, sentences: cardSentences({ ...w, terms: termsText(w.terms) }), items: [], tags: w.tags };
  await db.collection("cardPrivate").doc(ref.id).set({ authorId: uid, lawCheck: saved });
  return ref;
}

test("a card with words not to show is not published, and says which part to reword; its name too", emu, async () => {
  const uid = `mod-${randomUUID()}`;
  try {
    setShownJudge(judge);
    const bad = { ...words, caution: "新人への悪口" };
    const ref = await checkedDraft(uid, bad);
    await assert.rejects(publishCard({ cardId: ref.id, trial: true, edits: bad }, uid), /「新人がよく間違えること」に、若手に見せられない言葉/);
    const ok = await checkedDraft(uid, words);
    await assert.rejects(publishCard({ cardId: ok.id, trial: true, edits: words, authorName: "悪口親方", showAuthorName: true }, uid), /「名前」/);
    assert.equal((await ref.get()).get("status"), "draft");
    assert.equal((await ok.get()).get("status"), "draft");
    // a hidden name is not shown, so it is not in the way
    const r = await publishCard({ cardId: ok.id, trial: true, edits: words, authorName: "悪口親方", showAuthorName: false }, uid);
    assert.equal(r.ok, true);
    // shown again from わたしのカード: checked again (a check that cannot be made keeps it hidden)
    await setCardStatus({ cardId: ok.id, status: "private" }, uid);
    setShownJudge(failing);
    await assert.rejects(setCardStatus({ cardId: ok.id, status: "published" }, uid), /確かめられなかった/);
    assert.equal((await ok.get()).get("status"), "private");
  } finally {
    setShownJudge(undefined);
  }
});

test("a question asked only of the AI is shown to the veterans only once its words are checked", emu, async () => {
  const uid = `mod-${randomUUID()}`;
  const space = [`trial_${uid}`];
  const add = (question: string, ms: number) =>
    db.collection("answers").add({ companyId: space[0], question, usedCardIds: [], askerRole: "young", createdAt: Timestamp.fromMillis(Date.now() + ms) });
  try {
    setShownJudge(failing);
    await add(`ブレーカーの選び方は？ ${uid}`, 1);
    assert.deepEqual(await readSeeds(space), []); // not checked: not shown
    setShownJudge(judge);
    const ok = await add(`接地棒の深さは？ ${uid}`, 2);
    await add(`親方の悪口 ${uid}`, 3);
    assert.deepEqual(await readSeeds(space), [`接地棒の深さは？ ${uid}`, `ブレーカーの選び方は？ ${uid}`]);
    assert.equal((await ok.get()).get("seedOk"), true);
    // the verdict is kept: the next read asks nothing
    setShownJudge(failing);
    assert.deepEqual(await readSeeds(space), [`接地棒の深さは？ ${uid}`, `ブレーカーの選び方は？ ${uid}`]);
  } finally {
    setShownJudge(undefined);
  }
});
