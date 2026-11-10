import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { LAW_CHECK_VER, db, type CardDoc } from "./common";
import { LAWCHECK_FAILED_MSG, checkCard, forYoung, givesBackOnFail, publishCard, setCardStatus } from "./interview";
import { LOCAL } from "./moderate";
import { cacheKey, publishedCards } from "./ask";
import { LawCheckFailed, canLawCheck, cardSentences, setLawJudge, termsText, type SavedCheck } from "./lawcheck";

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

// outside the local runs (the emulators), no key is a check that could not be made: refused before anything is read
test("no key outside the local runs: the law check refuses instead of letting the card out unchecked", { skip: (LOCAL || canLawCheck()) && "runs only without a key outside the emulators" }, async () => {
  await assert.rejects(checkCard({ cardId: "any", edits: { ...words } }, `pub-${randomUUID()}`), (e: unknown) => {
    assert.equal((e as { code?: string }).code, "unavailable");
    assert.equal((e as Error).message, LAWCHECK_FAILED_MSG);
    return true;
  });
});

// a request cut off at the time limit may be billed: its count is not given back (the other failures give theirs back)
test("a law check that ran out of time keeps its count; one that failed otherwise gives it back", () => {
  assert.equal(givesBackOnFail(new LawCheckFailed("no reply in time", undefined, true)), false);
  assert.equal(givesBackOnFail(new LawCheckFailed("claude call failed", new Error("socket hang up"))), true);
  assert.equal(givesBackOnFail(new LawCheckFailed("a reply of the wrong shape")), true);
  assert.equal(givesBackOnFail(new Error("anything else")), true);
});

const fullWords = { title: words.title, scene: words.scene, body: words.body, reason: words.reason, caution: words.caution, terms: words.terms, plain: words.plain };
const checkedAs = (dummy: boolean): SavedCheck => ({ at: Timestamp.now(), sentences: cardSentences({ ...words, terms: termsText(words.terms) }), items: [], tags: words.tags, ...(dummy ? { dummy } : {}) });

test("a check that made no verdict (the local runs' check-nothing) lets a card out only in the local runs", () => {
  // a real check of the same words goes out anywhere
  assert.equal(forYoung(checkedAs(false), fullWords, words.tags).update.title, words.title);
  if (LOCAL) assert.equal(forYoung(checkedAs(true), fullWords, words.tags).update.title, words.title);
  else assert.throws(() => forYoung(checkedAs(true), fullWords, words.tags), (e: unknown) => (e as { code?: string }).code === "failed-precondition");
});

// a card the licence article is always read against, so the check calls the judge
const licenceWords = { ...words, body: "資格がなくてもコンセントの取り替えくらいはしてよか。" };

test("the law check fails: refused, nothing saved, and the card still cannot go out with the new words", emu, async (t) => {
  t.after(() => setLawJudge(undefined));
  const uid = `pub-${randomUUID()}`;
  const ref = await checkedDraft(uid);
  const before = (await db.collection("cardPrivate").doc(ref.id).get()).get("lawCheck") as SavedCheck;
  let charged = 0;
  const ctx = { charge: async () => void charged++ };
  for (const judge of [async () => Promise.reject(new Error("socket hang up")), async () => ({ items: "none" })]) {
    setLawJudge(judge);
    await assert.rejects(checkCard({ cardId: ref.id, edits: licenceWords }, uid, ctx), (e: unknown) => {
      assert.equal((e as { code?: string }).code, "unavailable");
      assert.equal((e as Error).message, LAWCHECK_FAILED_MSG);
      return true;
    });
  }
  assert.equal(charged, 2);
  const after = (await db.collection("cardPrivate").doc(ref.id).get()).get("lawCheck") as SavedCheck;
  assert.deepEqual(after.sentences, before.sentences);
  await assert.rejects(publishCard({ cardId: ref.id, trial: true, edits: licenceWords }, uid), /照らし合わせをしてから/);
  assert.equal((await ref.get()).get("status"), "draft");
});

test("the local runs with no key: the card is checked as nothing and still goes out (no badge)", emu, async (t) => {
  t.after(() => setLawJudge(undefined));
  setLawJudge(null);
  const uid = `pub-${randomUUID()}`;
  const ref = await checkedDraft(uid);
  const r = await checkCard({ cardId: ref.id, edits: licenceWords }, uid);
  assert.equal(r.mode, "dummy");
  const out = (await publishCard({ cardId: ref.id, trial: true, edits: licenceWords }, uid)) as { ok?: boolean };
  assert.equal(out.ok, true);
  assert.equal((await ref.get()).get("lawCheck"), undefined);
});
