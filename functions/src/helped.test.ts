import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./common";
import { markHelped } from "./ask";

// Needs the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
const emu = { skip: !process.env.FIRESTORE_EMULATOR_HOST && "needs the Firestore emulator" };

/** An answer as ask leaves it: one asker, the cards it used, not yet 助かった. */
async function answer(uid: string, cardIds: string[]) {
  const ref = db.collection("answers").doc();
  await ref.set({ askerId: uid, usedCardIds: cardIds, helped: false, createdAt: Timestamp.now() });
  return ref.id;
}
const count = async (id: string) => (await db.collection("cards").doc(id).get()).get("helpedCount") as number;

test("助かった counts once per person per card, however often the question is asked again", emu, async () => {
  const card = db.collection("cards").doc();
  const other = db.collection("cards").doc();
  await card.set({ helpedCount: 0 });
  await other.set({ helpedCount: 0 });
  const me = randomUUID(), you = randomUUID();

  assert.equal((await markHelped({ answerId: await answer(me, [card.id]) }, me)).counted, 1);
  // わたし → 答えを聞く makes a new answer: pressing again adds nothing
  assert.equal((await markHelped({ answerId: await answer(me, [card.id]) }, me)).counted, 0);
  assert.equal(await count(card.id), 1);
  // an answer with a card not yet thanked counts only that one
  assert.equal((await markHelped({ answerId: await answer(me, [card.id, other.id]) }, me)).counted, 1);
  assert.equal(await count(card.id), 1);
  assert.equal(await count(other.id), 1);
  // someone else's thanks still counts
  assert.equal((await markHelped({ answerId: await answer(you, [card.id]) }, you)).counted, 1);
  assert.equal(await count(card.id), 2);
});

test("助かった on someone else's answer is refused", emu, async () => {
  const id = await answer(randomUUID(), []);
  await assert.rejects(markHelped({ answerId: id }, randomUUID()), /not your answer/);
});
