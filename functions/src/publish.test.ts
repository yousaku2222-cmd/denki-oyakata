import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { LAW_CHECK_VER, db, type CardDoc } from "./common";
import { publishCard, setCardStatus } from "./interview";
import { cacheKey, publishedCards } from "./ask";
import { cardSentences, termsText, type SavedCheck } from "./lawcheck";

// Needs the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
const emu = { skip: !process.env.FIRESTORE_EMULATOR_HOST && "needs the Firestore emulator" };

const words = {
  title: "プルボの中は束ねる",
  scene: "天井裏",
  body: "線が多か時は、プルボで分けて結束する。",
  reason: "",
  caution: "",
  plain: "線が多い時は、プルボックスで分けて結束します。",
  terms: [{ word: "プルボ", meaning: "プルボックス。電線をまとめて通す箱" }],
  tags: ["プルボ", "結束"],
};

/** A draft of this device's trial space, checked as `words` (no article about it: no ⚖️ badge). */
async function checkedDraft(uid: string) {
  const ref = db.collection("cards").doc();
  const now = Timestamp.now();
  await ref.set({ companyId: `trial_${uid}`, ...words, status: "draft", authorName: "", showAuthorName: false, confirmations: [], helpedCount: 0, viewCount: 0, triggerQuestionId: null, triggerAskerName: null, triggerQuestionText: null, transcript: [], createdAt: now, updatedAt: now, publishedAt: null } as Partial<CardDoc>);
  const saved: SavedCheck = { at: now, sentences: cardSentences({ ...words, terms: termsText(words.terms) }), items: [], tags: words.tags };
  await db.collection("cardPrivate").doc(ref.id).set({ authorId: uid, lawCheck: saved });
  return ref;
}

test("only the plain wording, a meaning or a search word rewritten after the check: publishing is refused", emu, async () => {
  const uid = `pub-${randomUUID()}`;
  const ref = await checkedDraft(uid);
  const send = (edits: Record<string, unknown>) => publishCard({ cardId: ref.id, trial: true, edits: { ...words, ...edits } }, uid);
  await assert.rejects(send({ plain: "線が多い時は、プルボックスは要りません。" }), /照らし合わせをしてから/);
  await assert.rejects(send({ terms: [{ word: "プルボ", meaning: "プルボックス。高圧の線も通す箱" }] }), /照らし合わせをしてから/);
  await assert.rejects(send({ tags: [...words.tags, "高圧"] }), /照らし合わせをしてから/);
  assert.equal((await ref.get()).get("status"), "draft");

  // as checked: out, with the mark even though no article is about it (and so no badge)
  const r = await send({});
  assert.equal(r.ok, true);
  const card = (await ref.get()).data() as CardDoc;
  assert.equal(card.status, "published");
  assert.equal(card.lawCheckVer, LAW_CHECK_VER);
  assert.equal(card.lawCheck, undefined);
  assert.equal(card.plain, words.plain);
  assert.deepEqual(card.terms, words.terms);

  // hidden and shown again: the mark is put on again from the last check
  await setCardStatus({ cardId: ref.id, status: "private" }, uid);
  await ref.update({ lawCheckVer: 0 });
  await setCardStatus({ cardId: ref.id, status: "published" }, uid);
  assert.equal((await ref.get()).get("lawCheckVer"), LAW_CHECK_VER);
});

test("a published card without the mark is used by no answer", emu, async () => {
  const uid = `pub-${randomUUID()}`;
  const space = `trial_${uid}`;
  const now = Timestamp.now();
  const base = { companyId: space, ...words, status: "published", authorName: "", showAuthorName: false, confirmations: [], helpedCount: 0, viewCount: 0, triggerQuestionId: null, triggerAskerName: null, triggerQuestionText: null, transcript: [], createdAt: now, updatedAt: now, publishedAt: now };
  const marked = db.collection("cards").doc();
  const unmarked = db.collection("cards").doc();
  const old = db.collection("cards").doc();
  await Promise.all([marked.set({ ...base, lawCheckVer: LAW_CHECK_VER }), unmarked.set(base), old.set({ ...base, lawCheckVer: LAW_CHECK_VER + 1 })]);
  const cards = await publishedCards([space]);
  assert.deepEqual(cards.map((c) => c.id), [marked.id]);
  // the mark is part of what the saved answers are kept by
  const c = cards[0];
  assert.notEqual(cacheKey("プルボ", [c]).ver, cacheKey("プルボ", [{ ...c, lawCheckVer: undefined }]).ver);
});
