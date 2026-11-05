import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { confirmOf, sendToBox, type ClarityInput, type Judge } from "./box";
import { db } from "./common";
import { today } from "./limits";

test("only a clear 'does not get across' holds a question", () => {
  assert.equal(confirmOf({ clear: true, reason: "", suggestion: "" }, "PF管の支持は？"), null);
  assert.equal(confirmOf(null, "x"), null);
  assert.equal(confirmOf("broken", "x"), null);
  assert.equal(confirmOf({ reason: "x" }, "x"), null); // no verdict: send
  assert.deepEqual(confirmOf({ clear: false, reason: " 何を聞きたいか分かりにくいかもしれません。 ", suggestion: "ブレーカーが上がらない時は？" }, "ブレーカー あの 上がらん"), {
    reason: "何を聞きたいか分かりにくいかもしれません。",
    suggestion: "ブレーカーが上がらない時は？",
  });
  // no reason given: a gentle default; the same words back are not offered as a fix
  const r = confirmOf({ clear: false, reason: "", suggestion: "ブレーカー あの 上がらん？" }, "ブレーカー あの 上がらん");
  assert.ok(r && r.reason.length > 0 && r.suggestion === "");
});

// The rest needs the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
const emu = { skip: !process.env.FIRESTORE_EMULATOR_HOST && "needs the Firestore emulator" };
const mine = async (uid: string) => (await db.collection("questions").where("askerId", "==", uid).get()).docs;
const boxCount = async (uid: string) => ((await db.collection("usage").doc(`${today()}_box_${uid}`).get()).get("count") as number | undefined) ?? 0;

test("a question that does not get across is not written, and does not use up the box count", emu, async () => {
  const uid = `check-${randomUUID()}`;
  const judge: Judge = async () => ({ clear: false, reason: "何を聞きたいか分かりにくいかもしれません。", suggestion: "ブレーカーが上がらない時は、昨日の線のどこを見ればいい？" });
  const r = await sendToBox({ text: `ブレーカー あの 上がらん 昨日の 線 どこ ${uid}` }, uid, undefined, judge);
  assert.deepEqual(r, { needsConfirm: true, reason: "何を聞きたいか分かりにくいかもしれません。", suggestion: "ブレーカーが上がらない時は、昨日の線のどこを見ればいい？" });
  assert.equal((await mine(uid)).length, 0);
  assert.equal(await boxCount(uid), 0);
});

test("「このまま送る」 (confirmed) skips the check and sends", emu, async () => {
  const uid = `check-${randomUUID()}`;
  let asked = 0;
  const judge: Judge = async () => (asked++, { clear: false, reason: "x", suggestion: "" });
  const r = await sendToBox({ text: `ブレーカー あの 上がらん ${uid}`, confirmed: true }, uid, undefined, judge);
  assert.equal(asked, 0);
  assert.ok("questionId" in r && r.questionId);
  assert.equal((await mine(uid)).length, 1);
});

test("when the check fails (Claude busy, etc.), the question is sent as it was", emu, async () => {
  const uid = `check-${randomUUID()}`;
  const judge: Judge = async () => {
    throw Object.assign(new Error("overloaded"), { status: 529 });
  };
  const r = await sendToBox({ text: `PF管は何回まで曲げていい？ ${uid}` }, uid, undefined, judge);
  assert.ok("questionId" in r && r.questionId);
  assert.equal((await mine(uid)).length, 1);
});

test("a question that gets across goes straight in; a photo question is judged as one", emu, async () => {
  const uid = `check-${randomUUID()}`;
  const seen: ClarityInput[] = [];
  const judge: Judge = async (q) => (seen.push(q), { clear: true, reason: "", suggestion: "" });
  const r = await sendToBox({ text: "これは何？", photo: "data:image/jpeg;base64,/9j/4AAQ", photoPart: "ジョイントボックス" }, uid, undefined, judge);
  assert.ok("questionId" in r && r.questionId);
  assert.deepEqual(seen, [{ text: "これは何？", photo: true, photoPart: "ジョイントボックス", before: null }]);
  assert.equal((await mine(uid)).length, 1);
});
